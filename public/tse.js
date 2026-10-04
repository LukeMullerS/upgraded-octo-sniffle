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
    cargos: [
      { codigo: 1, nome: 'Presidente', majoritario: true, abrangencias: ['br', ...TODAS_UFS, 'zz'] },
    ],
  },
  6259: {
    codigo: '6259',
    nome: 'Eleições Gerais Estaduais 2026',
    cargos: [
      { codigo: 3, nome: 'Governador', majoritario: true, abrangencias: TODAS_UFS },
      { codigo: 5, nome: 'Senador', majoritario: true, abrangencias: TODAS_UFS },
      { codigo: 6, nome: 'Deputado Federal', majoritario: false, abrangencias: TODAS_UFS },
      { codigo: 7, nome: 'Deputado Estadual', majoritario: false, abrangencias: TODAS_UFS.filter((u) => u !== 'df') },
      { codigo: 8, nome: 'Deputado Distrital', majoritario: false, abrangencias: ['df'] },
    ],
  },
  6261: {
    codigo: '6261',
    nome: 'Eleição Conselho Distrital 2026',
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

/** Converte o JSON bruto do TSE num objeto com números de verdade e candidatos ordenados. */
export function normalizar(bruto) {
  const cargo = bruto.carg?.[0] ?? {};
  const v = bruto.v ?? {};
  const e = bruto.e ?? {};
  const s = bruto.s ?? {};
  const validos = num(v.vv);

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
          eleito: c.e === 's',
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
      nulos: num(v.vn),
      anulados: num(v.van),
      percValidos: v.pvv ? num(v.pvv) : pct(validos, total),
      percBrancos: v.pvb ? num(v.pvb) : pct(num(v.vb), total),
      percNulos: v.pvn ? num(v.pvn) : pct(num(v.vn), total),
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
      .map((m) => ({ codigo: String(m.cd), nome: m.nm }))
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  }
  return porUf;
}
