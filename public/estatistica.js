// Estatística descritiva para o painel de brancos e nulos. Funções puras: rodam no
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
  return { a: my - b * mx, b, r, r2: r === null ? null : r * r, n };
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
