#!/usr/bin/env node
// Base estática dos logs das urnas (public/urnas): tempo de votação, biometria e horários,
// compilados uma vez e servidos a todos os usuários como arquivos, sem que o site precise
// baixar e abrir logs do TSE a cada visita (o que uma função serverless nem consegue fazer).
//
// Lê o log de cada seção (aux.json → .logjez → logd.dat → resumo), guarda o resumo por cidade em
// dados/urnas-retrato/{uf}/{mun}.json (retoma de onde parou) e gera, no formato das rotas
// /api/urnas/*:
//   public/urnas/nacional.json         progresso (seções lidas e total por UF)
//   public/urnas/brasil.json           agregado por UF e do Brasil
//   public/urnas/estado-{uf}.json      cidades da UF com o agregado de cada uma
//   public/urnas/municipios.json       resumo de todas as cidades lidas (Análises e mapas)
//   public/urnas/municipio/{uf}/{mun}.json   seções da cidade
//
// Uso:
//   node scripts/atualizar-urnas.mjs [--ufs=rr,ap] [--amostra=N] [--concorrencia=6] [--so-gerar]
//   --amostra=N   lê até N seções por cidade, espalhadas (padrão: todas)
//   --so-gerar    não baixa nada: só gera public/urnas a partir de dados/urnas-retrato
//   --so-baixar   só baixa (para dados/urnas-retrato), sem gerar public/urnas
//   --concorrencia=N, --concorrencia-max=N   downloads simultâneos no início (8) e no máximo (96):
//                 entre os dois, o script se ajusta sozinho ao que o TSE aguenta (recua a qualquer 429/5xx)
//   --ritmo=N     teto opcional de seções por minuto (padrão: sem teto, só o ajuste automático)
//   --max-minutos=N  para de baixar depois de N minutos (a próxima execução continua de onde parou)
//   --turno=2     logs do 2º turno (eleição de referência 6258)
//
// Os logs não mudam depois de publicados, como o resultado: cada seção é baixada uma vez só, e
// só nas cidades com 100% das seções totalizadas (segundo o retrato de public/resultados ou,
// sem ele, o resumo do TSE). No dia da apuração, uma cidade entra assim que fecha.
//   (no GitHub Actions, cada UF roda num job e o último junta tudo com --so-gerar)
// Variáveis: TSE_BASE (padrão https://resultados.tse.jus.br/oficial).

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { amostrar, criarColetorLogs, ORDEM_UFS } from '../src/logs.js';
import { acumular, finalizar, juntar, novoAcumulador } from '../src/log-urna.js';
import { lerMunicipios } from '../public/tse.js';

const BASE = (process.env.TSE_BASE || 'https://resultados.tse.jus.br/oficial').replace(/\/$/, '');
const RAIZ = new URL('..', import.meta.url).pathname;
// Cada turno tem a sua base: public/urnas (1º) e public/urnas/2t (2º).
const pastaCache = (turno) => join(RAIZ, 'dados', 'urnas-retrato', ...(turno === 2 ? ['2t'] : []));
const pastaSaida = (turno) => join(RAIZ, 'public', 'urnas', ...(turno === 2 ? ['2t'] : []));
const CABECALHOS = { 'User-Agent': 'Mozilla/5.0 (VotoLab)' };
// Pleito dos arquivos das urnas: 3220 no 1º turno; no 2º, 3221 (o número que falta na lista do TSE
// em comum/config/ele-c.json, como 452/453 em 2024). PLEITO=… muda, se o TSE publicar outro.
export const pleitoDoTurno = (turno) => process.env.PLEITO || (turno === 2 ? '3221' : '3220');

export function lerArgumentos(argv) {
  const op = { ufs: ORDEM_UFS, amostra: 0, concorrencia: 8, concorrenciaMax: 96, soGerar: false, soBaixar: false, ritmo: 0, maxMinutos: 0, turno: 1 };
  for (const a of argv) {
    if (a.startsWith('--ufs=')) op.ufs = a.slice(6).split(',').map((u) => u.trim().toLowerCase()).filter((u) => ORDEM_UFS.includes(u));
    else if (a.startsWith('--amostra=')) op.amostra = Math.max(0, Number(a.slice(10)) || 0);
    else if (a.startsWith('--concorrencia=')) op.concorrencia = Math.max(1, Number(a.slice(15)) || 8);
    else if (a.startsWith('--concorrencia-max=')) op.concorrenciaMax = Math.max(1, Number(a.slice(19)) || 96);
    else if (a === '--so-gerar') op.soGerar = true;
    else if (a === '--so-baixar') op.soBaixar = true;
    else if (a.startsWith('--ritmo=')) op.ritmo = Math.max(0, Number(a.slice(8)) || 0);
    else if (a.startsWith('--max-minutos=')) op.maxMinutos = Math.max(0, Number(a.slice(14)) || 0);
    else if (a.startsWith('--turno=')) op.turno = Number(a.slice(8));
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!op.ufs.length) throw new Error('nenhuma UF válida em --ufs');
  if (![1, 2].includes(op.turno)) throw new Error('--turno deve ser 1 ou 2');
  return op;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const mediana = (v) => { const o = [...v].sort((a, b) => a - b); return o.length ? o[o.length >> 1] : null; };

/**
 * Controle adaptativo da concorrência, para ficar logo abaixo do limite do TSE sem conhecê-lo:
 * a cada janela sem sinais de limite (429/5xx, timeouts) e sem lentidão, abre mais `passo`
 * downloads; a qualquer sinal, corta pela metade (no máximo um corte a cada 5 s) e respeita o
 * Retry-After; se a resposta fica muito mais lenta que a melhor já vista, recua 25%.
 */
export function criarControle({ inicial = 8, maximo = 96, minimo = 2, passo = 4, janelaMs = 20_000, agora = () => Date.now(), relatar = () => {} } = {}) {
  const c = { alvo: Math.min(maximo, inicial), ok: 0, falhas: 0, lat: [], base: null, pausaAte: 0, inicio: agora(), ultimoCorte: -Infinity };
  const fecharJanela = (t) => {
    const minutos = (t - c.inicio) / 60_000;
    relatar({ alvo: c.alvo, porMinuto: minutos > 0 ? Math.round(c.ok / minutos) : 0, falhas: c.falhas, latencia: mediana(c.lat) });
    c.ok = 0; c.falhas = 0; c.lat = []; c.inicio = t;
  };
  return {
    get alvo() { return c.alvo; },
    get pausaAte() { return c.pausaAte; },
    sucesso(ms) {
      c.ok += 1; c.lat.push(ms);
      const t = agora();
      if (t - c.inicio < janelaMs) return;
      if (!c.falhas && c.lat.length >= 5) {
        const med = mediana(c.lat);
        c.base = c.base === null ? med : Math.min(c.base, med);
        if (med > c.base * 2.5) c.alvo = Math.max(minimo, Math.floor(c.alvo * 0.75));
        else c.alvo = Math.min(maximo, c.alvo + passo);
      }
      fecharJanela(t);
    },
    limite(retrySegundos = 0) {
      const t = agora();
      c.falhas += 1;
      if (retrySegundos > 0) c.pausaAte = Math.max(c.pausaAte, t + retrySegundos * 1000);
      if (t - c.ultimoCorte < 5_000) return;
      c.ultimoCorte = t;
      c.alvo = Math.max(minimo, Math.floor(c.alvo / 2));
    },
  };
}

let controle = null; // ligado em coletar()
const REVER_AUSENTES_MS = 24 * 60 * 60_000; // seção sem log é conferida de novo uma vez por dia

/** GET com novas tentativas; 429/5xx/timeouts avisam o controle. null em 404/403. */
async function baixar(caminho, binario) {
  for (let i = 0; i < 6; i += 1) {
    if (controle && controle.pausaAte > Date.now()) await espera(controle.pausaAte - Date.now());
    try {
      const r = await fetch(`${BASE}/${caminho}`, { headers: CABECALHOS, signal: AbortSignal.timeout(60_000) });
      if (r.status === 404 || r.status === 403) return null;
      if (r.status === 429 || r.status >= 500) {
        const retry = Number(r.headers.get('retry-after')) || 0;
        controle?.limite(retry || 5);
        await espera((retry || 5) * 1000 * (i + 1));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return binario ? Buffer.from(await r.arrayBuffer()) : await r.json();
    } catch (erro) {
      controle?.limite(0);
      if (i === 5) throw erro;
      await espera(1500 * (i + 1));
    }
  }
  return null;
}

/** Executa as tarefas com quantos trabalhos simultâneos o controle permitir a cada momento. */
async function piscina(tarefas, fn, fim) {
  let i = 0;
  let ativos = 0;
  await new Promise((pronto) => {
    let timer = null;
    const encher = () => {
      while (ativos < controle.alvo && i < tarefas.length && Date.now() < fim) {
        const t = tarefas[i++];
        ativos += 1;
        fn(t).catch(() => {}).finally(() => { ativos -= 1; encher(); });
      }
      if (!ativos && (i >= tarefas.length || Date.now() >= fim)) { clearInterval(timer); pronto(); }
    };
    timer = setInterval(encher, 1000); // o alvo pode subir sem que nada termine
    encher();
  });
}

async function lerJson(arquivo, padrao) {
  try { return JSON.parse(await readFile(arquivo, 'utf8')); } catch { return padrao; }
}

const semDetalhe = ({ hist, porHora, ...resto }) => resto;

// Seções da cidade em linhas compactas (só o que a página usa; 1 casa decimal): cerca de 70
// bytes por seção em vez de 560, para a base do Brasil inteiro caber no site. A página expande
// de volta (expandirSecoes em public/comum.js).
export const COLUNAS_SECAO = ['zona', 'secao', 'votos', 'cabine', 'mediana', 'p90', 'atendimento', 'biometrica', 'primeiroVoto', 'ultimoVoto', 'modelo', 'bateria'];
const uma = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
export const linhaSecao = (r) => [r.zona, r.secao, r.votos, uma(r.cabine?.media), uma(r.cabine?.mediana), uma(r.cabine?.p90), uma(r.atendimento?.media),
  r.tipos?.biometrica ?? 0, r.primeiroVoto ?? null, r.ultimoVoto ?? null, r.modelo ?? null, r.bateria ?? 0];

/** Ritmo: no máximo `porMinuto` seções iniciadas por minuto (0 = sem limite). */
export function criarRitmo(porMinuto, agora = () => Date.now()) {
  const intervalo = porMinuto > 0 ? 60_000 / porMinuto : 0;
  let proximo = 0;
  return async () => {
    if (!intervalo) return;
    const t = agora();
    const vez = Math.max(t, proximo);
    proximo = vez + intervalo;
    if (vez > t) await espera(vez - t);
  };
}

/**
 * Cidades com 100% das seções totalizadas ("uf/código" → true). Primeiro o retrato estático de
 * public/resultados (Presidente, que tem todas as cidades e o exterior); sem ele, o resumo do TSE.
 */
async function cidadesFechadas(uf, turno, configUf) {
  const ref = turno === 2 ? '6258' : '6257';
  const retrato = await lerJson(join(RAIZ, 'public', 'resultados', `${ref}-1.json`), null);
  const fechadas = new Set();
  if (retrato?.municipios?.length) {
    for (const m of retrato.municipios) if (m.uf === uf && m.secoes?.total > 0 && m.secoes.totalizadas >= m.secoes.total) fechadas.add(m.codigo);
    if (fechadas.size || retrato.retrato?.completo) return fechadas;
  }
  const ab = await baixar(`ele2026/${ref}/dados/${uf}/${uf}-e${ref.padStart(6, '0')}-ab.json`, false).catch(() => null);
  const total = new Map(configUf.map((m) => [m.codigo, m.secoes.length]));
  for (const a of ab?.abr ?? []) {
    if (a.tpabr && a.tpabr !== 'mun') continue;
    const codigo = String(a.cdabr).padStart(5, '0');
    const st = Number(String(a.s?.st ?? '0').replace(/\D/g, '')) || 0;
    if (total.get(codigo) && st >= total.get(codigo)) fechadas.add(codigo);
  }
  return fechadas;
}

/**
 * Baixa as seções que faltam nas cidades já fechadas das UFs pedidas, numa fila única por UF,
 * com a concorrência ajustada sozinha ao que o TSE aguenta (e, se pedido, um teto de ritmo).
 */
async function coletar(op) {
  const CACHE = pastaCache(op.turno);
  controle = criarControle({
    inicial: op.concorrencia, maximo: op.concorrenciaMax,
    relatar: (j) => console.log(`  concorrência ${j.alvo} · ${j.porMinuto} seções/min · latência ${j.latencia ?? '—'} ms${j.falhas ? ` · ${j.falhas} sinal(is) de limite` : ''}`),
  });
  const coletor = criarColetorLogs({
    buscarJson: (c) => baixar(c, false), buscarBinario: (c) => baixar(c, true), pleito: pleitoDoTurno(op.turno), pasta: join(CACHE, '.coletor'), automatico: false,
  });
  const ritmo = criarRitmo(op.ritmo);
  let novasTotal = 0;
  const fim = op.maxMinutos ? Date.now() + op.maxMinutos * 60_000 : Infinity;
  for (const uf of op.ufs) {
    if (Date.now() >= fim) break;
    let municipios;
    try { municipios = await coletor.config(uf); } catch (erro) { console.log(`${uf}: ${erro.message}`); continue; }
    await mkdir(join(CACHE, uf), { recursive: true });
    await writeFile(join(CACHE, uf, '_config.json'), JSON.stringify(municipios.map((m) => ({ codigo: m.codigo, nome: m.nome, total: m.secoes.length }))));
    const fechadas = await cidadesFechadas(uf, op.turno, municipios);
    // Fila única da UF: todas as seções pendentes das cidades fechadas.
    const salvos = new Map();
    const tarefas = [];
    const agora = Date.now();
    let lidasUf = 0;
    let puladas = 0;
    for (const m of municipios) {
      const salvo = await lerJson(join(CACHE, uf, `${m.codigo}.json`), { secoes: {} });
      salvos.set(m.codigo, { m, salvo, sujo: false });
      lidasUf += Object.keys(salvo.secoes).length;
      if (!fechadas.has(m.codigo)) continue; // apuração da cidade ainda aberta: os logs ficam para depois
      const alvo = op.amostra ? amostrar(m.secoes, op.amostra) : m.secoes;
      salvo.ausentes ??= {};
      for (const sec of alvo) {
        const k = `${sec.zona}-${sec.secao}`;
        if (salvo.secoes[k]) continue;
        // Seção sem log no TSE (agregada a outra urna, sem arquivos…): não pergunta de novo por 24 h.
        if (agora - (salvo.ausentes[k] ?? 0) < REVER_AUSENTES_MS) { puladas += 1; continue; }
        tarefas.push({ m, sec });
      }
    }
    const gravar = async () => {
      for (const [codigo, x] of salvos) {
        if (!x.sujo) continue;
        x.sujo = false;
        await writeFile(join(CACHE, uf, `${codigo}.json`), JSON.stringify({ uf, municipio: codigo, nome: x.m.nome, total: x.m.secoes.length, secoes: x.salvo.secoes, ausentes: x.salvo.ausentes }));
      }
    };
    let novasUf = 0;
    let semLogUf = 0;
    const gravacao = setInterval(() => { gravar().catch(() => {}); }, 30_000); // progresso no disco a cada 30 s
    await piscina(tarefas, async ({ m, sec }) => {
      await ritmo();
      const t0 = Date.now();
      try {
        const r = await coletor.lerSecao(uf, m.codigo, sec);
        controle.sucesso(Date.now() - t0);
        const x = salvos.get(m.codigo);
        if (r) {
          x.salvo.secoes[`${sec.zona}-${sec.secao}`] = r;
          delete x.salvo.ausentes[`${sec.zona}-${sec.secao}`];
          novasUf += 1;
        } else {
          x.salvo.ausentes[`${sec.zona}-${sec.secao}`] = Date.now(); // cidade já fechada e sem log: anota
          semLogUf += 1;
        }
        x.sujo = true;
      } catch (erro) {
        console.log(`  ${uf}/${m.codigo} ${sec.zona}-${sec.secao}: ${erro.message}`);
      }
    }, fim);
    clearInterval(gravacao);
    await gravar();
    novasTotal += novasUf;
    console.log(`${uf}: ${lidasUf + novasUf} seções lidas (${novasUf} novas)${tarefas.length ? ` · ${tarefas.length} consultadas` : ''}`
      + `${semLogUf ? ` · ${semLogUf} sem log no TSE` : ''}${puladas ? ` · ${puladas} sem log já conhecidas (puladas)` : ''}`
      + ` · ${fechadas.size} de ${municipios.length} cidades com 100% totalizado`);
  }
  if (Date.now() >= fim) console.log(`parando (limite de ${op.maxMinutos} min); a próxima execução continua de onde parou`);
  return novasTotal;
}

/** Código TSE → IBGE das cidades (lista de municípios da eleição federal). */
async function ibgePorTse() {
  const bruto = await baixar('ele2026/6257/config/mun-e006257-cm.json', false).catch(() => null);
  const mapa = new Map();
  for (const [uf, lista] of Object.entries(bruto ? lerMunicipios(bruto) : {})) for (const m of lista) mapa.set(`${uf}/${m.codigo}`, m.ibge ?? null);
  return mapa;
}

/** Gera public/urnas a partir de dados/urnas-retrato (todas as UFs já baixadas). */
async function gerar(turno = 1) {
  const CACHE = pastaCache(turno);
  const SAIDA = pastaSaida(turno);
  const ibge = await ibgePorTse();
  await rm(join(SAIDA, 'municipio'), { recursive: true, force: true });
  await mkdir(join(SAIDA, 'municipio'), { recursive: true });
  const totalBr = novoAcumulador();
  const estados = [];
  const porUf = [];
  const todos = [];
  const geradoEm = new Date().toISOString();
  for (const uf of ORDEM_UFS) {
    const config = await lerJson(join(CACHE, uf, '_config.json'), null);
    if (!config) { porUf.push({ uf, total: null, lidas: 0 }); continue; }
    const accUf = novoAcumulador();
    const cidades = [];
    let lidasUf = 0;
    for (const m of config) {
      const salvo = await lerJson(join(CACHE, uf, `${m.codigo}.json`), null);
      const lista = Object.values(salvo?.secoes ?? {}).sort((a, b) => `${a.zona}${a.secao}`.localeCompare(`${b.zona}${b.secao}`));
      const acc = novoAcumulador();
      for (const r of lista) acumular(acc, r);
      juntar(accUf, acc);
      lidasUf += lista.length;
      const resumo = acc.secoes ? finalizar(acc) : null;
      cidades.push({ codigo: m.codigo, nome: m.nome, totalSecoes: m.total, lidas: lista.length, resumo: resumo ? semDetalhe(resumo) : null, ibge: ibge.get(`${uf}/${m.codigo}`) ?? null });
      if (lista.length) {
        todos.push({ uf, codigo: m.codigo, lidas: lista.length, resumo: semDetalhe(resumo), ibge: ibge.get(`${uf}/${m.codigo}`) ?? null });
        await mkdir(join(SAIDA, 'municipio', uf), { recursive: true });
        await writeFile(join(SAIDA, 'municipio', uf, `${m.codigo}.json`), JSON.stringify({
          uf, municipio: m.codigo, nome: m.nome, totalSecoes: m.total,
          progresso: { lidas: lista.length, total: m.total, lendo: false }, resumo, colunas: COLUNAS_SECAO, linhas: lista.map(linhaSecao), retrato: { geradoEm },
        }));
      }
    }
    const total = config.reduce((t, m) => t + m.total, 0);
    const progresso = { uf, total, lidas: lidasUf };
    porUf.push(progresso);
    await writeFile(join(SAIDA, `estado-${uf}.json`), JSON.stringify({ uf, progresso, resumo: finalizar(accUf), municipios: cidades, retrato: { geradoEm } }));
    if (accUf.secoes) {
      juntar(totalBr, accUf);
      estados.push({ uf, resumo: semDetalhe(finalizar(accUf)) });
    }
  }
  const total = porUf.reduce((t, u) => t + (u.total ?? 0), 0);
  const lidas = porUf.reduce((t, u) => t + u.lidas, 0);
  await writeFile(join(SAIDA, 'brasil.json'), JSON.stringify({ estados, resumo: finalizar(totalBr), retrato: { geradoEm } }));
  await writeFile(join(SAIDA, 'municipios.json'), JSON.stringify({ municipios: todos, retrato: { geradoEm } }));
  await writeFile(join(SAIDA, 'nacional.json'), JSON.stringify({
    ativo: false, pausado: false, lendo: false, ufAtual: null, passadas: 0, novasNaPassada: 0, erros: 0, ultimoErro: null,
    ultimaPassada: geradoEm, proximaEmSegundos: null, total, lidas, porUf, retrato: { geradoEm },
  }));
  console.log(`public/urnas gerada · ${lidas} de ${total} seções · ${todos.length} cidades`);
}

async function principal() {
  const op = lerArgumentos(process.argv.slice(2));
  const novas = op.soGerar ? null : await coletar(op);
  if (op.soBaixar) return;
  // Nada novo e a base já existe: não regera (evita commits só com a data nova).
  if (novas === 0 && await lerJson(join(pastaSaida(op.turno), 'nacional.json'), null)) { console.log('nenhuma seção nova: base mantida'); return; }
  await gerar(op.turno);
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
