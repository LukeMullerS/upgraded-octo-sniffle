#!/usr/bin/env node
// Build do Vercel: copia public/ para dist/ pondo ?v=<versão> em todas as referências a .js e
// .css (imports dos módulos, <script src>, <link href>). Com a versão no endereço, o navegador
// pode guardar esses arquivos por um ano (vercel.json: "immutable" quando há ?v=) e não precisa
// mais perguntar ao servidor a cada visita; a cada deploy com código novo a versão muda e as
// páginas (que continuam sem cache) passam a pedir os arquivos novos.
//
// A versão é uma só para todos os arquivos (hash do conteúdo de todos os .js e .css): assim
// nunca convivem dois endereços para o mesmo módulo, o que o carregaria duas vezes.
//
// Uso: node scripts/versionar.mjs [origem=public] [destino=dist]

import { createHash } from 'node:crypto';
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const ORIGEM = join(RAIZ, process.argv[2] ?? 'public');
const DESTINO = join(RAIZ, process.argv[3] ?? 'dist');

/** Põe ?v= nas referências locais a .js/.css de um texto (HTML ou JS). Exportada para os testes. */
export function versionarTexto(texto, tipo, versao) {
  const v = `?v=${versao}`;
  if (tipo === 'html') {
    return texto.replace(/(<(?:script|link)\b[^>]*?\s(?:src|href)=")([\w./-]+\.(?:js|css))(")/g, `$1$2${v}$3`);
  }
  // import … from './x.js' · import './x.js' · import('./x.js') — só caminhos relativos.
  return texto.replace(/((?:\bfrom|\bimport)\s*\(?\s*)(['"])(\.\.?\/[\w./-]+\.js)\2/g, `$1$2$3${v}$2`);
}

async function principal() {
  const nomes = (await readdir(ORIGEM, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
  const codigo = nomes.filter((n) => /\.(js|css)$/.test(n)).sort();
  const hash = createHash('sha256');
  for (const n of codigo) hash.update(n).update('\0').update(await readFile(join(ORIGEM, n))).update('\0');
  const versao = hash.digest('hex').slice(0, 12);

  await rm(DESTINO, { recursive: true, force: true });
  await cp(ORIGEM, DESTINO, { recursive: true });
  let alterados = 0;
  for (const n of nomes) {
    const tipo = n.endsWith('.html') ? 'html' : n.endsWith('.js') ? 'js' : null;
    if (!tipo) continue;
    const caminho = join(DESTINO, n);
    const antes = await readFile(caminho, 'utf8');
    const depois = versionarTexto(antes, tipo, versao);
    if (depois !== antes) { await writeFile(caminho, depois); alterados += 1; }
  }
  console.log(`dist/ pronta · versão ${versao} · ${alterados} arquivos com referências versionadas`);
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
