// Minha seção: os votos de uma seção eleitoral, lidos do boletim de urna (BU) que o TSE publica
// para cada seção, com os nomes dos candidatos e a comparação com a cidade (resultado oficial).
// Também mostra a zona inteira (public/zonas, dos dados abertos do TSE) e a cidade inteira.
// Cada consulta baixa dois arquivos pequenos da seção (aux.json e -bu.dat), pelo relay /tse, em
// cache no CDN (o boletim não muda depois de publicado).

import { antesDeExportar } from './citar.js';
import { coresPorPartido, esc, expandirSecoes, fmtInt, pct, semAcento } from './comum.js';
import { lerBoletim } from './bu.js';
import { CATEGORICA } from './mapa.js';
import { ELEICOES, UFS, lerMunicipios, normalizar, urlMunicipios, urlResultado } from './tse.js';

const BASE = 'tse';
const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(['turno', 'nivel', 'campo-zona', 'campo-secao', 'fonte', 'uf', 'cidade', 'lista-cidades', 'zona', 'secao', 'dica-secao', 'erro', 'ficha', 'titulo-secao', 'sub-secao',
  'resumo-secao', 'nota-secao', 'cargos', 'status', 'imprimir'].map((id) => [id.replace(/-(\w)/g, (_, l) => l.toUpperCase()), $(id)]));

// Pleito dos arquivos das urnas e eleições de cada turno (2026).
const TURNOS = {
  1: { pleito: '3220', federal: '6257', estadual: '6259' },
  2: { pleito: '3221', federal: '6258', estadual: '6260' },
};
const NOMES_CARGO = { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado Federal', 7: 'Deputado Estadual', 8: 'Deputado Distrital' };
const ORDEM_CARGO = [1, 3, 5, 6, 7, 8];
const LIMITE_LISTA = 12;

const estado = { municipios: {}, locais: null, pedido: 0 };

const FONTES = {
  secao: 'Fonte: boletim de urna da seção (arquivo -bu.dat publicado pelo TSE em resultados.tse.jus.br, assinado digitalmente) e resultado oficial da cidade. Percentuais sobre os votos válidos (nominais e de legenda).',
  zona: 'Fonte: TSE, votação nominal por município e zona (dados abertos) e locais de votação. Percentuais sobre os votos nominais válidos: o TSE não publica neste arquivo os votos de legenda, brancos e nulos de cada zona.',
  cidade: 'Fonte: resultado oficial da cidade (resultados.tse.jus.br). Percentuais sobre os votos válidos (nominais e de legenda).',
};
const aviso = (mensagem) => Object.assign(new Error(mensagem), { aviso: true });
const soma = (a) => a.reduce((t, v) => t + v, 0);

/** Mostra só os campos que o nível escolhido usa (cidade: sem zona e seção; zona: sem seção). */
function ajustarCampos() {
  el.campoZona.hidden = el.nivel.value === 'cidade';
  el.campoSecao.hidden = el.nivel.value !== 'secao';
}
const pad = (v, n) => String(v).padStart(n, '0');

async function getJson(url) {
  const r = await fetch(url);
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- escolha da seção ----------

function preencherUfs(inicial) {
  const ufs = [...Object.keys(UFS), 'zz'].sort((a, b) => (UFS[a] ?? 'Exterior').localeCompare(UFS[b] ?? 'Exterior', 'pt-BR'));
  el.uf.innerHTML = '<option value="">Escolha…</option>' + ufs.map((u) => `<option value="${u}">${esc(UFS[u] ?? 'Exterior')}</option>`).join('');
  if (inicial && ufs.includes(inicial)) el.uf.value = inicial;
}

async function listaCidades(uf) {
  const t = TURNOS[el.turno.value];
  if (!estado.municipios[t.federal]) {
    // No 2º turno a lista pode demorar a sair: a do 1º turno tem as mesmas cidades.
    const bruto = await getJson(urlMunicipios(BASE, t.federal)) ?? await getJson(urlMunicipios(BASE, TURNOS[1].federal));
    estado.municipios[t.federal] = bruto ? lerMunicipios(bruto) : {};
  }
  return estado.municipios[t.federal][uf] ?? [];
}

async function aoTrocarUf(inicial = {}) {
  el.cidade.value = '';
  el.zona.innerHTML = ''; el.secao.innerHTML = '';
  el.zona.disabled = true; el.secao.disabled = true;
  const uf = el.uf.value;
  if (!uf) return;
  const lista = await listaCidades(uf);
  el.listaCidades.innerHTML = lista.map((m) => `<option value="${esc(m.nome)}"></option>`).join('');
  el.dicaSecao.textContent = `${fmtInt.format(lista.length)} cidades em ${UFS[uf] ?? 'Exterior'}`;
  const m = inicial.mun ? lista.find((x) => x.codigo === inicial.mun) : null;
  if (m) { el.cidade.value = m.nome; await aoEscolherCidade(inicial); }
}

async function cidadeAtual() {
  const lista = await listaCidades(el.uf.value);
  const t = semAcento(el.cidade.value.trim());
  return lista.find((m) => semAcento(m.nome) === t) ?? null;
}

async function aoEscolherCidade(inicial = {}) {
  const m = await cidadeAtual();
  el.zona.innerHTML = ''; el.secao.innerHTML = '';
  el.zona.disabled = true; el.secao.disabled = true;
  estado.locais = null;
  if (!m) return;
  // Zonas e seções da cidade (com o local de votação de cada uma), de public/locais.
  estado.locais = await getJson(`locais/${el.uf.value}/${m.codigo}.json`).catch(() => null);
  if (!estado.locais?.locais?.length) {
    el.dicaSecao.textContent = 'Lista de seções indisponível para esta cidade.';
    if (el.nivel.value === 'cidade') consultar();
    return;
  }
  const zonas = [...new Set(estado.locais.locais.map((l) => l[0]))].sort();
  el.zona.innerHTML = zonas.map((z) => `<option value="${z}">Zona ${Number(z)}</option>`).join('');
  el.zona.disabled = false;
  if (inicial.zona && zonas.includes(inicial.zona)) el.zona.value = inicial.zona;
  preencherSecoes(inicial.secao);
  if (el.nivel.value !== 'secao' || inicial.secao) consultar();
}

function preencherSecoes(inicial) {
  const zona = el.zona.value;
  const linhas = [];
  for (const [z, , nome, bairro, , , , , secoes] of estado.locais.locais) {
    if (z !== zona) continue;
    for (const s of secoes) linhas.push({ s, rotulo: `Seção ${Number(s)} — ${nome}${bairro ? ` (${bairro})` : ''}` });
  }
  linhas.sort((a, b) => a.s.localeCompare(b.s));
  el.secao.innerHTML = '<option value="">Escolha a seção…</option>' + linhas.map((l) => `<option value="${l.s}">${esc(l.rotulo)}</option>`).join('');
  el.secao.disabled = false;
  if (inicial && linhas.some((l) => l.s === inicial)) el.secao.value = inicial;
  el.dicaSecao.textContent = `${fmtInt.format(linhas.length)} seções na zona ${Number(zona)}`;
}

// ---------- consulta ----------

/** Local de votação de uma seção (de public/locais). */
function localDa(zona, secao) {
  const l = estado.locais?.locais.find((x) => x[0] === zona && x[8].includes(secao));
  return l ? { numero: l[1], nome: l[2], bairro: l[3], endereco: l[4], eleitores: l[7] } : null;
}

async function boletimDa(uf, mun, zona, secao, pleito) {
  const dir = `${BASE}/ele2026/arquivo-urna/${pleito}/dados/${uf}/${mun}/${zona}/${secao}`;
  const aux = await getJson(`${dir}/p${pad(pleito, 6)}-${uf}-m${mun}-z${zona}-s${secao}-aux.json`);
  if (!aux) return { aux: null, bu: null };
  for (const h of aux.hashes ?? []) {
    if (!h.hash || h.hash === '0') continue;
    const nome = (h.arq ?? h.nmarq ?? []).map((a) => (typeof a === 'string' ? a : a.nm)).find((n) => /-bu\.dat$/i.test(n ?? ''));
    if (!nome) continue;
    const r = await fetch(`${dir}/${h.hash}/${nome}`);
    if (r.ok) return { aux, bu: lerBoletim(new Uint8Array(await r.arrayBuffer())) };
  }
  return { aux, bu: null };
}

/** Resultado oficial da cidade para um cargo: nomes dos candidatos e percentuais da cidade. */
async function resultadoCidade(ele, uf, cargo, mun) {
  const bruto = await getJson(urlResultado(BASE, ele, uf, cargo, mun)).catch(() => null);
  return bruto ? normalizar(bruto) : null;
}

/** Cargos de cada eleição da cidade no turno escolhido: [[eleição, cargo]]. */
function cargosDoTurno(uf) {
  const t = TURNOS[el.turno.value];
  const lista = [[t.federal, 1]];
  if (uf === 'zz') return lista;
  for (const c of [3, 5, 6, uf === 'df' ? 8 : 7]) if (el.turno.value === '1' || c === 3) lista.push([t.estadual, c]);
  return lista;
}

async function consultar() {
  const nivel = el.nivel.value;
  const uf = el.uf.value;
  const m = await cidadeAtual();
  const zona = el.zona.value;
  const secao = el.secao.value;
  if (!uf || !m || (nivel !== 'cidade' && !zona) || (nivel === 'secao' && !secao)) return;
  const pedido = ++estado.pedido;
  const hash = { turno: el.turno.value, ...(nivel !== 'secao' && { nivel }), uf, mun: m.codigo, ...(nivel !== 'cidade' && { zona }), ...(nivel === 'secao' && { secao }) };
  history.replaceState(null, '', `#${new URLSearchParams(hash)}`);
  el.status.textContent = nivel === 'secao' ? 'consultando o boletim de urna…' : 'consultando…';
  el.status.className = 'status';
  el.erro.hidden = true;
  try {
    const ok = nivel === 'cidade' ? await consultarCidade(pedido, uf, m)
      : nivel === 'zona' ? await consultarZona(pedido, uf, m, zona)
        : await consultarSecao(pedido, uf, m, zona, secao);
    if (!ok) return;
    el.fonte.textContent = FONTES[nivel];
    el.status.textContent = `${nivel === 'secao' ? 'boletim lido' : 'dados lidos'} às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
  } catch (erro) {
    if (pedido !== estado.pedido) return;
    el.ficha.hidden = true;
    el.erro.hidden = false;
    el.erro.textContent = erro.aviso ? erro.message : `Não foi possível ler os dados: ${erro.message}`;
    el.status.textContent = erro.aviso ? 'dados indisponíveis' : 'falha na consulta';
    el.status.className = erro.aviso ? 'status' : 'status falha';
  }
}

async function consultarSecao(pedido, uf, m, zona, secao) {
  const t = TURNOS[el.turno.value];
  let alvo = secao;
  let { aux, bu } = await boletimDa(uf, m.codigo, zona, secao, t.pleito);
  // Seção agregada: votou na urna de outra seção (a principal), e o boletim é o dela.
  const principal = estado.locais?.agregadas?.[`${zona}-${secao}`];
  if (!bu && principal) {
    alvo = principal.split('-')[1];
    ({ aux, bu } = await boletimDa(uf, m.codigo, zona, alvo, t.pleito));
  }
  if (pedido !== estado.pedido) return false;
  if (!bu) {
    throw aviso(aux ? 'O TSE ainda não publicou o boletim desta seção.'
      : el.turno.value === '2' ? 'Boletim do 2º turno ainda não publicado (a apuração é em 25/10, depois das 17h).' : 'Boletim desta seção não encontrado no TSE.');
  }
  // Nomes e percentuais da cidade de cada cargo do boletim.
  const cargos = bu.eleicoes.flatMap((e) => e.cargos.map((c) => ({ ...c, eleicao: e.eleicao, aptos: e.aptos })))
    .filter((c) => NOMES_CARGO[c.cargo])
    .sort((a, b) => ORDEM_CARGO.indexOf(a.cargo) - ORDEM_CARGO.indexOf(b.cargo));
  const cidades = await Promise.all(cargos.map((c) => resultadoCidade(c.eleicao, uf, c.cargo, m.codigo)));
  if (pedido !== estado.pedido) return false;
  // Logs da urna (tempo na cabine, biometria), se a cidade já está na base estática.
  const logs = expandirSecoes(await getJson(`urnas/municipio/${uf}/${m.codigo}.json`).catch(() => null));
  const log = logs?.secoes?.find((s) => s.zona === zona && s.secao === alvo) ?? null;
  if (pedido !== estado.pedido) return false;
  renderizar({ uf, m, zona, secao, alvo, bu, cargos, cidades, local: localDa(zona, secao), log });
  return true;
}

/** Cidade inteira, pelo resultado oficial. Com `zona`: a cidade tem uma zona só, e a zona é a cidade. */
async function consultarCidade(pedido, uf, m, zona = '') {
  const lista = cargosDoTurno(uf);
  const res = await Promise.all(lista.map(([ele, c]) => resultadoCidade(ele, uf, c, m.codigo)));
  if (pedido !== estado.pedido) return false;
  const cargos = lista.map(([, cargo], i) => ({ cargo, r: res[i] })).filter((x) => x.r?.candidatos?.some((c) => c.votos > 0));
  if (!cargos.length) {
    throw aviso(el.turno.value === '2' ? 'Resultado do 2º turno ainda não publicado (a apuração é em 25/10, depois das 17h).' : 'Resultado desta cidade não encontrado no TSE.');
  }
  const { eleitorado, secoes } = cargos[0].r;
  const zonas = new Set((estado.locais?.locais ?? []).map((l) => l[0]));
  cabecalho({
    titulo: zona ? `Zona ${Number(zona)} — ${m.nome} (${uf.toUpperCase()})` : `${m.nome} (${uf.toUpperCase()}) — cidade inteira`,
    sub: zonas.size ? (zonas.size === 1 ? '1 zona eleitoral' : `${fmtInt.format(zonas.size)} zonas eleitorais`) : '',
    kpis: [
      kpi('Eleitores aptos', fmtInt.format(eleitorado.apto)),
      kpi('Compareceram', fmtInt.format(eleitorado.comparecimento), `${pct(eleitorado.percComparecimento)} dos aptos`),
      kpi('Abstenção', fmtInt.format(eleitorado.abstencao), pct(eleitorado.percAbstencao)),
      kpi('Seções apuradas', pct(secoes.percentual), `${fmtInt.format(secoes.totalizadas)} de ${fmtInt.format(secoes.total)}`),
    ],
    nota: zona ? `Nesta cidade só há a zona ${Number(zona)}: os votos da zona aqui são os da cidade inteira (se a zona também atende outras cidades, os votos delas não entram).` : '',
  });
  el.cargos.innerHTML = cargos.map(({ cargo, r }) => cartaoLista(cargo,
    r.candidatos.filter((c) => c.votos > 0).map((c) => ({ rotulo: c.nomeUrna, numero: c.numero, sigla: c.partido, votos: c.votos, pct: c.percentual })),
    { onde: 'na cidade', rodape: `Válidos ${fmtInt.format(r.votos.validos)} · brancos ${fmtInt.format(r.votos.brancos)} · nulos ${fmtInt.format(r.votos.nulos)}` })).join('');
  return true;
}

/** Zona inteira (a parte dela nesta cidade), pelos dados abertos do TSE (public/zonas). */
async function consultarZona(pedido, uf, m, zona) {
  const dados = await getJson(`zonas/t${el.turno.value}/${uf}/${m.codigo}.json`).catch(() => null);
  if (pedido !== estado.pedido) return false;
  const zonasCidade = new Set((estado.locais?.locais ?? []).map((l) => l[0]));
  if (!dados?.zonas?.includes(zona)) {
    if (zonasCidade.size <= 1) return consultarCidade(pedido, uf, m, zona);
    throw aviso(el.turno.value === '2' ? 'Os votos por zona do 2º turno saem nos dados abertos do TSE alguns dias depois da eleição (25/10).'
      : 'Os votos por zona desta cidade ainda não estão disponíveis.');
  }
  const zi = dados.zonas.indexOf(zona);
  const locais = (estado.locais?.locais ?? []).filter((l) => l[0] === zona);
  const cargos = dados.cargos.filter((c) => NOMES_CARGO[c.cargo]).sort((a, b) => ORDEM_CARGO.indexOf(a.cargo) - ORDEM_CARGO.indexOf(b.cargo));
  const totais = cargos.map((c) => ({
    zona: soma(c.candidatos.map((x) => (x[4] ? x[5][zi] : 0))),
    cidade: soma(c.candidatos.map((x) => (x[4] ? soma(x[5]) : 0))),
  }));
  cabecalho({
    titulo: `Zona ${Number(zona)} — ${m.nome} (${uf.toUpperCase()})`,
    sub: `uma das ${dados.zonas.length} zonas da cidade`,
    kpis: [
      kpi('Eleitores aptos', locais.length ? fmtInt.format(soma(locais.map((l) => l[7]))) : '—', 'pelo cadastro dos locais de votação'),
      kpi('Locais de votação', fmtInt.format(locais.length), `${fmtInt.format(soma(locais.map((l) => l[8].length)))} seções`),
      kpi('Votos nominais', fmtInt.format(totais[0]?.zona ?? 0), `${esc(NOMES_CARGO[cargos[0]?.cargo] ?? '')} · ${pct(totais[0]?.cidade ? (totais[0].zona / totais[0].cidade) * 100 : 0)} da cidade`),
    ],
    nota: '',
  });
  el.cargos.innerHTML = cargos.map((c, i) => {
    const t = totais[i];
    const linhas = c.candidatos.filter((x) => x[5][zi] > 0).map((x) => ({
      rotulo: x[4] ? x[1] : `${x[1]} (votos anulados)`, numero: x[0], sigla: x[2], votos: x[5][zi],
      pct: x[4] && t.zona ? (x[5][zi] / t.zona) * 100 : 0,
      cid: x[4] && t.cidade ? (soma(x[5]) / t.cidade) * 100 : null,
    })).sort((a, b) => b.votos - a.votos);
    return cartaoLista(c.cargo, linhas, { onde: 'na zona', cmp: 'na cidade', cabecalho: 'zona · cidade', rodape: `Votos nominais válidos na zona: ${fmtInt.format(t.zona)}` });
  }).join('');
  return true;
}

// ---------- tela ----------

const kpi = (rotulo, valor, detalhe = '') => `<div class="kpi"><dt>${rotulo}</dt><dd><span class="kpi-pct">${valor}</span>${detalhe ? `<small>${detalhe}</small>` : ''}</dd></div>`;
const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}` : '—');

/** Título, indicadores e nota do topo da ficha (seção, zona ou cidade). */
function cabecalho({ titulo, sub, kpis, nota }) {
  el.ficha.hidden = false;
  el.tituloSecao.textContent = titulo;
  el.subSecao.textContent = sub;
  el.resumoSecao.innerHTML = kpis.join('');
  el.notaSecao.textContent = nota;
}

function renderizar({ uf, m, zona, secao, alvo, bu, cargos, cidades, local, log }) {
  const aptos = cargos[0]?.aptos ?? null;
  const comparecimento = cargos[0]?.comparecimento ?? null;
  cabecalho({
    titulo: `Zona ${Number(zona)} · Seção ${Number(secao)} — ${m.nome} (${uf.toUpperCase()})`,
    sub: local ? `${local.nome}${local.bairro ? ` · ${local.bairro}` : ''}${local.endereco ? ` · ${local.endereco}` : ''}` : '',
    kpis: [
    kpi('Eleitores aptos', aptos !== null ? fmtInt.format(aptos) : '—'),
    kpi('Compareceram', comparecimento !== null ? fmtInt.format(comparecimento) : '—', aptos ? `${pct((comparecimento / aptos) * 100)} dos aptos` : ''),
    kpi('Urna aberta / encerrada', bu.abertura ? `${bu.abertura.slice(11, 16)}–${(bu.encerramento ?? '').slice(11, 16)}` : '—', bu.abertura ? bu.abertura.slice(0, 10) : ''),
    log ? kpi('Tempo médio na cabine', mmss(log.cabine?.media), log.votos ? `biometria em ${pct(((log.tipos?.biometrica ?? 0) / log.votos) * 100)} dos eleitores` : '')
      : kpi('Tempo na cabine', '—', 'logs desta urna ainda não compilados'),
    ],
    nota: alvo !== secao
    ? `A seção ${Number(secao)} foi agregada à seção ${Number(alvo)} (votaram na mesma urna): os votos abaixo são do boletim da seção ${Number(alvo)}.`
      : '',
  });
  el.cargos.innerHTML = cargos.map((c, i) => cartaoCargo(c, cidades[i])).join('');
}

function cartaoCargo(c, cidade) {
  const nomes = new Map((cidade?.candidatos ?? []).map((x) => [String(x.numero), x]));
  const siglaPartido = new Map((cidade?.candidatos ?? []).map((x) => [String(x.numero).slice(0, 2), x.partido]));
  const validos = c.votos.filter((v) => v.tipo === 'nominal' || v.tipo === 'legenda').reduce((t, v) => t + v.votos, 0);
  const brancos = c.votos.filter((v) => v.tipo === 'branco').reduce((t, v) => t + v.votos, 0);
  const nulos = c.votos.filter((v) => v.tipo === 'nulo').reduce((t, v) => t + v.votos, 0);
  const linhas = c.votos.filter((v) => v.tipo === 'nominal' || v.tipo === 'legenda').map((v) => {
    const n = nomes.get(String(v.numero));
    const legenda = v.tipo === 'legenda';
    const sigla = legenda ? (siglaPartido.get(String(v.numero).slice(0, 2)) ?? '') : (n?.partido ?? '');
    const cid = n && cidade?.votos?.validos ? (n.votos / cidade.votos.validos) * 100 : null;
    return { rotulo: legenda ? `Voto na legenda ${sigla || v.numero}` : (n?.nomeUrna ?? `Nº ${v.numero}`), numero: v.numero, sigla, votos: v.votos, pct: validos ? (v.votos / validos) * 100 : 0, cid };
  }).sort((a, b) => b.votos - a.votos);
  return cartaoLista(c.cargo, linhas, { onde: 'na seção', cmp: 'na cidade', cabecalho: 'seção · cidade',
    rodape: `Válidos ${fmtInt.format(validos)} · brancos ${fmtInt.format(brancos)} · nulos ${fmtInt.format(nulos)}` });
}

/**
 * Cartão de um cargo: candidatos (do mais votado), barra, votos e % `onde` (na seção, zona ou cidade)
 * e, se houver, o % de comparação (`cid`, na cidade). Nos deputados, só os 12 primeiros abertos.
 */
function cartaoLista(cargo, linhas, { onde, cmp = '', cabecalho: cab = '', rodape = '' }) {
  const cores = coresPorPartido(linhas.map((l) => `${l.numero}`), (k) => linhas.find((l) => `${l.numero}` === k)?.sigla, CATEGORICA);
  const proporcional = cargo >= 6;
  const visiveis = proporcional ? linhas.slice(0, LIMITE_LISTA) : linhas;
  const vagas = cargo === 5 ? `${cab ? ' · ' : ''}cada eleitor votou em até 2 nomes` : '';
  return `<section class="cartao"><div class="linha"><h2>${esc(NOMES_CARGO[cargo])}</h2><span class="mudo pequeno">${esc(cab)}${vagas}</span></div>
    ${visiveis.map((l) => `<div class="cand-linha">
      <span class="cand-nome"><i class="ponto-cor" style="background:${cores.get(`${l.numero}`)}"></i>${esc(l.rotulo)} <span class="mudo">${esc(l.sigla)} ${l.numero}</span></span>
      <span class="cand-barra"><span style="width:${Math.min(100, l.pct)}%;background:${cores.get(`${l.numero}`)}"></span></span>
      <strong>${fmtInt.format(l.votos)}</strong>
      <span class="mudo pequeno">${pct(l.pct)} ${onde}${cmp && l.cid !== null && l.cid !== undefined ? ` · ${pct(l.cid)} ${cmp}` : ''}</span>
    </div>`).join('')}
    ${linhas.length > visiveis.length ? `<details><summary class="pequeno">mais ${linhas.length - visiveis.length} com votos ${onde}</summary>${linhas.slice(LIMITE_LISTA).map((l) => `<div class="pequeno">${esc(l.rotulo)} <span class="mudo">${esc(l.sigla)} ${l.numero}</span>: <strong>${fmtInt.format(l.votos)}</strong></div>`).join('')}</details>` : ''}
    <p class="mudo pequeno">${rodape}${proporcional ? ' · nos deputados, as vagas são do estado inteiro (ver Apuração)' : ''}</p>
  </section>`;
}

// ---------- eventos ----------

el.turno.addEventListener('change', consultar);
el.nivel.addEventListener('change', () => { ajustarCampos(); el.ficha.hidden = true; el.erro.hidden = true; consultar(); });
el.uf.addEventListener('change', () => aoTrocarUf());
el.cidade.addEventListener('change', () => aoEscolherCidade());
el.zona.addEventListener('change', () => { preencherSecoes(); el.ficha.hidden = true; if (el.nivel.value === 'zona') consultar(); });
el.secao.addEventListener('change', consultar);
el.imprimir.addEventListener('click', () => antesDeExportar(() => print()));

const inicial = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
if (inicial.turno && TURNOS[inicial.turno]) el.turno.value = inicial.turno;
if (inicial.nivel && FONTES[inicial.nivel]) el.nivel.value = inicial.nivel;
ajustarCampos();
preencherUfs(inicial.uf);
el.status.textContent = 'escolha a seção';
el.status.className = 'status';
if (inicial.uf) aoTrocarUf(inicial).catch(() => {});
