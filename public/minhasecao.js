// Minha seção: os votos de uma seção eleitoral, lidos do boletim de urna (BU) que o TSE publica
// para cada seção, com os nomes dos candidatos e a comparação com a cidade (resultado oficial).
// Cada consulta baixa dois arquivos pequenos da seção (aux.json e -bu.dat), pelo relay /tse, em
// cache no CDN (o boletim não muda depois de publicado).

import { antesDeExportar } from './citar.js';
import { coresPorPartido, esc, expandirSecoes, fmtInt, pct, semAcento } from './comum.js';
import { lerBoletim } from './bu.js';
import { CATEGORICA } from './mapa.js';
import { ELEICOES, UFS, lerMunicipios, normalizar, urlMunicipios, urlResultado } from './tse.js';

const BASE = 'tse';
const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(['turno', 'uf', 'cidade', 'lista-cidades', 'zona', 'secao', 'dica-secao', 'erro', 'ficha', 'titulo-secao', 'sub-secao',
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
  if (!estado.locais?.locais?.length) { el.dicaSecao.textContent = 'Lista de seções indisponível para esta cidade.'; return; }
  const zonas = [...new Set(estado.locais.locais.map((l) => l[0]))].sort();
  el.zona.innerHTML = zonas.map((z) => `<option value="${z}">Zona ${Number(z)}</option>`).join('');
  el.zona.disabled = false;
  if (inicial.zona && zonas.includes(inicial.zona)) el.zona.value = inicial.zona;
  preencherSecoes(inicial.secao);
  if (inicial.secao) consultar();
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

async function consultar() {
  const pedido = ++estado.pedido;
  const uf = el.uf.value;
  const m = await cidadeAtual();
  const zona = el.zona.value;
  const secao = el.secao.value;
  if (!uf || !m || !zona || !secao) return;
  const t = TURNOS[el.turno.value];
  history.replaceState(null, '', `#${new URLSearchParams({ turno: el.turno.value, uf, mun: m.codigo, zona, secao })}`);
  el.status.textContent = 'consultando o boletim de urna…';
  el.status.className = 'status';
  el.erro.hidden = true;
  try {
    let alvo = secao;
    let { aux, bu } = await boletimDa(uf, m.codigo, zona, secao, t.pleito);
    // Seção agregada: votou na urna de outra seção (a principal), e o boletim é o dela.
    const principal = estado.locais?.agregadas?.[`${zona}-${secao}`];
    if (!bu && principal) {
      alvo = principal.split('-')[1];
      ({ aux, bu } = await boletimDa(uf, m.codigo, zona, alvo, t.pleito));
    }
    if (pedido !== estado.pedido) return;
    if (!bu) {
      throw Object.assign(new Error(aux ? 'O TSE ainda não publicou o boletim desta seção.'
        : el.turno.value === '2' ? 'Boletim do 2º turno ainda não publicado (a apuração é em 25/10, depois das 17h).' : 'Boletim desta seção não encontrado no TSE.'), { aviso: true });
    }
    // Nomes e percentuais da cidade de cada cargo do boletim.
    const cargos = bu.eleicoes.flatMap((e) => e.cargos.map((c) => ({ ...c, eleicao: e.eleicao, aptos: e.aptos })))
      .filter((c) => NOMES_CARGO[c.cargo])
      .sort((a, b) => ORDEM_CARGO.indexOf(a.cargo) - ORDEM_CARGO.indexOf(b.cargo));
    const cidades = await Promise.all(cargos.map((c) => resultadoCidade(c.eleicao, uf, c.cargo, m.codigo)));
    if (pedido !== estado.pedido) return;
    // Logs da urna (tempo na cabine, biometria), se a cidade já está na base estática.
    const logs = expandirSecoes(await getJson(`urnas/municipio/${uf}/${m.codigo}.json`).catch(() => null));
    const log = logs?.secoes?.find((s) => s.zona === zona && s.secao === alvo) ?? null;
    renderizar({ uf, m, zona, secao, alvo, bu, cargos, cidades, local: localDa(zona, secao), log });
    el.status.textContent = `boletim lido às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
  } catch (erro) {
    if (pedido !== estado.pedido) return;
    el.ficha.hidden = true;
    el.erro.hidden = false;
    el.erro.textContent = erro.aviso ? erro.message : `Não foi possível ler o boletim: ${erro.message}`;
    el.status.textContent = erro.aviso ? 'boletim indisponível' : 'falha na consulta';
    el.status.className = erro.aviso ? 'status' : 'status falha';
  }
}

// ---------- tela ----------

const kpi = (rotulo, valor, detalhe = '') => `<div class="kpi"><dt>${rotulo}</dt><dd><span class="kpi-pct">${valor}</span>${detalhe ? `<small>${detalhe}</small>` : ''}</dd></div>`;
const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}` : '—');

function renderizar({ uf, m, zona, secao, alvo, bu, cargos, cidades, local, log }) {
  el.ficha.hidden = false;
  el.tituloSecao.textContent = `Zona ${Number(zona)} · Seção ${Number(secao)} — ${m.nome} (${uf.toUpperCase()})`;
  el.subSecao.textContent = local ? `${local.nome}${local.bairro ? ` · ${local.bairro}` : ''}${local.endereco ? ` · ${local.endereco}` : ''}` : '';
  const aptos = cargos[0]?.aptos ?? null;
  const comparecimento = cargos[0]?.comparecimento ?? null;
  el.resumoSecao.innerHTML = [
    kpi('Eleitores aptos', aptos !== null ? fmtInt.format(aptos) : '—'),
    kpi('Compareceram', comparecimento !== null ? fmtInt.format(comparecimento) : '—', aptos ? `${pct((comparecimento / aptos) * 100)} dos aptos` : ''),
    kpi('Urna aberta / encerrada', bu.abertura ? `${bu.abertura.slice(11, 16)}–${(bu.encerramento ?? '').slice(11, 16)}` : '—', bu.abertura ? bu.abertura.slice(0, 10) : ''),
    log ? kpi('Tempo médio na cabine', mmss(log.cabine?.media), log.votos ? `biometria em ${pct(((log.tipos?.biometrica ?? 0) / log.votos) * 100)} dos eleitores` : '')
      : kpi('Tempo na cabine', '—', 'logs desta urna ainda não compilados'),
  ].join('');
  el.notaSecao.textContent = alvo !== secao
    ? `A seção ${Number(secao)} foi agregada à seção ${Number(alvo)} (votaram na mesma urna): os votos abaixo são do boletim da seção ${Number(alvo)}.`
    : '';
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
  const cores = coresPorPartido(linhas.map((l) => `${l.numero}`), (k) => linhas.find((l) => `${l.numero}` === k)?.sigla, CATEGORICA);
  const proporcional = c.cargo >= 6;
  const visiveis = proporcional ? linhas.slice(0, LIMITE_LISTA) : linhas;
  const vagas = c.cargo === 5 ? ' · cada eleitor votou em até 2 nomes' : '';
  return `<section class="cartao"><div class="linha"><h2>${esc(NOMES_CARGO[c.cargo])}</h2><span class="mudo pequeno">seção · cidade${vagas}</span></div>
    ${visiveis.map((l) => `<div class="cand-linha">
      <span class="cand-nome"><i class="ponto-cor" style="background:${cores.get(`${l.numero}`)}"></i>${esc(l.rotulo)} <span class="mudo">${esc(l.sigla)} ${l.numero}</span></span>
      <span class="cand-barra"><span style="width:${Math.min(100, l.pct)}%;background:${cores.get(`${l.numero}`)}"></span></span>
      <strong>${fmtInt.format(l.votos)}</strong>
      <span class="mudo pequeno">${pct(l.pct)} na seção${l.cid !== null ? ` · ${pct(l.cid)} na cidade` : ''}</span>
    </div>`).join('')}
    ${linhas.length > visiveis.length ? `<details><summary class="pequeno">mais ${linhas.length - visiveis.length} com votos nesta seção</summary>${linhas.slice(LIMITE_LISTA).map((l) => `<div class="pequeno">${esc(l.rotulo)} <span class="mudo">${esc(l.sigla)} ${l.numero}</span>: <strong>${fmtInt.format(l.votos)}</strong></div>`).join('')}</details>` : ''}
    <p class="mudo pequeno">Válidos ${fmtInt.format(validos)} · brancos ${fmtInt.format(brancos)} · nulos ${fmtInt.format(nulos)}${proporcional ? ' · nos deputados, as vagas são do estado inteiro (ver Apuração)' : ''}</p>
  </section>`;
}

// ---------- eventos ----------

el.turno.addEventListener('change', () => { if (el.secao.value) consultar(); });
el.uf.addEventListener('change', () => aoTrocarUf());
el.cidade.addEventListener('change', () => aoEscolherCidade());
el.zona.addEventListener('change', () => { preencherSecoes(); el.ficha.hidden = true; });
el.secao.addEventListener('change', consultar);
el.imprimir.addEventListener('click', () => antesDeExportar(() => print()));

const inicial = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
if (inicial.turno && TURNOS[inicial.turno]) el.turno.value = inicial.turno;
preencherUfs(inicial.uf);
el.status.textContent = 'escolha a seção';
el.status.className = 'status';
if (inicial.uf) aoTrocarUf(inicial).catch(() => {});
