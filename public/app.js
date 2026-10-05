import {
  ABRANGENCIAS, CARGOS_CANDIDATOS_CONSELHO, ELEICOES, lerMunicipios, normalizar,
  urlFoto, urlMunicipios, urlResultado, votosPorPartido,
} from './tse.js';

// Pelo servidor local (`node server.js`) as consultas passam pelo proxy `/tse`.
// Com `?direto=1` o navegador consulta o TSE diretamente (depende de CORS do TSE).
const BASE = new URLSearchParams(location.search).has('direto')
  ? 'https://resultados.tse.jus.br/oficial'
  : 'tse';
const INTERVALO_MS = 60_000;
const PAGINA = 30;

const $ = (id) => document.getElementById(id);
const el = {
  eleicao: $('eleicao'), cargo: $('cargo'), abrangencia: $('abrangencia'), municipio: $('municipio'),
  status: $('status'), atualizar: $('atualizar'), auto: $('auto'), erro: $('erro'),
  titulo: $('titulo'), horario: $('horario'), barra: $('barra-secoes'), pctSecoes: $('pct-secoes'),
  secoes: $('secoes'), candidatos: $('candidatos'), mais: $('mais'), busca: $('busca'),
  partidosCartao: $('partidos-cartao'), partidos: $('partidos'), gerais: $('gerais'),
};

const fmtInt = new Intl.NumberFormat('pt-BR');
const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const estado = {
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

const eleicaoAtual = () => ELEICOES[el.eleicao.value];
const cargoAtual = () => eleicaoAtual().cargos[Number(el.cargo.value)] ?? eleicaoAtual().cargos[0];

function montarFiltros(inicial = {}) {
  preencher(el.eleicao, Object.values(ELEICOES).map((e) => [e.codigo, `${e.codigo} · ${matchMedia('(max-width: 600px)').matches ? e.curto : e.nome}`]), inicial.ele);
  atualizarCargos(inicial);
}

function atualizarCargos(inicial = {}) {
  const cargos = eleicaoAtual().cargos;
  preencher(el.cargo, cargos.map((c, i) => [i, c.nome]), inicial.cargo ?? 0);
  atualizarAbrangencias(inicial);
}

function atualizarAbrangencias(inicial = {}) {
  const atual = inicial.abr ?? el.abrangencia.value;
  preencher(el.abrangencia, cargoAtual().abrangencias.map((a) => [a, ABRANGENCIAS[a]]), atual);
}

async function atualizarMunicipios(inicial = {}) {
  const uf = el.abrangencia.value;
  const ele = el.eleicao.value;
  el.municipio.innerHTML = '<option value="">Todos</option>';
  el.municipio.disabled = uf === 'br';
  if (uf === 'br') return;
  try {
    if (!estado.municipios[ele]) estado.municipios[ele] = lerMunicipios(await getJson(urlMunicipios(BASE, ele)));
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
  const p = new URLSearchParams({ ele: el.eleicao.value, cargo: el.cargo.value, abr: el.abrangencia.value });
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
  const ele = el.eleicao.value;
  const cargo = cargoAtual();
  const uf = el.abrangencia.value;
  let municipio = el.municipio.value;
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
    const dados = normalizar(bruto);
    // Foto do presidente fica em "br"; demais cargos, na UF.
    dados.fotoAbr = cargo.codigo === 1 ? 'br' : uf;
    if (estado.dados?.chave !== `${ele}:${codigo}:${uf}:${municipio}`) estado.limite = PAGINA;
    dados.chave = `${ele}:${codigo}:${uf}:${municipio}`;
    dados.majoritario = cargo.majoritario;
    estado.dados = dados;
    el.erro.hidden = true;
    renderizar();
    el.status.textContent = `consultado às ${new Date().toLocaleTimeString('pt-BR')}`;
    el.status.className = 'status ok';
  } catch (erro) {
    estado.dados = null;
    limpar();
    el.erro.hidden = false;
    el.erro.textContent = erro.indisponivel
      ? `${erro.message} Antes do início da apuração o TSE pode ainda não ter publicado este resultado.`
      : `Não foi possível carregar os dados: ${erro.message}`;
    el.status.textContent = 'falha na consulta';
    el.status.className = 'status falha';
  } finally {
    el.atualizar.disabled = false;
  }
}

// ---------- renderização ----------

function selo(c) {
  const st = c.situacao.trim();
  if (!st || /^n[ãa]o eleito$/i.test(st)) return '';
  const classe = c.segundoTurno ? 'turno2' : c.eleito || /^eleito/i.test(st) ? 'eleito' : 'outro';
  return `<span class="selo ${classe}">${esc(st)}</span>`;
}

function itemCandidato(c, posicao, d, compacto) {
  const largura = Math.max(0, Math.min(100, c.percentual));
  const foto = compacto
    ? `<span class="posicao">${posicao}º</span>`
    : `<img loading="lazy" alt="" src="${esc(urlFoto(BASE, d.eleicao || el.eleicao.value, d.fotoAbr, c.sqcand))}"
         onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'sem-foto'}))">`;
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
  const nomeMun = el.municipio.selectedOptions[0]?.value ? ` · ${el.municipio.selectedOptions[0].textContent}` : '';
  const vagas = d.cargo.vagas > 1 ? ` · ${d.cargo.vagas} vagas` : '';
  el.titulo.textContent = `${d.cargo.nome || cargo.nome} · ${ABRANGENCIAS[el.abrangencia.value]}${nomeMun}${vagas}`;
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
  el.titulo.textContent = `${cargoAtual().nome} · ${ABRANGENCIAS[el.abrangencia.value]}`;
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
  if (el.auto.checked) estado.timer = setInterval(() => { if (!document.hidden) carregar(); }, INTERVALO_MS);
}

el.eleicao.addEventListener('change', async () => { atualizarCargos(); await atualizarMunicipios(); carregar(); });
el.cargo.addEventListener('change', async () => { atualizarAbrangencias(); await atualizarMunicipios(); carregar(); });
el.abrangencia.addEventListener('change', async () => { el.municipio.value = ''; await atualizarMunicipios(); carregar(); });
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
