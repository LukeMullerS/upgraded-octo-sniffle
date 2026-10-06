// Mapa coroplético em SVG (sem bibliotecas): estados ou municípios coloridos por um valor,
// com zoom (roda, botões, duplo clique), arrastar, dica ao passar o mouse e clique.

import { esc, fmtNum } from './comum.js';

// Escalas de indicadores sem azul × vermelho, para não se confundir com as cores dos partidos
// (mapas de vencedor usam as cores partidárias): sequencial viridis (amarelo claro → roxo escuro,
// legível para daltônicos) e divergente verde-azulado (abaixo) ↔ marrom (acima), neutro no meio.
export const SEQUENCIAL = ['#fde725', '#5ec962', '#21918c', '#3b528b', '#440154'];
export const DIVERGENTE = ['#01665e', '#5ab4ac', '#efede6', '#d8b365', '#8c510a'];
const SEM_DADO = 'url(#mapa-sem-dado)';
// Categórica (vencedor de cada local etc.): cores bem distintas, na ordem de importância.
export const CATEGORICA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#9b59d0', '#e0457b', '#5e6b7d', '#14a3b8', '#8a6d3b', '#b5b800'];

const cacheMalhas = new Map();

/** Contornos do IBGE: sem uf = estados; uf='todas' = municípios do Brasil; uf='sp' = municípios de SP. */
export function carregarMalha(uf) {
  const chave = uf ?? 'brasil';
  if (!cacheMalhas.has(chave)) {
    const p = fetch(`api/mapa${uf ? `?uf=${uf}` : ''}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
      return d;
    });
    p.catch(() => cacheMalhas.delete(chave));
    cacheMalhas.set(chave, p);
  }
  return cacheMalhas.get(chave);
}

// Mercator em "graus" (mesma unidade da longitude), para o mapa não sair achatado.
const mercatorY = (lat) => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;

function limites(geo) {
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const f of geo.features) {
    for (const pol of f.geometry.coordinates) {
      for (const [lon, lat] of pol[0]) {
        const y = mercatorY(lat);
        if (lon < x0) x0 = lon; if (lon > x1) x1 = lon;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return { x0, x1, y0, y1 };
}

/** Faixas de cor: quantis (padrão) ou intervalos iguais; divergente: simétrico em torno da referência. */
export function classificar(valores, { modo = 'quantis', referencia = null, n = 5 } = {}) {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { cortes: [], cores: SEQUENCIAL, classe: () => -1 };
  if (referencia !== null && Number.isFinite(referencia)) {
    const maxDesvio = Math.max(...v.map((x) => Math.abs(x - referencia))) || 1;
    const passo = maxDesvio / 2.5;
    const cortes = [-1.5, -0.5, 0.5, 1.5].map((k) => referencia + k * passo);
    return { cortes, cores: DIVERGENTE, classe: (x) => indice(x, cortes), min: v[0], max: v.at(-1) };
  }
  let cortes;
  if (modo === 'intervalos') {
    const passo = (v.at(-1) - v[0]) / n;
    cortes = Array.from({ length: n - 1 }, (_, i) => v[0] + passo * (i + 1));
  } else {
    cortes = Array.from({ length: n - 1 }, (_, i) => v[Math.min(v.length - 1, Math.floor(((i + 1) * v.length) / n))]);
  }
  return { cortes, cores: SEQUENCIAL, classe: (x) => indice(x, cortes), min: v[0], max: v.at(-1) };
}

function indice(x, cortes) {
  if (!Number.isFinite(x)) return -1;
  let i = 0;
  while (i < cortes.length && x >= cortes[i]) i += 1;
  return i;
}

/**
 * Cria um mapa dentro de `container`.
 * @param {HTMLElement} container
 * @param {{aoClicar?: (codarea, feature) => void, dica?: ReturnType<import('./comum.js').criarDica>}} opcoes
 */
export function criarMapa(container, { aoClicar = null, dica = null } = {}) {
  container.classList.add('mapa');
  container.innerHTML = `<div class="mapa-area"></div>
    <div class="mapa-controles"><button type="button" data-zoom="1" title="Aproximar">+</button><button type="button" data-zoom="-1" title="Afastar">−</button><button type="button" data-zoom="0" title="Mostrar tudo">⟲</button></div>
    <div class="mapa-legenda"></div>`;
  const area = container.querySelector('.mapa-area');
  const legenda = container.querySelector('.mapa-legenda');
  let estado = null; // { svg, vb: [x, y, w, h], inicial, feicoes, valores, rotulos, formato }

  function aplicarVb() {
    estado.svg.setAttribute('viewBox', estado.vb.map((n) => n.toFixed(2)).join(' '));
    // Contorno fino em qualquer zoom.
    estado.svg.style.setProperty('--traco', `${(estado.vb[2] / estado.inicial[2]) * 0.6}px`);
    // Mapa em camadas (zonas → locais): o zoom decide qual aparece, como estado → cidade.
    if (estado.limiar) {
      const detalhe = estado.vb[2] / (estado.foco ?? estado.inicial)[2] < estado.limiar;
      if (detalhe !== estado.detalhe) {
        estado.detalhe = detalhe;
        container.classList.toggle('zoom-locais', detalhe);
        dica?.esconder();
        estado.aoTrocarCamada?.(detalhe);
      }
    }
  }

  function zoom(fator, cx, cy) {
    const [x, y, w, h] = estado.vb;
    const nw = Math.min(estado.inicial[2], Math.max(estado.inicial[2] / 60, w / fator));
    const nh = (nw / w) * h;
    const px = cx ?? x + w / 2;
    const py = cy ?? y + h / 2;
    estado.vb = [px - ((px - x) * nw) / w, py - ((py - y) * nh) / h, nw, nh];
    aplicarVb();
  }

  const pontoSvg = (ev) => {
    const r = estado.svg.getBoundingClientRect();
    const [x, y, w, h] = estado.vb;
    return [x + ((ev.clientX - r.left) / r.width) * w, y + ((ev.clientY - r.top) / r.height) * h];
  };

  container.querySelector('.mapa-controles').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-zoom]');
    if (!b || !estado) return;
    const z = Number(b.dataset.zoom);
    // ⟲: volta ao enquadramento inicial; de novo, mostra tudo (ex.: o município inteiro).
    if (z === 0) {
      const foco = estado.foco && estado.vb.join() !== estado.foco.join() ? estado.foco : estado.inicial;
      estado.vb = [...foco]; aplicarVb();
    } else zoom(z > 0 ? 1.6 : 1 / 1.6);
  });
  area.addEventListener('wheel', (ev) => {
    if (!estado) return;
    ev.preventDefault();
    const [cx, cy] = pontoSvg(ev);
    zoom(ev.deltaY < 0 ? 1.25 : 0.8, cx, cy);
  }, { passive: false });
  area.addEventListener('dblclick', (ev) => {
    if (!estado) return;
    const [cx, cy] = pontoSvg(ev);
    zoom(2, cx, cy);
  });

  // Arrastar (mouse, caneta ou dedo); um clique sem movimento conta como clique.
  let arraste = null;
  area.addEventListener('pointerdown', (ev) => {
    if (!estado || ev.button !== 0) return;
    arraste = { x: ev.clientX, y: ev.clientY, vb: [...estado.vb], moveu: false };
    area.setPointerCapture(ev.pointerId);
  });
  area.addEventListener('pointermove', (ev) => {
    if (!arraste) return;
    const dx = ev.clientX - arraste.x;
    const dy = ev.clientY - arraste.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) arraste.moveu = true;
    if (!arraste.moveu) return;
    const r = estado.svg.getBoundingClientRect();
    estado.vb = [arraste.vb[0] - (dx / r.width) * arraste.vb[2], arraste.vb[1] - (dy / r.height) * arraste.vb[3], arraste.vb[2], arraste.vb[3]];
    aplicarVb();
    dica?.esconder();
  });
  area.addEventListener('pointerup', (ev) => {
    const a = arraste;
    arraste = null;
    if (!a || a.moveu || !aoClicar) return;
    const alvo = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-cod]');
    if (alvo) aoClicar(alvo.dataset.cod, estado.feicoes.get(alvo.dataset.cod));
  });

  if (dica) {
    dica.ligar(area, '[data-cod]', (alvo) => {
      if (arraste?.moveu) return null;
      const cod = alvo.dataset.cod;
      const v = estado.valores.get(cod);
      const nome = estado.rotulos.get(cod) ?? cod;
      const extra = estado.extra?.(cod) ?? '';
      const cat = estado.categorias?.get(cod);
      const linha = estado.categorias
        ? `${esc(estado.titulo)}: ${cat ? esc(cat) : 'sem dado'}${Number.isFinite(v) ? ` (${esc(estado.formato(v))})` : ''}`
        : `${esc(estado.titulo)}: ${Number.isFinite(v) ? esc(estado.formato(v)) : 'sem dado'}`;
      return `<strong>${esc(nome)}</strong><span>${linha}</span>${extra}`;
    });
  }

  /**
   * @param {object} o
   * @param {object} o.geo  GeoJSON (de carregarMalha)
   * @param {Map<string, number>} o.valores  codarea → valor
   * @param {Map<string, string>} [o.rotulos]  codarea → nome
   * @param {string} [o.titulo]  nome da variável
   * @param {(v: number) => string} [o.formato]
   * @param {number|null} [o.referencia]  com referência, cores divergentes (abaixo/acima)
   * @param {'quantis'|'intervalos'} [o.modo]
   * @param {(cod: string) => string} [o.extra]  HTML extra na dica
   * @param {Set<string>} [o.destaques]  codareas com contorno reforçado
   * @param {Map<string, string>} [o.categorias]  codarea → categoria: mapa categórico (ex.: vencedor);
   *   `valores` passa a ser opcional e aparece só na dica
   * @param {Map<string, string>} [o.cores]  categoria → cor (senão, a paleta categórica pela ordem de frequência)
   * @param {Map<string, number>} [o.intensidade]  codarea → 0..1: cor mais forte onde é maior (ex.: margem)
   */
  function desenhar({ geo, valores = new Map(), rotulos = new Map(), titulo = '', formato = (v) => fmtNum.format(v), referencia = null, modo = 'quantis', extra = null, destaques = new Set(), categorias = null, cores = null, intensidade = null, rotuloSemDado = 'sem dado' }) {
    if (!geo?.features?.length) {
      area.innerHTML = '<p class="mudo">Mapa indisponível.</p>';
      legenda.innerHTML = '';
      estado = null;
      return;
    }
    const lim = limites(geo);
    const largura = 1000;
    const escala = largura / (lim.x1 - lim.x0);
    const altura = Math.max(200, (lim.y1 - lim.y0) * escala);
    const px = (lon) => ((lon - lim.x0) * escala).toFixed(1);
    const py = (lat) => ((lim.y1 - mercatorY(lat)) * escala).toFixed(1);
    const cls = classificar([...valores.values()], { modo, referencia });
    // Categórico: conta os locais por categoria e dá uma cor a cada uma.
    let corCat = null;
    let contagem = null;
    if (categorias) {
      contagem = new Map();
      for (const f of geo.features) {
        const c = categorias.get(f.properties.codarea);
        if (c) contagem.set(c, (contagem.get(c) ?? 0) + 1);
      }
      const ordem = [...contagem.keys()].sort((a, b) => contagem.get(b) - contagem.get(a));
      corCat = new Map(ordem.map((c, i) => [c, cores?.get(c) ?? CATEGORICA[i % CATEGORICA.length]]));
    }
    const feicoes = new Map();
    let paths = '';
    for (const f of geo.features) {
      const cod = f.properties.codarea;
      feicoes.set(cod, f);
      let d = '';
      for (const pol of f.geometry.coordinates) {
        for (const anel of pol) d += `M${anel.map(([lon, lat]) => `${px(lon)},${py(lat)}`).join('L')}Z`;
      }
      let fill;
      let opac = '';
      if (corCat) {
        const cat = categorias.get(cod);
        fill = cat ? corCat.get(cat) : SEM_DADO;
        const k = intensidade?.get(cod);
        if (cat && Number.isFinite(k)) opac = ` fill-opacity="${(0.35 + 0.65 * Math.max(0, Math.min(1, k))).toFixed(2)}"`;
      } else {
        const c = cls.classe(valores.get(cod));
        fill = c >= 0 ? cls.cores[c] : SEM_DADO;
      }
      paths += `<path data-cod="${esc(cod)}" d="${d}" fill="${fill}"${opac}${destaques.has(cod) ? ' class="destaque"' : ''}/>`;
    }
    area.innerHTML = `<svg viewBox="0 0 ${largura} ${altura.toFixed(1)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa: ${esc(titulo)}">
      <defs><pattern id="mapa-sem-dado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f2f1ed"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c9c8c2" stroke-width="2"/></pattern></defs>
      <g class="feicoes">${paths}</g></svg>`;
    container.classList.remove('zoom-locais');
    estado = { svg: area.querySelector('svg'), vb: [0, 0, largura, altura], inicial: [0, 0, largura, altura], feicoes, valores, rotulos, titulo, formato, extra, categorias };
    aplicarVb();

    if (corCat) {
      const semCat = geo.features.some((f) => !categorias.get(f.properties.codarea));
      legenda.innerHTML = `<span class="mapa-titulo">${esc(titulo)}</span>`
        + [...corCat].map(([c, cor]) => `<span class="mapa-faixa"><i style="background:${cor}"></i>${esc(c)} <span class="mudo">(${contagem.get(c)})</span></span>`).join('')
        + (intensidade ? '<span class="mapa-faixa mudo">cor mais forte = vitória mais folgada</span>' : '')
        + (semCat ? `<span class="mapa-faixa"><i class="sem-dado"></i>${esc(rotuloSemDado)}</span>` : '');
      return;
    }

    legenda.innerHTML = legendaFaixas(cls, { titulo, formato, referencia, temSemDado: geo.features.some((f) => !Number.isFinite(valores.get(f.properties.codarea))) });
  }

  // Legenda: faixas com os limites; divergente mostra a referência no meio.
  function legendaFaixas(cls, { titulo, formato, referencia = null, temSemDado = false, nota = '' }) {
    const ultimo = cls.cores.length - 1;
    const faixas = cls.cores.map((cor, i) => {
      const a = i === 0 ? cls.min : cls.cortes[i - 1];
      const b = i === ultimo ? cls.max : cls.cortes[i];
      // Pontas abertas ("até", "acima de") quando o extremo cai dentro da faixa vizinha.
      const texto = i === 0 && !(a < b) ? `até ${formato(b)}`
        : i === ultimo && !(a < b) ? `acima de ${formato(a)}`
          : `${formato(a)} – ${formato(b)}`;
      return { cor, texto, vazia: i > 0 && i < ultimo && !(a <= b) };
    }).filter((f) => !f.vazia);
    return `<span class="mapa-titulo">${esc(titulo)}</span>`
      + (cls.cortes.length || Number.isFinite(cls.min) ? faixas.map((f) => `<span class="mapa-faixa"><i style="background:${f.cor}"></i>${esc(f.texto)}</span>`).join('') : '')
      + (referencia !== null && Number.isFinite(referencia) ? `<span class="mapa-faixa mudo">centro = referência (${esc(formato(referencia))})</span>` : '')
      + (temSemDado ? '<span class="mapa-faixa"><i class="sem-dado"></i>sem dado</span>' : '')
      + nota;
  }

  const caminho = (aneis, px, py) => aneis.map((anel) => `M${anel.map(([lon, lat]) => `${px(lon)},${py(lat)}`).join('L')}Z`).join('');

  /**
   * Cidade dividida em áreas de influência dos locais de votação (aproximação visual): afastado,
   * as zonas eleitorais; com zoom, os locais. Tudo recortado pelo contorno da cidade.
   * @param {object} o
   * @param {object} o.contorno  feição GeoJSON da cidade (MultiPolygon, lon/lat)
   * @param {{cod:string, rotulo:string, aneis:number[][][], valor:number}[]} o.zonas
   * @param {{cod:string, rotulo:string, anel:number[][], valor:number}[]} o.locais
   * @param {number[][][]} o.bordas  segmentos [[lon,lat],[lon,lat]] entre zonas diferentes
   */
  function desenharCelulas({ contorno, zonas, locais, bordas = [], foco = null, titulo = '', formato = (v) => fmtNum.format(v), extra = null, limiar = 0.55, nota = '', aoTrocarCamada = null }) {
    const geo = { features: [contorno] };
    const lim = limites(geo);
    const largura = 1000;
    const escala = largura / (lim.x1 - lim.x0);
    const altura = Math.max(200, (lim.y1 - lim.y0) * escala);
    const px = (lon) => ((lon - lim.x0) * escala).toFixed(1);
    const py = (lat) => ((lim.y1 - mercatorY(lat)) * escala).toFixed(1);
    const cls = classificar([...zonas, ...locais].map((x) => x.valor));
    const cor = (v) => { const c = cls.classe(v); return c >= 0 ? cls.cores[c] : SEM_DADO; };
    const feicoes = new Map();
    const valores = new Map();
    const rotulos = new Map();
    const registrar = (x) => { feicoes.set(x.cod, x); valores.set(x.cod, x.valor); rotulos.set(x.cod, x.rotulo); };
    // Zona = um só bloco: o traço da cor do preenchimento esconde as divisões entre os seus locais.
    const pathsZonas = zonas.map((z) => { registrar(z); const f = cor(z.valor); return `<path data-cod="${esc(z.cod)}" d="${caminho(z.aneis, px, py)}" fill="${f}" style="stroke:${f}"/>`; }).join('');
    const pathsLocais = locais.map((l) => { registrar(l); return `<path data-cod="${esc(l.cod)}" d="${caminho([l.anel], px, py)}" fill="${cor(l.valor)}"/>`; }).join('');
    const dBordas = bordas.map(([a, b]) => `M${px(a[0])},${py(a[1])}L${px(b[0])},${py(b[1])}`).join('');
    const dCidade = contorno.geometry.coordinates.map((pol) => caminho(pol, px, py)).join('');
    const idRecorte = `recorte-${Math.random().toString(36).slice(2, 9)}`;
    area.innerHTML = `<svg viewBox="0 0 ${largura} ${altura.toFixed(1)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mapa: ${esc(titulo)}">
      <defs><pattern id="mapa-sem-dado" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f2f1ed"/><line x1="0" y1="0" x2="0" y2="6" stroke="#c9c8c2" stroke-width="2"/></pattern>
      <clipPath id="${idRecorte}"><path d="${dCidade}"/></clipPath></defs>
      <g clip-path="url(#${idRecorte})"><g class="feicoes camada-zonas">${pathsZonas}</g><g class="feicoes camada-locais">${pathsLocais}</g>
      <path class="bordas-zona" d="${dBordas}"/></g><path class="contorno-cidade" d="${dCidade}"/></svg>`;
    container.classList.remove('zoom-locais');
    // Foco: a parte da cidade com locais de votação (municípios enormes têm quase tudo na área urbana).
    let vbFoco = [0, 0, largura, altura];
    if (foco) {
      const [lon0, lat0, lon1, lat1] = foco;
      const fx0 = Number(px(lon0)); const fx1 = Number(px(lon1)); const fy0 = Number(py(lat1)); const fy1 = Number(py(lat0));
      let w = Math.max(fx1 - fx0, 1) * 1.15; let h = Math.max(fy1 - fy0, 1) * 1.15;
      if (w / h < largura / altura) w = (h * largura) / altura; else h = (w * altura) / largura; // mesma proporção do mapa
      w = Math.min(w, largura); h = Math.min(h, altura);
      vbFoco = [(fx0 + fx1) / 2 - w / 2, (fy0 + fy1) / 2 - h / 2, w, h];
    }
    estado = { svg: area.querySelector('svg'), vb: [...vbFoco], inicial: [0, 0, largura, altura], foco: vbFoco, feicoes, valores, rotulos, titulo, formato, extra, categorias: null, limiar, detalhe: false, aoTrocarCamada };
    aplicarVb();
    legenda.innerHTML = legendaFaixas(cls, { titulo, formato, temSemDado: [...zonas, ...locais].some((x) => !Number.isFinite(x.valor)), nota });
  }

  return { desenhar, desenharCelulas };
}
