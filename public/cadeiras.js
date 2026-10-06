// Divisão das cadeiras nos cargos proporcionais (deputados): quantas vagas cada partido e cada
// federação conquistou, lidas do arquivo de resultado da UF publicado pelo TSE (nv = vagas do
// cargo, qe = quociente eleitoral, vag = vagas de cada agremiação, st = situação de cada
// candidato), e o gráfico de hemiciclo (um ponto por cadeira).
//
// Os deputados não são eleitos pelos mais votados: as vagas vão primeiro a cada partido ou
// federação pelo quociente partidário (votos da legenda ÷ quociente eleitoral) e as que
// sobram, por maiores médias; dentro de cada um, ficam com os candidatos mais votados.

import { normalizar } from './tse.js';

const numero = (v) => {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
// "06/10/2026 13:05:00" → número comparável.
const dataHora = (t) => { const m = String(t).match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)/); return m ? Number(`${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}${m[6]}`) : 0; };
const eleito = (st) => /^eleito/i.test(String(st ?? '').trim());

/** Cadeiras de uma UF a partir do arquivo bruto do TSE (abrangência UF, cargo proporcional). */
export function cadeirasDoArquivo(bruto, uf = '') {
  const carg = bruto?.carg?.[0];
  if (!carg) return null;
  const s = bruto.s ?? {};
  const agremiacoes = [];
  const partidos = new Map();
  const eleitos = [];
  for (const agr of carg.agr ?? []) {
    const federacao = agr.tp === 'f';
    let votosAgr = 0;
    const siglas = [];
    for (const p of agr.par ?? []) {
      const nominais = numero(p.tvtn);
      const legenda = numero(p.tvtl);
      votosAgr += nominais + legenda;
      siglas.push(p.sg);
      const reg = partidos.get(p.sg) ?? { sigla: p.sg, nome: p.nm ?? p.sg, federacao: federacao ? ((carg.fed ?? []).find((f) => String(f.n) === String(p.nfed))?.sg ?? agr.com ?? '') : '', vagas: 0, votos: 0, nominais: 0, legenda: 0 };
      reg.votos += nominais + legenda;
      reg.nominais += nominais;
      reg.legenda += legenda;
      for (const c of p.cand ?? []) {
        if (!eleito(c.st)) continue;
        reg.vagas += 1;
        eleitos.push({ nome: c.nmu || c.nm || '', partido: p.sg, numero: String(c.n ?? ''), votos: numero(c.vap), situacao: c.st, uf });
      }
      partidos.set(p.sg, reg);
    }
    // Federação: sigla oficial pelo número (igual em todas as UFs; "com" muda a ordem dos partidos).
    const fed = federacao ? (carg.fed ?? []).find((f) => String(f.n) === String(agr.par?.[0]?.nfed)) : null;
    agremiacoes.push({
      sigla: federacao ? (fed?.sg ?? agr.com ?? agr.nm) : siglas[0] ?? agr.com, nome: fed?.nm ?? agr.nm ?? '', federacao,
      partidos: siglas, vagas: numero(agr.vag), votos: votosAgr,
    });
  }
  eleitos.sort((a, b) => b.votos - a.votos);
  const vagas = numero(carg.nv) || agremiacoes.reduce((t, a) => t + a.vagas, 0);
  const n = normalizar(bruto);
  return {
    uf,
    atualizadoEm: n.atualizadoEm,
    // Totais da UF, para somar o Brasil (eleitorado, comparecimento e votos).
    resumo: {
      apto: n.eleitorado.apto, aptoTotalizadas: n.eleitorado.aptoTotalizadas, comparecimento: n.eleitorado.comparecimento,
      abstencao: n.eleitorado.abstencao, total: n.votos.total, validos: n.votos.validos, brancos: n.votos.brancos, nulos: n.votos.nulos,
    },
    vagas,
    quociente: numero(carg.qe),
    secoes: { total: numero(s.ts), totalizadas: numero(s.st) },
    agremiacoes: agremiacoes.filter((a) => a.votos > 0 || a.vagas > 0).sort((a, b) => b.vagas - a.vagas || b.votos - a.votos),
    partidos: [...partidos.values()].filter((p) => p.votos > 0 || p.vagas > 0).sort((a, b) => b.vagas - a.vagas || b.votos - a.votos),
    eleitos,
    porQp: eleitos.filter((e) => /QP/i.test(e.situacao)).length,
    porMedia: eleitos.filter((e) => /m[ée]dia/i.test(e.situacao)).length,
  };
}

/** Soma as cadeiras de várias UFs (Câmara dos Deputados, ou todas as assembleias). */
export function somarCadeiras(lista) {
  const juntar = (campo, chave) => {
    const m = new Map();
    for (const c of lista) {
      for (const a of c[campo]) {
        const r = m.get(a[chave]) ?? { ...a, vagas: 0, votos: 0, ...(campo === 'partidos' ? { nominais: 0, legenda: 0 } : {}) };
        r.vagas += a.vagas;
        r.votos += a.votos;
        if (campo === 'partidos') { r.nominais += a.nominais; r.legenda += a.legenda; }
        m.set(a[chave], r);
      }
    }
    return [...m.values()].sort((a, b) => b.vagas - a.vagas || b.votos - a.votos);
  };
  const eleitos = lista.flatMap((c) => c.eleitos).sort((a, b) => b.votos - a.votos);
  const resumo = {};
  for (const c of lista) for (const [k, v] of Object.entries(c.resumo ?? {})) resumo[k] = (resumo[k] ?? 0) + v;
  return {
    uf: 'br',
    atualizadoEm: lista.map((c) => c.atualizadoEm ?? '').sort((a, b) => dataHora(a) - dataHora(b)).at(-1) ?? '',
    resumo,
    vagas: lista.reduce((t, c) => t + c.vagas, 0),
    quociente: null,
    secoes: { total: lista.reduce((t, c) => t + c.secoes.total, 0), totalizadas: lista.reduce((t, c) => t + c.secoes.totalizadas, 0) },
    // Federações com a mesma composição somam juntas; partidos fora de federação, pela sigla.
    agremiacoes: juntar('agremiacoes', 'sigla'),
    partidos: juntar('partidos', 'sigla'),
    eleitos,
    porQp: lista.reduce((t, c) => t + c.porQp, 0),
    porMedia: lista.reduce((t, c) => t + c.porMedia, 0),
    ufs: Object.fromEntries(lista.map((c) => [c.uf, { vagas: c.vagas, partidos: Object.fromEntries(c.partidos.filter((p) => p.vagas).map((p) => [p.sigla, p.vagas])) }])),
  };
}

/**
 * Posições das cadeiras num hemiciclo: fileiras concêntricas, cada uma com cadeiras na
 * proporção do seu comprimento; depois, ordenadas da esquerda para a direita (pelo ângulo),
 * para que cada grupo ocupe uma "fatia" contínua, como nos gráficos da imprensa.
 */
export function posicoesHemiciclo(n) {
  if (n <= 0) return { pontos: [], raio: 0 };
  const interno = 0.38;
  let fileiras = 1;
  const capacidade = (f) => {
    const passo = f === 1 ? 1 - interno : (1 - interno) / (f - 1);
    let t = 0;
    for (let i = 0; i < f; i += 1) t += Math.floor((Math.PI * (f === 1 ? 1 : interno + i * passo)) / passo) + 1;
    return t;
  };
  while (capacidade(fileiras) < n && fileiras < 40) fileiras += 1;
  const passo = fileiras === 1 ? 1 - interno : (1 - interno) / (fileiras - 1);
  // Uma fileira só (poucas cadeiras): um arco no meio, com pontos de tamanho limitado.
  const raios = Array.from({ length: fileiras }, (_, i) => (fileiras === 1 ? 0.72 : interno + i * passo));
  const soma = raios.reduce((t, r) => t + r, 0);
  // Cadeiras por fileira proporcionais ao raio (maiores restos para fechar exatamente n).
  const exatos = raios.map((r) => (n * r) / soma);
  const porFileira = exatos.map(Math.floor);
  let falta = n - porFileira.reduce((t, v) => t + v, 0);
  exatos.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (falta > 0) { porFileira[i] += 1; falta -= 1; } });
  const pontos = [];
  raios.forEach((r, i) => {
    const k = porFileira[i];
    for (let j = 0; j < k; j += 1) {
      const ang = k === 1 ? Math.PI / 2 : Math.PI - (j * Math.PI) / (k - 1);
      pontos.push({ x: r * Math.cos(ang), y: r * Math.sin(ang), ang, r });
    }
  });
  pontos.sort((a, b) => b.ang - a.ang || a.r - b.r);
  const vao = porFileira[0] > 1 ? (Math.PI * raios[0]) / (porFileira[0] - 1) : passo;
  const raio = Math.min(passo * 0.42, vao * 0.42, 0.1);
  return { pontos, raio };
}

const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** SVG do hemiciclo. grupos: [{rotulo, cor, n}] na ordem em que devem aparecer, da esquerda para a direita. */
export function svgHemiciclo(grupos, { total, titulo = '' } = {}) {
  const n = total ?? grupos.reduce((t, g) => t + g.n, 0);
  const { pontos, raio } = posicoesHemiciclo(n);
  const L = 400;
  const H = 214;
  const cx = L / 2;
  const cy = 194;
  const esc = 176;
  let i = 0;
  const circulos = [];
  for (const g of grupos) {
    for (let k = 0; k < g.n && i < pontos.length; k += 1, i += 1) {
      const p = pontos[i];
      circulos.push(`<circle cx="${(cx + p.x * esc).toFixed(1)}" cy="${(cy - p.y * esc).toFixed(1)}" r="${(raio * esc).toFixed(1)}" fill="${g.cor}" data-grupo="${escapar(g.rotulo)}"><title>${escapar(g.rotulo)}: ${g.n}</title></circle>`);
    }
  }
  for (; i < pontos.length; i += 1) {
    const p = pontos[i];
    circulos.push(`<circle cx="${(cx + p.x * esc).toFixed(1)}" cy="${(cy - p.y * esc).toFixed(1)}" r="${(raio * esc).toFixed(1)}" fill="none" stroke="currentColor" stroke-opacity=".35"><title>vaga ainda não definida</title></circle>`);
  }
  return `<svg class="hemiciclo" viewBox="0 0 ${L} ${H}" role="img" aria-label="${escapar(titulo || `${n} cadeiras`)}">${circulos.join('')}
    <text x="${cx}" y="${cy - 30}" text-anchor="middle" class="hemi-total">${n}</text>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" class="hemi-rotulo">cadeiras</text></svg>`;
}
