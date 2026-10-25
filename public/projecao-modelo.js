// Projeção do resultado final de um 2º turno a partir das urnas já apuradas e do 1º turno.
//
// Unidades (estados, para Presidente; cidades, para Governador) com o eleitorado inteiro, a parte
// já apurada e os votos dos dois candidatos. Em cada unidade:
//   1. Regressão (ponderada, com prioris fracas) do voto no 2º turno sobre o 1º, nas unidades que já
//      têm votos: y = A1 + 0,5·O1 + δ + β·(O1 − Ō1), em que y é a fatia do candidato A entre os dois,
//      A1 é a fatia dele no 1º turno, O1 a dos outros candidatos do 1º turno (cuja metade, a priori,
//      vai para cada lado), δ a mudança geral e β quanto dos "outros" pende para A além da metade.
//   2. A parte ainda não apurada de cada unidade mistura o que já foi apurado nela com a previsão da
//      regressão, pesando cada um pela incerteza (a parte apurada primeiro não é amostra aleatória:
//      quanto menos apurado, menos ela vale).
//   3. Votos válidos esperados = eleitorado × comparecimento × % de válidos (do que já foi apurado
//      nesta eleição, misturado com o 1º turno quando há pouco apurado).
//   4. Simulação (Monte Carlo): sorteia os coeficientes da regressão e um desvio comum a toda a parte
//      não apurada (as primeiras urnas apuradas no país inteiro tendem a ser parecidas entre si, então
//      o resto pode diferir delas na mesma direção: até 2,5 p.p. no começo, sumindo com a apuração),
//      mais o erro de cada unidade; o resultado nacional de cada sorteio dá o intervalo e a chance.

import { aleatorio } from './calculos.js';

const lim = (x, a, b) => Math.min(b, Math.max(a, x));

/** Normal padrão (Box-Muller) a partir de um gerador uniforme. */
function normal(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Inversa de matriz 2×2. */
const inv2 = ([[a, b], [c, d]]) => {
  const det = a * d - b * c;
  return [[d / det, -b / det], [-c / det, a / det]];
};

/** Quantil de uma lista já ordenada. */
const quantilOrdenado = (xs, q) => {
  const p = (xs.length - 1) * q;
  const i = Math.floor(p);
  return xs[i] + (xs[Math.min(xs.length - 1, i + 1)] - xs[i]) * (p - i);
};

/**
 * @param {object} o
 * @param {Array<{id, nome, aptos, aptosApurados, comparecimento, validos, votosA, votosB,
 *   t1: {aptos, comparecimento, validos, votosA, votosB}}>} o.unidades
 * @param {number} [o.simulacoes]
 * @param {number} [o.semente]
 */
export function projetar({ unidades, simulacoes = 3000, semente = 7 }) {
  // --- preparação de cada unidade ---
  const us = unidades.filter((u) => u.aptos > 0 && u.t1?.validos > 0).map((u) => {
    const A1 = u.t1.votosA / u.t1.validos;
    const B1 = u.t1.votosB / u.t1.validos;
    const O1 = Math.max(0, 1 - A1 - B1);
    const f = lim((u.aptosApurados ?? 0) / u.aptos, 0, 1);
    const dois = (u.votosA ?? 0) + (u.votosB ?? 0);
    const y = dois > 0 ? u.votosA / dois : null;
    // A parte apurada difere do resto da unidade (ordem de apuração não é aleatória): variância que
    // some quando a unidade está toda apurada, mais o erro amostral.
    const vObs = y === null ? Infinity : 0.03 ** 2 * (1 - f) + (y * (1 - y)) / Math.max(dois, 1) + 1e-6;
    return { ...u, A1, B1, O1, f, dois, y, vObs, base: A1 + 0.5 * O1 };
  });
  if (!us.length) return null;
  const mO = us.reduce((t, u) => t + u.O1 * u.aptos, 0) / us.reduce((t, u) => t + u.aptos, 0);
  const comDados = us.filter((u) => u.y !== null && u.dois >= 50);

  // --- regressão bayesiana (prioris: δ ~ N(0, 0,05²), β ~ N(0, 0,3²)) ---
  const PRIORI = [[1 / 0.05 ** 2, 0], [0, 1 / 0.3 ** 2]];
  let sigma2 = 0.03 ** 2;
  let beta = [0, 0];
  let cov = inv2(PRIORI);
  for (let iter = 0; iter < 4; iter += 1) {
    const P = [[PRIORI[0][0], 0], [0, PRIORI[1][1]]];
    const q = [0, 0];
    for (const u of comDados) {
      const w = 1 / (sigma2 + u.vObs);
      const x = [1, u.O1 - mO];
      const d = u.y - u.base;
      for (let i = 0; i < 2; i += 1) {
        q[i] += w * x[i] * d;
        for (let j = 0; j < 2; j += 1) P[i][j] += w * x[i] * x[j];
      }
    }
    cov = inv2(P);
    beta = [cov[0][0] * q[0] + cov[0][1] * q[1], cov[1][0] * q[0] + cov[1][1] * q[1]];
    if (comDados.length < 4) break; // poucos pontos: σ fica no valor a priori
    // σ² (diferença entre unidades que o modelo não explica), descontando o ruído da parte apurada.
    let sw = 0;
    let sr = 0;
    for (const u of comDados) {
      const r = u.y - u.base - beta[0] - beta[1] * (u.O1 - mO);
      const w = 1 / (sigma2 + u.vObs);
      sr += w * (r * r - u.vObs);
      sw += w;
    }
    sigma2 = lim(sr / sw, 0.01 ** 2, 0.08 ** 2);
  }
  const prever = (u, b) => lim(u.base + b[0] + b[1] * (u.O1 - mO), 0.01, 0.99);

  // --- comparecimento e % de válidos esperados ---
  const apur = us.filter((u) => u.aptosApurados > 0 && u.comparecimento > 0);
  const razao = (f1, f2) => {
    const n = apur.reduce((t, u) => t + f2(u), 0);
    return n > 0 ? apur.reduce((t, u) => t + f1(u), 0) / n : 1;
  };
  // Mudança geral de comparecimento e de válidos do 1º para o 2º turno, nas unidades já apuradas.
  // Encolhido para 1 enquanto há pouco apurado (as primeiras urnas não representam o comparecimento).
  const fracaoApur = apur.reduce((t, u) => t + u.aptosApurados, 0) / us.reduce((t, u) => t + u.aptos, 0);
  const encolher = (x) => 1 + (lim(x, 0.8, 1.2) - 1) * (fracaoApur / (fracaoApur + 0.05));
  const fatorComp = apur.length ? encolher(razao((u) => u.comparecimento, (u) => u.aptosApurados * (u.t1.comparecimento / u.t1.aptos))) : 1;
  const fatorVal = apur.length ? encolher(razao((u) => u.validos, (u) => u.comparecimento * (u.t1.validos / u.t1.comparecimento))) : 1;
  for (const u of us) {
    const comp1 = (u.t1.comparecimento / u.t1.aptos) * fatorComp;
    const val1 = (u.t1.validos / u.t1.comparecimento) * fatorVal;
    const w = u.f / (u.f + 0.05);
    const comp = u.aptosApurados > 0 && u.comparecimento > 0 ? w * (u.comparecimento / u.aptosApurados) + (1 - w) * comp1 : comp1;
    const val = u.comparecimento > 0 && u.validos > 0 ? w * (u.validos / u.comparecimento) + (1 - w) * val1 : val1;
    u.validosEsperados = Math.max(u.validos ?? 0, u.aptos * lim(comp, 0, 1) * lim(val, 0, 1));
    u.restante = Math.max(0, u.validosEsperados - (u.validos ?? 0));
  }

  // Parte não apurada: previsão da regressão (média m, variância pv) combinada com a apurada.
  const combinar = (u, m, pv) => {
    if (u.y === null) return { m, v: pv };
    const v = 1 / (1 / pv + 1 / u.vObs);
    return { m: v * (m / pv + u.y / u.vObs), v };
  };
  const varPrevisao = (u) => {
    const x = [1, u.O1 - mO];
    return sigma2 + x[0] * (cov[0][0] * x[0] + cov[0][1] * x[1]) + x[1] * (cov[1][0] * x[0] + cov[1][1] * x[1]);
  };

  // Desvio comum da parte não apurada em relação à apurada (ordem de apuração), em p.p. de fatia.
  const fracao = us.reduce((t, u) => t + (u.aptosApurados ?? 0), 0) / us.reduce((t, u) => t + u.aptos, 0);
  const sComum = comDados.length ? 0.025 * (1 - fracao) ** 2 : 0;

  // --- estimativa central por unidade ---
  let totA = 0;
  let totV = 0;
  for (const u of us) {
    u.previsto = prever(u, beta);
    const { m, v } = combinar(u, u.previsto, varPrevisao(u));
    u.restanteA = m;
    u.restanteVar = v;
    const votosA = (u.votosA ?? 0) + u.restante * m;
    u.projecao = votosA / u.validosEsperados;
    // Intervalo de 90% da unidade (só a parte não apurada é incerta).
    const dp = (u.restante / u.validosEsperados) * Math.sqrt(v + sComum ** 2);
    u.intervalo = [lim(u.projecao - 1.645 * dp, 0, 1), lim(u.projecao + 1.645 * dp, 0, 1)];
    totA += votosA;
    totV += u.validosEsperados;
  }

  // --- simulação ---
  const rng = aleatorio(semente);
  // Cholesky da covariância dos coeficientes.
  const l11 = Math.sqrt(cov[0][0]);
  const l21 = cov[1][0] / l11;
  const l22 = Math.sqrt(Math.max(0, cov[1][1] - l21 * l21));
  const resultados = new Float64Array(simulacoes);
  let vitorias = 0;
  for (let s = 0; s < simulacoes; s += 1) {
    const z1 = normal(rng);
    const z2 = normal(rng);
    const b = [beta[0] + l11 * z1, beta[1] + l21 * z1 + l22 * z2];
    const c = sComum * normal(rng);
    let a = 0;
    for (const u of us) {
      if (!u.restante) { a += u.votosA ?? 0; continue; }
      const { m, v } = combinar(u, prever(u, b), sigma2);
      a += (u.votosA ?? 0) + u.restante * lim(m + c + Math.sqrt(v) * normal(rng), 0, 1);
    }
    resultados[s] = a / totV;
    if (resultados[s] > 0.5) vitorias += 1;
  }
  const ordenados = [...resultados].sort((x, y) => x - y);
  const apuradoA = us.reduce((t, u) => t + (u.votosA ?? 0), 0);
  const apuradoDois = us.reduce((t, u) => t + u.dois, 0);
  return {
    unidades: us,
    projecao: totA / totV,
    intervalo: [quantilOrdenado(ordenados, 0.05), quantilOrdenado(ordenados, 0.95)],
    chanceA: vitorias / simulacoes,
    simulacoes: ordenados,
    apuradoA: apuradoDois ? apuradoA / apuradoDois : null,
    fracaoApurada: fracao,
    validosEsperados: totV,
    modelo: { delta: beta[0], beta: beta[1], sigma: Math.sqrt(sigma2), n: comDados.length, mediaOutros: mO, desvioComum: sComum },
  };
}
