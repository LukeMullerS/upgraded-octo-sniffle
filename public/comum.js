// Peças comuns às páginas de análise (painel de brancos e nulos e explorador).

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
    ...c, eleicao: e.codigo, valor: `${e.codigo}:${c.codigo}`, curto: CURTOS[c.codigo] ?? c.nome,
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

export const carregarEstados = (cargo) => getApi('estados', { ele: cargo.eleicao, cargo: cargo.codigo });
export const carregarMunicipios = (cargo, uf) =>
  getApi('municipios', { ele: cargo.eleicao, cargo: cargo.codigo, uf });

/** Gera e baixa um CSV (separador ";" e vírgula decimal, como o Excel em português espera). */
export function baixarCsv(nomeArquivo, colunas, linhas) {
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
