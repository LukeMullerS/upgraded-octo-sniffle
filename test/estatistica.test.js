import test from 'node:test';
import assert from 'node:assert/strict';
import {
  correlacao, desvioPadrao, escoreZ, histograma, media, mediaPonderada, mediana, passoRedondo,
  quantil, resumoEstatistico, valorMetrica,
} from '../public/estatistica.js';

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
  const { regressaoLinear, resumoCaixa } = await import('../public/estatistica.js');
  const r = regressaoLinear([1, 2, 3, 4], [3, 5, 7, 9]);
  assert.ok(Math.abs(r.a - 1) < 1e-9 && Math.abs(r.b - 2) < 1e-9 && Math.abs(r.r2 - 1) < 1e-9);
  assert.equal(regressaoLinear([1, 1, 1], [1, 2, 3]), null);
  const c = resumoCaixa([1, 2, 3, 4, 100]);
  assert.equal(c.mediana, 3);
  assert.deepEqual(c.atipicos, [100]);
  assert.equal(c.max, 4);
});

test('valores-p conferidos com tabelas', async () => {
  const { pValorT, pValorF, testeCorrelacao, anovaUmFator } = await import('../public/estatistica.js');
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
