import './citar.js';
import './exportar.js';
import {
  ABRANGENCIAS, CARGOS_CANDIDATOS_CONSELHO, ELEICOES, lerMunicipios, normalizar,
  urlFoto, urlMunicipios, urlResultado, votosPorPartido,
} from './tse.js';

// Pelo servidor local (`node server.js`) as consultas passam pelo proxy `/tse`.
// Com `?direto=1` o navegador consulta o TSE diretamente (depende de CORS do TSE).
const BASE = new URLSearchParams(location.search).has('direto')
  ? 'https://resultados.tse.jus.br/oficial'
  : 'tse';
// Durante a apuração consulta a cada 20 s (o CDN entrega a mesma cópia a todos os usuários);
// com 100% das seções totalizadas o resultado é final e a atualização automática para.
const INTERVALO_MS = 20_000;
const PAGINA = 30;

const $ = (id) => document.getElementById(id);
const el = {
  eleicao: $('eleicao'), cargo: $('cargo'), abrangencia: $('abrangencia'), municipio: $('municipio'),
  status: $('status'), atualizar: $('atualizar'), auto: $('auto'), erro: $('erro'),
  titulo: $('titulo'), horario: $('horario'), barra: $('barra-secoes'), pctSecoes: $('pct-secoes'),
  secoes: $('secoes'), candidatos: $('candidatos'), mais: $('mais'), busca: $('busca'),
  partidosCartao: $('partidos-cartao'), notaNoronha: $('nota-noronha'), partidos: $('partidos'), gerais: $('gerais'),
};

const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctTxt = (v) => `${fmtPct.format(v)}%`;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const estado = {
  pedido: 0,
  dados: null,
  limite: PAGINA,
  municipios: {}, // eleição → { uf → [{codigo, nome}] }
  cargosDescobertos: {}, // eleição → código do cargo
  timer: null,
};

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404 || res.status === 403) {
    const erro = new Error('Arquivo ainda não publicado pelo TSE.');
    erro.indisponivel = true;
    throw erro;
  }
  if (!res.ok) throw new Error(`O TSE respondeu HTTP ${res.status}.`);
  return res.json();
}

// ---------- filtros ----------

function preencher(select, opcoes, valor) {
  select.innerHTML = opcoes.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  if (opcoes.some(([v]) => String(v) === String(valor))) select.value = valor;
}

// O TSE separa cada turno em várias "eleições" (6257 federal, 6259 estaduais, 6261 Conselho de
// Fernando de Noronha…). No menu elas aparecem juntas, por ano e turno; o cargo carrega o código
// da eleição do TSE ("6259:2" = Senador).
const TURNOS = [
  { id: '2026-1', nome: '2026 · 1º turno (4/10)', eleicoes: ['6257', '6259', '6261'] },
  { id: '2026-2', nome: '2026 · 2º turno (25/10)', eleicoes: ['6258', '6260'] },
].map((t) => ({ ...t, eleicoes: t.eleicoes.filter((e) => ELEICOES[e]) }));
const turnoDe = (ele) => TURNOS.find((t) => t.eleicoes.includes(String(ele))) ?? TURNOS[0];
const turnoAtual = () => TURNOS.find((t) => t.id === el.eleicao.value) ?? TURNOS[0];

// Fernando de Noronha (PE) aparece como uma opção de abrangência: escolhida, a tela passa ao
// Conselho Distrital (cargo próprio do arquipélago, sem partidos) e volta ao normal ao sair.
const NORONHA = 'pe-noronha';
const nomeAbr = (a) => (a === NORONHA ? 'PE · Fernando de Noronha' : ABRANGENCIAS[a]);
const conselhoDoTurno = () => turnoAtual().eleicoes.flatMap((e) => ELEICOES[e].cargos.map((c, i) => ({ e, i, c }))).find((x) => x.c.descobrir) ?? null;
const modoNoronha = () => el.abrangencia.value === NORONHA && !!conselhoDoTurno();
const ufAtual = () => (el.abrangencia.value === NORONHA ? 'pe' : el.abrangencia.value);
// Cargo escolhido no menu (guardado enquanto o modo Noronha está ativo, para voltar a ele).
const cargoMenu = () => (el.cargo.value && el.cargo.value !== NORONHA ? el.cargo.value : estado.cargoMenu) || `${turnoAtual().eleicoes[0]}:0`;
const eleAtual = () => (modoNoronha() ? conselhoDoTurno().e : cargoMenu().split(':')[0]);
const eleicaoAtual = () => ELEICOES[eleAtual()];
const cargoAtual = () => (modoNoronha() ? conselhoDoTurno().c
  : ELEICOES[cargoMenu().split(':')[0]].cargos[Number(cargoMenu().split(':')[1])] ?? eleicaoAtual().cargos[0]);

function montarFiltros(inicial = {}) {
  preencher(el.eleicao, TURNOS.map((t) => [t.id, t.nome]), turnoDe(inicial.ele).id);
  atualizarCargos(inicial);
}

function atualizarCargos(inicial = {}) {
  const opcoes = turnoAtual().eleicoes.flatMap((e) => ELEICOES[e].cargos.map((c, i) => [`${e}:${i}`, c.nome, c]))
    .filter(([, , c]) => !c.descobrir).map(([v, t]) => [v, t]);
  const pedido = inicial.ele !== undefined ? `${inicial.ele}:${inicial.cargo ?? 0}` : estado.cargoMenu;
  preencher(el.cargo, opcoes, opcoes.some(([v]) => v === pedido) ? pedido : opcoes[0][0]);
  estado.cargoMenu = el.cargo.value;
  // Link antigo do Conselho Distrital (ele=6261): abre direto em Fernando de Noronha.
  const conselho = ELEICOES[inicial.ele]?.cargos.some((c) => c.descobrir);
  atualizarAbrangencias(conselho ? { ...inicial, abr: NORONHA } : inicial);
}

function atualizarAbrangencias(inicial = {}) {
  const atual = inicial.abr ?? el.abrangencia.value;
  const cargo = ELEICOES[cargoMenu().split(':')[0]].cargos[Number(cargoMenu().split(':')[1])];
  const opcoes = cargo.abrangencias.map((a) => [a, ABRANGENCIAS[a]]);
  if (conselhoDoTurno()) {
    const i = opcoes.findIndex(([a]) => a === 'pe');
    opcoes.splice(i < 0 ? opcoes.length : i + 1, 0, [NORONHA, 'PE · Fernando de Noronha (Conselho Distrital)']);
  }
  preencher(el.abrangencia, opcoes, atual);
  aplicarModo();
}

// Modo Noronha: o cargo vira "Conselheiro Distrital" (fixo), o município fica fixo e a nota explica.
function aplicarModo() {
  const noronha = modoNoronha();
  if (noronha && el.cargo.value !== NORONHA) {
    estado.cargoMenu = el.cargo.value;
    el.cargo.innerHTML = `<option value="${NORONHA}">${esc(conselhoDoTurno().c.nome.replace(/\s*\(.*\)$/, ''))}</option>`;
  } else if (!noronha && el.cargo.value === NORONHA) {
    atualizarCargos();
    return;
  }
  el.cargo.disabled = noronha;
  el.notaNoronha.hidden = !noronha;
}

async function atualizarMunicipios(inicial = {}) {
  const uf = ufAtual();
  const ele = eleAtual();
  el.municipio.innerHTML = '<option value="">Todos</option>';
  el.municipio.disabled = uf === 'br' || modoNoronha();
  if (modoNoronha()) { el.municipio.innerHTML = '<option value="">Fernando de Noronha</option>'; return; }
  if (uf === 'br') return;
  try {
    if (!estado.municipios[ele]) estado.municipios[ele] = lerMunicipios(await getJson(urlMunicipios(BASE, ele)));
    if (ufAtual() !== uf || eleAtual() !== ele || modoNoronha()) return; // o filtro mudou enquanto a lista baixava
    const lista = estado.municipios[ele][uf] ?? [];
    preencher(el.municipio, [['', 'Todos'], ...lista.map((m) => [m.codigo, m.nome])], inicial.mun ?? '');
  } catch {
    // Sem a lista de municípios o app continua funcionando no nível da UF.
  }
}

function lerHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { ele: p.get('ele') ?? '6257', cargo: p.get('cargo') ?? 0, abr: p.get('abr') ?? undefined, mun: p.get('mun') ?? '' };
}

function gravarHash() {
  const p = new URLSearchParams({ ele: eleAtual(), cargo: modoNoronha() ? conselhoDoTurno().i : cargoMenu().split(':')[1], abr: el.abrangencia.value });
  if (el.municipio.value) p.set('mun', el.municipio.value);
  history.replaceState(null, '', `#${p}`);
}

// ---------- carga ----------

// O código do cargo do Conselho Distrital não é documentado: tenta os códigos
// candidatos até encontrar um arquivo publicado, e memoriza o resultado.
async function descobrirCargo(ele, uf, municipio) {
  const chave = `${ele}:${uf}:${municipio}`;
  if (estado.cargosDescobertos[chave]) return estado.cargosDescobertos[chave];
  for (const codigo of CARGOS_CANDIDATOS_CONSELHO) {
    const res = await fetch(urlResultado(BASE, ele, uf, codigo, municipio), { cache: 'no-store' });
    if (res.ok) {
      estado.cargosDescobertos[chave] = codigo;
      return codigo;
    }
  }
  return null;
}

async function carregar() {
  // Consultas se sobrepõem (atualização automática, filtros, botão): só a mais recente vale.
  const pedido = ++estado.pedido;
  const ele = eleAtual();
  const cargo = cargoAtual();
  const uf = ufAtual();
  // Fernando de Noronha: o TSE publica o Conselho Distrital só no arquivo do município.
  let municipio = modoNoronha() ? (cargo.municipio ?? '') : el.municipio.value;
  gravarHash();
  el.status.textContent = 'consultando o TSE…';
  el.status.className = 'status';
  el.atualizar.disabled = true;

  try {
    let codigo = cargo.codigo;
    if (cargo.descobrir) {
      codigo = await descobrirCargo(ele, uf, municipio);
      // O conselho é votado só em Fernando de Noronha: tenta o arquivo do município.
      if (!codigo && !municipio) {
        const noronha = (estado.municipios[ele]?.[uf] ?? []).find((m) => /noronha/i.test(m.nome));
        if (noronha) {
          municipio = noronha.codigo;
          codigo = await descobrirCargo(ele, uf, municipio);
          if (codigo) el.municipio.value = municipio;
        }
      }
      if (!codigo) throw Object.assign(new Error('Arquivos do Conselho Distrital ainda não publicados pelo TSE.'), { indisponivel: true });
    }

    const bruto = await getJson(urlResultado(BASE, ele, uf, codigo, municipio));
    if (pedido !== estado.pedido) return;
    const dados = normalizar(bruto);
    // Foto do presidente fica em "br"; demais cargos, na UF.
    dados.fotoAbr = cargo.codigo === 1 ? 'br' : uf;
    if (estado.dados?.chave !== `${ele}:${codigo}:${uf}:${municipio}`) estado.limite = PAGINA;
    dados.chave = `${ele}:${codigo}:${uf}:${municipio}`;
    dados.majoritario = cargo.majoritario;
    estado.dados = dados;
    el.erro.hidden = true;
    renderizar();
    el.status.textContent = resultadoFinal()
      ? 'resultado final (100% das seções)'
      : `consultado às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
  } catch (erro) {
    if (pedido !== estado.pedido) return;
    estado.dados = null;
    limpar();
    el.erro.hidden = false;
    el.erro.textContent = erro.indisponivel
      ? `${erro.message} Antes do início da apuração o TSE pode ainda não ter publicado este resultado.`
      : `Não foi possível carregar os dados: ${erro.message}`;
    el.status.textContent = 'falha na consulta';
    el.status.className = 'status falha';
    if (erro.indisponivel && eleicaoAtual().turno === 2) avisoSegundoTurno(pedido, ele, cargo, uf, municipio);
  } finally {
    if (pedido === estado.pedido) el.atualizar.disabled = false;
  }
}

// 2º turno antes da apuração: em vez de "falha", diz quando é e quem disputa (do 1º turno).
async function avisoSegundoTurno(pedido, ele, cargo, uf, municipio) {
  const e = ELEICOES[ele];
  el.status.textContent = `aguardando o 2º turno (${e.data})`;
  el.status.className = 'status';
  const base = `O <strong>2º turno</strong> é no domingo, <strong>${esc(e.data)}</strong>. A apuração começa depois das 17h (horário de Brasília), quando as urnas fecham em todo o país, e esta janela mostra os resultados assim que o TSE publicar o primeiro boletim (com "automático" marcado, ela atualiza sozinha).`;
  el.erro.innerHTML = base;
  try {
    const primeiro = cargo.codigo === 1 ? 1 : cargo.codigo;
    const ler = async (abr, mun = '') => normalizar(await getJson(urlResultado(BASE, e.primeiroTurno, abr, primeiro, mun)));
    const local = await ler(uf, municipio);
    let disputa = local.candidatos.filter((c) => c.segundoTurno);
    if (!disputa.length && cargo.codigo === 1 && uf !== 'br') disputa = (await ler('br')).candidatos.filter((c) => c.segundoTurno);
    if (pedido !== estado.pedido) return;
    const nomes = (lista) => lista.map((c) => `<strong>${esc(c.nomeUrna)}</strong> (${esc(c.partido)})`).join(' e ');
    const onde = municipio ? 'nesta cidade' : uf === 'br' ? 'no Brasil' : `em ${esc(ABRANGENCIAS[uf] ?? uf.toUpperCase())}`;
    let extra;
    if (disputa.length) {
      const noLocal = disputa.map((c) => local.candidatos.find((x) => x.numero === c.numero)).filter(Boolean);
      extra = `Disputam: ${nomes(disputa)}.${noLocal.length ? ` No 1º turno, ${onde}: ${noLocal.map((c) => `${esc(c.nomeUrna)} ${pctTxt(c.percentual)}`).join(' · ')}.` : ''}`;
    } else {
      const eleito = local.candidatos.find((c) => c.eleito);
      extra = eleito
        ? `${esc(ABRANGENCIAS[uf] ?? uf.toUpperCase())} não tem 2º turno para ${esc(cargo.nome.replace(/ — 2º turno$/, '').toLowerCase())}: ${nomes([eleito])} foi eleito(a) no 1º turno, com ${pctTxt(eleito.percentual)} dos votos válidos.`
        : '';
    }
    if (extra) el.erro.innerHTML = `${base}<br><br>${extra}`;
  } catch { /* fica só o aviso da data */ }
}

// ---------- renderização ----------

function selo(c) {
  const st = c.situacao.trim();
  if (!st || /^n[ãa]o eleito$/i.test(st)) return '';
  const classe = c.segundoTurno ? 'turno2' : c.eleito || /^eleito/i.test(st) ? 'eleito' : 'outro';
  return `<span class="selo ${classe}">${esc(st)}</span>`;
}

// Foto que não carrega vira um marcador vazio. Ouvinte único (fase de captura, porque o
// evento "error" de imagem não sobe): a política de segurança não permite onerror="…".
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (img instanceof HTMLImageElement && img.classList.contains('foto-candidato')) {
    img.replaceWith(Object.assign(document.createElement('span'), { className: 'sem-foto' }));
  }
}, true);

function itemCandidato(c, posicao, d, compacto) {
  const largura = Math.max(0, Math.min(100, c.percentual));
  const foto = compacto
    ? `<span class="posicao">${posicao}º</span>`
    : `<img class="foto-candidato" loading="lazy" alt="" src="${esc(urlFoto(BASE, d.eleicao || eleAtual(), d.fotoAbr, c.sqcand))}">`;
  const extra = [c.partido, c.vice && `vice: ${c.vice}`, c.federacao].filter(Boolean).map(esc).join(' · ');
  return `<li class="candidato">
    ${foto}
    <div>
      <div class="nome">${esc(c.nomeUrna)} <span class="mudo">${esc(c.numero)}</span>${selo(c)}</div>
      <div class="info">${extra}</div>
      <div class="barra"><div style="width:${largura}%"></div></div>
    </div>
    <div class="numeros">
      <div class="pct">${fmtPct.format(c.percentual)}%</div>
      <div class="votos">${fmtInt.format(c.votos)} votos</div>
    </div>
  </li>`;
}

function renderizarCandidatos() {
  const d = estado.dados;
  if (!d) return;
  const termo = el.busca.value.trim().toLowerCase();
  const lista = termo
    ? d.candidatos.filter((c) => `${c.nomeUrna} ${c.nome} ${c.numero} ${c.partido}`.toLowerCase().includes(termo))
    : d.candidatos;
  const compacto = !d.majoritario;
  const visiveis = d.majoritario ? lista : lista.slice(0, estado.limite);

  el.candidatos.classList.toggle('compacto', compacto);
  el.candidatos.innerHTML = visiveis.length
    ? visiveis.map((c) => itemCandidato(c, d.candidatos.indexOf(c) + 1, d, compacto)).join('')
    : '<li class="mudo">Nenhum candidato encontrado.</li>';
  el.mais.hidden = d.majoritario || visiveis.length >= lista.length;
  el.mais.textContent = `Mostrar mais (${fmtInt.format(lista.length - visiveis.length)} restantes)`;
}

function renderizar() {
  const d = estado.dados;
  const cargo = cargoAtual();
  const nomeMun = !modoNoronha() && el.municipio.selectedOptions[0]?.value ? ` · ${el.municipio.selectedOptions[0].textContent}` : '';
  const vagas = d.cargo.vagas > 1 ? ` · ${d.cargo.vagas} vagas` : '';
  el.titulo.textContent = `${modoNoronha() ? 'Conselheiro Distrital' : d.cargo.nome || cargo.nome} · ${nomeAbr(el.abrangencia.value)}${nomeMun}${vagas}`;
  el.horario.textContent = d.atualizadoEm ? `Atualizado pelo TSE em ${d.atualizadoEm}` : '';
  el.barra.style.width = `${Math.min(100, d.secoes.percentual)}%`;
  el.pctSecoes.textContent = `${fmtPct.format(d.secoes.percentual)}%`;
  el.secoes.textContent = `${fmtInt.format(d.secoes.totalizadas)} de ${fmtInt.format(d.secoes.total)}`;

  el.busca.hidden = d.majoritario;
  renderizarCandidatos();

  el.partidosCartao.hidden = d.majoritario;
  if (!d.majoritario) {
    const totalNominal = d.candidatos.reduce((t, c) => t + c.votos, 0);
    el.partidos.innerHTML = votosPorPartido(d.candidatos).map((p) => `<tr>
      <td><strong>${esc(p.partido)}</strong> <span class="mudo">${esc(p.nome)}</span></td>
      <td class="num">${fmtInt.format(p.votos)}</td>
      <td class="num">${fmtPct.format(totalNominal ? (p.votos / totalNominal) * 100 : 0)}%</td>
      <td class="num">${p.eleitos || '—'}</td>
    </tr>`).join('');
  }

  const item = (rotulo, valor, pct) =>
    `<div><dt>${rotulo}</dt><dd>${fmtInt.format(valor)}${pct === undefined ? '' : ` <small>${fmtPct.format(pct)}%</small>`}</dd></div>`;
  el.gerais.innerHTML = [
    item('Eleitorado apto', d.eleitorado.apto),
    item('Comparecimento', d.eleitorado.comparecimento, d.eleitorado.percComparecimento),
    item('Abstenção', d.eleitorado.abstencao, d.eleitorado.percAbstencao),
    item('Votos válidos', d.votos.validos, d.votos.percValidos),
    item('Brancos', d.votos.brancos, d.votos.percBrancos),
    item('Nulos', d.votos.nulos, d.votos.percNulos),
    item('Total de votos', d.votos.total),
  ].join('');
}

function limpar() {
  el.titulo.textContent = `${modoNoronha() ? 'Conselheiro Distrital' : cargoAtual().nome} · ${nomeAbr(el.abrangencia.value)}`;
  el.horario.textContent = '';
  el.barra.style.width = '0';
  el.pctSecoes.textContent = '0,00%';
  el.secoes.textContent = '0 de 0';
  el.candidatos.innerHTML = '';
  el.mais.hidden = true;
  el.busca.hidden = true;
  el.partidosCartao.hidden = true;
  el.gerais.innerHTML = '';
}

// ---------- eventos ----------

function agendar() {
  clearInterval(estado.timer);
  if (el.auto.checked) estado.timer = setInterval(() => { if (!document.hidden && !resultadoFinal()) carregar(); }, INTERVALO_MS);
}

function resultadoFinal() {
  const s = estado.dados?.secoes;
  return Boolean(s?.total) && s.totalizadas >= s.total;
}

el.eleicao.addEventListener('change', async () => { atualizarCargos(); await atualizarMunicipios(); carregar(); });
el.cargo.addEventListener('change', async () => { estado.cargoMenu = el.cargo.value; atualizarAbrangencias(); await atualizarMunicipios(); carregar(); });
el.abrangencia.addEventListener('change', async () => { el.municipio.value = ''; aplicarModo(); await atualizarMunicipios(); carregar(); });
el.municipio.addEventListener('change', carregar);
el.atualizar.addEventListener('click', carregar);
el.auto.addEventListener('change', agendar);
el.busca.addEventListener('input', () => { estado.limite = PAGINA; renderizarCandidatos(); });
el.mais.addEventListener('click', () => { estado.limite += PAGINA * 2; renderizarCandidatos(); });

const inicial = lerHash();
montarFiltros(inicial);
await atualizarMunicipios(inicial);
carregar();
agendar();
