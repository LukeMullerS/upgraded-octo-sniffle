#!/usr/bin/env node
// Servidor do app de apuração: entrega os arquivos de `public/` e faz proxy de
// `/tse/*` para https://resultados.tse.jus.br/oficial/*.
//
// O proxy existe porque o CDN do TSE recusa clientes sem User-Agent de navegador e
// não garante CORS para outras origens. Ele também guarda as respostas por alguns
// segundos, para que vários navegadores abertos não multipliquem as consultas.
// Em `/api/*` serve os brancos e nulos por estado e por município (ver src/coletor.js).
// Sem dependências: precisa só do Node.js 18+.

import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarColetor } from './src/coletor.js';
import { ELEICOES } from './public/tse.js';

const PORTA = Number(process.env.PORT) || 3000;
// `--rede` (ou HOST=0.0.0.0) abre o app para outros aparelhos da rede, como o celular.
const REDE = process.argv.includes('--rede');
const HOST = process.env.HOST || (REDE ? '0.0.0.0' : '127.0.0.1');
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

/** JSON de um arquivo do TSE (com o mesmo cache do proxy); null quando ainda não publicado. */
async function buscarJson(caminho) {
  const r = await buscarNoTse(caminho);
  if (r.status === 404 || r.status === 403) return null;
  if (r.status < 200 || r.status >= 300) throw new Error(`TSE respondeu HTTP ${r.status}`);
  return JSON.parse(r.corpo.toString('utf8'));
}

const coletor = criarColetor({ buscarJson });

function json(res, status, dados) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(dados));
}

async function api(res, pathname, params) {
  const eleicao = ELEICOES[params.get('ele')];
  const cargo = eleicao?.cargos.find((c) => c.codigo !== null && String(c.codigo) === params.get('cargo'));
  if (!cargo) return json(res, 400, { erro: 'eleição ou cargo inválido' });
  try {
    if (pathname === '/api/estados') {
      return json(res, 200, await coletor.estados(eleicao.codigo, cargo.codigo, cargo.abrangencias));
    }
    if (pathname === '/api/municipios') {
      const uf = params.get('uf');
      if (uf === 'todas') {
        return json(res, 200, await coletor.todas(eleicao.codigo, cargo.codigo, cargo.abrangencias.filter((a) => a !== 'br')));
      }
      if (!cargo.abrangencias.includes(uf) || uf === 'br') return json(res, 400, { erro: 'UF inválida para este cargo' });
      return json(res, 200, await coletor.municipios(eleicao.codigo, cargo.codigo, uf));
    }
    return json(res, 404, { erro: 'rota desconhecida' });
  } catch (erro) {
    return json(res, 502, { erro: `falha ao consultar o TSE: ${erro.message}` });
  }
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
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/')) return api(res, pathname, searchParams);
  if (pathname.startsWith('/tse/')) return proxy(req, res, decodeURIComponent(pathname.slice(5)));
  return estatico(res, decodeURIComponent(pathname));
});

// Endereços IPv4 desta máquina na rede local, para abrir o app no celular.
const enderecosLocais = () =>
  Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

servidor.listen(PORTA, HOST, () => {
  console.log(`Apuração 2026 em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORTA}`);
  if (HOST === '0.0.0.0') {
    for (const ip of enderecosLocais()) console.log(`No celular (mesma Wi-Fi): http://${ip}:${PORTA}`);
  }
  console.log(`Dados: ${TSE_BASE}`);
});
