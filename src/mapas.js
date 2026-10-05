// Malhas (contornos) do IBGE para os mapas: estados do Brasil, municípios de uma UF ou
// municípios do Brasil inteiro. Fonte: API de malhas v3 do IBGE, em GeoJSON.
//   {base}/paises/BR?intrarregiao=UF            → estados (codarea = código IBGE da UF, 2 dígitos)
//   {base}/paises/BR?intrarregiao=municipio     → municípios (codarea = 7 dígitos)
//   {base}/estados/{código}?intrarregiao=municipio
// As malhas não mudam: cada uma é baixada uma vez, simplificada (coordenadas arredondadas,
// pontos repetidos removidos) e guardada em dados/mapas.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UF_IBGE } from './censo.js';

export const MALHAS_BASE = 'https://servicodados.ibge.gov.br/api/v3/malhas';
const CODIGO_UF = Object.fromEntries(Object.entries(UF_IBGE).map(([cod, uf]) => [uf, cod]));

/** Arredonda as coordenadas (≈ 100 m) e tira pontos repetidos: a malha fica bem menor. */
export function simplificar(geo, casas = 3) {
  const f = 10 ** casas;
  const anel = (pts) => {
    const out = [];
    for (const [x, y] of pts) {
      const p = [Math.round(x * f) / f, Math.round(y * f) / f];
      const u = out[out.length - 1];
      if (!u || u[0] !== p[0] || u[1] !== p[1]) out.push(p);
    }
    return out.length >= 4 ? out : null;
  };
  const poligono = (aneis) => aneis.map(anel).filter(Boolean);
  const features = [];
  for (const ft of geo.features ?? []) {
    const g = ft.geometry;
    if (!g) continue;
    let coords;
    if (g.type === 'Polygon') coords = [poligono(g.coordinates)].filter((p) => p.length);
    else if (g.type === 'MultiPolygon') coords = g.coordinates.map(poligono).filter((p) => p.length);
    else continue;
    if (!coords.length) continue;
    const cod = String(ft.properties?.codarea ?? ft.properties?.CD_MUN ?? ft.properties?.id ?? ft.id ?? '');
    const props = { codarea: cod };
    if (cod.length === 2 && UF_IBGE[cod]) props.uf = UF_IBGE[cod];
    if (cod.length === 7 && UF_IBGE[cod.slice(0, 2)]) props.uf = UF_IBGE[cod.slice(0, 2)];
    features.push({ type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

export function criarMapas({ pasta = 'dados/mapas', base = MALHAS_BASE, buscar = fetch, timeoutMs = 120_000 } = {}) {
  const memoria = new Map();

  async function baixar(url) {
    const res = await buscar(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`IBGE respondeu HTTP ${res.status}`);
    return res.json();
  }

  /**
   * @param {{uf?: string}} pedido  sem uf: estados do Brasil; uf='todas': municípios do Brasil;
   *   uf='sp' etc.: municípios da UF.
   */
  async function malha({ uf } = {}) {
    let chave;
    let caminho;
    if (!uf) { chave = 'brasil-uf'; caminho = 'paises/BR'; }
    else if (uf === 'todas') { chave = 'brasil-municipios'; caminho = 'paises/BR'; }
    else if (CODIGO_UF[uf]) { chave = `uf-${uf}`; caminho = `estados/${CODIGO_UF[uf]}`; }
    else throw new Error('UF sem malha (o exterior não tem mapa)');
    if (memoria.has(chave)) return memoria.get(chave);
    const p = (async () => {
      const arquivo = join(pasta, `${chave}.json`);
      try {
        return JSON.parse(await readFile(arquivo, 'utf8'));
      } catch { /* ainda não baixada */ }
      const intra = chave === 'brasil-uf' ? 'UF' : 'municipio';
      const params = new URLSearchParams({ formato: 'application/vnd.geo+json', intrarregiao: intra, qualidade: 'minima' });
      let bruto;
      try {
        bruto = await baixar(`${base}/${caminho}?${params}`);
      } catch {
        params.delete('qualidade'); // versões da API sem o parâmetro de qualidade
        bruto = await baixar(`${base}/${caminho}?${params}`);
      }
      const geo = simplificar(bruto);
      if (!geo.features.length) throw new Error('o IBGE devolveu uma malha vazia');
      await mkdir(pasta, { recursive: true }).then(() => writeFile(arquivo, JSON.stringify(geo))).catch(() => {});
      return geo;
    })();
    p.catch(() => memoria.delete(chave));
    memoria.set(chave, p);
    return p;
  }

  return { malha };
}
