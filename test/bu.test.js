import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerBer, lerBoletim } from '../public/bu.js';

// Boletim de urna real (publicado pelo TSE): Boa Vista (RR), zona 1, seção 560, 1º turno de 2026.
const BU = new Uint8Array(readFileSync(new URL('./fixtures/bu-rr-03018-z0001-s0560.dat', import.meta.url)));

test('boletim de urna: identificação da seção, horários e eleições', () => {
  const r = lerBoletim(BU);
  assert.deepEqual([r.municipio, r.zona, r.local, r.secao], ['03018', '0001', 3344, '0560']);
  assert.equal(r.abertura, '04/10/2026 07:00:01');
  assert.equal(r.encerramento, '04/10/2026 16:05:21');
  assert.deepEqual(r.eleicoes.map((e) => [e.eleicao, e.aptos]), [['6257', 304], ['6259', 304]]);
});

test('boletim de urna: votos de cada cargo somam o comparecimento (2 votos por eleitor no Senado)', () => {
  const cargos = lerBoletim(BU).eleicoes.flatMap((e) => e.cargos);
  assert.deepEqual(cargos.map((c) => c.cargo).sort(), [1, 3, 5, 6, 7]);
  for (const c of cargos) {
    const soma = c.votos.reduce((t, v) => t + v.votos, 0);
    assert.equal(soma, c.comparecimento * (c.cargo === 5 ? 2 : 1), `cargo ${c.cargo}`);
  }
  const pres = cargos.find((c) => c.cargo === 1);
  assert.deepEqual(pres.votos.find((v) => v.numero === 22), { tipo: 'nominal', votos: 158, partido: 22, numero: 22 });
  assert.equal(pres.votos.find((v) => v.tipo === 'branco').votos, 4);
});

test('BER: tamanhos longos, marcas de contexto e arquivo que não é boletim', () => {
  const [seq] = lerBer(new Uint8Array([0x30, 0x81, 0x03, 0x82, 0x01, 0x07]));
  assert.equal(seq.filhos[0].cls, 2);
  assert.equal(seq.filhos[0].tag, 2);
  assert.throws(() => lerBer(new Uint8Array([0x30, 0x05, 0x02])), /corrompido/);
  assert.throws(() => lerBoletim(new Uint8Array([0x02, 0x01, 0x05])), /não é um boletim/);
});
