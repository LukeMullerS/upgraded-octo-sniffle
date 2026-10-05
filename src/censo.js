// Dados do Censo (IBGE) para cruzar com os resultados das eleições.
//
// Usa a API de agregados do IBGE (a mesma do SIDRA):
//   https://servicodados.ibge.gov.br/api/v3/agregados/{tabela}/metadados
//   https://servicodados.ibge.gov.br/api/v3/agregados/{tabela}/periodos/{período}/variaveis/{variável}
//     ?localidades=N6[all]&classificacao={c}[{categoria}]|...
// N6 = municípios (código IBGE de 7 dígitos), N3 = UFs (código de 2 dígitos).
//
// As séries baixadas ficam em disco (pasta `dados/censo`), porque o Censo não muda: só a
// primeira consulta de cada série depende do IBGE.
//
// Para não depender de códigos de variável escritos à mão, as tabelas pré-configuradas
// escolhem a variável pelo nome nos metadados e usam a categoria "Total" de cada
// classificação (sexo, idade, cor ou raça…).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const IBGE_BASE = 'https://servicodados.ibge.gov.br/api/v3/agregados';

export const UF_IBGE = {
  11: 'ro', 12: 'ac', 13: 'am', 14: 'rr', 15: 'pa', 16: 'ap', 17: 'to', 21: 'ma', 22: 'pi', 23: 'ce', 24: 'rn',
  25: 'pb', 26: 'pe', 27: 'al', 28: 'se', 29: 'ba', 31: 'mg', 32: 'es', 33: 'rj', 35: 'sp', 41: 'pr', 42: 'sc',
  43: 'rs', 50: 'ms', 51: 'mt', 52: 'go', 53: 'df',
};

// Séries pré-configuradas. A variável é achada pelo nome nos metadados (os números de
// variável mudam entre tabelas); `categoria` pega uma categoria de uma classificação (ex.:
// cor ou raça = parda) e, com `percentual`, divide pelo total; `razao` divide uma série por
// outra (ex.: PIB por habitante). Se o IBGE mudar uma tabela, só aquela série falha.
const C22 = 'IBGE · Censo 2022';
export const PRESETS = [
  { id: 'populacao', grupo: C22, nome: 'População residente (Censo 2022)', tabela: '4714', variavel: /popula[cç][aã]o residente/i },
  { id: 'densidade', grupo: C22, nome: 'Densidade demográfica (Censo 2022)', tabela: '4714', variavel: /densidade/i },
  { id: 'area', grupo: C22, nome: 'Área territorial em km² (Censo 2022)', tabela: '4714', variavel: /[aá]rea/i },
  { id: 'alfabetizacao', grupo: C22, nome: 'Taxa de alfabetização, 15 anos ou mais (Censo 2022)', tabela: '9543', variavel: /alfabetiza/i },
  ...[['pardos', /parda/i, 'pardos'], ['pretos', /preta/i, 'pretos'], ['brancos', /branca/i, 'brancos'], ['indigenas', /ind[ií]gena/i, 'indígenas']]
    .map(([id, cat, rotulo]) => ({
      id: `cor_${id}`, grupo: C22, nome: `% de ${rotulo} na população (Censo 2022)`, unidade: '%',
      tabela: '9605', variavel: /popula[cç][aã]o residente/i, categoria: { classificacao: /cor ou ra[cç]a/i, nome: cat }, percentual: true,
    })),
  { id: 'pib', grupo: 'IBGE · PIB dos Municípios', nome: 'PIB a preços correntes (mil R$)', tabela: '5938', variavel: /produto interno bruto a pre[cç]os correntes/i },
  { id: 'pibPerCapita', grupo: 'IBGE · PIB dos Municípios', nome: 'PIB por habitante (R$, aprox.)', unidade: 'R$', razao: { numerador: 'pib', denominador: 'populacao', fator: 1000 } },
  ...[['catolicos', /cat[oó]lica apost[oó]lica romana/i, 'católicos'], ['evangelicos', /evang[eé]lica/i, 'evangélicos'], ['semReligiao', /sem religi[aã]o/i, 'sem religião']]
    .map(([id, cat, rotulo]) => ({
      id: `rel_${id}`, grupo: 'IBGE · Censo 2010 (religião)', nome: `% de ${rotulo} (Censo 2010)`, unidade: '%',
      tabela: '137', variavel: /popula[cç][aã]o residente/i, categoria: { classificacao: /religi[aã]o/i, nome: cat }, percentual: true,
    })),
];

/** Converte o valor do IBGE: "-", "...", "X" e afins viram null. */
export function numeroIbge(valor) {
  if (valor === null || valor === undefined) return null;
  const n = Number(String(valor).trim());
  return Number.isFinite(n) && String(valor).trim() !== '' ? n : null;
}

/** Categoria "Total" de uma classificação (ou a de nível mais alto, se não houver uma chamada Total). */
export function categoriaTotal(classificacao) {
  const cats = classificacao.categorias ?? [];
  return cats.find((c) => /^total$/i.test(String(c.nome).trim()))
    ?? [...cats].sort((a, b) => (a.nivel ?? 0) - (b.nivel ?? 0))[0]
    ?? null;
}

/** Lê a resposta de valores: [{resultados: [{series: [{localidade:{id}, serie:{p: v}}]}]}] → {id: valor}. */
export function lerValores(resposta, periodo) {
  const porLocal = {};
  for (const variavel of resposta ?? []) {
    for (const resultado of variavel.resultados ?? []) {
      for (const s of resultado.series ?? []) {
        const v = numeroIbge(periodo ? s.serie?.[periodo] : Object.values(s.serie ?? {}).at(-1));
        if (v !== null) porLocal[String(s.localidade.id)] = v;
      }
    }
  }
  return porLocal;
}

/** a/b × fator para as chaves presentes nos dois. */
export function dividir(a, b, fator = 1) {
  const out = {};
  for (const [k, v] of Object.entries(a ?? {})) if (b?.[k] > 0) out[k] = (v / b[k]) * fator;
  return out;
}

export function criarCenso({ pasta = 'dados/censo', buscar = fetch, timeoutMs = 120_000, base = IBGE_BASE } = {}) {
  const memoria = new Map();
  const metaCache = new Map();

  async function getJson(url) {
    const res = await buscar(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`IBGE respondeu HTTP ${res.status}`);
    return res.json();
  }

  async function metadados(tabela) {
    if (!/^\d{1,6}$/.test(String(tabela))) throw new Error('número de tabela inválido');
    if (!metaCache.has(tabela)) {
      // Qualquer número de tabela pode ser pedido: o cache em memória tem limite.
      if (metaCache.size >= 200) metaCache.delete(metaCache.keys().next().value);
      const p = Promise.all([
        getJson(`${base}/${tabela}/metadados`),
        getJson(`${base}/${tabela}/periodos`).catch(() => []),
      ]).then(([meta, periodos]) => ({
        tabela: String(tabela),
        nome: meta.nome,
        niveis: meta.nivelTerritorial?.Administrativo ?? [],
        periodos: (periodos ?? []).map((p) => String(p.id)),
        variaveis: (meta.variaveis ?? []).map((v) => ({ id: String(v.id), nome: v.nome, unidade: v.unidade })),
        classificacoes: (meta.classificacoes ?? []).map((c) => ({
          id: String(c.id),
          nome: c.nome,
          total: categoriaTotal(c)?.id != null ? String(categoriaTotal(c).id) : null,
          categorias: (c.categorias ?? []).map((k) => ({ id: String(k.id), nome: k.nome })),
        })),
      }));
      p.catch(() => metaCache.delete(tabela));
      metaCache.set(tabela, p);
    }
    return metaCache.get(tabela);
  }

  /**
   * Uma série por município e por UF.
   * @param {{tabela, variavel, periodo?, classificacao?: Record<string,string>}} pedido
   *   classificacao: id da classificação → id da categoria (as omitidas usam "Total").
   */
  async function serie({ tabela, variavel, periodo, classificacao = {} }) {
    const meta = await metadados(tabela);
    const v = meta.variaveis.find((x) => x.id === String(variavel));
    if (!v) throw new Error(`variável ${variavel} não existe na tabela ${tabela}`);
    const per = periodo && meta.periodos.includes(String(periodo)) ? String(periodo) : meta.periodos.at(-1);
    const classif = meta.classificacoes
      .map((c) => [c.id, classificacao[c.id] ?? c.total])
      .filter(([, cat]) => cat !== null && cat !== undefined);
    const chave = `${tabela}-${v.id}-${per ?? 'ultimo'}-${classif.map(([c, k]) => `${c}_${k}`).join('.') || 'sem'}`;
    if (memoria.has(chave)) return memoria.get(chave);
    if (memoria.size >= 100) memoria.delete(memoria.keys().next().value);

    const arquivo = join(pasta, `${chave}.json`);
    try {
      const salvo = JSON.parse(await readFile(arquivo, 'utf8'));
      memoria.set(chave, salvo);
      return salvo;
    } catch {
      // ainda não baixada
    }

    const qs = (nivel) => {
      const p = new URLSearchParams({ localidades: `${nivel}[all]` });
      if (classif.length) p.set('classificacao', classif.map(([c, k]) => `${c}[${k}]`).join('|'));
      return p.toString();
    };
    const url = (nivel) => `${base}/${tabela}/periodos/${per ?? '-1'}/variaveis/${v.id}?${qs(nivel)}`;
    const [mun, uf] = await Promise.all([
      meta.niveis.includes('N6') ? getJson(url('N6')) : [],
      meta.niveis.includes('N3') ? getJson(url('N3')) : [],
    ]);
    const ufs = {};
    for (const [cod, valor] of Object.entries(lerValores(uf, per))) if (UF_IBGE[cod]) ufs[UF_IBGE[cod]] = valor;
    const resultado = {
      id: chave,
      tabela: String(tabela),
      variavel: v.id,
      nome: v.nome,
      unidade: v.unidade,
      periodo: per,
      categorias: classif.map(([c, k]) => {
        const cl = meta.classificacoes.find((x) => x.id === c);
        return `${cl?.nome}: ${cl?.categorias.find((x) => x.id === k)?.nome ?? k}`;
      }),
      municipios: lerValores(mun, per),
      ufs,
    };
    if (!Object.keys(resultado.municipios).length && !Object.keys(ufs).length) {
      throw new Error('o IBGE não devolveu valores para essa combinação');
    }
    memoria.set(chave, resultado);
    await mkdir(pasta, { recursive: true }).then(() => writeFile(arquivo, JSON.stringify(resultado))).catch(() => {});
    return resultado;
  }

  /** Série de uma tabela pré-configurada (ver PRESETS). */
  async function preset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) throw new Error('série desconhecida');
    const base = { nome: p.nome, grupo: p.grupo, preset: p.id, ...(p.unidade ? { unidade: p.unidade } : {}) };
    if (p.razao) {
      const [a, b] = await Promise.all([preset(p.razao.numerador), preset(p.razao.denominador)]);
      return { ...a, ...base, id: `razao-${p.id}`, municipios: dividir(a.municipios, b.municipios, p.razao.fator), ufs: dividir(a.ufs, b.ufs, p.razao.fator) };
    }
    const meta = await metadados(p.tabela);
    const v = meta.variaveis.find((x) => p.variavel.test(x.nome));
    if (!v) throw new Error(`não achei a variável "${p.variavel.source}" na tabela ${p.tabela}`);
    if (!p.categoria) return { ...(await serie({ tabela: p.tabela, variavel: v.id })), ...base };
    const cl = meta.classificacoes.find((c) => p.categoria.classificacao.test(c.nome));
    const cat = cl?.categorias.find((k) => p.categoria.nome.test(k.nome));
    if (!cat) throw new Error(`não achei a categoria "${p.categoria.nome.source}" na tabela ${p.tabela}`);
    const parte = await serie({ tabela: p.tabela, variavel: v.id, classificacao: { [cl.id]: cat.id } });
    if (!p.percentual) return { ...parte, ...base };
    const total = await serie({ tabela: p.tabela, variavel: v.id });
    return { ...parte, ...base, id: `pct-${parte.id}`, municipios: dividir(parte.municipios, total.municipios, 100), ufs: dividir(parte.ufs, total.ufs, 100) };
  }

  return { metadados, serie, preset };
}
