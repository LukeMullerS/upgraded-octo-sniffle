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
//
// Todos os arquivos vêm do banco único (src/banco.js): o arquivo de cada UF e de cada
// município é baixado uma vez, conferido com GET condicional e compartilhado por todas as
// janelas. As consultas respondem com o que já existe e dizem quantos arquivos faltam.

import { CICLO, UFS, lerMunicipios, num, resumoVotos, somarResumos, urlResultado } from '../public/tse.js';

const pad = (v, n) => String(v).padStart(n, '0');
const caminhoMunicipios = (ele) => `${CICLO}/${ele}/config/mun-e${pad(ele, 6)}-cm.json`;
const caminhoAcompanhamento = (ele, uf) => `${CICLO}/${ele}/dados/${uf}/${uf}-e${pad(ele, 6)}-ab.json`;
// urlResultado com base vazia gera "/ele2026/..."; o coletor trabalha com caminhos relativos.
const caminhoResultado = (ele, uf, cargo, mun = '') => urlResultado('', ele, uf, cargo, mun).slice(1);

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

// Resumo de votos de um arquivo de resultado, mais a "marca" (seções totalizadas e
// comparecimento) usada para saber se o arquivo está em dia com o acompanhamento.
const resumoComMarca = (bruto) => ({ marca: marca(bruto.s, bruto.e), ...resumoVotos(bruto) });
// "resumo2": inclui candidatos e partidos (resumos antigos guardados em disco são ignorados).
const RESUMO = { processar: resumoComMarca, nome: 'resumo2' };

/** Tira os nomes dos candidatos de cada local e junta num catálogo único (resposta menor). */
function separarNomes(lista) {
  const nomes = {};
  const locais = lista.map(({ marca: _m, nomes: n, ...r }) => {
    Object.assign(nomes, n);
    return r;
  });
  return { locais, nomes };
}

/**
 * @param {object} opcoes
 * @param {ReturnType<import('./banco.js').criarBanco>} opcoes.banco  banco único dos arquivos do TSE
 */
export function criarColetor({
  banco,
  intervaloMs = 120_000,
  ociosoMs = 15 * 60_000,
  agora = () => Date.now(),
  agendar = setInterval,
  cancelar = clearInterval,
  // Função serverless (Vercel): o processo congela assim que responde, então não há leitura
  // em segundo plano. Cada consulta faz a passada (se precisar) e espera por ela.
  sobDemanda = false,
} = {}) {
  const alvos = new Map(); // "ele:cargo:uf" → estado do acompanhamento

  async function municipiosDa(ele) {
    const r = await banco.buscar(caminhoMunicipios(ele), { processar: lerMunicipios, nome: 'municipios', prioridade: 2, esperarMs: 30_000 });
    if (r.valor) return r.valor;
    throw new Error(r.estado === 'indisponivel' ? 'lista de municípios ainda não publicada pelo TSE' : (r.erro ?? 'lista de municípios indisponível'));
  }

  async function passada(alvo) {
    if (alvo.rodando) return alvo.rodando;
    alvo.rodando = (async () => {
      const { ele, cargo, uf } = alvo;
      try {
        const lista = (await municipiosDa(ele))[uf] ?? [];
        alvo.lista = lista;

        let marcas = null;
        const ab = await banco.atualizar(caminhoAcompanhamento(ele, uf), {
          processar: (b) => Object.fromEntries(marcasAcompanhamento(b)), nome: 'marcas', prioridade: true,
        });
        if (ab.valor) marcas = new Map(Object.entries(ab.valor));
        // Município sem informação no acompanhamento (ou acompanhamento fora do ar) é
        // relido a cada 10 minutos.
        const releTudo = agora() - (alvo.ultimaCompleta ?? 0) >= 10 * 60_000;

        let falhas = 0;
        await Promise.all(lista.map(async (m) => {
          const caminho = caminhoResultado(ele, uf, cargo, m.codigo);
          const lido = alvo.municipios.get(m.codigo);
          // O arquivo do município só é conferido de novo quando o acompanhamento mostra
          // seções novas (ou a cada 10 min, se o acompanhamento não ajudar).
          if (!lido) {
            // Resumo guardado em disco (de uma execução anterior) aparece já, enquanto confere.
            const salvo = banco.obter(caminho, { ...RESUMO, auto: false });
            if (salvo.valor) alvo.municipios.set(m.codigo, { codigo: m.codigo, nome: m.nome, uf, ibge: m.ibge ?? null, ...salvo.valor });
          }
          const conferir = !lido || (marcas?.has(m.codigo) ? marcas.get(m.codigo) !== lido.marca : releTudo);
          const r = conferir
            ? await banco.atualizar(caminho, RESUMO)
            : banco.obter(caminho, { ...RESUMO, auto: false });
          if (r.estado === 'erro') falhas += 1;
          if (r.valor) alvo.municipios.set(m.codigo, { codigo: m.codigo, nome: m.nome, uf, ibge: m.ibge ?? null, ...r.valor });
        }));
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
      if (sobDemanda) {
        alvos.set(chave, alvo);
        alvo.ultimoPedido = agora();
        return alvo;
      }
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

  // Na primeira consulta espera um pouco pela primeira leitura, para não mostrar a tabela vazia.
  async function esperarPrimeira(alvos, esperarMs) {
    if (sobDemanda) {
      // Relê quando a última passada ficou velha ou não terminou de ler todos os municípios.
      for (const a of alvos) {
        // Faltando municípios, relê mais cedo (30 s), mas nunca a cada consulta: cada passada
        // confere todos os municípios ainda não lidos no TSE.
        const incompleto = !a.lista || a.municipios.size < a.lista.length;
        const espera = incompleto ? Math.min(30_000, intervaloMs) : intervaloMs;
        if (!a.rodando && (a.ultimaPassada === undefined || agora() - a.ultimaPassada >= espera)) passada(a);
      }
      const rodando = alvos.map((a) => a.rodando).filter(Boolean);
      if (rodando.length) await Promise.race([Promise.all(rodando), new Promise((r) => setTimeout(r, esperarMs))]);
      return;
    }
    const pendentes = alvos.filter((a) => a.primeira).map((a) => a.primeira);
    if (pendentes.length) await Promise.race([Promise.all(pendentes), new Promise((r) => setTimeout(r, esperarMs))]);
    for (const a of alvos) a.primeira = null;
  }

  function retrato(ele, cargo, uf, lista) {
    const { locais: lidos, nomes } = separarNomes(lista.flatMap((a) => [...a.municipios.values()]));
    const passadas = lista.map((a) => a.ultimaPassada).filter(Boolean);
    const ultima = passadas.length ? Math.min(...passadas) : null;
    const erros = lista.map((a) => a.erro).filter(Boolean);
    const semLista = lista.some((a) => !a.lista);
    return {
      eleicao: ele,
      cargo,
      uf,
      total: semLista ? null : lista.reduce((t, a) => t + a.lista.length, 0),
      lidos: lidos.length,
      lendo: lista.some((a) => a.rodando),
      ultimaPassada: ultima ? new Date(ultima).toISOString() : null,
      proximaEmSegundos: ultima ? Math.max(0, Math.round((ultima + intervaloMs - agora()) / 1000)) : null,
      erro: erros.length ? [...new Set(erros)].join(' · ') : null,
      consolidado: lidos.length ? somarResumos(lidos.map((m) => ({ ...m, nomes }))) : null,
      municipios: lidos,
      nomes,
    };
  }

  /** Brancos e nulos de cada município da UF (só os já lidos). */
  async function municipios(ele, cargo, uf, { esperarMs = 4_000 } = {}) {
    const alvo = acompanhar(ele, cargo, uf);
    await esperarPrimeira([alvo], esperarMs);
    return retrato(ele, cargo, uf, [alvo]);
  }

  /** Todas as cidades de várias UFs (o Brasil inteiro): cada UF é acompanhada como em `municipios`. */
  async function todas(ele, cargo, ufs, { esperarMs = 4_000 } = {}) {
    const lista = ufs.map((uf) => acompanhar(ele, cargo, uf));
    await esperarPrimeira(lista, esperarMs);
    return retrato(ele, cargo, 'todas', lista);
  }

  /**
   * Brancos e nulos por UF, dos arquivos de cada UF (27, mais o do Brasil quando existe).
   * Espera no máximo `esperarMs` pelos arquivos que ainda não chegaram e responde com o que tem.
   */
  async function estados(ele, cargo, abrangencias, { esperarMs = 4_000, prioridade = 1 } = {}) {
    const ufs = abrangencias.filter((a) => a !== 'br');
    const opcoes = { ...RESUMO, prioridade, esperarMs };
    const [respostas, br] = await Promise.all([
      Promise.all(ufs.map((uf) => banco.buscar(caminhoResultado(ele, uf, cargo), opcoes))),
      abrangencias.includes('br') ? banco.buscar(caminhoResultado(ele, 'br', cargo), opcoes) : null,
    ]);
    const brutos = [];
    respostas.forEach((r, i) => {
      const uf = ufs[i];
      if (r.valor) brutos.push({ uf, nome: UFS[uf] ?? (uf === 'zz' ? 'Exterior' : uf), ...r.valor });
    });
    const { locais: lista, nomes } = separarNomes(brutos);
    let brasil = null;
    if (br?.valor) {
      const { marca: _m, nomes: n, ...resumo } = br.valor;
      Object.assign(nomes, n);
      brasil = resumo;
    }
    if (!brasil && lista.length) {
      const { nomes: _n, ...soma } = somarResumos(lista.map((e) => ({ ...e, nomes: {} })));
      brasil = soma;
    }
    const pendentes = respostas.filter((r) => r.pendente).length + (br?.pendente ? 1 : 0);
    const erros = [...new Set(respostas.map((r) => r.erro).filter(Boolean))];
    return {
      eleicao: ele, cargo, total: ufs.length, lidos: lista.length, pendentes, brasil, estados: lista, nomes,
      erro: erros.length && !lista.length ? erros.join(' · ') : null,
    };
  }

  return { estados, municipios, todas, municipiosDa, parar, alvos };
}
