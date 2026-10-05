import { ABRANGENCIAS, ELEICOES } from './tse.js';

// O servidor relê o TSE a cada 2 minutos; a página consulta o servidor a cada 30 s
// para mostrar logo as cidades que forem sendo lidas.
const INTERVALO_MS = 30_000;
const PAGINA = 50;

const $ = (id) => document.getElementById(id);
const el = {
  cargo: $('cargo'), uf: $('uf'), busca: $('busca'), buscaRotulo: $('busca-rotulo'), ordem: $('ordem'),
  status: $('status'), atualizar: $('atualizar'), erro: $('erro'),
  titulo: $('titulo'), horario: $('horario'), barra: $('barra-secoes'), pctSecoes: $('pct-secoes'),
  secoes: $('secoes'), leitura: $('leitura'), kpis: $('kpis'),
  tituloTabela: $('titulo-tabela'), escala: $('escala'), linhas: $('linhas'), mais: $('mais'), dica: $('dica'),
};

const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => `${fmtPct.format(v)}%`;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Cargos com código conhecido (o Conselho Distrital, só em Noronha, fica na tela de apuração).
const CARGOS = Object.values(ELEICOES).flatMap((e) =>
  e.cargos.filter((c) => c.codigo !== null).map((c) => ({ ...c, eleicao: e.codigo, valor: `${e.codigo}:${c.codigo}` })));

const estado = { dados: null, limite: PAGINA, timer: null, pedido: 0 };

const cargoAtual = () => CARGOS.find((c) => c.valor === el.cargo.value) ?? CARGOS[0];

// ---------- filtros ----------

function preencherUfs(valor) {
  const ufs = cargoAtual().abrangencias.filter((a) => a !== 'br');
  const opcoes = [['', 'Todos os estados'], ...ufs.map((u) => [u, ABRANGENCIAS[u]])]
    .sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[1].localeCompare(b[1], 'pt-BR')));
  el.uf.innerHTML = opcoes.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  el.uf.value = ufs.includes(valor) ? valor : '';
}

function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { cargo: p.get('cargo'), uf: p.get('uf') ?? '', ordem: p.get('ordem') };
}

function gravarHash() {
  const p = new URLSearchParams({ cargo: el.cargo.value });
  if (el.uf.value) p.set('uf', el.uf.value);
  if (el.ordem.value !== 'pctBrancosNulos') p.set('ordem', el.ordem.value);
  history.replaceState(null, '', `#${p}`);
}

// ---------- carga ----------

async function carregar() {
  const cargo = cargoAtual();
  const uf = el.uf.value;
  const pedido = ++estado.pedido;
  gravarHash();
  el.status.textContent = 'consultando…';
  el.status.className = 'status';
  el.atualizar.disabled = true;
  try {
    const params = new URLSearchParams({ ele: cargo.eleicao, cargo: cargo.codigo });
    if (uf) params.set('uf', uf);
    const res = await fetch(`api/${uf ? 'municipios' : 'estados'}?${params}`, { cache: 'no-store' });
    const dados = await res.json();
    if (!res.ok) throw new Error(dados.erro || `HTTP ${res.status}`);
    if (pedido !== estado.pedido) return; // o usuário já trocou de filtro
    dados.nivel = uf ? 'municipios' : 'estados';
    estado.dados = dados;
    el.erro.hidden = !dados.erro;
    el.erro.textContent = dados.erro ? `Aviso: ${dados.erro}` : '';
    renderizar();
    el.status.textContent = `consultado às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
    // Enquanto o servidor ainda lê a primeira passada, consulta de novo mais cedo.
    if (dados.lendo) setTimeout(() => pedido === estado.pedido && carregar(), 5_000);
  } catch (erro) {
    if (pedido !== estado.pedido) return;
    el.erro.hidden = false;
    el.erro.textContent = `Não foi possível carregar os dados: ${erro.message}`;
    el.status.textContent = 'falha na consulta';
    el.status.className = 'status falha';
  } finally {
    if (pedido === estado.pedido) el.atualizar.disabled = false;
  }
}

// ---------- renderização ----------

function linhasOrdenadas() {
  const d = estado.dados;
  const lista = d.nivel === 'estados'
    ? d.estados.map((e) => ({ ...e, id: e.uf }))
    : d.municipios.map((m) => ({ ...m, id: m.codigo }));
  const termo = el.busca.value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtrada = termo && d.nivel === 'municipios'
    ? lista.filter((l) => l.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(termo))
    : lista;
  const chave = el.ordem.value;
  return filtrada.sort((a, b) => {
    if (chave === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
    if (chave === 'secoes') return pctSecoes(b) - pctSecoes(a);
    return (b[chave] ?? 0) - (a[chave] ?? 0) || a.nome.localeCompare(b.nome, 'pt-BR');
  });
}

const pctSecoes = (r) => (r.secoes.total ? (r.secoes.totalizadas / r.secoes.total) * 100 : 0);

function kpi(classe, rotulo, valor, percentual) {
  return `<div class="kpi ${classe}"><dt>${classe ? `<i class="amostra ${classe}"></i>` : ''}${rotulo}</dt>
    <dd><span class="kpi-pct">${pct(percentual)}</span><small>${fmtInt.format(valor)} votos</small></dd></div>`;
}

function renderizarResumo() {
  const d = estado.dados;
  const r = d.nivel === 'estados' ? d.brasil : d.consolidado;
  const nomeLocal = d.nivel === 'estados' ? 'Brasil' : ABRANGENCIAS[d.uf];
  el.titulo.textContent = `${cargoAtual().nome} · ${nomeLocal}`;
  el.horario.textContent = r?.atualizadoEm ? `Atualizado pelo TSE em ${r.atualizadoEm}` : '';
  const pSec = r ? pctSecoes(r) : 0;
  el.barra.style.width = `${Math.min(100, pSec)}%`;
  el.pctSecoes.textContent = pct(pSec);
  el.secoes.textContent = r ? `(${fmtInt.format(r.secoes.totalizadas)} de ${fmtInt.format(r.secoes.total)}${d.nivel === 'municipios' ? ' nas cidades já lidas' : ''})` : '';

  if (d.nivel === 'municipios') {
    const total = d.total ?? '?';
    const proxima = d.proximaEmSegundos != null ? ` · próxima leitura em ${Math.ceil(d.proximaEmSegundos / 60)} min` : '';
    el.leitura.textContent = d.lendo
      ? `Lendo cidades no TSE… ${fmtInt.format(d.lidos)} de ${total} já lidas.`
      : `${fmtInt.format(d.lidos)} de ${total} cidades lidas${proxima}.`;
    el.leitura.hidden = false;
  } else {
    const faltam = d.total - d.lidos;
    el.leitura.textContent = faltam > 0 ? `${faltam} UF(s) ainda sem resultado publicado pelo TSE.` : '';
    el.leitura.hidden = d.lidos >= d.total;
  }

  el.kpis.innerHTML = r
    ? [
      kpi('brancos', 'Brancos', r.brancos, r.pctBrancos),
      kpi('nulos', 'Nulos', r.nulos, r.pctNulos),
      kpi('anulados', 'Anulados', r.anulados, r.pctAnulados),
      kpi('', 'Brancos + nulos', r.brancos + r.nulos, r.pctBrancosNulos),
    ].join('')
    : '<p class="mudo">Ainda sem dados publicados.</p>';
}

function renderizarTabela() {
  const d = estado.dados;
  const linhas = linhasOrdenadas();
  const visiveis = linhas.slice(0, estado.limite);
  // A escala das barras é comum a todas as linhas: o maior brancos + nulos + anulados da lista.
  const maximo = Math.max(1, ...linhas.map((l) => l.pctBrancos + l.pctNulos + l.pctAnulados));
  const escala = Math.ceil(maximo / 5) * 5;
  el.escala.textContent = `escala 0–${escala}%`;
  el.tituloTabela.textContent = d.nivel === 'estados' ? 'Por estado' : `Cidades de ${ABRANGENCIAS[d.uf]}`;

  const largura = (v) => `${(v / escala) * 100}%`;
  el.linhas.innerHTML = visiveis.length ? visiveis.map((l) => {
    // Barra empilhada brancos | nulos | anulados, na escala comum da tabela.
    const pilha = (extra) => `<div class="pilha ${extra}" data-dica="${esc(l.id)}">`
      + `<span class="brancos" style="width:${largura(l.pctBrancos)}"></span>`
      + `<span class="nulos" style="width:${largura(l.pctNulos)}"></span>`
      + `<span class="anulados" style="width:${largura(l.pctAnulados)}"></span></div>`;
    return `
    <tr data-id="${esc(l.id)}" class="${d.nivel === 'estados' ? 'clicavel' : ''}">
      <td class="local">${esc(l.nome)}${d.nivel === 'estados' ? ` <span class="mudo">${esc(l.uf.toUpperCase())}</span>` : ''}
        <small class="mudo">${fmtInt.format(l.total)} votos</small>${pilha('mini')}</td>
      <td class="num col-secoes">${pct(pctSecoes(l))}</td>
      <td class="num">${pct(l.pctBrancos)}<small>${fmtInt.format(l.brancos)}</small></td>
      <td class="num">${pct(l.pctNulos)}<small>${fmtInt.format(l.nulos)}</small></td>
      <td class="num col-anulados">${pct(l.pctAnulados)}<small>${fmtInt.format(l.anulados)}</small></td>
      <td class="num forte">${pct(l.pctBrancosNulos)}</td>
      <td class="col-barra">${pilha('')}</td>
    </tr>`;
  }).join('')
    : `<tr><td colspan="7" class="mudo">${d.nivel === 'municipios' && !d.lidos ? 'Lendo as cidades no TSE…' : 'Nada encontrado.'}</td></tr>`;

  el.mais.hidden = visiveis.length >= linhas.length;
  el.mais.textContent = `Mostrar mais (${fmtInt.format(linhas.length - visiveis.length)} restantes)`;
  estado.porId = new Map(linhas.map((l) => [String(l.id), l]));
}

function renderizar() {
  const d = estado.dados;
  el.buscaRotulo.hidden = d.nivel !== 'municipios';
  renderizarResumo();
  renderizarTabela();
}

// ---------- dica (hover/toque nas barras) ----------

function mostrarDica(alvo, x, y) {
  const l = estado.porId?.get(alvo.dataset.dica);
  if (!l) return;
  el.dica.innerHTML = `<strong>${esc(l.nome)}</strong>
    <span><i class="amostra brancos"></i>Brancos ${pct(l.pctBrancos)} · ${fmtInt.format(l.brancos)}</span>
    <span><i class="amostra nulos"></i>Nulos ${pct(l.pctNulos)} · ${fmtInt.format(l.nulos)}</span>
    <span><i class="amostra anulados"></i>Anulados ${pct(l.pctAnulados)} · ${fmtInt.format(l.anulados)}</span>
    <span class="mudo">${pct(pctSecoes(l))} das seções · ${fmtInt.format(l.total)} votos</span>`;
  el.dica.hidden = false;
  const { width, height } = el.dica.getBoundingClientRect();
  el.dica.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, x + 12))}px`;
  el.dica.style.top = `${Math.max(8, y - height - 12)}px`;
}

el.linhas.addEventListener('pointermove', (ev) => {
  const alvo = ev.target.closest('.pilha');
  if (alvo) mostrarDica(alvo, ev.clientX, ev.clientY);
  else el.dica.hidden = true;
});
el.linhas.addEventListener('pointerleave', () => { el.dica.hidden = true; });

// ---------- eventos ----------

el.linhas.addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr.clicavel');
  if (!tr) return;
  el.uf.value = tr.dataset.id;
  trocarFiltro();
  scrollTo({ top: 0, behavior: 'smooth' });
});

function trocarFiltro() {
  estado.limite = PAGINA;
  el.busca.value = '';
  estado.dados = null;
  el.linhas.innerHTML = '<tr><td colspan="7" class="mudo">Carregando…</td></tr>';
  carregar();
}

el.cargo.addEventListener('change', () => { preencherUfs(el.uf.value); trocarFiltro(); });
el.uf.addEventListener('change', trocarFiltro);
el.ordem.addEventListener('change', () => { gravarHash(); if (estado.dados) renderizarTabela(); });
el.busca.addEventListener('input', () => { estado.limite = PAGINA; if (estado.dados) renderizarTabela(); });
el.mais.addEventListener('click', () => { estado.limite += PAGINA; renderizarTabela(); });
el.atualizar.addEventListener('click', carregar);
document.querySelector('.bn thead').addEventListener('click', (ev) => {
  const th = ev.target.closest('th[data-ordem]');
  if (!th) return;
  el.ordem.value = th.dataset.ordem;
  gravarHash();
  if (estado.dados) renderizarTabela();
});

const inicial = lerHash();
el.cargo.innerHTML = CARGOS.map((c) => `<option value="${c.valor}">${esc(c.nome)}</option>`).join('');
if (CARGOS.some((c) => c.valor === inicial.cargo)) el.cargo.value = inicial.cargo;
if (inicial.ordem && [...el.ordem.options].some((o) => o.value === inicial.ordem)) el.ordem.value = inicial.ordem;
preencherUfs(inicial.uf);
carregar();
estado.timer = setInterval(() => { if (!document.hidden) carregar(); }, INTERVALO_MS);
