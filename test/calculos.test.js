import test from 'node:test';
import assert from 'node:assert/strict';
import {
  correlacao, desvioPadrao, escoreZ, histograma, media, mediaPonderada, mediana, passoRedondo,
  quantil, resumoEstatistico, valorMetrica, vizinhancaDeMalha, moranGlobal, lisa, kmedias, padronizar, silhueta,
} from '../public/calculos.js';

const local = (nome, total, brancos, nulos, extra = {}) => ({ nome, total, brancos, nulos, anulados: 0, ...extra });

test('medidas básicas', () => {
  assert.equal(media([1, 2, 3, 4]), 2.5);
  assert.equal(mediana([5, 1, 3]), 3);
  assert.equal(mediana([1, 2, 3, 4]), 2.5);
  assert.equal(quantil([1, 2, 3, 4, 5], 0.25), 2);
  assert.ok(Math.abs(desvioPadrao([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.001);
  assert.equal(desvioPadrao([3]), 0);
});

test('média ponderada difere da simples quando os portes diferem', () => {
  const linhas = [local('grande', 1000, 10, 0), local('pequena', 10, 5, 0)];
  assert.equal(mediaPonderada(linhas, 'pctBrancos'), (15 / 1010) * 100);
  assert.equal(media(linhas.map((l) => valorMetrica(l, 'pctBrancos'))), 25.5);
});

test('resumoEstatistico ignora locais sem votos e acha extremos', () => {
  const linhas = [local('A', 100, 1, 1), local('B', 100, 5, 5), local('C', 100, 3, 3), local('vazia', 0, 0, 0)];
  const r = resumoEstatistico(linhas, 'pctBrancosNulos');
  assert.equal(r.n, 3);
  assert.equal(r.min.linha.nome, 'A');
  assert.equal(r.max.linha.nome, 'B');
  assert.equal(r.mediana, 6);
  assert.equal(escoreZ(10, r), 1);
  assert.equal(resumoEstatistico([local('vazia', 0, 0, 0)], 'pctBrancos'), null);
});

test('abstenção usa aptos das seções totalizadas', () => {
  assert.equal(valorMetrica({ abstencao: 25, aptosTotalizadas: 100 }, 'pctAbstencao'), 25);
});

test('histograma com faixas redondas', () => {
  assert.equal(passoRedondo(10, 10), 1);
  assert.equal(passoRedondo(3, 12), 0.25);
  const h = histograma([1.1, 1.2, 2.9, 3.0, 9.99], 10);
  assert.equal(h.passo, 1);
  assert.equal(h.faixas[0].inicio, 1);
  assert.equal(h.faixas.reduce((t, f) => t + f.contagem, 0), 5);
  assert.equal(h.faixas.at(-1).contagem, 1);
  assert.deepEqual(histograma([]).faixas, []);
  assert.equal(histograma([4, 4, 4]).faixas.reduce((t, f) => t + f.contagem, 0), 3);
});

test('correlação', () => {
  assert.ok(Math.abs(correlacao([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
  assert.ok(Math.abs(correlacao([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-9);
  assert.equal(correlacao([1, 2], [1, 2]), null);
});

test('regressão linear e caixa', async () => {
  const { regressaoLinear, resumoCaixa } = await import('../public/calculos.js');
  const r = regressaoLinear([1, 2, 3, 4], [3, 5, 7, 9]);
  assert.ok(Math.abs(r.a - 1) < 1e-9 && Math.abs(r.b - 2) < 1e-9 && Math.abs(r.r2 - 1) < 1e-9);
  assert.equal(regressaoLinear([1, 1, 1], [1, 2, 3]), null);
  const c = resumoCaixa([1, 2, 3, 4, 100]);
  assert.equal(c.mediana, 3);
  assert.deepEqual(c.atipicos, [100]);
  assert.equal(c.max, 4);
});

test('valores-p conferidos com tabelas', async () => {
  const { pValorT, pValorF, testeCorrelacao, anovaUmFator } = await import('../public/calculos.js');
  assert.ok(Math.abs(pValorT(2.0, 10) - 0.0734) < 0.0005);
  assert.ok(Math.abs(pValorT(2.228, 10) - 0.05) < 0.0005);
  assert.ok(Math.abs(pValorF(4.103, 2, 10) - 0.05) < 0.0005);
  assert.ok(Math.abs(testeCorrelacao(0.5, 30).p - 0.0049) < 0.0005);
  const a = anovaUmFator([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  assert.equal(a.gl1, 2);
  assert.equal(a.gl2, 6);
  assert.ok(Math.abs(a.f - 27) < 1e-9);
  assert.ok(Math.abs(a.eta2 - 0.9) < 1e-9);
});

test('Spearman, teste t de Welch e regressão múltipla', async () => {
  const { spearman, testeTWelch, regressaoMultipla, regressaoLinear } = await import('../public/calculos.js');
  assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 100]) - 1) < 1e-9, 'monótona = 1, mesmo não linear');
  assert.ok(Math.abs(spearman([1, 2, 2, 3], [4, 3, 3, 1]) + 1) < 1e-9, 'empates com postos médios');
  const t = testeTWelch([5, 6, 7, 8, 9], [1, 2, 3, 4, 5]);
  assert.equal(t.diferenca, 4);
  assert.ok(Math.abs(t.t - 4) < 1e-9);
  assert.ok(Math.abs(t.gl - 8) < 1e-9);
  assert.ok(t.p < 0.01);
  // y = 1 + 2·x1 − 3·x2 (exato): coeficientes recuperados e R² = 1.
  const X = [[1, 0], [2, 1], [3, 1], [4, 3], [5, 2], [6, 5], [7, 4]];
  const y = X.map(([a, b]) => 1 + 2 * a - 3 * b);
  const r = regressaoMultipla(y, X);
  assert.ok(Math.abs(r.coeficientes[0].coef - 1) < 1e-6);
  assert.ok(Math.abs(r.coeficientes[1].coef - 2) < 1e-6);
  assert.ok(Math.abs(r.coeficientes[2].coef + 3) < 1e-6);
  assert.ok(Math.abs(r.r2 - 1) < 1e-9);
  // Com ruído, confere com a regressão simples quando há uma só variável.
  const ys = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2];
  const xs = [[1], [2], [3], [4], [5], [6]];
  const rm = regressaoMultipla(ys, xs);
  const simples = regressaoLinear(xs.map((v) => v[0]), ys);
  assert.ok(Math.abs(rm.coeficientes[1].coef - simples.b) < 1e-9);
  assert.ok(Math.abs(rm.coeficientes[0].coef - simples.a) < 1e-9);
  assert.ok(Math.abs(rm.r2 - simples.r2) < 1e-9);
  assert.equal(regressaoMultipla([1, 2], [[1], [2]]), null, 'poucos dados');
  assert.equal(regressaoMultipla([1, 2, 3, 4], [[1, 2], [2, 4], [3, 6], [4, 8]]), null, 'colinear');
});

// Grade n×n de quadrados (GeoJSON), código "lin-col".
function grade(n) {
  const features = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const anel = [[j, i], [j + 1, i], [j + 1, i + 1], [j, i + 1], [j, i]];
      features.push({ properties: { codarea: `${i}-${j}` }, geometry: { type: 'MultiPolygon', coordinates: [[anel]] } });
    }
  }
  return features;
}

test('vizinhança rainha numa grade', () => {
  const v = vizinhancaDeMalha(grade(3));
  assert.equal(v.get('1-1').size, 8, 'centro tem 8 vizinhos');
  assert.equal(v.get('0-0').size, 3, 'canto tem 3');
});

test('I de Moran: agrupado > 0 e significativo; tabuleiro de xadrez < 0', () => {
  const g = grade(8);
  const viz = vizinhancaDeMalha(g);
  const agrupado = new Map(g.map((f) => { const [i] = f.properties.codarea.split('-').map(Number); return [f.properties.codarea, i < 4 ? 10 + i : i]; }));
  const m = moranGlobal(agrupado, viz, { permutacoes: 199 });
  assert.ok(m.I > 0.5, `I=${m.I}`);
  assert.ok(m.p < 0.05);
  // Xadrez com vizinhança "torre" (só lados): vizinhos sempre diferentes.
  const torre = new Map([...viz].map(([c, s]) => { const [i, j] = c.split('-').map(Number); return [c, new Set([...s].filter((o) => { const [a, b] = o.split('-').map(Number); return a === i || b === j; }))]; }));
  const xadrez = new Map(g.map((f) => { const [i, j] = f.properties.codarea.split('-').map(Number); return [f.properties.codarea, (i + j) % 2]; }));
  assert.ok(moranGlobal(xadrez, torre, { permutacoes: 99 }).I < -0.9);
  const l = lisa(agrupado, viz, { permutacoes: 199 });
  assert.equal(l.get('6-6').quadrante, 'Baixo-Baixo');
  assert.equal(l.get('2-2').quadrante, 'Alto-Alto');
});

test('k-médias separa grupos evidentes e a silhueta é alta', () => {
  const pontos = [...Array.from({ length: 20 }, (_, i) => [0 + (i % 3) * 0.1, 0]), ...Array.from({ length: 20 }, (_, i) => [10 + (i % 3) * 0.1, 10])];
  const { z } = padronizar(pontos);
  const r = kmedias(z, 2);
  assert.equal(new Set(r.grupos.slice(0, 20)).size, 1);
  assert.notEqual(r.grupos[0], r.grupos[39]);
  assert.ok(silhueta(z, r.grupos) > 0.9);
  assert.equal(kmedias([[1]], 3), null);
});
