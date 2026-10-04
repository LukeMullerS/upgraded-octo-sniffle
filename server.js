#!/usr/bin/env node
// Servidor do app de apuração: entrega os arquivos de `public/` e faz proxy de
// `/tse/*` para https://resultados.tse.jus.br/oficial/*.
//
// O proxy existe porque o CDN do TSE recusa clientes sem User-Agent de navegador e
// não garante CORS para outras origens. Ele também guarda as respostas por alguns
// segundos, para que vários navegadores abertos não multipliquem as consultas.
// Sem dependências: precisa só do Node.js 18+.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTA = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const TSE_BASE = (process.env.TSE_BASE || 'https://resultados.tse.jus.br/oficial').replace(/\/$/, '');
const CACHE_DADOS_MS = 30_000;
const CACHE_ESTATICO_MS = 60 * 60_000;
const TIMEOUT_MS = 15_000;

const PUBLICO = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const CABECALHOS_TSE = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  Accept: 'application/json,image/*,*/*',
};

const cache = new Map(); // caminho → { expira, status, tipo, corpo }
const emAndamento = new Map(); // caminho → Promise (evita consultas duplicadas simultâneas)

async function buscarNoTse(caminho) {
  const salvo = cache.get(caminho);
  if (salvo && salvo.expira > Date.now()) return salvo;
  if (emAndamento.has(caminho)) return emAndamento.get(caminho);

  const promessa = (async () => {
    const res = await fetch(`${TSE_BASE}/${caminho}`, {
      headers: CABECALHOS_TSE,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const corpo = Buffer.from(await res.arrayBuffer());
    const estatico = caminho.includes('/fotos/') || caminho.includes('/config/');
    const resposta = {
      status: res.status,
      tipo: res.headers.get('content-type') || 'application/octet-stream',
      corpo,
      // 404 é comum antes da publicação de um arquivo; guarda por pouco tempo.
      expira: Date.now() + (res.ok ? (estatico ? CACHE_ESTATICO_MS : CACHE_DADOS_MS) : 15_000),
    };
    if (res.ok || res.status === 404 || res.status === 403) cache.set(caminho, resposta);
    return resposta;
  })().finally(() => emAndamento.delete(caminho));

  emAndamento.set(caminho, promessa);
  return promessa;
}

async function proxy(req, res, caminho) {
  // Só caminhos de arquivo simples do ciclo de resultados: nada de "..", query ou host arbitrário.
  if (!/^(ele\d{4}|comum)\/[\w\-./]+$/.test(caminho) || caminho.includes('..')) {
    res.writeHead(400).end('caminho inválido');
    return;
  }
  try {
    const r = await buscarNoTse(caminho);
    res.writeHead(r.status, {
      'content-type': r.tipo,
      'cache-control': 'no-cache',
      'x-tse-cache-expira': new Date(r.expira).toISOString(),
    });
    res.end(r.corpo);
  } catch (erro) {
    const mensagem = erro?.name === 'TimeoutError' ? 'TSE não respondeu a tempo' : `falha ao consultar o TSE: ${erro.message}`;
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ erro: mensagem }));
  }
}

async function estatico(res, caminho) {
  const relativo = normalize(caminho === '/' ? '/index.html' : caminho).replace(/^(\.\.[/\\])+/, '');
  const arquivo = join(PUBLICO, relativo);
  if (!arquivo.startsWith(PUBLICO)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const corpo = await readFile(arquivo);
    res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] || 'application/octet-stream' }).end(corpo);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('não encontrado');
  }
}

const servidor = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/tse/')) return proxy(req, res, decodeURIComponent(pathname.slice(5)));
  return estatico(res, decodeURIComponent(pathname));
});

servidor.listen(PORTA, HOST, () => {
  console.log(`Apuração 2026 em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}`);
  console.log(`Dados: ${TSE_BASE}`);
});
