import test from 'node:test';
import assert from 'node:assert/strict';
import { politicaTse } from '../src/aplicacao.js';
import { cargosDoTurno, lerArgumentos } from '../scripts/atualizar-resultados.mjs';

const arq = 'ele2026/6257/dados/br/br-c0001-e006257-u.json';
const corpo = (st, ts) => Buffer.from(JSON.stringify({ s: { st: String(st), ts: String(ts) } }));

test('resultado com 100% das seções é final; em apuração, 20 s; falha nunca fica no CDN', () => {
  assert.equal(politicaTse(arq, 200, corpo(471906, 471906)), 'final');
  assert.equal(politicaTse(arq, 200, corpo(1000, 471906)), 'ao-vivo');
  assert.equal(politicaTse(arq, 200, corpo(0, 0)), 'ao-vivo');
  assert.equal(politicaTse(arq, 404, Buffer.from('não publicado')), 'ao-vivo');
  assert.equal(politicaTse(arq, 502, Buffer.from('{}')), null);
  assert.equal(politicaTse(arq, 200, Buffer.from('não é json')), 'ao-vivo');
  assert.equal(politicaTse('ele2026/6257/config/mun-e006257-cm.json', 200, Buffer.from('{}')), 'config');
  assert.equal(politicaTse('ele2026/6257/fotos/br/123.jpeg', 200, Buffer.from('')), 'foto');
});

test('script de retratos: turnos e argumentos', () => {
  assert.deepEqual(cargosDoTurno(2), ['6258:1', '6260:3']);
  assert.ok(cargosDoTurno(1).includes('6259:7') && !cargosDoTurno(1).some((c) => c.startsWith('6258')));
  assert.deepEqual(lerArgumentos(['--turno', '2', '--acompanhar']), { cargos: ['6258:1', '6260:3'], turno: 2, acompanhar: 20, tudo: false, maxMinutos: 0 });
  assert.equal(lerArgumentos(['--acompanhar=60', '6257:1']).acompanhar, 60);
  assert.deepEqual(lerArgumentos(['6257:1', '--tudo', '--max-minutos=8']).cargos, ['6257:1']);
  assert.throws(() => lerArgumentos(['--turno', '3']));
  assert.throws(() => lerArgumentos(['--qualquer']));
});
