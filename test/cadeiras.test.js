import test from 'node:test';
import assert from 'node:assert/strict';
import { cadeirasDoArquivo, posicoesHemiciclo, somarCadeiras, svgHemiciclo } from '../public/cadeiras.js';

const cand = (n, nome, vap, st) => ({ n, nmu: nome, vap: String(vap), st });
const arquivo = (vagasA, vagasFed) => ({
  dg: '05/10/2026', hg: '10:00:00', s: { ts: '100', st: '100' }, e: { te: '1000', c: '800', a: '200' }, v: { tv: '800', vv: '700', vb: '50' },
  carg: [{
    nv: '5', qe: '140', fed: [{ n: '101', sg: 'PT/PC do B/PV', nm: 'FEDERAÇÃO BRASIL DA ESPERANÇA' }],
    agr: [
      { tp: 'i', com: 'PL', vag: String(vagasA), par: [{ sg: 'PL', tvtn: '300', tvtl: '20', cand: [cand('2201', 'ANA', 200, 'Eleito por QP'), cand('2202', 'BIA', 100, vagasA > 1 ? 'Eleito por média' : 'Suplente')] }] },
      { tp: 'f', com: 'PCDOB / PT / PV', vag: String(vagasFed), par: [
        { sg: 'PCDOB', nfed: '101', tvtn: '50', tvtl: '0', cand: [cand('6501', 'CIDA', 50, 'Suplente')] },
        { sg: 'PT', nfed: '101', tvtn: '310', tvtl: '20', cand: [cand('1301', 'DUDA', 250, 'Eleito por QP'), cand('1302', 'EVA', 60, 'Eleito por QP'), cand('1303', 'FABI', 0, 'Eleito por média')] },
      ] },
      { tp: 'i', com: 'DC', vag: '0', par: [{ sg: 'DC', tvtn: '0', tvtl: '0', cand: [] }] },
    ],
  }],
});

test('cadeiras de uma UF: vagas por agremiação (sigla oficial da federação) e por partido', () => {
  const c = cadeirasDoArquivo(arquivo(2, 3), 'sp');
  assert.equal(c.vagas, 5);
  assert.equal(c.quociente, 140);
  assert.deepEqual(c.agremiacoes.map((a) => [a.sigla, a.vagas, a.votos]), [['PT/PC do B/PV', 3, 380], ['PL', 2, 320]]);
  assert.deepEqual(c.partidos.map((p) => [p.sigla, p.vagas, p.federacao]), [['PT', 3, 'PT/PC do B/PV'], ['PL', 2, ''], ['PCDOB', 0, 'PT/PC do B/PV']]);
  assert.equal(c.eleitos.length, 5);
  assert.equal(c.eleitos[0].nome, 'DUDA');
  assert.equal(c.porQp + c.porMedia, 5);
  assert.equal(c.resumo.validos, 700);
});

test('Brasil soma as bancadas e mantém as federações juntas', () => {
  const br = somarCadeiras([cadeirasDoArquivo(arquivo(2, 3), 'sp'), cadeirasDoArquivo(arquivo(1, 4), 'rj')]);
  assert.equal(br.vagas, 10);
  assert.deepEqual(br.agremiacoes.map((a) => [a.sigla, a.vagas]), [['PT/PC do B/PV', 7], ['PL', 3]]);
  assert.deepEqual(br.ufs.rj.partidos, { PT: 3, PL: 1 });
  assert.equal(br.resumo.validos, 1400);
});

test('hemiciclo tem exatamente uma cadeira por vaga, da esquerda para a direita', () => {
  for (const n of [1, 3, 8, 24, 94, 513, 1035]) {
    const { pontos, raio } = posicoesHemiciclo(n);
    assert.equal(pontos.length, n);
    assert.ok(raio > 0);
    for (let i = 1; i < pontos.length; i += 1) assert.ok(pontos[i - 1].ang >= pontos[i].ang);
  }
  const svg = svgHemiciclo([{ rotulo: 'A', cor: '#f00', n: 3 }, { rotulo: 'B<', cor: '#00f', n: 2 }], { total: 6 });
  assert.equal((svg.match(/data-grupo="A"/g) ?? []).length, 3);
  assert.equal((svg.match(/data-grupo="B&#60;"/g) ?? []).length, 2);
  assert.match(svg, /vaga ainda não definida/);
});
