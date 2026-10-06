// Ficha do município: resultado da eleição, eleitorado, Censo, saúde e desenvolvimento de uma
// cidade, cada indicador comparado com o estado e com todas as cidades do Brasil (posição).

import {
  cargoPorValor, carregarEstados, carregarMunicipios, coresPorPartido, esc, fmtInt, fmtNum, nomeUf, pct, regiaoDe, semAcento,
} from './comum.js';
import { candidatosDe, lerMunicipios } from './tse.js';
import { CATEGORICA } from './mapa.js';
import { antesDeExportar } from './citar.js';

const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(['busca-municipio', 'lista-municipios', 'sortear', 'sugestoes', 'erro', 'ficha', 'nome-municipio', 'local-municipio',
  'resumo-municipio', 'eleicao', 'bloco-eleitorado', 'bloco-votos', 'bloco-censo', 'bloco-domicilios', 'bloco-saude', 'bloco-renda', 'status', 'imprimir']
  .map((id) => [id.replace(/-(\w)/g, (_, l) => l.toUpperCase()), $(id)]));

const CARGOS_FICHA = ['6257:1', '6259:3', '6259:5'];
// Indicadores: [preset, rótulo curto, bloco, formato]. Os "arq:" vêm dos retratos em public/fontes.
const INDICADORES = [
  ['arq:eleitorado-2026:eleitores', 'Eleitores', 'eleitorado', 'int'],
  ['arq:eleitorado-2026:mulheres', 'Mulheres no eleitorado', 'eleitorado', '%'],
  ['arq:eleitorado-2026:jovens', 'Eleitores de 16 a 24 anos', 'eleitorado', '%'],
  ['arq:eleitorado-2026:idosos', 'Eleitores com 60 anos ou mais', 'eleitorado', '%'],
  ['arq:eleitorado-2026:superior', 'Com superior completo', 'eleitorado', '%'],
  ['arq:eleitorado-2026:analfabetos', 'Analfabetos', 'eleitorado', '%'],
  ['arq:eleitorado-2026:biometria', 'Com biometria', 'eleitorado', '%'],
  ['populacao', 'População', 'censo', 'int'],
  ['densidade', 'Habitantes por km²', 'censo', 'num'],
  ['idadeMediana', 'Idade mediana', 'censo', 'anos'],
  ['envelhecimento', 'Idosos por 100 jovens', 'censo', 'num'],
  ['alfabetizacao', 'Alfabetização (15+)', 'censo', '%'],
  ['cor_pardos', 'Pardos', 'censo', '%'],
  ['cor_pretos', 'Pretos', 'censo', '%'],
  ['esgotoRede', 'Esgoto na rede geral', 'domicilios', '%'],
  ['aguaRede', 'Água da rede geral', 'domicilios', '%'],
  ['lixoColetado', 'Lixo coletado', 'domicilios', '%'],
  ['arq:saude-cnes:ubsTaxa', 'Unidades básicas por 10 mil hab.', 'saude', 'num'],
  ['arq:saude-cnes:hospitaisTaxa', 'Hospitais por 100 mil hab.', 'saude', 'num'],
  ['arq:saude-cnes:capsTaxa', 'CAPS por 100 mil hab.', 'saude', 'num'],
  ['pibPerCapita', 'PIB por habitante', 'renda', 'R$'],
  ['ipea:idhm', 'IDHM (2010)', 'renda', 'idx'],
  ['ipea:renda', 'Renda per capita (2010)', 'renda', 'R$'],
  ['ipea:gini', 'Desigualdade (Gini, 2010)', 'renda', 'idx'],
  ['ipea:pobres', 'Pobres (2010)', 'renda', '%'],
];

const estado = { municipios: [], series: new Map(), pedido: 0 };
const fmt = (v, f) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (f === 'int') return fmtInt.format(Math.round(v));
  if (f === '%') return pct(v);
  if (f === 'R$') return `R$ ${fmtInt.format(Math.round(v))}`;
  if (f === 'anos') return `${fmtNum.format(v)} anos`;
  if (f === 'idx') return v.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return fmtNum.format(v);
};

async function getJson(url) {
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
  return d;
}

// Séries (cada uma baixada uma vez): retratos em public/fontes ou /api/censo/serie.
const arquivos = new Map();
function serie(preset) {
  if (!estado.series.has(preset)) {
    let p;
    if (preset.startsWith('arq:')) {
      const [, arq] = preset.split(':');
      if (!arquivos.has(arq)) arquivos.set(arq, getJson(`fontes/${arq}.json`));
      p = arquivos.get(arq).then((d) => d.series.find((s) => s.preset === preset) ?? null);
    } else {
      p = getJson(`api/censo/serie?preset=${encodeURIComponent(preset)}`);
    }
    p = p.then((s) => {
      if (!s) return null;
      const valores = Object.values(s.municipios).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      return { ...s, ordenados: valores };
    }).catch(() => null);
    estado.series.set(preset, p);
  }
  return estado.series.get(preset);
}

/** Fração das cidades com valor menor (0 a 1). */
function posicao(ordenados, v) {
  if (!ordenados?.length || !Number.isFinite(v)) return null;
  let lo = 0;
  let hi = ordenados.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ordenados[m] < v) lo = m + 1; else hi = m; }
  return lo / ordenados.length;
}
const mediana = (o) => (o?.length ? o[Math.floor(o.length / 2)] : null);

function textoPosicao(pos, onde = 'das cidades') {
  if (pos === null) return '';
  if (pos >= 0.995) return `entre os maiores valores ${onde}`;
  if (pos <= 0.005) return `entre os menores valores ${onde}`;
  return `maior que ${Math.round(pos * 100)}% ${onde}`;
}

function linhaIndicador(rotulo, valor, f, uf, mediaBr, pos, ufSigla, onde = 'das cidades') {
  const p = pos === null ? null : Math.round(pos * 100);
  const rodape = [
    uf !== null && uf !== undefined && Number.isFinite(uf) ? `${ufSigla}: ${fmt(uf, f)}` : '',
    mediaBr !== null && Number.isFinite(mediaBr) ? `mediana das cidades: ${fmt(mediaBr, f)}` : '',
    textoPosicao(pos, onde),
  ].filter(Boolean).join(' · ');
  return `<div class="indicador">
    <div class="ind-topo"><span class="ind-rotulo">${esc(rotulo)}</span><strong class="ind-valor">${esc(fmt(valor, f))}</strong></div>
    ${p === null ? '' : `<div class="ind-barra" role="img" aria-label="maior que ${p}% das cidades"><span class="ind-marca" style="left:${Math.min(98, Math.max(2, p))}%"></span></div>`}
    <div class="ind-rodape mudo">${esc(rodape)}</div>
  </div>`;
}

// ---------- lista de cidades ----------

async function carregarLista() {
  const cfg = lerMunicipios(await getJson('tse/ele2026/6257/config/mun-e006257-cm.json'));
  for (const [uf, lista] of Object.entries(cfg)) {
    if (uf === 'zz') continue; // exterior: sem dados do IBGE
    for (const m of lista) estado.municipios.push({ ...m, uf, rotulo: `${m.nome} (${uf.toUpperCase()})` });
  }
  estado.municipios.sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  el.listaMunicipios.innerHTML = estado.municipios.map((m) => `<option value="${esc(m.rotulo)}"></option>`).join('');
  el.status.textContent = `${fmtInt.format(estado.municipios.length)} cidades`;
  el.status.className = 'status ok';
}

function acharMunicipio(texto) {
  const t = semAcento(texto.trim());
  if (!t) return null;
  return estado.municipios.find((m) => semAcento(m.rotulo) === t)
    ?? estado.municipios.find((m) => semAcento(m.nome) === t)
    ?? null;
}

// ---------- ficha ----------

async function mostrar(m) {
  const pedido = ++estado.pedido;
  el.ficha.hidden = false;
  el.erro.hidden = true;
  el.nomeMunicipio.textContent = m.nome;
  el.localMunicipio.textContent = `${nomeUf(m.uf)} · ${regiaoDe(m.uf)} · código IBGE ${m.ibge ?? '—'} · TSE ${m.codigo}`;
  el.resumoMunicipio.textContent = 'carregando…';
  history.replaceState(null, '', `#mun=${m.uf}-${m.codigo}`);
  el.status.textContent = 'consultando…';
  el.status.className = 'status';
  const [eleicao, indicadores] = await Promise.all([dadosEleicao(m), dadosIndicadores(m)]);
  if (pedido !== estado.pedido) return;
  renderizarEleicao(m, eleicao);
  renderizarIndicadores(m, indicadores, eleicao);
  renderizarResumo(m, eleicao, indicadores);
  el.status.textContent = `${m.rotulo} · consultado às ${new Date().toLocaleTimeString('pt-BR')}`;
  el.status.className = 'status ok';
}

async function dadosEleicao(m) {
  return Promise.all(CARGOS_FICHA.map(async (v) => {
    const cargo = cargoPorValor(v);
    try {
      // A lista do estado pode chegar incompleta na primeira consulta: tenta de novo algumas vezes.
      const doEstado = async () => {
        let d = await carregarMunicipios(cargo, m.uf);
        for (let i = 0; i < 6 && !d.municipios?.some((x) => x.codigo === m.codigo) && (d.lendo || d.pendentes); i += 1) {
          await new Promise((r) => setTimeout(r, 2500));
          d = await carregarMunicipios(cargo, m.uf);
        }
        return d;
      };
      const [ufDados, br] = await Promise.all([
        doEstado(),
        cargo.abrangencias.includes('br') ? carregarEstados(cargo, { fundo: true }).catch(() => null) : null,
      ]);
      const local = ufDados.municipios?.find((x) => x.codigo === m.codigo) ?? null;
      return { cargo, local, uf: ufDados.consolidado, br: br?.brasil ?? null, nomes: { ...(br?.nomes ?? {}), ...(ufDados.nomes ?? {}) }, cidades: ufDados.municipios ?? [] };
    } catch {
      return { cargo, local: null };
    }
  }));
}

async function dadosIndicadores(m) {
  const lista = await Promise.all(INDICADORES.map(async ([preset, rotulo, bloco, f]) => {
    const s = await serie(preset);
    if (!s) return null;
    const v = s.municipios[m.ibge];
    if (v === undefined || v === null) return null;
    return { preset, rotulo, bloco, f, valor: v, uf: s.ufs?.[m.uf] ?? null, mediana: mediana(s.ordenados), pos: posicao(s.ordenados, v) };
  }));
  return lista.filter(Boolean);
}

function renderizarEleicao(m, eleicao) {
  el.eleicao.innerHTML = eleicao.map(({ cargo, local, uf, br, nomes }) => {
    if (!local?.validos) return `<div class="ficha-cargo"><h3>${esc(cargo.nome)}</h3><p class="mudo">Sem votos apurados para esta cidade.</p></div>`;
    const cands = candidatosDe(local, nomes).slice(0, 5);
    const cores = coresPorPartido(cands.map((c) => c.numero), (n) => nomes[n]?.[1], CATEGORICA);
    const pctEm = (r, n) => (r?.validos && r.cand?.[n] !== undefined ? (r.cand[n] / r.validos) * 100 : null);
    return `<div class="ficha-cargo"><h3>${esc(cargo.nome)}</h3>
      ${cands.map((c) => `<div class="cand-linha">
        <span class="cand-nome"><i class="ponto-cor" style="background:${cores.get(c.numero)}"></i>${esc(c.nome)} <span class="mudo">(${esc(c.partido)})</span></span>
        <span class="cand-barra"><span style="width:${Math.min(100, c.pct)}%;background:${cores.get(c.numero)}"></span></span>
        <strong>${pct(c.pct)}</strong>
        <span class="mudo pequeno">${[pctEm(uf, c.numero) !== null ? `${m.uf.toUpperCase()} ${pct(pctEm(uf, c.numero))}` : '', pctEm(br, c.numero) !== null ? `BR ${pct(pctEm(br, c.numero))}` : ''].filter(Boolean).join(' · ')}</span>
      </div>`).join('')}
    </div>`;
  }).join('');
}

function renderizarIndicadores(m, ind, eleicao) {
  const ufS = m.uf.toUpperCase();
  const blocos = { eleitorado: el.blocoEleitorado, censo: el.blocoCenso, domicilios: el.blocoDomicilios, saude: el.blocoSaude, renda: el.blocoRenda };
  for (const [nome, alvo] of Object.entries(blocos)) {
    const lista = ind.filter((i) => i.bloco === nome);
    alvo.innerHTML = lista.length ? lista.map((i) => linhaIndicador(i.rotulo, i.valor, i.f, i.uf, i.mediana, i.pos, ufS)).join('') : '<p class="mudo">Fonte indisponível no momento.</p>';
  }
  // Comparecimento e votos: posição entre as cidades do estado (a lista vem com o resultado).
  const pres = eleicao[0];
  if (!pres?.local) { el.blocoVotos.innerHTML = '<p class="mudo">Sem resultado apurado.</p>'; return; }
  const doEstado = (f) => pres.cidades.map(f).filter(Number.isFinite).sort((a, b) => a - b);
  const linhas = [
    ['Comparecimento', (r) => r.pctComparecimento],
    ['Abstenção', (r) => r.pctAbstencao],
    ['Brancos + nulos', (r) => r.pctBrancosNulos],
    ['Votos válidos', (r) => r.pctValidos],
  ].map(([rot, f]) => {
    const ord = doEstado(f);
    const p = posicao(ord, f(pres.local));
    return linhaIndicador(rot, f(pres.local), '%', pres.uf ? f(pres.uf) : null, null, p, ufS, `das cidades de ${ufS}`);
  });
  el.blocoVotos.innerHTML = linhas.join('');
}

function renderizarResumo(m, eleicao, ind) {
  const partes = [];
  const pop = ind.find((i) => i.preset === 'populacao');
  const ele = ind.find((i) => i.preset === 'arq:eleitorado-2026:eleitores');
  partes.push(`<strong>${esc(m.nome)}</strong> (${esc(m.uf.toUpperCase())})${pop ? ` tem ${esc(fmt(pop.valor, 'int'))} habitantes` : ''}${ele ? `${pop ? ' e' : ' tem'} ${esc(fmt(ele.valor, 'int'))} eleitores` : ''}.`);
  const pres = eleicao[0];
  if (pres?.local?.validos) {
    const [c1, c2] = candidatosDe(pres.local, pres.nomes);
    if (c1) {
      const br = pres.br?.validos && pres.br.cand?.[c1.numero] !== undefined ? (pres.br.cand[c1.numero] / pres.br.validos) * 100 : null;
      partes.push(`Para presidente, <strong>${esc(c1.nome)}</strong> teve ${pct(c1.pct)} dos votos válidos${br !== null ? ` (no Brasil, ${pct(br)})` : ''}${c2 ? `, à frente de ${esc(c2.nome)} (${pct(c2.pct)})` : ''}.`);
    }
  }
  // Destaques: os indicadores em que a cidade está mais nas pontas do país.
  const pontas = ind.filter((i) => i.pos !== null && !['populacao', 'arq:eleitorado-2026:eleitores'].includes(i.preset))
    .map((i) => ({ ...i, d: Math.abs(i.pos - 0.5) })).sort((a, b) => b.d - a.d).slice(0, 3).filter((i) => i.d >= 0.35);
  if (pontas.length) {
    partes.push(`Destaques: ${pontas.map((i) => `${esc(i.rotulo.toLowerCase())} ${i.pos >= 0.5 ? `entre os ${Math.max(1, Math.round((1 - i.pos) * 100))}% mais altos` : `entre os ${Math.max(1, Math.round(i.pos * 100))}% mais baixos`} do país (${esc(fmt(i.valor, i.f))})`).join('; ')}.`);
  }
  el.resumoMunicipio.innerHTML = `<strong>Em resumo:</strong> ${partes.join(' ')}`;
}

// ---------- eventos ----------

function escolher() {
  const m = acharMunicipio(el.buscaMunicipio.value);
  if (m) { el.sugestoes.textContent = ''; mostrar(m); return; }
  const t = semAcento(el.buscaMunicipio.value.trim());
  if (t.length < 3) return;
  const parecidas = estado.municipios.filter((x) => semAcento(x.nome).includes(t)).slice(0, 6);
  el.sugestoes.innerHTML = parecidas.length ? `Você quis dizer: ${parecidas.map((x) => `<a href="#mun=${x.uf}-${x.codigo}" data-mun="${x.uf}-${x.codigo}">${esc(x.rotulo)}</a>`).join(', ')}?` : 'Nenhuma cidade com esse nome.';
}

el.buscaMunicipio.addEventListener('change', escolher);
el.buscaMunicipio.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') escolher(); });
el.sugestoes.addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-mun]');
  if (!a) return;
  ev.preventDefault();
  const m = porChave(a.dataset.mun);
  if (m) { el.buscaMunicipio.value = m.rotulo; el.sugestoes.textContent = ''; mostrar(m); }
});
el.sortear.addEventListener('click', () => {
  const m = estado.municipios[Math.floor(Math.random() * estado.municipios.length)];
  if (m) { el.buscaMunicipio.value = m.rotulo; mostrar(m); }
});
el.imprimir.addEventListener('click', () => antesDeExportar(() => print()));

const porChave = (k) => { const [uf, cod] = k.split('-'); return estado.municipios.find((x) => x.uf === uf && x.codigo === cod) ?? null; };

carregarLista().then(() => {
  const h = new URLSearchParams(location.hash.slice(1)).get('mun');
  const m = h ? porChave(h) : null;
  if (m) { el.buscaMunicipio.value = m.rotulo; mostrar(m); }
}).catch((erro) => {
  el.erro.hidden = false;
  el.erro.textContent = `Não foi possível carregar a lista de cidades: ${erro.message}`;
  el.status.textContent = 'falha';
  el.status.className = 'status falha';
});
