// Área de trabalho "Windows 98": gerenciador de janelas (arrastar, redimensionar,
// minimizar, maximizar, fechar, foco), ícones, barra de tarefas, menu Iniciar com
// submenus, menu de contexto e janelas próprias (Leia-me, Painéis, Lixeira, Vídeo,
// Desligar). As páginas do app abrem dentro das janelas em modo "embed".

import { icone } from './icones98.js';

const CHAVE_JANELAS = 'apuracao2026:janelas';
const CHAVE_FUNDO = 'apuracao2026:fundo';
const CHAVE_TEMA = 'apuracao2026:tema';
const ALTURA_TAREFAS = 30;
const MIN_W = 240;
const MIN_H = 150;

const MODULOS = [
  ['resumo', 'Resumo', 'calculadora', 'Brancos, nulos, anulados e abstenção do local, com o andamento das seções.', 640, 360],
  ['estat', 'Estatísticas', 'calculadora', 'Média ponderada e simples, mediana, desvio padrão, quartis, extremos e atípicos.', 560, 460],
  ['hist', 'Distribuição', 'histograma', 'Histograma da métrica escolhida; clique numa faixa para filtrar as outras janelas.', 620, 420],
  ['disp', 'Brancos × nulos', 'dispersao', 'Dispersão com tendência; cor pela posição em relação à referência.', 620, 500],
  ['extremos', 'Maiores e menores', 'podio', 'Os 10 maiores e os 10 menores valores da métrica.', 560, 460],
  ['cargos', 'Por cargo', 'balanca', 'Brancos e nulos de cada cargo no mesmo local.', 760, 330],
  ['comparacao', 'Comparação', 'balanca', 'Locais marcados com ☆ lado a lado.', 700, 400],
  ['tabela', 'Tabela de locais', 'tabela', 'Todos os locais com desvio, escore z e barras; ordenável.', 900, 560],
];

const APPS = {
  apuracao: { titulo: 'Apuração', icone: 'computador', url: 'index.html', w: 760, h: 620, descricao: 'Resultado por cargo, estado e município.' },
  brancos: { titulo: 'Brancos e nulos', icone: 'pastaPainel', url: 'brancos.html', w: 1000, h: 660, descricao: 'Painel completo de brancos, nulos e anulados.' },
  explorar: { titulo: 'Explorador de variáveis', icone: 'grafico', url: 'explorar.html', w: 1040, h: 680, descricao: 'Cruze variáveis da eleição e do Censo (estilo JASP).' },
  ...Object.fromEntries(MODULOS.map(([id, titulo, ic, descricao, w, h]) => [`brancos-${id}`, {
    titulo: `${titulo} — Brancos e nulos`, curto: titulo, icone: ic, url: 'brancos.html', modulo: id, w, h, descricao,
  }])),
  paineis: { titulo: 'Painéis de brancos e nulos', icone: 'pasta', nativo: 'paineis', w: 640, h: 440 },
  leiame: { titulo: 'Leia-me.txt — Bloco de notas', icone: 'documento', nativo: 'leiame', w: 560, h: 440 },
  lixeira: { titulo: 'Lixeira', icone: 'lixeira', nativo: 'lixeira', w: 420, h: 280 },
  video: { titulo: 'Propriedades de Vídeo', icone: 'pintura', nativo: 'video', w: 380, h: 300, fixa: true },
  sobre: { titulo: 'Sobre Eleições 2026', icone: 'ajuda', nativo: 'sobre', w: 400, h: 270, fixa: true },
  desligar: { titulo: 'Desligar o Windows', icone: 'desligar', nativo: 'desligar', w: 380, h: 250, fixa: true, modal: true },
};

const EXTERNOS = {
  tse: { titulo: 'Resultados TSE', icone: 'globo', href: 'https://resultados.tse.jus.br/oficial/app/index.html' },
  ibge: { titulo: 'IBGE SIDRA', icone: 'livro', href: 'https://sidra.ibge.gov.br' },
};

const ICONES_AREA = [
  ['apuracao', 'Apuração'], ['brancos', 'Brancos e nulos'], ['paineis', 'Painéis'],
  ['explorar', 'Explorador'], ['leiame', 'Leia-me.txt'], ['tse', 'Resultados TSE'], ['ibge', 'IBGE SIDRA'], ['lixeira', 'Lixeira'],
];

const FUNDOS = [
  ['#008080', 'Verde-água (padrão)'], ['#000080', 'Azul-marinho'], ['#3a6ea5', 'Azul Windows'], ['#404040', 'Grafite'], ['#5a2a5a', 'Ameixa'],
];

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const area = $('area');
const camada = $('janelas');
const estreita = () => innerWidth < 700;

let janelas = [];
let proximoId = 1;
let zTopo = 10;

// ---------- persistência ----------

function salvar() {
  const dados = janelas.filter((j) => !APPS[j.app].modal).map((j) => ({
    app: j.app, x: j.x, y: j.y, w: j.w, h: j.h, max: j.max, min: j.min, hash: hashDo(j), z: j.z,
  }));
  try { localStorage.setItem(CHAVE_JANELAS, JSON.stringify(dados)); } catch { /* sem armazenamento */ }
}

function hashDo(j) {
  try { return j.iframe?.contentWindow?.location.hash || j.hash || ''; } catch { return j.hash || ''; }
}

// ---------- janelas ----------

function urlDo(app, hash) {
  const a = APPS[app];
  const p = new URLSearchParams({ embed: '1' });
  if (a.modulo) p.set('modulo', a.modulo);
  return `${a.url}?${p}${hash ? (hash.startsWith('#') ? hash : `#${hash}`) : ''}`;
}

function limites() {
  return { w: area.clientWidth, h: innerHeight - ALTURA_TAREFAS };
}

function abrir(app, opcoes = {}) {
  if (EXTERNOS[app]) { window.open(EXTERNOS[app].href, '_blank', 'noopener'); return null; }
  const a = APPS[app];
  if (!a) return null;
  // Janelas próprias (fixas) e o painel completo existem uma vez só: reabrir só traz para a frente.
  const existente = (a.nativo || a.fixa) && janelas.find((j) => j.app === app);
  if (existente) { restaurar(existente); return existente; }

  const lim = limites();
  const n = janelas.length;
  const w = Math.min(opcoes.w ?? a.w, lim.w - 20);
  const h = Math.min(opcoes.h ?? a.h, lim.h - 20);
  const j = {
    id: proximoId++, app,
    x: opcoes.x ?? Math.max(4, Math.min(lim.w - w - 4, 70 + (n % 8) * 26 + (a.fixa ? (lim.w - w) / 2 - 70 : 0))),
    y: opcoes.y ?? Math.max(4, Math.min(lim.h - h - 4, 20 + (n % 8) * 26 + (a.fixa ? (lim.h - h) / 2 - 40 : 0))),
    w, h, max: opcoes.max ?? (estreita() && !a.fixa), min: false, hash: opcoes.hash ?? '',
  };
  j.el = document.createElement('section');
  j.el.className = `janela${a.fixa ? ' fixa' : ''}`;
  j.el.setAttribute('role', 'dialog');
  j.el.setAttribute('aria-label', a.titulo);
  j.el.innerHTML = `
    <header class="titulo">${icone(a.icone, 16)}<span class="titulo-texto">${esc(a.titulo)}</span>
      <span class="titulo-botoes">
        ${a.fixa ? '' : '<button type="button" class="tb" data-acao="minimizar" aria-label="Minimizar"><i class="i-min"></i></button><button type="button" class="tb" data-acao="maximizar" aria-label="Maximizar"><i class="i-max"></i></button>'}
        <button type="button" class="tb tb-fechar" data-acao="fechar" aria-label="Fechar"><i class="i-fechar"></i></button>
      </span>
    </header>
    ${a.nativo ? '' : `<div class="menubar"><span data-acao="recarregar"><u>A</u>tualizar</span><span data-acao="nova"><u>N</u>ova janela</span><span data-acao="separar"><u>A</u>brir em aba</span></div>`}
    <div class="conteudo"></div>
    ${a.fixa ? '' : '<div class="redim n" data-redim="n"></div><div class="redim s" data-redim="s"></div><div class="redim e" data-redim="e"></div><div class="redim w" data-redim="w"></div><div class="redim ne" data-redim="ne"></div><div class="redim nw" data-redim="nw"></div><div class="redim se" data-redim="se"></div><div class="redim sw" data-redim="sw"></div>'}`;
  const conteudo = j.el.querySelector('.conteudo');
  if (a.nativo) {
    conteudo.classList.add('nativo');
    conteudo.innerHTML = NATIVOS[a.nativo]();
    ligarNativo(a.nativo, conteudo, j);
  } else {
    j.iframe = document.createElement('iframe');
    j.iframe.title = a.titulo;
    j.iframe.src = urlDo(app, j.hash);
    conteudo.append(j.iframe);
    conteudo.insertAdjacentHTML('beforeend', '<div class="status"><span class="status-campo">Pronto</span><span class="status-campo status-local">Meu computador</span></div>');
    j.iframe.addEventListener('load', () => {
      j.el.querySelector('.status-campo').textContent = 'Concluído';
      try {
        j.iframe.contentWindow.addEventListener('pointerdown', () => focar(j), true);
      } catch { /* outra origem */ }
    });
  }
  if (a.modal) j.el.classList.add('modal');
  camada.append(j.el);
  janelas.push(j);
  ligarJanela(j);
  aplicarGeometria(j);
  if (opcoes.z) { j.z = opcoes.z; zTopo = Math.max(zTopo, j.z); j.el.style.zIndex = j.z; }
  if (opcoes.min) minimizar(j); else focar(j);
  renderizarTarefas();
  salvar();
  return j;
}

function aplicarGeometria(j) {
  const s = j.el.style;
  j.el.classList.toggle('maximizada', j.max);
  if (j.max) {
    s.left = '0px'; s.top = '0px'; s.width = '100%'; s.height = `${innerHeight - ALTURA_TAREFAS}px`;
  } else {
    s.left = `${j.x}px`; s.top = `${j.y}px`; s.width = `${j.w}px`; s.height = `${j.h}px`;
  }
  const botao = j.el.querySelector('[data-acao="maximizar"] i');
  if (botao) botao.className = j.max ? 'i-restaurar' : 'i-max';
}

function focar(j) {
  if (!j || j.min) return;
  j.z = ++zTopo;
  j.el.style.zIndex = j.z;
  for (const outra of janelas) outra.el.classList.toggle('ativa', outra === j);
  renderizarTarefas();
}

function ativa() {
  return janelas.filter((j) => !j.min).sort((a, b) => b.z - a.z)[0] ?? null;
}

function minimizar(j) {
  j.min = true;
  j.el.hidden = true;
  j.el.classList.remove('ativa');
  focar(ativa());
  renderizarTarefas();
  salvar();
}

function restaurar(j) {
  j.min = false;
  j.el.hidden = false;
  focar(j);
  salvar();
}

function alternarMax(j) {
  if (APPS[j.app].fixa) return;
  j.max = !j.max;
  aplicarGeometria(j);
  salvar();
}

function fechar(j) {
  j.el.remove();
  janelas = janelas.filter((x) => x !== j);
  focar(ativa());
  renderizarTarefas();
  salvar();
}

function ligarJanela(j) {
  const titulo = j.el.querySelector('.titulo');
  j.el.addEventListener('pointerdown', () => focar(j));
  j.el.addEventListener('click', (ev) => {
    const acao = ev.target.closest('[data-acao]')?.dataset.acao;
    if (!acao) return;
    if (acao === 'minimizar') minimizar(j);
    else if (acao === 'maximizar') alternarMax(j);
    else if (acao === 'fechar') fechar(j);
    else if (acao === 'recarregar') j.iframe?.contentWindow?.location.reload();
    else if (acao === 'nova') abrir(j.app, { hash: hashDo(j) });
    else if (acao === 'separar') window.open(urlDo(j.app, hashDo(j)), '_blank', 'noopener');
  });
  titulo.addEventListener('dblclick', (ev) => { if (!ev.target.closest('button')) alternarMax(j); });
  titulo.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target.closest('button')) return;
    arrastar(ev, j, (dx, dy, ini) => {
      if (j.max) return;
      const lim = limites();
      j.x = Math.round(Math.max(-j.w + 80, Math.min(lim.w - 80, ini.x + dx)));
      j.y = Math.round(Math.max(0, Math.min(lim.h - 24, ini.y + dy)));
      aplicarGeometria(j);
    });
  });
  for (const alca of j.el.querySelectorAll('[data-redim]')) {
    alca.addEventListener('pointerdown', (ev) => {
      if (j.max) return;
      const d = alca.dataset.redim;
      arrastar(ev, j, (dx, dy, ini) => {
        let { x, y, w, h } = ini;
        if (d.includes('e')) w = Math.max(MIN_W, ini.w + dx);
        if (d.includes('s')) h = Math.max(MIN_H, ini.h + dy);
        if (d.includes('w')) { w = Math.max(MIN_W, ini.w - dx); x = ini.x + ini.w - w; }
        if (d.includes('n')) { h = Math.max(MIN_H, ini.h - dy); y = Math.max(0, ini.y + ini.h - h); }
        Object.assign(j, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
        aplicarGeometria(j);
      });
    });
  }
}

// Arrastar com ponteiro (mouse, caneta ou dedo). Enquanto arrasta, os iframes não
// capturam o ponteiro (senão o movimento "some" ao passar por cima deles).
function arrastar(ev, j, mover) {
  ev.preventDefault();
  focar(j);
  const ini = { x: j.x, y: j.y, w: j.w, h: j.h, px: ev.clientX, py: ev.clientY };
  area.classList.add('arrastando');
  const alvo = ev.currentTarget;
  alvo.setPointerCapture?.(ev.pointerId);
  const aoMover = (e) => mover(e.clientX - ini.px, e.clientY - ini.py, ini);
  const aoSoltar = () => {
    area.classList.remove('arrastando');
    alvo.removeEventListener('pointermove', aoMover);
    alvo.removeEventListener('pointerup', aoSoltar);
    alvo.removeEventListener('pointercancel', aoSoltar);
    salvar();
  };
  alvo.addEventListener('pointermove', aoMover);
  alvo.addEventListener('pointerup', aoSoltar);
  alvo.addEventListener('pointercancel', aoSoltar);
}

// ---------- organizar ----------

function cascata() {
  const lim = limites();
  janelas.filter((j) => !j.min).sort((a, b) => a.z - b.z).forEach((j, i) => {
    Object.assign(j, { max: false, x: 20 + i * 28, y: 10 + i * 28, w: Math.min(APPS[j.app].w, lim.w - 60), h: Math.min(APPS[j.app].h, lim.h - 60) });
    aplicarGeometria(j);
    focar(j);
  });
  salvar();
}

function ladoALado() {
  const lista = janelas.filter((j) => !j.min && !APPS[j.app].fixa);
  if (!lista.length) return;
  const lim = limites();
  const cols = Math.ceil(Math.sqrt(lista.length));
  const linhas = Math.ceil(lista.length / cols);
  lista.forEach((j, i) => {
    const c = i % cols;
    const l = Math.floor(i / cols);
    Object.assign(j, { max: false, x: Math.round((c * lim.w) / cols), y: Math.round((l * lim.h) / linhas), w: Math.round(lim.w / cols), h: Math.round(lim.h / linhas) });
    aplicarGeometria(j);
  });
  salvar();
}

const minimizarTodas = () => janelas.forEach((j) => !j.min && minimizar(j));

// ---------- barra de tarefas ----------

function renderizarTarefas() {
  const foco = ativa();
  $('botoes-tarefas').innerHTML = janelas.filter((j) => !APPS[j.app].modal).map((j) => {
    const a = APPS[j.app];
    return `<button type="button" class="tarefa${j === foco && !j.min ? ' pressionado' : ''}" data-janela="${j.id}" title="${esc(a.titulo)}">${icone(a.icone, 16)}<span>${esc(a.curto ?? a.titulo)}</span></button>`;
  }).join('');
}

$('botoes-tarefas').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-janela]');
  const j = b && janelas.find((x) => String(x.id) === b.dataset.janela);
  if (!j) return;
  if (j.min) restaurar(j);
  else if (j === ativa()) minimizar(j);
  else focar(j);
});

$('iniciar').innerHTML = `${icone('janelas', 16)}<b>Iniciar</b>`;
$('rapido').innerHTML = [
  ['desktop', 'Mostrar área de trabalho', 'mostrar'], ['pastaPainel', 'Brancos e nulos', 'brancos'], ['grafico', 'Explorador', 'explorar'],
].map(([ic, t, acao]) => `<button type="button" class="rapido-botao" data-rapido="${acao}" title="${esc(t)}">${icone(ic, 16)}</button>`).join('');
$('rapido').addEventListener('click', (ev) => {
  const acao = ev.target.closest('[data-rapido]')?.dataset.rapido;
  if (acao === 'mostrar') minimizarTodas();
  else if (acao) abrir(acao);
});

function relogio() {
  const agora = new Date();
  $('relogio').textContent = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  $('relogio').title = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
relogio();
setInterval(relogio, 10_000);

// ---------- menus ----------

const itemMenu = (ic, texto, attrs, sub = '') =>
  `<li${sub ? ' class="tem-sub"' : ''}><button type="button" ${attrs}>${icone(ic, sub || attrs.includes('grande') ? 24 : 16)}<span>${texto}</span>${sub ? '<i class="seta">▶</i>' : ''}</button>${sub}</li>`;

function montarMenuIniciar() {
  const subPaineis = `<ul class="menu sub">${MODULOS.map(([id, t, ic]) => itemMenu(ic, esc(t), `data-abrir="brancos-${id}"`)).join('')}
    <li class="sep"></li>${itemMenu('pasta', 'Abrir pasta Painéis', 'data-abrir="paineis"')}</ul>`;
  const subEleicoes = `<ul class="menu sub">
    ${itemMenu('computador', 'Apuração', 'data-abrir="apuracao"')}
    ${itemMenu('pastaPainel', 'Brancos e nulos', 'data-abrir="brancos"')}
    ${itemMenu('pasta', 'Painéis', '', subPaineis)}
    ${itemMenu('grafico', 'Explorador de variáveis', 'data-abrir="explorar"')}</ul>`;
  const subProgramas = `<ul class="menu sub">
    ${itemMenu('programas', 'Eleições 2026', '', subEleicoes)}
    ${itemMenu('programas', 'Internet', '', `<ul class="menu sub">${itemMenu('globo', 'Resultados TSE', 'data-abrir="tse"')}${itemMenu('livro', 'IBGE SIDRA', 'data-abrir="ibge"')}</ul>`)}
    ${itemMenu('documento', 'Bloco de notas — Leia-me', 'data-abrir="leiame"')}</ul>`;
  const subConfig = `<ul class="menu sub">
    ${itemMenu('pintura', 'Vídeo (papel de parede)', 'data-abrir="video"')}
    ${itemMenu('moderno', 'Visual moderno', 'data-tema="moderno"')}</ul>`;
  const subOrganizar = `<ul class="menu sub">
    ${itemMenu('janelas', 'Cascata', 'data-org="cascata"')}${itemMenu('janelas', 'Lado a lado', 'data-org="lado"')}
    ${itemMenu('desktop', 'Minimizar todas', 'data-org="minimizar"')}${itemMenu('lixeira', 'Fechar todas', 'data-org="fechar"')}</ul>`;
  $('menu-iniciar').innerHTML = `<div class="faixa"><b>Eleições</b><span>2026</span></div><ul class="menu-lista">
    ${itemMenu('programas', '<u>P</u>rogramas', 'class="grande"', subProgramas)}
    ${itemMenu('documento', '<u>D</u>ocumentos', 'class="grande"', `<ul class="menu sub">${itemMenu('documento', 'Leia-me.txt', 'data-abrir="leiame"')}</ul>`)}
    ${itemMenu('config', '<u>C</u>onfigurações', 'class="grande"', subConfig)}
    ${itemMenu('janelas', '<u>J</u>anelas', 'class="grande"', subOrganizar)}
    ${itemMenu('ajuda', 'Aj<u>u</u>da', 'class="grande" data-abrir="sobre"')}
    <li class="sep"></li>
    ${itemMenu('desligar', 'De<u>s</u>ligar...', 'class="grande" data-abrir="desligar"')}</ul>`;
}

function abrirMenuIniciar(sim) {
  $('menu-iniciar').hidden = !sim;
  $('iniciar').classList.toggle('pressionado', sim);
  $('iniciar').setAttribute('aria-expanded', String(sim));
  if (!sim) for (const li of document.querySelectorAll('.tem-sub.aberto')) li.classList.remove('aberto');
}

function aoEscolher(ev) {
  const b = ev.target.closest('button');
  if (!b) return;
  // Itens com submenu abrem/fecham o submenu (no toque não há "passar o mouse").
  if (b.parentElement.classList.contains('tem-sub')) {
    ev.stopPropagation();
    const li = b.parentElement;
    for (const irmao of li.parentElement.children) if (irmao !== li) irmao.classList.remove('aberto');
    li.classList.toggle('aberto');
    return;
  }
  if (b.dataset.abrir) abrir(b.dataset.abrir);
  if (b.dataset.tema) mudarTema(b.dataset.tema);
  if (b.dataset.org) organizar(b.dataset.org);
  abrirMenuIniciar(false);
  $('menu-contexto').hidden = true;
}

function organizar(o) {
  if (o === 'cascata') cascata();
  else if (o === 'lado') ladoALado();
  else if (o === 'minimizar') minimizarTodas();
  else if (o === 'fechar') [...janelas].forEach(fechar);
  else if (o === 'atualizar') janelas.forEach((j) => j.iframe?.contentWindow?.location.reload());
}

$('iniciar').addEventListener('click', (ev) => { ev.stopPropagation(); abrirMenuIniciar($('menu-iniciar').hidden); });
$('menu-iniciar').addEventListener('click', aoEscolher);
$('menu-contexto').addEventListener('click', aoEscolher);
document.addEventListener('click', (ev) => {
  if (!$('menu-iniciar').contains(ev.target)) abrirMenuIniciar(false);
  if (!$('menu-contexto').contains(ev.target)) $('menu-contexto').hidden = true;
  if (!ev.target.closest('.icone-area')) for (const i of document.querySelectorAll('.icone-area.selecionado')) i.classList.remove('selecionado');
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { abrirMenuIniciar(false); $('menu-contexto').hidden = true; }
});

area.addEventListener('contextmenu', (ev) => {
  if (ev.target.closest('.janela')) return;
  ev.preventDefault();
  const m = $('menu-contexto');
  m.innerHTML = `<ul class="menu-lista">
    ${itemMenu('janelas', 'Organizar em <u>c</u>ascata', 'data-org="cascata"')}
    ${itemMenu('janelas', 'Organizar <u>l</u>ado a lado', 'data-org="lado"')}
    ${itemMenu('desktop', '<u>M</u>inimizar todas', 'data-org="minimizar"')}
    <li class="sep"></li>
    ${itemMenu('computador', 'A<u>t</u>ualizar janelas', 'data-org="atualizar"')}
    <li class="sep"></li>
    ${itemMenu('pintura', 'P<u>r</u>opriedades', 'data-abrir="video"')}</ul>`;
  m.hidden = false;
  const { width, height } = m.getBoundingClientRect();
  m.style.left = `${Math.min(ev.clientX, innerWidth - width - 4)}px`;
  m.style.top = `${Math.min(ev.clientY, innerHeight - ALTURA_TAREFAS - height - 4)}px`;
});

function mudarTema(t) {
  try { localStorage.setItem(CHAVE_TEMA, t); } catch { /* vale só nesta visita */ }
  location.href = './';
}

// ---------- ícones da área de trabalho ----------

function montarIcones() {
  $('icones').innerHTML = ICONES_AREA.map(([id, rotulo]) => {
    const a = APPS[id] ?? EXTERNOS[id];
    return `<button type="button" class="icone-area" data-abrir-icone="${id}">${icone(a.icone, 32)}<span>${esc(rotulo)}</span></button>`;
  }).join('');
}
$('icones').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-abrir-icone]');
  if (!b) return;
  for (const i of document.querySelectorAll('.icone-area.selecionado')) i.classList.remove('selecionado');
  b.classList.add('selecionado');
  // No toque, um toque abre (não existe duplo clique confortável); no mouse, duplo clique.
  if (ev.pointerType === 'touch' || matchMedia('(pointer: coarse)').matches) abrir(b.dataset.abrirIcone);
});
$('icones').addEventListener('dblclick', (ev) => {
  const b = ev.target.closest('[data-abrir-icone]');
  if (b) abrir(b.dataset.abrirIcone);
});
$('icones').addEventListener('keydown', (ev) => {
  const b = ev.target.closest('[data-abrir-icone]');
  if (b && ev.key === 'Enter') abrir(b.dataset.abrirIcone);
});

// ---------- janelas próprias ----------

const NATIVOS = {
  paineis: () => `
    <div class="pasta">
      <aside class="pasta-web">
        ${icone('pastaPainel', 32)}
        <h2>Painéis</h2>
        <hr>
        <p id="pasta-descricao">Selecione um item para ver sua descrição.</p>
        <p class="mudo">Cada painel abre numa janela própria. Os filtros (cargo, local, métrica…) ficam sincronizados entre as janelas.</p>
      </aside>
      <div class="pasta-itens">
        ${MODULOS.map(([id, t, ic]) => `<button type="button" class="item-pasta" data-modulo="brancos-${id}">${icone(ic, 32)}<span>${esc(t)}</span></button>`).join('')}
        <button type="button" class="item-pasta" data-modulo="brancos">${icone('pastaPainel', 32)}<span>Painel completo</span></button>
      </div>
    </div>
    <div class="status"><span class="status-campo">${MODULOS.length + 1} objeto(s)</span><span class="status-campo status-local">Meu computador</span></div>`,
  leiame: () => `<div class="bloco-menu"><span><u>A</u>rquivo</span><span><u>E</u>ditar</span><span><u>P</u>esquisar</span><span>Aj<u>u</u>da</span></div>
    <textarea class="bloco" readonly spellcheck="false">ELEIÇÕES 2026 — APURAÇÃO, BRANCOS E NULOS
==========================================

Como usar esta área de trabalho
-------------------------------
* Clique duas vezes num ícone para abrir (no celular, um toque).
* Arraste as janelas pela barra de título; redimensione pelas bordas.
* Botões da janela: minimizar, maximizar e fechar. Duplo clique no
  título maximiza.
* Botão direito na área de trabalho: cascata, lado a lado, atualizar.
* Iniciar > Programas > Eleições 2026 > Painéis abre cada painel de
  brancos e nulos numa janela separada. Os filtros andam juntos.
* As janelas abertas e suas posições ficam guardadas neste navegador.

De onde vêm os dados
--------------------
* Resultados: arquivos públicos do TSE (resultados.tse.jus.br,
  ambiente oficial), relidos a cada 2 minutos.
* Brancos = v.vb; nulos = v.tvn (nulos + nulos técnicos);
  anulados = v.van + v.vansj (candidatos com registro anulado ou
  sub judice). Percentuais sobre o total de votos.
* Abstenção = aptos que não votaram, sobre os aptos das seções já
  totalizadas.
* Censo: API de agregados do IBGE (SIDRA), baixada sob demanda e
  guardada na pasta dados/censo.

Cuidados na leitura
-------------------
* Os números cobrem só as seções já totalizadas.
* Cidades pequenas variam mais por acaso: compare portes parecidos.
* Correlação entre locais não diz nada sobre eleitores individuais
  (falácia ecológica).
</textarea>`,
  lixeira: () => `<div class="pasta-vazia">${icone('lixeira', 32)}<p>A Lixeira está vazia.</p><p class="mudo">Nenhum voto foi jogado fora: brancos e nulos ficam no painel. 😉</p></div>
    <div class="status"><span class="status-campo">0 objeto(s)</span><span class="status-campo status-local">0 bytes</span></div>`,
  video: () => `<div class="dialogo">
    <div class="abas-98"><span class="aba ativa">Plano de fundo</span><span class="aba">Proteção de tela</span><span class="aba">Aparência</span></div>
    <div class="aba-corpo">
      <div class="monitor"><div class="monitor-tela" id="previa-fundo"></div></div>
      <fieldset><legend>Cor da área de trabalho</legend>
        ${FUNDOS.map(([cor, nome]) => `<label class="radio"><input type="radio" name="fundo" value="${cor}"> ${esc(nome)}</label>`).join('')}
      </fieldset>
    </div>
    <div class="dialogo-botoes"><button type="button" data-ok>OK</button><button type="button" data-acao="fechar">Cancelar</button></div></div>`,
  sobre: () => `<div class="dialogo sobre">
    <div class="sobre-corpo">${icone('janelas', 32)}
      <div><p><strong>Eleições 2026</strong><br>Apuração · Brancos e nulos · Explorador</p>
      <p>Dados públicos do TSE (ambiente oficial) e do IBGE.<br>Este programa só exibe os arquivos publicados; ele não conta votos.</p>
      <p class="mudo">Interface inspirada no Windows 98.</p></div></div>
    <div class="dialogo-botoes"><button type="button" data-acao="fechar">OK</button></div></div>`,
  desligar: () => `<div class="dialogo">
    <div class="sobre-corpo">${icone('desligar', 32)}
      <fieldset class="sem-borda"><legend>O que você deseja fazer?</legend>
        <label class="radio"><input type="radio" name="desligar" value="moderno" checked> Voltar ao visual moderno</label>
        <label class="radio"><input type="radio" name="desligar" value="reiniciar"> Reiniciar (recarregar a área de trabalho)</label>
        <label class="radio"><input type="radio" name="desligar" value="limpar"> Fechar todas as janelas e reiniciar</label>
      </fieldset></div>
    <div class="dialogo-botoes"><button type="button" data-ok>OK</button><button type="button" data-acao="fechar">Cancelar</button><button type="button" data-ajuda>Ajuda</button></div></div>`,
};

function ligarNativo(tipo, conteudo, j) {
  if (tipo === 'paineis') {
    const descricao = conteudo.querySelector('#pasta-descricao');
    conteudo.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-modulo]');
      if (!b) return;
      for (const i of conteudo.querySelectorAll('.item-pasta')) i.classList.toggle('selecionado', i === b);
      const a = APPS[b.dataset.modulo];
      descricao.innerHTML = `<strong>${esc(a.curto ?? a.titulo)}</strong><br>${esc(a.descricao)}`;
      if (matchMedia('(pointer: coarse)').matches) abrir(b.dataset.modulo);
    });
    conteudo.addEventListener('dblclick', (ev) => {
      const b = ev.target.closest('[data-modulo]');
      if (b) abrir(b.dataset.modulo);
    });
  }
  if (tipo === 'video') {
    const atual = lerFundo();
    const previa = conteudo.querySelector('#previa-fundo');
    previa.style.background = atual;
    for (const r of conteudo.querySelectorAll('input[name="fundo"]')) {
      r.checked = r.value === atual;
      r.addEventListener('change', () => { previa.style.background = r.value; });
    }
    conteudo.querySelector('[data-ok]').addEventListener('click', () => {
      const escolhido = conteudo.querySelector('input[name="fundo"]:checked')?.value;
      if (escolhido) aplicarFundo(escolhido, true);
      fechar(j);
    });
  }
  if (tipo === 'desligar') {
    conteudo.querySelector('[data-ok]').addEventListener('click', () => {
      const v = conteudo.querySelector('input[name="desligar"]:checked').value;
      if (v === 'moderno') mudarTema('moderno');
      else if (v === 'limpar') { try { localStorage.removeItem(CHAVE_JANELAS); } catch { /* ignora */ } location.reload(); }
      else location.reload();
    });
    conteudo.querySelector('[data-ajuda]').addEventListener('click', () => abrir('leiame'));
  }
}

function lerFundo() {
  try { return localStorage.getItem(CHAVE_FUNDO) || FUNDOS[0][0]; } catch { return FUNDOS[0][0]; }
}

function aplicarFundo(cor, guardar) {
  document.body.style.background = cor;
  if (guardar) try { localStorage.setItem(CHAVE_FUNDO, cor); } catch { /* ignora */ }
}

// ---------- mensagens das páginas embutidas ----------

addEventListener('message', (ev) => {
  if (ev.origin !== location.origin) return;
  const j = janelas.find((x) => x.iframe?.contentWindow === ev.source);
  if (!j) return;
  if (ev.data?.tipo === 'foco') focar(j);
  if (ev.data?.tipo === 'abrir' && APPS[ev.data.app]) abrir(ev.data.app, { hash: ev.data.hash });
  if (ev.data?.tipo === 'hash') salvar();
});

addEventListener('resize', () => janelas.forEach((j) => j.max && aplicarGeometria(j)));
addEventListener('pagehide', salvar);
setInterval(salvar, 15_000);

// ---------- início ----------

aplicarFundo(lerFundo(), false);
montarIcones();
montarMenuIniciar();

let salvas = [];
try { salvas = JSON.parse(localStorage.getItem(CHAVE_JANELAS) || '[]'); } catch { salvas = []; }
for (const s of salvas.sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
  if (APPS[s.app] && !APPS[s.app].modal) abrir(s.app, s);
}
// Link vindo de uma página do app (desktop.html#abrir=brancos&h=…): abre essa janela.
const pedido = new URLSearchParams(location.hash.slice(1));
if (pedido.get('abrir') && APPS[pedido.get('abrir')]) {
  const h = pedido.get('h') ?? '';
  const ja = janelas.find((j) => j.app === pedido.get('abrir') && (!h || hashDo(j) === h));
  if (ja) restaurar(ja); else abrir(pedido.get('abrir'), { hash: h });
  history.replaceState(null, '', location.pathname);
} else if (!janelas.length) {
  abrir('brancos');
  if (!estreita()) abrir('leiame', { x: Math.max(20, innerWidth - 620), y: 40 });
}
