// Peças comuns às páginas de análise (painel de brancos e nulos e explorador).

import { antesDeExportar } from './citar.js';
import './exportar.js'; // botões de exportar PNG/SVG em todos os cartões com gráfico ou mapa
import { ELEICOES, UFS } from './tse.js';

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
export const carregarMunicipios = (cargo, uf) =>
  getApi('municipios', { ele: cargo.eleicao, cargo: cargo.codigo, uf });

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
