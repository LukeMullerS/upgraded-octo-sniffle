// Outras fontes de dados públicos para cruzar com a eleição:
//
// * IPEA (Ipeadata, API OData v4): séries do Atlas do Desenvolvimento Humano por município
//   e UF — IDHM e componentes, Gini, renda per capita, pobreza, esperança de vida.
//     {base}/ValoresSerie(SERCODIGO='ADH_IDHM')
//     → { value: [{ VALDATA, VALVALOR, NIVNOME: 'Municípios'|'Estados', TERCODIGO }] }
// * IBGE Localidades: a divisão regional de cada município (meso e microrregião, regiões
//   geográficas intermediária e imediata), para agrupar e comparar cidades vizinhas.
//     https://servicodados.ibge.gov.br/api/v1/localidades/municipios
//
// Como no Censo, cada série é baixada uma vez e guardada em disco (dados/fontes).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UF_IBGE } from './censo.js';

export const IPEA_BASE = 'http://www.ipeadata.gov.br/api/odata4';
export const LOCALIDADES_BASE = 'https://servicodados.ibge.gov.br/api/v1/localidades';

const ATLAS = 'IPEA · Atlas do Desenvolvimento Humano (2010)';
export const SERIES_IPEA = [
  { id: 'idhm', codigo: 'ADH_IDHM', nome: 'IDHM (2010)', unidade: 'índice', grupo: ATLAS },
  { id: 'idhmE', codigo: 'ADH_IDHM_E', nome: 'IDHM Educação (2010)', unidade: 'índice', grupo: ATLAS },
  { id: 'idhmL', codigo: 'ADH_IDHM_L', nome: 'IDHM Longevidade (2010)', unidade: 'índice', grupo: ATLAS },
  { id: 'idhmR', codigo: 'ADH_IDHM_R', nome: 'IDHM Renda (2010)', unidade: 'índice', grupo: ATLAS },
  { id: 'gini', codigo: 'ADH_GINI', nome: 'Índice de Gini da renda (2010)', unidade: 'índice', grupo: ATLAS },
  { id: 'renda', codigo: 'ADH_RDPC', nome: 'Renda per capita (R$ de 2010)', unidade: 'R$', grupo: ATLAS },
  { id: 'pobres', codigo: 'ADH_PMPOB', nome: '% de pobres (2010)', unidade: '%', grupo: ATLAS },
  { id: 'espvida', codigo: 'ADH_ESPVIDA', nome: 'Esperança de vida ao nascer (2010)', unidade: 'anos', grupo: ATLAS },
];

/** Lê a resposta do Ipeadata: o valor mais recente de cada município (7 dígitos) e UF (2 dígitos). */
export function lerIpea(resposta) {
  const municipios = {};
  const ufs = {};
  const datas = {};
  for (const v of resposta?.value ?? []) {
    const valor = Number(v.VALVALOR);
    const cod = String(v.TERCODIGO ?? '').trim();
    if (!Number.isFinite(valor) || !cod) continue;
    const data = String(v.VALDATA ?? '');
    if (datas[cod] && datas[cod] > data) continue; // fica o mais recente
    datas[cod] = data;
    const nivel = String(v.NIVNOME ?? '');
    if (/munic/i.test(nivel) && cod.length === 7) municipios[cod] = valor;
    else if (/estad/i.test(nivel) && UF_IBGE[cod]) ufs[UF_IBGE[cod]] = valor;
  }
  return { municipios, ufs };
}

/** Lê a lista de municípios do IBGE: código IBGE → divisão regional. */
export function lerLocalidades(lista) {
  const out = {};
  for (const m of lista ?? []) {
    const micro = m.microrregiao;
    const imediata = m['regiao-imediata'];
    out[String(m.id)] = {
      meso: micro?.mesorregiao?.nome ?? null,
      micro: micro?.nome ?? null,
      intermediaria: imediata?.['regiao-intermediaria']?.nome ?? null,
      imediata: imediata?.nome ?? null,
    };
  }
  return out;
}

export function criarFontes({ pasta = 'dados/fontes', buscar = fetch, timeoutMs = 120_000, ipea = IPEA_BASE, localidades = LOCALIDADES_BASE } = {}) {
  const memoria = new Map();

  async function getJson(url) {
    const res = await buscar(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** Baixa uma vez (memória + disco); falhas não ficam guardadas. */
  function guardado(chave, baixar) {
    if (!memoria.has(chave)) {
      const p = (async () => {
        const arquivo = join(pasta, `${chave}.json`);
        try {
          return JSON.parse(await readFile(arquivo, 'utf8'));
        } catch { /* ainda não baixada */ }
        const r = await baixar();
        await mkdir(pasta, { recursive: true }).then(() => writeFile(arquivo, JSON.stringify(r))).catch(() => {});
        return r;
      })();
      p.catch(() => memoria.delete(chave));
      memoria.set(chave, p);
    }
    return memoria.get(chave);
  }

  /** Série do Ipeadata no mesmo formato das séries do Censo. */
  function serieIpea(id) {
    const s = SERIES_IPEA.find((x) => x.id === id);
    if (!s) return Promise.reject(new Error('série desconhecida'));
    return guardado(`ipea-${s.codigo}`, async () => {
      let bruto;
      try {
        bruto = await getJson(`${ipea}/ValoresSerie(SERCODIGO='${s.codigo}')`);
      } catch (erro) {
        throw new Error(`Ipeadata: ${erro.message}`);
      }
      const { municipios, ufs } = lerIpea(bruto);
      if (!Object.keys(municipios).length && !Object.keys(ufs).length) throw new Error(`o Ipeadata não devolveu valores para ${s.codigo}`);
      return { id: `ipea-${s.codigo}`, preset: `ipea:${s.id}`, nome: s.nome, unidade: s.unidade, grupo: s.grupo, fonte: 'Ipeadata', municipios, ufs };
    });
  }

  /** Divisão regional de todos os municípios. */
  function regioes() {
    return guardado('ibge-localidades', async () => {
      const r = lerLocalidades(await getJson(`${localidades}/municipios`));
      if (!Object.keys(r).length) throw new Error('o IBGE não devolveu a lista de municípios');
      return r;
    });
  }

  return { serieIpea, regioes };
}
