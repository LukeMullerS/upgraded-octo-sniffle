#!/usr/bin/env node
// Locais de votação de cada cidade (public/locais/{uf}/{mun}.json), para o mapa descer da cidade
// à zona eleitoral e ao local de votação: o TSE não publica contornos de seção, mas publica onde
// fica cada local (latitude e longitude) e quais seções votam nele.
//
// Fonte: TSE, "Eleitorado por local de votação" (dados abertos), um CSV por UF dentro do ZIP:
//   https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip
//
// Formato de cada arquivo (compacto; códigos do TSE):
//   { uf, municipio, nome, locais: [[zona, número, nome, bairro, endereço, lat, lon, eleitores, [seções]]],
//     agregadas: { "zona-seção": "zona-seção principal" } }
//   lat/lon com 5 casas (~1 m); null quando o TSE não informa a posição.
//
// Uso: node scripts/atualizar-locais.mjs [arquivo.zip]   (sem arquivo, baixa do TSE)

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { entradasZip } from '../src/zip.js';

const URL_TSE = 'https://cdn.tse.jus.br/estatistica/sead/odsele/eleitorado_locais_votacao/eleitorado_local_votacao_2026.zip';
const RAIZ = new URL('..', import.meta.url).pathname;
const SAIDA = join(RAIZ, 'public', 'locais');

/** Divide uma linha do CSV do TSE (";" e aspas). */
export function campos(linha) {
  const out = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i += 1; } else if (ch === '"') aspas = false; else atual += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ';') { out.push(atual); atual = ''; } else atual += ch;
  }
  out.push(atual);
  return out;
}

const coordenada = (t) => {
  const n = Number(String(t ?? '').replace(',', '.'));
  // O TSE usa -1 ou 0 quando não tem a posição.
  return Number.isFinite(n) && n !== 0 && n !== -1 ? Math.round(n * 1e5) / 1e5 : null;
};
const pad = (v, n) => String(v).padStart(n, '0');

/** Linhas de um CSV de UF → { "mun": { nome, locais: Map, agregadas } }. Exportada para os testes. */
export function lerCsv(texto) {
  const linhas = texto.split(/\r?\n/);
  const cab = campos(linhas[0]);
  const i = Object.fromEntries(cab.map((c, k) => [c, k]));
  const cidades = {};
  for (let n = 1; n < linhas.length; n += 1) {
    if (!linhas[n]) continue;
    const c = campos(linhas[n]);
    const mun = pad(c[i.CD_MUNICIPIO], 5);
    const zona = pad(c[i.NR_ZONA], 4);
    const secao = pad(c[i.NR_SECAO], 4);
    const cid = (cidades[mun] ??= { nome: c[i.NM_MUNICIPIO], uf: String(c[i.SG_UF]).toLowerCase(), locais: new Map(), agregadas: {} });
    const principal = Number(c[i.NR_SECAO_PRINCIPAL]);
    if (principal > 0 && principal !== Number(c[i.NR_SECAO])) cid.agregadas[`${zona}-${secao}`] = `${zona}-${pad(principal, 4)}`;
    const chave = `${zona}-${c[i.NR_LOCAL_VOTACAO]}`;
    let local = cid.locais.get(chave);
    if (!local) {
      local = [zona, Number(c[i.NR_LOCAL_VOTACAO]), c[i.NM_LOCAL_VOTACAO], c[i.NM_BAIRRO], c[i.DS_ENDERECO],
        coordenada(c[i.NR_LATITUDE]), coordenada(c[i.NR_LONGITUDE]), 0, []];
      cid.locais.set(chave, local);
    }
    // O TSE repete a seção em mais de uma linha (uma por turno): eleitores contados uma vez só.
    if (local[8].includes(secao)) continue;
    local[7] += Number(c[i.QT_ELEITOR_SECAO]) || 0;
    local[8].push(secao);
  }
  return cidades;
}

async function principal() {
  const arquivo = process.argv[2];
  const bytes = arquivo ? await readFile(arquivo) : Buffer.from(await (await fetch(URL_TSE)).arrayBuffer());
  await rm(SAIDA, { recursive: true, force: true });
  let nCidades = 0;
  let nLocais = 0;
  let semPosicao = 0;
  for (const e of entradasZip(new Uint8Array(bytes))) {
    // Um CSV por UF; o _BRASIL.csv repete todos (426 MB) e fica de fora.
    if (!/_[A-Z]{2}\.csv$/i.test(e.nome)) continue;
    const cidades = lerCsv(new TextDecoder('latin1').decode(e.ler()));
    for (const [mun, c] of Object.entries(cidades)) {
      const locais = [...c.locais.values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
      for (const l of locais) { l[8].sort(); if (l[5] === null || l[6] === null) semPosicao += 1; }
      await mkdir(join(SAIDA, c.uf), { recursive: true });
      await writeFile(join(SAIDA, c.uf, `${mun}.json`), JSON.stringify({ uf: c.uf, municipio: mun, nome: c.nome, locais, agregadas: c.agregadas }));
      nCidades += 1;
      nLocais += locais.length;
    }
    console.log(`${e.nome}: ${Object.keys(cidades).length} cidades`);
  }
  console.log(`public/locais gerada · ${nCidades} cidades · ${nLocais} locais de votação · ${semPosicao} sem posição`);
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
