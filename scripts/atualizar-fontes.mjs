#!/usr/bin/env node
// Gera os retratos (snapshots) das fontes públicas grandes demais para baixar a cada
// consulta, em public/fontes/*.json — um arquivo por fonte, com séries por município
// (código IBGE de 7 dígitos) e por UF, no mesmo formato das séries do Censo:
//
//   * TSE · Perfil do eleitorado 2026 (dados abertos): sexo, idade, escolaridade, estado civil,
//     cor/raça, biometria e deficiência de quem vota, por município. O arquivo oficial tem
//     408 MB; o script baixa só o trecho de cada UF dentro do zip (requisições com Range).
//   * Ministério da Saúde · CNES (API de dados abertos do SUS/DATASUS): unidades básicas de
//     saúde e hospitais por município, também por 10 mil habitantes (população do IBGE).
//
// Uso:  node scripts/atualizar-fontes.mjs [eleitorado|saude]
// Atrás de proxy: NODE_USE_ENV_PROXY=1. A lista de municípios do TSE (para converter o código
// TSE no código IBGE) vem de TSE_CONFIG_URL ou do site de resultados.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';

const SAIDA = new URL('../public/fontes/', import.meta.url);
const ZIP_ELEITORADO = 'https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_eleitorado/perfil_eleitorado_2026.zip';
const CONFIG_TSE = process.env.TSE_CONFIG_URL || 'https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json';
const SAUDE = 'https://apidadosabertos.saude.gov.br/cnes/estabelecimentos';
const POPULACAO = 'https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93?localidades=N6[all]';
const UF_IBGE = { 11: 'ro', 12: 'ac', 13: 'am', 14: 'rr', 15: 'pa', 16: 'ap', 17: 'to', 21: 'ma', 22: 'pi', 23: 'ce', 24: 'rn',
  25: 'pb', 26: 'pe', 27: 'al', 28: 'se', 29: 'ba', 31: 'mg', 32: 'es', 33: 'rj', 35: 'sp', 41: 'pr', 42: 'sc', 43: 'rs',
  50: 'ms', 51: 'mt', 52: 'go', 53: 'df' };

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function comTentativas(fn, n = 6) {
  for (let i = 0; ; i += 1) {
    try { return await fn(); } catch (erro) { if (i >= n - 1) throw erro; await espera(1500 * (i + 1)); }
  }
}
const json = (url) => comTentativas(async () => {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (VotoLab)' }, signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.json();
});

/** Proporção (%) com 2 casas, para os arquivos ficarem pequenos. */
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : null);
const arred = (v, c = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** c) / 10 ** c);

async function gravar(nome, conteudo) {
  await mkdir(SAIDA, { recursive: true });
  await writeFile(new URL(nome, SAIDA), JSON.stringify(conteudo));
  console.log(`gravado public/fontes/${nome}`);
}

// ---------- TSE: perfil do eleitorado ----------

/** Diretório central do zip (no fim do arquivo): nome → {offset, comprimido}. */
async function entradasZip(url) {
  const cab = await comTentativas(() => fetch(url, { method: 'HEAD' }));
  const tamanho = Number(cab.headers.get('content-length'));
  const fim = Buffer.from(await (await comTentativas(() => fetch(url, { headers: { Range: `bytes=${tamanho - 65536}-${tamanho - 1}` } }))).arrayBuffer());
  const i = fim.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = fim.readUInt16LE(i + 10);
  const offDir = fim.readUInt32LE(i + 16);
  let p = offDir - (tamanho - fim.length);
  const out = new Map();
  for (let k = 0; k < n; k += 1) {
    const comp = fim.readUInt32LE(p + 20);
    const nl = fim.readUInt16LE(p + 28);
    const el = fim.readUInt16LE(p + 30);
    const cl = fim.readUInt16LE(p + 32);
    const offset = fim.readUInt32LE(p + 42);
    out.set(fim.subarray(p + 46, p + 46 + nl).toString(), { offset, comp });
    p += 46 + nl + el + cl;
  }
  return out;
}

/** Linhas do CSV de uma entrada do zip, descompactadas em fluxo (sem guardar o arquivo). */
async function* linhasDaEntrada(url, { offset, comp }) {
  const local = Buffer.from(await (await comTentativas(() => fetch(url, { headers: { Range: `bytes=${offset}-${offset + 29}` } }))).arrayBuffer());
  const inicio = offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const res = await comTentativas(() => fetch(url, { headers: { Range: `bytes=${inicio}-${inicio + comp - 1}` } }));
  const fluxo = Readable.fromWeb(res.body).pipe(createInflateRaw());
  const dec = new TextDecoder('latin1');
  let resto = '';
  for await (const pedaco of fluxo) {
    const texto = resto + dec.decode(pedaco, { stream: true });
    const linhas = texto.split('\n');
    resto = linhas.pop();
    for (const l of linhas) yield l;
  }
  if (resto) yield resto;
}

const campos = (linha) => linha.replace(/\r$/, '').split(';').map((c) => c.replace(/^"|"$/g, ''));

/** Idade representativa da faixa: "20 anos" → 20; "30 a 34 anos" → 32; "100 anos ou mais" → 100. */
function idadeDaFaixa(ds) {
  const n = String(ds).match(/\d+/g)?.map(Number) ?? [];
  if (!n.length) return null;
  return n.length >= 2 ? (n[0] + n[1]) / 2 : n[0];
}

async function eleitorado() {
  const config = await json(CONFIG_TSE);
  const ibgeDe = new Map();
  for (const a of config.abr ?? []) for (const m of a.mu ?? []) if (m.cdi) ibgeDe.set(String(m.cd).padStart(5, '0'), String(m.cdi));
  console.log(`municípios TSE→IBGE: ${ibgeDe.size}`);
  const entradas = await entradasZip(ZIP_ELEITORADO);
  const acum = new Map(); // ibge → contagens
  const novo = () => ({ total: 0, mulheres: 0, jovens: 0, idosos: 0, somaIdade: 0, comIdade: 0, superior: 0, analfabeto: 0,
    semFundamental: 0, casados: 0, racaInformada: 0, pretosPardos: 0, biometria: 0, deficiencia: 0 });
  for (const [nome, entrada] of entradas) {
    const uf = nome.match(/_([A-Z]{2})\.csv$/)?.[1];
    if (!uf || uf === 'ZZ') continue; // exterior não tem município do IBGE
    let cab = null;
    let n = 0;
    for await (const linha of linhasDaEntrada(ZIP_ELEITORADO, entrada)) {
      if (!linha.trim()) continue;
      const c = campos(linha);
      if (!cab) { cab = Object.fromEntries(c.map((k, i) => [k, i])); continue; }
      const ibge = ibgeDe.get(c[cab.CD_MUNICIPIO].padStart(5, '0'));
      if (!ibge) continue;
      const q = Number(c[cab.QT_ELEITORES]) || 0;
      if (!q) continue;
      let a = acum.get(ibge);
      if (!a) acum.set(ibge, (a = novo()));
      a.total += q;
      if (c[cab.CD_GENERO] === '4') a.mulheres += q;
      const idade = idadeDaFaixa(c[cab.DS_FAIXA_ETARIA]);
      if (idade !== null) {
        a.somaIdade += idade * q;
        a.comIdade += q;
        if (idade < 25) a.jovens += q;
        if (idade >= 60) a.idosos += q;
      }
      const esc = c[cab.DS_GRAU_ESCOLARIDADE].toUpperCase();
      if (esc === 'SUPERIOR COMPLETO') a.superior += q;
      if (esc === 'ANALFABETO') a.analfabeto += q;
      if (esc === 'ANALFABETO' || esc.startsWith('LÊ E ESCREVE') || esc.startsWith('LE E ESCREVE') || esc === 'ENSINO FUNDAMENTAL INCOMPLETO') a.semFundamental += q;
      if (c[cab.DS_ESTADO_CIVIL].toUpperCase().startsWith('CASADO')) a.casados += q;
      const raca = c[cab.DS_RACA_COR].toUpperCase();
      if (raca && !raca.includes('NÃO INFORMADO') && raca !== '#NULO') {
        a.racaInformada += q;
        if (raca === 'PRETA' || raca === 'PARDA') a.pretosPardos += q;
      }
      a.biometria += Number(c[cab.QT_ELEITORES_BIOMETRIA]) || 0;
      a.deficiencia += Number(c[cab.QT_ELEITORES_DEFICIENCIA]) || 0;
      n += 1;
    }
    console.log(`${uf}: ${n.toLocaleString('pt-BR')} linhas`);
  }
  // UFs: soma dos municípios.
  const porUf = new Map();
  for (const [ibge, a] of acum) {
    const uf = UF_IBGE[ibge.slice(0, 2)];
    let b = porUf.get(uf);
    if (!b) porUf.set(uf, (b = novo()));
    for (const k of Object.keys(b)) b[k] += a[k];
  }
  const G = 'TSE · Perfil do eleitorado 2026';
  const defs = [
    ['eleitores', 'Eleitores aptos (perfil 2026)', 'eleitores', (a) => a.total],
    ['mulheres', '% de mulheres no eleitorado', '%', (a) => pct(a.mulheres, a.total)],
    ['jovens', '% de eleitores de 16 a 24 anos', '%', (a) => pct(a.jovens, a.comIdade)],
    ['idosos', '% de eleitores com 60 anos ou mais', '%', (a) => pct(a.idosos, a.comIdade)],
    ['idade', 'Idade média do eleitorado (aprox.)', 'anos', (a) => arred(a.comIdade ? a.somaIdade / a.comIdade : null, 1)],
    ['superior', '% do eleitorado com superior completo', '%', (a) => pct(a.superior, a.total)],
    ['analfabetos', '% do eleitorado analfabeto', '%', (a) => pct(a.analfabeto, a.total)],
    ['semFundamental', '% do eleitorado sem fundamental completo', '%', (a) => pct(a.semFundamental, a.total)],
    ['casados', '% de eleitores casados', '%', (a) => pct(a.casados, a.total)],
    ['pretosPardos', '% de pretos e pardos (entre quem informou cor/raça)', '%', (a) => pct(a.pretosPardos, a.racaInformada)],
    ['biometria', '% do eleitorado com biometria', '%', (a) => pct(a.biometria, a.total)],
    ['deficiencia', '% do eleitorado com deficiência declarada', '%', (a) => pct(a.deficiencia, a.total)],
  ];
  await gravar('eleitorado-2026.json', {
    fonte: 'Tribunal Superior Eleitoral — Portal de Dados Abertos, "Eleitorado - 2026" (perfil_eleitorado_2026.zip)',
    url: ZIP_ELEITORADO,
    geradoEm: new Date().toISOString(),
    series: defs.map(([id, nome, unidade, f]) => ({
      id: `tse-${id}`, preset: `arq:eleitorado-2026:${id}`, grupo: G, nome, unidade,
      municipios: Object.fromEntries([...acum].map(([k, a]) => [k, f(a)]).filter(([, v]) => v !== null)),
      ufs: Object.fromEntries([...porUf].map(([k, a]) => [k, f(a)]).filter(([, v]) => v !== null)),
    })),
  });
}

// ---------- Ministério da Saúde: CNES ----------

/** Conta estabelecimentos de um tipo por município (código IBGE de 6 dígitos), página a página. */
async function contarPorMunicipio(tipo) {
  const contagem = new Map();
  const PAG = 20; // a API devolve no máximo 20 por página
  let fim = false;
  let offset = 0;
  const lote = 12;
  while (!fim) {
    const paginas = await Promise.all(Array.from({ length: lote }, (_, i) =>
      json(`${SAUDE}?codigo_tipo_unidade=${tipo}&limit=${PAG}&offset=${offset + i * PAG}`).then((d) => d.estabelecimentos ?? [])));
    for (const p of paginas) {
      for (const e of p) {
        const m = String(e.codigo_municipio ?? '');
        if (m.length === 6) contagem.set(m, (contagem.get(m) ?? 0) + 1);
      }
      if (p.length < PAG) fim = true;
    }
    offset += lote * PAG;
    if (offset % 4000 === 0) process.stdout.write(`  tipo ${tipo}: ${offset.toLocaleString('pt-BR')} lidos\r`);
  }
  console.log(`  tipo ${tipo}: ${[...contagem.values()].reduce((a, b) => a + b, 0).toLocaleString('pt-BR')} estabelecimentos em ${contagem.size} municípios`);
  return contagem;
}

async function saude() {
  // População 2022 (IBGE) para as taxas; os códigos do CNES têm 6 dígitos (sem o verificador).
  const pop = new Map();
  const r = await json(POPULACAO);
  for (const s of r[0].resultados[0].series) pop.set(String(s.localidade.id), Number(s.serie['2022']));
  const de6 = new Map([...pop.keys()].map((k) => [k.slice(0, 6), k]));
  const tipos = { ubs: [1, 2], hospitais: [5, 7], caps: [70] };
  const totais = {};
  for (const [nome, lista] of Object.entries(tipos)) {
    const soma = new Map();
    for (const t of lista) for (const [m, n] of await contarPorMunicipio(t)) soma.set(m, (soma.get(m) ?? 0) + n);
    totais[nome] = new Map([...de6].map(([m6, m7]) => [m7, soma.get(m6) ?? 0]));
  }
  const porUf = (mapa) => {
    const out = {};
    for (const [m, v] of mapa) { const uf = UF_IBGE[m.slice(0, 2)]; out[uf] = (out[uf] ?? 0) + v; }
    return out;
  };
  const popUf = porUf(pop);
  const taxa = (mapa, por = 10_000) => ({
    municipios: Object.fromEntries([...mapa].filter(([m]) => pop.get(m) > 0).map(([m, v]) => [m, arred((v / pop.get(m)) * por, 2)])),
    ufs: Object.fromEntries(Object.entries(porUf(mapa)).map(([u, v]) => [u, arred((v / popUf[u]) * por, 2)])),
  });
  const G = 'Ministério da Saúde · CNES/DATASUS';
  const serie = (id, nome, unidade, dados) => ({ id: `saude-${id}`, preset: `arq:saude-cnes:${id}`, grupo: G, nome, unidade, ...dados });
  await gravar('saude-cnes.json', {
    fonte: 'Ministério da Saúde — API de Dados Abertos do SUS (CNES, estabelecimentos por tipo de unidade); população: IBGE, Censo 2022',
    url: SAUDE,
    geradoEm: new Date().toISOString(),
    series: [
      serie('ubsTaxa', 'Unidades básicas de saúde por 10 mil habitantes', 'por 10 mil hab.', taxa(totais.ubs)),
      serie('hospitaisTaxa', 'Hospitais por 100 mil habitantes', 'por 100 mil hab.', taxa(totais.hospitais, 100_000)),
      serie('capsTaxa', 'CAPS (atenção psicossocial) por 100 mil habitantes', 'por 100 mil hab.', taxa(totais.caps, 100_000)),
      serie('ubs', 'Unidades básicas de saúde (nº)', 'unidades', { municipios: Object.fromEntries(totais.ubs), ufs: porUf(totais.ubs) }),
      serie('hospitais', 'Hospitais gerais e especializados (nº)', 'hospitais', { municipios: Object.fromEntries(totais.hospitais), ufs: porUf(totais.hospitais) }),
    ],
  });
}

/** Índice das séries de todos os retratos (nome, grupo, arquivo), para o catálogo do app. */
async function atualizarIndice() {
  const series = [];
  for (const nome of (await readdir(SAIDA)).sort()) {
    if (!nome.endsWith('.json') || nome === 'indice.json') continue;
    const d = JSON.parse(await readFile(new URL(nome, SAIDA), 'utf8'));
    for (const x of d.series) series.push({ id: x.preset, nome: x.nome, grupo: x.grupo, unidade: x.unidade, arquivo: nome, fonte: d.fonte, geradoEm: d.geradoEm });
  }
  await gravar('indice.json', { series });
}

const qual = process.argv[2];
if (!qual || qual === 'eleitorado') await eleitorado();
if (!qual || qual === 'saude') await saude();
await atualizarIndice();
