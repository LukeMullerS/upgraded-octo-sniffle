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
