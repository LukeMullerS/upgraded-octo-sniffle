// Gráficos em SVG puro (sem bibliotecas): histograma, dispersão, boxplot e barras.
// Cada função devolve uma string SVG; as marcas levam `data-dica` com o índice do item,
// para a página mostrar a dica (tooltip) e tratar cliques por delegação.

import { passoRedondo } from './calculos.js';

const fmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Marcas de eixo "redondas" cobrindo [min, max]. */
export function marcasEixo(min, max, alvo = 5) {
  if (!(max > min)) {
    const d = Math.abs(min) * 0.1 || 1;
    return marcasEixo(min - d, max + d, alvo);
  }
  const passo = passoRedondo(max - min, alvo);
  const inicio = Math.floor(min / passo) * passo;
  const fim = Math.ceil(max / passo) * passo;
  const marcas = [];
  for (let v = inicio; v <= fim + passo / 1e6; v += passo) marcas.push(Math.round(v * 1e6) / 1e6);
  return { inicio, fim, passo, marcas };
}

const escala = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

function eixos({ x, y, w, h, m, marcasX, marcasY, rotuloX, rotuloY, fmtX = fmt.format, fmtY = fmt.format }) {
  let s = '';
  for (const v of marcasY ?? []) {
    const py = y(v);
    s += `<line class="grade" x1="${m.l}" x2="${w - m.r}" y1="${py}" y2="${py}"/>`;
    s += `<text class="eixo" x="${m.l - 6}" y="${py + 4}" text-anchor="end">${esc(fmtY(v))}</text>`;
  }
  for (const v of marcasX ?? []) {
    const px = x(v);
    s += `<text class="eixo" x="${px}" y="${h - m.b + 16}" text-anchor="middle">${esc(fmtX(v))}</text>`;
  }
  s += `<line class="base" x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}"/>`;
  if (rotuloX) s += `<text class="rotulo" x="${(m.l + w - m.r) / 2}" y="${h - 4}" text-anchor="middle">${esc(rotuloX)}</text>`;
  if (rotuloY) s += `<text class="rotulo" transform="translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(rotuloY)}</text>`;
  return s;
}

function linhaReferencia(x1, y1, x2, y2, classe, rotulo, ancora = 'start', textoY = y1 + 10) {
  const t = rotulo ? `<text class="ref-texto ${classe}" x="${x2 + (ancora === 'start' ? 4 : -4)}" y="${textoY}" text-anchor="${ancora}">${esc(rotulo)}</text>` : '';
  return `<line class="ref ${classe}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>${t}`;
}

/**
 * Histograma. `faixas` = [{inicio, fim, contagem}], `linhas` = [{valor, classe, rotulo}]
 * (referência, mediana…), `selecionada` = índice da faixa filtrada.
 */
export function svgHistograma({ faixas, linhas = [], selecionada = null, rotuloX = '', cor = 'var(--destaque)', largura = 560, altura = 230 }) {
  if (!faixas.length) return '<p class="mudo">Sem dados suficientes.</p>';
  const m = { t: 14, r: 10, b: 38, l: 40 };
  const x0 = faixas[0].inicio;
  const x1 = faixas.at(-1).fim;
  const x = escala(x0, x1, m.l, largura - m.r);
  const maxC = Math.max(...faixas.map((f) => f.contagem));
  const ey = marcasEixo(0, maxC, 4);
  const y = escala(0, ey.fim, altura - m.b, m.t);
  const passoRotulo = Math.ceil(faixas.length / 8);
  const marcasX = faixas.map((f) => f.inicio).filter((_, i) => i % passoRotulo === 0).concat(faixas.length % passoRotulo === 0 ? [x1] : []);
  let s = eixos({ x, y, w: largura, h: altura, m, marcasX, marcasY: ey.marcas.filter((v) => Number.isInteger(v)), rotuloX, fmtY: fmtInt.format });
  faixas.forEach((f, i) => {
    const px = x(f.inicio) + 1;
    const pw = Math.max(1, x(f.fim) - x(f.inicio) - 2);
    const py = y(f.contagem);
    const ph = altura - m.b - py;
    const r = Math.min(4, pw / 2, ph);
    const classe = selecionada === null ? '' : selecionada === i ? 'ativa' : 'apagada';
    // Retângulo de acerto ocupa a coluna toda (alvo maior que a marca).
    s += `<g class="faixa ${classe}" data-dica="${i}">`
      + `<rect class="alvo" x="${x(f.inicio)}" y="${m.t}" width="${x(f.fim) - x(f.inicio)}" height="${altura - m.b - m.t}"/>`
      + (f.contagem ? `<path fill="${cor}" d="M${px},${altura - m.b}V${py + r}q0,-${r} ${r},-${r}h${pw - 2 * r}q${r},0 ${r},${r}V${altura - m.b}Z"/>` : '')
      + '</g>';
  });
  linhas.forEach((l, i) => {
    if (!Number.isFinite(l.valor) || l.valor < x0 || l.valor > x1) return;
    const px = x(l.valor);
    // Rótulos alternam de lado da linha (e de altura), para não se sobreporem quando as linhas estão próximas.
    const lado = px > largura * 0.85 ? 'end' : px < largura * 0.15 ? 'start' : i % 2 ? 'start' : 'end';
    s += linhaReferencia(px, m.t, px, altura - m.b, l.classe, l.rotulo, lado, m.t + 10 + i * 13);
  });
  return `<svg viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
}

/**
 * Dispersão. `pontos` = [{x, y, r, classe, apagado}], `refX`/`refY` = linhas de referência,
 * `regressao` = {a, b} para y = a + b·x.
 */
export function svgDispersao({ pontos, rotuloX, rotuloY, refX = null, refY = null, regressao = null, largura = 560, altura = 340, fmtX = fmt.format, fmtY = fmt.format }) {
  const validos = pontos.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!validos.length) return '<p class="mudo">Sem dados suficientes.</p>';
  const m = { t: 12, r: 14, b: 42, l: 50 };
  const ex = marcasEixo(Math.min(...validos.map((p) => p.x)), Math.max(...validos.map((p) => p.x)), 6);
  const ey = marcasEixo(Math.min(...validos.map((p) => p.y)), Math.max(...validos.map((p) => p.y)), 5);
  const x = escala(ex.inicio, ex.fim, m.l, largura - m.r);
  const y = escala(ey.inicio, ey.fim, altura - m.b, m.t);
  let s = eixos({ x, y, w: largura, h: altura, m, marcasX: ex.marcas, marcasY: ey.marcas, rotuloX, rotuloY, fmtX, fmtY });
  if (Number.isFinite(refX) && refX >= ex.inicio && refX <= ex.fim) s += linhaReferencia(x(refX), m.t, x(refX), altura - m.b, 'ref-principal');
  if (Number.isFinite(refY) && refY >= ey.inicio && refY <= ey.fim) s += linhaReferencia(m.l, y(refY), largura - m.r, y(refY), 'ref-principal');
  if (regressao && Number.isFinite(regressao.b)) {
    const ya = regressao.a + regressao.b * ex.inicio;
    const yb = regressao.a + regressao.b * ex.fim;
    s += `<clipPath id="area-plot"><rect x="${m.l}" y="${m.t}" width="${largura - m.l - m.r}" height="${altura - m.t - m.b}"/></clipPath>`;
    s += `<line class="regressao" clip-path="url(#area-plot)" x1="${x(ex.inicio)}" y1="${y(ya)}" x2="${x(ex.fim)}" y2="${y(yb)}"/>`;
  }
  // Maiores atrás, menores na frente, para nenhum ponto pequeno sumir.
  const ordem = validos.map((p, i) => ({ p, i: pontos.indexOf(p) })).sort((a, b) => b.p.r - a.p.r);
  for (const { p, i } of ordem) {
    s += `<circle class="ponto ${p.classe ?? ''}${p.apagado ? ' apagado' : ''}${p.destacado ? ' destacado' : ''}" cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="${p.r}" data-dica="${i}"${p.cor ? ` style="fill:${p.cor}"` : ''}/>`;
  }
  return `<svg viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
}

/**
 * Boxplot horizontal por grupo. `grupos` = [{nome, q1, mediana, q3, min, max, media, n, atipicos: [valor]}].
 */
export function svgBoxplot({ grupos, rotuloX, largura = 560, linhaRef = null }) {
  if (!grupos.length) return '<p class="mudo">Sem dados suficientes.</p>';
  const altLinha = 26;
  const m = { t: 10, r: 14, b: 42, l: 120 };
  const altura = m.t + m.b + grupos.length * altLinha;
  const todos = grupos.flatMap((g) => [g.min, g.max, ...g.atipicos]);
  const ex = marcasEixo(Math.min(...todos), Math.max(...todos), 6);
  const x = escala(ex.inicio, ex.fim, m.l, largura - m.r);
  let s = eixos({ x, y: () => 0, w: largura, h: altura, m, marcasX: ex.marcas, marcasY: [], rotuloX });
  for (const v of ex.marcas) s += `<line class="grade" x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${altura - m.b}"/>`;
  if (Number.isFinite(linhaRef)) s += linhaReferencia(x(linhaRef), m.t, x(linhaRef), altura - m.b, 'ref-principal');
  grupos.forEach((g, i) => {
    const cy = m.t + i * altLinha + altLinha / 2;
    s += `<g class="caixa" data-dica="${i}">`
      + `<rect class="alvo" x="0" y="${cy - altLinha / 2}" width="${largura}" height="${altLinha}"/>`
      + `<text class="eixo" x="${m.l - 8}" y="${cy + 4}" text-anchor="end">${esc(g.nome.length > 16 ? `${g.nome.slice(0, 15)}…` : g.nome)}</text>`
      + `<line class="bigode" x1="${x(g.min)}" x2="${x(g.max)}" y1="${cy}" y2="${cy}"/>`
      + `<rect class="iqr" x="${x(g.q1)}" y="${cy - 8}" width="${Math.max(1, x(g.q3) - x(g.q1))}" height="16" rx="3"/>`
      + `<line class="mediana" x1="${x(g.mediana)}" x2="${x(g.mediana)}" y1="${cy - 8}" y2="${cy + 8}"/>`
      + `<circle class="media" cx="${x(g.media)}" cy="${cy}" r="3"/>`
      + g.atipicos.slice(0, 60).map((v) => `<circle class="atipico" cx="${x(v)}" cy="${cy}" r="2.5"/>`).join('')
      + '</g>';
  });
  return `<svg viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
}

/** Barras horizontais (média por grupo, contagens…). `itens` = [{nome, valor}]. */
export function svgBarras({ itens, rotuloX, largura = 560, cor = 'var(--destaque)', fmtValor = fmt.format }) {
  if (!itens.length) return '<p class="mudo">Sem dados suficientes.</p>';
  const altLinha = 24;
  const m = { t: 8, r: 60, b: 38, l: 120 };
  const altura = m.t + m.b + itens.length * altLinha;
  const ex = marcasEixo(Math.min(0, ...itens.map((i) => i.valor)), Math.max(0, ...itens.map((i) => i.valor)), 5);
  const x = escala(ex.inicio, ex.fim, m.l, largura - m.r);
  let s = eixos({ x, y: () => 0, w: largura, h: altura, m, marcasX: ex.marcas, marcasY: [], rotuloX });
  itens.forEach((it, i) => {
    const cy = m.t + i * altLinha;
    const x0 = x(Math.min(0, it.valor));
    const w = Math.max(1, Math.abs(x(it.valor) - x(0)));
    s += `<g class="barra-h" data-dica="${i}">`
      + `<rect class="alvo" x="0" y="${cy}" width="${largura}" height="${altLinha}"/>`
      + `<text class="eixo" x="${m.l - 8}" y="${cy + altLinha / 2 + 4}" text-anchor="end">${esc(it.nome.length > 16 ? `${it.nome.slice(0, 15)}…` : it.nome)}</text>`
      + `<rect x="${x0}" y="${cy + 4}" width="${w}" height="${altLinha - 8}" rx="4" fill="${cor}"/>`
      + `<text class="eixo" x="${x0 + w + 4}" y="${cy + altLinha / 2 + 4}">${esc(fmtValor(it.valor))}</text>`
      + '</g>';
  });
  return `<svg viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
}
