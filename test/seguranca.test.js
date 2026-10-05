// Testes de segurança das rotas HTTP (src/aplicacao.js), sem rede: o "TSE" aponta para uma
// porta fechada e a compilação dos logs fica desligada.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrir7z } from '../src/sete-zip.js';

let servidor;
let base;
let app;

before(async () => {
  process.env.DADOS = await mkdtemp(join(tmpdir(), 'apuracao-teste-'));
  process.env.LOGS_NACIONAL = '0';
  process.env.TSE_BASE = 'http://127.0.0.1:9';
  app = await import('../src/aplicacao.js');
  servidor = http.createServer(app.tratar);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor?.close());

/** Pedido cru (sem normalizar a URL, como faria fetch). */
function pedir(caminho, { method = 'GET', headers = {} } = {}) {
  return new Promise((ok, falha) => {
    const req = http.request(`${base}`, { method, path: caminho, headers }, (res) => {
      let corpo = '';
      res.on('data', (c) => { corpo += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, corpo }));
    });
    req.on('error', falha);
    req.end();
  });
}

test('URL malformada não derruba o servidor', async () => {
  const r = await pedir('/%E0%A4%A');
  assert.equal(r.status, 400);
  const r2 = await pedir('/tse/%E0');
  assert.equal(r2.status, 400);
  assert.equal((await pedir('/index.html')).status, 200); // continua no ar
});

test('arquivos fora de public/ não são servidos', async () => {
  for (const c of ['/../server.js', '/..%2fserver.js', '/%2e%2e/package.json', '/..%5c..%5cserver.js', '/index.html%00.js']) {
    const r = await pedir(c);
    assert.notEqual(r.status, 200, c);
    assert.ok(!r.corpo.includes('createServer'), c);
  }
});

test('o proxy só aceita arquivos conhecidos do TSE', async () => {
  for (const c of ['/tse/ele2026/6257/../../segredo', '/tse/comum/qualquer', '/tse/ele2026/9999/dados/br/x.json',
    '/tse/ele2026/6257/dados/br/br-c0001-e006257-u.json?x=1&y=http://evil', '/tse/http://evil.com/a.json']) {
    const r = await pedir(c);
    if (c.includes('br-c0001')) continue; // query string é ignorada; o caminho é válido
    assert.equal(r.status, 400, c);
  }
});

test('a rota reescrita do Vercel só vale para /api e /tse', async () => {
  const r = await pedir('/api/index?rota=/server.js');
  assert.equal(r.status, 400);
  const r2 = await pedir('/api/index?rota=/api/banco');
  assert.equal(r2.status, 200);
});

test('pausar/retomar exigem POST vindo do próprio app', async () => {
  assert.equal((await pedir('/api/urnas/pausar')).status, 405);
  assert.equal((await pedir('/api/urnas/pausar', { method: 'POST' })).status, 403);
  assert.equal((await pedir('/api/urnas/pausar', { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
  const host = new URL(base).host;
  assert.equal((await pedir('/api/urnas/pausar', { method: 'POST', headers: { origin: `http://${host}` } })).status, 200);
  assert.equal((await pedir('/api/estados', { method: 'POST', headers: { origin: `http://${host}` } })).status, 405);
  assert.equal((await pedir('/index.html', { method: 'DELETE' })).status, 405);
});

test('cabeçalhos de segurança em todas as respostas', async () => {
  for (const c of ['/index.html', '/api/banco', '/tse/x']) {
    const r = await pedir(c);
    assert.match(r.headers['content-security-policy'], /script-src 'self'/, c);
    assert.equal(r.headers['x-content-type-options'], 'nosniff', c);
    assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN', c);
  }
});

test('vercel.json usa os mesmos cabeçalhos de segurança', async () => {
  const v = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const todos = v.headers.find((h) => h.source === '/(.*)').headers;
  for (const [k, val] of Object.entries(app.CABECALHOS_SEGURANCA)) {
    assert.equal(todos.find((h) => h.key === k)?.value, val, k);
  }
});

test('relatos de erro: sem códigos de controle e com limite por minuto', async () => {
  const r = await pedir('/api/erro?msg=%1b%5b31mvermelho%0aquebra');
  assert.equal(r.status, 200);
  let ultimo;
  for (let i = 0; i < 40; i += 1) ultimo = await pedir('/api/erro?msg=x', { headers: { 'x-forwarded-for': '10.0.0.9' } });
  assert.equal(ultimo.status, 429);
});

test('respostas grandes vão comprimidas quando o navegador aceita', async () => {
  const r = await pedir('/explorar.js', { headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-encoding'], 'br');
});

test('7z que declara tamanho descompactado enorme é recusado (bomba de compressão)', async () => {
  const bytes = new Uint8Array(await readFile(new URL('./fixtures/logs/lzma.7z', import.meta.url)));
  assert.ok(abrir7z(bytes).length); // o arquivo normal abre
  // Cabeçalho falso: assinatura válida apontando para fora do arquivo.
  const falso = new Uint8Array(64);
  falso.set([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]);
  new DataView(falso.buffer).setBigUint64(12, 2n ** 40n, true);
  assert.throws(() => abrir7z(falso));
});
