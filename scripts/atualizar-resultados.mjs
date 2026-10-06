#!/usr/bin/env node
// Retratos dos resultados de todas as cidades de um cargo (public/resultados/{eleição}-{cargo}.json):
// a "base estática" do site. Com 100% das seções totalizadas, o app lê o retrato em vez de
// consultar o TSE, e todos os usuários usam a mesma cópia. Mesmo formato de
// /api/municipios?uf=todas, compacto (percentuais recalculados no navegador).
//
// O retrato vai sendo montado: cidades já 100% totalizadas num retrato anterior ficam
// congeladas e só as demais são consultadas de novo. No modo --acompanhar, repete a cada 20 s
// (ou o intervalo pedido) até todas as cidades fecharem; é o que se usa na noite da apuração.
//
// Uso:
//   node scripts/atualizar-resultados.mjs                     todos os cargos do 1º turno
//   node scripts/atualizar-resultados.mjs --turno 2           2º turno (Presidente e Governador)
//   node scripts/atualizar-resultados.mjs --turno 2 --acompanhar[=20]   repete até fechar
//   node scripts/atualizar-resultados.mjs 6257:1 6259:3       cargos escolhidos
//   --tudo         ignora o retrato anterior e consulta todas as cidades de novo
//   --max-minutos=N  no modo --acompanhar, para depois de N minutos (ex.: dentro do GitHub Actions)
// Variáveis: TSE_BASE (padrão https://resultados.tse.jus.br/oficial), CONCORRENCIA (padrão 4).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  ELEICOES, compactarRetrato, expandirRetrato, lerMunicipios, resumoVotos, somarResumos, urlMunicipios, urlResultado,
} from '../public/tse.js';
import { cadeirasDoArquivo } from '../public/cadeiras.js';

const BASE = (process.env.TSE_BASE || 'https://resultados.tse.jus.br/oficial').replace(/\/$/, '');
const CONCORRENCIA = Number(process.env.CONCORRENCIA) || 4;
const SAIDA = new URL('../public/resultados/', import.meta.url);
const CABECALHOS = { 'User-Agent': 'Mozilla/5.0 (VotoLab)', Accept: 'application/json' };

/** Cargos com código conhecido de cada turno (o Conselho de Noronha fica de fora: é uma cidade só). */
export function cargosDoTurno(turno) {
  return Object.values(ELEICOES)
    .filter((e) => (e.turno ?? 1) === turno)
    .flatMap((e) => e.cargos.filter((c) => c.codigo !== null).map((c) => `${e.codigo}:${c.codigo}`));
}

export function lerArgumentos(argv) {
  const op = { cargos: [], turno: 1, acompanhar: 0, tudo: false, maxMinutos: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--turno') op.turno = Number(argv[++i]);
    else if (a.startsWith('--turno=')) op.turno = Number(a.slice(8));
    else if (a === '--acompanhar') op.acompanhar = 20;
    else if (a.startsWith('--acompanhar=')) op.acompanhar = Math.max(5, Number(a.slice(13)) || 20);
    else if (a === '--tudo') op.tudo = true;
    else if (a.startsWith('--max-minutos=')) op.maxMinutos = Number(a.slice(14)) || 0;
    else if (/^\d+:\d+$/.test(a)) op.cargos.push(a);
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (![1, 2].includes(op.turno)) throw new Error('--turno deve ser 1 ou 2');
  if (!op.cargos.length) op.cargos = cargosDoTurno(op.turno);
  return op;
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const fechada = (r) => r?.secoes?.total > 0 && r.secoes.totalizadas >= r.secoes.total;

/** JSON do TSE com novas tentativas; respeita 429/503 (o TSE pede para esperar). null = 404. */
async function json(url) {
  for (let i = 0; i < 8; i += 1) {
    try {
      const r = await fetch(url, { headers: CABECALHOS, signal: AbortSignal.timeout(60_000) });
      if (r.status === 404 || r.status === 403) return null;
      if (r.status === 429 || r.status === 503 || r.status === 502) {
        await espera((Number(r.headers.get('retry-after')) || 20) * 1000);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (erro) {
      if (i === 7) throw erro;
      await espera(2000 * (i + 1));
    }
  }
  throw new Error(`sem resposta: ${url}`);
}

async function emLotes(itens, fn) {
  let i = 0;
  const trabalhar = async () => { while (i < itens.length) { const k = i++; await fn(itens[k], k); } };
  await Promise.all(Array.from({ length: CONCORRENCIA }, trabalhar));
}

async function anterior(arquivo) {
  try { return expandirRetrato(JSON.parse(await readFile(arquivo, 'utf8'))); } catch { return null; }
}

/** Uma passada: consulta as cidades ainda abertas e grava o retrato. Devolve se ficou completo. */
async function passada(valor, { tudo }) {
  const [ele, cod] = valor.split(':');
  const eleicao = ELEICOES[ele];
  const cargo = eleicao?.cargos.find((c) => String(c.codigo) === cod);
  if (!cargo) throw new Error(`cargo desconhecido: ${valor}`);
  const arquivo = new URL(`${ele}-${cargo.codigo}.json`, SAIDA);
  const porUfCargo = !cargo.abrangencias.includes('br');
  // A lista de cidades do 2º turno pode demorar a sair: usa a do 1º turno, que é a mesma.
  const config = await json(urlMunicipios(BASE, ele)) ?? (eleicao.primeiroTurno ? await json(urlMunicipios(BASE, eleicao.primeiroTurno)) : null);
  if (!config) throw new Error(`lista de municípios de ${ele} ainda não publicada`);
  const municipiosPorUf = lerMunicipios(config);

  let ufs = cargo.abrangencias.filter((a) => a !== 'br');
  // Antes de pedir milhares de cidades, confere se o resultado já foi publicado: no Brasil
  // (cargos nacionais) ou em cada UF (estaduais; no 2º turno, só os estados com 2º turno têm arquivo).
  if (!porUfCargo) {
    if (!(await json(urlResultado(BASE, ele, 'br', cargo.codigo)))) { console.log(`  ${valor}: resultado ainda não publicado pelo TSE`); return false; }
  } else {
    const tem = await Promise.all(ufs.map(async (uf) => [uf, Boolean(await json(urlResultado(BASE, ele, uf, cargo.codigo)))]));
    ufs = tem.filter(([, ok]) => ok).map(([uf]) => uf);
    if (!ufs.length) { console.log(`  ${valor}: resultado ainda não publicado pelo TSE`); return false; }
  }
  const alvos = ufs.flatMap((uf) => (municipiosPorUf[uf] ?? []).map((m) => ({ uf, m })));

  const antes = tudo ? null : await anterior(arquivo);
  const congeladas = new Map();
  for (const r of antes?.municipios ?? []) if (fechada(r)) congeladas.set(`${r.uf}-${r.codigo}`, r);
  const nomes = { ...(antes?.nomes ?? {}) };
  const lidos = [];
  const abertas = alvos.filter(({ uf, m }) => {
    const r = congeladas.get(`${uf}-${m.codigo}`);
    if (r) lidos.push(r);
    return !r;
  });
  // Retrato anterior já completo e nada aberto: não regrava (evita commits só com a data nova).
  if (antes?.retrato?.completo && !abertas.length && lidos.length === alvos.length) {
    console.log(`  ${valor}: retrato já completo, sem mudanças`);
    return true;
  }
  let feitos = 0;
  await emLotes(abertas, async ({ uf, m }) => {
    const bruto = await json(urlResultado(BASE, ele, uf, cargo.codigo, m.codigo));
    feitos += 1;
    if (feitos % 500 === 0) console.log(`  ${valor}: ${feitos}/${abertas.length}`);
    if (!bruto) return;
    const { nomes: n, ...r } = resumoVotos(bruto);
    // Cargos estaduais no Brasil todo: candidato identificado por UF (o nº 13 de SP ≠ o de BA).
    if (porUfCargo) {
      const cand = {};
      for (const [k, v] of Object.entries(r.cand)) cand[`${uf}:${k}`] = v;
      r.cand = cand;
      for (const [k, x] of Object.entries(n)) nomes[`${uf}:${k}`] = [`${x[0]} · ${uf.toUpperCase()}`, x[1], x[2]];
    } else Object.assign(nomes, n);
    lidos.push({ codigo: m.codigo, nome: m.nome, uf, ibge: m.ibge ?? null, ...r });
  });
  lidos.sort((a, b) => a.uf.localeCompare(b.uf) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const completo = lidos.length === alvos.length && lidos.every(fechada);
  const saida = {
    eleicao: ele, cargo: cargo.codigo, uf: 'todas', total: alvos.length, lidos: lidos.length, lendo: false,
    retrato: { geradoEm: new Date().toISOString(), completo, fonte: `https://resultados.tse.jus.br/oficial/ele2026/${ele}/dados` },
    erro: null,
    consolidado: lidos.length ? somarResumos(lidos.map((l) => ({ ...l, nomes: {} }))) : null,
    municipios: lidos,
    nomes,
  };
  delete saida.consolidado?.nomes;
  await mkdir(SAIDA, { recursive: true });
  await writeFile(arquivo, JSON.stringify(compactarRetrato(saida)));
  const fechadas = lidos.filter(fechada).length;
  console.log(`gravado public/resultados/${ele}-${cargo.codigo}.json · ${lidos.length}/${alvos.length} cidades`
    + ` · ${fechadas} fechadas (${abertas.length} consultadas agora) · completo: ${completo}`);
  return completo;
}

/**
 * Retrato das cadeiras de um cargo proporcional (public/resultados/cadeiras-{eleição}-{cargo}.json):
 * a divisão de vagas e os eleitos de cada UF, para a Câmara dos Deputados (e a soma das
 * assembleias) abrir na hora. Lido dos arquivos de cada UF; completo com 100% das seções.
 */
async function retratoCadeiras(valor) {
  const [ele, cod] = valor.split(':');
  const cargo = ELEICOES[ele]?.cargos.find((c) => String(c.codigo) === cod);
  if (!cargo || cargo.majoritario) return true;
  const arquivo = new URL(`cadeiras-${ele}-${cargo.codigo}.json`, SAIDA);
  try {
    if (JSON.parse(await readFile(arquivo, 'utf8')).retrato?.completo) { console.log(`  cadeiras ${valor}: retrato já completo`); return true; }
  } catch { /* ainda não existe */ }
  const ufs = {};
  for (const uf of cargo.abrangencias.filter((a) => a !== 'br')) {
    const bruto = await json(urlResultado(BASE, ele, uf, cargo.codigo));
    if (bruto) ufs[uf] = cadeirasDoArquivo(bruto, uf);
  }
  const lista = Object.values(ufs);
  const completo = lista.length === cargo.abrangencias.filter((a) => a !== 'br').length
    && lista.every((c) => c.secoes.total > 0 && c.secoes.totalizadas >= c.secoes.total);
  await mkdir(SAIDA, { recursive: true });
  await writeFile(arquivo,
    JSON.stringify({ eleicao: ele, cargo: cargo.codigo, retrato: { geradoEm: new Date().toISOString(), completo }, ufs }));
  const vagas = lista.reduce((t, c) => t + c.vagas, 0);
  console.log(`gravado public/resultados/cadeiras-${ele}-${cargo.codigo}.json · ${lista.length} UFs · ${vagas} vagas · completo: ${completo}`);
  return completo;
}

async function principal() {
  const op = lerArgumentos(process.argv.slice(2));
  const fim = op.maxMinutos ? Date.now() + op.maxMinutos * 60_000 : Infinity;
  let pendentes = [...op.cargos];
  for (;;) {
    const inicio = Date.now();
    const restantes = [];
    for (const valor of pendentes) {
      try {
        const pronto = await passada(valor, op);
        // Deputados: grava também a divisão das cadeiras (provisória até 100%).
        const cadeirasProntas = await retratoCadeiras(valor);
        if (!pronto || !cadeirasProntas) restantes.push(valor);
      } catch (erro) {
        console.log(`  ${valor}: ${erro.message}`);
        restantes.push(valor);
      }
    }
    pendentes = restantes;
    if (!op.acompanhar || !pendentes.length) break;
    if (Date.now() >= fim) { console.log(`parando (limite de ${op.maxMinutos} min); faltam ${pendentes.join(', ')}`); break; }
    await espera(Math.max(0, op.acompanhar * 1000 - (Date.now() - inicio)));
  }
  if (pendentes.length) console.log(`ainda sem 100% das seções: ${pendentes.join(', ')}`);
  else console.log('todos os retratos completos');
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
