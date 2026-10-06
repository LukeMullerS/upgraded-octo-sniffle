// Logs das urnas: o servidor compila sozinho os logs de todas as seções do Brasil (ver
// src/logs.js); esta página mostra o progresso da compilação e os resultados por estado,
// município e seção — tempo na cabine e de atendimento, biometria, horários — num mapa
// interativo e cruzados com brancos e nulos do resultado oficial.

import {
  CARGOS, CODIGO_IBGE_UF, UF_DO_CODIGO, baixarCsv, cargoPorValor, carregarEstados, carregarMunicipios, criarDica, dadosUrnas, esc,
  fmtInt, fmtNum, nomeUf, pct, semAcento,
} from './comum.js';
import { UFS } from './tse.js';
import { METRICAS, regressaoLinear, testeCorrelacao, valorMetrica } from './calculos.js';
import { svgBarras, svgDispersao, svgHistograma } from './graficos.js';
import { carregarMalha, criarMapa } from './mapa.js';

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'uf', 'mun', 'indicador', 'metrica-bn', 'cargo', 'status', 'exportar', 'atualizar', 'erro', 'titulo', 'sub-titulo',
  'ler-municipio', 'pct-lidas', 'lidas', 'kpis', 'sub-hist', 'hist', 'hora',
  'cruzamento-cartao', 'titulo-cruzamento', 'correlacao', 'cruzamento', 'nota-cruzamento', 'tipos',
  'titulo-tabela', 'busca', 'tabela', 'mais', 'dica',
  'estado-compilacao', 'pausar', 'barra-nacional', 'pct-nacional', 'texto-nacional', 'por-uf',
  'mapa-cartao', 'titulo-mapa', 'sub-mapa', 'mapa',
].map((id) => [id.replace(/-(\w)/g, (_, l) => l.toUpperCase()), $(id)]));

const PAGINA = 60;
const dica = criarDica(el.dica);
const estado = { logs: null, bn: null, nacional: null, linhas: [], limite: PAGINA, pedido: 0, timer: null, pontos: [], ordem: null };

/** 64 → "1:04" (minutos:segundos). */
const mmss = (s) => {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  const t = Math.round(s); // 59,6 s → 1:00 (e não "0:60")
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
/** 28801 → "08:00" (hora do dia). */
const hhmm = (s) => (s === null || s === undefined || !Number.isFinite(s) ? '—' : `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`);

// Indicadores do mapa e do ranking: nome, valor a partir de um resumo e formatação.
const INDICADORES = {
  cabine: { nome: 'Tempo médio na cabine', valor: (r) => r.cabine?.media, fmt: mmss },
  atendimento: { nome: 'Tempo médio de atendimento', valor: (r) => r.atendimento?.media, fmt: mmss },
  habilitacao: { nome: 'Tempo de habilitação', valor: (r) => r.habilitacao?.media, fmt: mmss },
  bio: { nome: '% habilitação biométrica', valor: (r) => r.pctBiometrica, fmt: (v) => pct(v) },
  manual: { nome: '% habilitação manual', valor: (r) => r.pctManual, fmt: (v) => pct(v) },
  teclas: { nome: 'Teclas indevidas por eleitor', valor: (r) => r.teclasPorEleitor, fmt: (v) => fmtNum.format(v) },
  abertura: { nome: 'Horário médio de abertura', valor: (r) => r.aberturaMedia, fmt: hhmm },
  encerramento: { nome: 'Horário médio de encerramento', valor: (r) => r.encerramentoMedio, fmt: hhmm },
  bn: { nome: '% brancos e nulos', valor: null, fmt: (v) => pct(v) },
};

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const d = await res.json();
  if (!res.ok) throw new Error(d.erro || `HTTP ${res.status}`);
  return d;
}

// No site público os logs vêm da base estática (public/urnas), a mesma para todos: nenhum
// usuário faz o servidor baixar logs do TSE. Num servidor local, a compilação ao vivo vem
// primeiro e a base estática cobre o que ela ainda não leu.
const LOCAL = /^(localhost|127\.|192\.168\.|10\.|\[::1\])/.test(location.hostname);
const temDados = (d) => Boolean(d?.lidas || d?.progresso?.lidas || d?.estados?.length || d?.secoes?.length);
async function lerLogs(arquivo, api) {
  if (!LOCAL) return dadosUrnas(arquivo, api);
  const vivo = await getJson(api).catch(() => null);
  if (temDados(vivo) || vivo?.ativo) return vivo;
  return dadosUrnas(arquivo, api).catch(() => vivo);
}

const cargoAtual = () => cargoPorValor(el.cargo.value) ?? CARGOS[0];
const metricaBn = () => el.metricaBn.value;
const indicador = () => INDICADORES[el.indicador.value] ?? INDICADORES.cabine;
const nomeIndicador = () => (el.indicador.value === 'bn' ? `% ${METRICAS[metricaBn()].nome.toLowerCase()}` : indicador().nome);

// ---------- filtros e link ----------

function preencher() {
  const ufs = [...Object.keys(UFS), 'zz'].sort((a, b) => nomeUf(a).localeCompare(nomeUf(b), 'pt-BR'));
  el.uf.innerHTML = `<option value="">Brasil inteiro</option>${ufs.map((u) => `<option value="${u}">${esc(nomeUf(u))}</option>`).join('')}`;
  el.cargo.innerHTML = CARGOS.filter((c) => c.abrangencias.length > 1).map((c) => `<option value="${c.valor}">${esc(c.nome)}</option>`).join('');
}

function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('uf') && [...el.uf.options].some((o) => o.value === p.get('uf'))) el.uf.value = p.get('uf');
  if (p.get('cargo') && [...el.cargo.options].some((o) => o.value === p.get('cargo'))) el.cargo.value = p.get('cargo');
  if (p.get('metrica') && METRICAS[p.get('metrica')]) el.metricaBn.value = p.get('metrica');
  if (p.get('ind') && INDICADORES[p.get('ind')]) el.indicador.value = p.get('ind');
  return p.get('mun') ?? '';
}

function gravarHash() {
  const p = new URLSearchParams();
  if (el.uf.value) p.set('uf', el.uf.value);
  if (el.mun.value) p.set('mun', el.mun.value);
  if (el.cargo.value !== CARGOS[0].valor) p.set('cargo', el.cargo.value);
  if (metricaBn() !== 'pctBrancosNulos') p.set('metrica', metricaBn());
  if (el.indicador.value !== 'cabine') p.set('ind', el.indicador.value);
  history.replaceState(null, '', `#${p}`);
}

// ---------- compilação nacional ----------

async function atualizarNacional() {
  try {
    estado.nacional = await lerLogs('nacional.json', 'api/urnas/nacional');
  } catch {
    estado.nacional = null;
  }
  renderizarNacional();
}

function renderizarNacional() {
  const n = estado.nacional;
  if (!n) {
    el.estadoCompilacao.textContent = 'compilação indisponível';
    el.pausar.hidden = true;
    return;
  }
  // Desligada (LOGS_NACIONAL=0 ou servidor serverless, como o Vercel): sem botão.
  el.pausar.hidden = !n.ativo;
  el.pausar.textContent = n.pausado ? 'Retomar' : 'Pausar';
  const pctN = n.total ? (n.lidas / n.total) * 100 : 0;
  el.barraNacional.style.width = `${Math.min(100, pctN)}%`;
  el.pctNacional.textContent = n.total ? `${fmtNum.format(pctN)}%` : fmtInt.format(n.lidas);
  const conhecidas = n.porUf.filter((u) => u.total !== null).length;
  el.textoNacional.textContent = n.total
    ? `das seções lidas: ${fmtInt.format(n.lidas)} de ${fmtInt.format(n.total)}${conhecidas < n.porUf.length ? ` (lista de seções de ${conhecidas} de ${n.porUf.length} UFs)` : ''}`
    : 'aguardando a lista de seções do TSE…';
  // A leitura sob demanda ("Ler este município agora") só funciona num servidor local: no
  // Vercel a função não continua depois da resposta (ver renderizar).
  el.estadoCompilacao.textContent = n.retrato ? `base compilada em ${new Date(n.retrato.geradoEm).toLocaleString('pt-BR')} — a mesma para todos os usuários`
    : !n.ativo ? (LOCAL ? 'leitura automática desligada neste servidor — escolha um município e use "Ler este município agora"' : 'base dos logs ainda não compilada para o site público')
    : n.pausado ? 'pausada'
      : n.ufAtual ? `lendo ${nomeUf(n.ufAtual)}…`
        : n.proximaEmSegundos !== null ? `próxima passada em ${Math.max(1, Math.ceil(n.proximaEmSegundos / 60))} min`
          : 'iniciando…';
  if (n.erros) el.estadoCompilacao.textContent += ` · ${fmtInt.format(n.erros)} falha(s)${n.ultimoErro ? `: ${n.ultimoErro}` : ''}`;
  el.porUf.innerHTML = n.porUf.map((u) => {
    const p = u.total ? Math.round((u.lidas / u.total) * 100) : 0;
    return `<button type="button" class="uf-progresso${u.uf === n.ufAtual ? ' atual' : ''}" data-uf="${u.uf}" title="${esc(nomeUf(u.uf))}">
      <strong>${u.uf.toUpperCase()}</strong><span class="mini-barra"><span style="width:${p}%"></span></span>
      <small>${u.total === null ? '…' : `${fmtInt.format(u.lidas)}/${fmtInt.format(u.total)}`}</small></button>`;
  }).join('');
}

el.pausar.addEventListener('click', async () => {
  const n = estado.nacional;
  el.pausar.disabled = true;
  try {
    const res = await fetch(`api/urnas/${n?.pausado || !n?.ativo ? 'retomar' : 'pausar'}`, { method: 'POST', cache: 'no-store' });
    if (res.ok) estado.nacional = await res.json();
  } catch { /* o próximo ciclo mostra o estado */ }
  el.pausar.disabled = false;
  renderizarNacional();
});
el.porUf.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-uf]');
  if (!b) return;
  el.uf.value = b.dataset.uf;
  el.mun.innerHTML = '<option value="">Todos</option>';
  estado.ordem = null;
  carregar();
});

// ---------- carga ----------

async function carregar({ coletar = false, munInicial = null } = {}) {
  const pedido = ++estado.pedido;
  const uf = el.uf.value;
  el.status.textContent = 'consultando…';
  el.status.className = 'status';
  try {
    let logs;
    let bn = null;
    atualizarNacional();
    if (!uf) {
      [logs, bn] = await Promise.all([lerLogs('brasil.json', 'api/urnas/brasil'), carregarEstados(cargoAtual(), { fundo: true }).catch(() => null)]);
      logs.nivel = 'brasil';
    } else {
      const est = await lerLogs(`estado-${uf}.json`, `api/urnas/estado?uf=${uf}`);
      if (pedido !== estado.pedido) return;
      preencherMunicipios(est, munInicial ?? el.mun.value);
      const mun = el.mun.value;
      if (mun) {
        logs = coletar
          ? await getJson(`api/urnas/municipio?uf=${uf}&mun=${mun}&coletar=1`)
          : await lerLogs(`municipio/${uf}/${mun}.json`, `api/urnas/municipio?uf=${uf}&mun=${mun}`);
        logs.nivel = 'municipio';
        logs.estadoUf = est;
      } else {
        logs = est;
        logs.nivel = 'estado';
      }
      bn = await carregarMunicipios(cargoAtual(), uf).catch(() => null);
    }
    if (pedido !== estado.pedido) return;
    estado.logs = logs;
    estado.bn = bn;
    if (bn?.pendentes || bn?.lendo) setTimeout(() => pedido === estado.pedido && carregar(), 4_000);
    el.erro.hidden = true;
    gravarHash();
    renderizar();
    el.status.textContent = `consultado às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
  } catch (erro) {
    if (pedido !== estado.pedido) return;
    el.erro.hidden = false;
    el.erro.textContent = `Não foi possível carregar: ${erro.message}`;
    el.status.textContent = 'falha na consulta';
    el.status.className = 'status falha';
  }
  agendar();
}

function agendar() {
  clearTimeout(estado.timer);
  // Enquanto a compilação lê, a página acompanha mais de perto.
  const lendo = estado.nacional?.ufAtual || estado.logs?.progresso?.lendo;
  estado.timer = setTimeout(() => { if (!document.hidden) carregar(); else agendar(); }, lendo ? 10_000 : 60_000);
}

function preencherMunicipios(est, valor) {
  const lista = [...(est.municipios ?? [])].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const opcoes = lista.map((m) => `<option value="${m.codigo}">${esc(m.nome)} (${fmtInt.format(m.lidas)}/${fmtInt.format(m.totalSecoes)})</option>`).join('');
  el.mun.innerHTML = `<option value="">Todos</option>${opcoes}`;
  if (lista.some((m) => m.codigo === valor)) el.mun.value = valor;
}

// ---------- renderização ----------

function kpi(rotulo, valor, detalhe = '') {
  return `<div class="kpi"><dt>${rotulo}</dt><dd><span class="kpi-pct">${valor}</span>${detalhe ? `<small>${detalhe}</small>` : ''}</dd></div>`;
}

function renderizar() {
  const d = estado.logs;
  const r = d.resumo ?? null;
  const nomeLocal = d.nivel === 'brasil' ? 'Brasil' : d.nivel === 'estado' ? nomeUf(el.uf.value) : `${d.nome ?? d.municipio} · ${el.uf.value.toUpperCase()}`;
  el.titulo.textContent = `Logs das urnas · ${nomeLocal}`;
  el.lerMunicipio.hidden = d.nivel !== 'municipio' || !LOCAL;

  // Progresso do local escolhido.
  let lidas = 0;
  let total = 0;
  if (d.nivel === 'municipio') { lidas = d.secoes.length; total = d.totalSecoes ?? d.progresso?.total ?? 0; }
  else if (d.nivel === 'estado') { lidas = d.progresso?.lidas ?? 0; total = d.progresso?.total ?? 0; }
  else { lidas = estado.nacional?.lidas ?? r?.secoes ?? 0; total = estado.nacional?.total ?? 0; }
  const pctLidas = total ? (lidas / total) * 100 : 0;
  el.pctLidas.textContent = total ? `${fmtNum.format(pctLidas)}%` : fmtInt.format(lidas);
  el.lidas.textContent = total
    ? `das seções deste local já compiladas (${fmtInt.format(lidas)} de ${fmtInt.format(total)})${d.progresso?.lendo ? ' · lendo agora…' : ''}`
    : 'seções compiladas até agora';
  el.subTitulo.textContent = d.nivel === 'municipio' ? 'seção por seção' : 'clique no mapa ou na tabela para detalhar';

  el.kpis.innerHTML = r && r.votos
    ? [
      kpi('Eleitores nos logs', fmtInt.format(r.votos), `${fmtInt.format(r.secoes)} seções`),
      kpi('Tempo médio na cabine', mmss(r.cabine.media), `mediana ${mmss(r.cabine.mediana)} · 90% até ${mmss(r.cabine.p90)}`),
      kpi('Atendimento médio', mmss(r.atendimento.media), `biometria/habilitação ${mmss(r.habilitacao.media)}`),
      kpi('Habilitação biométrica', pct(r.pctBiometrica ?? 0), `manual ${pct(r.pctManual ?? 0)} · sem biometria ${pct(r.pctSemBiometria ?? 0)}`),
      kpi('Horário médio', `${hhmm(r.aberturaMedia)}–${hhmm(r.encerramentoMedio)}`, `teclas indevidas: ${fmtNum.format(r.teclasPorEleitor ?? 0)} por eleitor`),
    ].join('')
    : '<p class="mudo">Nenhum log compilado ainda neste local. O servidor lê sozinho as seções à medida que o TSE publica os arquivos das urnas.</p>';

  renderizarHistograma(r);
  renderizarHoras(r);
  renderizarTipos(r);
  montarLinhas();
  renderizarMapa();
  renderizarCruzamento();
  renderizarTabela();
}

function renderizarHistograma(r) {
  const hist = r?.hist ?? [];
  if (!hist.some(Boolean)) { el.hist.innerHTML = '<p class="mudo">Sem dados.</p>'; el.subHist.textContent = ''; return; }
  // Corta as faixas vazias do fim (mantém uma), para o eixo acompanhar os dados.
  let ultima = hist.length - 1;
  while (ultima > 0 && !hist[ultima]) ultima -= 1;
  const faixas = hist.slice(0, Math.min(hist.length, ultima + 2))
    .map((contagem, i) => ({ inicio: (i * 15) / 60, fim: ((i + 1) * 15) / 60, contagem }));
  estado.faixasHist = faixas;
  el.subHist.textContent = 'faixas de 15 s';
  el.hist.innerHTML = svgHistograma({
    faixas, rotuloX: 'minutos na cabine', cor: 'var(--cat-1)',
    linhas: [
      { valor: (r.cabine.mediana ?? 0) / 60, classe: 'ref-mediana', rotulo: 'mediana' },
      { valor: (r.cabine.media ?? 0) / 60, classe: 'ref-principal', rotulo: 'média' },
    ],
  });
}

function renderizarHoras(r) {
  const itens = Object.entries(r?.porHora ?? {}).sort((a, b) => a[0] - b[0]).map(([h, n]) => ({ nome: `${String(h).padStart(2, '0')}h`, valor: n }));
  estado.itensHora = itens;
  el.hora.innerHTML = itens.length ? svgBarras({ itens, rotuloX: 'votos computados', cor: 'var(--cat-3)', fmtValor: fmtInt.format }) : '<p class="mudo">Sem dados.</p>';
}

function renderizarTipos(r) {
  if (!r?.votos) { el.tipos.innerHTML = '<p class="mudo">Sem dados.</p>'; return; }
  const itens = [
    { nome: 'Biometria', valor: r.pctBiometrica ?? 0 },
    { nome: 'Manual', valor: r.pctManual ?? 0 },
    { nome: 'Sem biometria', valor: r.pctSemBiometria ?? 0 },
  ];
  el.tipos.innerHTML = svgBarras({ itens, rotuloX: '% dos eleitores', cor: 'var(--cat-7)', fmtValor: (v) => pct(v) });
}

/** Linhas da tabela, do mapa e do cruzamento: estados, municípios ou seções, já com brancos e nulos. */
function montarLinhas() {
  const d = estado.logs;
  const chave = metricaBn();
  const ind = el.indicador.value;
  if (d.nivel === 'municipio') {
    estado.linhas = d.secoes.map((s) => ({
      id: `${s.zona}-${s.secao}`, nome: `Zona ${Number(s.zona)} · Seção ${Number(s.secao)}`, zona: s.zona, secao: s.secao,
      votos: s.votos, cabine: s.cabine.media, mediana: s.cabine.mediana, p90: s.cabine.p90, atendimento: s.atendimento.media,
      bio: s.votos ? (s.tipos.biometrica / s.votos) * 100 : null, primeiro: s.primeiroVoto, ultimo: s.ultimoVoto,
      modelo: s.modelo, bateria: s.bateria, bn: null,
    }));
    return;
  }
  const bnPor = new Map();
  if (d.nivel === 'brasil') for (const e of estado.bn?.estados ?? []) bnPor.set(e.uf, e);
  else for (const m of estado.bn?.municipios ?? []) bnPor.set(m.codigo, m);
  const fonte = d.nivel === 'brasil'
    ? d.estados.map((e) => ({ id: e.uf, nome: nomeUf(e.uf), resumo: e.resumo, lidas: e.resumo.secoes, cod: CODIGO_IBGE_UF[e.uf] ?? null }))
    : d.municipios.filter((m) => m.lidas && m.resumo).map((m) => ({ id: m.codigo, nome: m.nome, resumo: m.resumo, lidas: m.lidas, total: m.totalSecoes, cod: m.ibge ?? null }));
  estado.linhas = fonte.map((f) => {
    const b = bnPor.get(f.id);
    const bnValor = b && METRICAS[chave].denominador(b) > 0 ? valorMetrica(b, chave) : null;
    return {
      id: f.id, nome: f.nome, cod: f.cod, lidas: f.lidas, total: f.total, votos: f.resumo.votos,
      cabine: f.resumo.cabine.media, mediana: f.resumo.cabine.mediana, atendimento: f.resumo.atendimento.media,
      bio: f.resumo.pctBiometrica, teclas: f.resumo.teclasPorEleitor, bn: bnValor, votosTse: b?.total ?? null,
      ind: ind === 'bn' ? bnValor : (INDICADORES[ind].valor(f.resumo) ?? null),
    };
  });
}

// ---------- mapa ----------

const mapa = criarMapa(el.mapa, {
  dica,
  aoClicar: (cod) => {
    const d = estado.logs;
    if (d.nivel === 'brasil') {
      const uf = UF_DO_CODIGO[cod];
      if (!uf) return;
      el.uf.value = uf;
      el.mun.innerHTML = '<option value="">Todos</option>';
    } else if (d.nivel === 'estado') {
      const l = estado.linhas.find((x) => x.cod === cod);
      if (!l) return;
      el.mun.value = l.id;
    } else return;
    estado.ordem = null;
    estado.limite = PAGINA;
    carregar();
  },
});
let pedidoMapa = 0;

async function renderizarMapa() {
  const d = estado.logs;
  const uf = el.uf.value;
  // O mapa mostra o Brasil (estados) ou os municípios da UF; num município, o da UF com ele em destaque.
  el.mapaCartao.hidden = uf === 'zz';
  if (uf === 'zz') return;
  const pedido = ++pedidoMapa;
  el.tituloMapa.textContent = `${nomeIndicador()} · ${d.nivel === 'brasil' ? 'por estado' : `municípios de ${nomeUf(uf)}`}`;
  el.subMapa.textContent = d.nivel === 'municipio' ? 'clique em outro município para trocar' : 'clique num local para detalhar';
  let geo;
  try {
    geo = await carregarMalha(d.nivel === 'brasil' ? undefined : uf);
  } catch (erro) {
    if (pedido === pedidoMapa) el.mapa.querySelector('.mapa-area').innerHTML = `<p class="mudo">Mapa indisponível: ${esc(erro.message)}</p>`;
    return;
  }
  if (pedido !== pedidoMapa) return;
  let linhas = estado.linhas;
  if (d.nivel === 'municipio') {
    // Reaproveita os municípios da UF (já carregados junto) para pintar o mapa ao redor.
    const salvo = estado.logs;
    estado.logs = { ...d.estadoUf, nivel: 'estado' };
    montarLinhas();
    linhas = estado.linhas;
    estado.logs = salvo;
    montarLinhas();
  }
  const valores = new Map();
  const rotulos = new Map();
  const porCod = new Map();
  for (const l of linhas) {
    if (!l.cod) continue;
    rotulos.set(l.cod, l.nome);
    porCod.set(l.cod, l);
    if (l.ind !== null && Number.isFinite(l.ind)) valores.set(l.cod, l.ind);
  }
  for (const f of geo.features) if (!rotulos.has(f.properties.codarea) && f.properties.uf && d.nivel === 'brasil') rotulos.set(f.properties.codarea, nomeUf(f.properties.uf));
  const destaques = new Set();
  if (d.nivel === 'municipio') {
    const m = d.estadoUf?.municipios?.find((x) => x.codigo === el.mun.value);
    if (m?.ibge) destaques.add(m.ibge);
  }
  const ind = el.indicador.value === 'bn' ? INDICADORES.bn : indicador();
  mapa.desenhar({
    geo, valores, rotulos, titulo: nomeIndicador(), formato: ind.fmt, destaques,
    extra: (cod) => {
      const l = porCod.get(cod);
      if (!l) return '<span class="mudo">nenhuma seção compilada ainda</span>';
      return `<span>${fmtInt.format(l.lidas)}${l.total ? ` de ${fmtInt.format(l.total)}` : ''} seções · ${fmtInt.format(l.votos)} eleitores</span>`;
    },
  });
}

// ---------- cruzamento ----------

function renderizarCruzamento() {
  const d = estado.logs;
  const nomeMetrica = METRICAS[metricaBn()].nome.toLowerCase();
  el.cruzamentoCartao.hidden = d.nivel === 'municipio';
  if (d.nivel === 'municipio') return;
  el.tituloCruzamento.textContent = `Tempo médio na cabine × % ${nomeMetrica}`;
  const pts = estado.linhas.filter((l) => l.cabine !== null && l.bn !== null);
  estado.pontos = pts;
  if (pts.length < 2) {
    el.cruzamento.innerHTML = `<p class="mudo">São precisos ao menos 2 ${d.nivel === 'brasil' ? 'estados' : 'municípios'} com logs compilados e resultado publicado.</p>`;
    el.correlacao.textContent = '';
    el.notaCruzamento.textContent = '';
    return;
  }
  const maxV = Math.max(...pts.map((p) => p.votos));
  const xs = pts.map((p) => p.cabine);
  const ys = pts.map((p) => p.bn);
  const reg = regressaoLinear(xs, ys);
  const t = reg ? testeCorrelacao(reg.r, reg.n) : null;
  el.cruzamento.innerHTML = svgDispersao({
    pontos: pts.map((p) => ({ x: p.cabine, y: p.bn, r: 3 + Math.sqrt(p.votos / maxV) * 12, cor: 'var(--cat-1)' })),
    rotuloX: 'tempo médio na cabine (segundos)', rotuloY: `% ${nomeMetrica}`, regressao: reg,
  });
  el.correlacao.textContent = reg ? `r = ${fmtNum.format(reg.r)} · p ${t.p < 0.001 ? '< 0,001' : `= ${fmtNum.format(t.p)}`} · n = ${reg.n}` : '';
  el.notaCruzamento.textContent = reg
    ? `Cada +10 s na cabine corresponde, em média, a ${reg.b >= 0 ? '+' : '−'}${fmtNum.format(Math.abs(reg.b * 10))} p.p. de ${nomeMetrica}. Associação entre locais, não entre eleitores; locais com poucas seções lidas variam muito.`
    : '';
}

// ---------- tabela ----------

function colunas() {
  const d = estado.logs;
  if (d.nivel === 'municipio') {
    return [
      ['Seção', (l) => esc(l.nome)], ['Eleitores', (l) => fmtInt.format(l.votos), 'votos'],
      ['Cabine (média)', (l) => mmss(l.cabine), 'cabine'], ['Mediana', (l) => mmss(l.mediana), 'mediana'], ['90%', (l) => mmss(l.p90), 'p90'],
      ['Atendimento', (l) => mmss(l.atendimento), 'atendimento'], ['Biometria', (l) => (l.bio === null ? '—' : pct(l.bio)), 'bio'],
      ['1º voto', (l) => hhmm(l.primeiro), 'primeiro'], ['Último', (l) => hhmm(l.ultimo), 'ultimo'],
      ['Urna', (l) => esc(l.modelo ?? '—')], ['Bateria', (l) => (l.bateria ? `⚡ ${l.bateria}` : '—'), 'bateria'],
    ];
  }
  const ind = el.indicador.value;
  const extra = ['cabine', 'bio', 'bn', 'atendimento', 'teclas'].includes(ind)
    ? [] : [[nomeIndicador(), (l) => (l.ind === null ? '—' : esc(indicador().fmt(l.ind))), 'ind']];
  return [
    [d.nivel === 'brasil' ? 'Estado' : 'Município', (l) => esc(l.nome)],
    ['Seções lidas', (l) => (l.total ? `${fmtInt.format(l.lidas)}/${fmtInt.format(l.total)}` : fmtInt.format(l.lidas)), 'lidas'],
    ['Eleitores', (l) => fmtInt.format(l.votos), 'votos'],
    ['Cabine (média)', (l) => mmss(l.cabine), 'cabine'], ['Mediana', (l) => mmss(l.mediana), 'mediana'],
    ['Atendimento', (l) => mmss(l.atendimento), 'atendimento'], ['Biometria', (l) => (l.bio === null ? '—' : pct(l.bio)), 'bio'],
    ['Teclas/eleitor', (l) => (l.teclas === null ? '—' : fmtNum.format(l.teclas)), 'teclas'],
    ...extra,
    [`% ${METRICAS[metricaBn()].curto}`, (l) => (l.bn === null ? '—' : pct(l.bn)), 'bn'],
  ];
}

function renderizarTabela() {
  const d = estado.logs;
  el.tituloTabela.textContent = d.nivel === 'brasil' ? 'Estados' : d.nivel === 'estado' ? 'Municípios com logs compilados' : 'Seções lidas';
  const termo = semAcento(el.busca.value.trim());
  const padrao = d.nivel === 'municipio' ? null : el.indicador.value === 'bn' ? 'bn' : ['abertura', 'encerramento', 'habilitacao', 'manual'].includes(el.indicador.value) ? 'ind' : el.indicador.value;
  const ordem = estado.ordem ?? padrao;
  let linhas = estado.linhas.filter((l) => !termo || semAcento(l.nome).includes(termo));
  if (ordem) linhas = [...linhas].sort((a, b) => (b[ordem] ?? -Infinity) - (a[ordem] ?? -Infinity));
  const cols = colunas();
  const visiveis = linhas.slice(0, estado.limite);
  el.tabela.innerHTML = `<thead><tr>${cols.map(([t, , k], i) => `<th${i ? ' class="num"' : ''}${k ? ` data-ordem="${k}"` : ''}>${esc(t)}${k && k === ordem ? ' ▼' : ''}</th>`).join('')}</tr></thead>
    <tbody>${visiveis.map((l) => `<tr data-id="${esc(l.id)}" class="${d.nivel !== 'municipio' ? 'clicavel' : ''}">${cols.map(([, f], i) => `<td${i ? ' class="num"' : ' class="local"'}>${f(l)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${cols.length}" class="mudo">Nada compilado ainda.</td></tr>`}</tbody>`;
  el.mais.hidden = visiveis.length >= linhas.length;
  el.mais.textContent = `Mostrar mais (${fmtInt.format(linhas.length - visiveis.length)} restantes)`;
}

// ---------- dicas ----------

dica.ligar(el.cruzamento, '[data-dica]', (alvo) => {
  const l = estado.pontos[Number(alvo.dataset.dica)];
  return l ? `<strong>${esc(l.nome)}</strong><span>Cabine: ${mmss(l.cabine)} (mediana ${mmss(l.mediana)})</span>
    <span>% ${esc(METRICAS[metricaBn()].nome.toLowerCase())}: ${pct(l.bn)}</span><span class="mudo">${fmtInt.format(l.votos)} eleitores nos logs · ${fmtInt.format(l.lidas)} seções</span>` : null;
});
dica.ligar(el.hist, '[data-dica]', (alvo) => {
  const f = estado.faixasHist?.[Number(alvo.dataset.dica)];
  return f ? `<strong>${mmss(f.inicio * 60)} a ${f.inicio >= 10 ? 'mais' : mmss(f.fim * 60)}</strong><span>${fmtInt.format(f.contagem)} eleitores</span>` : null;
});
dica.ligar(el.hora, '[data-dica]', (alvo) => {
  const i = estado.itensHora?.[Number(alvo.dataset.dica)];
  return i ? `<strong>${esc(i.nome)}</strong><span>${fmtInt.format(i.valor)} votos computados</span>` : null;
});

// ---------- eventos ----------

el.uf.addEventListener('change', () => { el.mun.innerHTML = '<option value="">Todos</option>'; estado.ordem = null; estado.limite = PAGINA; carregar(); });
el.mun.addEventListener('change', () => { estado.ordem = null; estado.limite = PAGINA; carregar(); });
el.cargo.addEventListener('change', () => carregar());
el.metricaBn.addEventListener('change', () => { gravarHash(); montarLinhas(); renderizarMapa(); renderizarCruzamento(); renderizarTabela(); });
el.indicador.addEventListener('change', () => { gravarHash(); estado.ordem = null; montarLinhas(); renderizarMapa(); renderizarTabela(); });
el.atualizar.addEventListener('click', () => carregar());
el.lerMunicipio.addEventListener('click', () => carregar({ coletar: true }));
el.busca.addEventListener('input', () => { estado.limite = PAGINA; renderizarTabela(); });
el.mais.addEventListener('click', () => { estado.limite += PAGINA * 2; renderizarTabela(); });
el.tabela.addEventListener('click', (ev) => {
  const th = ev.target.closest('th[data-ordem]');
  if (th) { estado.ordem = th.dataset.ordem; renderizarTabela(); return; }
  const tr = ev.target.closest('tr.clicavel');
  if (!tr) return;
  if (estado.logs.nivel === 'brasil') { el.uf.value = tr.dataset.id; el.mun.innerHTML = '<option value="">Todos</option>'; carregar(); }
  else if (estado.logs.nivel === 'estado') { el.mun.value = tr.dataset.id; carregar(); }
  scrollTo({ top: 0, behavior: 'smooth' });
});
el.cruzamento.addEventListener('click', (ev) => {
  const p = ev.target.closest('[data-dica]');
  const l = p && estado.pontos[Number(p.dataset.dica)];
  if (!l) return;
  if (estado.logs.nivel === 'brasil') { el.uf.value = l.id; el.mun.innerHTML = '<option value="">Todos</option>'; } else el.mun.value = l.id;
  carregar();
});
el.exportar.addEventListener('click', () => {
  const cols = colunas();
  const txt = (h) => h.replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
  baixarCsv(`logs-urnas-${el.uf.value || 'brasil'}${el.mun.value ? `-${el.mun.value}` : ''}.csv`,
    cols.map(([nome, f]) => ({ nome, valor: (l) => txt(String(f(l))) })), estado.linhas);
});

preencher();
const munInicial = lerHash();
carregar({ munInicial });
