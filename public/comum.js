// Peças comuns às páginas de análise (painel de brancos e nulos e explorador).

import { antesDeExportar } from './citar.js';
import './exportar.js'; // botões de exportar PNG/SVG em todos os cartões com gráfico ou mapa
import { ELEICOES, UFS, expandirRetrato, somarResumos } from './tse.js';

export const fmtInt = new Intl.NumberFormat('pt-BR');
export const fmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtNum = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const pct = (v) => `${fmtPct.format(v)}%`;
export const pp = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${fmtPct.format(Math.abs(v))}`;
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const semAcento = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const CURTOS = { 1: 'Pres', 3: 'Gov', 5: 'Sen', 6: 'Dep Fed', 7: 'Dep Est', 8: 'Dep Dist' };

/** Cargos com código conhecido (o Conselho Distrital, só em Noronha, fica na tela de apuração). */
export const CARGOS = Object.values(ELEICOES).flatMap((e) =>
  e.cargos.filter((c) => c.codigo !== null).map((c) => ({
    ...c, eleicao: e.codigo, valor: `${e.codigo}:${c.codigo}`, curto: `${CURTOS[c.codigo] ?? c.nome}${e.turno === 2 ? ' 2T' : ''}`,
  })));

export const cargoPorValor = (valor) => CARGOS.find((c) => c.valor === valor);

export const REGIOES = {
  Norte: ['ac', 'am', 'ap', 'pa', 'ro', 'rr', 'to'],
  Nordeste: ['al', 'ba', 'ce', 'ma', 'pb', 'pe', 'pi', 'rn', 'se'],
  'Centro-Oeste': ['df', 'go', 'ms', 'mt'],
  Sudeste: ['es', 'mg', 'rj', 'sp'],
  Sul: ['pr', 'rs', 'sc'],
};
export const regiaoDe = (uf) =>
  Object.entries(REGIOES).find(([, ufs]) => ufs.includes(uf))?.[0] ?? (uf === 'zz' ? 'Exterior' : '—');

/** Código IBGE (2 dígitos) de cada UF, usado nos mapas. */
export const CODIGO_IBGE_UF = {
  ro: '11', ac: '12', am: '13', rr: '14', pa: '15', ap: '16', to: '17', ma: '21', pi: '22', ce: '23', rn: '24', pb: '25',
  pe: '26', al: '27', se: '28', ba: '29', mg: '31', es: '32', rj: '33', sp: '35', pr: '41', sc: '42', rs: '43', ms: '50',
  mt: '51', go: '52', df: '53',
};
export const UF_DO_CODIGO = Object.fromEntries(Object.entries(CODIGO_IBGE_UF).map(([uf, c]) => [c, uf]));

export const nomeUf = (uf) => UFS[uf] ?? (uf === 'zz' ? 'Exterior' : uf?.toUpperCase());

export const PORTES = [
  [0, 5_000, 'até 5 mil'], [5_000, 20_000, '5–20 mil'], [20_000, 100_000, '20–100 mil'],
  [100_000, 500_000, '100–500 mil'], [500_000, Infinity, '500 mil+'],
];
export const porteDe = (votos) => PORTES.find(([a, b]) => votos >= a && votos < b)?.[2] ?? '—';

export const pctSecoes = (r) => (r.secoes?.total ? (r.secoes.totalizadas / r.secoes.total) * 100 : 0);

async function getApi(caminho, params) {
  const res = await fetch(`api/${caminho}?${new URLSearchParams(params)}`, { cache: 'no-store' });
  const dados = await res.json();
  if (!res.ok) throw new Error(dados.erro || `HTTP ${res.status}`);
  return dados;
}

/** `fundo`: pedido de painel secundário, atendido depois do que está em destaque na tela. */
export const carregarEstados = (cargo, { fundo = false } = {}) =>
  getApi('estados', { ele: cargo.eleicao, cargo: cargo.codigo, ...(fundo ? { fundo: '1' } : {}) });
// Retratos de resultados já totalizados (public/resultados, gerados por
// scripts/atualizar-resultados.mjs): "todas as cidades" abre na hora, sem milhares de
// consultas ao TSE. Só valem completos; senão, o app consulta o servidor normalmente.
const retratos = new Map();
function retratoTodas(cargo) {
  const chave = `${cargo.eleicao}-${cargo.codigo}`;
  if (!retratos.has(chave)) {
    retratos.set(chave, fetch(`resultados/${chave}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.retrato?.completo ? expandirRetrato(d) : null))
      .catch(() => null));
  }
  return retratos.get(chave);
}

/** As cidades de uma UF tiradas do retrato nacional, no formato de /api/municipios?uf=… */
export function recortarUf(retrato, uf) {
  const prefixo = `${uf}:`;
  // Cargos estaduais: no retrato os candidatos vêm como "uf:número" e "NOME · UF".
  const local = (mapa) => {
    if (!Object.keys(mapa ?? {}).some((k) => k.includes(':'))) return mapa;
    const out = {};
    for (const [k, v] of Object.entries(mapa)) if (k.startsWith(prefixo)) out[k.slice(prefixo.length)] = v;
    return out;
  };
  const sufixo = ` · ${uf.toUpperCase()}`;
  const nomes = {};
  for (const [k, v] of Object.entries(local(retrato.nomes) ?? {})) {
    nomes[k] = [String(v[0]).endsWith(sufixo) ? v[0].slice(0, -sufixo.length) : v[0], ...v.slice(1)];
  }
  const municipios = retrato.municipios.filter((m) => m.uf === uf).map((m) => ({ ...m, cand: local(m.cand) }));
  const consolidado = municipios.length ? somarResumos(municipios) : null;
  if (consolidado) delete consolidado.nomes;
  return { ...retrato, uf, total: municipios.length, lidos: municipios.length, consolidado, municipios, nomes };
}

export async function carregarMunicipios(cargo, uf) {
  const r = await retratoTodas(cargo);
  if (r && uf === 'todas') return r;
  if (r && r.municipios.some((m) => m.uf === uf)) return recortarUf(r, uf);
  return getApi('municipios', { ele: cargo.eleicao, cargo: cargo.codigo, uf });
}

// Logs das urnas: base estática (public/urnas, gerada por scripts/atualizar-urnas.mjs), a mesma
// para todos os usuários; sem ela (servidor local compilando ao vivo), as rotas /api/urnas/*.
const urnasEstaticas = new Map();
async function jsonOuNulo(url) {
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}
/** Seções em linhas compactas (base estática) → o formato de /api/urnas/municipio. */
export function expandirSecoes(d) {
  if (!d?.colunas || !d.linhas) return d;
  const i = Object.fromEntries(d.colunas.map((c, k) => [c, k]));
  const tem = (c) => i[c] !== undefined;
  const secoes = d.linhas.map((l) => {
    const s = {
      zona: l[i.zona], secao: l[i.secao], votos: l[i.votos], modelo: l[i.modelo], bateria: l[i.bateria],
      cabine: { media: l[i.cabine], mediana: l[i.mediana], p90: l[i.p90] }, atendimento: { media: l[i.atendimento] },
      tipos: { biometrica: l[i.biometrica] }, primeiroVoto: l[i.primeiroVoto], ultimoVoto: l[i.ultimoVoto],
    };
    // Votos por hora da seção ([hora inicial, contagens...]), nas bases que têm essa coluna.
    if (tem('porHora')) {
      const h = l[i.porHora];
      s.porHora = h ? Object.fromEntries(h.slice(1).map((n, k) => [h[0] + k, n])) : {};
    }
    return s;
  });
  const { colunas, linhas, ...resto } = d;
  return { ...resto, secoes };
}

/** `arquivo` em public/urnas (ex.: "brasil.json"); `api` = rota usada quando o arquivo não existe. */
export async function dadosUrnas(arquivo, api) {
  if (!urnasEstaticas.has(arquivo)) urnasEstaticas.set(arquivo, jsonOuNulo(`urnas/${arquivo}`).then(expandirSecoes).catch(() => null));
  const estatico = await urnasEstaticas.get(arquivo);
  if (estatico) return estatico;
  urnasEstaticas.delete(arquivo);
  const res = await fetch(api, { cache: 'no-store' });
  const d = await res.json();
  if (!res.ok) throw new Error(d.erro || `HTTP ${res.status}`);
  return d;
}

/** Gera e baixa um CSV (separador ";" e vírgula decimal, como o Excel em português espera), depois da janela "Como citar". */
export function baixarCsv(nomeArquivo, colunas, linhas) {
  antesDeExportar(() => gerarCsv(nomeArquivo, colunas, linhas));
}

function gerarCsv(nomeArquivo, colunas, linhas) {
  const campo = (v) => {
    const t = typeof v === 'number' ? String(Math.round(v * 10000) / 10000).replace('.', ',') : String(v ?? '');
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const texto = [colunas.map((c) => campo(c.nome)), ...linhas.map((l) => colunas.map((c) => campo(c.valor(l))))]
    .map((l) => l.join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${texto}`], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nomeArquivo });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Dica flutuante única da página. `conteudo(alvo)` devolve HTML (já escapado) ou null. */
export function criarDica(elemento) {
  const mostrar = (html, x, y) => {
    if (!html) { elemento.hidden = true; return; }
    elemento.innerHTML = html;
    elemento.hidden = false;
    const { width, height } = elemento.getBoundingClientRect();
    elemento.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, x + 14))}px`;
    elemento.style.top = `${y - height - 14 < 8 ? y + 18 : y - height - 14}px`;
  };
  return {
    ligar(container, seletor, conteudo) {
      container.addEventListener('pointermove', (ev) => {
        const alvo = ev.target.closest(seletor);
        mostrar(alvo && container.contains(alvo) ? conteudo(alvo) : null, ev.clientX, ev.clientY);
      });
      container.addEventListener('pointerleave', () => { elemento.hidden = true; });
    },
    esconder() { elemento.hidden = true; },
  };
}

// Cores dos partidos (convenção da imprensa: PT vermelho, PL azul…), para mapas e barras de
// candidatos. Partidos sem cor própria usam a paleta categórica, sem repetir as já usadas.
export const CORES_PARTIDO = {
  PT: '#d1242f', PL: '#1f4fa8', MDB: '#2f9e44', PSDB: '#3d8fd6', NOVO: '#f08c00', PSOL: '#f5c400',
  PSD: '#8c6d1f', PSB: '#e8590c', PDT: '#b5302a', REPUBLICANOS: '#0b7285', 'UNIÃO': '#1c3f6e', PP: '#5c7cfa',
  'PC do B': '#a61e4d', PCdoB: '#a61e4d', REDE: '#12b886', PV: '#66a80f', AVANTE: '#e64980', 'MISSÃO': '#7048e8',
  PODE: '#4dabf7', SOLIDARIEDADE: '#f76707', CIDADANIA: '#e599f7', DC: '#5f3dc4', PSTU: '#862e2e', PCB: '#9c2a2a',
  PCO: '#6b1b1b', UP: '#ff6b6b', AGIR: '#20c997', MOBILIZA: '#94d82d', PRD: '#495057', PMB: '#c2255c',
};

/** Cor do partido (sigla, ou rótulo "NOME (PARTIDO)"); null se não houver cor própria. */
export function corDoPartido(rotulo) {
  if (!rotulo) return null;
  const sigla = String(rotulo).match(/\(([^()]+)\)\s*$/)?.[1] ?? String(rotulo);
  const chave = sigla.trim().toUpperCase();
  return CORES_PARTIDO[chave] ?? CORES_PARTIDO[sigla.trim()] ?? null;
}

/**
 * Cores para uma lista ordenada de chaves (candidatos ou partidos): a cor do partido quando
 * ele aparece pela primeira vez; os demais recebem a paleta categórica sem repetir cores.
 */
export function coresPorPartido(chaves, partidoDe, paleta) {
  const usadas = new Set();
  const out = new Map();
  for (const k of chaves) {
    const c = corDoPartido(partidoDe(k));
    if (c && !usadas.has(c)) { out.set(k, c); usadas.add(c); }
  }
  let i = 0;
  for (const k of chaves) {
    if (out.has(k)) continue;
    while (usadas.has(paleta[i % paleta.length]) && i < paleta.length * 2) i += 1;
    const c = paleta[i % paleta.length];
    out.set(k, c);
    usadas.add(c);
    i += 1;
  }
  return out;
}
