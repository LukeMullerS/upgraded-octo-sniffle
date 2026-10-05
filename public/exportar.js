// Exportação de análises: gráficos e mapas em SVG ou PNG (com título, legenda e crédito),
// relatório completo em HTML (abre em qualquer navegador e imprime em PDF) e impressão.
// Toda exportação passa antes pela janela "Como citar" (citar.js).
//
// Botões prontos, sem código em cada página:
//   <button data-exportar-png="#mapa">PNG</button>   (o primeiro <svg> dentro do seletor)
//   <button data-exportar-svg="#grafico">SVG</button>
// O título vem do <h2> do cartão; a legenda, de .mapa-legenda ou .legenda dentro do alvo.

import { antesDeExportar, citacoes, creditoCurto, fontesDeDados } from './citar.js';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const PROPRIEDADES = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity',
  'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'visibility', 'display'];

/** Nome de arquivo seguro a partir de um título. */
export const nomeArquivo = (titulo, ext) => `${String(titulo || 'analise').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'analise'}.${ext}`;

export function baixar(conteudo, nome, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Cópia autônoma de um SVG da página: os estilos do CSS (classes, variáveis de tema) viram
 * atributos, para o arquivo ficar igual fora do app. Elementos escondidos saem.
 */
export function svgAutonomo(svg) {
  const clone = svg.cloneNode(true);
  const orig = [svg, ...svg.querySelectorAll('*')];
  const copia = [clone, ...clone.querySelectorAll('*')];
  orig.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const alvo = copia[i];
    if (cs.display === 'none') { alvo.setAttribute('display', 'none'); return; }
    const estilo = PROPRIEDADES.map((p) => {
      const v = cs.getPropertyValue(p);
      return v && v !== 'normal' ? `${p}:${v}` : '';
    }).filter(Boolean).join(';');
    alvo.setAttribute('style', estilo);
    alvo.removeAttribute('class');
  });
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox?.baseVal;
  const largura = vb?.width || r.width || 800;
  const altura = vb?.height || r.height || 500;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(Math.round(largura)));
  clone.setAttribute('height', String(Math.round(altura)));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${largura} ${altura}`);
  return { clone, largura, altura };
}

/** Itens de legenda (cor + texto) de .mapa-legenda / .legenda, para desenhar no PNG. */
function itensLegenda(el) {
  if (!el) return [];
  return [...el.querySelectorAll(':scope > span')]
    .map((s) => {
      const i = s.querySelector('i');
      const cor = i ? getComputedStyle(i).backgroundColor : null;
      return { cor: cor && cor !== 'rgba(0, 0, 0, 0)' ? cor : (i?.classList.contains('sem-dado') ? '#d9d8d2' : null), texto: s.textContent.trim() };
    }).filter((x) => x.texto);
}

/** SVG com título e crédito (para o arquivo .svg). */
export function exportarSvg(svg, { titulo = '', subtitulo = '' } = {}) {
  const { clone, largura, altura } = svgAutonomo(svg);
  const topo = titulo ? 46 : 0;
  const rodape = 28;
  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('transform', `translate(0 ${topo})`);
  while (clone.firstChild) g.append(clone.firstChild);
  const total = altura + topo + rodape;
  clone.setAttribute('viewBox', `0 0 ${largura} ${total}`);
  clone.setAttribute('height', String(Math.round(total)));
  clone.innerHTML = `<rect width="100%" height="100%" fill="#ffffff"/>`
    + (titulo ? `<text x="12" y="22" font-family="system-ui, sans-serif" font-size="17" font-weight="700" fill="#1b2430">${esc(titulo)}</text>` : '')
    + (subtitulo ? `<text x="12" y="40" font-family="system-ui, sans-serif" font-size="12" fill="#637083">${esc(subtitulo)}</text>` : '');
  clone.append(g);
  clone.insertAdjacentHTML('beforeend', `<text x="12" y="${total - 10}" font-family="system-ui, sans-serif" font-size="11" fill="#637083">${esc(creditoCurto())}</text>`);
  return new XMLSerializer().serializeToString(clone);
}

/** PNG (2×) com título, legenda e crédito. */
export async function exportarPng(svg, { titulo = '', subtitulo = '', legenda = null, escala = 2 } = {}) {
  const { clone, largura, altura } = svgAutonomo(svg);
  const texto = new XMLSerializer().serializeToString(clone);
  // data: (e não blob:) por causa da política de segurança de imagens.
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(texto)}`;
  await img.decode();
  const itens = itensLegenda(legenda);
  const larguraFinal = Math.max(largura, 640);
  const ctxTeste = document.createElement('canvas').getContext('2d');
  ctxTeste.font = '13px system-ui, sans-serif';
  // Legenda quebrando em linhas.
  const linhas = [[]];
  let x = 12;
  for (const it of itens) {
    const w = ctxTeste.measureText(it.texto).width + (it.cor ? 22 : 6) + 14;
    if (x + w > larguraFinal - 12 && linhas.at(-1).length) { linhas.push([]); x = 12; }
    linhas.at(-1).push({ ...it, x });
    x += w;
  }
  const topo = titulo ? (subtitulo ? 54 : 38) : 8;
  const altLegenda = itens.length ? linhas.length * 22 + 8 : 0;
  const rodape = 30;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(larguraFinal * escala);
  canvas.height = Math.round((topo + altura + altLegenda + rodape) * escala);
  const ctx = canvas.getContext('2d');
  ctx.scale(escala, escala);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, larguraFinal, topo + altura + altLegenda + rodape);
  ctx.fillStyle = '#1b2430';
  if (titulo) {
    ctx.font = '700 17px system-ui, sans-serif';
    ctx.fillText(titulo, 12, 26, larguraFinal - 24);
    if (subtitulo) { ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#637083'; ctx.fillText(subtitulo, 12, 44, larguraFinal - 24); }
  }
  ctx.drawImage(img, (larguraFinal - largura) / 2, topo, largura, altura);
  ctx.font = '13px system-ui, sans-serif';
  linhas.forEach((ln, i) => {
    const y = topo + altura + 18 + i * 22;
    for (const it of ln) {
      let tx = it.x;
      if (it.cor) { ctx.fillStyle = it.cor; ctx.fillRect(it.x, y - 10, 14, 12); tx += 20; }
      ctx.fillStyle = '#1b2430';
      ctx.fillText(it.texto, tx, y);
    }
  });
  ctx.fillStyle = '#637083';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(creditoCurto(), 12, topo + altura + altLegenda + 20, larguraFinal - 24);
  return new Promise((ok) => canvas.toBlob(ok, 'image/png'));
}

/** Título e subtítulo do cartão onde está o elemento. */
function tituloDoCartao(el) {
  const cartao = el.closest('.cartao, section');
  const h = cartao?.querySelector('h2');
  const sub = cartao?.querySelector('h2 + span, .linha .mudo');
  const textoSub = sub?.textContent.trim() ?? '';
  // Dicas de uso da tela ("clique…", "role…") não vão para a imagem.
  return { titulo: h?.textContent.trim() ?? document.title, subtitulo: /^(clique|role|toque|arraste)/i.test(textoSub) ? '' : textoSub };
}

/** Exporta o primeiro SVG visível dentro de `alvo` (elemento ou seletor). */
export function exportarElemento(alvo, formato) {
  const raiz = typeof alvo === 'string' ? document.querySelector(alvo) : alvo;
  const svg = [...(raiz?.querySelectorAll('svg') ?? [])].find((s) => s.getBoundingClientRect().width > 0 && s.closest('[hidden]') === null);
  if (!svg) { alert('Não há gráfico ou mapa visível para exportar.'); return; }
  const { titulo, subtitulo } = tituloDoCartao(raiz);
  const legenda = raiz.querySelector('.mapa-legenda') ?? raiz.closest('.cartao')?.querySelector('.legenda');
  antesDeExportar(async () => {
    if (formato === 'svg') baixar(exportarSvg(svg, { titulo, subtitulo }), nomeArquivo(titulo, 'svg'), 'image/svg+xml');
    else baixar(await exportarPng(svg, { titulo, subtitulo, legenda }), nomeArquivo(titulo, 'png'), 'image/png');
  });
}

/**
 * Relatório HTML autônomo (abre offline e imprime em PDF), com a citação e as fontes.
 * @param {{titulo: string, resumo?: string, secoes: {titulo: string, html?: string, svg?: SVGElement}[], parametros?: [string, string][]}} o
 */
export function relatorioHtml({ titulo, resumo = '', secoes = [], parametros = [] }) {
  const data = new Date();
  const refs = citacoes({ data });
  const corpoSecoes = secoes.map((s) => {
    const svg = s.svg ? exportarSvg(s.svg, {}) : '';
    return `<section><h2>${esc(s.titulo)}</h2>${svg ? `<div class="figura">${svg}</div>` : ''}${s.html ?? ''}</section>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} — Voto Lab 2026</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b2430;max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:28px 0 8px;border-bottom:1px solid #dde3ea;padding-bottom:4px}
.meta{color:#637083;font-size:.9rem;margin:0 0 16px}.resumo{background:#eef5ff;border-left:3px solid #0b5cad;padding:10px 12px;border-radius:0 8px 8px 0}
table{border-collapse:collapse;width:100%;font-size:.88rem;margin:8px 0}th,td{border-bottom:1px solid #dde3ea;padding:4px 6px;text-align:left}
.figura svg{max-width:100%;height:auto}.citacao p{margin:6px 0}pre{white-space:pre-wrap;background:#f6f8fa;padding:8px;border-radius:6px;font-size:12px}
dl.parametros{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;font-size:.9rem}dl.parametros dt{color:#637083}
footer{margin-top:32px;font-size:.85rem;color:#637083}
@media print{body{padding:0}section{break-inside:avoid}}
</style></head><body>
<h1>${esc(titulo)}</h1>
<p class="meta">Gerado em ${data.toLocaleString('pt-BR')} com o Voto Lab 2026 · ${esc(location.href)}</p>
${resumo ? `<p class="resumo">${resumo}</p>` : ''}
${parametros.length ? `<h2>Parâmetros da análise</h2><dl class="parametros">${parametros.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
${corpoSecoes}
<section class="citacao"><h2>Como citar</h2>${refs.filter((r) => r.id !== 'bibtex').map((r) => `<p><strong>${esc(r.nome)}:</strong> ${r.html}</p>`).join('')}
${refs.find((r) => r.id === 'bibtex').html}
<h2>Fontes dos dados</h2>${fontesDeDados(data).map((f) => `<p>${f}</p>`).join('')}</section>
<footer>Dados agregados por local: associações entre locais não descrevem eleitores individuais (falácia ecológica). Correlação não é causalidade.</footer>
</body></html>`;
}

// Botões data-exportar-png / data-exportar-svg em qualquer página.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest?.('[data-exportar-png], [data-exportar-svg]');
    if (!b) return;
    ev.preventDefault();
    const png = b.hasAttribute('data-exportar-png');
    exportarElemento(b.getAttribute(png ? 'data-exportar-png' : 'data-exportar-svg') || b.closest('.cartao'), png ? 'png' : 'svg');
  });
}

/**
 * Coloca botões "PNG" e "SVG" no cabeçalho de cada cartão com gráfico ou mapa. Roda depois que
 * os scripts da página montaram os mapas (DOMContentLoaded vem depois dos módulos).
 */
export function adicionarBotoesExportar(raiz = document) {
  for (const cartao of raiz.querySelectorAll('.cartao')) {
    if (cartao.querySelector('.exportar-mini') || !cartao.querySelector('.grafico, .mapa')) continue;
    const cab = cartao.querySelector(':scope > .linha') ?? cartao.querySelector('.linha');
    if (!cab) continue;
    const grupo = document.createElement('span');
    grupo.className = 'exportar-mini';
    grupo.innerHTML = '<button type="button" class="secundario sem-margem" data-exportar-png title="Baixar como imagem PNG (com título, legenda e crédito)">PNG</button>'
      + '<button type="button" class="secundario sem-margem" data-exportar-svg title="Baixar como SVG (vetorial, para editar ou publicar)">SVG</button>';
    cab.append(grupo);
  }
}

if (typeof document !== 'undefined') {
  const estiloMini = document.createElement('style');
  estiloMini.textContent = `.exportar-mini{display:inline-flex;gap:4px;margin-left:auto}.exportar-mini button{padding:2px 8px;font-size:.75rem;min-height:0;line-height:1.4}
  @media print{.exportar-mini,[data-citar],.citar-dialogo{display:none!important}}`;
  document.head.append(estiloMini);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => adicionarBotoesExportar());
  else setTimeout(() => adicionarBotoesExportar(), 0);
}
