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
// Ler o Brasil inteiro seriam centenas de milhares de logs; por isso a coleta é por
// município (todas as seções) ou por amostra da UF (algumas seções de cada cidade). O log de
// uma seção não muda depois de publicado: cada uma é lida uma vez e o resumo vai para o disco
// (dados/logs). Seções ainda não publicadas são tentadas de novo a cada 2 minutos.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { abrir7z } from './sete-zip.js';
import { agregarResumos, resumirLog } from './log-urna.js';

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

export function criarColetorLogs({
  buscarJson, buscarBinario, pasta = 'dados/logs', ciclo = 'ele2026', pleito = '3220',
  intervaloMs = 120_000, concorrencia = 4, ociosoMs = 15 * 60_000,
  agora = () => Date.now(), agendar = setInterval, cancelar = clearInterval,
} = {}) {
  const limitar = criarLimitador(concorrencia);
  const prefixos = [`p${pad(pleito, 6)}`, `p000${pleito}`]; // o TSE usa 6 dígitos; o 2º é só por garantia
  const configs = new Map(); // uf → Promise<municípios>
  const lidas = new Map(); // "uf/mun" → Map("zona-seção" → resumo)
  const carregadas = new Map(); // "uf/mun" → Promise (leitura do disco)
  const jobs = new Map();

  const base = `${ciclo}/arquivo-urna/${pleito}`;

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
        return lerConfigSecoes(bruto, uf);
      });
      p.catch(() => configs.delete(uf));
      configs.set(uf, p);
    }
    return configs.get(uf);
  }

  const arquivoMunicipio = (uf, mun) => join(pasta, pleito, uf, `${mun}.json`);

  function secoesLidas(uf, mun) {
    const k = `${uf}/${mun}`;
    if (!carregadas.has(k)) {
      carregadas.set(k, readFile(arquivoMunicipio(uf, mun), 'utf8')
        .then((t) => { lidas.set(k, new Map(Object.entries(JSON.parse(t).secoes ?? {}))); })
        .catch(() => { if (!lidas.has(k)) lidas.set(k, new Map()); }));
    }
    return carregadas.get(k).then(() => lidas.get(k));
  }

  async function salvar(uf, mun) {
    const mapa = lidas.get(`${uf}/${mun}`);
    if (!mapa) return;
    await mkdir(join(pasta, pleito, uf), { recursive: true }).catch(() => {});
    await writeFile(arquivoMunicipio(uf, mun), JSON.stringify({ pleito, uf, municipio: mun, secoes: Object.fromEntries(mapa) })).catch(() => {});
  }

  /** Lê uma seção: aux.json → log.jez → logd.dat → resumo. null se ainda não publicada. */
  async function lerSecao(uf, mun, { zona, secao }) {
    const dir = `${base}/dados/${uf}/${mun}/${zona}/${secao}`;
    const aux = await primeiroQueExiste(prefixos.map((px) => `${dir}/${px}-${uf}-m${mun}-z${zona}-s${secao}-aux.json`));
    const arq = arquivoDeLog(aux);
    if (!arq) return null;
    const bin = await buscarBinario(`${dir}/${arq.hash}/${arq.nome}`);
    if (!bin) return null;
    const arquivos = abrir7z(new Uint8Array(bin));
    const logd = arquivos.find((a) => /logd.*\.dat$/i.test(a.nome)) ?? arquivos.find((a) => a.dados.length);
    if (!logd) throw new Error('log sem logd.dat');
    return { zona, secao, ...resumirLog(logd.dados) };
  }

  async function passada(job) {
    if (job.rodando) return job.rodando;
    job.rodando = (async () => {
      try {
        const municipios = await config(job.uf);
        const alvos = job.mun ? municipios.filter((m) => m.codigo === job.mun) : municipios;
        if (!alvos.length) throw new Error('município não encontrado na lista de seções do TSE');
        job.total = 0;
        const tarefas = [];
        for (const m of alvos) {
          const escolhidas = job.por ? amostrar(m.secoes, job.por) : m.secoes;
          job.total += escolhidas.length;
          const mapa = await secoesLidas(job.uf, m.codigo);
          const pendentes = escolhidas.filter((s) => !mapa.has(`${s.zona}-${s.secao}`));
          if (!pendentes.length) continue;
          tarefas.push(Promise.all(pendentes.map((s) => limitar(async () => {
            try {
              const r = await lerSecao(job.uf, m.codigo, s);
              if (r) { mapa.set(`${s.zona}-${s.secao}`, r); job.novas += 1; }
            } catch (erro) {
              job.erros.set(`${m.codigo}/${s.zona}-${s.secao}`, erro.message);
            }
          }))).then(() => salvar(job.uf, m.codigo)));
        }
        await Promise.all(tarefas);
        job.erro = null;
      } catch (erro) {
        job.erro = erro.message;
      } finally {
        job.ultimaPassada = agora();
        job.rodando = null;
      }
    })();
    return job.rodando;
  }

  function iniciar(chave, dados) {
    let job = jobs.get(chave);
    if (!job) {
      job = { chave, ...dados, total: null, novas: 0, erros: new Map(), erro: null };
      job.timer = agendar(() => {
        if (agora() - job.ultimoPedido > ociosoMs) { cancelar(job.timer); jobs.delete(chave); } else passada(job);
      }, intervaloMs);
      job.timer?.unref?.();
      jobs.set(chave, job);
      passada(job);
    }
    job.ultimoPedido = agora();
    return job;
  }

  async function progresso(job) {
    if (!job) return null;
    let lidasN = 0;
    if (job.total !== null) {
      const municipios = await config(job.uf).catch(() => []);
      for (const m of job.mun ? municipios.filter((x) => x.codigo === job.mun) : municipios) {
        const mapa = lidas.get(`${job.uf}/${m.codigo}`);
        if (!mapa) continue;
        const alvo = new Set((job.por ? amostrar(m.secoes, job.por) : m.secoes).map((s) => `${s.zona}-${s.secao}`));
        for (const k of mapa.keys()) if (alvo.has(k)) lidasN += 1;
      }
    }
    return {
      tipo: job.mun ? 'municipio' : 'amostra', por: job.por ?? null, total: job.total, lidas: lidasN,
      lendo: Boolean(job.rodando), erros: job.erros.size, erro: job.erro,
      proximaEmSegundos: job.ultimaPassada ? Math.max(0, Math.round((job.ultimaPassada + intervaloMs - agora()) / 1000)) : null,
    };
  }

  /** Todas as seções já lidas de um município, mais o agregado. `coletar` inicia a leitura de todas. */
  async function municipio(uf, mun, { coletar = false } = {}) {
    const job = coletar ? iniciar(`mun:${uf}:${mun}`, { uf, mun }) : jobs.get(`mun:${uf}:${mun}`);
    if (job?.rodando && !job.total) await Promise.race([job.rodando, new Promise((r) => setTimeout(r, 3000))]);
    const mapa = await secoesLidas(uf, mun);
    const secoes = [...mapa.values()].sort((a, b) => `${a.zona}${a.secao}`.localeCompare(`${b.zona}${b.secao}`));
    const municipios = await config(uf).catch(() => []);
    const info = municipios.find((m) => m.codigo === mun);
    return {
      uf, municipio: mun, nome: info?.nome ?? null, totalSecoes: info?.secoes.length ?? null,
      progresso: await progresso(job),
      resumo: agregarResumos(secoes),
      secoes: secoes.map(({ hist, porHora, ...s }) => s),
    };
  }

  /** Municípios da UF com o agregado das seções já lidas. `por` inicia uma amostra da UF. */
  async function estado(uf, { por = 0 } = {}) {
    const municipios = await config(uf);
    const job = por ? iniciar(`amostra:${uf}:${por}`, { uf, por }) : [...jobs.values()].find((j) => j.uf === uf && !j.mun);
    // Inclui municípios lidos em sessões anteriores (arquivos em disco).
    try {
      for (const f of await readdir(join(pasta, pleito, uf))) if (f.endsWith('.json')) await secoesLidas(uf, f.slice(0, -5));
    } catch { /* nada lido ainda */ }
    const lista = [];
    const todas = [];
    for (const m of municipios) {
      const mapa = lidas.get(`${uf}/${m.codigo}`);
      const secoes = mapa ? [...mapa.values()] : [];
      todas.push(...secoes);
      const { hist, porHora, ...resumo } = agregarResumos(secoes);
      lista.push({ codigo: m.codigo, nome: m.nome, totalSecoes: m.secoes.length, lidas: secoes.length, resumo: secoes.length ? resumo : null });
    }
    return { uf, progresso: await progresso(job), resumo: agregarResumos(todas), municipios: lista };
  }

  /** Agregado por UF de tudo que já foi lido (do disco e da memória). */
  async function brasil(ufs) {
    const estados = [];
    for (const uf of ufs) {
      let arquivos = [];
      try { arquivos = (await readdir(join(pasta, pleito, uf))).filter((f) => f.endsWith('.json')); } catch { /* nada lido */ }
      const secoes = [];
      for (const f of arquivos) secoes.push(...(await secoesLidas(uf, f.slice(0, -5))).values());
      for (const [k, mapa] of lidas) if (k.startsWith(`${uf}/`) && !arquivos.includes(`${k.split('/')[1]}.json`)) secoes.push(...mapa.values());
      if (secoes.length) {
        const { hist, porHora, ...resumo } = agregarResumos(secoes);
        estados.push({ uf, resumo });
      }
    }
    return { estados };
  }

  return { municipio, estado, brasil, config, lerSecao, jobs };
}
