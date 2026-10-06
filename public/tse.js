// Configuração das eleições de 2026 e leitura dos arquivos públicos do TSE.
// Módulo ES puro: roda no navegador e no Node (testes).
//
// Layout dos arquivos (ambiente "oficial", ciclo "ele2026"):
//   {base}/ele2026/{eleição}/dados/{abr}/{abr}-c{cargo:4}-e{eleição:6}-u.json        resultado da UF / BR / exterior
//   {base}/ele2026/{eleição}/dados/{uf}/{uf}{município:5}-c{cargo:4}-e{eleição:6}-u.json  resultado do município
//   {base}/ele2026/{eleição}/config/mun-e{eleição:6}-cm.json                           municípios de cada UF
//   {base}/ele2026/{eleição}/fotos/{abr}/{sqcand}.jpeg                                 foto do candidato
// Todos os números chegam como string em pt-BR: "1.234" é inteiro, "12,34" é decimal.

export const CICLO = 'ele2026';
export const PLEITO = { codigo: '3220', data: '04/10/2026', turno: 1 };

export const UFS = {
  ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia', ce: 'Ceará',
  df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás', ma: 'Maranhão', mg: 'Minas Gerais',
  ms: 'Mato Grosso do Sul', mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco',
  pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte', ro: 'Rondônia',
  rr: 'Roraima', rs: 'Rio Grande do Sul', sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo',
  to: 'Tocantins',
};
const TODAS_UFS = Object.keys(UFS);

export const ABRANGENCIAS = { br: 'Brasil', zz: 'Exterior', ...UFS };

// Cargos de cada eleição e onde cada um é votado. `majoritario` muda a apresentação
// (corrida por percentual) em relação aos proporcionais (lista longa de candidatos).
export const ELEICOES = {
  6257: {
    codigo: '6257',
    nome: 'Eleição Geral Federal',
    curto: 'Federal',
    cargos: [
      { codigo: 1, nome: 'Presidente', majoritario: true, abrangencias: ['br', ...TODAS_UFS, 'zz'] },
    ],
  },
  6259: {
    codigo: '6259',
    nome: 'Eleições Gerais Estaduais 2026',
    curto: 'Estaduais',
    cargos: [
      { codigo: 3, nome: 'Governador', majoritario: true, abrangencias: TODAS_UFS },
      { codigo: 5, nome: 'Senador', majoritario: true, abrangencias: TODAS_UFS },
      { codigo: 6, nome: 'Deputado Federal', majoritario: false, abrangencias: TODAS_UFS },
      { codigo: 7, nome: 'Deputado Estadual', majoritario: false, abrangencias: TODAS_UFS.filter((u) => u !== 'df') },
      { codigo: 8, nome: 'Deputado Distrital', majoritario: false, abrangencias: ['df'] },
    ],
  },
  // 2º turno (25/10/2026): códigos 6258 e 6260, informados pelo TSE em comum/config/ele-c.json
  // ("cdt2" das eleições do 1º turno). Antes da votação os arquivos ainda não existem e o app
  // avisa que não foram publicados.
  6258: {
    codigo: '6258',
    primeiroTurno: '6257',
    data: '25/10/2026',
    nome: 'Eleição Geral Federal — 2º turno',
    curto: 'Federal 2º turno',
    turno: 2,
    cargos: [
      { codigo: 1, nome: 'Presidente — 2º turno', majoritario: true, abrangencias: ['br', ...TODAS_UFS, 'zz'] },
    ],
  },
  6260: {
    codigo: '6260',
    primeiroTurno: '6259',
    data: '25/10/2026',
    nome: 'Eleições Estaduais — 2º turno',
    curto: 'Estaduais 2º turno',
    turno: 2,
    cargos: [
      { codigo: 3, nome: 'Governador — 2º turno', majoritario: true, abrangencias: TODAS_UFS },
    ],
  },
  6261: {
    codigo: '6261',
    nome: 'Eleição Conselho Distrital 2026',
    curto: 'Conselho Distrital',
    // Conselho Distrital de Fernando de Noronha (PE). O TSE não documenta o código do
    // cargo; o app o descobre consultando os arquivos publicados (ver `descobrirCargo`).
    cargos: [
      { codigo: null, nome: 'Conselheiro Distrital', majoritario: false, abrangencias: ['pe'], descobrir: true },
    ],
  },
};

// Códigos tentados, em ordem, para descobrir o cargo do Conselho Distrital.
export const CARGOS_CANDIDATOS_CONSELHO = [13, 14, 15, 16, 17, 18, 19, 20, 11, 12, 21, 22, 23, 24, 25, 8, 7];

const pad = (v, n) => String(v).padStart(n, '0');

export function urlResultado(base, eleicao, abrangencia, cargo, municipio = '') {
  const abr = abrangencia.toLowerCase();
  return `${base}/${CICLO}/${eleicao}/dados/${abr}/${abr}${municipio}-c${pad(cargo, 4)}-e${pad(eleicao, 6)}-u.json`;
}

export const urlMunicipios = (base, eleicao) =>
  `${base}/${CICLO}/${eleicao}/config/mun-e${pad(eleicao, 6)}-cm.json`;

export const urlFoto = (base, eleicao, abrangencia, sqcand) =>
  `${base}/${CICLO}/${eleicao}/fotos/${abrangencia.toLowerCase()}/${sqcand}.jpeg`;

/** "1.234" → 1234, "12,34" → 12.34, vazio → 0. */
export function num(valor) {
  if (valor === undefined || valor === null || valor === '') return 0;
  if (typeof valor === 'number') return valor;
  const n = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const pct = (parte, total) => (total > 0 ? (parte / total) * 100 : 0);

// `tvn` é o total de nulos que o app oficial mostra (nulos + nulos técnicos); arquivos
// antigos ou simplificados trazem só `vn`.
// O TSE marca com e='s' também quem vai ao 2º turno (st = '2º turno'): eleito é só quem não vai.
const segundoTurno = (c) => /2[ºo°]?\s*turno/i.test(c.st ?? '');
const eleito = (c) => c.e === 's' && !segundoTurno(c);
const totalNulos = (v) => (v.tvn !== undefined ? num(v.tvn) : num(v.vn) + num(v.vnt));

/** Converte o JSON bruto do TSE num objeto com números de verdade e candidatos ordenados. */
export function normalizar(bruto) {
  const cargo = bruto.carg?.[0] ?? {};
  const v = bruto.v ?? {};
  const e = bruto.e ?? {};
  const s = bruto.s ?? {};
  const validos = num(v.vv ?? v.vvc);

  const candidatos = [];
  for (const agr of cargo.agr ?? []) {
    for (const par of agr.par ?? []) {
      for (const c of par.cand ?? []) {
        const votos = num(c.vap);
        candidatos.push({
          sqcand: String(c.sqcand ?? ''),
          numero: String(c.n ?? ''),
          nome: c.nm ?? '',
          nomeUrna: c.nmu || c.nm || '',
          partido: par.sg ?? '',
          partidoNome: par.nm ?? '',
          federacao: agr.tp === 'f' || agr.tp === 'c' ? agr.nm : '',
          vice: (c.vs ?? []).find((x) => x.tp === 'v')?.nmu ?? null,
          votos,
          percentual: c.pvap ? num(c.pvap) : pct(votos, validos),
          eleito: eleito(c),
          segundoTurno: segundoTurno(c),
          situacao: c.st ?? '',
          destinacao: c.dvt ?? '',
        });
      }
    }
  }
  candidatos.sort((a, b) => b.votos - a.votos || Number(a.numero) - Number(b.numero));

  const total = num(v.tv);
  const aptoTotalizadas = num(e.est) || num(e.te);
  const comparecimento = num(e.c);
  const abstencao = num(e.a);
  const secoesTotal = num(s.ts);
  const secoesTotalizadas = num(s.st);

  return {
    eleicao: bruto.ele ?? '',
    turno: bruto.t ?? '',
    abrangencia: { tipo: bruto.tpabr ?? '', codigo: bruto.cdabr ?? '' },
    atualizadoEm: [bruto.dg, bruto.hg].filter(Boolean).join(' '),
    totalizadoEm: [bruto.dt, bruto.ht].filter(Boolean).join(' '),
    cargo: { codigo: cargo.cd ?? '', nome: cargo.nmn ?? '', vagas: num(cargo.nv) },
    secoes: {
      total: secoesTotal,
      totalizadas: secoesTotalizadas,
      percentual: s.pst ? num(s.pst) : pct(secoesTotalizadas, secoesTotal),
    },
    eleitorado: {
      apto: num(e.te),
      aptoTotalizadas,
      comparecimento,
      abstencao,
      percComparecimento: e.pc ? num(e.pc) : pct(comparecimento, aptoTotalizadas),
      percAbstencao: e.pa ? num(e.pa) : pct(abstencao, aptoTotalizadas),
    },
    votos: {
      total,
      validos,
      nominais: num(v.vnom),
      brancos: num(v.vb),
      nulos: totalNulos(v),
      anulados: num(v.van) + num(v.vansj),
      percValidos: v.pvv ? num(v.pvv) : pct(validos, total),
      percBrancos: pct(num(v.vb), total),
      percNulos: pct(totalNulos(v), total),
    },
    candidatos,
  };
}

/** Soma de votos nominais por partido (útil nos cargos proporcionais). */
export function votosPorPartido(candidatos) {
  const mapa = new Map();
  for (const c of candidatos) {
    const p = mapa.get(c.partido) ?? { partido: c.partido, nome: c.partidoNome, votos: 0, eleitos: 0 };
    p.votos += c.votos;
    if (c.eleito) p.eleitos += 1;
    mapa.set(c.partido, p);
  }
  return [...mapa.values()].sort((a, b) => b.votos - a.votos);
}

/** Lista de municípios por UF a partir de `mun-e{eleição}-cm.json`. */
export function lerMunicipios(bruto) {
  const porUf = {};
  for (const a of bruto.abr ?? []) {
    porUf[String(a.cd).toLowerCase()] = (a.mu ?? [])
      .map((m) => ({ codigo: String(m.cd), nome: m.nm, ibge: m.cdi ? String(m.cdi) : null }))
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  }
  return porUf;
}

// Quantos candidatos guardar por local. Cargos majoritários (presidente, governador,
// senador) têm poucos candidatos: guarda todos. Nos proporcionais (deputados) são centenas
// por UF: guarda os mais votados de cada local, e os votos de todos os partidos.
export const MAX_CANDIDATOS_LOCAL = 15;
const LIMITE_TODOS = 30;

/** Número efetivo (Laakso-Taagepera): 1 / Σ p². Mede a fragmentação dos votos. */
export function numeroEfetivo(votos) {
  const lista = Object.values(votos).filter((v) => v > 0);
  const total = lista.reduce((t, v) => t + v, 0);
  if (!total) return null;
  return 1 / lista.reduce((t, v) => t + (v / total) ** 2, 0);
}

/**
 * Totais de um arquivo de resultado, mais os votos de candidatos e partidos em forma
 * compacta: é o que o servidor guarda de cada estado e município. Percentuais de brancos,
 * nulos e anulados sobre o total de votos; de candidatos e partidos, sobre os válidos.
 *   brancos  votos em branco (v.vb)
 *   nulos    nulos + nulos técnicos (v.tvn)
 *   anulados votos dados a candidatos com registro anulado, inclusive sub judice (v.van + v.vansj)
 *   cand     número do candidato → votos (todos, ou os mais votados nos cargos proporcionais)
 *   par      sigla do partido → votos nominais dos seus candidatos
 *   nomes    número → [nome na urna, partido, situação (1 eleito, 2 vai ao 2º turno, 0)] dos candidatos guardados
 */
export function resumoVotos(bruto) {
  const v = bruto.v ?? {};
  const s = bruto.s ?? {};
  const e = bruto.e ?? {};
  const total = num(v.tv);
  const brancos = num(v.vb);
  const nulos = totalNulos(v);
  const anulados = num(v.van) + num(v.vansj);
  const validos = num(v.vv ?? v.vvc);
  const todos = [];
  const par = {};
  for (const agr of bruto.carg?.[0]?.agr ?? []) {
    for (const p of agr.par ?? []) {
      for (const c of p.cand ?? []) {
        const votos = num(c.vap);
        todos.push({ n: String(c.n ?? ''), nome: c.nmu || c.nm || '', partido: p.sg ?? '', votos, situacao: eleito(c) ? 1 : segundoTurno(c) ? 2 : 0 });
        if (p.sg) par[p.sg] = (par[p.sg] ?? 0) + votos;
      }
    }
  }
  todos.sort((x, y) => y.votos - x.votos || Number(x.n) - Number(y.n));
  const guardados = todos.length > LIMITE_TODOS ? todos.slice(0, MAX_CANDIDATOS_LOCAL) : todos;
  const cand = {};
  const nomes = {};
  for (const c of guardados) {
    cand[c.n] = c.votos;
    nomes[c.n] = [c.nome, c.partido, c.situacao];
  }
  const comparecimento = num(e.c);
  const aptosTotalizadas = num(e.est);
  return {
    atualizadoEm: [bruto.dg, bruto.hg].filter(Boolean).join(' '),
    secoes: { total: num(s.ts), totalizadas: num(s.st) },
    eleitorado: num(e.te),
    // Eleitores aptos só das seções já totalizadas: base da abstenção parcial.
    aptosTotalizadas,
    comparecimento,
    pctComparecimento: pct(comparecimento, aptosTotalizadas),
    abstencao: num(e.a),
    pctAbstencao: pct(num(e.a), aptosTotalizadas),
    total,
    validos,
    pctValidos: pct(validos, total),
    brancos,
    nulos,
    anulados,
    pctBrancos: pct(brancos, total),
    pctNulos: pct(nulos, total),
    pctAnulados: pct(anulados, total),
    pctBrancosNulos: pct(brancos + nulos, total),
    candidatos: todos.length,
    cand,
    par,
    nomes,
    efetivoCand: numeroEfetivo(Object.fromEntries(todos.map((c) => [c.n, c.votos]))),
    efetivoPar: numeroEfetivo(par),
  };
}

const somarMapas = (mapas) => {
  const out = {};
  for (const m of mapas) for (const [k, v] of Object.entries(m ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
};

// Retratos compactos (public/resultados): os percentuais saem do arquivo, porque o navegador os
// recalcula exatamente a partir das contagens, e o número efetivo fica com 6 casas decimais.
// Corta cerca de 40% do arquivo comprimido sem perder informação visível.
const PERCENTUAIS = {
  pctComparecimento: (r) => pct(r.comparecimento, r.aptosTotalizadas),
  pctAbstencao: (r) => pct(r.abstencao, r.aptosTotalizadas),
  pctValidos: (r) => pct(r.validos, r.total),
  pctBrancos: (r) => pct(r.brancos, r.total),
  pctNulos: (r) => pct(r.nulos, r.total),
  pctAnulados: (r) => pct(r.anulados, r.total),
  pctBrancosNulos: (r) => pct(r.brancos + r.nulos, r.total),
};
const ORDEM_RESUMO = ['codigo', 'nome', 'uf', 'ibge', 'atualizadoEm', 'secoes', 'eleitorado', 'aptosTotalizadas', 'comparecimento',
  'pctComparecimento', 'abstencao', 'pctAbstencao', 'total', 'validos', 'pctValidos', 'brancos', 'nulos', 'anulados', 'pctBrancos',
  'pctNulos', 'pctAnulados', 'pctBrancosNulos', 'candidatos', 'cand', 'par', 'efetivoCand', 'efetivoPar'];
const seis = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);

export function compactarRetrato(retrato) {
  const municipios = retrato.municipios.map((m) => {
    const out = { ...m, efetivoCand: seis(m.efetivoCand), efetivoPar: seis(m.efetivoPar) };
    for (const k of Object.keys(PERCENTUAIS)) delete out[k];
    return out;
  });
  return { ...retrato, retrato: { ...retrato.retrato, compacto: true }, municipios };
}

/** Desfaz compactarRetrato: devolve cada cidade com os mesmos campos, na mesma ordem, de /api/municipios. */
export function expandirRetrato(retrato) {
  if (!retrato?.retrato?.compacto) return retrato;
  const municipios = retrato.municipios.map((m) => {
    const out = {};
    for (const k of ORDEM_RESUMO) {
      if (k in PERCENTUAIS) out[k] = PERCENTUAIS[k](m);
      else if (k in m) out[k] = m[k];
    }
    for (const k of Object.keys(m)) if (!(k in out)) out[k] = m[k];
    return out;
  });
  return { ...retrato, municipios };
}

/** Soma resumos (para consolidar o Brasil a partir das UFs, ou uma UF a partir das cidades). */
export function somarResumos(lista) {
  const soma = (f) => lista.reduce((t, r) => t + f(r), 0);
  const total = soma((r) => r.total);
  const brancos = soma((r) => r.brancos);
  const nulos = soma((r) => r.nulos);
  const anulados = soma((r) => r.anulados);
  const validos = soma((r) => r.validos);
  const aptos = soma((r) => r.aptosTotalizadas ?? 0);
  const comparecimento = soma((r) => r.comparecimento);
  const cand = somarMapas(lista.map((r) => r.cand));
  const par = somarMapas(lista.map((r) => r.par));
  const nomes = Object.assign({}, ...lista.map((r) => r.nomes ?? {}));
  return {
    atualizadoEm: lista.map((r) => r.atualizadoEm).sort(compararDataHora).at(-1) ?? '',
    secoes: { total: soma((r) => r.secoes.total), totalizadas: soma((r) => r.secoes.totalizadas) },
    eleitorado: soma((r) => r.eleitorado),
    aptosTotalizadas: aptos,
    comparecimento,
    pctComparecimento: pct(comparecimento, aptos),
    abstencao: soma((r) => r.abstencao ?? 0),
    pctAbstencao: pct(soma((r) => r.abstencao ?? 0), aptos),
    total,
    validos,
    pctValidos: pct(validos, total),
    brancos,
    nulos,
    anulados,
    pctBrancos: pct(brancos, total),
    pctNulos: pct(nulos, total),
    pctAnulados: pct(anulados, total),
    pctBrancosNulos: pct(brancos + nulos, total),
    candidatos: Math.max(0, ...lista.map((r) => r.candidatos ?? 0)),
    cand,
    par,
    nomes,
    // Nos proporcionais os candidatos guardados são só os mais votados: o número efetivo
    // de candidatos somado é aproximado; o de partidos é exato.
    efetivoCand: numeroEfetivo(cand),
    efetivoPar: numeroEfetivo(par),
  };
}

/** Candidatos de um resumo, do mais votado ao menos: [{numero, nome, partido, votos, pct}]. */
export function candidatosDe(r, nomes = r?.nomes ?? {}) {
  return Object.entries(r?.cand ?? {})
    .map(([numero, votos]) => ({ numero, nome: nomes[numero]?.[0] ?? numero, partido: nomes[numero]?.[1] ?? '', eleito: nomes[numero]?.[2] === 1, segundoTurno: nomes[numero]?.[2] === 2, votos, pct: pct(votos, r.validos) }))
    .sort((a, b) => b.votos - a.votos);
}

// "dd/mm/aaaa hh:mm:ss" em ordem cronológica.
const chaveDataHora = (t) => String(t ?? '').replace(/^(\d{2})\/(\d{2})\/(\d{4})/, '$3$2$1');
export const compararDataHora = (a, b) => chaveDataHora(a).localeCompare(chaveDataHora(b));
