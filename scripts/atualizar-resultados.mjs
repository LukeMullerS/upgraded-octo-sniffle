#!/usr/bin/env node
// Retrato dos resultados de todas as cidades de um cargo, para o nível "Brasil — todas as
// cidades" abrir na hora (sem baixar milhares de arquivos do TSE a cada consulta, o que numa
// função serverless nunca termina e ainda faz o TSE responder 429).
//
// Gera public/resultados/{eleição}-{cargo}.json no mesmo formato de /api/municipios?uf=todas.
// Só faz sentido depois da totalização: o app usa o retrato apenas quando ele está completo
// (todas as seções totalizadas); antes disso, continua consultando o TSE.
//
// Uso: node scripts/atualizar-resultados.mjs [6257:1 6259:3 …]
// TSE_BASE muda a origem (padrão: https://resultados.tse.jus.br/oficial).

import { mkdir, writeFile } from 'node:fs/promises';
import { ELEICOES, lerMunicipios, resumoVotos, somarResumos, urlMunicipios, urlResultado } from '../public/tse.js';

const BASE = (process.env.TSE_BASE || 'https://resultados.tse.jus.br/oficial').replace(/\/$/, '');
const CONCORRENCIA = Number(process.env.CONCORRENCIA) || 4;
const PADRAO = ['6257:1', '6259:3', '6259:5'];
const SAIDA = new URL('../public/resultados/', import.meta.url);
const CABECALHOS = { 'User-Agent': 'Mozilla/5.0 (VotoLab)', Accept: 'application/json' };

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function retrato(valor) {
  const [ele, cod] = valor.split(':');
  const cargo = ELEICOES[ele]?.cargos.find((c) => String(c.codigo) === cod);
  if (!cargo) throw new Error(`cargo desconhecido: ${valor}`);
  const porUfCargo = !cargo.abrangencias.includes('br');
  const municipiosPorUf = lerMunicipios(await json(urlMunicipios(BASE, ele)));
  const alvos = [];
  for (const uf of cargo.abrangencias.filter((a) => a !== 'br')) for (const m of municipiosPorUf[uf] ?? []) alvos.push({ uf, m });
  const lidos = [];
  const nomes = {};
  let feitos = 0;
  await emLotes(alvos, async ({ uf, m }) => {
    const bruto = await json(urlResultado(BASE, ele, uf, cargo.codigo, m.codigo));
    feitos += 1;
    if (feitos % 500 === 0) console.log(`  ${valor}: ${feitos}/${alvos.length}`);
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
  const completo = lidos.length === alvos.length && lidos.every((l) => l.secoes.total > 0 && l.secoes.totalizadas >= l.secoes.total);
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
  await writeFile(new URL(`${ele}-${cargo.codigo}.json`, SAIDA), JSON.stringify(saida));
  console.log(`gravado public/resultados/${ele}-${cargo.codigo}.json · ${lidos.length}/${alvos.length} cidades · completo: ${completo}`);
}

for (const valor of process.argv.slice(2).length ? process.argv.slice(2) : PADRAO) await retrato(valor);
