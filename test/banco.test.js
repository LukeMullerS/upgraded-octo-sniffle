import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarBanco } from '../src/banco.js';
import { createHash } from 'node:crypto';

// TSE falso com ETag; `atraso` segura a resposta para testar a fila.
function tse(arquivos, { atraso = 0 } = {}) {
  const log = [];
  const etag = (c) => `"${createHash('sha1').update(JSON.stringify(arquivos[c])).digest('hex')}"`;
  const buscar = async (url, { headers = {} } = {}) => {
    const c = url.replace('https://x/', '');
    if (atraso) await new Promise((r) => setTimeout(r, atraso));
    const h = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });
    if (arquivos[c] === 'calma') { log.push([c, 429]); return { status: 429, ok: false, headers: h({ 'retry-after': '1' }), arrayBuffer: async () => new ArrayBuffer(0) }; }
    if (!(c in arquivos)) { log.push([c, 404]); return { status: 404, ok: false, headers: h({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
    if (headers['If-None-Match'] === etag(c)) { log.push([c, 304]); return { status: 304, ok: false, headers: h({}), arrayBuffer: async () => new ArrayBuffer(0) }; }
    log.push([c, 200]);
    return { status: 200, ok: true, headers: h({ etag: etag(c), 'content-type': 'application/json' }), arrayBuffer: async () => Buffer.from(JSON.stringify(arquivos[c])) };
  };
  return { buscar, log };
}

const semTimers = { setInterval: () => 0, clearInterval: () => {}, setTimeout };

test('baixa uma vez, confere com 304 e reprocessa só quando muda', async () => {
  const arquivos = { 'a.json': { v: 1 } };
  const t = tse(arquivos);
  let relogio = 0;
  const banco = criarBanco({ base: 'https://x', buscar: t.buscar, relogio: semTimers, agora: () => relogio, intervaloMs: 1000 });
  let chamadas = 0;
  const op = { processar: (j) => { chamadas += 1; return j.v * 10; }, nome: 'dez' };
  assert.equal((await banco.buscar('a.json', op)).valor, 10);
  assert.equal((await banco.buscar('a.json', op)).valor, 10, 'arquivo novo não é consultado de novo');
  relogio += 2000;
  assert.equal(banco.obter('a.json', op).valor, 10, 'arquivo velho responde já com o valor que tem');
  await banco.atualizar('a.json', op);
  assert.deepEqual(t.log.map((x) => x[1]), [200, 304]);
  assert.equal(chamadas, 1, '304 não reprocessa');
  arquivos['a.json'] = { v: 2 };
  assert.equal((await banco.atualizar('a.json', op)).valor, 20);
  assert.equal(chamadas, 2);
});

test('pedidos simultâneos do mesmo arquivo viram um só', async () => {
  const t = tse({ 'b.json': [1] }, { atraso: 20 });
  const banco = criarBanco({ base: 'https://x', buscar: t.buscar, relogio: semTimers });
  await Promise.all([banco.buscar('b.json'), banco.buscar('b.json'), banco.buscar('b.json')]);
  assert.equal(t.log.length, 1);
});

test('obter responde na hora (pendente) e 404 vira indisponível', async () => {
  const t = tse({}, { atraso: 10 });
  const banco = criarBanco({ base: 'https://x', buscar: t.buscar, relogio: semTimers });
  const r = banco.obter('nao.json');
  assert.equal(r.pendente, true);
  assert.equal(r.valor, null);
  const r2 = await banco.buscar('nao.json');
  assert.equal(r2.estado, 'indisponivel');
  assert.equal((await banco.bruto('nao.json')).status, 404);
});

test('guarda só o resumo, mas o proxy recebe o arquivo inteiro quando pede', async () => {
  const arquivos = { 'c.json': { grande: 'x'.repeat(1000) } };
  const t = tse(arquivos);
  const banco = criarBanco({ base: 'https://x', buscar: t.buscar, relogio: semTimers });
  await banco.buscar('c.json', { processar: (j) => j.grande.length, nome: 'n' });
  assert.equal(banco.entradas.get('c.json').conteudo, null, 'só o resumo fica na memória');
  const b = await banco.bruto('c.json');
  assert.equal(b.status, 200);
  assert.equal(JSON.parse(b.corpo).grande.length, 1000);
  assert.deepEqual(t.log.map((x) => x[1]), [200, 200], 'a segunda vez baixa inteiro, sem condicional');
});

test('429 pausa a fila; resumos voltam do disco', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'banco-'));
  const t = tse({ 'calma.json': 'calma', 'd.json': { v: 5 } });
  const banco = criarBanco({ base: 'https://x', buscar: t.buscar, relogio: semTimers, arquivoDisco: join(pasta, 'b.json') });
  const r = await banco.buscar('calma.json');
  assert.equal(r.estado, 'erro');
  assert.ok(banco.status().pausadoAte, 'fila pausada pelo Retry-After');
  await banco.buscar('d.json', { processar: (j) => j.v, nome: 'v', esperarMs: 3000 });
  await banco.salvarDisco();
  const outro = criarBanco({ base: 'https://x', buscar: async () => new Promise(() => {}), relogio: semTimers, arquivoDisco: join(pasta, 'b.json') });
  assert.equal(await outro.carregarDisco(), 1);
  assert.equal(outro.obter('d.json', { processar: (j) => j.v, nome: 'v' }).valor, 5, 'valor salvo responde antes do TSE');
});
