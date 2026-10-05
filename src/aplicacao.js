// Aplicação: banco do TSE, coletores, Censo, mapas, logs das urnas e as rotas HTTP.
// Usada pelo servidor local (server.js) e pela função serverless do Vercel (api/index.js).
//
// O proxy /tse/* existe porque o CDN do TSE recusa clientes sem User-Agent de navegador e
// não garante CORS para outras origens. Todos os arquivos do TSE passam por um banco único
// (src/banco.js), compartilhado por todas as janelas.

import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarBanco } from './banco.js';
import { versionar } from './versao.js';
import { criarColetor } from './coletor.js';
import { PRESETS, criarCenso } from './censo.js';
import { criarColetorLogs } from './logs.js';
import { criarMapas } from './mapas.js';
import { ELEICOES, UFS, PLEITO } from '../public/tse.js';

export const TSE_BASE = (process.env.TSE_BASE || 'https://resultados.tse.jus.br/oficial').replace(/\/$/, '');
const CACHE_DADOS_MS = 30_000;
const CACHE_ESTATICO_MS = 60 * 60_000;
const TIMEOUT_MS = 15_000;

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PUBLICO = join(RAIZ, 'public');
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

// No Vercel (função serverless) só /tmp aceita escrita, e ele é apagado entre execuções.
export const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DADOS = process.env.DADOS || (SERVERLESS ? '/tmp/dados' : join(RAIZ, 'dados'));

// Banco único de todos os arquivos JSON do TSE.
const banco = criarBanco({
  base: TSE_BASE,
  cabecalhos: CABECALHOS_TSE,
  arquivoDisco: join(DADOS, 'banco.json'),
  // Serverless: cada consulta precisa baixar muitas cidades de uma vez, dentro do prazo da função.
  ...(SERVERLESS ? { concorrencia: 32 } : {}),
});

// Fotos dos candidatos: imagens, num cache simples à parte do banco.
const cache = new Map(); // caminho → { expira, status, tipo, corpo }
const emAndamento = new Map(); // caminho → Promise (evita consultas duplicadas simultâneas)

async function buscarFoto(caminho) {
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

/** JSON de um arquivo do TSE pelo banco, sem atualização automática; null se ainda não publicado. */
async function buscarJson(caminho) {
  const r = await banco.buscar(caminho, { auto: false, esperarMs: 30_000 });
  if (r.estado === 'ok') return r.valor;
  if (r.estado === 'indisponivel') return null;
  throw new Error(r.erro ?? 'falha ao consultar o TSE');
}

const coletor = criarColetor({ banco, sobDemanda: SERVERLESS });
// Quanto uma consulta espera pelas cidades: no serverless, quase todo o prazo da função (60 s).
const ESPERA_MS = SERVERLESS ? 45_000 : 4_000;
const censo = criarCenso({
  pasta: join(DADOS, 'censo'),
  ...(process.env.IBGE_BASE ? { base: process.env.IBGE_BASE.replace(/\/$/, '') } : {}),
});

/** Arquivo binário do TSE (logs das urnas), sem passar pelo cache em memória; null se não publicado. */
async function buscarBinario(caminho) {
  const res = await fetch(`${TSE_BASE}/${caminho}`, { headers: CABECALHOS_TSE, signal: AbortSignal.timeout(60_000) });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`TSE respondeu HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Seções totalizadas por município (acompanhamento da eleição federal, que tem todas as
// UFs e o exterior): a compilação dos logs só procura onde já há seções totalizadas.
const ELEICAO_REFERENCIA = '6257';
async function totalizadas(uf) {
  const caminho = `ele2026/${ELEICAO_REFERENCIA}/dados/${uf}/${uf}-e${ELEICAO_REFERENCIA.padStart(6, '0')}-ab.json`;
  const r = await banco.buscar(caminho, {
    nome: 'totalizadas',
    processar: (b) => Object.fromEntries((b.abr ?? []).filter((a) => !a.tpabr || a.tpabr === 'mun')
      .map((a) => [String(a.cdabr).padStart(5, '0'), Number(String(a.s?.st ?? '0').replace(/\D/g, '')) || 0])),
    esperarMs: 20_000,
  });
  return r.valor ? new Map(Object.entries(r.valor)) : null;
}

const UFS_LOGS = [...Object.keys(UFS), 'zz'];
const logs = criarColetorLogs({
  buscarJson, buscarBinario, totalizadas, pleito: PLEITO.codigo, pasta: join(DADOS, 'logs'),
  concorrencia: Number(process.env.LOGS_CONCORRENCIA) || 6,
  // Compilação nacional ligada por padrão; LOGS_NACIONAL=0 desliga. Numa função serverless
  // não há processo contínuo: fica desligada (LOGS_NACIONAL=1 força).
  automatico: SERVERLESS ? process.env.LOGS_NACIONAL === '1' : process.env.LOGS_NACIONAL !== '0',
});

/** Código TSE → código IBGE dos municípios de uma UF (da lista de municípios do TSE). */
async function ibgePorTse(uf) {
  try {
    const lista = (await coletor.municipiosDa(ELEICAO_REFERENCIA))[uf] ?? [];
    return new Map(lista.map((m) => [m.codigo, m.ibge]));
  } catch {
    return new Map();
  }
}

// /api/urnas/*: tempo de votação e biometria a partir dos logs das urnas (ver src/logs.js).
async function apiLogs(res, pathname, params) {
  try {
    if (pathname === '/api/urnas/nacional') return json(res, 200, await logs.nacional());
    if (pathname === '/api/urnas/pausar') { logs.pausar(); return json(res, 200, await logs.nacional()); }
    if (pathname === '/api/urnas/retomar') { await logs.retomar(); return json(res, 200, await logs.nacional()); }
    if (pathname === '/api/urnas/brasil') return json(res, 200, await logs.brasil(UFS_LOGS));
    if (pathname === '/api/urnas/municipios') {
      // Todos os municípios já lidos (para o explorador e os mapas), com o código IBGE.
      const lista = await logs.todosMunicipios();
      const mapas = new Map();
      for (const uf of new Set(lista.map((m) => m.uf))) mapas.set(uf, await ibgePorTse(uf));
      return json(res, 200, { municipios: lista.map((m) => ({ ...m, ibge: mapas.get(m.uf)?.get(m.codigo) ?? null })) });
    }
    const uf = params.get('uf');
    if (!UFS_LOGS.includes(uf)) return json(res, 400, { erro: 'UF inválida' });
    if (pathname === '/api/urnas/estado') {
      const r = await logs.estado(uf);
      const ibge = await ibgePorTse(uf);
      for (const m of r.municipios) m.ibge = ibge.get(m.codigo) ?? null;
      return json(res, 200, r);
    }
    if (pathname === '/api/urnas/municipio') {
      const mun = params.get('mun');
      if (!/^\d{5}$/.test(mun ?? '')) return json(res, 400, { erro: 'município inválido' });
      return json(res, 200, await logs.municipio(uf, mun, { coletar: params.get('coletar') === '1' }));
    }
    return json(res, 404, { erro: 'rota desconhecida' });
  } catch (erro) {
    return json(res, 502, { erro: `falha ao ler os logs: ${erro.message}` });
  }
}

const mapas = criarMapas({
  pasta: join(DADOS, 'mapas'),
  ...(process.env.IBGE_MALHAS ? { base: process.env.IBGE_MALHAS.replace(/\/$/, '') } : {}),
});

// /api/censo/*: séries do IBGE para o explorador (ver src/censo.js).
async function apiCenso(res, pathname, params) {
  try {
    if (pathname === '/api/censo/presets') return json(res, 200, PRESETS.map(({ id, nome, tabela }) => ({ id, nome, tabela })));
    if (pathname === '/api/censo/metadados') return json(res, 200, await censo.metadados(params.get('tabela')));
    if (pathname === '/api/censo/serie') {
      if (params.get('preset')) return json(res, 200, await censo.preset(params.get('preset')), true);
      // Categorias escolhidas vêm como c<id da classificação>=<id da categoria>.
      const classificacao = {};
      for (const [k, v] of params) if (/^c\d+$/.test(k) && /^\d+$/.test(v)) classificacao[k.slice(1)] = v;
      return json(res, 200, await censo.serie({
        tabela: params.get('tabela'), variavel: params.get('variavel'), periodo: params.get('periodo'), classificacao,
      }));
    }
    return json(res, 404, { erro: 'rota desconhecida' });
  } catch (erro) {
    const msg = erro?.name === 'TimeoutError' ? 'o IBGE não respondeu a tempo' : erro.message;
    return json(res, 502, { erro: `falha ao consultar o IBGE: ${msg}` });
  }
}

function json(res, status, dados, cacheCdn = false) {
  // No Vercel, respostas completas ficam 1 min no CDN (e servem velhas por mais 5 enquanto
  // renovam): quem abre a página depois não espera a função baixar tudo de novo.
  const cache = SERVERLESS && cacheCdn && status === 200 ? 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' : 'no-store';
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache });
  res.end(JSON.stringify(dados));
}
const completo = (d) => !d.pendentes && !d.lendo && (!d.total || d.lidos >= d.total);

async function api(res, pathname, params) {
  const eleicao = ELEICOES[params.get('ele')];
  const cargo = eleicao?.cargos.find((c) => c.codigo !== null && String(c.codigo) === params.get('cargo'));
  if (!cargo) return json(res, 400, { erro: 'eleição ou cargo inválido' });
  try {
    if (pathname === '/api/estados') {
      // fundo=1: painéis secundários (outros cargos) esperam na fila de baixa prioridade.
      const prioridade = params.get('fundo') === '1' ? 0 : 1;
      const d = await coletor.estados(eleicao.codigo, cargo.codigo, cargo.abrangencias, { prioridade, esperarMs: Math.max(4_000, ESPERA_MS / 3) });
      return json(res, 200, d, completo(d));
    }
    if (pathname === '/api/municipios') {
      const uf = params.get('uf');
      if (uf === 'todas') {
        const d = await coletor.todas(eleicao.codigo, cargo.codigo, cargo.abrangencias.filter((a) => a !== 'br'), { esperarMs: ESPERA_MS });
        return json(res, 200, d, completo(d));
      }
      if (!cargo.abrangencias.includes(uf) || uf === 'br') return json(res, 400, { erro: 'UF inválida para este cargo' });
      const d = await coletor.municipios(eleicao.codigo, cargo.codigo, uf, { esperarMs: ESPERA_MS });
      return json(res, 200, d, completo(d));
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
    const r = caminho.includes('/fotos/') ? await buscarFoto(caminho) : await banco.bruto(caminho);
    res.writeHead(r.status, { 'content-type': r.tipo, 'cache-control': 'no-cache' });
    res.end(r.corpo);
  } catch (erro) {
    const mensagem = erro?.name === 'TimeoutError' ? 'TSE não respondeu a tempo' : `falha ao consultar o TSE: ${erro.message}`;
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify({ erro: mensagem }));
  }
}

// Versão dos arquivos de public/: muda sempre que algum arquivo muda (ex.: depois de um git
// pull). Ela é acrescentada aos endereços dos scripts e estilos (?v=…), para o navegador
// nunca misturar uma página nova com um script antigo guardado no cache.
let versaoCache = { valor: null, em: 0 };
async function versaoPublico() {
  if (versaoCache.valor && Date.now() - versaoCache.em < 2000) return versaoCache.valor;
  const h = createHash('sha1');
  for (const nome of (await readdir(PUBLICO)).sort()) {
    const st = await stat(join(PUBLICO, nome)).catch(() => null);
    if (st?.isFile()) h.update(`${nome}:${st.size}:${st.mtimeMs};`);
  }
  versaoCache = { valor: h.digest('hex').slice(0, 10), em: Date.now() };
  return versaoCache.valor;
}

async function estatico(req, res, caminho) {
  const relativo = normalize(caminho === '/' ? '/index.html' : caminho).replace(/^(\.\.[/\\])+/, '');
  const arquivo = join(PUBLICO, relativo);
  if (!arquivo.startsWith(PUBLICO)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const tipo = extname(arquivo);
    const v = await versaoPublico();
    const etag = `"${v}"`;
    // no-cache: o navegador sempre confere com o servidor (barato: 304 se nada mudou).
    const cabecalhos = { 'content-type': TIPOS[tipo] || 'application/octet-stream', 'cache-control': 'no-cache', etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cabecalhos).end();
      return;
    }
    let corpo = await readFile(arquivo);
    if (tipo === '.js' || tipo === '.html') corpo = Buffer.from(versionar(corpo.toString('utf8'), tipo, v));
    res.writeHead(200, cabecalhos).end(corpo);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('não encontrado');
  }
}

/** Trata um pedido HTTP (Node puro ou função serverless do Vercel). */
export function tratar(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let { pathname, searchParams } = new URL(req.url, 'http://localhost');
  // Vercel: as rotas /api/* e /tse/* chegam reescritas para /api/index?rota=<caminho original>.
  if (pathname.startsWith('/api/index') && searchParams.has('rota')) {
    pathname = searchParams.get('rota');
    searchParams.delete('rota');
  }
  if (pathname === '/api/banco') return json(res, 200, banco.status());
  if (pathname === '/api/erro') {
    // Erros das páginas aparecem no terminal, para facilitar o diagnóstico.
    const t = (k) => String(searchParams.get(k) ?? '').slice(0, 500).replace(/[\r\n]+/g, ' ');
    console.error(`[navegador] ${t('pagina')} · ${t('tipo')}: ${t('msg')}${t('origem') ? ` (${t('origem')})` : ''}`);
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/mapa') {
    // Contornos para os mapas: sem uf = estados; uf=todas = municípios do Brasil; uf=sp = municípios de SP.
    const uf = searchParams.get('uf') || undefined;
    if (uf && uf !== 'todas' && !UFS[uf]) return json(res, 400, { erro: 'UF inválida' });
    return mapas.malha({ uf }).then((g) => json(res, 200, g, true), (e) => json(res, 502, { erro: `falha ao obter o mapa do IBGE: ${e.message}` }));
  }
  if (pathname.startsWith('/api/censo/')) return apiCenso(res, pathname, searchParams);
  if (pathname.startsWith('/api/urnas/')) return apiLogs(res, pathname, searchParams);
  if (pathname.startsWith('/api/')) return api(res, pathname, searchParams);
  if (pathname.startsWith('/tse/')) return proxy(req, res, decodeURIComponent(pathname.slice(5)));
  // A janela de logs se chamava logs.html (nome que alguns bloqueadores barram).
  if (pathname === '/logs.html') {
    res.writeHead(301, { location: `urnas.html${req.url.slice(pathname.length)}` }).end();
    return;
  }
  return estatico(req, res, decodeURIComponent(pathname));
}

// Resumos guardados da última execução aparecem na hora.
export const salvos = await banco.carregarDisco();

/** Grava o banco e os logs (ao encerrar o servidor). */
export const gravarTudo = () => Promise.all([banco.salvarDisco(), logs.gravar()]);
