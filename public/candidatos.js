// Mapa da votação: candidatos, partidos, comparecimento e fragmentação por estado e por
// cidade, com mapa interativo (vencedor de cada local ou votação de um candidato),
// ranking, locais vencidos, onde cada um é mais forte e mais fraco e comparação entre dois.

import {
  CARGOS, CODIGO_IBGE_UF, UF_DO_CODIGO, baixarCsv, cargoPorValor, carregarEstados, carregarMunicipios, criarDica, esc,
  fmtInt, fmtNum, nomeUf, pct, pctSecoes, semAcento,
} from './comum.js';
import { regressaoLinear, testeCorrelacao } from './calculos.js';
import { svgBarras, svgDispersao } from './graficos.js';
import { CATEGORICA, carregarMalha, criarMapa } from './mapa.js';

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'cargo', 'nivel', 'ver', 'comparar', 'status', 'exportar', 'atualizar', 'erro', 'titulo', 'sub-titulo', 'resumo-texto', 'kpis',
  'titulo-mapa', 'sub-mapa', 'mapa', 'titulo-ranking', 'ranking', 'titulo-vitorias', 'sub-vitorias', 'vitorias',
  'titulo-forte', 'forte', 'titulo-fraco', 'fraco', 'comparacao-cartao', 'titulo-comparacao', 'correlacao', 'comparacao',
  'nota-comparacao', 'partidos-cartao', 'partidos', 'titulo-tabela', 'busca', 'tabela', 'mais', 'dica',
].map((id) => [id.replace(/-(\w)/g, (_, l) => l.toUpperCase()), $(id)]));

const PAGINA = 60;
const dica = criarDica(el.dica);
const estado = { dados: null, locais: [], consolidado: null, nomes: {}, cores: new Map(), coresPar: new Map(), pedido: 0, timer: null, limite: PAGINA, ordem: null, pontos: [] };
const pctDe = (parte, total) => (total > 0 ? (parte / total) * 100 : null);

const cargoAtual = () => cargoPorValor(el.cargo.value) ?? CARGOS[0];
const nivel = () => el.nivel.value; // 'estados' | 'todas' | uf
// Deputados: centenas de candidatos por UF; cada local guarda só os mais votados.
const proporcional = () => [6, 7, 8].includes(Number(cargoAtual().codigo)) || (estado.consolidado?.candidatos ?? 0) > 30;

async function getJsonComErro(p) {
  const d = await p;
  if (d?.erro && !d.estados?.length && !d.municipios?.length) throw new Error(d.erro);
  return d;
}

// ---------- filtros ----------

function preencherCargos() {
  el.cargo.innerHTML = CARGOS.map((c) => `<option value="${c.valor}">${esc(c.nome)}</option>`).join('');
}

function preencherNiveis(valor) {
  const c = cargoAtual();
  const ufs = c.abrangencias.filter((a) => a !== 'br' && a !== 'zz').sort((a, b) => nomeUf(a).localeCompare(nomeUf(b), 'pt-BR'));
  const lista = [
    ...(ufs.length > 1 ? [['estados', 'Brasil — por estado'], ['todas', 'Brasil — todas as cidades']] : []),
    ...ufs.map((u) => [u, `Cidades — ${nomeUf(u)}`]),
  ];
  el.nivel.innerHTML = lista.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  el.nivel.value = lista.some(([v]) => v === valor) ? valor : lista[0][0];
}

const nomeCand = (n) => {
  const x = estado.nomes[n];
  return x ? `${x[0]} (${x[1]})` : `nº ${n}`;
};
const rotuloVer = (v) => {
  if (v.startsWith('c:')) return nomeCand(v.slice(2));
  if (v.startsWith('p:')) return v.slice(2);
  return { vencedor: 'Candidato mais votado', partido: 'Partido mais votado', margem: 'Margem do 1º sobre o 2º', comparecimento: 'Comparecimento', efetivo: 'Fragmentação (nº efetivo)', validos: '% votos válidos' }[v] ?? v;
};

/** Opções de "Mostrar no mapa" e "Comparar com": candidatos e partidos na ordem de votos. */
function preencherVer() {
  const atual = el.ver.value || inicial.ver || '';
  const comp = el.comparar.value || inicial.comparar || '';
  const cands = Object.entries(estado.consolidado?.cand ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 40);
  const pars = Object.entries(estado.consolidado?.par ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const geral = proporcional()
    ? [['partido', 'Partido mais votado'], ['vencedor', 'Candidato mais votado'], ['efetivo', 'Fragmentação (nº efetivo de partidos)']]
    : [['vencedor', 'Candidato mais votado'], ['margem', 'Margem do 1º sobre o 2º'], ['partido', 'Partido mais votado'], ['efetivo', 'Fragmentação (nº efetivo de candidatos)']];
  geral.push(['comparecimento', 'Comparecimento (%)'], ['validos', '% votos válidos']);
  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  const grupoCands = cands.length ? `<optgroup label="Votação do candidato (% válidos)">${cands.map(([n]) => opt(`c:${n}`, nomeCand(n))).join('')}</optgroup>` : '';
  const grupoPars = pars.length ? `<optgroup label="Votação do partido (% válidos)">${pars.map(([sg]) => opt(`p:${sg}`, sg)).join('')}</optgroup>` : '';
  el.ver.innerHTML = `<optgroup label="Geral">${geral.map(([v, t]) => opt(v, t)).join('')}</optgroup>${grupoCands}${grupoPars}`;
  el.comparar.innerHTML = `<option value="">—</option>${grupoCands}${grupoPars}<optgroup label="Outros">${opt('comparecimento', 'Comparecimento (%)')}${opt('efetivo', 'Fragmentação')}</optgroup>`;
  el.ver.value = [...el.ver.options].some((o) => o.value === atual) ? atual : geral[0][0];
  el.comparar.value = [...el.comparar.options].some((o) => o.value === comp) ? comp : '';
  // Cores fixas por candidato e partido (as mesmas no mapa e nas barras).
  estado.cores = new Map(cands.map(([n], i) => [n, CATEGORICA[i % CATEGORICA.length]]));
  estado.coresPar = new Map(pars.map(([sg], i) => [sg, CATEGORICA[i % CATEGORICA.length]]));
}

const inicial = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));

function gravarHash() {
  const p = new URLSearchParams({ cargo: el.cargo.value, nivel: nivel(), ver: el.ver.value });
  if (el.comparar.value) p.set('comparar', el.comparar.value);
  history.replaceState(null, '', `#${p}`);
}

// ---------- carga ----------

async function carregar() {
  const pedido = ++estado.pedido;
  el.status.textContent = 'consultando…';
  el.status.className = 'status';
  try {
    const c = cargoAtual();
    const n = nivel();
    const d = n === 'estados' ? await getJsonComErro(carregarEstados(c)) : await getJsonComErro(carregarMunicipios(c, n));
    if (pedido !== estado.pedido) return;
    estado.dados = d;
    estado.nomes = d.nomes ?? {};
    estado.consolidado = n === 'estados' ? d.brasil : d.consolidado;
    estado.locais = (n === 'estados' ? d.estados : d.municipios).map((r) => ({
      ...r,
      id: n === 'estados' ? r.uf : r.codigo,
      nome: n === 'estados' ? nomeUf(r.uf) : r.nome,
      cod: n === 'estados' ? CODIGO_IBGE_UF[r.uf] ?? null : r.ibge ?? null,
    }));
    preencherVer();
    el.erro.hidden = true;
    gravarHash();
    renderizar();
    const faltam = d.pendentes || d.lendo || (d.total && d.lidos < d.total);
    el.status.textContent = `${faltam ? `lendo (${fmtInt.format(d.lidos ?? 0)} de ${fmtInt.format(d.total ?? 0)})` : 'consultado'} às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
    agendar(d.pendentes || d.lendo ? 5_000 : 60_000);
  } catch (erro) {
    if (pedido !== estado.pedido) return;
    el.erro.hidden = false;
    el.erro.textContent = `Não foi possível carregar: ${erro.message}`;
    el.status.textContent = 'falha na consulta';
    el.status.className = 'status falha';
    agendar(30_000);
  }
}

function agendar(ms) {
  clearTimeout(estado.timer);
  estado.timer = setTimeout(() => { if (!document.hidden) carregar(); else agendar(ms); }, ms);
}

// ---------- contas por local ----------

/** 1º e 2º colocados (candidatos) de um local (guardado: a tabela e o mapa pedem várias vezes). */
const memoColocados = new WeakMap();
function colocados(r) {
  if (memoColocados.has(r)) return memoColocados.get(r);
  const v = calcularColocados(r);
  if (r && typeof r === 'object') memoColocados.set(r, v);
  return v;
}
function calcularColocados(r) {
  const lista = Object.entries(r.cand ?? {}).sort((a, b) => b[1] - a[1]);
  const [p, s] = lista;
  return {
    primeiro: p ? { numero: p[0], votos: p[1], pct: pctDe(p[1], r.validos) } : null,
    segundo: s ? { numero: s[0], votos: s[1], pct: pctDe(s[1], r.validos) } : null,
  };
}

function partidoVencedor(r) {
  const [p] = Object.entries(r.par ?? {}).sort((a, b) => b[1] - a[1]);
  return p ? { sigla: p[0], pct: pctDe(p[1], r.validos) } : null;
}

/** Valor numérico de uma opção ("c:13", "p:PT", "comparecimento"…) num local. */
function valor(r, v) {
  if (!r || !r.validos) return null;
  if (v.startsWith('c:')) {
    const votos = r.cand?.[v.slice(2)];
    // Nos proporcionais, ausência = fora dos 15 mais votados do local (não é zero).
    if (votos === undefined) return proporcional() ? null : 0;
    return pctDe(votos, r.validos);
  }
  if (v.startsWith('p:')) return pctDe(r.par?.[v.slice(2)] ?? 0, r.validos);
  if (v === 'comparecimento') return r.pctComparecimento ?? pctDe(r.comparecimento, r.aptosTotalizadas);
  if (v === 'validos') return r.pctValidos ?? pctDe(r.validos, r.total);
  if (v === 'efetivo') return proporcional() ? r.efetivoPar : r.efetivoCand;
  if (v === 'margem') {
    const { primeiro, segundo } = colocados(r);
    return primeiro ? primeiro.pct - (segundo?.pct ?? 0) : null;
  }
  return null;
}

const formatoVer = (v) => (v === 'efetivo' ? (x) => fmtNum.format(x) : v === 'margem' ? (x) => `${fmtNum.format(x)} p.p.` : (x) => pct(x));
const comDados = () => estado.locais.filter((l) => l.validos > 0);

// ---------- renderização ----------

function kpi(rotulo, v, detalhe = '') {
  return `<div class="kpi"><dt>${rotulo}</dt><dd><span class="kpi-pct">${v}</span>${detalhe ? `<small>${detalhe}</small>` : ''}</dd></div>`;
}

function renderizar() {
  const c = cargoAtual();
  const r = estado.consolidado;
  const n = nivel();
  const nomeLocal = n === 'estados' ? 'Brasil (por estado)' : n === 'todas' ? 'Brasil (todas as cidades)' : nomeUf(n);
  el.titulo.textContent = `${c.nome} · ${nomeLocal}`;
  const d = estado.dados;
  el.subTitulo.textContent = d.total ? `${fmtInt.format(d.lidos ?? estado.locais.length)} de ${fmtInt.format(d.total)} ${n === 'estados' ? 'estados' : 'cidades'} lidos` : '';
  if (!r || !r.validos) {
    el.kpis.innerHTML = '<p class="mudo">Ainda não há votos apurados para este recorte.</p>';
    el.resumoTexto.textContent = '';
  } else {
    const { primeiro, segundo } = colocados(r);
    const efetivo = proporcional() ? r.efetivoPar : r.efetivoCand;
    el.kpis.innerHTML = [
      kpi('Votos válidos', fmtInt.format(r.validos), `${pct(r.pctValidos ?? pctDe(r.validos, r.total))} do total · ${pct(pctSecoes(r))} das seções`),
      kpi('Comparecimento', pct(r.pctComparecimento ?? pctDe(r.comparecimento, r.aptosTotalizadas) ?? 0), `abstenção ${pct(r.pctAbstencao ?? 0)}`),
      primeiro ? kpi('1º colocado', esc(nomeCand(primeiro.numero)), `${pct(primeiro.pct)} dos válidos`) : '',
      segundo ? kpi('Margem sobre o 2º', `${fmtNum.format(primeiro.pct - segundo.pct)} p.p.`, `2º: ${esc(nomeCand(segundo.numero))} · ${pct(segundo.pct)}`) : '',
      efetivo ? kpi(proporcional() ? 'Nº efetivo de partidos' : 'Nº efetivo de candidatos', fmtNum.format(efetivo), 'quanto maior, mais dividido o voto') : '',
    ].join('');
  }
  renderizarRanking();
  renderizarPartidos();
  renderizarVitorias();
  renderizarForteFraco();
  renderizarComparacao();
  renderizarMapa();
  renderizarTabela();
  renderizarResumo();
}

function renderizarRanking() {
  const r = estado.consolidado;
  const itens = Object.entries(r?.cand ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([n, v]) => ({ nome: nomeCand(n), valor: pctDe(v, r.validos) ?? 0, cor: estado.cores.get(n) }));
  el.tituloRanking.textContent = proporcional() ? 'Candidatos mais votados' : 'Candidatos';
  el.ranking.innerHTML = svgBarras({ itens, rotuloX: '% dos votos válidos', fmtValor: (v) => pct(v), largura: 620 });
}

function renderizarPartidos() {
  const r = estado.consolidado;
  const itens = Object.entries(r?.par ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([sg, v]) => ({ nome: sg, valor: pctDe(v, r.validos) ?? 0, cor: estado.coresPar.get(sg) }));
  el.partidos.innerHTML = svgBarras({ itens, rotuloX: '% dos votos válidos', fmtValor: (v) => pct(v), largura: 620 });
}

function renderizarVitorias() {
  const porPartido = proporcional() || el.ver.value === 'partido' || el.ver.value.startsWith('p:');
  const cont = new Map();
  for (const l of comDados()) {
    const k = porPartido ? partidoVencedor(l)?.sigla : colocados(l).primeiro?.numero;
    if (k) cont.set(k, (cont.get(k) ?? 0) + 1);
  }
  const itens = [...cont].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([k, v]) => ({ nome: porPartido ? k : nomeCand(k), valor: v, cor: porPartido ? estado.coresPar.get(k) : estado.cores.get(k) }));
  el.tituloVitorias.textContent = `${nivel() === 'estados' ? 'Estados' : 'Cidades'} vencidos por ${porPartido ? 'partido' : 'candidato'}`;
  el.subVitorias.textContent = `${fmtInt.format(comDados().length)} locais com votos`;
  el.vitorias.innerHTML = svgBarras({ itens, rotuloX: 'locais em 1º lugar', fmtValor: fmtInt.format, largura: 620 });
}

/** Opção numérica usada em "mais forte/fraco": a do mapa ou, no modo vencedor, o 1º colocado geral. */
function verNumerico() {
  const v = el.ver.value;
  if (v === 'vencedor') {
    const p = colocados(estado.consolidado ?? {}).primeiro;
    return p ? `c:${p.numero}` : null;
  }
  if (v === 'partido') {
    const p = partidoVencedor(estado.consolidado ?? {});
    return p ? `p:${p.sigla}` : null;
  }
  return v;
}

function renderizarForteFraco() {
  const v = verNumerico();
  if (!v) { el.forte.innerHTML = el.fraco.innerHTML = '<p class="mudo">Sem dados.</p>'; return; }
  const linhas = comDados().map((l) => ({ l, x: valor(l, v) })).filter((p) => p.x !== null && Number.isFinite(p.x)).sort((a, b) => b.x - a.x);
  const f = formatoVer(v);
  const rot = (l) => (nivel() === 'todas' ? `${l.nome} · ${l.uf.toUpperCase()}` : l.nome);
  const cor = v.startsWith('c:') ? estado.cores.get(v.slice(2)) : v.startsWith('p:') ? estado.coresPar.get(v.slice(2)) : undefined;
  el.tituloForte.textContent = `Onde ${rotuloVer(v)} é mais alto`;
  el.tituloFraco.textContent = `Onde ${rotuloVer(v)} é mais baixo`;
  el.forte.innerHTML = svgBarras({ itens: linhas.slice(0, 10).map((p) => ({ nome: rot(p.l), valor: p.x, cor })), rotuloX: rotuloVer(v), fmtValor: f, largura: 620 });
  el.fraco.innerHTML = svgBarras({ itens: linhas.slice(-10).reverse().map((p) => ({ nome: rot(p.l), valor: p.x, cor: 'var(--cat-5, #9b59d0)' })), rotuloX: rotuloVer(v), fmtValor: f, largura: 620 });
}

function renderizarComparacao() {
  const b = el.comparar.value;
  const a = verNumerico();
  el.comparacaoCartao.hidden = !b || !a || a === b;
  if (el.comparacaoCartao.hidden) return;
  const pts = comDados().map((l) => ({ l, x: valor(l, a), y: valor(l, b) })).filter((p) => p.x !== null && p.y !== null && Number.isFinite(p.x) && Number.isFinite(p.y));
  estado.pontos = pts;
  el.tituloComparacao.textContent = `${rotuloVer(a)} × ${rotuloVer(b)}`;
  if (pts.length < 3) {
    el.comparacao.innerHTML = '<p class="mudo">Poucos locais com os dois valores.</p>';
    el.correlacao.textContent = '';
    el.notaComparacao.textContent = '';
    return;
  }
  const maxV = Math.max(...pts.map((p) => p.l.validos));
  const reg = regressaoLinear(pts.map((p) => p.x), pts.map((p) => p.y));
  const t = reg ? testeCorrelacao(reg.r, reg.n) : null;
  el.comparacao.innerHTML = svgDispersao({
    pontos: pts.map((p) => ({ x: p.x, y: p.y, r: 2.5 + Math.sqrt(p.l.validos / maxV) * 11, cor: 'var(--cat-1)' })),
    rotuloX: rotuloVer(a), rotuloY: rotuloVer(b), regressao: reg, largura: 620,
  });
  el.correlacao.textContent = reg ? `r = ${fmtNum.format(reg.r)} · ${t.p < 0.001 ? 'p < 0,001' : `p = ${fmtNum.format(t.p)}`} · n = ${reg.n}` : '';
  el.notaComparacao.textContent = reg
    ? `${Math.abs(reg.r) < 0.3 ? 'Pouca relação' : reg.r > 0 ? 'Onde um vai bem, o outro tende a ir bem também' : 'Onde um vai bem, o outro tende a ir mal'} (cada ponto é um local; o tamanho é o nº de votos válidos).`
    : '';
}

// ---------- mapa ----------

const mapa = criarMapa(el.mapa, {
  dica,
  aoClicar: (cod) => {
    if (nivel() !== 'estados') return;
    const uf = UF_DO_CODIGO[cod];
    if (!uf || ![...el.nivel.options].some((o) => o.value === uf)) return;
    el.nivel.value = uf;
    estado.ordem = null;
    carregar();
    scrollTo({ top: 0, behavior: 'smooth' });
  },
});
let pedidoMapa = 0;

async function renderizarMapa() {
  const n = nivel();
  const v = el.ver.value;
  const pedido = ++pedidoMapa;
  el.tituloMapa.textContent = `${rotuloVer(v)} · ${n === 'estados' ? 'por estado' : n === 'todas' ? 'cidades do Brasil' : `cidades de ${nomeUf(n)}`}`;
  el.subMapa.textContent = n === 'estados' ? 'clique num estado para ver as cidades' : 'role para aproximar; arraste para mover';
  let geo;
  try {
    geo = await carregarMalha(n === 'estados' ? undefined : n);
  } catch (erro) {
    if (pedido === pedidoMapa) el.mapa.querySelector('.mapa-area').innerHTML = `<p class="mudo">Mapa indisponível: ${esc(erro.message)}</p>`;
    return;
  }
  if (pedido !== pedidoMapa) return;
  const rotulos = new Map();
  const valores = new Map();
  const porCod = new Map();
  for (const l of estado.locais) {
    if (!l.cod) continue;
    rotulos.set(l.cod, n === 'todas' ? `${l.nome} · ${l.uf.toUpperCase()}` : l.nome);
    porCod.set(l.cod, l);
  }
  const extra = (cod) => {
    const l = porCod.get(cod);
    if (!l?.validos) return '<span class="mudo">sem votos apurados</span>';
    const { primeiro, segundo } = colocados(l);
    return `${primeiro ? `<span>1º ${esc(nomeCand(primeiro.numero))}: ${pct(primeiro.pct)}</span>` : ''}${segundo ? `<span>2º ${esc(nomeCand(segundo.numero))}: ${pct(segundo.pct)}</span>` : ''}<span class="mudo">${fmtInt.format(l.validos)} válidos · ${pct(pctSecoes(l))} das seções</span>`;
  };
  if (v === 'vencedor' || v === 'partido') {
    const categorias = new Map();
    const intensidade = new Map();
    const cores = new Map();
    for (const [cod, l] of porCod) {
      if (!l.validos) continue;
      if (v === 'vencedor') {
        const { primeiro, segundo } = colocados(l);
        if (!primeiro) continue;
        const rot = nomeCand(primeiro.numero);
        categorias.set(cod, rot);
        cores.set(rot, estado.cores.get(primeiro.numero) ?? '#5e6b7d');
        valores.set(cod, primeiro.pct);
        intensidade.set(cod, Math.min(1, (primeiro.pct - (segundo?.pct ?? 0)) / 30));
      } else {
        const p = partidoVencedor(l);
        if (!p) continue;
        categorias.set(cod, p.sigla);
        cores.set(p.sigla, estado.coresPar.get(p.sigla) ?? '#5e6b7d');
        valores.set(cod, p.pct);
      }
    }
    mapa.desenhar({ geo, valores, rotulos, titulo: rotuloVer(v), formato: (x) => pct(x), categorias, cores, intensidade: v === 'vencedor' ? intensidade : null, extra });
    return;
  }
  for (const [cod, l] of porCod) {
    const x = valor(l, v);
    if (x !== null && Number.isFinite(x)) valores.set(cod, x);
  }
  mapa.desenhar({ geo, valores, rotulos, titulo: rotuloVer(v), formato: formatoVer(v), extra });
}

// ---------- resumo em texto ----------

function renderizarResumo() {
  const r = estado.consolidado;
  const locais = comDados();
  if (!r?.validos || !locais.length) { el.resumoTexto.textContent = ''; return; }
  const { primeiro, segundo } = colocados(r);
  const partes = [];
  const pv = partidoVencedor(r);
  if (proporcional() && pv) {
    const vit = locais.filter((l) => partidoVencedor(l)?.sigla === pv.sigla).length;
    partes.push(`<strong>${esc(pv.sigla)}</strong> é o partido mais votado, com ${pct(pv.pct)} dos votos válidos (votos nominais), e fica em 1º em ${fmtInt.format(vit)} de ${fmtInt.format(locais.length)} ${nivel() === 'estados' ? 'estados' : 'cidades'}. O voto está dividido entre ${fmtNum.format(r.efetivoPar ?? 0)} partidos "efetivos".`);
    if (primeiro) partes.push(`Candidato mais votado: <strong>${esc(nomeCand(primeiro.numero))}</strong> (${pct(primeiro.pct)}).`);
  } else if (primeiro) {
    const vitorias = locais.filter((l) => colocados(l).primeiro?.numero === primeiro.numero).length;
    partes.push(`<strong>${esc(nomeCand(primeiro.numero))}</strong> lidera com ${pct(primeiro.pct)} dos votos válidos${segundo ? `, ${fmtNum.format(primeiro.pct - segundo.pct)} p.p. à frente de ${esc(nomeCand(segundo.numero))}` : ''}, e fica em 1º em ${fmtInt.format(vitorias)} de ${fmtInt.format(locais.length)} ${nivel() === 'estados' ? 'estados' : 'cidades'}.`);
  }
  const v = verNumerico();
  if (v && !['vencedor', 'partido'].includes(el.ver.value) || (v && v !== `c:${primeiro?.numero}`)) {
    const ord = locais.map((l) => ({ l, x: valor(l, v) })).filter((p) => p.x !== null && Number.isFinite(p.x)).sort((a, b) => b.x - a.x);
    if (ord.length > 1) {
      const f = formatoVer(v);
      partes.push(`${esc(rotuloVer(v))}: mais alto em <strong>${esc(ord[0].l.nome)}</strong> (${f(ord[0].x)}) e mais baixo em <strong>${esc(ord.at(-1).l.nome)}</strong> (${f(ord.at(-1).x)}).`);
    }
  } else if (primeiro) {
    const ord = locais.map((l) => ({ l, x: valor(l, `c:${primeiro.numero}`) })).filter((p) => p.x !== null).sort((a, b) => b.x - a.x);
    if (ord.length > 1) partes.push(`É mais forte em <strong>${esc(ord[0].l.nome)}</strong> (${pct(ord[0].x)}) e mais fraco em <strong>${esc(ord.at(-1).l.nome)}</strong> (${pct(ord.at(-1).x)}).`);
  }
  el.resumoTexto.innerHTML = `<strong>Em resumo:</strong> ${partes.join(' ')}`;
}

// ---------- tabela ----------

function colunas() {
  const v = el.ver.value;
  const extra = ['vencedor', 'margem', 'comparecimento'].includes(v) ? [] : [[rotuloVer(v), (l) => { const x = valor(l, v); return x === null || !Number.isFinite(x) ? '—' : esc(formatoVer(v)(x)); }, 'sel']];
  return [
    [nivel() === 'estados' ? 'Estado' : 'Cidade', (l) => esc(nivel() === 'todas' ? `${l.nome} · ${l.uf.toUpperCase()}` : l.nome)],
    ['Apurado', (l) => pct(pctSecoes(l)), 'apurado'],
    ['1º colocado', (l) => { const p = colocados(l).primeiro; return p ? `<i class="ponto-cor" style="background:${estado.cores.get(p.numero) ?? '#5e6b7d'}"></i>${esc(nomeCand(p.numero))}` : '—'; }],
    ['% 1º', (l) => { const p = colocados(l).primeiro; return p ? pct(p.pct) : '—'; }, 'p1'],
    ['2º colocado', (l) => { const p = colocados(l).segundo; return p ? esc(nomeCand(p.numero)) : '—'; }],
    ['Margem', (l) => { const x = valor(l, 'margem'); return x === null ? '—' : `${fmtNum.format(x)} p.p.`; }, 'margem'],
    ['Comparecimento', (l) => { const x = valor(l, 'comparecimento'); return x === null ? '—' : pct(x); }, 'comparecimento'],
    ...extra,
    ['Válidos', (l) => fmtInt.format(l.validos ?? 0), 'validos'],
  ];
}

function chaveOrdem(l, k) {
  if (k === 'apurado') return pctSecoes(l);
  if (k === 'p1') return colocados(l).primeiro?.pct ?? null;
  if (k === 'sel') return valor(l, el.ver.value);
  if (k === 'validos') return l.validos ?? 0;
  return valor(l, k);
}

function renderizarTabela() {
  const termo = semAcento(el.busca.value.trim());
  const ordem = estado.ordem ?? (colunas().some((c) => c[2] === 'sel') ? 'sel' : 'validos');
  const linhas = estado.locais.filter((l) => !termo || semAcento(l.nome).includes(termo))
    .map((l) => ({ l, k: chaveOrdem(l, ordem) }))
    .sort((a, b) => (b.k ?? -Infinity) - (a.k ?? -Infinity)).map((x) => x.l);
  estado.linhasTabela = linhas;
  const cols = colunas();
  const visiveis = linhas.slice(0, estado.limite);
  el.tituloTabela.textContent = nivel() === 'estados' ? 'Estados' : 'Cidades';
  el.tabela.innerHTML = `<thead><tr>${cols.map(([t, , k], i) => `<th${i ? ' class="num"' : ''}${k ? ` data-ordem="${k}"` : ''}>${esc(t)}${k && k === ordem ? ' ▼' : ''}</th>`).join('')}</tr></thead>
    <tbody>${visiveis.map((l) => `<tr data-id="${esc(l.id)}" class="${nivel() === 'estados' ? 'clicavel' : ''}">${cols.map(([, f], i) => `<td${i ? ' class="num"' : ' class="local"'}>${f(l)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${cols.length}" class="mudo">Nada apurado ainda.</td></tr>`}</tbody>`;
  el.mais.hidden = visiveis.length >= linhas.length;
  el.mais.textContent = `Mostrar mais (${fmtInt.format(linhas.length - visiveis.length)} restantes)`;
}

// ---------- dicas e eventos ----------

dica.ligar(el.comparacao, '[data-dica]', (alvo) => {
  const p = estado.pontos[Number(alvo.dataset.dica)];
  if (!p) return null;
  const a = verNumerico();
  const b = el.comparar.value;
  return `<strong>${esc(p.l.nome)}</strong><span>${esc(rotuloVer(a))}: ${esc(formatoVer(a)(p.x))}</span><span>${esc(rotuloVer(b))}: ${esc(formatoVer(b)(p.y))}</span>`;
});

el.cargo.addEventListener('change', () => { preencherNiveis(nivel()); el.ver.value = ''; el.comparar.value = ''; estado.ordem = null; carregar(); });
el.nivel.addEventListener('change', () => { estado.ordem = null; estado.limite = PAGINA; carregar(); });
el.ver.addEventListener('change', () => { gravarHash(); estado.ordem = null; renderizar(); });
el.comparar.addEventListener('change', () => { gravarHash(); renderizarComparacao(); renderizarResumo(); });
el.atualizar.addEventListener('click', () => carregar());
el.busca.addEventListener('input', () => { estado.limite = PAGINA; renderizarTabela(); });
el.mais.addEventListener('click', () => { estado.limite += PAGINA * 2; renderizarTabela(); });
el.tabela.addEventListener('click', (ev) => {
  const th = ev.target.closest('th[data-ordem]');
  if (th) { estado.ordem = th.dataset.ordem; renderizarTabela(); return; }
  const tr = ev.target.closest('tr.clicavel');
  if (!tr || ![...el.nivel.options].some((o) => o.value === tr.dataset.id)) return;
  el.nivel.value = tr.dataset.id;
  estado.ordem = null;
  carregar();
  scrollTo({ top: 0, behavior: 'smooth' });
});
el.exportar.addEventListener('click', () => {
  const txt = (h) => String(h).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, x) => String.fromCharCode(x));
  // CSV completo: colunas da tabela e a votação de cada candidato guardado.
  const cands = Object.keys(estado.consolidado?.cand ?? {}).sort((a, b) => estado.consolidado.cand[b] - estado.consolidado.cand[a]);
  const cols = [
    ...colunas().map(([nome, f]) => ({ nome, valor: (l) => txt(f(l)) })),
    ...cands.map((n) => ({ nome: `${nomeCand(n)} (votos)`, valor: (l) => l.cand?.[n] ?? '' })),
  ];
  baixarCsv(`votacao-${el.cargo.value.replace(':', '-')}-${nivel()}.csv`, cols, estado.linhasTabela ?? estado.locais);
});

preencherCargos();
if (inicial.cargo && cargoPorValor(inicial.cargo)) el.cargo.value = inicial.cargo;
preencherNiveis(inicial.nivel ?? 'estados');
carregar();
