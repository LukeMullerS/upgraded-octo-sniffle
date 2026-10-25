#!/usr/bin/env node
// Histórico da apuração do 2º turno (public/historico/2t.json), para a página Projeção desenhar a
// linha de cada candidato no tempo desde o começo da apuração, a mesma para todos os usuários.
//
// A cada passada (de minuto em minuto, durante --minutos) lê os totais do site (/api/estados) e, se a
// apuração andou, acrescenta um ponto: % do eleitorado apurado, votos dos dois candidatos e, para
// Presidente, a projeção do modelo (public/projecao-modelo.js) com o intervalo de 90% e a chance.
// Governador: um histórico por estado com 2º turno (só os votos).
//
// Formato:
//   { atualizado, presidente: { nomes: { a: [nome, partido], b: [...] }, pontos: [{ t, ap, a, b, p, lo, hi, c }] },
//     governador: { uf: { nomes: { a, b }, pontos: [{ t, ap, a, b }] } } }
//   t: ISO (UTC); ap: fração do eleitorado apurada; a, b: votos; p, lo, hi: fatia projetada de "a" (0–1);
//   c: chance de "a" terminar na frente.
//
// Uso: node scripts/historico-apuracao.mjs [--minutos 8] [--a-cada 60]   (SITE_BASE muda o site lido)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { doisDaDisputa, montarUnidades, projetar } from '../public/projecao-modelo.js';

const RAIZ = new URL('..', import.meta.url).pathname;
const ARQUIVO = join(RAIZ, 'public', 'historico', '2t.json');
const SITE = process.env.SITE_BASE ?? 'https://votolab.vercel.app';
const arredondar = (x, casas = 6) => Math.round(x * 10 ** casas) / 10 ** casas;

async function api(caminho) {
  const r = await fetch(`${SITE}/api/${caminho}`);
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}

/** Acrescenta um ponto se a apuração andou desde o último. Exportada para os testes. */
export function acrescentar(pontos, ponto) {
  const u = pontos.at(-1);
  if (u && u.ap === ponto.ap && u.a === ponto.a && u.b === ponto.b) return false;
  pontos.push(ponto);
  return true;
}

async function passada(hist, t1) {
  const [p2, g2] = await Promise.all([api('estados?ele=6258&cargo=1'), api('estados?ele=6260&cargo=3').catch(() => null)]);
  const t = new Date().toISOString();
  let novos = 0;

  // Presidente: totais do Brasil e a projeção com os estados.
  const [a, b] = doisDaDisputa(p2.nomes ?? {}, p2.estados, t1.estados);
  if (a && b && p2.brasil?.eleitorado) {
    const br = p2.brasil;
    const r = projetar({ unidades: montarUnidades({ l2: p2.estados, l1: t1.estados, chave: (x) => x.uf, nome: (x) => x.uf, a, b }), simulacoes: 2000 });
    hist.presidente.nomes = { a: (p2.nomes[a] ?? []).slice(0, 2), b: (p2.nomes[b] ?? []).slice(0, 2) };
    hist.presidente.numeros = { a, b };
    const ponto = { t, ap: arredondar(br.aptosTotalizadas / br.eleitorado), a: br.cand?.[a] ?? 0, b: br.cand?.[b] ?? 0 };
    if (r && ponto.a + ponto.b > 0) Object.assign(ponto, { p: arredondar(r.projecao, 5), lo: arredondar(r.intervalo[0], 5), hi: arredondar(r.intervalo[1], 5), c: arredondar(r.chanceA, 4) });
    if (acrescentar(hist.presidente.pontos, ponto)) novos += 1;
  }

  // Governador: cada estado com 2º turno (chaves "uf:número").
  for (const e of g2?.estados ?? []) {
    if (!e.eleitorado) continue;
    const doEstado = Object.keys(g2.nomes ?? {}).filter((k) => k.startsWith(`${e.uf}:`));
    const [ka, kb] = doEstado.sort((x, y) => (e.cand?.[y] ?? 0) - (e.cand?.[x] ?? 0) || x.localeCompare(y));
    if (!ka || !kb) continue;
    const h = (hist.governador[e.uf] ??= { pontos: [] });
    // A ordem dos dois fica fixa depois do primeiro ponto (a linha de cada um não troca de cor).
    h.numeros ??= { a: ka.split(':')[1], b: kb.split(':')[1] };
    const nome = (n) => {
      const x = g2.nomes[`${e.uf}:${n}`] ?? [];
      return [String(x[0] ?? n).replace(/ · [A-Z]{2}$/, ''), x[1] ?? ''];
    };
    h.nomes = { a: nome(h.numeros.a), b: nome(h.numeros.b) };
    const ponto = { t, ap: arredondar(e.aptosTotalizadas / e.eleitorado), a: e.cand?.[`${e.uf}:${h.numeros.a}`] ?? 0, b: e.cand?.[`${e.uf}:${h.numeros.b}`] ?? 0 };
    if (acrescentar(h.pontos, ponto)) novos += 1;
  }
  hist.atualizado = t;
  return novos;
}

async function principal() {
  const args = process.argv.slice(2);
  const valor = (nome, padrao) => { const i = args.indexOf(nome); return i >= 0 ? Number(args[i + 1]) : padrao; };
  const minutos = valor('--minutos', 0);
  const aCada = valor('--a-cada', 60);
  const hist = JSON.parse(await readFile(ARQUIVO, 'utf8').catch(() => 'null')) ?? { presidente: { pontos: [] }, governador: {} };
  const t1 = await api('estados?ele=6257&cargo=1');
  const fim = Date.now() + minutos * 60_000;
  for (;;) {
    try {
      const novos = await passada(hist, t1);
      await mkdir(dirname(ARQUIVO), { recursive: true });
      await writeFile(ARQUIVO, JSON.stringify(hist));
      const u = hist.presidente.pontos.at(-1);
      console.log(`${new Date().toISOString()} · ${novos} pontos novos${u ? ` · Presidente ${(u.ap * 100).toFixed(2)}% apurado${u.p ? `, projeção ${(u.p * 100).toFixed(1)}%` : ''}` : ''}`);
    } catch (erro) {
      console.error(`falha na passada: ${erro.message}`);
    }
    if (Date.now() + aCada * 1000 > fim) break;
    await new Promise((ok) => { setTimeout(ok, aCada * 1000); });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
