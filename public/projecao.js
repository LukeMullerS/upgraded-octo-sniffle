// Projeção do resultado final do 2º turno em tempo real (modelo em projecao-modelo.js): Presidente,
// com os estados (e o exterior) como unidades, e Governador, com as cidades do estado.

import { cargoPorValor, carregarEstados, carregarMunicipios, coresPorPartido, criarDica, esc, fmtInt, nomeUf, pct } from './comum.js';
import { svgDispersao, svgHistograma, svgLinhas } from './graficos.js';
import { CATEGORICA } from './mapa.js';
import { doisDaDisputa, montarUnidades, projetar } from './projecao-modelo.js';
import { expandirRetrato, lerMunicipios, urlMunicipios } from './tse.js';

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(['disputa', 'status', 'atualizar', 'erro', 'titulo', 'sub-titulo', 'resumo', 'barra-projecao', 'kpis',
  'evolucao', 'nota-evolucao', 'eixo-evolucao', 'simulacoes', 'sub-simulacoes', 'regressao', 'sub-regressao', 'nota-regressao', 'titulo-tabela', 'tabela', 'dica']
  .map((id) => [id.replace(/-(\w)/g, (_, l) => l.toUpperCase()), $(id)]));

const dica = criarDica(el.dica);
const estado = { pedido: 0, timer: null, pontos: [], eixo: 'tempo', vivos: {}, historico: null, ultimo: null };
const um = (x) => `${(Math.round(x * 1000) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
// Cores dos dois candidatos: as dos partidos (as mesmas do resto do app).
let COR_A = 'var(--cat-1)';
let COR_B = 'var(--cat-2)';

// Disputas do 2º turno: Presidente e, nos estados com 2º turno, Governador.
async function preencherDisputas() {
  const opcoes = [['presidente', 'Presidente — Brasil (por estado)']];
  try {
    const r = await fetch(urlMunicipios('tse', '6260'));
    if (r.ok) for (const uf of Object.keys(lerMunicipios(await r.json())).sort()) opcoes.push([`gov:${uf}`, `Governador — ${nomeUf(uf)} (por cidade)`]);
  } catch { /* só Presidente */ }
  el.disputa.innerHTML = opcoes.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  const pedido = new URLSearchParams(location.hash.slice(1)).get('disputa');
  if (opcoes.some(([v]) => v === pedido)) el.disputa.value = pedido;
}

const jsonOuNulo = (url) => fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/**
 * Unidades do modelo e os dois candidatos.
 * Presidente: as cidades do Brasil (retrato que o Voto Lab grava a cada ~10 min durante a apuração),
 * agrupadas por estado, com os totais de cada estado ao vivo; sem o retrato, os estados.
 * Governador: as cidades do estado, ao vivo.
 */
async function unidadesDa(disputa) {
  const gov = disputa.startsWith('gov:');
  const uf = gov ? disputa.slice(4) : null;
  const [c2, c1] = gov ? [cargoPorValor('6260:3'), cargoPorValor('6259:3')] : [cargoPorValor('6258:1'), cargoPorValor('6257:1')];
  if (gov) {
    const [d2, d1] = await Promise.all([carregarMunicipios(c2, uf), carregarMunicipios(c1, uf)]);
    const nomes = d2.nomes ?? {};
    const [a, b] = doisDaDisputa(nomes, d2.municipios, d1.municipios);
    if (!a || !b) throw new Error('candidatos do 2º turno ainda não publicados');
    const unidades = montarUnidades({ l2: d2.municipios, l1: d1.municipios, chave: (r) => r.codigo, nome: (r) => r.nome, a, b });
    return { unidades, aoVivo: null, nivel: 'cidades', ...candidatos(nomes, a, b), gov, uf };
  }
  const [vivo, t1Estados, snap, t1Cidades] = await Promise.all([carregarEstados(c2), carregarEstados(c1), jsonOuNulo('resultados/6258-1.json'), jsonOuNulo('resultados/6257-1.json')]);
  const nomes = vivo.nomes ?? {};
  const [a, b] = doisDaDisputa(nomes, vivo.estados, t1Estados.estados);
  if (!a || !b) throw new Error('candidatos do 2º turno ainda não publicados');
  const aoVivo = Object.fromEntries(vivo.estados.map((e) => [e.uf, { aptos: e.eleitorado, aptosApurados: e.aptosTotalizadas ?? 0, validos: e.validos ?? 0, votosA: e.cand?.[a] ?? 0, votosB: e.cand?.[b] ?? 0 }]));
  if (snap?.municipios?.length && t1Cidades?.municipios?.length) {
    const l2 = expandirRetrato(snap).municipios;
    const l1 = expandirRetrato(t1Cidades).municipios;
    const unidades = montarUnidades({ l2, l1, chave: (r) => r.codigo, nome: (r) => `${r.nome} · ${r.uf.toUpperCase()}`, grupo: (r) => r.uf, a, b });
    return { unidades, aoVivo, nivel: 'cidades', retratoEm: snap.retrato?.geradoEm, ...candidatos(nomes, a, b), gov, uf };
  }
  const unidades = montarUnidades({ l2: vivo.estados, l1: t1Estados.estados, chave: (r) => r.uf, nome: (r) => nomeUf(r.uf), a, b });
  return { unidades, aoVivo: null, nivel: 'estados', ...candidatos(nomes, a, b), gov, uf };
}

function candidatos(nomes, a, b) {
  const nome = (n) => `${nomes[n]?.[0] ?? n} (${nomes[n]?.[1] ?? ''})`;
  const cores = coresPorPartido([a, b], (n) => nomes[n]?.[1], CATEGORICA);
  [COR_A, COR_B] = [cores.get(a), cores.get(b)];
  return { a: { numero: a, nome: nome(a), curto: nomes[a]?.[0] ?? a }, b: { numero: b, nome: nome(b), curto: nomes[b]?.[0] ?? b } };
}

async function carregar() {
  const pedido = ++estado.pedido;
  const disputa = el.disputa.value;
  history.replaceState(null, '', `#${new URLSearchParams({ disputa })}`);
  el.status.textContent = 'consultando…';
  el.status.className = 'status';
  try {
    const dados = await unidadesDa(disputa);
    if (pedido !== estado.pedido) return;
    const r = projetar({ unidades: dados.unidades, aoVivo: dados.aoVivo });
    if (!r) throw new Error('sem dados para projetar');
    // Ponto ao vivo desta consulta (entre as gravações do histórico compartilhado, a cada ~10 min).
    if (r.apuradoA !== null) {
      const vivos = (estado.vivos[disputa] ??= []);
      const u = vivos.at(-1);
      if (!u || u.ap !== r.fracaoApurada) vivos.push({ t: new Date().toISOString(), ap: r.fracaoApurada, sa: r.apuradoA, p: r.projecao, lo: r.intervalo[0], hi: r.intervalo[1] });
    }
    estado.historico = await fetch('historico/2t.json', { cache: 'no-cache' }).then((x) => (x.ok ? x.json() : null)).catch(() => estado.historico);
    if (pedido !== estado.pedido) return;
    renderizar(dados, r);
    el.erro.hidden = true;
    el.status.textContent = `atualizado às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
    agendar(r.fracaoApurada >= 0.9999 ? 600_000 : 30_000);
  } catch (erro) {
    if (pedido !== estado.pedido) return;
    el.erro.hidden = false;
    el.erro.textContent = `Não foi possível projetar: ${erro.message}`;
    el.status.textContent = 'falha na consulta';
    el.status.className = 'status falha';
    agendar(30_000);
  }
}

function agendar(ms) {
  clearTimeout(estado.timer);
  estado.timer = setTimeout(() => { if (!document.hidden) carregar(); else agendar(ms); }, ms);
}

const kpi = (rotulo, valor, detalhe = '') => `<div class="kpi"><dt>${rotulo}</dt><dd><span class="kpi-pct">${valor}</span>${detalhe ? `<small>${detalhe}</small>` : ''}</dd></div>`;

function renderizar({ a, b, gov, uf, nivel, retratoEm }, r) {
  const local = gov ? nomeUf(uf) : 'Brasil';
  el.titulo.textContent = `${gov ? 'Governador' : 'Presidente'} · ${local} · 2º turno`;
  el.subTitulo.textContent = `${pct(r.fracaoApurada * 100)} do eleitorado apurado`;
  const [lo, hi] = r.intervalo;
  const lider = r.projecao >= 0.5 ? a : b;
  const pLider = r.projecao >= 0.5 ? r.projecao : 1 - r.projecao;
  const chanceLider = r.projecao >= 0.5 ? r.chanceA : 1 - r.chanceA;
  const intervaloLider = r.projecao >= 0.5 ? [lo, hi] : [1 - hi, 1 - lo];
  const fim = r.fracaoApurada >= 0.9999;
  if (fim) {
    el.resumo.innerHTML = `<strong>Apuração encerrada:</strong> ${esc(lider.nome)} terminou com ${um(pLider)} dos votos válidos.`;
  } else if (!r.modelo.n) {
    el.resumo.innerHTML = `<strong>Ainda não há urnas apuradas.</strong> Por enquanto a projeção usa só o 1º turno, com metade dos votos dos outros candidatos para cada lado: ${esc(lider.nome)} ${um(pLider)} (entre ${um(intervaloLider[0])} e ${um(intervaloLider[1])}). Muito incerta; melhora assim que as primeiras urnas chegarem.`;
  } else {
    el.resumo.innerHTML = `<strong>Projeção:</strong> ${esc(lider.nome)} termina com <strong>${um(pLider)}</strong> dos votos válidos (90% das simulações entre ${um(intervaloLider[0])} e ${um(intervaloLider[1])}). `
      + `Chance de terminar na frente: <strong>${chanceLider >= 0.995 ? 'mais de 99%' : `${Math.round(chanceLider * 100)}%`}</strong>. `
      + `Agora, com ${pct(r.fracaoApurada * 100)} apurado, ${esc(a.curto)} tem ${um(r.apuradoA ?? 0)} e ${esc(b.curto)} ${um(1 - (r.apuradoA ?? 0))}.`;
  }
  // Barra: projeção dos dois, com o intervalo de 90% marcado e a linha dos 50%.
  el.barraProjecao.innerHTML = `
    <div class="bp-nomes"><span style="color:${COR_A}">${esc(a.nome)} ${um(r.projecao)}</span><span style="color:${COR_B}">${um(1 - r.projecao)} ${esc(b.nome)}</span></div>
    <div class="bp-barra" role="img" aria-label="${esc(a.curto)} ${um(r.projecao)}, ${esc(b.curto)} ${um(1 - r.projecao)}">
      <span class="bp-a" style="width:${(r.projecao * 100).toFixed(2)}%;background:${COR_A}"></span><span class="bp-b" style="background:${COR_B}"></span>
      <span class="bp-intervalo" style="left:${(lo * 100).toFixed(2)}%;width:${((hi - lo) * 100).toFixed(2)}%"></span>
      <span class="bp-meio"></span>
    </div>
    <div class="bp-legenda mudo pequeno">faixa clara: intervalo de 90% · traço: 50%</div>`;
  el.kpis.innerHTML = [
    kpi('Eleitorado apurado', pct(r.fracaoApurada * 100), `${fmtInt.format(r.unidades.filter((u) => u.f > 0).length)} de ${fmtInt.format(r.unidades.length)} ${nivel} com votos${retratoEm ? ` (cidades de ${HORA.format(new Date(retratoEm))})` : ''}`),
    kpi(`Projeção ${esc(a.curto)}`, um(r.projecao), `entre ${um(lo)} e ${um(hi)}`),
    kpi(`Chance de ${esc(a.curto)} vencer`, `${r.chanceA >= 0.995 ? '>99' : r.chanceA <= 0.005 ? '<1' : Math.round(r.chanceA * 100)}%`, `${esc(b.curto)}: ${r.chanceA >= 0.995 ? '<1' : r.chanceA <= 0.005 ? '>99' : Math.round((1 - r.chanceA) * 100)}%`),
    kpi('Votos válidos esperados', fmtInt.format(Math.round(r.validosEsperados)), `faltam ~${fmtInt.format(Math.round(r.unidades.reduce((t, u) => t + u.restante, 0)))}`),
  ].join('');
  estado.ultimo = { a, b, gov, uf };
  renderizarEvolucao();
  renderizarSimulacoes(a, r);
  renderizarRegressao(a, r, nivel === 'cidades');
  renderizarTabela(a, b, r, gov, nivel);
}

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Linhas de cada candidato (apurado) e da projeção, do histórico compartilhado + o desta sessão. */
function renderizarEvolucao() {
  if (!estado.ultimo) return;
  const { a, b, gov, uf } = estado.ultimo;
  for (const bt of el.eixoEvolucao.querySelectorAll('[data-eixo]')) bt.setAttribute('aria-pressed', String(bt.dataset.eixo === estado.eixo));
  const disputa = gov ? `gov:${uf}` : 'presidente';
  const h = gov ? estado.historico?.governador?.[uf] : estado.historico?.presidente;
  // No histórico a ordem dos dois é fixa; aqui "a" é o que lidera agora: troca se precisar.
  const trocado = h?.numeros && String(h.numeros.a) !== String(a.numero);
  const gravados = (h?.pontos ?? []).filter((p) => p.a + p.b > 0).map((p) => {
    const sa = p.a / (p.a + p.b);
    const proj = Number.isFinite(p.p) ? { p: p.p, lo: p.lo, hi: p.hi } : {};
    if (trocado) return { t: p.t, ap: p.ap, sa: 1 - sa, ...(proj.p !== undefined ? { p: 1 - proj.p, lo: 1 - proj.hi, hi: 1 - proj.lo } : {}) };
    return { t: p.t, ap: p.ap, sa, ...proj };
  });
  const ultimoGravado = gravados.at(-1)?.t ?? '';
  // Pontos desta sessão depois do último gravado (e nunca "voltando" na apuração: resposta antiga do cache).
  const apGravado = gravados.at(-1)?.ap ?? 0;
  const pontos = [...gravados, ...(estado.vivos[disputa] ?? []).filter((p) => p.t > ultimoGravado && p.ap >= apGravado)];
  if (!pontos.length) {
    el.evolucao.innerHTML = '<p class="mudo">A linha começa assim que houver votos apurados.</p>';
    el.notaEvolucao.textContent = '';
    return;
  }
  const porTempo = estado.eixo === 'tempo';
  const x = (p) => (porTempo ? Date.parse(p.t) : p.ap * 100);
  // Marcas de horário redondas (10, 15, 30 ou 60 min, conforme o período).
  let marcasX = null;
  if (porTempo) {
    const t0 = x(pontos[0]);
    const t1 = x(pontos.at(-1));
    const passo = [10, 15, 30, 60, 120].map((m) => m * 60_000).find((m) => (t1 - t0) / m <= 7) ?? 240 * 60_000;
    marcasX = [];
    for (let t = Math.ceil(t0 / passo) * passo; t <= t1; t += passo) marcasX.push(t);
    if (marcasX.length < 2) marcasX = [t0, t1];
  }
  const comProj = pontos.filter((p) => Number.isFinite(p.p));
  el.evolucao.innerHTML = svgLinhas({
    series: [
      { nome: a.curto, cor: COR_A, pontos: pontos.map((p) => ({ x: x(p), y: p.sa * 100 })) },
      { nome: b.curto, cor: COR_B, pontos: pontos.map((p) => ({ x: x(p), y: (1 - p.sa) * 100 })) },
      ...(comProj.length ? [{ nome: `projeção ${a.curto}`, cor: COR_A, tracejada: true, pontos: comProj.map((p) => ({ x: x(p), y: p.p * 100 })) }] : []),
    ],
    faixas: comProj.length ? [{ cor: COR_A, pontos: comProj.map((p) => ({ x: x(p), lo: p.lo * 100, hi: p.hi * 100 })) }] : [],
    refY: 50, marcasX,
    rotuloX: porTempo ? 'horário de Brasília' : '% do eleitorado apurado', rotuloY: '% dos votos válidos',
    fmtX: porTempo ? (v) => HORA.format(new Date(v)) : (v) => `${Math.round(v * 10) / 10}%`,
    fmtY: (v) => `${(Math.round(v * 10) / 10).toLocaleString('pt-BR')}%`,
  });
  el.notaEvolucao.textContent = `Linhas cheias: % de cada candidato nos votos já apurados. Tracejada: projeção do resultado final de ${a.curto}, com a faixa de 90%. `
    + 'O histórico é gravado pelo Voto Lab a cada minuto durante a apuração (o mesmo para todos) e esta página acrescenta os pontos de cada atualização enquanto fica aberta.';
}

function renderizarSimulacoes(a, r) {
  const xs = r.simulacoes;
  const min = xs[0];
  const max = xs.at(-1);
  if (max - min < 1e-6) { el.simulacoes.innerHTML = '<p class="mudo">Apuração completa: sem incerteza.</p>'; el.subSimulacoes.textContent = ''; return; }
  const n = 30;
  const passo = (max - min) / n;
  const faixas = Array.from({ length: n }, (_, i) => ({ inicio: (min + i * passo) * 100, fim: (min + (i + 1) * passo) * 100, contagem: 0 }));
  for (const x of xs) faixas[Math.min(n - 1, Math.floor((x - min) / passo))].contagem += 1;
  el.subSimulacoes.textContent = `${fmtInt.format(xs.length)} sorteios · ${a.curto} em % dos válidos`;
  el.simulacoes.innerHTML = svgHistograma({
    faixas, rotuloX: `% de ${a.curto} nos votos válidos`, cor: COR_A,
    linhas: [{ valor: 50, classe: 'ref-principal', rotulo: '50%' }, { valor: r.projecao * 100, classe: 'ref-mediana', rotulo: 'projeção' }],
  });
}

function renderizarRegressao(a, r, gov) {
  // No máximo 1.500 pontos (os com mais votos apurados), para o gráfico continuar leve.
  const pts = r.unidades.filter((u) => u.y !== null && u.dois >= 50).sort((x, y) => y.dois - x.dois).slice(0, 1500);
  estado.pontos = pts;
  el.subRegressao.textContent = `${fmtInt.format(r.modelo.n)} ${gov ? 'cidades' : 'estados'} com votos`;
  if (!pts.length) { el.regressao.innerHTML = '<p class="mudo">Aparece quando houver urnas apuradas.</p>'; el.notaRegressao.textContent = ''; return; }
  const maxV = Math.max(...pts.map((u) => u.dois));
  const { delta, beta } = r.modelo;
  // A reta do modelo (base do 1º turno → 2º turno) no local com a fatia média de "outros".
  el.regressao.innerHTML = svgDispersao({
    pontos: pts.map((u, i) => ({ x: u.base * 100, y: u.y * 100, r: 1.5 + Math.sqrt(u.dois / maxV) * 10, cor: COR_A, i })),
    rotuloX: `${a.curto} no 1º turno + metade dos outros (%)`, rotuloY: `${a.curto} no 2º turno (%)`,
    regressao: { a: delta * 100, b: 1 },
  });
  el.notaRegressao.textContent = `Cada ponto é ${gov ? 'uma cidade' : 'um estado'} com votos (tamanho: votos apurados). A reta é o modelo: `
    + `${a.curto} está ${delta >= 0 ? `${um(delta).replace('%', '')} p.p. acima` : `${um(-delta).replace('%', '')} p.p. abaixo`} do 1º turno com metade dos votos dos outros candidatos`
    + `${Math.abs(beta) > 0.05 ? `, e os eleitores dos outros pendem ${beta > 0 ? `para ${a.curto}` : 'para o adversário'}` : ''}`
    + `${Math.abs(r.modelo.betaA) > 0.05 ? `; cresce mais onde já era ${r.modelo.betaA > 0 ? 'forte' : 'fraco'}` : ''}. Cada estado tem ainda um ajuste próprio (efeito de estado), encolhido para zero onde há poucas cidades apuradas.`;
}

function renderizarTabela(a, b, r, gov, nivel) {
  el.tituloTabela.textContent = gov ? 'Por cidade' : 'Por estado';
  // Presidente com cidades: a tabela mostra os estados (soma das cidades + totais ao vivo).
  const porEstado = !gov && nivel === 'cidades';
  const linhas = (porEstado ? r.grupos.map((g) => ({ ...g, nome: nomeUf(g.grupo) })) : [...r.unidades]).sort((x, y) => y.restante - x.restante);
  const celPct = (x) => (x === null || !Number.isFinite(x) ? '—' : um(x));
  el.tabela.innerHTML = `<thead><tr><th>${gov ? 'Cidade' : 'Estado'}</th><th class="num">Apurado</th><th class="num">${esc(a.curto)} agora</th><th class="num">${esc(a.curto)} no 1º turno</th><th class="num">Previsto (regressão)</th><th class="num">Projeção final</th><th class="num">Votos válidos que faltam</th></tr></thead>
    <tbody>${linhas.map((u) => `<tr><td class="local">${esc(u.nome)}</td><td class="num">${pct(u.f * 100)}</td><td class="num">${celPct(u.y)}</td><td class="num">${u.A1 === null ? '—' : um(u.A1)}</td><td class="num">${um(u.previsto)}</td>`
      + `<td class="num"><strong style="color:${u.projecao >= 0.5 ? COR_A : COR_B}">${um(u.projecao)}</strong><small class="mudo"> ${u.restante ? `(${um(u.intervalo[0])}–${um(u.intervalo[1])})` : ''}</small></td>`
      + `<td class="num">${fmtInt.format(Math.round(u.restante))}</td></tr>`).join('')}</tbody>`;
}

dica.ligar(el.regressao, '[data-dica]', (alvo) => {
  const u = estado.pontos[Number(alvo.dataset.dica)];
  if (!u) return null;
  return `<strong>${esc(u.nome)}</strong><span>1º turno (+ metade dos outros): ${um(u.base)}</span><span>2º turno apurado: ${um(u.y)}</span><span>${pct(u.f * 100)} apurado</span>`;
});

el.disputa.addEventListener('change', carregar);
el.eixoEvolucao.addEventListener('click', (ev) => {
  const bt = ev.target.closest('[data-eixo]');
  if (!bt) return;
  estado.eixo = bt.dataset.eixo;
  renderizarEvolucao();
});
el.atualizar.addEventListener('click', carregar);
await preencherDisputas();
carregar();
