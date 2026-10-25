import test from 'node:test';
import assert from 'node:assert/strict';
import { acrescentar } from '../scripts/historico-apuracao.mjs';

test('histórico: só acrescenta ponto quando a apuração anda', () => {
  const pontos = [];
  assert.equal(acrescentar(pontos, { t: '1', ap: 0.1, a: 10, b: 8 }), true);
  assert.equal(acrescentar(pontos, { t: '2', ap: 0.1, a: 10, b: 8 }), false);
  assert.equal(acrescentar(pontos, { t: '3', ap: 0.12, a: 12, b: 9 }), true);
  assert.deepEqual(pontos.map((p) => p.t), ['1', '3']);
});

import { corrigirOrdem } from '../scripts/historico-apuracao.mjs';

test('histórico: desinverte os pontos gravados com a ordem trocada a partir de 22:45', () => {
  const h = { numeros: { a: '22', b: '13' }, nomes: { a: ['F', 'PL'], b: ['L', 'PT'] }, pontos: [
    { t: '2026-10-25T22:44:00Z', ap: 0.13, a: 800, b: 790, p: 0.504, lo: 0.47, hi: 0.54, c: 0.6 }, // gravado com a = 13
    { t: '2026-10-25T22:47:00Z', ap: 0.15, a: 950, b: 940, p: 0.495, lo: 0.46, hi: 0.53, c: 0.4 }, // gravado com a = 22
  ] };
  assert.equal(corrigirOrdem(h, '13', '22'), true);
  assert.deepEqual(h.numeros, { a: '13', b: '22' });
  assert.deepEqual([h.pontos[0].a, h.pontos[0].b, h.pontos[0].p], [800, 790, 0.504]);
  assert.deepEqual([h.pontos[1].a, h.pontos[1].b, h.pontos[1].p, h.pontos[1].lo, h.pontos[1].hi], [940, 950, 0.505, 0.47, 0.54]);
  assert.equal(corrigirOrdem(h, '13', '22'), false); // uma vez só
});
