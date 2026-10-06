// Aplicação: banco do TSE, coletores, Censo, mapas, logs das urnas e as rotas HTTP.
// Usada pelo servidor local (server.js) e pela função serverless do Vercel (api/index.js).
//
// O proxy /tse/* existe porque o CDN do TSE recusa clientes sem User-Agent de navegador e
// não garante CORS para outras origens. Todos os arquivos do TSE passam por um banco único
// (src/banco.js), compartilhado por todas as janelas.

import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarBanco } from './banco.js';
import { versionar } from './versao.js';
import { criarColetor } from './coletor.js';
import { PRESETS, criarCenso } from './censo.js';
import { criarColetorLogs } from './logs.js';
import { criarMapas } from './mapas.js';
import { SERIES_IPEA, criarFontes } from './fontes.js';
import { ELEICOES, UFS, PLEITO, num } from '../public/tse.js';

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
  // Mais que isso por instância e o TSE responde 429 (cada instância do Vercel tem seu banco).
  ...(SERVERLESS ? { concorrencia: 12 } : {}),
});

// Fotos dos candidatos: imagens, num cache simples à parte do banco.
const cache = new Map(); // caminho → { expira, status, tipo, corpo }
const MAX_FOTOS = 800;
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
    if (res.ok || res.status === 404 || res.status === 403) {
      // Limite de memória: as fotos mais antigas saem primeiro.
      if (cache.size >= MAX_FOTOS) cache.delete(cache.keys().next().value);
      cache.set(caminho, resposta);
    }
    return resposta;
  })().finally(() => emAndamento.delete(caminho));

  emAndamento.set(caminho, promessa);
  return promessa;
}

/**
 * JSON de um arquivo dos logs das urnas (config das seções, aux.json de cada seção), direto do
 * TSE e fora do banco: são centenas de milhares de arquivos lidos uma vez cada (guardá-los no
 * banco faria a memória crescer sem limite), e o "ainda não publicado" precisa ser conferido
 * de novo a cada passada. null = ainda não publicado.
 */
async function buscarJson(caminho) {
  const res = await fetch(`${TSE_BASE}/${caminho}`, { headers: CABECALHOS_TSE, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`TSE respondeu HTTP ${res.status}`);
  return res.json();
}

const coletor = criarColetor({ banco, sobDemanda: SERVERLESS });
// Quanto uma consulta espera pelas cidades: no serverless, quase todo o prazo da função (60 s).
const ESPERA_MS = SERVERLESS ? 45_000 : 4_000;
const fontes = criarFontes({
  pasta: join(DADOS, 'fontes'),
  ...(process.env.IPEA_BASE ? { ipea: process.env.IPEA_BASE.replace(/\/$/, '') } : {}),
  ...(process.env.IBGE_LOCALIDADES ? { localidades: process.env.IBGE_LOCALIDADES.replace(/\/$/, '') } : {}),
});
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
    if (pathname === '/api/censo/presets') {
      // Catálogo de séries prontas: IBGE (Censo, PIB) e IPEA (Atlas do Desenvolvimento Humano).
      return json(res, 200, [
        ...PRESETS.map(({ id, nome, tabela, grupo }) => ({ id, nome, tabela: tabela ?? null, grupo, fonte: 'IBGE' })),
        ...SERIES_IPEA.map(({ id, nome, codigo, grupo }) => ({ id: `ipea:${id}`, nome, codigo, grupo, fonte: 'IPEA' })),
      ], true);
    }
    if (pathname === '/api/fontes/regioes') return json(res, 200, await fontes.regioes(), true);
    if (pathname === '/api/censo/metadados') return json(res, 200, await censo.metadados(params.get('tabela')));
    if (pathname === '/api/censo/serie') {
      const preset = params.get('preset');
      if (preset?.startsWith('ipea:')) return json(res, 200, await fontes.serieIpea(preset.slice(5)), true);
      if (preset) return json(res, 200, await censo.preset(preset), true);
      // Categorias escolhidas vêm como c<id da classificação>=<id da categoria>.
      const classificacao = {};
      for (const [k, v] of params) if (/^c\d+$/.test(k) && /^\d+$/.test(v)) classificacao[k.slice(1)] = v;
      return json(res, 200, await censo.serie({
        tabela: params.get('tabela'), variavel: params.get('variavel'), periodo: params.get('periodo'), classificacao,
      }));
    }
    return json(res, 404, { erro: 'rota desconhecida' });
  } catch (erro) {
    const msg = erro?.name === 'TimeoutError' ? 'a fonte não respondeu a tempo' : erro.message;
    return json(res, 502, { erro: `falha ao consultar a fonte de dados: ${msg}` });
  }
}

// ---------- segurança ----------

// Política de conteúdo: só scripts e dados do próprio app; estilos inline (atributos style
// dos gráficos) e imagens data: liberados; o app pode se abrir em iframe só nele mesmo
// (janelas da área de trabalho Windows 98).
export const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://resultados.tse.jus.br; "
    + "connect-src 'self' https://resultados.tse.jus.br; font-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
function aplicarCabecalhosSeguranca(res) {
  for (const [k, v] of Object.entries(CABECALHOS_SEGURANCA)) res.setHeader(k, v);
}

const relatos = new Map(); // endereço → { inicio, n }
function permitirRelato(req) {
  // Atrás do CDN do Vercel o endereço real vem no cabeçalho; no servidor local o cabeçalho
  // poderia ser forjado, então vale o endereço da conexão.
  const ip = String((SERVERLESS ? req.headers['x-forwarded-for'] : null) ?? req.socket?.remoteAddress ?? '?').split(',')[0].trim();
  const agora = Date.now();
  if (relatos.size > 5000) relatos.clear();
  const r = relatos.get(ip);
  if (!r || agora - r.inicio > 60_000) { relatos.set(ip, { inicio: agora, n: 1 }); return true; }
  r.n += 1;
  return r.n <= 30;
}

// ---------- envio com compressão ----------

// Texto (JSON, HTML, JS, CSS, SVG) vai comprimido quando o navegador aceita: as listas de
// cidades têm alguns MB e caem para uma fração disso — faz diferença no celular. No Vercel o
// CDN já comprime, então ali o corpo vai como está.
const COMPRIMIVEL = /^(application\/json|text\/|image\/svg|application\/javascript)/;
function enviar(res, status, cabecalhos, corpo, cacheComprimidos = null) {
  const req = res.req;
  const aceita = String(req?.headers?.['accept-encoding'] ?? '');
  let codificacao = null;
  if (!SERVERLESS && corpo.length > 1024 && COMPRIMIVEL.test(cabecalhos['content-type'] ?? '')) {
    codificacao = /\bbr\b/.test(aceita) ? 'br' : /\bgzip\b/.test(aceita) ? 'gzip' : null;
  }
  if (codificacao) {
    let c = cacheComprimidos?.get(codificacao);
    if (!c) {
      c = codificacao === 'br'
        ? brotliCompressSync(corpo, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5, [zlib.BROTLI_PARAM_SIZE_HINT]: corpo.length } })
        : gzipSync(corpo, { level: 6 });
      cacheComprimidos?.set(codificacao, c);
    }
    corpo = c;
    cabecalhos = { ...cabecalhos, 'content-encoding': codificacao, vary: 'Accept-Encoding' };
  }
  res.writeHead(status, { ...cabecalhos, 'content-length': corpo.length });
  res.end(req?.method === 'HEAD' ? undefined : corpo);
}

// Cache no CDN do Vercel: é a "base compartilhada" da apuração. Cada arquivo do TSE é buscado
// no máximo uma vez a cada 20 s durante a apuração, e todos os usuários recebem a mesma cópia;
// com 100% das seções totalizadas, o resultado é final e fica horas no CDN.
const POLITICAS_CACHE = {
  'ao-vivo': 'public, max-age=0, s-maxage=20, stale-while-revalidate=20',
  final: 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400',
  estavel: 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
  config: 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
  foto: 'public, max-age=86400, s-maxage=604800',
};

/** Política de cache de um arquivo do TSE (caminho relativo, status, corpo). Exportada para os testes. */
export function politicaTse(caminho, status, corpo) {
  if (status >= 500) return null; // falha ao consultar o TSE: nunca fica no CDN
  if (caminho.includes('/fotos/')) return status === 200 ? 'foto' : 'ao-vivo';
  if (caminho.includes('/config/')) return status === 200 ? 'config' : 'ao-vivo';
  if (status !== 200) return 'ao-vivo'; // ainda não publicado: confere de novo em 20 s
  try {
    const s = JSON.parse(String(corpo)).s ?? {};
    return num(s.ts) > 0 && num(s.st) >= num(s.ts) ? 'final' : 'ao-vivo';
  } catch {
    return 'ao-vivo';
  }
}

/** Resposta das APIs de resultado: "final" com 100% das seções totalizadas. */
function politicaResultado(d) {
  if (!completo(d)) return false; // ainda lendo: não guarda no CDN uma resposta parcial
  const r = d.consolidado ?? d.brasil;
  return r?.secoes?.total > 0 && r.secoes.totalizadas >= r.secoes.total ? 'final' : 'ao-vivo';
}

function json(res, status, dados, cacheCdn = false) {
  // cacheCdn: true (= "estavel", 1 min) ou o nome de uma política; só vale no Vercel.
  const politica = cacheCdn === true ? 'estavel' : cacheCdn;
  const cache = SERVERLESS && politica && status === 200 ? POLITICAS_CACHE[politica] : 'no-store';
  enviar(res, status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache }, Buffer.from(JSON.stringify(dados)));
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
      return json(res, 200, d, politicaResultado(d));
    }
    if (pathname === '/api/municipios') {
      const uf = params.get('uf');
      if (uf === 'todas') {
        const d = await coletor.todas(eleicao.codigo, cargo.codigo, cargo.abrangencias.filter((a) => a !== 'br'),
          { esperarMs: ESPERA_MS, porUf: !cargo.abrangencias.includes('br') });
        return json(res, 200, d, politicaResultado(d));
      }
      if (!cargo.abrangencias.includes(uf) || uf === 'br') return json(res, 400, { erro: 'UF inválida para este cargo' });
      const d = await coletor.municipios(eleicao.codigo, cargo.codigo, uf, { esperarMs: ESPERA_MS });
      return json(res, 200, d, politicaResultado(d));
    }
    return json(res, 404, { erro: 'rota desconhecida' });
  } catch (erro) {
    return json(res, 502, { erro: `falha ao consultar o TSE: ${erro.message}` });
  }
}

const CAMINHO_PROXY = new RegExp(`^ele2026/(${Object.keys(ELEICOES).join('|')})/(`
  + 'dados/[a-z]{2}/[a-z]{2}\\d{0,5}-c\\d{4}-e\\d{6}-u\\.json'
  + '|config/mun-e\\d{6}-cm\\.json'
  + '|fotos/[a-z]{2}/\\d{1,20}\\.jpe?g)$');

async function proxy(req, res, caminho) {
  // Só os arquivos que as páginas usam (resultados, lista de municípios e fotos das eleições
  // configuradas): o proxy não serve para buscar qualquer coisa no TSE nem para encher a memória.
  if (!CAMINHO_PROXY.test(caminho)) {
    res.writeHead(400).end('caminho inválido');
    return;
  }
  try {
    const r = caminho.includes('/fotos/') ? await buscarFoto(caminho) : await banco.bruto(caminho);
    const politica = politicaTse(caminho, r.status, r.corpo);
    const cache = SERVERLESS ? (politica ? POLITICAS_CACHE[politica] : 'no-store') : 'no-cache';
    enviar(res, r.status, { 'content-type': r.tipo, 'cache-control': cache }, r.corpo);
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

const estaticos = new Map(); // "versão:arquivo" → { corpo, comprimidos }

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
    // A versão cobre só os arquivos da raiz de public/; o tamanho e a data do próprio arquivo
    // entram na ETag para os de subpastas (public/fontes, regerados com o servidor no ar).
    const st = await stat(arquivo);
    const etag = `"${v}-${st.size}-${Math.round(st.mtimeMs)}"`;
    // no-cache: o navegador sempre confere com o servidor (barato: 304 se nada mudou).
    const cabecalhos = { 'content-type': TIPOS[tipo] || 'application/octet-stream', 'cache-control': 'no-cache', etag };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, cabecalhos).end();
      return;
    }
    // Arquivo já versionado (e comprimido) fica em memória até a próxima mudança em public/.
    const chave = `${etag}:${arquivo}`;
    let item = estaticos.get(chave);
    if (!item) {
      let corpo = await readFile(arquivo);
      if (tipo === '.js' || tipo === '.html') corpo = Buffer.from(versionar(corpo.toString('utf8'), tipo, v));
      item = { corpo, comprimidos: new Map() };
      if (estaticos.size > 200) estaticos.clear();
      estaticos.set(chave, item);
    }
    enviar(res, 200, cabecalhos, item.corpo, item.comprimidos);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('não encontrado');
  }
}

/** Trata um pedido HTTP (Node puro ou função serverless do Vercel). */
export function tratar(req, res) {
  aplicarCabecalhosSeguranca(res);
  try {
    const r = rotear(req, res);
    if (r && typeof r.catch === 'function') r.catch((erro) => falhaInterna(res, erro));
  } catch (erro) {
    falhaInterna(res, erro);
  }
}

function falhaInterna(res, erro) {
  // URL malformada (ex.: "%E0") ou erro inesperado: responde sem derrubar o servidor.
  if (res.headersSent) { res.end(); return; }
  const status = erro instanceof URIError ? 400 : 500;
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(status === 400 ? 'endereço inválido' : 'erro interno');
}

// Ações que mudam o estado do servidor: só por POST e vindas do próprio app (sem CSRF).
const ACOES_POST = new Set(['/api/urnas/pausar', '/api/urnas/retomar']);
function mesmaOrigem(req) {
  const origem = req.headers.origin ?? req.headers.referer;
  if (!origem) return false;
  try {
    return new URL(origem).host === req.headers.host;
  } catch {
    return false;
  }
}

function rotear(req, res) {
  let { pathname, searchParams } = new URL(req.url, 'http://localhost');
  // Vercel: as rotas /api/* e /tse/* chegam reescritas para /api/index?rota=<caminho original>.
  if (pathname.startsWith('/api/index') && searchParams.has('rota')) {
    const rota = searchParams.get('rota');
    if (!/^\/(api|tse)\//.test(rota)) return json(res, 400, { erro: 'rota inválida' });
    pathname = rota;
    searchParams.delete('rota');
  }
  if (req.method === 'POST') {
    if (!ACOES_POST.has(pathname)) return res.writeHead(405).end();
    if (!mesmaOrigem(req)) return json(res, 403, { erro: 'origem não permitida' });
    req.resume(); // corpo ignorado
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.writeHead(405).end();
  } else if (ACOES_POST.has(pathname)) {
    return json(res, 405, { erro: 'use POST' });
  }
  if (pathname === '/api/banco') return json(res, 200, banco.status());
  if (pathname === '/api/erro') {
    // Erros das páginas aparecem no terminal, para facilitar o diagnóstico.
    // Sem quebras de linha nem códigos de controle (que mexeriam no terminal), e no máximo
    // 30 relatos por minuto por endereço: ninguém enche o terminal de lixo.
    if (!permitirRelato(req)) return json(res, 429, { erro: 'muitos relatos' });
    const t = (k) => String(searchParams.get(k) ?? '').slice(0, 500).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');
    console.error(`[navegador] ${t('pagina')} · ${t('tipo')}: ${t('msg')}${t('origem') ? ` (${t('origem')})` : ''}`);
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/mapa') {
    // Contornos para os mapas: sem uf = estados; uf=todas = municípios do Brasil; uf=sp = municípios de SP.
    const uf = searchParams.get('uf') || undefined;
    if (uf && uf !== 'todas' && !UFS[uf]) return json(res, 400, { erro: 'UF inválida' });
    return mapas.malha({ uf }).then((g) => json(res, 200, g, true), (e) => json(res, 502, { erro: `falha ao obter o mapa do IBGE: ${e.message}` }));
  }
  if (pathname.startsWith('/api/censo/') || pathname.startsWith('/api/fontes/')) return apiCenso(res, pathname, searchParams);
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
