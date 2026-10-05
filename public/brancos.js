import {
  CODIGO_IBGE_UF, UF_DO_CODIGO, CARGOS, baixarCsv, cargoPorValor, carregarEstados, carregarMunicipios, criarDica, esc, fmtInt, fmtNum,
  nomeUf, pct, pctSecoes, porteDe, pp, regiaoDe, semAcento,
} from './comum.js';
import { METRICAS, escoreZ, histograma, regressaoLinear, resumoEstatistico, valorMetrica } from './calculos.js';
import { svgDispersao, svgHistograma } from './graficos.js';
import { carregarMalha, criarMapa } from './mapa.js';

// O servidor relê o TSE a cada 2 minutos; a página consulta o servidor a cada 30 s
// (a cada 5 s enquanto a primeira leitura das cidades ainda está em andamento).
const INTERVALO_MS = 30_000;
const PAGINA = 50;
const MAX_COMPARAR = 8;

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'cargo', 'uf', 'metrica', 'referencia', 'porte', 'apuracao', 'mostrar', 'busca', 'chips', 'status', 'atualizar',
  'exportar', 'erro', 'titulo', 'horario', 'barra-secoes', 'pct-secoes', 'secoes', 'leitura', 'kpis', 'titulo-estat',
  'estat', 'titulo-hist', 'hist', 'legenda-hist', 'dispersao', 'legenda-disp', 'correlacao', 'titulo-extremos',
  'maiores', 'menores', 'titulo-cargos', 'cargos', 'comparacao-cartao', 'comparacao', 'limpar-comparacao',
  'titulo-tabela', 'contagem', 'th-metrica', 'escala', 'linhas', 'mais', 'dica', 'titulo-mapa', 'sub-mapa', 'mapa',
  'mapa-divergente',
].map((id) => [id.replace(/-(\w)/g, (_, l) => l.toUpperCase()), $(id)]));

const estado = {
  estados: null, // resposta de /api/estados do cargo atual
  municipios: null, // resposta de /api/municipios (quando há UF ou "todas")
  porCargo: new Map(), // valor do cargo → resposta de /api/estados (painel "Por cargo")
  limite: PAGINA,
  ordem: 'metrica',
  direcao: -1,
  faixa: null, // [início, fim) escolhida no histograma
  fixados: [], // ids comparados lado a lado
  pedido: 0,
  vista: null, // último cálculo (linhas, estatísticas…) usado pelas dicas e pelo CSV
};

const dica = criarDica(el.dica);
const cargoAtual = () => cargoPorValor(el.cargo.value) ?? CARGOS[0];
const nivel = () => (el.uf.value === '' ? 'estados' : el.uf.value === 'todas' ? 'todas' : 'municipios');
const metrica = () => el.metrica.value;
const nomeMetrica = () => METRICAS[metrica()].nome;

// ---------- filtros ----------

function opcoes(select, lista, valor) {
  select.innerHTML = lista.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  if (lista.some(([v]) => v === valor)) select.value = valor;
}

function preencherLocais(valor) {
  const ufs = cargoAtual().abrangencias.filter((a) => a !== 'br').sort((a, b) => nomeUf(a).localeCompare(nomeUf(b), 'pt-BR'));
  const lista = [['', 'Brasil — por estado']];
  if (ufs.length > 1) lista.push(['todas', 'Brasil — todas as cidades']);
  lista.push(...ufs.map((u) => [u, `${nomeUf(u)} — cidades`]));
  opcoes(el.uf, lista, valor ?? '');
}

function preencherReferencias(valor) {
  const lista = [['brasil', 'Média do Brasil']];
  if (nivel() !== 'estados') lista.push(['uf', 'Média do estado de cada cidade']);
  lista.push(['grupo', 'Média ponderada da seleção'], ['media', 'Média simples da seleção'], ['mediana', 'Mediana da seleção']);
  const padrao = nivel() === 'estados' ? 'brasil' : 'uf';
  opcoes(el.referencia, lista, lista.some(([v]) => v === valor) ? valor : padrao);
}

function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return Object.fromEntries(p);
}

function gravarHash() {
  const p = new URLSearchParams({ cargo: el.cargo.value });
  const extra = {
    uf: el.uf.value, metrica: metrica() !== 'pctBrancosNulos' ? metrica() : '', ref: el.referencia.value,
    porte: el.porte.value, apur: el.apuracao.value !== '0' ? el.apuracao.value : '', mostrar: el.mostrar.value,
    ordem: estado.ordem !== 'metrica' ? estado.ordem : '', dir: estado.direcao === 1 ? 'asc' : '',
    faixa: estado.faixa ? estado.faixa.join('-') : '', sel: estado.fixados.join(','),
  };
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const hash = `#${p}`;
  if (hash === location.hash) return;
  history.replaceState(null, '', hash);
  // Outras janelas do painel (área de trabalho) recebem os mesmos filtros.
  if (!estado.aplicandoRemoto) canal?.postMessage({ hash });
}

// Janelas do painel abertas ao mesmo tempo compartilham filtros, seleção e comparação.
const canal = 'BroadcastChannel' in window ? new BroadcastChannel('apuracao2026:brancos') : null;
canal?.addEventListener('message', (ev) => {
  const hash = ev.data?.hash;
  if (!hash || hash === location.hash) return;
  const antes = `${el.cargo.value}|${el.uf.value}`;
  history.replaceState(null, '', hash);
  aplicarHash();

// Janela de módulo (área de trabalho): filtros recolhidos atrás de um botão, já que
// chegam sincronizados das outras janelas do painel.
if (document.documentElement.dataset.modulo) {
  const botao = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Filtros…' });
  botao.setAttribute('aria-expanded', 'false');
  botao.addEventListener('click', () => {
    const aberto = document.documentElement.classList.toggle('filtros-abertos');
    botao.setAttribute('aria-expanded', String(aberto));
  });
  el.atualizar.before(botao);
  if (document.documentElement.dataset.modulo !== 'tabela') el.exportar.hidden = true;
}
  estado.aplicandoRemoto = true;
  try {
    if (`${el.cargo.value}|${el.uf.value}` !== antes) {
      estado.municipios = null;
      carregar();
      carregarCargos();
    } else {
      renderizar();
    }
  } finally {
    estado.aplicandoRemoto = false;
  }
});

// ---------- carga ----------

async function carregar() {
  const cargo = cargoAtual();
  const pedido = ++estado.pedido;
  el.status.textContent = 'consultando…';
  el.status.className = 'status';
  el.atualizar.disabled = true;
  try {
    const n = nivel();
    const [estados, municipios] = await Promise.all([
      carregarEstados(cargo),
      n === 'estados' ? null : carregarMunicipios(cargo, el.uf.value),
    ]);
    if (pedido !== estado.pedido) return; // o usuário já trocou de filtro
    estado.estados = estados;
    estado.municipios = municipios;
    estado.porCargo.set(cargo.valor, estados);
    const aviso = municipios?.erro;
    el.erro.hidden = !aviso;
    el.erro.textContent = aviso ? `Aviso: ${aviso}` : '';
    renderizar();
    el.status.textContent = `consultado às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
    // Arquivos ainda chegando ao banco do servidor: consulta de novo logo, sem esperar 30 s.
    if (estados.pendentes) setTimeout(() => pedido === estado.pedido && carregar(), 3_000);
    else if (municipios?.lendo) setTimeout(() => pedido === estado.pedido && carregar(), 5_000);
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

// Painel "Por cargo": um /api/estados para cada cargo que existe no local escolhido.
async function carregarCargos() {
  const uf = nivel() === 'municipios' ? el.uf.value : null;
  const cargos = CARGOS.filter((c) => (uf ? c.abrangencias.includes(uf) : c.abrangencias.length > 1));
  let pendentes = 0;
  await Promise.all(cargos.map(async (c) => {
    try {
      const d = await carregarEstados(c, { fundo: c.valor !== el.cargo.value });
      estado.porCargo.set(c.valor, d);
      pendentes += d.pendentes ?? 0;
    } catch {
      // cargo sem dados ainda: a linha aparece vazia
    }
  }));
  renderizarCargos();
  if (pendentes) setTimeout(carregarCargos, 4_000);
}

// ---------- cálculo ----------

const ESTADO_DE = () => new Map((estado.estados?.estados ?? []).map((e) => [e.uf, e]));

/** Todas as linhas do nível atual, com campos derivados. */
function linhasBase() {
  const n = nivel();
  const bruto = n === 'estados'
    ? (estado.estados?.estados ?? []).map((e) => ({ ...e, id: e.uf }))
    : (estado.municipios?.municipios ?? []).map((m) => ({ ...m, id: m.codigo }));
  return bruto.map((l) => ({ ...l, secoesPct: pctSecoes(l), regiao: regiaoDe(l.uf), porte: porteDe(l.total) }));
}

function filtrar(linhas) {
  const [pMin, pMax] = el.porte.value ? el.porte.value.split('-').map((v) => (v === '' ? Infinity : Number(v))) : [0, Infinity];
  const apur = Number(el.apuracao.value);
  const chave = metrica();
  return linhas.filter((l) => l.total >= pMin && l.total < pMax && l.secoesPct >= apur
    && METRICAS[chave].denominador(l) > 0);
}

/** Valor de referência (em %) para uma linha, conforme "Comparar com". */
function referenciaPara(l, chave, estat) {
  switch (el.referencia.value) {
    case 'uf': {
      const e = ESTADO_DE().get(l.uf);
      return e ? valorMetrica(e, chave) : null;
    }
    case 'grupo': return estat?.ponderada ?? null;
    case 'media': return estat?.media ?? null;
    case 'mediana': return estat?.mediana ?? null;
    default: return estado.estados?.brasil ? valorMetrica(estado.estados.brasil, chave) : null;
  }
}

const NOME_REF = {
  brasil: 'média do Brasil', uf: 'média do estado', grupo: 'média ponderada da seleção',
  media: 'média simples da seleção', mediana: 'mediana da seleção',
};

function calcular() {
  const chave = metrica();
  const todas = linhasBase();
  const base = filtrar(todas);
  const estat = resumoEstatistico(base, chave);
  const enriquecidas = base.map((l) => {
    const valor = valorMetrica(l, chave);
    const ref = referenciaPara(l, chave, estat);
    return {
      ...l,
      valor,
      ref,
      delta: ref === null ? null : valor - ref,
      z: escoreZ(valor, estat),
      atipico: estat ? valor < estat.cercaInferior || valor > estat.cercaSuperior : false,
    };
  });

  const termo = semAcento(el.busca.value.trim());
  const visiveis = enriquecidas.filter((l) => {
    if (estado.faixa && !(l.valor >= estado.faixa[0] && (l.valor < estado.faixa[1] || (estado.faixa[2] && l.valor <= estado.faixa[1])))) return false;
    if (termo && !semAcento(l.nome).includes(termo)) return false;
    switch (el.mostrar.value) {
      case 'acima': return l.delta > 0;
      case 'abaixo': return l.delta < 0;
      case 'atipicos': return l.atipico;
      case 'z2': return Math.abs(l.z) >= 2;
      default: return true;
    }
  });

  const campo = { metrica: 'valor', secoes: 'secoesPct' }[estado.ordem] ?? estado.ordem;
  visiveis.sort((a, b) => {
    if (campo === 'nome') return estado.direcao * -a.nome.localeCompare(b.nome, 'pt-BR');
    const va = campo.startsWith('pct') ? valorMetrica(a, campo) : a[campo] ?? -Infinity;
    const vb = campo.startsWith('pct') ? valorMetrica(b, campo) : b[campo] ?? -Infinity;
    return estado.direcao * (va - vb) || a.nome.localeCompare(b.nome, 'pt-BR');
  });

  estado.vista = { chave, todas, base: enriquecidas, visiveis, estat, porId: new Map(enriquecidas.map((l) => [String(l.id), l])) };
  return estado.vista;
}

// ---------- renderização ----------

// ---------- mapa ----------

const mapa = criarMapa(el.mapa, {
  dica,
  aoClicar: (cod) => {
    const v = estado.vista;
    if (!v) return;
    if (nivel() === 'estados') {
      const uf = UF_DO_CODIGO[cod];
      if (uf && v.porId.has(uf)) abrirLocal(uf);
    } else {
      const l = v.base.find((x) => x.ibge === cod);
      if (l) alternarFixado(String(l.id));
    }
  },
});

let pedidoMapa = 0;
async function renderizarMapa({ base, estat }) {
  const n = nivel();
  const pedido = ++pedidoMapa;
  el.tituloMapa.textContent = `Mapa · ${nomeMetrica()}`;
  el.subMapa.textContent = n === 'estados' ? 'clique num estado para ver as cidades · role para aproximar' : 'clique numa cidade para comparar · role para aproximar';
  let geo;
  try {
    geo = await carregarMalha(n === 'estados' ? undefined : n === 'todas' ? 'todas' : el.uf.value);
  } catch (erro) {
    if (pedido === pedidoMapa) el.mapa.querySelector('.mapa-area').innerHTML = `<p class="mudo">Mapa indisponível: ${esc(erro.message)}</p>`;
    return;
  }
  if (pedido !== pedidoMapa) return;
  const valores = new Map();
  const rotulos = new Map();
  const porCod = new Map();
  for (const l of base) {
    const cod = n === 'estados' ? CODIGO_IBGE_UF[l.uf] : l.ibge;
    if (!cod) continue;
    valores.set(cod, l.valor);
    rotulos.set(cod, n === 'estados' ? l.nome : `${l.nome} · ${l.uf.toUpperCase()}`);
    porCod.set(cod, l);
  }
  // Referência única para as cores (no modo "estado de cada cidade" usa a média do Brasil).
  const ref = el.mapaDivergente.checked
    ? (el.referencia.value === 'uf' ? (estado.estados?.brasil ? valorMetrica(estado.estados.brasil, metrica()) : null) : referenciaPara({}, metrica(), estat))
    : null;
  const destaques = new Set(estado.fixados.map((id) => base.find((l) => String(l.id) === id)).filter(Boolean)
    .map((l) => (n === 'estados' ? CODIGO_IBGE_UF[l.uf] : l.ibge)));
  mapa.desenhar({
    geo, valores, rotulos, titulo: `% ${nomeMetrica().toLowerCase()}`, formato: (x) => pct(x), referencia: ref, destaques,
    extra: (cod) => {
      const l = porCod.get(cod);
      return l ? `<span>${l.delta === null ? '' : `${pp(l.delta)} p.p. vs referência · `}${fmtInt.format(l.total)} votos</span>` : '';
    },
  });
}

function renderizar() {
  if (!estado.estados) return;
  const v = calcular();
  gravarHash();
  renderizarResumo();
  renderizarMapa(v);
  renderizarChips();
  renderizarEstatisticas(v);
  renderizarHistograma(v);
  renderizarDispersao(v);
  renderizarExtremos(v);
  renderizarCargos();
  renderizarComparacao(v);
  renderizarTabela(v);
}

function resumoAtual() {
  const n = nivel();
  if (n === 'estados') return { r: estado.estados?.brasil, nome: 'Brasil' };
  if (n === 'todas') return { r: estado.estados?.brasil, nome: 'Brasil (todas as cidades)' };
  return { r: ESTADO_DE().get(el.uf.value) ?? estado.municipios?.consolidado, nome: nomeUf(el.uf.value) };
}

function kpi(classe, chave, r, brasil) {
  const m = METRICAS[chave];
  const valor = valorMetrica(r, chave);
  const delta = brasil && brasil !== r ? valor - valorMetrica(brasil, chave) : null;
  const deltaHtml = delta === null ? '' : `<small class="delta">${pp(delta)} p.p. vs Brasil</small>`;
  return `<div class="kpi${metrica() === chave ? ' kpi-ativo' : ''}" data-metrica="${chave}">
    <dt>${classe ? `<i class="amostra ${classe}"></i>` : ''}${m.nome}</dt>
    <dd><span class="kpi-pct">${pct(valor)}</span><small>${fmtInt.format(m.numerador(r))} ${chave === 'pctAbstencao' ? 'eleitores' : 'votos'}</small>${deltaHtml}</dd></div>`;
}

function renderizarResumo() {
  const { r, nome } = resumoAtual();
  const n = nivel();
  el.titulo.textContent = `${cargoAtual().nome} · ${nome}`;
  el.horario.textContent = r?.atualizadoEm ? `Atualizado pelo TSE em ${r.atualizadoEm}` : '';
  const pSec = r ? pctSecoes(r) : 0;
  el.barraSecoes.style.width = `${Math.min(100, pSec)}%`;
  el.pctSecoes.textContent = pct(pSec);
  el.secoes.textContent = r ? `(${fmtInt.format(r.secoes.totalizadas)} de ${fmtInt.format(r.secoes.total)})` : '';

  const m = estado.municipios;
  if (n !== 'estados' && m) {
    const total = m.total ?? '?';
    const proxima = m.proximaEmSegundos != null ? ` · próxima leitura em ${Math.max(1, Math.ceil(m.proximaEmSegundos / 60))} min` : '';
    el.leitura.textContent = m.lendo
      ? `Lendo cidades no TSE… ${fmtInt.format(m.lidos)} de ${fmtInt.format(total)} já lidas${n === 'todas' ? ' (o Brasil inteiro leva alguns minutos na primeira vez)' : ''}.`
      : `${fmtInt.format(m.lidos)} de ${fmtInt.format(total)} cidades lidas${proxima}.`;
    el.leitura.hidden = false;
  } else {
    const { pendentes = 0, total = 0, lidos = 0 } = estado.estados ?? {};
    const faltam = total - lidos;
    el.leitura.textContent = pendentes
      ? `Carregando ${pendentes} arquivo(s) do TSE… ${lidos} de ${total} UFs já no banco.`
      : faltam > 0 ? `${faltam} UF(s) ainda sem resultado publicado pelo TSE.` : '';
    el.leitura.hidden = !el.leitura.textContent;
  }

  const brasil = estado.estados?.brasil;
  el.kpis.innerHTML = r
    ? [
      kpi('brancos', 'pctBrancos', r, brasil),
      kpi('nulos', 'pctNulos', r, brasil),
      kpi('anulados', 'pctAnulados', r, brasil),
      kpi('bn', 'pctBrancosNulos', r, brasil),
      kpi('abst', 'pctAbstencao', r, brasil),
    ].join('')
    : '<p class="mudo">Ainda sem dados publicados.</p>';
}

function renderizarChips() {
  const chips = [];
  if (estado.faixa) chips.push(['faixa', `${nomeMetrica()} entre ${fmtNum.format(estado.faixa[0])}% e ${fmtNum.format(estado.faixa[1])}%`]);
  if (el.porte.value) chips.push(['porte', `Porte: ${el.porte.selectedOptions[0].textContent}`]);
  if (el.apuracao.value !== '0') chips.push(['apuracao', `Apuração ≥ ${el.apuracao.value}%`]);
  if (el.mostrar.value) chips.push(['mostrar', el.mostrar.selectedOptions[0].textContent]);
  if (el.busca.value.trim()) chips.push(['busca', `Busca: "${el.busca.value.trim()}"`]);
  el.chips.hidden = !chips.length;
  el.chips.innerHTML = chips.map(([k, t]) => `<button type="button" class="chip" data-limpar="${k}">${esc(t)} <span aria-hidden="true">×</span></button>`).join('')
    + (chips.length > 1 ? '<button type="button" class="chip chip-todos" data-limpar="todos">Limpar filtros</button>' : '');
}

function linhaEstat(rotulo, valor, extra = '') {
  return `<div><dt>${rotulo}</dt><dd>${valor}${extra ? ` <small>${extra}</small>` : ''}</dd></div>`;
}

function renderizarEstatisticas({ estat, base }) {
  const unidade = nivel() === 'estados' ? 'estados' : 'cidades';
  el.tituloEstat.textContent = `Estatísticas · ${nomeMetrica()}`;
  if (!estat) {
    el.estat.innerHTML = '<p class="mudo">Sem locais na seleção.</p>';
    return;
  }
  const atipicos = base.filter((l) => l.atipico).length;
  const ref = el.referencia.value === 'uf' ? null : referenciaPara(base[0] ?? {}, metrica(), estat);
  el.estat.innerHTML = [
    linhaEstat(`Locais (${unidade})`, fmtInt.format(estat.n)),
    linhaEstat('Média ponderada', pct(estat.ponderada), 'soma dos votos'),
    linhaEstat('Média simples', pct(estat.media), 'cada local pesa igual'),
    linhaEstat('Mediana', pct(estat.mediana)),
    linhaEstat('Desvio padrão', `${fmtNum.format(estat.desvio)} p.p.`),
    linhaEstat('Quartis (Q1–Q3)', `${fmtNum.format(estat.q1)}% – ${fmtNum.format(estat.q3)}%`),
    linhaEstat('Mínimo', pct(estat.min.valor), esc(estat.min.linha.nome)),
    linhaEstat('Máximo', pct(estat.max.valor), esc(estat.max.linha.nome)),
    linhaEstat('Atípicos', fmtInt.format(atipicos), `fora de ${fmtNum.format(Math.max(0, estat.cercaInferior))}%–${fmtNum.format(estat.cercaSuperior)}%`),
    ref === null ? '' : linhaEstat(`Referência`, pct(ref), NOME_REF[el.referencia.value]),
  ].join('');
}

const COR_METRICA = {
  pctBrancos: 'var(--serie-brancos)', pctNulos: 'var(--serie-nulos)', pctAnulados: 'var(--serie-anulados)',
  pctBrancosNulos: 'var(--serie-bn)', pctAbstencao: 'var(--serie-abst)',
};

function renderizarHistograma({ base, estat }) {
  el.tituloHist.textContent = `Distribuição · ${nomeMetrica()}`;
  const hist = histograma(base.map((l) => l.valor), base.length > 200 ? 24 : 14);
  estado.hist = hist;
  const selecionada = estado.faixa ? hist.faixas.findIndex((f) => Math.abs(f.inicio - estado.faixa[0]) < 1e-9) : null;
  const ref = el.referencia.value === 'uf' ? null : referenciaPara({}, metrica(), estat);
  const linhas = [];
  if (estat) linhas.push({ valor: estat.mediana, classe: 'ref-mediana', rotulo: 'mediana' });
  if (ref !== null && Number.isFinite(ref)) linhas.push({ valor: ref, classe: 'ref-principal', rotulo: 'referência' });
  el.hist.innerHTML = svgHistograma({
    faixas: hist.faixas,
    linhas,
    selecionada: selecionada === -1 ? null : selecionada,
    rotuloX: `% ${nomeMetrica().toLowerCase()}`,
    cor: COR_METRICA[metrica()],
  });
  el.legendaHist.innerHTML = `<span><i class="amostra" style="background:${COR_METRICA[metrica()]}"></i>Nº de ${nivel() === 'estados' ? 'estados' : 'cidades'}</span>`
    + '<span><i class="marca-ref"></i>Referência</span><span><i class="marca-ref mediana"></i>Mediana</span>';
}

// Cor de cada ponto/linha pela posição em relação à referência: azul abaixo, vermelho acima,
// cinza quando a diferença é menor que meio desvio padrão.
function classeDesvio(l, estat) {
  if (l.delta === null || !estat) return 'neutro';
  if (Math.abs(l.delta) < estat.desvio * 0.5) return 'neutro';
  return l.delta > 0 ? 'acima' : 'abaixo';
}

function renderizarDispersao({ base, visiveis, estat }) {
  const visivel = new Set(visiveis.map((l) => l.id));
  const maxVotos = Math.max(1, ...base.map((l) => l.total));
  const pontos = base.map((l) => ({
    x: valorMetrica(l, 'pctBrancos'),
    y: valorMetrica(l, 'pctNulos'),
    r: 2.5 + Math.sqrt(l.total / maxVotos) * (base.length > 300 ? 8 : 14),
    classe: classeDesvio(l, estat),
    apagado: !visivel.has(l.id),
    destacado: estado.fixados.includes(String(l.id)),
  }));
  estado.pontosDispersao = base;
  const brasil = estado.estados?.brasil;
  const reg = regressaoLinear(pontos.map((p) => p.x), pontos.map((p) => p.y));
  el.dispersao.innerHTML = svgDispersao({
    pontos,
    rotuloX: '% brancos',
    rotuloY: '% nulos',
    refX: brasil ? valorMetrica(brasil, 'pctBrancos') : null,
    refY: brasil ? valorMetrica(brasil, 'pctNulos') : null,
    regressao: reg,
  });
  el.correlacao.textContent = reg?.r != null ? `correlação r = ${fmtNum.format(reg.r)} · ${fmtInt.format(pontos.length)} locais` : '';
  el.legendaDisp.innerHTML = `<span><i class="amostra ponto-acima"></i>Acima da referência (${esc(nomeMetrica())})</span>`
    + '<span><i class="amostra ponto-abaixo"></i>Abaixo</span><span><i class="amostra ponto-neutro"></i>Próximo</span>'
    + '<span><i class="marca-ref"></i>Média do Brasil</span><span><i class="marca-regressao"></i>Tendência</span>'
    + '<span class="mudo">tamanho = votos</span>';
}

function itemRanking(l) {
  const uf = nivel() !== 'municipios' && l.uf && nivel() !== 'estados' ? ` <span class="mudo">${esc(l.uf.toUpperCase())}</span>` : '';
  return `<li data-id="${esc(l.id)}" class="clicavel"><span class="ranking-nome">${esc(l.nome)}${uf}</span>
    <span class="ranking-valor">${pct(l.valor)}${l.delta === null ? '' : ` <small class="delta ${l.delta > 0 ? 'acima' : 'abaixo'}">${pp(l.delta)}</small>`}</span></li>`;
}

function renderizarExtremos({ base }) {
  el.tituloExtremos.textContent = `Maiores e menores · ${nomeMetrica()}`;
  const ord = [...base].sort((a, b) => b.valor - a.valor);
  el.maiores.innerHTML = ord.slice(0, 10).map(itemRanking).join('') || '<li class="mudo">—</li>';
  el.menores.innerHTML = ord.slice(-10).reverse().map(itemRanking).join('') || '<li class="mudo">—</li>';
}

function renderizarCargos() {
  const uf = nivel() === 'municipios' ? el.uf.value : null;
  el.tituloCargos.textContent = `Por cargo · ${uf ? nomeUf(uf) : 'Brasil'}`;
  const linhas = CARGOS.filter((c) => (uf ? c.abrangencias.includes(uf) : c.abrangencias.length > 1)).map((c) => {
    const d = estado.porCargo.get(c.valor);
    const r = uf ? d?.estados.find((e) => e.uf === uf) : d?.brasil;
    return { cargo: c, r };
  });
  const maximo = Math.max(1, ...linhas.filter((l) => l.r).map((l) => valorMetrica(l.r, 'pctBrancosNulos') + valorMetrica(l.r, 'pctAnulados')));
  const escalaMax = Math.ceil(maximo / 5) * 5;
  el.cargos.innerHTML = linhas.map(({ cargo, r }) => {
    const atual = cargo.valor === el.cargo.value ? ' class="linha-atual"' : '';
    if (!r) return `<tr${atual}><td class="local">${esc(cargo.nome)}</td><td colspan="7" class="mudo">sem dados ainda</td></tr>`;
    return `<tr${atual} data-cargo="${cargo.valor}" class="clicavel">
      <td class="local">${esc(cargo.nome)}</td>
      <td class="num col-secoes">${pct(pctSecoes(r))}</td>
      <td class="num">${pct(r.pctBrancos)}</td><td class="num">${pct(r.pctNulos)}</td>
      <td class="num col-anulados">${pct(r.pctAnulados)}</td><td class="num col-abst">${pct(valorMetrica(r, 'pctAbstencao'))}</td>
      <td class="num forte">${pct(r.pctBrancosNulos)}</td>
      <td class="col-barra">${pilha(r, escalaMax, null)}</td></tr>`;
  }).join('');
}

function pilha(l, escalaMax, ref, extra = '') {
  const w = (v) => `${(v / escalaMax) * 100}%`;
  const marca = ref !== null && ref !== undefined && Number.isFinite(ref) && ['pctBrancosNulos', 'pctBrancos'].includes(metrica())
    ? `<i class="pilha-ref" style="left:${Math.min(100, (ref / escalaMax) * 100)}%"></i>` : '';
  return `<div class="pilha ${extra}" data-id="${esc(l.id ?? '')}">`
    + `<span class="brancos" style="width:${w(l.pctBrancos)}"></span>`
    + `<span class="nulos" style="width:${w(l.pctNulos)}"></span>`
    + `<span class="anulados" style="width:${w(l.pctAnulados)}"></span>${marca}</div>`;
}

function celulaDelta(l) {
  if (l.delta === null) return '<td class="num mudo">—</td>';
  const forca = Math.min(1, Math.abs(l.z) / 3);
  const cor = l.delta > 0 ? 'var(--div-acima)' : 'var(--div-abaixo)';
  return `<td class="num"><span class="desvio" style="--forca:${(forca * 38).toFixed(0)}%;--cor:${cor}">${pp(l.delta)}</span></td>`;
}

function renderizarTabela({ visiveis, base }) {
  const n = nivel();
  el.tituloTabela.textContent = n === 'estados' ? 'Estados' : n === 'todas' ? 'Todas as cidades do Brasil' : `Cidades de ${nomeUf(el.uf.value)}`;
  el.thMetrica.textContent = METRICAS[metrica()].curto;
  el.contagem.textContent = `${fmtInt.format(visiveis.length)} de ${fmtInt.format(base.length)} locais · Δ e cores em relação à ${NOME_REF[el.referencia.value]}`;
  for (const th of document.querySelectorAll('#tabela th[data-ordem]')) {
    th.classList.toggle('ordenada', th.dataset.ordem === estado.ordem);
    th.dataset.dir = th.dataset.ordem === estado.ordem ? (estado.direcao === 1 ? '▲' : '▼') : '';
  }

  const mostrar = visiveis.slice(0, estado.limite);
  const maximo = Math.max(1, ...visiveis.map((l) => l.pctBrancos + l.pctNulos + l.pctAnulados));
  const escalaMax = Math.ceil(maximo / 5) * 5;
  el.escala.textContent = `escala 0–${escalaMax}%`;
  const comUf = n === 'estados' || n === 'todas';
  el.linhas.innerHTML = mostrar.length ? mostrar.map((l) => {
    const fixado = estado.fixados.includes(String(l.id));
    return `<tr data-id="${esc(l.id)}" class="${n === 'estados' ? 'clicavel' : ''}${fixado ? ' fixada' : ''}">
      <td class="col-fixar"><button type="button" class="fixar" data-fixar="${esc(l.id)}" aria-pressed="${fixado}" title="Comparar">${fixado ? '★' : '☆'}</button></td>
      <td class="local">${esc(l.nome)}${comUf ? ` <span class="mudo">${esc(l.uf.toUpperCase())}</span>` : ''}${l.atipico ? ' <span class="selo outro" title="Fora das cercas de Tukey">atípico</span>' : ''}
        <small class="mudo">${esc(l.porte)} votos<span class="so-celular"> · ${pct(l.secoesPct)} apurado</span></small>${pilha(l, escalaMax, l.ref, 'mini')}</td>
      <td class="num col-votos">${fmtInt.format(l.total)}</td>
      <td class="num col-secoes">${pct(l.secoesPct)}</td>
      <td class="num col-brancos">${pct(l.pctBrancos)}<small>${fmtInt.format(l.brancos)}</small></td>
      <td class="num col-nulos">${pct(l.pctNulos)}<small>${fmtInt.format(l.nulos)}</small></td>
      <td class="num col-anulados">${pct(l.pctAnulados)}<small>${fmtInt.format(l.anulados)}</small></td>
      <td class="num col-abst">${pct(valorMetrica(l, 'pctAbstencao'))}</td>
      <td class="num col-metrica forte">${pct(l.valor)}</td>
      ${celulaDelta(l)}
      <td class="num col-z">${fmtNum.format(l.z)}</td>
      <td class="col-barra">${pilha(l, escalaMax, l.ref)}</td>
    </tr>`;
  }).join('')
    : `<tr><td colspan="12" class="mudo">${estado.municipios?.lendo && !estado.municipios.lidos ? 'Lendo as cidades no TSE…' : 'Nada encontrado com esses filtros.'}</td></tr>`;
  el.mais.hidden = mostrar.length >= visiveis.length;
  el.mais.textContent = `Mostrar mais (${fmtInt.format(visiveis.length - mostrar.length)} restantes)`;
}

function renderizarComparacao({ porId, estat }) {
  const lista = estado.fixados.map((id) => porId.get(id)).filter(Boolean);
  el.comparacaoCartao.hidden = !lista.length;
  if (!lista.length) {
    el.comparacao.innerHTML = '<tbody><tr><td class="mudo">Marque locais com ☆ na tabela (ou toque nos pontos da dispersão) para compará-los aqui.</td></tr></tbody>';
    return;
  }
  const linhasMet = [
    ['Votos', (l) => fmtInt.format(l.total)],
    ['Seções apuradas', (l) => pct(l.secoesPct)],
    ...Object.keys(METRICAS).map((k) => [METRICAS[k].nome, (l) => pct(valorMetrica(l, k)), k]),
    [`Δ ${METRICAS[metrica()].curto} vs referência`, (l) => (l.delta === null ? '—' : `${pp(l.delta)} p.p.`)],
    ['z (seleção)', (l) => fmtNum.format(l.z)],
  ];
  // Em cada métrica, destaca o maior valor entre os comparados.
  el.comparacao.innerHTML = `<thead><tr><th></th>${lista.map((l) => `<th class="num">${esc(l.nome)}${l.uf && nivel() !== 'municipios' ? ` <span class="mudo">${esc(l.uf.toUpperCase())}</span>` : ''}
      <button type="button" class="fixar" data-fixar="${esc(l.id)}" title="Remover">×</button></th>`).join('')}
      ${estat ? '<th class="num mudo">Média da seleção</th>' : ''}</tr></thead>
    <tbody>${linhasMet.map(([rotulo, f, k]) => {
    const maior = k ? Math.max(...lista.map((l) => valorMetrica(l, k))) : null;
    return `<tr><th>${esc(rotulo)}</th>${lista.map((l) => `<td class="num${k && valorMetrica(l, k) === maior && lista.length > 1 ? ' forte' : ''}">${f(l)}</td>`).join('')}
      ${estat ? `<td class="num mudo">${k ? pct(resumoEstatistico(estado.vista.base, k)?.ponderada ?? 0) : ''}</td>` : ''}</tr>`;
  }).join('')}</tbody>`;
}

// ---------- dicas ----------

function htmlDicaLocal(l) {
  if (!l) return null;
  return `<strong>${esc(l.nome)}${l.uf && nivel() !== 'municipios' ? ` · ${esc(l.uf.toUpperCase())}` : ''}</strong>
    <span><i class="amostra brancos"></i>Brancos ${pct(l.pctBrancos)} · ${fmtInt.format(l.brancos)}</span>
    <span><i class="amostra nulos"></i>Nulos ${pct(l.pctNulos)} · ${fmtInt.format(l.nulos)}</span>
    <span><i class="amostra anulados"></i>Anulados ${pct(l.pctAnulados)} · ${fmtInt.format(l.anulados)}</span>
    <span><i class="amostra abst"></i>Abstenção ${pct(valorMetrica(l, 'pctAbstencao'))}</span>
    ${l.delta === null || l.delta === undefined ? '' : `<span>${esc(METRICAS[metrica()].curto)} ${pp(l.delta)} p.p. vs ${esc(NOME_REF[el.referencia.value])} · z ${fmtNum.format(l.z)}</span>`}
    <span class="mudo">${pct(pctSecoes(l))} das seções · ${fmtInt.format(l.total)} votos</span>`;
}

dica.ligar(el.dispersao, '[data-dica]', (alvo) => htmlDicaLocal(estado.pontosDispersao?.[Number(alvo.dataset.dica)]));
dica.ligar(el.linhas, '.pilha', (alvo) => htmlDicaLocal(estado.vista?.porId.get(alvo.dataset.id)));
dica.ligar(el.hist, '[data-dica]', (alvo) => {
  const f = estado.hist?.faixas[Number(alvo.dataset.dica)];
  if (!f) return null;
  return `<strong>${fmtNum.format(f.inicio)}% a ${fmtNum.format(f.fim)}%</strong>
    <span>${fmtInt.format(f.contagem)} ${nivel() === 'estados' ? 'estado(s)' : 'cidade(s)'}</span><span class="mudo">clique para filtrar</span>`;
});

// ---------- eventos ----------

function alternarFixado(id) {
  const i = estado.fixados.indexOf(id);
  if (i >= 0) estado.fixados.splice(i, 1);
  else if (estado.fixados.length < MAX_COMPARAR) estado.fixados.push(id);
  renderizar();
}

function abrirLocal(id) {
  if (nivel() === 'estados') {
    el.uf.value = id;
    trocarNivel();
    scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    alternarFixado(String(id));
  }
}

el.linhas.addEventListener('click', (ev) => {
  const botao = ev.target.closest('[data-fixar]');
  if (botao) return alternarFixado(botao.dataset.fixar);
  const tr = ev.target.closest('tr.clicavel');
  if (tr) abrirLocal(tr.dataset.id);
});
el.comparacao.addEventListener('click', (ev) => {
  const botao = ev.target.closest('[data-fixar]');
  if (botao) alternarFixado(botao.dataset.fixar);
});
for (const lista of [el.maiores, el.menores]) {
  lista.addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (li) abrirLocal(li.dataset.id);
  });
}
el.dispersao.addEventListener('click', (ev) => {
  const p = ev.target.closest('[data-dica]');
  const l = p && estado.pontosDispersao?.[Number(p.dataset.dica)];
  if (l) abrirLocal(l.id);
});
el.hist.addEventListener('click', (ev) => {
  const g = ev.target.closest('[data-dica]');
  const f = g && estado.hist?.faixas[Number(g.dataset.dica)];
  if (!f) return;
  const ultima = Number(g.dataset.dica) === estado.hist.faixas.length - 1;
  estado.faixa = estado.faixa && Math.abs(estado.faixa[0] - f.inicio) < 1e-9 ? null : [f.inicio, f.fim, ultima ? 1 : 0];
  estado.limite = PAGINA;
  renderizar();
});
el.kpis.addEventListener('click', (ev) => {
  const k = ev.target.closest('[data-metrica]');
  if (!k) return;
  el.metrica.value = k.dataset.metrica;
  estado.faixa = null;
  renderizar();
});
el.cargos.addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-cargo]');
  if (!tr || tr.dataset.cargo === el.cargo.value) return;
  el.cargo.value = tr.dataset.cargo;
  trocarCargo();
});
el.chips.addEventListener('click', (ev) => {
  const c = ev.target.closest('[data-limpar]')?.dataset.limpar;
  if (!c) return;
  if (c === 'faixa' || c === 'todos') estado.faixa = null;
  if (c === 'porte' || c === 'todos') el.porte.value = '';
  if (c === 'apuracao' || c === 'todos') el.apuracao.value = '0';
  if (c === 'mostrar' || c === 'todos') el.mostrar.value = '';
  if (c === 'busca' || c === 'todos') el.busca.value = '';
  estado.limite = PAGINA;
  renderizar();
});
document.querySelector('#tabela thead').addEventListener('click', (ev) => {
  const th = ev.target.closest('th[data-ordem]');
  if (!th) return;
  if (estado.ordem === th.dataset.ordem) estado.direcao *= -1;
  else {
    estado.ordem = th.dataset.ordem;
    estado.direcao = th.dataset.ordem === 'nome' ? 1 : -1;
  }
  renderizar();
});

function trocarNivel() {
  estado.limite = PAGINA;
  estado.faixa = null;
  estado.fixados = [];
  estado.municipios = null;
  el.busca.value = '';
  preencherReferencias(el.referencia.value);
  el.linhas.innerHTML = '<tr><td colspan="12" class="mudo">Carregando…</td></tr>';
  carregar();
  carregarCargos();
}

function trocarCargo() {
  preencherLocais(el.uf.value);
  trocarNivel();
}

el.cargo.addEventListener('change', trocarCargo);
el.uf.addEventListener('change', trocarNivel);
el.metrica.addEventListener('change', () => { estado.faixa = null; renderizar(); });
el.mapaDivergente.addEventListener('change', () => renderizarMapa(estado.vista));
for (const s of [el.referencia, el.porte, el.apuracao, el.mostrar]) {
  s.addEventListener('change', () => { estado.limite = PAGINA; estado.faixa = s === el.porte || s === el.apuracao ? null : estado.faixa; renderizar(); });
}
el.busca.addEventListener('input', () => { estado.limite = PAGINA; if (estado.estados) renderizar(); });
el.mais.addEventListener('click', () => { estado.limite += PAGINA * 2; renderizarTabela(estado.vista); });
el.atualizar.addEventListener('click', () => { carregar(); carregarCargos(); });
el.limparComparacao.addEventListener('click', () => { estado.fixados = []; renderizar(); });

el.exportar.addEventListener('click', () => {
  const v = estado.vista;
  if (!v) return;
  const nome = `brancos-nulos-${cargoAtual().nome.toLowerCase().replace(/\s+/g, '-')}-${el.uf.value || 'estados'}.csv`;
  baixarCsv(nome, [
    { nome: 'Local', valor: (l) => l.nome },
    { nome: 'UF', valor: (l) => l.uf?.toUpperCase() },
    { nome: 'Código TSE', valor: (l) => (nivel() === 'estados' ? '' : l.codigo) },
    { nome: 'Código IBGE', valor: (l) => l.ibge ?? '' },
    { nome: 'Região', valor: (l) => l.regiao },
    { nome: 'Votos', valor: (l) => l.total },
    { nome: '% seções totalizadas', valor: (l) => l.secoesPct },
    { nome: 'Brancos', valor: (l) => l.brancos },
    { nome: '% brancos', valor: (l) => l.pctBrancos },
    { nome: 'Nulos', valor: (l) => l.nulos },
    { nome: '% nulos', valor: (l) => l.pctNulos },
    { nome: 'Anulados', valor: (l) => l.anulados },
    { nome: '% anulados', valor: (l) => l.pctAnulados },
    { nome: '% brancos + nulos', valor: (l) => l.pctBrancosNulos },
    { nome: 'Abstenção', valor: (l) => l.abstencao ?? '' },
    { nome: '% abstenção', valor: (l) => valorMetrica(l, 'pctAbstencao') },
    { nome: `Referência ${METRICAS[metrica()].curto} (${NOME_REF[el.referencia.value]})`, valor: (l) => l.ref ?? '' },
    { nome: 'Δ p.p.', valor: (l) => l.delta ?? '' },
    { nome: 'z', valor: (l) => l.z },
    { nome: 'Atípico', valor: (l) => (l.atipico ? 'sim' : 'não') },
  ], v.visiveis);
});

// ---------- início ----------

/** Aplica ao formulário e ao estado os filtros guardados no link (#cargo=…&uf=…). */
function aplicarHash() {
  const inicial = lerHash();
  opcoes(el.cargo, CARGOS.map((c) => [c.valor, c.nome]), inicial.cargo ?? el.cargo.value);
  opcoes(el.metrica, Object.entries(METRICAS).map(([k, m]) => [k, m.nome]),
    inicial.metrica ?? (METRICAS[inicial.ordem] ? inicial.ordem : 'pctBrancosNulos'));
  preencherLocais(inicial.uf ?? '');
  preencherReferencias(inicial.ref);
  for (const [campo, chave, padrao] of [[el.porte, 'porte', ''], [el.apuracao, 'apur', '0'], [el.mostrar, 'mostrar', '']]) {
    campo.value = inicial[chave] && [...campo.options].some((o) => o.value === inicial[chave]) ? inicial[chave] : padrao;
  }
  // Link antigo "ordem=pctNulos" vira métrica Nulos ordenada pela própria métrica.
  estado.ordem = inicial.ordem && !METRICAS[inicial.ordem] ? inicial.ordem : 'metrica';
  estado.direcao = inicial.dir === 'asc' ? 1 : -1;
  estado.faixa = null;
  if (inicial.faixa) {
    const [a, b] = inicial.faixa.split('-').map(Number);
    if (Number.isFinite(a) && Number.isFinite(b)) estado.faixa = [a, b, 0];
  }
  estado.fixados = (inicial.sel ?? '').split(',').filter(Boolean).slice(0, MAX_COMPARAR);
}

aplicarHash();
carregar();
carregarCargos();
setInterval(() => { if (!document.hidden) carregar(); }, INTERVALO_MS);
setInterval(() => { if (!document.hidden) carregarCargos(); }, 120_000);
