// Coletor dos logs das urnas (tempo de votação, biometria…), seção por seção.
//
// Arquivos do TSE ("arquivo-urna" do pleito):
//   {ciclo}/arquivo-urna/{pleito}/config/{uf}/{uf}-p{pleito:6}-cs.json
//       municípios → zonas → seções da UF
//   {ciclo}/arquivo-urna/{pleito}/dados/{uf}/{mun}/{zona}/{seção}/p{pleito:6}-{uf}-m{mun}-z{zona}-s{seção}-aux.json
//       urnas da seção (hash) e nomes dos arquivos publicados
//   {ciclo}/arquivo-urna/{pleito}/dados/{uf}/{mun}/{zona}/{seção}/{hash}/{arquivo}-log.jez (ou .logjez)
//       log da urna, um 7z com o logd.dat
//
// Compilação nacional: uma varredura contínua percorre todas as UFs e lê o log de toda seção
// publicada. Para não perguntar ao TSE por centenas de milhares de seções que ainda não
// existem, ela só procura numa cidade quando o acompanhamento da apuração mostra mais seções
// totalizadas do que as já lidas. O log de uma seção não muda depois de publicado: cada uma
// é lida uma vez. Na memória fica só um acumulador (somas) por município; as seções vão para
// o disco (dados/logs/{pleito}/{uf}/{mun}.json) e o índice de acumuladores para
// dados/logs/{pleito}/resumo.json, de onde tudo volta ao reiniciar.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { abrir7z } from './sete-zip.js';
import { abrirZip, ehZip } from './zip.js';
import { acumular, finalizar, juntar, novoAcumulador, resumirLog } from './log-urna.js';

const pad = (v, n) => String(v).padStart(n, '0');

function criarLimitador(maximo) {
  let ativos = 0;
  const fila = [];
  const proximo = () => {
    if (ativos >= maximo || !fila.length) return;
    ativos += 1;
    const { tarefa, ok, falha } = fila.shift();
    tarefa().then(ok, falha).finally(() => { ativos -= 1; proximo(); });
  };
  return (tarefa) => new Promise((ok, falha) => { fila.push({ tarefa, ok, falha }); proximo(); });
}

/** Lista de municípios/zonas/seções do cs.json. */
export function lerConfigSecoes(bruto, uf) {
  const municipios = [];
  for (const abr of bruto?.abr ?? []) {
    if (abr.cd && String(abr.cd).toLowerCase() !== uf) continue;
    for (const mu of abr.mu ?? []) {
      const secoes = [];
      for (const z of mu.zon ?? []) for (const s of z.sec ?? []) secoes.push({ zona: pad(z.cd, 4), secao: pad(s.ns, 4) });
      municipios.push({ codigo: pad(mu.cd, 5), nome: mu.nm, secoes });
    }
  }
  return municipios.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Nome do arquivo de log de uma urna no aux.json (formato até 2022: nmarq; desde 2024: arq). */
export function arquivoDeLog(aux) {
  for (const h of aux?.hashes ?? []) {
    if (!h.hash || h.hash === '0') continue; // urna não instalada
    const nomes = (h.arq ?? h.nmarq ?? []).map((a) => (typeof a === 'string' ? a : a.nm)).filter(Boolean);
    const log = nomes.find((n) => /-log\.jez$|\.logjez$/i.test(n));
    if (log) return { hash: h.hash, nome: log };
  }
  return null;
}

/** Escolhe `n` seções espalhadas pela lista (amostra determinística). */
export function amostrar(lista, n) {
  if (lista.length <= n) return lista;
  return Array.from({ length: n }, (_, i) => lista[Math.floor(((i + 0.5) * lista.length) / n)]);
}

// Ordem da varredura: UFs menores primeiro, para o progresso aparecer cedo.
export const ORDEM_UFS = ['rr', 'ap', 'ac', 'to', 'ro', 'se', 'al', 'am', 'rn', 'pb', 'pi', 'ms', 'mt', 'df', 'es',
  'ma', 'pa', 'go', 'sc', 'ce', 'pe', 'pr', 'rs', 'ba', 'rj', 'mg', 'sp', 'zz'];

const semDetalhe = ({ hist, porHora, ...resto }) => resto;

/**
 * @param {object} o
 * @param {(caminho: string) => Promise<object|null>} o.buscarJson
 * @param {(caminho: string) => Promise<Buffer|null>} o.buscarBinario
 * @param {(uf: string) => Promise<Map<string, number>|null>} [o.totalizadas]  seções totalizadas por município
 */
export function criarColetorLogs({
  buscarJson, buscarBinario, totalizadas = async () => null, pasta = 'dados/logs', ciclo = 'ele2026', pleito = '3220',
  ufs = ORDEM_UFS, intervaloMs = 120_000, concorrencia = 6, automatico = false,
  agora = () => Date.now(), agendar = setTimeout, cancelar = clearTimeout,
} = {}) {
  const limitar = criarLimitador(concorrencia);
  const prefixos = [`p${pad(pleito, 6)}`, `p000${pleito}`]; // o TSE usa 6 dígitos; o 2º é só por garantia
  const base = `${ciclo}/arquivo-urna/${pleito}`;
  const raiz = join(pasta, pleito);
  const configs = new Map(); // uf → Promise<municípios>
  const totais = new Map(); // uf → nº de seções (da lista do TSE)
  const resumos = new Map(); // "uf/mun" → { acc, lidas }
  const secoesCache = new Map(); // "uf/mun" → Promise<Map("zona-seção" → resumo)> (poucos por vez)
  const sujos = new Set();
  const emUso = new Map(); // "uf/mun" → leituras em andamento (não pode sair do cache)
  const prioridade = new Set(); // "uf/mun" pedidos na tela: lidos antes do resto
  const nac = { ativo: false, pausado: false, rodando: null, timer: null, passadas: 0, ultimaPassada: null, ufAtual: null, novas: 0, erros: new Map() };
  let pronto = null;

  async function primeiroQueExiste(caminhos) {
    for (const c of caminhos) {
      const r = await buscarJson(c);
      if (r) return r;
    }
    return null;
  }

  function config(uf) {
    if (!configs.has(uf)) {
      const p = primeiroQueExiste(prefixos.map((px) => `${base}/config/${uf}/${uf}-${px}-cs.json`)).then((bruto) => {
        if (!bruto) throw new Error('lista de seções ainda não publicada pelo TSE');
        const municipios = lerConfigSecoes(bruto, uf);
        totais.set(uf, municipios.reduce((t, m) => t + m.secoes.length, 0));
        return municipios;
      });
      p.catch(() => configs.delete(uf));
      configs.set(uf, p);
    }
    return configs.get(uf);
  }

  // ---------- disco ----------

  const arquivoMunicipio = (uf, mun) => join(raiz, uf, `${mun}.json`);

  /** Índice de acumuladores (e, na primeira vez, reconstrução a partir dos arquivos de município). */
  async function carregar() {
    try {
      const dados = JSON.parse(await readFile(join(raiz, 'resumo.json'), 'utf8'));
      for (const [k, v] of Object.entries(dados.municipios ?? {})) resumos.set(k, v);
      return;
    } catch { /* sem índice: reconstrói */ }
    for (const uf of ufs) {
      let arquivos = [];
      try { arquivos = (await readdir(join(raiz, uf))).filter((f) => f.endsWith('.json')); } catch { continue; }
      for (const f of arquivos) {
        const mapa = await lerArquivo(uf, f.slice(0, -5));
        guardarResumo(`${uf}/${f.slice(0, -5)}`, mapa);
      }
    }
  }

  async function lerArquivo(uf, mun) {
    try {
      return new Map(Object.entries(JSON.parse(await readFile(arquivoMunicipio(uf, mun), 'utf8')).secoes ?? {}));
    } catch {
      return new Map();
    }
  }

  function guardarResumo(k, mapa) {
    const acc = novoAcumulador();
    for (const r of mapa.values()) acumular(acc, r);
    resumos.set(k, { acc, lidas: mapa.size });
  }

  /** Seções de um município (do disco, com cache dos últimos usados). */
  function secoes(uf, mun) {
    const k = `${uf}/${mun}`;
    if (!secoesCache.has(k)) {
      secoesCache.set(k, lerArquivo(uf, mun));
      // Mantém poucos municípios abertos na memória (os já gravados podem sair).
      for (const antigo of secoesCache.keys()) {
        if (secoesCache.size <= 40) break;
        if (!sujos.has(antigo) && !emUso.get(antigo) && antigo !== k) secoesCache.delete(antigo);
      }
    }
    return secoesCache.get(k);
  }

  async function gravar() {
    const lista = [...sujos];
    sujos.clear();
    for (const k of lista) {
      const [uf, mun] = k.split('/');
      const mapa = await secoesCache.get(k);
      if (!mapa) continue;
      guardarResumo(k, mapa);
      await mkdir(join(raiz, uf), { recursive: true }).catch(() => {});
      await writeFile(arquivoMunicipio(uf, mun), JSON.stringify({ pleito, uf, municipio: mun, secoes: Object.fromEntries(mapa) })).catch(() => sujos.add(k));
    }
    if (lista.length) {
      await mkdir(raiz, { recursive: true }).catch(() => {});
      await writeFile(join(raiz, 'resumo.json'), JSON.stringify({ pleito, municipios: Object.fromEntries(resumos) })).catch(() => {});
    }
  }

  // ---------- leitura de seção ----------

  /** Lê uma seção: aux.json → log.jez → logd.dat → resumo. null se ainda não publicada. */
  async function lerSecao(uf, mun, { zona, secao }) {
    const dir = `${base}/dados/${uf}/${mun}/${zona}/${secao}`;
    const aux = await primeiroQueExiste(prefixos.map((px) => `${dir}/${px}-${uf}-m${mun}-z${zona}-s${secao}-aux.json`));
    const arq = arquivoDeLog(aux);
    if (!arq) return null;
    const bin = await buscarBinario(`${dir}/${arq.hash}/${arq.nome}`);
    if (!bin) return null;
    // 2026: ZIP (deflate); até 2024: 7z.
    const bytes = new Uint8Array(bin);
    const arquivos = ehZip(bytes) ? abrirZip(bytes) : abrir7z(bytes);
    const logd = arquivos.find((a) => /logd.*\.dat$/i.test(a.nome)) ?? arquivos.find((a) => a.dados.length);
    if (!logd) throw new Error('log sem logd.dat');
    return { zona, secao, ...resumirLog(logd.dados) };
  }

  /**
   * Lê as seções ainda não lidas de um município. `st` = seções totalizadas segundo o
   * acompanhamento (null = desconhecido): se já foram lidas tantas quanto as totalizadas,
   * não há o que procurar.
   */
  async function processarMunicipio(uf, m, st, forcar = false) {
    const k = `${uf}/${m.codigo}`;
    emUso.set(k, (emUso.get(k) ?? 0) + 1);
    try {
      const mapa = await secoes(uf, m.codigo);
      if (!forcar && st !== null && st !== undefined && mapa.size >= st) return;
      await lerPendentes(uf, m, k, mapa, forcar);
    } finally {
      emUso.set(k, emUso.get(k) - 1);
      if (!emUso.get(k)) emUso.delete(k);
    }
  }

  function lerPendentes(uf, m, k, mapa, forcar) {
    const pendentes = m.secoes.filter((s) => !mapa.has(`${s.zona}-${s.secao}`));
    return Promise.all(pendentes.map((s) => limitar(async () => {
      if (nac.pausado && !forcar) return;
      try {
        const r = await lerSecao(uf, m.codigo, s);
        if (r) {
          mapa.set(`${s.zona}-${s.secao}`, r);
          sujos.add(k);
          nac.novas += 1;
        }
        nac.erros.delete(`${k}/${s.zona}-${s.secao}`);
      } catch (erro) {
        nac.erros.set(`${k}/${s.zona}-${s.secao}`, erro.message);
      }
    })));
  }

  // ---------- varredura nacional ----------

  async function passadaNacional() {
    nac.novas = 0;
    for (const uf of ufs) {
      if (nac.pausado) break;
      nac.ufAtual = uf;
      let municipios;
      try { municipios = await config(uf); } catch { continue; }
      const st = await totalizadas(uf).catch(() => null);
      // Cidades pedidas na tela primeiro; depois as que têm seções totalizadas.
      const ordem = [...municipios].sort((a, b) => Number(prioridade.has(`${uf}/${b.codigo}`)) - Number(prioridade.has(`${uf}/${a.codigo}`)));
      await Promise.all(ordem.map((m) => {
        const n = st ? (st.get(m.codigo) ?? 0) : null;
        if (n === 0) return null; // nenhuma seção totalizada: não há log para buscar
        return processarMunicipio(uf, m, n);
      }));
      await gravar();
    }
    nac.ufAtual = null;
    nac.passadas += 1;
    nac.ultimaPassada = agora();
  }

  function agendarProxima() {
    cancelar(nac.timer);
    if (!nac.ativo || nac.pausado) return;
    nac.timer = agendar(() => rodar(), intervaloMs);
    nac.timer?.unref?.();
  }

  function rodar() {
    if (nac.rodando || nac.pausado) return nac.rodando;
    nac.rodando = passadaNacional()
      .catch(() => {})
      .finally(() => { nac.rodando = null; agendarProxima(); });
    return nac.rodando;
  }

  /** Liga a compilação nacional (contínua: uma passada a cada 2 min). */
  async function iniciar() {
    await (pronto ??= carregar());
    nac.ativo = true;
    nac.pausado = false;
    rodar();
  }

  function pausar() {
    nac.pausado = true;
    cancelar(nac.timer);
  }

  function retomar() {
    if (!nac.ativo) return iniciar();
    nac.pausado = false;
    rodar();
    return null;
  }

  /** Progresso da compilação: seções lidas e total por UF. */
  async function nacional() {
    await (pronto ??= carregar());
    const porUf = ufs.map((uf) => {
      let lidas = 0;
      for (const [k, v] of resumos) if (k.startsWith(`${uf}/`)) lidas += v.lidas;
      return { uf, total: totais.get(uf) ?? null, lidas };
    });
    const total = porUf.reduce((t, u) => t + (u.total ?? 0), 0);
    return {
      ativo: nac.ativo, pausado: nac.pausado, lendo: Boolean(nac.rodando), ufAtual: nac.ufAtual,
      passadas: nac.passadas, novasNaPassada: nac.novas, erros: nac.erros.size,
      ultimoErro: [...nac.erros.values()].at(-1) ?? null,
      ultimaPassada: nac.ultimaPassada ? new Date(nac.ultimaPassada).toISOString() : null,
      proximaEmSegundos: nac.ultimaPassada && !nac.rodando ? Math.max(0, Math.round((nac.ultimaPassada + intervaloMs - agora()) / 1000)) : null,
      total, lidas: porUf.reduce((t, u) => t + u.lidas, 0), porUf,
    };
  }

  // ---------- consultas ----------

  const resumoDe = (k) => resumos.get(k);

  /** Seções já lidas de um município, mais o agregado. `coletar` lê agora as que faltam. */
  async function municipio(uf, mun, { coletar = false } = {}) {
    await (pronto ??= carregar());
    const k = `${uf}/${mun}`;
    const municipios = await config(uf).catch(() => []);
    const info = municipios.find((m) => m.codigo === mun);
    if (coletar && info) {
      prioridade.add(k);
      const leitura = processarMunicipio(uf, info, null, true).then(gravar);
      leitura.catch(() => {}); // continua depois da resposta; uma falha não pode ficar solta
      await Promise.race([leitura, new Promise((r) => setTimeout(r, 3000))]);
    }
    const mapa = await secoes(uf, mun);
    const lista = [...mapa.values()].sort((a, b) => `${a.zona}${a.secao}`.localeCompare(`${b.zona}${b.secao}`));
    const acc = novoAcumulador();
    for (const r of lista) acumular(acc, r);
    return {
      uf, municipio: mun, nome: info?.nome ?? null, totalSecoes: info?.secoes.length ?? null,
      progresso: { lidas: mapa.size, total: info?.secoes.length ?? null, lendo: Boolean(nac.rodando) },
      resumo: finalizar(acc),
      secoes: lista.map(semDetalhe),
    };
  }

  /** Municípios da UF com o agregado das seções já lidas. */
  async function estado(uf) {
    await (pronto ??= carregar());
    const municipios = await config(uf).catch(() => []);
    const acc = novoAcumulador();
    const lista = municipios.map((m) => {
      const r = resumoDe(`${uf}/${m.codigo}`);
      if (r) juntar(acc, r.acc);
      return { codigo: m.codigo, nome: m.nome, totalSecoes: m.secoes.length, lidas: r?.lidas ?? 0, resumo: r?.acc.secoes ? semDetalhe(finalizar(r.acc)) : null };
    });
    return { uf, progresso: (await nacional()).porUf.find((p) => p.uf === uf) ?? null, resumo: finalizar(acc), municipios: lista };
  }

  /** Agregado por UF (e do Brasil) de tudo que já foi lido. */
  async function brasil(lista = ufs) {
    await (pronto ??= carregar());
    const total = novoAcumulador();
    const estados = [];
    for (const uf of lista) {
      const acc = novoAcumulador();
      for (const [k, v] of resumos) if (k.startsWith(`${uf}/`)) juntar(acc, v.acc);
      if (acc.secoes) {
        juntar(total, acc);
        estados.push({ uf, resumo: semDetalhe(finalizar(acc)) });
      }
    }
    return { estados, resumo: finalizar(total) };
  }

  /** Resumo (sem histograma) de todos os municípios já lidos, para o explorador e os mapas. */
  async function todosMunicipios() {
    await (pronto ??= carregar());
    const out = [];
    for (const [k, v] of resumos) {
      if (!v.acc.secoes) continue;
      const [uf, codigo] = k.split('/');
      out.push({ uf, codigo, lidas: v.lidas, resumo: semDetalhe(finalizar(v.acc)) });
    }
    return out;
  }

  if (automatico) iniciar();

  return { iniciar, pausar, retomar, nacional, municipio, estado, brasil, todosMunicipios, config, lerSecao, gravar, rodar };
}
