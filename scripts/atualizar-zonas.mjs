#!/usr/bin/env node
// Votos de cada candidato por zona eleitoral de cada cidade (public/zonas/t{turno}/{uf}/{mun}.json),
// para a página "Minha seção" mostrar também a zona inteira, além da seção e da cidade.
//
// Só as cidades com mais de uma zona ganham arquivo (cerca de 190): nas outras (mais de 5.500) a
// zona, dentro da cidade, é a própria cidade, e a página usa o resultado oficial da cidade.
//
// Fonte: TSE, "Votação nominal por município e zona" (dados abertos), um CSV por UF dentro do ZIP
// (o _BR traz Presidente; os das UFs, Governador, Senador e Deputados):
//   https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2026.zip
//
// Formato de cada arquivo (compacto; códigos do TSE):
//   { uf, municipio, nome, turno, zonas: ["0001", ...],
//     cargos: [{ cargo, candidatos: [[número, nome na urna, partido, situação, válido (0/1), [votos por zona]]] }] }
//   Os candidatos vêm do mais para o menos votado na cidade; "votos por zona" segue a ordem de `zonas`.
//   Só votos nominais (o voto na legenda e os brancos e nulos não estão neste arquivo do TSE).
//
// Uso: node scripts/atualizar-zonas.mjs [arquivo.zip] [--turno 1]   (sem arquivo, baixa do TSE)

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createInflateRaw } from 'node:zlib';
import { entradasZip } from '../src/zip.js';
import { campos } from './atualizar-locais.mjs';

const URL_TSE = 'https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/votacao_candidato_munzona_2026.zip';
const RAIZ = new URL('..', import.meta.url).pathname;
const SAIDA = join(RAIZ, 'public', 'zonas');
const pad = (v, n) => String(v).padStart(n, '0');

/** Linhas do CSV (latin1) de uma entrada do ZIP, descomprimidas em fluxo. */
function linhasDa(entrada) {
  const bruto = Readable.from([Buffer.from(entrada.bruto)]);
  const fluxo = entrada.metodo === 0 ? bruto : bruto.pipe(createInflateRaw());
  fluxo.setEncoding('latin1');
  return createInterface({ input: fluxo, crlfDelay: Infinity });
}

/**
 * Soma as linhas de um CSV em `cidades` ({ "uf/mun": { nome, zonas: Set, cargos: Map } }).
 * Só o turno pedido. Exportada para os testes.
 */
export async function somarCsv(linhas, cidades, turno = 1) {
  let i = null;
  for await (const linha of linhas) {
    if (!linha) continue;
    const c = campos(linha);
    if (!i) { i = Object.fromEntries(c.map((nome, k) => [nome, k])); continue; }
    if (Number(c[i.NR_TURNO]) !== turno) continue;
    const uf = String(c[i.SG_UF]).toLowerCase();
    const mun = pad(c[i.CD_MUNICIPIO], 5);
    const zona = pad(c[i.NR_ZONA], 4);
    const cargo = Number(c[i.CD_CARGO]);
    const cid = (cidades[`${uf}/${mun}`] ??= { uf, mun, nome: c[i.NM_MUNICIPIO], zonas: new Set(), cargos: new Map() });
    cid.zonas.add(zona);
    let cands = cid.cargos.get(cargo);
    if (!cands) { cands = new Map(); cid.cargos.set(cargo, cands); }
    const numero = Number(c[i.NR_CANDIDATO]);
    let cand = cands.get(numero);
    if (!cand) {
      cand = { numero, nome: c[i.NM_URNA_CANDIDATO], partido: c[i.SG_PARTIDO], situacao: c[i.DS_SIT_TOT_TURNO],
        valido: /^v[aá]lido/i.test(c[i.NM_TIPO_DESTINACAO_VOTOS] ?? '') ? 1 : 0, porZona: new Map() };
      cands.set(numero, cand);
    }
    cand.porZona.set(zona, (cand.porZona.get(zona) ?? 0) + (Number(c[i.QT_VOTOS_NOMINAIS]) || 0));
  }
}

/** Cidade somada → JSON compacto. Exportada para os testes. */
export function compactar(cid, turno = 1) {
  const zonas = [...cid.zonas].sort();
  const cargos = [...cid.cargos.entries()].sort((a, b) => a[0] - b[0]).map(([cargo, cands]) => ({
    cargo,
    candidatos: [...cands.values()]
      .map((x) => ({ x, total: [...x.porZona.values()].reduce((t, v) => t + v, 0) }))
      .filter(({ total }) => total > 0)
      .sort((a, b) => b.total - a.total || a.x.numero - b.x.numero)
      .map(({ x }) => [x.numero, x.nome, x.partido, x.situacao, x.valido, zonas.map((z) => x.porZona.get(z) ?? 0)]),
  }));
  return { uf: cid.uf, municipio: cid.mun, nome: cid.nome, turno, zonas, cargos };
}

async function principal() {
  const args = process.argv.slice(2);
  const iTurno = args.indexOf('--turno');
  const turno = iTurno >= 0 ? Number(args[iTurno + 1]) : 1;
  const arquivo = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--turno');
  const bytes = arquivo ? await readFile(arquivo) : Buffer.from(await (await fetch(URL_TSE)).arrayBuffer());
  // Um CSV por UF (o _BR é o de Presidente); o _BRASIL junta todos e é pulado.
  const entradas = entradasZip(new Uint8Array(bytes)).filter((e) => /_(?:[A-Z]{2})\.csv$/i.test(e.nome));
  const cidades = {};
  for (const e of entradas) {
    const antes = Object.keys(cidades).length;
    await somarCsv(linhasDa(e), cidades, turno);
    console.log(`${e.nome}: ${Object.keys(cidades).length - antes} cidades novas`);
  }
  const pasta = join(SAIDA, `t${turno}`);
  await rm(pasta, { recursive: true, force: true });
  let bytesTotal = 0;
  let n = 0;
  for (const cid of Object.values(cidades)) {
    if (cid.zonas.size < 2) continue;
    const texto = JSON.stringify(compactar(cid, turno));
    bytesTotal += texto.length;
    n += 1;
    await mkdir(join(pasta, cid.uf), { recursive: true });
    await writeFile(join(pasta, cid.uf, `${cid.mun}.json`), texto);
  }
  console.log(`public/zonas/t${turno} gerada · ${n} cidades com mais de uma zona (de ${Object.keys(cidades).length}) · ${(bytesTotal / 1e6).toFixed(1)} MB`);
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
