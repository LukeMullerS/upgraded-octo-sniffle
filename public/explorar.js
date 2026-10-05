// Explorador de variáveis: junta, por local (estado ou cidade), os resultados de vários
// cargos, variáveis de território, séries do Censo/IBGE e colunas importadas de CSV, e
// cruza as que o usuário arrastar para os campos X, Y, grupo, tamanho e matriz.

import {
  CODIGO_IBGE_UF, UF_DO_CODIGO, CARGOS, PORTES, baixarCsv, cargoPorValor, carregarEstados, carregarMunicipios, criarDica, esc, fmtInt, fmtNum,
  nomeUf, pctSecoes, porteDe, regiaoDe, semAcento,
} from './comum.js';
import {
  METRICAS, anovaUmFator, correlacao, histograma, quantil, regressaoLinear, regressaoMultipla, resumoCaixa, spearman,
  testeCorrelacao, testeTWelch, valorMetrica,
} from './calculos.js';
import { svgBarras, svgBoxplot, svgDispersao, svgHistograma } from './graficos.js';
import { carregarMalha, criarMapa } from './mapa.js';

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries([
  'status', 'exportar', 'atualizar', 'erro', 'resumo-dados', 'nivel', 'apuracao', 'sem-exterior', 'cargos', 'presets',
  'tabela-sidra', 'buscar-sidra', 'sidra-form', 'csv', 'filtro-var', 'lista-var', 'limpar-zonas', 'titulo-grafico',
  'sub-grafico', 'grafico', 'legenda', 'resultados', 'descritivas', 'matriz-cartao', 'matriz', 'dica',
  'perguntas', 'sel-y', 'sel-x', 'sel-grupo', 'sel-tipo', 'explicativas-bloco', 'explicativas', 'dica-tipo',
  'resumo-texto', 'mapa-explorar', 'nota-mapa', 'tabela-dados', 'avancado',
].map((id) => [id.replace(/-(\w)/g, (_, l) => l.toUpperCase()), $(id)]));

const MAX_GRUPOS = 8; // paleta categórica: além disso, os menores viram "Outros"
const dica = criarDica(el.dica);

const estado = {
  cargos: ['6257:1'], // cargos carregados (valor)
  dados: new Map(), // valor do cargo → resposta da API
  censo: new Map(), // id → série {nome, unidade, municipios, ufs}
  importadas: new Map(), // id → {nome, valores: Map(chave → número)}
  logs: new Map(), // código do município (ou UF) → resumo dos logs das urnas
  zonas: { x: null, y: null, grupo: null, tamanho: null, matriz: [] },
  selecionada: null, // variável escolhida por toque (alternativa ao arrastar)
  tipo: 'auto', // tipo de análise escolhido
  aba: 'grafico', // aba do resultado: grafico | mapa | dados
  resumo: '', // frase "Em resumo" da análise atual
  pedido: 0,
  vista: null,
};

// ---------- carga ----------

const nivel = () => el.nivel.value;
const ufDe = (l) => (l.uf && nivel() !== 'estados' ? ` (${esc(l.uf.toUpperCase())})` : ''); // 'estados' | uf | 'todas'

function preencherNiveis(valor) {
  const ufs = CARGOS[0].abrangencias.filter((a) => a !== 'br' && a !== 'zz').sort((a, b) => nomeUf(a).localeCompare(nomeUf(b), 'pt-BR'));
  const lista = [['estados', 'Estados (27)'], ['todas', 'Cidades — Brasil inteiro'], ...ufs.map((u) => [u, `Cidades — ${nomeUf(u)}`])];
  el.nivel.innerHTML = lista.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  if (lista.some(([v]) => v === valor)) el.nivel.value = valor;
}

function preencherCargos() {
  el.cargos.innerHTML = CARGOS.map((c) => `<label class="check"><input type="checkbox" value="${c.valor}"
    ${estado.cargos.includes(c.valor) ? 'checked' : ''}> ${esc(c.nome)}</label>`).join('');
}

async function carregar() {
  const pedido = ++estado.pedido;
  el.status.textContent = 'consultando…';
  el.status.className = 'status';
  const n = nivel();
  const cargos = estado.cargos.map(cargoPorValor).filter((c) => c && (n === 'estados' || n === 'todas' || c.abrangencias.includes(n)));
  try {
    const respostas = await Promise.all(cargos.map((c, i) => (n === 'estados' ? carregarEstados(c, { fundo: i > 0 }) : carregarMunicipios(c, n))
      .then((d) => [c.valor, d]).catch((e) => [c.valor, { erro: e.message }])));
    if (pedido !== estado.pedido) return;
    estado.dados = new Map(respostas);
    estado.logs = await carregarLogs(n);
    if (pedido !== estado.pedido) return;
    const erros = respostas.filter(([, d]) => d.erro && !d.municipios && !d.estados).map(([v, d]) => `${cargoPorValor(v).nome}: ${d.erro}`);
    el.erro.hidden = !erros.length;
    el.erro.textContent = erros.join(' · ');
    renderizarTudo();
    el.status.textContent = `consultado às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
    if (respostas.some(([, d]) => d.pendentes)) setTimeout(() => pedido === estado.pedido && carregar(), 3_000);
    else if (respostas.some(([, d]) => d.lendo)) setTimeout(() => pedido === estado.pedido && carregar(), 5_000);
    const pend = respostas.reduce((t, [, d]) => t + (d.pendentes ?? 0), 0);
    if (pend) el.resumoDados.textContent += ` · carregando ${pend} arquivo(s) do TSE…`;
  } catch (erro) {
    el.erro.hidden = false;
    el.erro.textContent = `Não foi possível carregar: ${erro.message}`;
    el.status.textContent = 'falha na consulta';
    el.status.className = 'status falha';
  }
}

/** Resumos dos logs das urnas já compilados (tempo na cabine etc.), por UF ou por município. */
async function carregarLogs(n) {
  const mapa = new Map();
  try {
    if (n === 'estados') {
      for (const e of (await getJson('api/urnas/brasil')).estados) mapa.set(e.uf, e.resumo);
    } else {
      for (const m of (await getJson('api/urnas/municipios')).municipios) {
        if (n === 'todas' || m.uf === n) mapa.set(m.codigo, m.resumo);
      }
    }
  } catch {
    // sem logs lidos: o grupo de variáveis simplesmente não aparece
  }
  return mapa;
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const d = await res.json();
  if (!res.ok) throw new Error(d.erro || `HTTP ${res.status}`);
  return d;
}

async function adicionarCenso(url, rotulo, preset = null) {
  el.status.textContent = `baixando do IBGE: ${rotulo}…`;
  el.status.className = 'status';
  try {
    const s = { ...(await getJson(url)), preset };
    estado.censo.set(s.id, s);
    renderizarTudo();
    el.status.textContent = `${s.nome} carregado`;
    el.status.className = 'status ok';
    return s;
  } catch (erro) {
    el.erro.hidden = false;
    el.erro.textContent = `${rotulo}: ${erro.message}`;
    el.status.textContent = 'falha no IBGE';
    el.status.className = 'status falha';
    return null;
  }
}

async function carregarPresets() {
  try {
    const presets = await getJson('api/censo/presets');
    el.presets.innerHTML = presets.map((p) => `<button type="button" class="secundario sem-margem" data-preset="${esc(p.id)}">+ ${esc(p.nome)}</button>`).join('');
  } catch {
    el.presets.innerHTML = '<span class="mudo">Censo indisponível neste servidor.</span>';
  }
}

async function mostrarTabelaSidra() {
  const tabela = el.tabelaSidra.value.trim();
  if (!tabela) return;
  el.sidraForm.hidden = false;
  el.sidraForm.innerHTML = '<span class="mudo">Lendo metadados no IBGE…</span>';
  try {
    const m = await getJson(`api/censo/metadados?tabela=${encodeURIComponent(tabela)}`);
    if (!m.niveis.includes('N6') && !m.niveis.includes('N3')) throw new Error('essa tabela não tem dados por município nem por UF');
    el.sidraForm.innerHTML = `<p><strong>${esc(m.nome)}</strong></p>
      <div class="filtros filtros-painel embutido">
        <label>Variável<select name="variavel">${m.variaveis.map((v) => `<option value="${esc(v.id)}">${esc(v.nome)}${v.unidade ? ` (${esc(v.unidade)})` : ''}</option>`).join('')}</select></label>
        ${m.periodos.length > 1 ? `<label>Período<select name="periodo">${m.periodos.map((p) => `<option ${p === m.periodos.at(-1) ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>` : ''}
        ${m.classificacoes.map((c) => `<label>${esc(c.nome)}<select name="c${esc(c.id)}">${c.categorias.map((k) => `<option value="${esc(k.id)}" ${k.id === c.total ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select></label>`).join('')}
      </div>
      <button type="button" id="adicionar-sidra">Adicionar variável</button>
      <span class="mudo pequeno">${m.niveis.includes('N6') ? 'com dados por município' : 'só por UF'}</span>`;
    $('adicionar-sidra').addEventListener('click', async () => {
      const p = new URLSearchParams({ tabela });
      for (const s of el.sidraForm.querySelectorAll('select')) p.set(s.name, s.value);
      const nomeVar = el.sidraForm.querySelector('select[name="variavel"]').selectedOptions[0].textContent;
      await adicionarCenso(`api/censo/serie?${p}`, nomeVar);
    });
  } catch (erro) {
    el.sidraForm.innerHTML = `<span class="erro-texto">${esc(erro.message)}</span>`;
  }
}

// ---------- CSV importado ----------

function numeroBr(t) {
  const s = String(t ?? '').trim().replace(/\s|%/g, '');
  if (!s) return null;
  // "1.234,5" e "1.234" (milhar) em pt-BR; "1234.5" em formato internacional.
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

function lerCsv(texto) {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const sep = (linhas[0].match(/;/g) ?? []).length >= (linhas[0].match(/,/g) ?? []).length ? ';' : (linhas[0].includes('\t') ? '\t' : ',');
  const partir = (l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const cab = partir(linhas[0]);
  const corpo = linhas.slice(1).map(partir);
  return { cab, corpo };
}

async function importarCsv(arquivo) {
  const { cab, corpo } = lerCsv(await arquivo.text());
  if (cab.length < 2 || !corpo.length) throw new Error('o CSV precisa de cabeçalho, uma coluna de local e ao menos uma coluna de valores');
  let novas = 0;
  for (let j = 1; j < cab.length; j += 1) {
    const valores = new Map();
    for (const linha of corpo) {
      const v = numeroBr(linha[j]);
      if (v !== null && linha[0]) valores.set(semAcento(linha[0]), v);
    }
    if (valores.size) {
      const id = `csv:${arquivo.name}:${j}`;
      estado.importadas.set(id, { nome: cab[j] || `Coluna ${j}`, arquivo: arquivo.name, valores });
      novas += 1;
    }
  }
  if (!novas) throw new Error('nenhuma coluna numérica encontrada');
  return novas;
}

/** Valor importado para um local: tenta código IBGE, código TSE, sigla da UF, nome e "nome - UF". */
function valorImportado(imp, l) {
  const chaves = [l.ibge, l.codigo, l.uf, semAcento(l.nome), `${semAcento(l.nome)} - ${l.uf}`, `${semAcento(l.nome)}/${l.uf}`];
  for (const k of chaves) {
    if (k && imp.valores.has(semAcento(k))) return imp.valores.get(semAcento(k));
  }
  return null;
}

// ---------- linhas e variáveis ----------

/** Uma linha por local, com o resumo de cada cargo carregado. */
function montarLinhas() {
  const n = nivel();
  const porId = new Map();
  for (const [valor, d] of estado.dados) {
    const lista = n === 'estados' ? d.estados ?? [] : d.municipios ?? [];
    for (const r of lista) {
      const id = n === 'estados' ? r.uf : r.codigo;
      if (!porId.has(id)) porId.set(id, { id, nome: r.nome, uf: r.uf, ibge: r.ibge ?? null, codigo: r.codigo ?? null, cargos: {} });
      porId.get(id).cargos[valor] = r;
    }
  }
  const apur = Number(el.apuracao.value);
  const principal = estado.cargos.find((v) => estado.dados.has(v));
  return [...porId.values()].filter((l) => {
    if (el.semExterior.checked && l.uf === 'zz') return false;
    const r = l.cargos[principal];
    return !r || pctSecoes(r) >= apur;
  });
}

const PCT = { unidade: '%' };

/** Catálogo de variáveis disponíveis: {id, nome, grupo, tipo: 'num'|'cat', unidade?, valor(linha)}. */
function montarVariaveis() {
  const vars = [];
  for (const valor of estado.cargos) {
    if (!estado.dados.has(valor)) continue;
    const c = cargoPorValor(valor);
    const r = (l) => l.cargos[valor];
    const grupo = `Eleição · ${c.nome}`;
    for (const [k, m] of Object.entries(METRICAS)) {
      vars.push({ id: `${valor}:${k}`, nome: `${c.curto} · % ${m.nome.toLowerCase()}`, grupo, tipo: 'num', ...PCT,
        valor: (l) => (r(l) && m.denominador(r(l)) > 0 ? valorMetrica(r(l), k) : null) });
    }
    // Candidatos e partidos: votação de cada um (% dos válidos), vencedor, margem e fragmentação.
    const d = estado.dados.get(valor);
    const nomes = d.nomes ?? {};
    const consolidado = d.brasil ?? d.consolidado ?? {};
    const propor = [6, 7, 8].includes(Number(c.codigo)) || (consolidado.candidatos ?? 0) > 30;
    const nomeCand = (n) => (nomes[n] ? `${nomes[n][0]} (${nomes[n][1]})` : `nº ${n}`);
    const pctV = (parte, rr) => (rr?.validos ? (parte / rr.validos) * 100 : null);
    const ordenar = (m) => Object.entries(m ?? {}).sort((a, b) => b[1] - a[1]);
    const gc = `Candidatos · ${c.nome}`;
    vars.push(
      { id: `${valor}:vencedor`, nome: `${c.curto} · candidato mais votado`, grupo: gc, tipo: 'cat',
        valor: (l) => { const [p] = ordenar(r(l)?.cand); return p ? nomeCand(p[0]) : null; } },
      { id: `${valor}:partidoVencedor`, nome: `${c.curto} · partido mais votado`, grupo: gc, tipo: 'cat',
        valor: (l) => { const [p] = ordenar(r(l)?.par); return p ? p[0] : null; } },
      { id: `${valor}:margem`, nome: `${c.curto} · margem do 1º sobre o 2º (p.p.)`, grupo: gc, tipo: 'num',
        valor: (l) => { const [p, q] = ordenar(r(l)?.cand); return p ? pctV(p[1] - (q?.[1] ?? 0), r(l)) : null; } },
      { id: `${valor}:efetivo`, nome: `${c.curto} · nº efetivo de ${propor ? 'partidos' : 'candidatos'}`, grupo: gc, tipo: 'num',
        valor: (l) => (propor ? r(l)?.efetivoPar : r(l)?.efetivoCand) ?? null },
    );
    ordenar(consolidado.cand).slice(0, propor ? 10 : 15).forEach(([n], i) => {
      // Apelidos "lider" e "segundo": as perguntas prontas valem para qualquer resultado.
      vars.push({ id: `${valor}:c${n}`, apelido: i < 2 ? `${valor}:${i ? 'segundo' : 'lider'}` : null, nome: `${c.curto} · ${nomeCand(n)} (% válidos)`, grupo: gc, tipo: 'num', ...PCT,
        valor: (l) => { const rr = r(l); if (!rr?.validos) return null; const v = rr.cand?.[n]; return v === undefined ? (propor ? null : 0) : pctV(v, rr); } });
    });
    for (const [sg] of ordenar(consolidado.par).slice(0, 12)) {
      vars.push({ id: `${valor}:p${sg}`, nome: `${c.curto} · partido ${sg} (% válidos)`, grupo: gc, tipo: 'num', ...PCT,
        valor: (l) => (r(l)?.validos ? pctV(r(l).par?.[sg] ?? 0, r(l)) : null) });
    }
    vars.push(
      { id: `${valor}:votos`, nome: `${c.curto} · votos`, grupo, tipo: 'num', valor: (l) => r(l)?.total ?? null },
      { id: `${valor}:eleitorado`, nome: `${c.curto} · eleitorado`, grupo, tipo: 'num', valor: (l) => r(l)?.eleitorado ?? null },
      { id: `${valor}:secoes`, nome: `${c.curto} · % seções apuradas`, grupo, tipo: 'num', ...PCT, valor: (l) => (r(l) ? pctSecoes(r(l)) : null) },
    );
  }
  const principal = estado.cargos.find((v) => estado.dados.has(v));
  vars.push(
    { id: 'terr:uf', nome: 'UF', grupo: 'Território', tipo: 'cat', valor: (l) => l.uf?.toUpperCase() ?? null },
    { id: 'terr:regiao', nome: 'Região', grupo: 'Território', tipo: 'cat', valor: (l) => regiaoDe(l.uf) },
  );
  if (nivel() !== 'estados') {
    vars.push({ id: 'terr:porte', nome: 'Porte (votos)', grupo: 'Território', tipo: 'cat', ordem: PORTES.map((p) => p[2]),
      valor: (l) => (l.cargos[principal] ? porteDe(l.cargos[principal].total) : null) });
    vars.push({ id: 'terr:capital', nome: 'Capital?', grupo: 'Território', tipo: 'cat', valor: (l) => (CAPITAIS.has(semAcento(`${l.nome}/${l.uf}`)) ? 'Capital' : 'Interior') });
  }
  for (const [id, s] of estado.censo) {
    const porNivel = nivel() === 'estados';
    vars.push({ id: `censo:${id}`, apelido: s.preset ? `censo:${s.preset}` : null, nome: s.nome, detalhe: [s.periodo, ...(s.categorias ?? []).filter((t) => !/total/i.test(t))].filter(Boolean).join(' · '),
      grupo: 'Censo / IBGE', tipo: 'num', unidade: s.unidade,
      valor: (l) => (porNivel ? s.ufs[l.uf] : s.municipios[l.ibge]) ?? null });
  }
  if (estado.logs.size) {
    const r = (l) => estado.logs.get(nivel() === 'estados' ? l.uf : l.codigo);
    const g = 'Logs das urnas';
    vars.push(
      { id: 'logs:cabine', nome: 'Tempo médio na cabine (s)', grupo: g, tipo: 'num', valor: (l) => r(l)?.cabine.media ?? null },
      { id: 'logs:mediana', nome: 'Mediana do tempo na cabine (s)', grupo: g, tipo: 'num', valor: (l) => r(l)?.cabine.mediana ?? null },
      { id: 'logs:atendimento', nome: 'Tempo médio de atendimento (s)', grupo: g, tipo: 'num', valor: (l) => r(l)?.atendimento.media ?? null },
      { id: 'logs:habilitacao', nome: 'Tempo médio de habilitação/biometria (s)', grupo: g, tipo: 'num', valor: (l) => r(l)?.habilitacao.media ?? null },
      { id: 'logs:biometria', nome: '% habilitação biométrica', grupo: g, tipo: 'num', unidade: '%', valor: (l) => r(l)?.pctBiometrica ?? null },
      { id: 'logs:sembio', nome: '% eleitores sem biometria', grupo: g, tipo: 'num', unidade: '%', valor: (l) => r(l)?.pctSemBiometria ?? null },
      { id: 'logs:teclas', nome: 'Teclas indevidas por eleitor', grupo: g, tipo: 'num', valor: (l) => r(l)?.teclasPorEleitor ?? null },
      { id: 'logs:secoes', nome: 'Seções com log lido', grupo: g, tipo: 'num', valor: (l) => r(l)?.secoes ?? null },
    );
  }
  for (const [id, imp] of estado.importadas) {
    vars.push({ id, nome: imp.nome, detalhe: imp.arquivo, grupo: 'Importadas (CSV)', tipo: 'num', valor: (l) => valorImportado(imp, l) });
  }
  return vars;
}

const CAPITAIS = new Set([
  'rio branco/ac', 'maceio/al', 'macapa/ap', 'manaus/am', 'salvador/ba', 'fortaleza/ce', 'brasilia/df', 'vitoria/es',
  'goiania/go', 'sao luis/ma', 'cuiaba/mt', 'campo grande/ms', 'belo horizonte/mg', 'belem/pa', 'joao pessoa/pb',
  'curitiba/pr', 'recife/pe', 'teresina/pi', 'rio de janeiro/rj', 'natal/rn', 'porto alegre/rs', 'porto velho/ro',
  'boa vista/rr', 'florianopolis/sc', 'sao paulo/sp', 'aracaju/se', 'palmas/to',
]);

// ---------- análise ----------

const fmtValor = (v, variavel) => (v === null || v === undefined ? '—' : `${fmtNum.format(v)}${variavel?.unidade === '%' ? '%' : ''}`);
const fmt3 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const fmtSig = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: 3 });
// Coeficientes podem ser muito pequenos (ex.: densidade em hab/km²): 3 algarismos significativos.
const fmtCoef = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? fmtNum.format(v) : fmtSig.format(v));
const fmtP = (p) => (p === null || p === undefined ? '—' : p < 0.001 ? '< 0,001' : fmt3.format(p));
const textoP = (p) => (p < 0.001 ? 'p < 0,001' : `p = ${fmtP(p)}`);
const fmtR = (r) => r.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const estrelas = (p) => (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '');

/** Variável numérica no campo "Grupo" vira quartis. */
function categorizador(variavel, linhas) {
  if (!variavel) return null;
  if (variavel.tipo === 'cat') return (l) => variavel.valor(l);
  const vals = linhas.map(variavel.valor).filter((v) => v !== null);
  const q = [0.25, 0.5, 0.75].map((p) => quantil(vals, p));
  const rot = [`Q1 (até ${fmtNum.format(q[0])})`, `Q2 (até ${fmtNum.format(q[1])})`, `Q3 (até ${fmtNum.format(q[2])})`, `Q4 (acima de ${fmtNum.format(q[2])})`];
  return (l) => {
    const v = variavel.valor(l);
    if (v === null) return null;
    return rot[v <= q[0] ? 0 : v <= q[1] ? 1 : v <= q[2] ? 2 : 3];
  };
}

/** Ordena e limita os grupos: até MAX_GRUPOS − 1 maiores + "Outros". */
function organizarGrupos(valores, variavel) {
  const contagem = new Map();
  for (const v of valores) if (v !== null) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  let nomes = [...contagem.keys()];
  if (variavel?.ordem) nomes.sort((a, b) => variavel.ordem.indexOf(a) - variavel.ordem.indexOf(b));
  else if (variavel?.tipo === 'num') nomes.sort();
  else nomes.sort((a, b) => contagem.get(b) - contagem.get(a) || String(a).localeCompare(String(b), 'pt-BR'));
  if (nomes.length <= MAX_GRUPOS) return { nomes, mapa: (v) => v };
  const manter = new Set(nomes.slice(0, MAX_GRUPOS - 1));
  return { nomes: [...manter, 'Outros'], mapa: (v) => (v === null ? null : manter.has(v) ? v : 'Outros') };
}

// Largura real da área do gráfico, para o texto do SVG não ficar ampliado ou miúdo.
const largura = () => Math.max(340, Math.min(1000, el.grafico.clientWidth || 560));

const corGrupo = (i) => `var(--cat-${(i % MAX_GRUPOS) + 1})`;

function analisar() {
  const linhas = montarLinhas();
  const vars = montarVariaveis();
  const porId = new Map(vars.map((v) => [v.id, v]));
  for (const v of vars) if (v.apelido) porId.set(v.apelido, v); // perguntas prontas usam o apelido
  // Variáveis ainda não disponíveis (série do Censo baixando, cargo desmarcado) ficam guardadas
  // nos campos, mas fora da análise até existirem.
  const z = Object.fromEntries(['x', 'y', 'grupo', 'tamanho'].map((k) => [k, porId.get(estado.zonas[k]) ?? null]));
  z.matriz = estado.zonas.matriz.map((id) => porId.get(id)).filter(Boolean);
  estado.vista = { linhas, vars, porId, z };
  return estado.vista;
}

function renderizarTudo() {
  const v = analisar();
  el.resumoDados.textContent = `${fmtInt.format(v.linhas.length)} ${nivel() === 'estados' ? 'estados' : 'cidades'} · ${v.vars.length} variáveis`;
  renderizarSeletores(v);
  renderizarVariaveis(v);
  renderizarZonas(v);
  estado.resumo = '';
  renderizarAnalise(v);
  el.resumoTexto.innerHTML = estado.resumo ? `<strong>Em resumo:</strong> ${estado.resumo}` : '';
  el.resumoTexto.hidden = !estado.resumo;
  renderizarDados(v);
  if (estado.aba === 'mapa') renderizarMapa(v);
  renderizarDescritivas(v);
  renderizarMatriz(v);
  gravarHash();
}

// ---------- seletores simples ("quero entender… comparando com…") ----------

function opcoesVariaveis(vars, filtro, vazio) {
  const grupos = new Map();
  for (const v of vars) {
    if (!filtro(v)) continue;
    if (!grupos.has(v.grupo)) grupos.set(v.grupo, []);
    grupos.get(v.grupo).push(v);
  }
  return `<option value="">${esc(vazio)}</option>${[...grupos].map(([g, lista]) => `<optgroup label="${esc(g)}">${lista.map((v) => `<option value="${esc(v.id)}">${esc(v.nome)}</option>`).join('')}</optgroup>`).join('')}`;
}

function renderizarSeletores({ vars, z }) {
  el.selY.innerHTML = opcoesVariaveis(vars, () => true, '— escolha uma variável —');
  el.selX.innerHTML = opcoesVariaveis(vars, () => true, '(nada)');
  el.selGrupo.innerHTML = opcoesVariaveis(vars, () => true, '(não separar)');
  el.selY.value = z.y?.id ?? '';
  el.selX.value = z.x?.id ?? '';
  el.selGrupo.value = z.grupo?.id ?? '';
  el.selTipo.value = estado.tipo;
  const regressao = estado.tipo === 'regressao';
  el.explicativasBloco.hidden = !regressao;
  if (regressao) {
    el.explicativas.innerHTML = vars.filter((v) => v.tipo === 'num' && v.id !== z.y?.id).map((v) => `<label class="check"><input type="checkbox" value="${esc(v.id)}"
      ${z.matriz.some((m) => m.id === v.id) ? 'checked' : ''}> ${esc(v.nome)}</label>`).join('');
  }
  el.dicaTipo.textContent = {
    auto: 'Automático: uma variável → mapa e distribuição; duas numéricas → correlação; uma categórica e uma numérica → comparação de grupos.',
    mapa: 'O mapa colore cada local pela variável "quero entender".',
    dispersao: 'Mostra se as duas variáveis sobem ou descem juntas (correlações de Pearson e de Spearman).',
    grupos: 'Compara "quero entender" entre os grupos de "separando por" (ou de "comparando com", se for categórica).',
    testet: 'Compara a média de dois grupos (o separador precisa ter dois grupos, como Capital × Interior).',
    regressao: 'Mede quanto cada variável explicativa pesa em "quero entender", descontando as outras.',
    ranking: 'Os 15 maiores e os 15 menores valores de "quero entender".',
    distribuicao: 'Como os valores se espalham entre os locais.',
  }[estado.tipo] ?? '';
}

function renderizarDados({ linhas, z }) {
  const cols = [z.y, z.x, z.grupo, z.tamanho, ...z.matriz].filter((v, i, a) => v && a.indexOf(v) === i);
  const ord = z.y ? [...linhas].sort((a, b) => (z.y.valor(b) ?? -Infinity) - (z.y.valor(a) ?? -Infinity)) : linhas;
  el.tabelaDados.innerHTML = `<thead><tr><th>Local</th><th>UF</th>${cols.map((c) => `<th class="num">${esc(c.nome)}</th>`).join('')}</tr></thead>
    <tbody>${ord.slice(0, 500).map((l) => `<tr><td>${esc(l.nome)}</td><td>${esc(l.uf?.toUpperCase() ?? '')}</td>${cols.map((c) => `<td class="num">${c.tipo === 'num' ? fmtValor(c.valor(l), c) : esc(c.valor(l) ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>`
    + (ord.length > 500 ? `<tfoot><tr><td colspan="${cols.length + 2}" class="mudo">Mostrando 500 de ${fmtInt.format(ord.length)} locais; use "Exportar CSV" para todos.</td></tr></tfoot>` : '');
}

// ---------- mapa ----------

const mapa = criarMapa(el.mapaExplorar, {
  dica,
  aoClicar: (cod) => {
    if (nivel() === 'estados' && UF_DO_CODIGO[cod]) {
      el.nivel.value = UF_DO_CODIGO[cod];
      carregar();
    }
  },
});

let pedidoMapa = 0;
async function renderizarMapa({ linhas, z }) {
  const v = z.y ?? z.x;
  const pedido = ++pedidoMapa;
  if (!v) {
    el.mapaExplorar.querySelector('.mapa-area').innerHTML = '<p class="mudo">Escolha uma variável em "quero entender" para ver o mapa.</p>';
    el.notaMapa.textContent = '';
    return;
  }
  const n = nivel();
  let geo;
  try {
    geo = await carregarMalha(n === 'estados' ? undefined : n === 'todas' ? 'todas' : n);
  } catch (erro) {
    if (pedido === pedidoMapa) el.mapaExplorar.querySelector('.mapa-area').innerHTML = `<p class="mudo">Mapa indisponível: ${esc(erro.message)}</p>`;
    return;
  }
  if (pedido !== pedidoMapa) return;
  const valores = new Map();
  const rotulos = new Map();
  const categorias = v.tipo === 'cat' ? new Map() : null;
  for (const l of linhas) {
    const cod = n === 'estados' ? CODIGO_IBGE_UF[l.uf] : l.ibge;
    const x = v.valor(l);
    if (!cod || x === null || x === undefined) continue;
    if (categorias) categorias.set(cod, String(x)); else valores.set(cod, x);
    rotulos.set(cod, n === 'estados' ? l.nome : `${l.nome} · ${l.uf?.toUpperCase()}`);
  }
  mapa.desenhar({ geo, valores, rotulos, titulo: v.nome, formato: (x) => fmtValor(x, v), categorias });
  el.notaMapa.textContent = n === 'estados' ? 'Clique num estado para ver as cidades dele.' : 'Role para aproximar; arraste para mover.';
}

function chipVar(variavel, extra = '') {
  return `<span class="var-chip var-${variavel.tipo}${estado.selecionada === variavel.id ? ' selecionada' : ''}" draggable="true" data-var="${esc(variavel.id)}" title="${esc(variavel.detalhe ?? variavel.nome)}">
    <i class="var-tipo" aria-hidden="true">${variavel.tipo === 'num' ? '123' : 'abc'}</i>${esc(variavel.nome)}${extra}</span>`;
}

function renderizarVariaveis({ vars }) {
  const termo = semAcento(el.filtroVar.value.trim());
  const grupos = new Map();
  for (const v of vars) {
    if (termo && !semAcento(`${v.nome} ${v.grupo}`).includes(termo)) continue;
    if (!grupos.has(v.grupo)) grupos.set(v.grupo, []);
    grupos.get(v.grupo).push(v);
  }
  el.listaVar.innerHTML = [...grupos].map(([g, lista]) => `<details open><summary>${esc(g)} <span class="mudo">(${lista.length})</span></summary>
    <div class="var-lista">${lista.map((v) => chipVar(v)).join('')}</div></details>`).join('') || '<p class="mudo">Nenhuma variável.</p>';
}

function renderizarZonas({ z }) {
  for (const zona of document.querySelectorAll('.zona')) {
    const nome = zona.dataset.zona;
    const itens = nome === 'matriz' ? z.matriz : z[nome] ? [z[nome]] : [];
    zona.querySelector('.zona-itens').innerHTML = itens.length
      ? itens.map((v) => chipVar(v, ` <button type="button" class="tirar" data-tirar="${nome}" data-var="${esc(v.id)}" aria-label="Remover">×</button>`)).join('')
      : `<span class="mudo pequeno">${estado.selecionada ? 'toque para colocar aqui' : 'solte uma variável aqui'}</span>`;
    zona.classList.toggle('alvo-toque', Boolean(estado.selecionada));
  }
}

function tabelaHtml(cabecalho, linhas) {
  return `<div class="tabela-rolagem"><table class="tabela"><thead><tr>${cabecalho.map((c, i) => `<th${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead>
    <tbody>${linhas.map((l) => `<tr>${l.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderizarAnalise({ linhas, z }) {
  let { x, y } = z;
  const { grupo, tamanho } = z;
  el.legenda.innerHTML = '';
  estado.pontos = null;
  estado.itensGrafico = null;
  const cat = categorizador(grupo, linhas);

  // Tipos escolhidos explicitamente.
  const tipo = estado.tipo;
  if (tipo === 'regressao') return analiseRegressao(linhas, y, z.matriz);
  if (tipo === 'ranking' && y) return analiseRanking(linhas, y);
  if (tipo === 'testet' && y) return analiseTesteT(linhas, y, grupo ?? (x?.tipo === 'cat' ? x : null));
  if (tipo === 'mapa' && (y ?? x)) {
    mostrarAba('mapa');
    const v = y ?? x;
    return v.tipo === 'cat' ? analiseUmaCategorica(linhas, v) : analiseUmaNumerica(linhas, v, null, null);
  }
  if (tipo === 'distribuicao' && (y ?? x)) return analiseUmaNumerica(linhas, y ?? x, grupo, cat);
  if (tipo === 'grupos' && y) {
    const fator = grupo ?? (x?.tipo === 'cat' ? x : null);
    if (fator) return analiseGrupos(linhas, fator, y);
  }

  // Categórica no Y e numérica no X: troca, para o boxplot ficar sempre "valor por grupo".
  if (x?.tipo === 'num' && y?.tipo === 'cat') [x, y] = [y, x];
  if (!x && !y) {
    el.tituloGrafico.textContent = 'Resultado';
    el.subGrafico.textContent = '';
    el.grafico.innerHTML = '<p class="mudo">Escolha uma pergunta pronta acima, ou diga o que você quer entender em "Monte sua análise".</p>';
    el.resultados.innerHTML = '<p class="mudo">—</p>';
    return;
  }
  const unica = x && y ? null : x ?? y;
  // Só uma variável numérica e unidade com mapa: o mapa é a visão mais intuitiva.
  if (unica?.tipo === 'num' && tipo === 'auto' && !grupo && estado.abaAuto !== false) mostrarAba('mapa');

  if (unica?.tipo === 'num') return analiseUmaNumerica(linhas, unica, grupo, cat);
  if (unica?.tipo === 'cat') return analiseUmaCategorica(linhas, unica);
  if (x.tipo === 'num' && y.tipo === 'num') return analiseDispersao(linhas, x, y, grupo, cat, tamanho);
  if (x.tipo === 'cat' && y.tipo === 'num') return analiseGrupos(linhas, x, y);
  return analiseContingencia(linhas, x, y);
}

function analiseUmaNumerica(linhas, v, grupo, cat) {
  const validas = linhas.filter((l) => v.valor(l) !== null);
  const vals = validas.map(v.valor);
  el.tituloGrafico.textContent = `${estado.tipo === 'mapa' ? 'Mapa' : 'Distribuição'} · ${v.nome}`;
  el.subGrafico.textContent = `${fmtInt.format(vals.length)} locais`;
  if (grupo) {
    const { nomes, mapa } = organizarGrupos(validas.map(cat), grupo);
    const grupos = nomes.map((nome) => ({ nome, vals: validas.filter((l) => mapa(cat(l)) === nome).map(v.valor) }));
    const caixas = grupos.map((g) => ({ nome: g.nome, ...resumoCaixa(g.vals) })).filter((g) => g.n);
    estado.itensGrafico = caixas.map((c) => ({ titulo: c.nome, linhas: [`n ${c.n}`, `mediana ${fmtValor(c.mediana, v)}`, `média ${fmtValor(c.media, v)}`] }));
    el.grafico.innerHTML = svgBoxplot({ grupos: caixas, rotuloX: v.nome, largura: largura() });
    const an = anovaUmFator(grupos.map((g) => g.vals));
    el.resultados.innerHTML = resultadoAnova(an, grupo, v) + tabelaGrupos(caixas, v);
    return;
  }
  const h = histograma(vals, vals.length > 200 ? 24 : 14);
  estado.itensGrafico = h.faixas.map((f) => ({ titulo: `${fmtNum.format(f.inicio)} a ${fmtNum.format(f.fim)}`, linhas: [`${fmtInt.format(f.contagem)} locais`] }));
  const c = resumoCaixa(vals);
  el.grafico.innerHTML = svgHistograma({ faixas: h.faixas, rotuloX: v.nome, cor: 'var(--cat-1)', largura: largura(), altura: 280,
    linhas: c ? [{ valor: c.mediana, classe: 'ref-mediana', rotulo: 'mediana' }, { valor: c.media, classe: 'ref-principal', rotulo: 'média' }] : [] });
  el.legenda.innerHTML = '<span><i class="marca-ref"></i>Média</span><span><i class="marca-ref mediana"></i>Mediana</span>';
  el.resultados.innerHTML = '<p class="mudo">Escolha algo em "comparando com" para cruzar, ou em "separando por" para comparar grupos.</p>';
  if (c) {
    const ord = [...validas].sort((a, b) => v.valor(b) - v.valor(a));
    estado.resumo = `${esc(v.nome)} vai de ${fmtValor(c.q1 === undefined ? Math.min(...vals) : Math.min(...vals), v)} a ${fmtValor(Math.max(...vals), v)} entre ${fmtInt.format(vals.length)} locais; a mediana é ${fmtValor(c.mediana, v)}. O maior valor está em <strong>${esc(ord[0].nome)}</strong>${ufDe(ord[0])} e o menor em <strong>${esc(ord.at(-1).nome)}</strong>${ufDe(ord.at(-1))}.`;
  }
}

function analiseUmaCategorica(linhas, v) {
  const { nomes, mapa } = organizarGrupos(linhas.map(v.valor), v);
  const itens = nomes.map((nome) => ({ nome, valor: linhas.filter((l) => mapa(v.valor(l)) === nome).length }));
  el.tituloGrafico.textContent = `${estado.tipo === 'mapa' ? 'Mapa' : 'Contagem'} · ${v.nome}`;
  el.subGrafico.textContent = '';
  estado.itensGrafico = itens.map((i) => ({ titulo: i.nome, linhas: [`${fmtInt.format(i.valor)} locais`] }));
  el.grafico.innerHTML = svgBarras({ itens, rotuloX: 'nº de locais', cor: 'var(--cat-1)', fmtValor: fmtInt.format, largura: largura() });
  el.resultados.innerHTML = '<p class="mudo">Coloque uma variável numérica no Eixo Y para comparar os grupos (boxplot + ANOVA).</p>';
  const total = itens.reduce((t, i) => t + i.valor, 0);
  const ord = [...itens].sort((a, b) => b.valor - a.valor);
  if (total && ord.length) {
    estado.resumo = `<strong>${esc(ord[0].nome)}</strong> aparece em ${fmtInt.format(ord[0].valor)} de ${fmtInt.format(total)} locais (${fmtNum.format((ord[0].valor / total) * 100)}%)`
      + (ord[1] ? `; em seguida, ${esc(ord[1].nome)}, com ${fmtInt.format(ord[1].valor)}.` : '.');
  }
}

function analiseDispersao(linhas, x, y, grupo, cat, tamanho) {
  const validas = linhas.filter((l) => x.valor(l) !== null && y.valor(l) !== null);
  const xs = validas.map(x.valor);
  const ys = validas.map(y.valor);
  const { nomes, mapa } = grupo ? organizarGrupos(validas.map(cat), grupo) : { nomes: [], mapa: () => null };
  const tams = tamanho ? validas.map((l) => tamanho.valor(l) ?? 0) : null;
  const maxT = tams ? Math.max(1e-9, ...tams.map(Math.abs)) : 1;
  const raioBase = validas.length > 500 ? 2.5 : validas.length > 100 ? 3.5 : 5;
  estado.pontos = validas;
  const pontos = validas.map((l, i) => {
    const g = grupo ? nomes.indexOf(mapa(cat(l))) : -1;
    return {
      x: xs[i], y: ys[i],
      r: tams ? 2 + Math.sqrt(Math.abs(tams[i]) / maxT) * (validas.length > 300 ? 9 : 16) : raioBase,
      cor: g >= 0 ? corGrupo(g) : grupo ? 'var(--div-neutro)' : 'var(--cat-1)',
    };
  });
  const reg = regressaoLinear(xs, ys);
  el.tituloGrafico.textContent = `${y.nome} × ${x.nome}`;
  el.subGrafico.textContent = `${fmtInt.format(validas.length)} locais${linhas.length > validas.length ? ` (${fmtInt.format(linhas.length - validas.length)} sem dado)` : ''}`;
  el.grafico.innerHTML = svgDispersao({ pontos, rotuloX: x.nome, rotuloY: y.nome, regressao: reg, largura: largura(), altura: Math.round(largura() * 0.55) });
  el.legenda.innerHTML = (grupo ? nomes.map((n, i) => `<span><i class="amostra" style="background:${corGrupo(i)};border-radius:50%"></i>${esc(n)}</span>`).join('') : '')
    + '<span><i class="marca-regressao"></i>Regressão linear</span>' + (tamanho ? `<span class="mudo">tamanho = ${esc(tamanho.nome)}</span>` : '');
  estado.dispersao = { x, y, tamanho };

  const t = reg ? testeCorrelacao(reg.r, reg.n) : null;
  const rho = spearman(xs, ys);
  if (reg) {
    const sentido = reg.r > 0 ? 'quanto maior' : 'quanto maior';
    estado.resumo = Math.abs(reg.r) < 0.1 || t.p >= 0.05
      ? `Não há relação clara entre ${esc(x.nome)} e ${esc(y.nome)} (r = ${fmtR(reg.r)}${t.p >= 0.05 ? ', não significativo' : ''}).`
      : `${forcaCorrelacao(reg.r).replace(/\.$/, '')}: ${sentido} ${esc(x.nome)}, ${reg.r > 0 ? 'maior' : 'menor'} tende a ser ${esc(y.nome)} (r = ${fmtR(reg.r)}, ${textoP(t.p)}). Cada +1 em ${esc(x.nome)} corresponde, em média, a ${reg.b >= 0 ? '+' : '−'}${fmtNum.format(Math.abs(reg.b))} em ${esc(y.nome)}.`;
  }
  let html = reg
    ? `<p class="resultado-destaque">r de Pearson = <strong>${fmtR(reg.r)}</strong>${estrelas(t.p)} · R² = ${fmtR(reg.r2)} · ${textoP(t.p)} · n = ${fmtInt.format(reg.n)}</p>
       ${tabelaHtml(['Modelo', 'Coeficiente', 'Interpretação'], [
    ['Intercepto', fmtNum.format(reg.a), `valor previsto de ${esc(y.nome)} quando ${esc(x.nome)} = 0`],
    [`Inclinação (${esc(x.nome)})`, fmtNum.format(reg.b), `cada +1 em ${esc(x.nome)} muda ${esc(y.nome)} em ${fmtNum.format(reg.b)}`],
  ])}
       <p class="mudo pequeno">${forcaCorrelacao(reg.r)} t(${t.gl}) = ${fmtNum.format(t.t)}. Spearman ρ = ${rho === null ? '—' : fmtR(rho)} (usa a ordem dos valores; menos sensível a extremos). Associação entre locais, não entre eleitores.</p>`
    : '<p class="mudo">Dados insuficientes para regressão (são precisos ao menos 3 locais com valores diferentes).</p>';
  if (grupo && nomes.length) {
    html += `<h3>Por grupo (${esc(grupo.nome)})</h3>` + tabelaHtml(['Grupo', 'n', 'r', 'p', 'Inclinação'], nomes.map((nome, i) => {
      const sel = validas.map((l, j) => j).filter((j) => mapa(cat(validas[j])) === nome);
      const rg = regressaoLinear(sel.map((j) => xs[j]), sel.map((j) => ys[j]));
      const tg = rg ? testeCorrelacao(rg.r, rg.n) : null;
      return [`<i class="amostra" style="background:${corGrupo(i)};border-radius:50%"></i> ${esc(nome)}`, fmtInt.format(sel.length),
        rg ? `${fmtR(rg.r)}${estrelas(tg.p)}` : '—', tg ? fmtP(tg.p) : '—', rg ? fmtNum.format(rg.b) : '—'];
    }));
  }
  el.resultados.innerHTML = html;
}

function forcaCorrelacao(r) {
  const a = Math.abs(r);
  const forca = a < 0.1 ? 'Praticamente nenhuma' : a < 0.3 ? 'Fraca' : a < 0.5 ? 'Moderada' : a < 0.7 ? 'Forte' : 'Muito forte';
  return `${forca} associação ${a < 0.1 ? '' : r > 0 ? 'positiva (as duas sobem juntas).' : 'negativa (uma sobe, a outra desce).'}`;
}

function analiseGrupos(linhas, x, y) {
  const validas = linhas.filter((l) => x.valor(l) !== null && y.valor(l) !== null);
  const { nomes, mapa } = organizarGrupos(validas.map(x.valor), x);
  const grupos = nomes.map((nome) => ({ nome, vals: validas.filter((l) => mapa(x.valor(l)) === nome).map(y.valor) }));
  const caixas = grupos.map((g) => ({ nome: g.nome, ...resumoCaixa(g.vals) })).filter((g) => g.n);
  el.tituloGrafico.textContent = `${y.nome} por ${x.nome}`;
  el.subGrafico.textContent = `${fmtInt.format(validas.length)} locais`;
  estado.itensGrafico = caixas.map((c) => ({ titulo: c.nome, linhas: [`n ${c.n}`, `mediana ${fmtValor(c.mediana, y)}`, `média ${fmtValor(c.media, y)}`, `Q1–Q3 ${fmtValor(c.q1, y)} – ${fmtValor(c.q3, y)}`] }));
  const geral = resumoCaixa(validas.map(y.valor));
  el.grafico.innerHTML = svgBoxplot({ grupos: caixas, rotuloX: y.nome, linhaRef: geral?.media, largura: largura() });
  el.legenda.innerHTML = '<span><i class="amostra" style="background:color-mix(in srgb, var(--serie-bn) 30%, var(--cartao));border:1px solid var(--serie-bn)"></i>Q1–Q3</span><span>│ mediana</span><span>○ média</span><span><i class="marca-ref"></i>Média geral</span>';
  const an = anovaUmFator(grupos.map((g) => g.vals));
  el.resultados.innerHTML = resultadoAnova(an, x, y) + tabelaGrupos(caixas, y);
  if (caixas.length >= 2) {
    const ord = [...caixas].sort((a, b) => b.media - a.media);
    estado.resumo = `Em média, ${esc(y.nome)} é maior em <strong>${esc(ord[0].nome)}</strong> (${fmtValor(ord[0].media, y)}) e menor em <strong>${esc(ord.at(-1).nome)}</strong> (${fmtValor(ord.at(-1).media, y)}). ${an && an.p < 0.05 ? `A diferença entre os grupos é estatisticamente significativa (${textoP(an.p)}) e ${esc(x.nome)} explica ${fmtNum.format(an.eta2 * 100)}% da variação.` : 'As diferenças entre os grupos podem ser acaso (não significativas).'}`;
  }
}

function analiseRanking(linhas, y) {
  const validas = linhas.filter((l) => y.valor(l) !== null).sort((a, b) => y.valor(b) - y.valor(a));
  const nome = (l) => `${l.nome}${l.uf && nivel() !== 'estados' ? ` · ${l.uf.toUpperCase()}` : ''}`;
  const topo = validas.slice(0, 15).map((l) => ({ nome: nome(l), valor: y.valor(l) }));
  const base = validas.slice(-15).reverse().map((l) => ({ nome: nome(l), valor: y.valor(l) }));
  el.tituloGrafico.textContent = `Ranking · ${y.nome}`;
  el.subGrafico.textContent = `${fmtInt.format(validas.length)} locais`;
  estado.itensGrafico = [...topo, ...base].map((i) => ({ titulo: i.nome, linhas: [fmtValor(i.valor, y)] }));
  el.grafico.innerHTML = `<h3 class="pequeno">Maiores</h3>${svgBarras({ itens: topo, rotuloX: y.nome, cor: 'var(--div-acima)', fmtValor: (v) => fmtValor(v, y), largura: largura() })}
    <h3 class="pequeno">Menores</h3>${svgBarras({ itens: base, rotuloX: y.nome, cor: 'var(--div-abaixo)', fmtValor: (v) => fmtValor(v, y), largura: largura() })}`;
  el.resultados.innerHTML = '<p class="mudo">Use a aba "Dados" para ver todos os locais ordenados.</p>';
  if (validas.length) estado.resumo = `O maior valor de ${esc(y.nome)} está em <strong>${esc(nome(validas[0]))}</strong> (${fmtValor(y.valor(validas[0]), y)}) e o menor em <strong>${esc(nome(validas.at(-1)))}</strong> (${fmtValor(y.valor(validas.at(-1)), y)}).`;
}

function analiseTesteT(linhas, y, fator) {
  el.tituloGrafico.textContent = `${y.nome}: comparação de dois grupos`;
  if (!fator) {
    el.grafico.innerHTML = '<p class="mudo">Escolha em "separando por" uma variável com dois grupos (por exemplo, Capital?).</p>';
    el.resultados.innerHTML = '';
    return;
  }
  const cat = categorizador(fator, linhas);
  const validas = linhas.filter((l) => y.valor(l) !== null && cat(l) !== null);
  const { nomes, mapa: mapaG } = organizarGrupos(validas.map(cat), fator);
  const [a, b] = nomes.filter((n) => n !== 'Outros');
  if (!b) {
    el.grafico.innerHTML = '<p class="mudo">O separador precisa ter pelo menos dois grupos com dados.</p>';
    el.resultados.innerHTML = '';
    estado.resumo = `Só há dados para um grupo de ${esc(fator.nome)} (${esc(nomes[0] ?? 'nenhum')}) neste recorte: não há o que comparar.`;
    return;
  }
  const va = validas.filter((l) => mapaG(cat(l)) === a).map(y.valor);
  const vb = validas.filter((l) => mapaG(cat(l)) === b).map(y.valor);
  const t = testeTWelch(va, vb);
  const caixas = [{ nome: a, ...resumoCaixa(va) }, { nome: b, ...resumoCaixa(vb) }];
  estado.itensGrafico = caixas.map((c) => ({ titulo: c.nome, linhas: [`n ${c.n}`, `média ${fmtValor(c.media, y)}`] }));
  el.grafico.innerHTML = svgBoxplot({ grupos: caixas, rotuloX: y.nome, largura: largura() });
  el.subGrafico.textContent = `${a} × ${b}${nomes.length > 2 ? ' (os dois maiores grupos)' : ''}`;
  if (!t) { el.resultados.innerHTML = '<p class="mudo">Dados insuficientes.</p>'; return; }
  const efeito = Math.abs(t.d) < 0.2 ? 'desprezível' : Math.abs(t.d) < 0.5 ? 'pequeno' : Math.abs(t.d) < 0.8 ? 'médio' : 'grande';
  el.resultados.innerHTML = `<p class="resultado-destaque">Teste t de Welch: t(${fmtNum.format(t.gl)}) = <strong>${fmtNum.format(t.t)}</strong>${estrelas(t.p)} · ${textoP(t.p)} · d de Cohen = ${fmtNum.format(t.d)} (efeito ${efeito})</p>`
    + tabelaHtml(['Grupo', 'n', 'Média', 'Mediana'], caixas.map((c) => [esc(c.nome), fmtInt.format(c.n), fmtValor(c.media, y), fmtValor(c.mediana, y)]));
  estado.resumo = `${esc(y.nome)} é, em média, ${fmtValor(Math.abs(t.diferenca), y)} ${t.diferenca > 0 ? 'maior' : 'menor'} em <strong>${esc(a)}</strong> do que em <strong>${esc(b)}</strong>. ${t.p < 0.05 ? `A diferença é estatisticamente significativa (${textoP(t.p)}), com efeito ${efeito}.` : 'A diferença pode ser acaso (não significativa).'}`;
}

function analiseRegressao(linhas, y, explicativas) {
  const xs = explicativas.filter((v) => v.tipo === 'num' && v !== y);
  el.tituloGrafico.textContent = y ? `O que explica ${y.nome}?` : 'Regressão múltipla';
  if (!y || !xs.length) {
    el.grafico.innerHTML = '<p class="mudo">Escolha "quero entender" e marque ao menos uma variável explicativa.</p>';
    el.resultados.innerHTML = '';
    return;
  }
  const validas = linhas.filter((l) => y.valor(l) !== null && xs.every((v) => v.valor(l) !== null));
  const r = regressaoMultipla(validas.map(y.valor), validas.map((l) => xs.map((v) => v.valor(l))));
  el.subGrafico.textContent = `${fmtInt.format(validas.length)} locais com todos os dados`;
  if (!r) {
    el.grafico.innerHTML = '<p class="mudo">Não foi possível estimar: poucos locais com todos os dados, ou variáveis explicativas repetidas.</p>';
    el.resultados.innerHTML = '';
    return;
  }
  // Gráfico: peso padronizado (beta) de cada variável — compara variáveis de unidades diferentes.
  const itens = xs.map((v, i) => ({ nome: v.nome, valor: r.coeficientes[i + 1].beta ?? 0, p: r.coeficientes[i + 1].p }))
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  estado.itensGrafico = itens.map((i) => ({ titulo: i.nome, linhas: [`peso padronizado ${fmtNum.format(i.valor)}`, textoP(i.p)] }));
  el.grafico.innerHTML = svgBarras({ itens, rotuloX: 'peso padronizado (beta): quanto muda Y, em desvios padrão, por +1 desvio padrão da variável', cor: 'var(--cat-7)', fmtValor: (v) => fmtNum.format(v), largura: largura() });
  el.legenda.innerHTML = '<span class="mudo">Barras à direita aumentam "quero entender"; à esquerda, diminuem. Compare só as significativas (p &lt; 0,05).</span>';
  el.resultados.innerHTML = `<p class="resultado-destaque">R² = <strong>${fmtNum.format(r.r2)}</strong> (ajustado ${fmtNum.format(r.r2Ajustado)}) · F(${r.k}, ${r.glRes}) = ${fmtNum.format(r.f)}${estrelas(r.pF)} · ${textoP(r.pF)} · n = ${fmtInt.format(r.n)}</p>`
    + tabelaHtml(['Variável', 'Coeficiente', 'Erro padrão', 't', 'p', 'Beta'], [
      ['Intercepto', fmtCoef(r.coeficientes[0].coef), fmtCoef(r.coeficientes[0].se), fmtNum.format(r.coeficientes[0].t), fmtP(r.coeficientes[0].p), '—'],
      ...xs.map((v, i) => {
        const c = r.coeficientes[i + 1];
        return [esc(v.nome), fmtCoef(c.coef), fmtCoef(c.se), fmtNum.format(c.t), `${fmtP(c.p)}${estrelas(c.p)}`, fmtNum.format(c.beta ?? 0)];
      }),
    ])
    + '<p class="mudo pequeno">Cada coeficiente é o efeito de +1 na variável mantendo as outras fixas. Associação entre locais, não causalidade.</p>';
  const sig = itens.filter((i) => i.p < 0.05);
  estado.resumo = `As variáveis escolhidas explicam ${fmtNum.format(r.r2 * 100)}% da variação de ${esc(y.nome)} entre os locais. `
    + (sig.length
      ? `A que mais pesa é <strong>${esc(sig[0].nome)}</strong> (${sig[0].valor > 0 ? 'quanto maior, maior' : 'quanto maior, menor'} ${esc(y.nome)})${sig.length > 1 ? `; também contam ${sig.slice(1, 3).map((i) => esc(i.nome)).join(' e ')}` : ''}.`
      : 'Nenhuma delas tem efeito estatisticamente significativo quando consideradas juntas.');
}

function resultadoAnova(an, fator, v) {
  if (!an) return '<p class="mudo">ANOVA precisa de pelo menos 2 grupos com dados.</p>';
  const efeito = an.eta2 < 0.01 ? 'desprezível' : an.eta2 < 0.06 ? 'pequeno' : an.eta2 < 0.14 ? 'médio' : 'grande';
  return `<p class="resultado-destaque">ANOVA de um fator: F(${an.gl1}, ${an.gl2}) = <strong>${fmtNum.format(an.f)}</strong>${estrelas(an.p)} · ${textoP(an.p)} · η² = ${fmtNum.format(an.eta2)} (efeito ${efeito})</p>
    <p class="mudo pequeno">${an.p < 0.05 ? `As médias de ${esc(v.nome)} diferem entre os grupos de ${esc(fator.nome)}.` : `Sem evidência de diferença entre as médias de ${esc(v.nome)} nos grupos de ${esc(fator.nome)}.`} η² é a fração da variação explicada pelos grupos.</p>`;
}

function tabelaGrupos(caixas, v) {
  return tabelaHtml(['Grupo', 'n', 'Média', 'Desvio', 'Mediana', 'Q1', 'Q3'],
    caixas.map((c) => [esc(c.nome), fmtInt.format(c.n), fmtValor(c.media, v), fmtNum.format(c.desvio), fmtValor(c.mediana, v), fmtValor(c.q1, v), fmtValor(c.q3, v)]));
}

function analiseContingencia(linhas, x, y) {
  const validas = linhas.filter((l) => x.valor(l) !== null && y.valor(l) !== null);
  const gx = organizarGrupos(validas.map(x.valor), x);
  const gy = organizarGrupos(validas.map(y.valor), y);
  const conta = (a, b) => validas.filter((l) => gx.mapa(x.valor(l)) === a && gy.mapa(y.valor(l)) === b).length;
  el.tituloGrafico.textContent = `${x.nome} × ${y.nome}`;
  el.subGrafico.textContent = `${fmtInt.format(validas.length)} locais`;
  el.grafico.innerHTML = tabelaHtml([`${esc(x.nome)} \\ ${esc(y.nome)}`, ...gy.nomes.map(esc), 'Total'], gx.nomes.map((a) => {
    const linha = gy.nomes.map((b) => conta(a, b));
    const tot = linha.reduce((s, n) => s + n, 0);
    return [esc(a), ...linha.map((n) => `${fmtInt.format(n)} <small class="mudo">${tot ? fmtNum.format((n / tot) * 100) : 0}%</small>`), fmtInt.format(tot)];
  }));
  el.resultados.innerHTML = '<p class="mudo">Tabela de contingência com % na linha. Para testar diferenças de valores, use uma variável numérica no Eixo Y.</p>';
}

function renderizarDescritivas({ linhas, z }) {
  const usadas = [z.x, z.y, z.tamanho, ...z.matriz].filter((v, i, a) => v && v.tipo === 'num' && a.indexOf(v) === i);
  if (!usadas.length) {
    el.descritivas.innerHTML = '<tbody><tr><td class="mudo">Coloque variáveis numéricas nos campos para ver as estatísticas.</td></tr></tbody>';
    return;
  }
  const lin = usadas.map((v) => {
    const vals = linhas.map(v.valor).filter((x) => x !== null);
    const c = resumoCaixa(vals);
    return [esc(v.nome), fmtInt.format(vals.length), ...(c ? [c.media, c.desvio, Math.min(...vals), c.q1, c.mediana, c.q3, Math.max(...vals)].map((n, i) => (i === 1 ? fmtNum.format(n) : fmtValor(n, v))) : Array(7).fill('—'))];
  });
  el.descritivas.innerHTML = `<thead><tr><th>Variável</th>${['n', 'Média', 'Desvio', 'Mín', 'Q1', 'Mediana', 'Q3', 'Máx'].map((c) => `<th class="num">${c}</th>`).join('')}</tr></thead>
    <tbody>${lin.map((l) => `<tr>${l.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

function renderizarMatriz({ linhas, z }) {
  const vars = z.matriz.filter((v) => v.tipo === 'num');
  el.matrizCartao.hidden = vars.length < 2;
  if (vars.length < 2) return;
  const celula = (a, b) => {
    if (a === b) return '<td class="diag">1</td>';
    const pares = linhas.map((l) => [a.valor(l), b.valor(l)]).filter(([p, q]) => p !== null && q !== null);
    const r = correlacao(pares.map((p) => p[0]), pares.map((p) => p[1]));
    if (r === null) return '<td class="mudo">—</td>';
    const t = testeCorrelacao(r, pares.length);
    const cor = r > 0 ? 'var(--div-acima)' : 'var(--div-abaixo)';
    return `<td class="celula-r" data-a="${esc(a.id)}" data-b="${esc(b.id)}" style="--cor:${cor};--forca:${Math.round(Math.abs(r) * 70)}%"
      title="n = ${pares.length} · ${textoP(t.p)}">${fmtR(r)}<sup>${estrelas(t.p)}</sup></td>`;
  };
  el.matriz.innerHTML = `<thead><tr><th></th>${vars.map((v) => `<th>${esc(v.nome)}</th>`).join('')}</tr></thead>
    <tbody>${vars.map((a) => `<tr><th>${esc(a.nome)}</th>${vars.map((b) => celula(a, b)).join('')}</tr>`).join('')}</tbody>`;
}

// ---------- abas do resultado ----------

function mostrarAba(aba) {
  estado.aba = aba;
  for (const b of document.querySelectorAll('.abas-resultado [data-aba]')) b.setAttribute('aria-selected', String(b.dataset.aba === aba));
  for (const p of document.querySelectorAll('[data-painel]')) p.hidden = p.dataset.painel !== aba;
  if (aba === 'mapa' && estado.vista) renderizarMapa(estado.vista);
}
document.querySelector('.abas-resultado').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-aba]');
  if (!b) return;
  estado.abaAuto = false; // o usuário escolheu: o automático não troca mais de aba
  mostrarAba(b.dataset.aba);
});

// ---------- seletores ----------

el.selY.addEventListener('change', () => { estado.zonas.y = el.selY.value || null; estado.abaAuto = true; renderizarTudo(); });
el.selX.addEventListener('change', () => { estado.zonas.x = el.selX.value || null; if (estado.zonas.x) mostrarAba('grafico'); renderizarTudo(); });
el.selGrupo.addEventListener('change', () => { estado.zonas.grupo = el.selGrupo.value || null; renderizarTudo(); });
el.selTipo.addEventListener('change', () => {
  estado.tipo = el.selTipo.value;
  mostrarAba(estado.tipo === 'mapa' ? 'mapa' : 'grafico');
  renderizarTudo();
});
el.explicativas.addEventListener('change', () => {
  estado.zonas.matriz = [...el.explicativas.querySelectorAll('input:checked')].map((i) => i.value);
  renderizarTudo();
});

// ---------- perguntas prontas ----------


const PRES = '6257:1';
const SEN = '6259:5';
const DEPF = '6259:6';
const PERGUNTAS = [
  { icone: '🏆', titulo: 'Quem venceu em cada cidade?', texto: 'Mapa do candidato mais votado', nivel: 'todas', cargos: [PRES], y: `${PRES}:vencedor`, tipo: 'mapa' },
  { icone: '🗳️', titulo: 'Onde mais gente foi votar?', texto: 'Mapa do comparecimento', nivel: 'todas', cargos: [PRES], y: `${PRES}:pctComparecimento`, tipo: 'mapa' },
  { icone: '📚', titulo: 'A alfabetização muda o voto no líder?', texto: 'Censo 2022 × votação do 1º colocado', nivel: 'todas', cargos: [PRES], censo: ['alfabetizacao'], x: 'censo:alfabetizacao', y: `${PRES}:lider`, tipo: 'dispersao' },
  { icone: '🥊', titulo: 'Onde um cresce, o outro cai?', texto: '1º × 2º colocado por cidade', nivel: 'todas', cargos: [PRES], x: `${PRES}:lider`, y: `${PRES}:segundo`, tipo: 'dispersao' },
  { icone: '🗺️', titulo: 'O voto no líder muda por região?', texto: 'Compara as cidades de cada região', nivel: 'todas', cargos: [PRES], y: `${PRES}:lider`, grupo: 'terr:regiao', tipo: 'grupos' },
  { icone: '🧩', titulo: 'Onde o voto para deputado é mais dividido?', texto: 'Nº efetivo de partidos por região', nivel: 'todas', cargos: [DEPF], y: `${DEPF}:efetivo`, grupo: 'terr:regiao', tipo: 'grupos' },
  { icone: '🔎', titulo: 'O que explica o voto no líder?', texto: 'Regressão: Censo, comparecimento e biometria', nivel: 'todas', cargos: [PRES], censo: ['alfabetizacao', 'densidade'], y: `${PRES}:lider`, explicativas: ['censo:alfabetizacao', 'censo:densidade', `${PRES}:pctComparecimento`, 'logs:biometria'], tipo: 'regressao' },
  { icone: '❌', titulo: 'Onde mais se votou nulo para presidente?', texto: 'Mapa das cidades do Brasil', nivel: 'todas', cargos: [PRES], y: `${PRES}:pctNulos`, tipo: 'mapa' },
  { icone: '🧭', titulo: 'Brancos e nulos mudam de uma região para outra?', texto: 'Compara as cidades de cada região', nivel: 'todas', cargos: [PRES], y: `${PRES}:pctBrancosNulos`, grupo: 'terr:regiao', tipo: 'grupos' },
  { icone: '📚', titulo: 'Onde há mais alfabetização, há menos votos nulos?', texto: 'Censo 2022 × resultado', nivel: 'todas', cargos: [PRES], censo: ['alfabetizacao'], x: 'censo:alfabetizacao', y: `${PRES}:pctNulos`, tipo: 'dispersao' },
  { icone: '⏱️', titulo: 'O tempo na cabine tem a ver com os nulos?', texto: 'Logs das urnas × resultado', nivel: 'todas', cargos: [PRES], x: 'logs:cabine', y: `${PRES}:pctNulos`, tipo: 'dispersao' },
  { icone: '🏙️', titulo: 'Capitais votam diferente do interior?', texto: 'Teste t: capitais × interior', nivel: 'todas', cargos: [PRES], y: `${PRES}:pctBrancosNulos`, grupo: 'terr:capital', tipo: 'testet' },
  { icone: '🔁', titulo: 'Quem anula para presidente também anula para senador?', texto: 'Correlação entre cargos', nivel: 'todas', cargos: [PRES, SEN], x: `${PRES}:pctNulos`, y: `${SEN}:pctNulos`, tipo: 'dispersao' },
  { icone: '🧮', titulo: 'O que mais explica os votos nulos?', texto: 'Regressão: Censo, logs e abstenção', nivel: 'todas', cargos: [PRES], censo: ['alfabetizacao', 'densidade'], y: `${PRES}:pctNulos`, explicativas: ['censo:alfabetizacao', 'censo:densidade', 'logs:cabine', 'logs:biometria', `${PRES}:pctAbstencao`], tipo: 'regressao' },
  { icone: '🏆', titulo: 'Quais cidades mais deixaram o voto em branco?', texto: 'Ranking das cidades', nivel: 'todas', cargos: [PRES], y: `${PRES}:pctBrancos`, tipo: 'ranking' },
  { icone: '👥', titulo: 'Cidades grandes votam diferente das pequenas?', texto: 'Compara por porte (votos)', nivel: 'todas', cargos: [PRES], y: `${PRES}:pctBrancosNulos`, grupo: 'terr:porte', tipo: 'grupos' },
];

el.perguntas.innerHTML = PERGUNTAS.map((p, i) => `<button type="button" class="pergunta" data-pergunta="${i}">
  <span class="pergunta-icone" aria-hidden="true">${p.icone}</span><span class="pergunta-titulo">${esc(p.titulo)}</span><span class="pergunta-texto">${esc(p.texto)}</span></button>`).join('');

async function aplicarPergunta(p) {
  for (const b of el.perguntas.querySelectorAll('.pergunta')) b.classList.toggle('ativa', PERGUNTAS[Number(b.dataset.pergunta)] === p);
  estado.cargos = [...p.cargos];
  preencherCargos();
  if (p.nivel) el.nivel.value = p.nivel;
  estado.zonas = { x: p.x ?? null, y: p.y ?? null, grupo: p.grupo ?? null, tamanho: null, matriz: p.explicativas ?? [] };
  estado.tipo = p.tipo;
  estado.abaAuto = true;
  mostrarAba(p.tipo === 'mapa' ? 'mapa' : 'grafico');
  // Séries do Censo que a pergunta usa (baixadas uma vez e guardadas pelo servidor).
  const faltam = (p.censo ?? []).filter((id) => ![...estado.censo.values()].some((s) => s.preset === id));
  await Promise.all(faltam.map((id) => adicionarCenso(`api/censo/serie?preset=${encodeURIComponent(id)}`, id, id)));
  await carregar();
  el.grafico.closest('.cartao').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
el.perguntas.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-pergunta]');
  if (b) aplicarPergunta(PERGUNTAS[Number(b.dataset.pergunta)]);
});

// ---------- interação: arrastar, tocar, soltar ----------

function colocar(zona, id) {
  const v = estado.vista?.porId.get(id);
  if (!v) return;
  if (zona === 'tamanho' && v.tipo !== 'num') return avisar('Tamanho aceita só variáveis numéricas.');
  if (zona === 'matriz') {
    if (v.tipo !== 'num') return avisar('A matriz de correlação aceita só variáveis numéricas.');
    if (!estado.zonas.matriz.includes(id)) estado.zonas.matriz.push(id);
  } else {
    estado.zonas[zona] = id;
  }
  estado.selecionada = null;
  renderizarTudo();
}

function avisar(msg) {
  el.status.textContent = msg;
  el.status.className = 'status falha';
}

document.addEventListener('dragstart', (ev) => {
  const chip = ev.target.closest?.('[data-var]');
  if (!chip) return;
  ev.dataTransfer.setData('text/plain', chip.dataset.var);
  ev.dataTransfer.effectAllowed = 'copy';
});
for (const zona of document.querySelectorAll('.zona')) {
  zona.addEventListener('dragover', (ev) => { ev.preventDefault(); zona.classList.add('sobre'); });
  zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
  zona.addEventListener('drop', (ev) => {
    ev.preventDefault();
    zona.classList.remove('sobre');
    colocar(zona.dataset.zona, ev.dataTransfer.getData('text/plain'));
  });
  zona.addEventListener('click', (ev) => {
    const tirar = ev.target.closest('[data-tirar]');
    if (tirar) {
      if (tirar.dataset.tirar === 'matriz') estado.zonas.matriz = estado.zonas.matriz.filter((id) => id !== tirar.dataset.var);
      else estado.zonas[tirar.dataset.tirar] = null;
      renderizarTudo();
      return;
    }
    if (estado.selecionada) colocar(zona.dataset.zona, estado.selecionada);
  });
}
el.listaVar.addEventListener('click', (ev) => {
  const chip = ev.target.closest('[data-var]');
  if (!chip) return;
  estado.selecionada = estado.selecionada === chip.dataset.var ? null : chip.dataset.var;
  renderizarVariaveis(estado.vista);
  renderizarZonas(estado.vista);
});
el.matriz.addEventListener('click', (ev) => {
  const c = ev.target.closest('[data-a]');
  if (!c) return;
  estado.zonas.x = c.dataset.a;
  estado.zonas.y = c.dataset.b;
  renderizarTudo();
  el.grafico.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
el.limparZonas.addEventListener('click', () => {
  estado.zonas = { x: null, y: null, grupo: null, tamanho: null, matriz: [] };
  renderizarTudo();
});
el.filtroVar.addEventListener('input', () => renderizarVariaveis(estado.vista));
el.nivel.addEventListener('change', carregar);
el.apuracao.addEventListener('change', renderizarTudo);
el.semExterior.addEventListener('change', renderizarTudo);
el.atualizar.addEventListener('click', carregar);
el.cargos.addEventListener('change', () => {
  estado.cargos = [...el.cargos.querySelectorAll('input:checked')].map((i) => i.value);
  if (!estado.cargos.length) {
    estado.cargos = [CARGOS[0].valor];
    preencherCargos();
  }
  carregar();
});
el.presets.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-preset]');
  if (b) adicionarCenso(`api/censo/serie?preset=${encodeURIComponent(b.dataset.preset)}`, b.textContent.replace(/^\+\s*/, ''), b.dataset.preset);
});
el.buscarSidra.addEventListener('click', mostrarTabelaSidra);
el.tabelaSidra.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') mostrarTabelaSidra(); });
el.csv.addEventListener('change', async () => {
  const arquivo = el.csv.files[0];
  if (!arquivo) return;
  try {
    const n = await importarCsv(arquivo);
    renderizarTudo();
    el.status.textContent = `${n} coluna(s) importada(s) de ${arquivo.name}`;
    el.status.className = 'status ok';
  } catch (erro) {
    el.erro.hidden = false;
    el.erro.textContent = `CSV: ${erro.message}`;
  }
  el.csv.value = '';
});

dica.ligar(el.grafico, '[data-dica]', (alvo) => {
  const i = Number(alvo.dataset.dica);
  if (estado.pontos && alvo.tagName === 'circle') {
    const l = estado.pontos[i];
    const { x, y, tamanho } = estado.dispersao;
    return l ? `<strong>${esc(l.nome)}${l.uf ? ` · ${esc(l.uf.toUpperCase())}` : ''}</strong>
      <span>${esc(x.nome)}: ${fmtValor(x.valor(l), x)}</span><span>${esc(y.nome)}: ${fmtValor(y.valor(l), y)}</span>
      ${tamanho ? `<span>${esc(tamanho.nome)}: ${fmtValor(tamanho.valor(l), tamanho)}</span>` : ''}` : null;
  }
  const item = estado.itensGrafico?.[i];
  return item ? `<strong>${esc(item.titulo)}</strong>${item.linhas.map((t) => `<span>${esc(t)}</span>`).join('')}` : null;
});

el.exportar.addEventListener('click', () => {
  const v = estado.vista;
  if (!v) return;
  const usadas = [v.z.x, v.z.y, v.z.grupo, v.z.tamanho, ...v.z.matriz].filter((x, i, a) => x && a.indexOf(x) === i);
  const cols = usadas.length ? usadas : v.vars;
  baixarCsv('explorador-eleicoes-2026.csv', [
    { nome: 'Local', valor: (l) => l.nome }, { nome: 'UF', valor: (l) => l.uf?.toUpperCase() },
    { nome: 'Código IBGE', valor: (l) => l.ibge ?? '' }, { nome: 'Código TSE', valor: (l) => l.codigo ?? '' },
    ...cols.map((c) => ({ nome: c.nome, valor: (l) => c.valor(l) ?? '' })),
  ], v.linhas);
});

// ---------- estado no link ----------

function gravarHash() {
  const p = new URLSearchParams({ nivel: nivel(), cargos: estado.cargos.join(',') });
  for (const k of ['x', 'y', 'grupo', 'tamanho']) if (estado.zonas[k]) p.set(k, estado.zonas[k]);
  if (estado.zonas.matriz.length) p.set('matriz', estado.zonas.matriz.join(','));
  if (estado.tipo !== 'auto') p.set('tipo', estado.tipo);
  const censo = [...estado.censo.values()].map((s) => s.preset ?? '').filter(Boolean);
  if (censo.length) p.set('censo', censo.join(','));
  history.replaceState(null, '', `#${p}`);
}

const inicial = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
if (inicial.cargos) estado.cargos = inicial.cargos.split(',').filter((v) => cargoPorValor(v));
if (!estado.cargos.length) estado.cargos = [CARGOS[0].valor];
for (const k of ['x', 'y', 'grupo', 'tamanho']) if (inicial[k]) estado.zonas[k] = inicial[k];
if (inicial.matriz) estado.zonas.matriz = inicial.matriz.split(',');
if (!inicial.x && !inicial.y) {
  // Ponto de partida simples: mapa de quem venceu em cada local, no primeiro cargo.
  const c = estado.cargos[0];
  estado.zonas = { x: null, y: `${c}:vencedor`, grupo: null, tamanho: null,
    matriz: [`${c}:pctBrancos`, `${c}:pctNulos`, `${c}:pctAnulados`, `${c}:pctAbstencao`] };
  estado.tipo = 'mapa';
  estado.aba = 'mapa';
}
if (inicial.tipo) estado.tipo = inicial.tipo;
preencherNiveis(inicial.nivel ?? 'estados');
preencherCargos();
carregarPresets();
carregar();
for (const id of (inicial.censo ?? '').split(',').filter(Boolean)) {
  adicionarCenso(`api/censo/serie?preset=${encodeURIComponent(id)}`, id, id);
}
setInterval(() => { if (!document.hidden) carregar(); }, 60_000);
