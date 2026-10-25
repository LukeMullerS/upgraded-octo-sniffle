// Projeção do resultado final de um 2º turno a partir das urnas já apuradas e do 1º turno.
//
// Segue o desenho dos modelos de noite de eleição usados por veículos e institutos (NYT, Washington
// Post, Decision Desk HQ e as projeções brasileiras por município): a unidade é a CIDADE (onde houver
// os dados de cada cidade; senão, o estado), o que se modela é a MUDANÇA em relação a uma eleição de
// referência (o 1º turno) e os locais parecidos ajudam a prever os que ainda não apuraram.
//
//   1. Regressão bayesiana (prioris fracas), nas cidades com votos, da fatia do candidato A entre os dois:
//        y = A1 + 0,5·O1 + δ + βO·(O1 − Ō) + βA·(A1 − Ā) + u[estado]
//      A1: fatia de A no 1º turno; O1: a dos outros candidatos do 1º turno (a priori, metade para cada
//      lado); δ: mudança geral; βO: para que lado pendem os eleitores dos outros; βA: se A cresce mais
//      onde já era forte ou fraco; u[estado]: efeito de cada estado, encolhido para zero quando o estado
//      tem poucas cidades apuradas (efeito aleatório, desvio a priori de 3 p.p.).
//   2. A parte ainda não apurada de cada cidade mistura o que já saiu nela com a previsão, pesando cada
//      um pela incerteza (as primeiras urnas não são amostra aleatória; quanto menos apurado, menos valem).
//   3. Votos válidos esperados = eleitorado × comparecimento × % de válidos (do 2º turno já apurado na
//      cidade, misturado com o 1º turno; a mudança geral de comparecimento entra encolhida no começo).
//   4. Simulação (Monte Carlo) por estado: sorteia os coeficientes e os efeitos de estado (erro comum às
//      cidades do estado), um desvio comum a toda a parte não apurada (até 2,5 p.p. no começo, sumindo
//      com a apuração) e o erro somado das cidades; dá o intervalo e a chance de vitória.
//   5. "Ao vivo": se os totais de cada estado chegam mais novos que as cidades, o apurado de cada estado
//      vem deles, e os votos apurados no estado desde o retrato das cidades corrigem a fatia prevista
//      para o que falta (atualização bayesiana: quanto mais votos novos, mais pesam).

import { aleatorio } from './calculos.js';

const lim = (x, a, b) => Math.min(b, Math.max(a, x));

/** Normal padrão (Box-Muller). */
function normal(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Inversa de matriz simétrica positiva (Gauss-Jordan; matrizes pequenas). */
function inversa(M) {
  const n = M.length;
  const A = M.map((linha, i) => [...linha, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let j = 0; j < 2 * n; j += 1) A[c][j] /= d;
    for (let r = 0; r < n; r += 1) {
      if (r === c || !A[r][c]) continue;
      const f = A[r][c];
      for (let j = 0; j < 2 * n; j += 1) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((linha) => linha.slice(n));
}

/** Fator de Cholesky (L·Lᵀ = M). */
function cholesky(M) {
  const n = M.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = M[i][j];
      for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-14)) : s / L[j][j];
    }
  }
  return L;
}

/** Variáveis extras possíveis da regressão (cada uma com o desvio a priori do coeficiente). */
export const VARIAVEIS = {
  tamanho: { rotulo: 'tamanho da cidade (log do eleitorado)', priori: 0.05, valor: (u) => Math.log(u.aptos) },
  comparecimento1: { rotulo: 'comparecimento no 1º turno', priori: 0.3, valor: (u) => u.t1.comparecimento / u.t1.aptos },
  validos1: { rotulo: '% de válidos no 1º turno', priori: 0.3, valor: (u) => u.t1.validos / u.t1.comparecimento },
};
// Validado com as cidades já apuradas do 2º turno de 2026 (cidades e estados escondidos): o tamanho
// da cidade foi a única variável extra que reduziu o erro.
export const VARIAVEIS_PADRAO = ['tamanho'];

/** Valor p bilateral de um escore z (normal padrão). */
export function valorP(z) {
  const x = Math.abs(z) / Math.SQRT2;
  // erfc por aproximação de Abramowitz-Stegun (erro < 1,5e-7).
  const t = 1 / (1 + 0.3275911 * x);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return Math.min(1, erfc);
}

const quantilOrdenado = (xs, q) => {
  const p = (xs.length - 1) * q;
  const i = Math.floor(p);
  return xs[i] + (xs[Math.min(xs.length - 1, i + 1)] - xs[i]) * (p - i);
};

/**
 * @param {object} o
 * @param {Array<{id, nome, grupo?, aptos, aptosApurados, comparecimento, validos, votosA, votosB,
 *   t1: {aptos, comparecimento, validos, votosA, votosB}}>} o.unidades  cidades (grupo = estado) ou estados
 * @param {Object<string, {aptos, aptosApurados, validos, votosA, votosB}>} [o.aoVivo]  totais mais novos
 *   de cada grupo (estado); o que falta em cada um segue a fatia prevista pelas unidades
 * @param {number} [o.simulacoes]
 * @param {number} [o.semente]
 * @param {string[]} [o.variaveis]  variáveis extras da regressão (ver VARIAVEIS)
 * @param {number} [o.tau]  desvio a priori do efeito de estado
 */
export function projetar({ unidades, aoVivo = null, simulacoes = 4000, semente = 7, variaveis = VARIAVEIS_PADRAO, tau: tauOpcao = 0.03 }) {
  // --- preparação ---
  const us = unidades.filter((u) => u.aptos > 0 && u.t1?.validos > 0).map((u) => {
    const A1 = u.t1.votosA / u.t1.validos;
    const B1 = u.t1.votosB / u.t1.validos;
    const O1 = Math.max(0, 1 - A1 - B1);
    const f = lim((u.aptosApurados ?? 0) / u.aptos, 0, 1);
    const dois = (u.votosA ?? 0) + (u.votosB ?? 0);
    const y = dois > 0 ? u.votosA / dois : null;
    // A parte apurada difere do resto da cidade (ordem de apuração), mais o erro amostral.
    const vObs = y === null ? Infinity : 0.03 ** 2 * (1 - f) + (y * (1 - y)) / Math.max(dois, 1) + 1e-6;
    return { ...u, grupo: u.grupo ?? '', A1, B1, O1, f, dois, y, vObs, base: A1 + 0.5 * O1 };
  });
  if (!us.length) return null;
  const somaAptos = us.reduce((t, u) => t + u.aptos, 0);
  const mO = us.reduce((t, u) => t + u.O1 * u.aptos, 0) / somaAptos;
  const mA = us.reduce((t, u) => t + u.A1 * u.aptos, 0) / somaAptos;
  const grupos = [...new Set(us.map((u) => u.grupo))].sort();
  const gi = new Map(grupos.map((g, i) => [g, i]));
  // Variáveis extras, centradas na média (pesada pelo eleitorado).
  const extras = variaveis.map((nome) => {
    const f = VARIAVEIS[nome].valor;
    const m = us.reduce((t, u) => t + f(u) * u.aptos, 0) / somaAptos;
    return { nome, f, m, dp: VARIAVEIS[nome].priori };
  });
  const NG = 3 + extras.length; // coeficientes gerais; depois deles, um efeito por estado
  const K = NG + grupos.length;
  for (const u of us) {
    u.x = new Array(K).fill(0);
    u.x[0] = 1; u.x[1] = u.O1 - mO; u.x[2] = u.A1 - mA;
    extras.forEach((e, i) => { u.x[3 + i] = e.f(u) - e.m; });
    u.x[NG + gi.get(u.grupo)] = 1;
  }
  const comDados = us.filter((u) => u.y !== null && u.dois >= 30);

  // --- regressão bayesiana com efeitos de estado ---
  // Desvio dos efeitos de estado (τ): começa no valor dado e, com estados suficientes, é estimado
  // pelos dados (EM do componente de variância: τ² = média de u² + Var(u)).
  let tau = grupos.length > 1 ? tauOpcao : 1e-4; // um grupo só: o efeito de grupo é o próprio δ
  const priori = [1 / 0.05 ** 2, 1 / 0.3 ** 2, 1 / 0.2 ** 2, ...extras.map((e) => 1 / e.dp ** 2), ...grupos.map(() => 1 / tau ** 2)];
  const gruposComDados = new Set(grupos.filter((g) => comDados.filter((u) => u.grupo === g).length >= 10));
  // Variação entre cidades que o modelo não explica: maior nas pequenas. σᵢ² = a + b / (eleitorado em
  // milhares), estimados pelos dados (validado: com um σ único o intervalo das cidades pequenas errava).
  let sigA = 0.03 ** 2;
  let sigB = 0;
  const sig2 = (u) => sigA + sigB / (u.aptos / 1000);
  let sigma2 = sigA;
  let coef = new Array(K).fill(0);
  let cov = priori.map((p, i) => priori.map((_, j) => (i === j ? 1 / p : 0)));
  for (let iter = 0; iter < 10; iter += 1) {
    const P = priori.map((p, i) => priori.map((_, j) => (i === j ? p : 0)));
    const q = new Array(K).fill(0);
    for (const u of comDados) {
      const w = 1 / (sig2(u) + u.vObs);
      const d = u.y - u.base;
      const nz = [...Array.from({ length: NG }, (_, i) => i), NG + gi.get(u.grupo)];
      for (const i of nz) {
        q[i] += w * u.x[i] * d;
        for (const j of nz) P[i][j] += w * u.x[i] * u.x[j];
      }
    }
    cov = inversa(P);
    coef = cov.map((linha) => linha.reduce((t, c, j) => t + c * q[j], 0));
    if (comDados.length < 6) break; // poucos pontos: σ fica no valor a priori
    // σ²: diferença entre cidades que o modelo não explica, descontado o ruído da parte apurada. Com
    // bastante cidades já completas, só elas (nas parciais o ruído da parte apurada é desconhecido e
    // inflava σ: validado com dados reais, o intervalo de 90% acertava 98% das vezes).
    const completas = comDados.filter((u) => u.f >= 0.98);
    const paraSigma = completas.length >= 50 ? completas : comDados;
    // Mínimos quadrados ponderados de (r² − ruído da parte apurada) sobre [1, 1 / eleitorado].
    let s11 = 0; let s12 = 0; let s22 = 0; let t1 = 0; let t2 = 0;
    for (const u of paraSigma) {
      const r = u.y - u.base - u.x.reduce((t, xi, i) => t + xi * coef[i], 0);
      const w = 1 / (sig2(u) + u.vObs) ** 2;
      const h = 1 / (u.aptos / 1000);
      const e = r * r - u.vObs;
      s11 += w; s12 += w * h; s22 += w * h * h; t1 += w * e; t2 += w * h * e;
    }
    const det = s11 * s22 - s12 * s12;
    let a = det > 0 ? (s22 * t1 - s12 * t2) / det : t1 / s11;
    let b = det > 0 ? (s11 * t2 - s12 * t1) / det : 0;
    if (b < 0) { b = 0; a = t1 / s11; }
    sigA = lim(a, 0.003 ** 2, 0.1 ** 2);
    sigB = lim(b, 0, 0.05);
    sigma2 = sigA;
    if (grupos.length > 1 && gruposComDados.size >= 5) {
      const t2 = grupos.reduce((t, g, k) => t + coef[NG + k] ** 2 + cov[NG + k][NG + k], 0) / grupos.length;
      tau = Math.sqrt(lim(t2, 0.003 ** 2, 0.05 ** 2));
      grupos.forEach((_, k) => { priori[NG + k] = 1 / tau ** 2; });
    }
  }
  const prever = (u, c) => lim(u.base + u.x.reduce((t, xi, i) => t + xi * c[i], 0), 0.01, 0.99);

  // --- comparecimento e % de válidos esperados ---
  const apur = us.filter((u) => u.aptosApurados > 0 && u.comparecimento > 0);
  const razao = (f1, f2) => {
    const n = apur.reduce((t, u) => t + f2(u), 0);
    return n > 0 ? apur.reduce((t, u) => t + f1(u), 0) / n : 1;
  };
  const fracaoApur = apur.reduce((t, u) => t + u.aptosApurados, 0) / somaAptos;
  // Encolhido para 1 enquanto há pouco apurado (as primeiras urnas não representam o comparecimento).
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

  // --- previsão de cada cidade (linear nos coeficientes) ---
  // Fatia do que falta: m = (1 − w)·y + w·(base + x·coef), com w = vObs / (σ² + vObs) o peso da previsão.
  const fracao = us.reduce((t, u) => t + (u.aptosApurados ?? 0), 0) / somaAptos;
  const sComum = comDados.length ? 0.025 * (1 - fracao) ** 2 : 0;
  const varCoef = (u) => u.x.reduce((t, xi, i) => t + xi * cov[i].reduce((s, c, j) => s + c * u.x[j], 0), 0);
  // Por grupo: votos de A no que falta = C + D·coef (média), V = variância somada das cidades.
  const G = grupos.map((g) => ({ grupo: g, C: 0, D: new Array(K).fill(0), V: 0, R: 0, valid: 0, ve: 0, aptos: 0, apur: 0, votosA: 0, votosB: 0, t1A: 0, t1V: 0 }));
  for (const u of us) {
    const s2u = sig2(u);
    const w = u.y === null ? 1 : u.vObs / (s2u + u.vObs);
    u.previsto = prever(u, coef);
    u.restanteA = (1 - w) * (u.y ?? 0) + w * u.previsto;
    // + ruído de amostra dos votos que faltam (numa cidade pequena, poucos votos já oscilam sozinhos).
    const vRest = w * w * s2u + (u.y === null ? 0 : (1 - w) ** 2 * u.vObs) + (u.restante > 0 ? (u.previsto * (1 - u.previsto)) / u.restante : 0);
    const g = G[gi.get(u.grupo)];
    g.C += u.restante * ((1 - w) * (u.y ?? 0) + w * u.base);
    for (let i = 0; i < K; i += 1) if (u.x[i]) g.D[i] += u.restante * w * u.x[i];
    g.V += u.restante ** 2 * vRest;
    g.R += u.restante;
    g.valid += u.validos ?? 0;
    g.ve += u.validosEsperados;
    g.aptos += u.aptos;
    g.apur += u.aptosApurados ?? 0;
    g.votosA += u.votosA ?? 0;
    g.votosB += u.votosB ?? 0;
    g.t1A += u.t1.votosA;
    g.t1V += u.t1.validos;
    u.projecao = ((u.votosA ?? 0) + u.restante * u.restanteA) / u.validosEsperados;
    const dp = (u.restante / u.validosEsperados) * Math.sqrt(w * w * varCoef(u) + vRest + sComum ** 2);
    u.intervalo = [lim(u.projecao - 1.645 * dp, 0, 1), lim(u.projecao + 1.645 * dp, 0, 1)];
  }
  // Ao vivo: o apurado de cada grupo vem dos totais mais novos; os votos novos (apurados desde o
  // retrato das cidades, vindos do que faltava) corrigem a fatia prevista para o resto do grupo.
  for (const g of G) {
    const v = aoVivo?.[g.grupo];
    g.fatiaModelo = g.R > 0 ? lim((g.C + g.D.reduce((t, d, i) => t + d * coef[i], 0)) / g.R, 0, 1) : 0.5;
    g.fatiaRestante = g.fatiaModelo;
    g.k = 0;
    if (v && v.validos >= g.valid) {
      [g.votosAAgora, g.votosBAgora, g.validosAgora, g.apurAgora, g.aptosAgora] = [v.votosA, v.votosB, v.validos, v.aptosApurados, v.aptos ?? g.aptos];
      const dA = v.votosA - g.votosA;
      const dDois = dA + (v.votosB - g.votosB);
      if (g.R > 0 && dDois >= 500) {
        const yNovo = lim(dA / dDois, 0, 1);
        // Variância da fatia prevista (coeficientes + cidades) e da fatia nova como estimativa do resto.
        const dCovD = g.D.reduce((t, di, i) => t + di * cov[i].reduce((s2, c, j) => s2 + c * g.D[j], 0), 0);
        const vPrev = (dCovD + g.V) / g.R ** 2;
        // As primeiras urnas de um estado representam mal o resto: desvio de até 3,5 p.p., menor com a apuração.
        const fEstado = v.aptos ? v.aptosApurados / v.aptos : 0;
        const vNovo = 0.035 ** 2 * Math.max(0, 1 - fEstado) + (yNovo * (1 - yNovo)) / dDois;
        g.k = vPrev / (vPrev + vNovo);
        g.fatiaRestante = lim(g.fatiaModelo + g.k * (yNovo - g.fatiaModelo), 0, 1);
      }
    } else {
      [g.votosAAgora, g.votosBAgora, g.validosAgora, g.apurAgora, g.aptosAgora] = [g.votosA, g.votosB, g.valid, g.apur, g.aptos];
    }
    g.validosEsperados = Math.max(g.ve, g.validosAgora);
    g.faltaAgora = Math.max(0, g.validosEsperados - g.validosAgora);
  }

  // --- estimativa central ---
  const totV = G.reduce((t, g) => t + g.validosEsperados, 0);
  const votosAde = (g, fatia) => g.votosAAgora + g.faltaAgora * fatia;
  const totA = G.reduce((t, g) => t + votosAde(g, g.fatiaRestante), 0);

  // --- simulação por grupo ---
  const rng = aleatorio(semente);
  const L = cholesky(cov);
  const resultados = new Float64Array(simulacoes);
  const porGrupo = G.map(() => new Float64Array(simulacoes));
  let vitorias = 0;
  for (let s = 0; s < simulacoes; s += 1) {
    const z = Array.from({ length: K }, () => normal(rng));
    const c = coef.map((m, i) => m + L[i].reduce((t, l, j) => t + l * z[j], 0));
    const comum = sComum * normal(rng);
    let a = 0;
    G.forEach((g, k) => {
      let fatia = 0.5;
      if (g.R > 0) {
        // Desvio sorteado em torno da previsão do modelo, encolhido pela informação dos votos novos.
        const bruto = (g.C + g.D.reduce((t, d, i) => t + d * c[i], 0) + Math.sqrt(g.V) * normal(rng)) / g.R;
        fatia = lim(g.fatiaRestante + Math.sqrt(1 - g.k) * (bruto - g.fatiaModelo) + comum, 0, 1);
      }
      const votos = votosAde(g, fatia);
      porGrupo[k][s] = votos / g.validosEsperados;
      a += votos;
    });
    resultados[s] = a / totV;
    if (resultados[s] > 0.5) vitorias += 1;
  }
  const ordenados = [...resultados].sort((x, y) => x - y);
  // Teste da vantagem: H0 = o candidato que aparece atrás na projeção termina na frente. Valor p
  // unilateral pela aproximação normal da distribuição simulada (resolve valores abaixo de 1/simulações).
  const mediaSim = ordenados.reduce((t, x) => t + x, 0) / simulacoes;
  const dpSim = Math.sqrt(ordenados.reduce((t, x) => t + (x - mediaSim) ** 2, 0) / Math.max(1, simulacoes - 1));
  const zVantagem = dpSim > 0 ? Math.abs(mediaSim - 0.5) / dpSim : Infinity;
  const teste = { z: zVantagem, p: Number.isFinite(zVantagem) ? valorP(zVantagem) / 2 : 0, dp: dpSim };
  G.forEach((g, k) => {
    const o = [...porGrupo[k]].sort((x, y) => x - y);
    g.projecao = votosAde(g, g.fatiaRestante) / g.validosEsperados;
    g.intervalo = [quantilOrdenado(o, 0.05), quantilOrdenado(o, 0.95)];
    g.f = g.aptosAgora ? g.apurAgora / g.aptosAgora : 0;
    g.y = g.votosAAgora + g.votosBAgora > 0 ? g.votosAAgora / (g.votosAAgora + g.votosBAgora) : null;
    g.restante = g.faltaAgora;
    g.A1 = g.t1V ? g.t1A / g.t1V : null;
    g.previsto = g.fatiaRestante;
  });
  const apuradoA = G.reduce((t, g) => t + g.votosAAgora, 0);
  const apuradoDois = G.reduce((t, g) => t + g.votosAAgora + g.votosBAgora, 0);
  return {
    unidades: us,
    grupos: G,
    projecao: totA / totV,
    intervalo: [quantilOrdenado(ordenados, 0.05), quantilOrdenado(ordenados, 0.95)],
    chanceA: vitorias / simulacoes,
    teste,
    simulacoes: ordenados,
    apuradoA: apuradoDois ? apuradoA / apuradoDois : null,
    fracaoApurada: G.reduce((t, g) => t + g.apurAgora, 0) / G.reduce((t, g) => t + g.aptosAgora, 0),
    validosEsperados: totV,
    modelo: {
      delta: coef[0], beta: coef[1], betaA: coef[2], sigma: Math.sqrt(sigma2), sigmaPequenas: sigB, n: comDados.length, mediaOutros: mO, desvioComum: sComum,
      efeitos: Object.fromEntries(grupos.map((g, i) => [g, coef[NG + i]])),
      // Coeficientes gerais com desvio padrão a posteriori e valor p bilateral (H0: coeficiente = 0).
      coeficientes: ['δ (mudança geral)', 'βO (votos dos outros candidatos)', 'βA (força no 1º turno)', ...extras.map((e) => VARIAVEIS[e.nome].rotulo)]
        .map((nome, i) => ({ nome, valor: coef[i], dp: Math.sqrt(cov[i][i]), p: valorP(coef[i] / Math.sqrt(cov[i][i])) })),
      coef, cov, NG, tau,
    },
  };
}

/**
 * Unidades do modelo a partir das listas de locais do 2º e do 1º turno (formato de /api/estados,
 * /api/municipios e dos retratos): `chave` identifica o local nas duas listas, `grupo` (opcional) o
 * estado de cada um, `a` e `b` são os números dos dois.
 */
export function montarUnidades({ l2, l1, chave, nome, grupo = () => '', a, b }) {
  const t1 = new Map(l1.map((r) => [chave(r), r]));
  return l2.map((r) => {
    const p = t1.get(chave(r));
    return {
      id: chave(r), nome: nome(r), grupo: grupo(r), aptos: r.eleitorado, aptosApurados: r.aptosTotalizadas ?? 0,
      comparecimento: r.comparecimento ?? 0, validos: r.validos ?? 0, votosA: r.cand?.[a] ?? 0, votosB: r.cand?.[b] ?? 0,
      t1: p ? { aptos: p.eleitorado, comparecimento: p.comparecimento, validos: p.validos, votosA: p.cand?.[a] ?? 0, votosB: p.cand?.[b] ?? 0 } : null,
    };
  });
}

/** Os dois candidatos do 2º turno: pelos votos do 2º turno ou, antes deles, do 1º. */
export function doisDaDisputa(nomes, l2, l1) {
  const soma = (lista, n) => lista.reduce((t, r) => t + (r.cand?.[n] ?? 0), 0);
  const temVotos2 = Object.keys(nomes).some((n) => soma(l2, n) > 0);
  return Object.keys(nomes).sort((x, y) => (temVotos2 ? soma(l2, y) - soma(l2, x) : soma(l1, y) - soma(l1, x))).slice(0, 2);
}
