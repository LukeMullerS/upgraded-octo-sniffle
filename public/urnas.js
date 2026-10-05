// Logs das urnas: tempo na cabine e de atendimento, biometria e horários, por seção,
// município ou estado, cruzados com brancos e nulos do resultado oficial.

import {
  CARGOS, baixarCsv, cargoPorValor, carregarEstados, carregarMunicipios, criarDica, esc, fmtInt, fmtNum,
  nomeUf, pct, semAcento,
} from './comum.js';
import { UFS } from './tse.js';
import { METRICAS, regressaoLinear, testeCorrelacao, valorMetrica } from './calculos.js';
import { svgBarras, svgDispersao, svgHistograma } from './graficos.js';

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'uf', 'mun', 'metrica-bn', 'cargo', 'status', 'exportar', 'atualizar', 'erro', 'titulo', 'sub-titulo',
  'ler-municipio', 'por', 'ler-amostra', 'barra', 'pct-lidas', 'lidas', 'kpis', 'sub-hist', 'hist', 'hora',
  'cruzamento-cartao', 'titulo-cruzamento', 'correlacao', 'cruzamento', 'nota-cruzamento', 'tipos',
  'titulo-tabela', 'busca', 'tabela', 'mais', 'dica',
].map((id) => [id.replace(/-(\w)/g, (_, l) => l.toUpperCase()), $(id)]));

const PAGINA = 60;
const dica = criarDica(el.dica);
const estado = { logs: null, bn: null, linhas: [], limite: PAGINA, pedido: 0, timer: null, pontos: [] };

/** 64 → "1:04" (minutos:segundos). */
const mmss = (s) => (s === null || s === undefined || !Number.isFinite(s) ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
/** 28801 → "08:00" (hora do dia). */
const hhmm = (s) => (s === null || s === undefined || !Number.isFinite(s) ? '—' : `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`);

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const d = await res.json();
  if (!res.ok) throw new Error(d.erro || `HTTP ${res.status}`);
  return d;
}

const cargoAtual = () => cargoPorValor(el.cargo.value) ?? CARGOS[0];
const metricaBn = () => el.metricaBn.value;

// ---------- filtros e link ----------

function preencher() {
  const ufs = [...Object.keys(UFS), 'zz'].sort((a, b) => nomeUf(a).localeCompare(nomeUf(b), 'pt-BR'));
  el.uf.innerHTML = `<option value="">Brasil (estados já lidos)</option>${ufs.map((u) => `<option value="${u}">${esc(nomeUf(u))}</option>`).join('')}`;
  el.cargo.innerHTML = CARGOS.filter((c) => c.abrangencias.length > 1).map((c) => `<option value="${c.valor}">${esc(c.nome)}</option>`).join('');
}

function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('uf') && [...el.uf.options].some((o) => o.value === p.get('uf'))) el.uf.value = p.get('uf');
  if (p.get('cargo') && [...el.cargo.options].some((o) => o.value === p.get('cargo'))) el.cargo.value = p.get('cargo');
  if (p.get('metrica') && METRICAS[p.get('metrica')]) el.metricaBn.value = p.get('metrica');
  return p.get('mun') ?? '';
}

function gravarHash() {
  const p = new URLSearchParams();
  if (el.uf.value) p.set('uf', el.uf.value);
  if (el.mun.value) p.set('mun', el.mun.value);
  if (el.cargo.value !== CARGOS[0].valor) p.set('cargo', el.cargo.value);
  if (metricaBn() !== 'pctBrancosNulos') p.set('metrica', metricaBn());
  history.replaceState(null, '', `#${p}`);
}

// ---------- carga ----------

async function carregar({ coletar = false, por = 0, munInicial = null } = {}) {
  const pedido = ++estado.pedido;
  const uf = el.uf.value;
  el.status.textContent = 'consultando…';
  el.status.className = 'status';
  try {
    let logs;
    let bn = null;
    if (!uf) {
      [logs, bn] = await Promise.all([getJson('api/urnas/brasil'), carregarEstados(cargoAtual()).catch(() => null)]);
      logs.nivel = 'brasil';
    } else {
      const est = await getJson(`api/urnas/estado?uf=${uf}${por ? `&por=${por}` : ''}`);
      if (pedido !== estado.pedido) return;
      preencherMunicipios(est, munInicial ?? el.mun.value);
      const mun = el.mun.value;
      if (mun) {
        logs = await getJson(`api/urnas/municipio?uf=${uf}&mun=${mun}${coletar ? '&coletar=1' : ''}`);
        logs.nivel = 'municipio';
      } else {
        logs = est;
        logs.nivel = 'estado';
        bn = await carregarMunicipios(cargoAtual(), uf).catch(() => null);
      }
    }
    if (pedido !== estado.pedido) return;
    estado.logs = logs;
    estado.bn = bn;
    if (bn?.pendentes || bn?.lendo) setTimeout(() => pedido === estado.pedido && carregar(), 4_000);
    el.erro.hidden = !logs.progresso?.erro;
    el.erro.textContent = logs.progresso?.erro ? `Aviso: ${logs.progresso.erro}` : '';
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
  const lendo = estado.logs?.progresso?.lendo;
  estado.timer = setTimeout(() => { if (!document.hidden) carregar(); else agendar(); }, lendo ? 10_000 : 60_000);
}

function preencherMunicipios(est, valor) {
  const lista = est.municipios ?? [];
  const opcoes = lista.map((m) => `<option value="${m.codigo}">${esc(m.nome)} (${fmtInt.format(m.lidas)}/${fmtInt.format(m.totalSecoes)})</option>`).join('');
  el.mun.innerHTML = `<option value="">Todos (municípios já lidos)</option>${opcoes}`;
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
  el.lerMunicipio.hidden = d.nivel !== 'municipio';
  el.lerAmostra.hidden = d.nivel !== 'estado';
  el.por.parentElement.hidden = d.nivel !== 'estado';

  // Progresso: seções lidas do total (município ou amostra) e próxima leitura.
  const p = d.progresso;
  let lidas = 0;
  let total = 0;
  if (d.nivel === 'municipio') { lidas = d.secoes.length; total = d.totalSecoes ?? 0; }
  else if (d.nivel === 'estado') { lidas = d.municipios.reduce((t, m) => t + m.lidas, 0); total = d.municipios.reduce((t, m) => t + m.totalSecoes, 0); }
  else { lidas = d.estados.reduce((t, e) => t + e.resumo.secoes, 0); }
  const pctLidas = total ? (lidas / total) * 100 : 0;
  el.barra.style.width = `${Math.min(100, pctLidas)}%`;
  el.pctLidas.textContent = total ? `${fmtNum.format(pctLidas)}%` : fmtInt.format(lidas);
  el.lidas.textContent = total
    ? `das seções lidas (${fmtInt.format(lidas)} de ${fmtInt.format(total)})${p ? ` · ${p.lendo ? 'lendo agora…' : `próxima leitura em ${Math.max(1, Math.ceil((p.proximaEmSegundos ?? 120) / 60))} min`}${p.tipo === 'amostra' ? ` · amostra: ${fmtInt.format(p.lidas)} de ${fmtInt.format(p.total ?? 0)}` : ''}` : ''}`
    : 'seções lidas até agora (escolha um estado para ler mais)';
  el.subTitulo.textContent = d.nivel === 'municipio' && !p ? 'clique em "Ler todas as seções" para começar' : '';

  el.kpis.innerHTML = r && r.votos
    ? [
      kpi('Eleitores nos logs', fmtInt.format(r.votos), `${fmtInt.format(r.secoes)} seções`),
      kpi('Tempo médio na cabine', mmss(r.cabine.media), `mediana ${mmss(r.cabine.mediana)} · 90% até ${mmss(r.cabine.p90)}`),
      kpi('Atendimento médio', mmss(r.atendimento.media), `biometria/habilitação ${mmss(r.habilitacao.media)}`),
      kpi('Habilitação biométrica', pct(r.pctBiometrica ?? 0), `manual ${pct(r.pctManual ?? 0)} · sem biometria ${pct(r.pctSemBiometria ?? 0)}`),
      kpi('Horário médio', `${hhmm(r.aberturaMedia)}–${hhmm(r.encerramentoMedio)}`, `teclas indevidas: ${fmtNum.format(r.teclasPorEleitor ?? 0)} por eleitor`),
    ].join('')
    : '<p class="mudo">Nenhum log lido ainda neste local. Use os botões acima para ler (o TSE publica os arquivos das urnas ao longo da apuração).</p>';

  renderizarHistograma(r);
  renderizarHoras(r);
  renderizarTipos(r);
  montarLinhas();
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
  estado.itensTipos = itens;
  el.tipos.innerHTML = svgBarras({ itens, rotuloX: '% dos eleitores', cor: 'var(--cat-7)', fmtValor: (v) => pct(v) });
}

/** Linhas da tabela e do cruzamento: estados, municípios ou seções, já com brancos e nulos. */
function montarLinhas() {
  const d = estado.logs;
  const chave = metricaBn();
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
    ? d.estados.map((e) => ({ id: e.uf, nome: nomeUf(e.uf), resumo: e.resumo, lidas: e.resumo.secoes }))
    : d.municipios.filter((m) => m.lidas).map((m) => ({ id: m.codigo, nome: m.nome, resumo: m.resumo, lidas: m.lidas, total: m.totalSecoes }));
  estado.linhas = fonte.map((f) => {
    const b = bnPor.get(f.id);
    return {
      id: f.id, nome: f.nome, lidas: f.lidas, total: f.total, votos: f.resumo.votos,
      cabine: f.resumo.cabine.media, mediana: f.resumo.cabine.mediana, atendimento: f.resumo.atendimento.media,
      bio: f.resumo.pctBiometrica, teclas: f.resumo.teclasPorEleitor,
      bn: b && METRICAS[chave].denominador(b) > 0 ? valorMetrica(b, chave) : null, votosTse: b?.total ?? null,
    };
  });
}

function renderizarCruzamento() {
  const d = estado.logs;
  const nomeMetrica = METRICAS[metricaBn()].nome.toLowerCase();
  el.cruzamentoCartao.hidden = d.nivel === 'municipio';
  if (d.nivel === 'municipio') return;
  el.tituloCruzamento.textContent = `Tempo médio na cabine × % ${nomeMetrica}`;
  const pts = estado.linhas.filter((l) => l.cabine !== null && l.bn !== null);
  estado.pontos = pts;
  if (pts.length < 2) {
    el.cruzamento.innerHTML = `<p class="mudo">São precisos ao menos 2 ${d.nivel === 'brasil' ? 'estados' : 'municípios'} com logs lidos e resultado publicado.</p>`;
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
    ? `Cada +10 s na cabine corresponde, em média, a ${reg.b >= 0 ? '+' : '−'}${fmtNum.format(Math.abs(reg.b * 10))} p.p. de ${nomeMetrica}. Associação entre locais, não entre eleitores; amostras pequenas variam muito.`
    : '';
}

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
  return [
    [d.nivel === 'brasil' ? 'Estado' : 'Município', (l) => esc(l.nome)],
    ['Seções lidas', (l) => (l.total ? `${fmtInt.format(l.lidas)}/${fmtInt.format(l.total)}` : fmtInt.format(l.lidas)), 'lidas'],
    ['Eleitores', (l) => fmtInt.format(l.votos), 'votos'],
    ['Cabine (média)', (l) => mmss(l.cabine), 'cabine'], ['Mediana', (l) => mmss(l.mediana), 'mediana'],
    ['Atendimento', (l) => mmss(l.atendimento), 'atendimento'], ['Biometria', (l) => (l.bio === null ? '—' : pct(l.bio)), 'bio'],
    ['Teclas/eleitor', (l) => (l.teclas === null ? '—' : fmtNum.format(l.teclas)), 'teclas'],
    [`% ${METRICAS[metricaBn()].curto}`, (l) => (l.bn === null ? '—' : pct(l.bn)), 'bn'],
  ];
}

function renderizarTabela() {
  const d = estado.logs;
  el.tituloTabela.textContent = d.nivel === 'brasil' ? 'Estados com logs lidos' : d.nivel === 'estado' ? 'Municípios com logs lidos' : 'Seções lidas';
  const termo = semAcento(el.busca.value.trim());
  const ordem = estado.ordem ?? (d.nivel === 'municipio' ? null : 'cabine');
  let linhas = estado.linhas.filter((l) => !termo || semAcento(l.nome).includes(termo));
  if (ordem) linhas = [...linhas].sort((a, b) => (b[ordem] ?? -Infinity) - (a[ordem] ?? -Infinity));
  const cols = colunas();
  const visiveis = linhas.slice(0, estado.limite);
  el.tabela.innerHTML = `<thead><tr>${cols.map(([t, , k], i) => `<th${i ? ' class="num"' : ''}${k ? ` data-ordem="${k}"` : ''}>${esc(t)}${k && k === ordem ? ' ▼' : ''}</th>`).join('')}</tr></thead>
    <tbody>${visiveis.map((l) => `<tr data-id="${esc(l.id)}" class="${d.nivel !== 'municipio' ? 'clicavel' : ''}">${cols.map(([, f], i) => `<td${i ? ' class="num"' : ' class="local"'}>${f(l)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${cols.length}" class="mudo">Nada lido ainda.</td></tr>`}</tbody>`;
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

el.uf.addEventListener('change', () => { el.mun.innerHTML = '<option value="">Todos (municípios já lidos)</option>'; estado.ordem = null; estado.limite = PAGINA; carregar(); });
el.mun.addEventListener('change', () => { estado.ordem = null; estado.limite = PAGINA; carregar(); });
el.cargo.addEventListener('change', () => carregar());
el.metricaBn.addEventListener('change', () => { gravarHash(); montarLinhas(); renderizarCruzamento(); renderizarTabela(); });
el.atualizar.addEventListener('click', () => carregar());
el.lerMunicipio.addEventListener('click', () => carregar({ coletar: true }));
el.lerAmostra.addEventListener('click', () => carregar({ por: Number(el.por.value) }));
el.busca.addEventListener('input', () => { estado.limite = PAGINA; renderizarTabela(); });
el.mais.addEventListener('click', () => { estado.limite += PAGINA * 2; renderizarTabela(); });
el.tabela.addEventListener('click', (ev) => {
  const th = ev.target.closest('th[data-ordem]');
  if (th) { estado.ordem = th.dataset.ordem; renderizarTabela(); return; }
  const tr = ev.target.closest('tr.clicavel');
  if (!tr) return;
  if (estado.logs.nivel === 'brasil') { el.uf.value = tr.dataset.id; carregar(); }
  else if (estado.logs.nivel === 'estado') { el.mun.value = tr.dataset.id; carregar(); }
  scrollTo({ top: 0, behavior: 'smooth' });
});
el.cruzamento.addEventListener('click', (ev) => {
  const p = ev.target.closest('[data-dica]');
  const l = p && estado.pontos[Number(p.dataset.dica)];
  if (!l) return;
  if (estado.logs.nivel === 'brasil') el.uf.value = l.id; else el.mun.value = l.id;
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
