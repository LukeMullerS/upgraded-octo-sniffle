// Estatística descritiva para os painéis (brancos, nulos, comparecimento, candidatos…). Funções puras: rodam no
// navegador e nos testes (Node).

const pct = (parte, total) => (total > 0 ? (parte / total) * 100 : 0);

// Cada métrica é uma razão: numerador e denominador em votos (ou eleitores). A média
// ponderada de um grupo é soma(numerador) / soma(denominador) — a mesma conta do TSE
// para o total —, enquanto a média simples trata cada cidade como um voto.
export const METRICAS = {
  pctBrancosNulos: {
    nome: 'Brancos + nulos', curto: 'B + N',
    numerador: (r) => r.brancos + r.nulos, denominador: (r) => r.total,
  },
  pctBrancos: { nome: 'Brancos', curto: 'Brancos', numerador: (r) => r.brancos, denominador: (r) => r.total },
  pctNulos: { nome: 'Nulos', curto: 'Nulos', numerador: (r) => r.nulos, denominador: (r) => r.total },
  pctAnulados: { nome: 'Anulados', curto: 'Anulados', numerador: (r) => r.anulados, denominador: (r) => r.total },
  pctAbstencao: {
    nome: 'Abstenção', curto: 'Abstenção',
    numerador: (r) => r.abstencao ?? 0, denominador: (r) => r.aptosTotalizadas ?? 0,
  },
  pctComparecimento: {
    nome: 'Comparecimento', curto: 'Compar.',
    numerador: (r) => r.comparecimento ?? 0, denominador: (r) => r.aptosTotalizadas ?? 0,
  },
  pctValidos: { nome: 'Votos válidos', curto: 'Válidos', numerador: (r) => r.validos ?? 0, denominador: (r) => r.total },
};

export const valorMetrica = (linha, chave) => {
  const m = METRICAS[chave];
  return pct(m.numerador(linha), m.denominador(linha));
};

export function media(valores) {
  return valores.length ? valores.reduce((t, v) => t + v, 0) / valores.length : 0;
}

/** Quantil por interpolação linear (q entre 0 e 1). */
export function quantil(valores, q) {
  if (!valores.length) return 0;
  const ord = [...valores].sort((a, b) => a - b);
  const pos = (ord.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  return ord[base + 1] !== undefined ? ord[base] + resto * (ord[base + 1] - ord[base]) : ord[base];
}

export const mediana = (valores) => quantil(valores, 0.5);

/** Desvio padrão amostral. */
export function desvioPadrao(valores) {
  if (valores.length < 2) return 0;
  const m = media(valores);
  return Math.sqrt(valores.reduce((t, v) => t + (v - m) ** 2, 0) / (valores.length - 1));
}

export function mediaPonderada(linhas, chave) {
  const m = METRICAS[chave];
  const num = linhas.reduce((t, l) => t + m.numerador(l), 0);
  const den = linhas.reduce((t, l) => t + m.denominador(l), 0);
  return pct(num, den);
}

/** Correlação de Pearson entre duas listas de mesmo tamanho. */
export function correlacao(xs, ys) {
  if (xs.length < 3) return null;
  const mx = media(xs);
  const my = media(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/**
 * Resumo da métrica num conjunto de locais. Só entram locais com denominador > 0
 * (cidade sem nenhuma seção totalizada não tem percentual).
 */
export function resumoEstatistico(linhas, chave) {
  const validas = linhas.filter((l) => METRICAS[chave].denominador(l) > 0);
  const valores = validas.map((l) => valorMetrica(l, chave));
  if (!valores.length) return null;
  const m = media(valores);
  const dp = desvioPadrao(valores);
  const q1 = quantil(valores, 0.25);
  const q3 = quantil(valores, 0.75);
  const iqr = q3 - q1;
  let min = validas[0];
  let max = validas[0];
  for (const l of validas) {
    if (valorMetrica(l, chave) < valorMetrica(min, chave)) min = l;
    if (valorMetrica(l, chave) > valorMetrica(max, chave)) max = l;
  }
  return {
    n: valores.length,
    ponderada: mediaPonderada(validas, chave),
    media: m,
    mediana: mediana(valores),
    desvio: dp,
    q1,
    q3,
    // Cercas de Tukey: fora de [Q1 − 1,5·IQR, Q3 + 1,5·IQR] é atípico.
    cercaInferior: q1 - 1.5 * iqr,
    cercaSuperior: q3 + 1.5 * iqr,
    min: { linha: min, valor: valorMetrica(min, chave) },
    max: { linha: max, valor: valorMetrica(max, chave) },
  };
}

/** Escore z de um valor em relação a média e desvio do conjunto. */
export const escoreZ = (valor, estat) => (estat && estat.desvio > 0 ? (valor - estat.media) / estat.desvio : 0);

/** Passo "redondo" (0,1 · 0,2 · 0,25 · 0,5 · 1 · 2 · 5…) que divide a faixa em ~alvo partes. */
export function passoRedondo(faixa, alvo = 12) {
  if (!(faixa > 0)) return 1;
  const bruto = faixa / alvo;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= bruto);
  return passo ?? 10 * potencia;
}

/** Histograma com faixas de largura redonda. Cada faixa: [inicio, fim) — a última inclui o fim. */
export function histograma(valores, alvo = 12) {
  if (!valores.length) return { passo: 1, faixas: [] };
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const passo = passoRedondo(max - min || 1, alvo);
  const inicio = Math.floor(min / passo) * passo;
  const n = Math.max(1, Math.ceil((max - inicio) / passo + 1e-9));
  const faixas = Array.from({ length: n }, (_, i) => ({
    inicio: arred(inicio + i * passo),
    fim: arred(inicio + (i + 1) * passo),
    contagem: 0,
  }));
  for (const v of valores) {
    const i = Math.min(n - 1, Math.floor((v - inicio) / passo + 1e-9));
    faixas[i].contagem += 1;
  }
  return { passo, faixas };
}

const arred = (v) => Math.round(v * 1e6) / 1e6;

/** Regressão linear simples y = a + b·x, com r e R². */
export function regressaoLinear(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = media(xs);
  const my = media(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (!sxx) return null;
  const b = sxy / sxx;
  const r = correlacao(xs, ys);
  // Y sem variação (todos iguais): não há correlação a medir.
  if (r === null || !Number.isFinite(r)) return null;
  return { a: my - b * mx, b, r, r2: r * r, n };
}

/** Resumo de cinco números + média para um boxplot. */
export function resumoCaixa(valores) {
  if (!valores.length) return null;
  const q1 = quantil(valores, 0.25);
  const q3 = quantil(valores, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const dentro = valores.filter((v) => v >= lo && v <= hi);
  return {
    n: valores.length,
    media: media(valores),
    desvio: desvioPadrao(valores),
    q1,
    mediana: mediana(valores),
    q3,
    min: Math.min(...dentro),
    max: Math.max(...dentro),
    atipicos: valores.filter((v) => v < lo || v > hi),
  };
}

// ---------- inferência ----------

// log Γ(x) pela aproximação de Lanczos.
function lnGama(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// Fração contínua da beta incompleta (Numerical Recipes, betacf).
function fracaoBeta(a, b, x) {
  const EPS = 3e-14;
  const MIN = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < MIN) d = MIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < MIN) d = MIN;
    c = 1 + aa / c; if (Math.abs(c) < MIN) c = MIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < MIN) d = MIN;
    c = 1 + aa / c; if (Math.abs(c) < MIN) c = MIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Beta incompleta regularizada I_x(a, b). */
export function betaIncompleta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGama(a + b) - lnGama(a) - lnGama(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * fracaoBeta(a, b, x)) / a : 1 - (bt * fracaoBeta(b, a, 1 - x)) / b;
}

/** Valor-p bicaudal da estatística t com gl graus de liberdade. */
export const pValorT = (t, gl) => betaIncompleta(gl / (gl + t * t), gl / 2, 0.5);

/** Valor-p (cauda superior) da estatística F. */
export const pValorF = (f, gl1, gl2) => (f > 0 ? betaIncompleta(gl2 / (gl2 + gl1 * f), gl2 / 2, gl1 / 2) : 1);

/** Teste da correlação de Pearson (H0: ρ = 0). */
export function testeCorrelacao(r, n) {
  if (r === null || n < 3) return null;
  if (Math.abs(r) >= 1) return { t: Infinity, gl: n - 2, p: 0 };
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return { t, gl: n - 2, p: pValorT(t, n - 2) };
}

/** ANOVA de um fator. `grupos` = listas de valores. Devolve F, graus de liberdade, p e η². */
export function anovaUmFator(grupos) {
  const validos = grupos.filter((g) => g.length);
  const n = validos.reduce((t, g) => t + g.length, 0);
  const k = validos.length;
  if (k < 2 || n <= k) return null;
  const geral = validos.flat().reduce((t, v) => t + v, 0) / n;
  let entre = 0;
  let dentro = 0;
  for (const g of validos) {
    const m = media(g);
    entre += g.length * (m - geral) ** 2;
    for (const v of g) dentro += (v - m) ** 2;
  }
  const gl1 = k - 1;
  const gl2 = n - k;
  // Todos os valores iguais: não há variação para comparar.
  if (entre + dentro === 0) return null;
  const f = dentro > 0 ? entre / gl1 / (dentro / gl2) : Infinity;
  return { f, gl1, gl2, p: Number.isFinite(f) ? pValorF(f, gl1, gl2) : 0, eta2: entre / (entre + dentro) };
}

// ---------- análises adicionais ----------

/** Postos (ranks) com média nos empates. */
function postos(v) {
  const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const media = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) r[idx[k][1]] = media;
    i = j + 1;
  }
  return r;
}

/** Correlação de Spearman (Pearson sobre os postos): menos sensível a valores extremos. */
export function spearman(xs, ys) {
  return correlacao(postos(xs), postos(ys));
}

/** Teste t de Welch para duas amostras independentes, com d de Cohen. */
export function testeTWelch(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const ma = media(a);
  const mb = media(b);
  const va = desvioPadrao(a) ** 2;
  const vb = desvioPadrao(b) ** 2;
  const se = Math.sqrt(va / a.length + vb / b.length);
  if (!se) return null;
  const t = (ma - mb) / se;
  const gl = (va / a.length + vb / b.length) ** 2
    / ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
  const dp = Math.sqrt(((a.length - 1) * va + (b.length - 1) * vb) / (a.length + b.length - 2));
  return { t, gl, p: pValorT(t, gl), mediaA: ma, mediaB: mb, diferenca: ma - mb, d: dp ? (ma - mb) / dp : 0, nA: a.length, nB: b.length };
}

/** Resolve A·x = b por eliminação de Gauss com pivoteamento; null se singular. */
function resolver(A, b) {
  const n = A.length;
  const M = A.map((linha, i) => [...linha, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((linha, i) => linha[n] / linha[i]);
}

/** Inversa de uma matriz pequena (Gauss-Jordan); null se singular. */
function inversa(A) {
  const n = A.length;
  const colunas = [];
  for (let j = 0; j < n; j += 1) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const c = resolver(A, e);
    if (!c) return null;
    colunas.push(c);
  }
  return A.map((_, i) => colunas.map((c) => c[i]));
}

/**
 * Regressão linear múltipla por mínimos quadrados: y = b0 + b1·x1 + … + bk·xk.
 * @param {number[]} y
 * @param {number[][]} X  uma linha por observação, uma coluna por variável explicativa
 */
export function regressaoMultipla(y, X) {
  const n = y.length;
  const k = X[0]?.length ?? 0;
  if (!k || n <= k + 1) return null;
  const Z = X.map((linha) => [1, ...linha]); // com intercepto
  const p = k + 1;
  const ZtZ = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => Z.reduce((s, z) => s + z[i] * z[j], 0)));
  const Zty = Array.from({ length: p }, (_, i) => Z.reduce((s, z, r) => s + z[i] * y[r], 0));
  const inv = inversa(ZtZ);
  if (!inv) return null;
  const b = inv.map((linha) => linha.reduce((s, v, j) => s + v * Zty[j], 0));
  const previsto = Z.map((z) => z.reduce((s, v, j) => s + v * b[j], 0));
  const my = media(y);
  const sqRes = y.reduce((s, v, i) => s + (v - previsto[i]) ** 2, 0);
  const sqTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const glRes = n - p;
  const s2 = sqRes / glRes;
  const r2 = sqTot ? 1 - sqRes / sqTot : 0;
  const dpY = desvioPadrao(y);
  const coeficientes = b.map((coef, j) => {
    const se = Math.sqrt(Math.max(0, s2 * inv[j][j]));
    const t = se ? coef / se : 0;
    const dpX = j ? desvioPadrao(X.map((linha) => linha[j - 1])) : 0;
    return { coef, se, t, p: se ? pValorT(t, glRes) : 1, beta: j && dpY ? (coef * dpX) / dpY : null };
  });
  const f = k && r2 < 1 ? (r2 / k) / ((1 - r2) / glRes) : Infinity;
  return {
    n, k, coeficientes, r2, r2Ajustado: 1 - ((1 - r2) * (n - 1)) / glRes,
    f, pF: Number.isFinite(f) ? pValorF(f, k, glRes) : 0, glRes,
  };
}

// ---------- análise espacial ----------

/**
 * Vizinhos de cada área (contiguidade "rainha": compartilham ao menos um vértice), a partir
 * das feições GeoJSON (MultiPolygon, properties.codarea). As malhas do IBGE são topológicas:
 * fronteiras comuns usam os mesmos pontos, então basta comparar vértices arredondados.
 * @returns {Map<string, Set<string>>}
 */
export function vizinhancaDeMalha(features, casas = 3) {
  const f = 10 ** casas;
  const porPonto = new Map();
  for (const ft of features) {
    const cod = ft.properties.codarea;
    for (const pol of ft.geometry.coordinates) {
      for (const anel of pol) {
        for (const [x, y] of anel) {
          const k = `${Math.round(x * f)},${Math.round(y * f)}`;
          let s = porPonto.get(k);
          if (!s) porPonto.set(k, (s = new Set()));
          s.add(cod);
        }
      }
    }
  }
  const viz = new Map(features.map((ft) => [ft.properties.codarea, new Set()]));
  for (const s of porPonto.values()) {
    if (s.size < 2) continue;
    for (const a of s) for (const b of s) if (a !== b) viz.get(a).add(b);
  }
  return viz;
}

/** Gerador pseudoaleatório com semente (resultados reprodutíveis). */
export function aleatorio(semente = 42) {
  let s = semente >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Prepara z-scores e listas de vizinhos (índices) só com as áreas que têm valor. */
function prepararEspacial(valores, vizinhos) {
  const cods = [...valores.keys()].filter((c) => Number.isFinite(valores.get(c)) && vizinhos.has(c));
  const idx = new Map(cods.map((c, i) => [c, i]));
  const x = cods.map((c) => valores.get(c));
  const m = media(x);
  const dp = Math.sqrt(x.reduce((t, v) => t + (v - m) ** 2, 0) / x.length) || 1;
  const z = x.map((v) => (v - m) / dp);
  const viz = cods.map((c) => [...vizinhos.get(c)].map((v) => idx.get(v)).filter((i) => i !== undefined));
  return { cods, z, viz };
}

/** Defasagem espacial: média dos vizinhos (pesos padronizados por linha). */
const defasagem = (z, viz, i) => (viz[i].length ? viz[i].reduce((t, j) => t + z[j], 0) / viz[i].length : 0);

/**
 * I de Moran global (pesos padronizados por linha) com teste de permutação.
 * I > 0: áreas vizinhas parecidas (agrupamento); I < 0: vizinhas diferentes; ~0: aleatório.
 */
export function moranGlobal(valores, vizinhos, { permutacoes = 499, semente = 42 } = {}) {
  const { cods, z, viz } = prepararEspacial(valores, vizinhos);
  const n = cods.length;
  const comViz = viz.filter((v) => v.length).length;
  if (n < 8 || comViz < 4) return null;
  const calcular = (zz) => {
    let num = 0;
    for (let i = 0; i < n; i += 1) if (viz[i].length) num += zz[i] * defasagem(zz, viz, i);
    return num / zz.reduce((t, v) => t + v * v, 0) * (n / comViz);
  };
  const I = calcular(z);
  if (!Number.isFinite(I)) return null; // valores todos iguais
  const rnd = aleatorio(semente);
  const perm = [...z];
  let maiores = 0;
  let menores = 0;
  const sim = [];
  for (let k = 0; k < permutacoes; k += 1) {
    for (let i = n - 1; i > 0; i -= 1) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const Ik = calcular(perm);
    sim.push(Ik);
    if (Ik >= I) maiores += 1;
    if (Ik <= I) menores += 1;
  }
  const mSim = media(sim);
  const dpSim = Math.sqrt(sim.reduce((t, v) => t + (v - mSim) ** 2, 0) / sim.length) || 1;
  // p bicaudal por permutação (agrupamento ou "xadrez"); z em relação à distribuição simulada.
  const p = Math.min(1, (2 * Math.min(maiores, menores) + 1) / (permutacoes + 1));
  return { I, esperado: -1 / (n - 1), z: (I - mSim) / dpSim, p, n, semVizinhos: n - comViz };
}

/**
 * LISA (Moran local, Anselin 1995): para cada área, o quadrante — Alto-Alto (bolsão de
 * valores altos), Baixo-Baixo, Alto-Baixo e Baixo-Alto (áreas destoantes dos vizinhos) — e o
 * valor-p por permutação condicional. Só as com p < alfa são marcadas.
 * @returns {Map<string, {Ii: number, quadrante: string|null, p: number}>}
 */
export function lisa(valores, vizinhos, { permutacoes = 199, alfa = 0.05, semente = 7 } = {}) {
  const { cods, z, viz } = prepararEspacial(valores, vizinhos);
  const n = cods.length;
  const out = new Map();
  if (n < 8) return out;
  const rnd = aleatorio(semente);
  for (let i = 0; i < n; i += 1) {
    const k = viz[i].length;
    if (!k) { out.set(cods[i], { Ii: 0, quadrante: null, p: 1 }); continue; }
    const lag = defasagem(z, viz, i);
    const Ii = z[i] * lag;
    // Permutação condicional: o valor da área fica; os vizinhos são sorteados entre as outras.
    let extremos = 0;
    for (let r = 0; r < permutacoes; r += 1) {
      let soma = 0;
      for (let j = 0; j < k; j += 1) {
        let q = Math.floor(rnd() * (n - 1));
        if (q >= i) q += 1;
        soma += z[q];
      }
      const Ir = z[i] * (soma / k);
      if (Ii >= 0 ? Ir >= Ii : Ir <= Ii) extremos += 1;
    }
    const p = (extremos + 1) / (permutacoes + 1);
    const quadrante = p < alfa
      ? (z[i] >= 0 ? (lag >= 0 ? 'Alto-Alto' : 'Alto-Baixo') : (lag < 0 ? 'Baixo-Baixo' : 'Baixo-Alto'))
      : null;
    out.set(cods[i], { Ii, quadrante, p });
  }
  return out;
}

// ---------- agrupamento ----------

/** Padroniza colunas (z-score). Linhas com algum valor ausente devem ser filtradas antes. */
export function padronizar(linhas) {
  const k = linhas[0]?.length ?? 0;
  const medias = Array.from({ length: k }, (_, j) => media(linhas.map((l) => l[j])));
  const dps = medias.map((m, j) => Math.sqrt(linhas.reduce((t, l) => t + (l[j] - m) ** 2, 0) / linhas.length) || 1);
  return { z: linhas.map((l) => l.map((v, j) => (v - medias[j]) / dps[j])), medias, dps };
}

const dist2 = (a, b) => a.reduce((t, v, j) => t + (v - b[j]) ** 2, 0);

/**
 * k-médias (k-means++ com semente, várias tentativas): agrupa locais parecidos.
 * @param {number[][]} pontos  já padronizados
 * @returns {{grupos: number[], centros: number[][], inercia: number}}
 */
export function kmedias(pontos, k, { tentativas = 5, iteracoes = 60, semente = 11 } = {}) {
  const n = pontos.length;
  if (n < k || k < 1) return null;
  const rnd = aleatorio(semente);
  let melhor = null;
  for (let t = 0; t < tentativas; t += 1) {
    const centros = [pontos[Math.floor(rnd() * n)]];
    while (centros.length < k) {
      const d = pontos.map((p) => Math.min(...centros.map((c) => dist2(p, c))));
      const total = d.reduce((a, b) => a + b, 0);
      let alvo = rnd() * total;
      let i = 0;
      while (i < n - 1 && (alvo -= d[i]) > 0) i += 1;
      centros.push(pontos[i]);
    }
    let grupos = new Array(n).fill(0);
    for (let it = 0; it < iteracoes; it += 1) {
      let mudou = false;
      grupos = pontos.map((p, i) => {
        let g = 0;
        let dm = Infinity;
        centros.forEach((c, j) => { const d = dist2(p, c); if (d < dm) { dm = d; g = j; } });
        if (g !== grupos[i]) mudou = true;
        return g;
      });
      for (let j = 0; j < k; j += 1) {
        const membros = pontos.filter((_, i) => grupos[i] === j);
        if (membros.length) centros[j] = membros[0].map((_, c) => media(membros.map((m) => m[c])));
      }
      if (!mudou && it > 0) break;
    }
    const inercia = pontos.reduce((tot, p, i) => tot + dist2(p, centros[grupos[i]]), 0);
    if (!melhor || inercia < melhor.inercia) melhor = { grupos, centros: centros.map((c) => [...c]), inercia };
  }
  return melhor;
}

/** Silhueta média (−1 a 1): quão bem separados estão os grupos. Usa amostra se n for grande. */
export function silhueta(pontos, grupos, { maxAmostra = 600 } = {}) {
  const passo = Math.max(1, Math.floor(pontos.length / maxAmostra));
  const idx = pontos.map((_, i) => i).filter((i) => i % passo === 0);
  const k = Math.max(...grupos) + 1;
  if (k < 2) return 0;
  let soma = 0;
  for (const i of idx) {
    const somas = new Array(k).fill(0);
    const cont = new Array(k).fill(0);
    for (const j of idx) {
      if (i === j) continue;
      somas[grupos[j]] += Math.sqrt(dist2(pontos[i], pontos[j]));
      cont[grupos[j]] += 1;
    }
    const a = cont[grupos[i]] ? somas[grupos[i]] / cont[grupos[i]] : 0;
    let b = Infinity;
    for (let g = 0; g < k; g += 1) if (g !== grupos[i] && cont[g]) b = Math.min(b, somas[g] / cont[g]);
    soma += b === Infinity ? 0 : (b - a) / Math.max(a, b);
  }
  return soma / idx.length;
}
