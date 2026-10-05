// Coletor de brancos e nulos por município.
//
// O TSE publica um arquivo de resultado por município e cargo, sem um arquivo único
// com todos os municípios de uma UF. Para montar a tabela por cidade, o coletor:
//   1. lê a lista de municípios da eleição (config/mun-e{eleição}-cm.json);
//   2. a cada passada (2 min) lê o arquivo de acompanhamento da UF ({uf}-e{eleição}-ab.json),
//      que diz, para cada município, quantas seções já foram totalizadas;
//   3. baixa só os municípios novos ou cujas seções totalizadas mudaram.
// Assim os números cobrem apenas os municípios já lidos, e vão se completando.
// Uma UF só é acompanhada enquanto alguém a consulta (pára depois de 15 min sem pedidos).

import { CICLO, UFS, lerMunicipios, num, resumoVotos, somarResumos, urlResultado } from '../public/tse.js';

const pad = (v, n) => String(v).padStart(n, '0');
const caminhoMunicipios = (ele) => `${CICLO}/${ele}/config/mun-e${pad(ele, 6)}-cm.json`;
const caminhoAcompanhamento = (ele, uf) => `${CICLO}/${ele}/dados/${uf}/${uf}-e${pad(ele, 6)}-ab.json`;
// urlResultado com base vazia gera "/ele2026/..."; o coletor trabalha com caminhos relativos.
const caminhoResultado = (ele, uf, cargo, mun = '') => urlResultado('', ele, uf, cargo, mun).slice(1);

/** Limita quantas requisições ao TSE ficam abertas ao mesmo tempo. */
function criarLimitador(maximo) {
  let ativos = 0;
  const fila = [];
  const proximo = () => {
    if (ativos >= maximo || fila.length === 0) return;
    ativos += 1;
    const { tarefa, ok, falha } = fila.shift();
    tarefa().then(ok, falha).finally(() => {
      ativos -= 1;
      proximo();
    });
  };
  return (tarefa) => new Promise((ok, falha) => {
    fila.push({ tarefa, ok, falha });
    proximo();
  });
}

// "seções totalizadas:comparecimento" — muda sempre que entram urnas novas no município.
const marca = (s, e) => `${num(s?.st)}:${num(e?.c)}`;

/** Lê o acompanhamento da UF: código do município → marca. */
export function marcasAcompanhamento(bruto) {
  const marcas = new Map();
  for (const a of bruto?.abr ?? []) {
    if (a.tpabr && a.tpabr !== 'mun') continue;
    marcas.set(String(a.cdabr), marca(a.s, a.e));
  }
  return marcas;
}

/**
 * @param {object} opcoes
 * @param {(caminho: string) => Promise<object|null>} opcoes.buscarJson  devolve o JSON, ou null se o TSE respondeu 404
 */
export function criarColetor({
  buscarJson,
  intervaloMs = 120_000,
  concorrencia = 6,
  ociosoMs = 15 * 60_000,
  agora = () => Date.now(),
  agendar = setInterval,
  cancelar = clearInterval,
} = {}) {
  const limitar = criarLimitador(concorrencia);
  const listas = new Map(); // eleição → Promise<{ uf → municípios }>
  const alvos = new Map(); // "ele:cargo:uf" → estado do acompanhamento

  function municipiosDa(ele) {
    if (!listas.has(ele)) {
      const p = buscarJson(caminhoMunicipios(ele)).then((bruto) => {
        if (!bruto) throw new Error('lista de municípios ainda não publicada pelo TSE');
        return lerMunicipios(bruto);
      });
      p.catch(() => listas.delete(ele)); // tenta de novo na próxima consulta
      listas.set(ele, p);
    }
    return listas.get(ele);
  }

  async function passada(alvo) {
    if (alvo.rodando) return alvo.rodando;
    alvo.rodando = (async () => {
      const { ele, cargo, uf } = alvo;
      try {
        const lista = (await municipiosDa(ele))[uf] ?? [];
        alvo.lista = lista;

        let marcas = null;
        try {
          const ab = await limitar(() => buscarJson(caminhoAcompanhamento(ele, uf)));
          if (ab) marcas = marcasAcompanhamento(ab);
        } catch {
          // Sem acompanhamento, recai em reler tudo, mas no máximo a cada 10 minutos.
        }
        // Município sem informação no acompanhamento (ou acompanhamento fora do ar) é
        // relido a cada 10 minutos.
        const releTudo = agora() - (alvo.ultimaCompleta ?? 0) >= 10 * 60_000;

        const pendentes = lista.filter((m) => {
          const lido = alvo.municipios.get(m.codigo);
          if (!lido) return true;
          if (marcas?.has(m.codigo)) return marcas.get(m.codigo) !== lido.marca;
          return releTudo;
        });

        let falhas = 0;
        await Promise.all(pendentes.map((m) => limitar(async () => {
          try {
            const bruto = await buscarJson(caminhoResultado(ele, uf, cargo, m.codigo));
            if (!bruto) return; // ainda não publicado
            alvo.municipios.set(m.codigo, {
              codigo: m.codigo,
              nome: m.nome,
              // A marca vem do próprio arquivo: se ele estiver atrás do acompanhamento
              // (os dois são gerados em momentos diferentes), é relido na próxima passada.
              marca: marca(bruto.s, bruto.e),
              ...resumoVotos(bruto),
            });
          } catch {
            falhas += 1;
          }
        })));
        if (releTudo) alvo.ultimaCompleta = agora();
        alvo.erro = falhas ? `${falhas} município(s) não responderam; nova tentativa na próxima passada` : null;
      } catch (erro) {
        alvo.erro = erro.message;
      } finally {
        alvo.ultimaPassada = agora();
        alvo.rodando = null;
      }
    })();
    return alvo.rodando;
  }

  function parar(chave) {
    const alvo = alvos.get(chave);
    if (alvo) cancelar(alvo.timer);
    alvos.delete(chave);
  }

  function acompanhar(ele, cargo, uf) {
    const chave = `${ele}:${cargo}:${uf}`;
    let alvo = alvos.get(chave);
    if (!alvo) {
      alvo = { chave, ele, cargo, uf, municipios: new Map(), lista: null, erro: null };
      alvo.timer = agendar(() => {
        if (agora() - alvo.ultimoPedido > ociosoMs) parar(chave);
        else passada(alvo);
      }, intervaloMs);
      alvo.timer?.unref?.();
      alvos.set(chave, alvo);
      alvo.primeira = passada(alvo);
    }
    alvo.ultimoPedido = agora();
    return alvo;
  }

  /** Brancos e nulos de cada município da UF (só os já lidos). */
  async function municipios(ele, cargo, uf, { esperarMs = 8_000 } = {}) {
    const alvo = acompanhar(ele, cargo, uf);
    // Na primeira consulta espera um pouco pela primeira leitura, para não mostrar a tabela vazia.
    if (alvo.primeira) {
      await Promise.race([alvo.primeira, new Promise((r) => setTimeout(r, esperarMs))]);
      alvo.primeira = null;
    }
    const lidos = [...alvo.municipios.values()].map(({ marca, ...m }) => m);
    return {
      eleicao: ele,
      cargo,
      uf,
      total: alvo.lista?.length ?? null,
      lidos: lidos.length,
      lendo: Boolean(alvo.rodando),
      ultimaPassada: alvo.ultimaPassada ? new Date(alvo.ultimaPassada).toISOString() : null,
      proximaEmSegundos: alvo.ultimaPassada
        ? Math.max(0, Math.round((alvo.ultimaPassada + intervaloMs - agora()) / 1000))
        : null,
      erro: alvo.erro,
      consolidado: lidos.length ? somarResumos(lidos) : null,
      municipios: lidos,
    };
  }

  /** Brancos e nulos por UF, direto dos arquivos de cada UF (27 arquivos, mais o Brasil quando existe). */
  async function estados(ele, cargo, abrangencias) {
    const ufs = abrangencias.filter((a) => a !== 'br');
    const lidos = await Promise.all(ufs.map((uf) => limitar(async () => {
      try {
        const bruto = await buscarJson(caminhoResultado(ele, uf, cargo));
        return bruto ? { uf, nome: UFS[uf] ?? (uf === 'zz' ? 'Exterior' : uf), ...resumoVotos(bruto) } : null;
      } catch {
        return null;
      }
    })));
    const lista = lidos.filter(Boolean);
    let brasil = null;
    if (abrangencias.includes('br')) {
      try {
        const bruto = await buscarJson(caminhoResultado(ele, 'br', cargo));
        if (bruto) brasil = resumoVotos(bruto);
      } catch {
        // cai na soma das UFs abaixo
      }
    }
    if (!brasil && lista.length) brasil = somarResumos(lista);
    return { eleicao: ele, cargo, total: ufs.length, lidos: lista.length, brasil, estados: lista };
  }

  return { estados, municipios, parar, alvos };
}
