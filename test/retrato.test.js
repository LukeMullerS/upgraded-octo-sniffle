import test from 'node:test';
import assert from 'node:assert/strict';
import { recortarUf } from '../public/comum.js';

const cidade = (uf, codigo, cand) => ({
  codigo, nome: `C${codigo}`, uf, atualizadoEm: '06/10/2026 10:00:00', secoes: { total: 1, totalizadas: 1 },
  eleitorado: 100, aptosTotalizadas: 100, comparecimento: 80, abstencao: 20, total: 80, brancos: 5, nulos: 5,
  anulados: 0, validos: 70, candidatos: 2, cand, par: {},
});

test('recorte de uma UF do retrato nacional de cargo estadual volta ao formato da UF', () => {
  const retrato = {
    eleicao: '6259', cargo: 3, uf: 'todas', retrato: { completo: true },
    municipios: [cidade('pe', '1', { 'pe:40': 40, 'pe:55': 30 }), cidade('sp', '2', { 'sp:40': 10, 'sp:10': 60 })],
    nomes: { 'pe:40': ['ANA · PE', 'PSB', 0], 'pe:55': ['BIA · PE', 'PSD', 1], 'sp:40': ['CAIO · SP', 'PSB', 0] },
  };
  const r = recortarUf(retrato, 'pe');
  assert.equal(r.uf, 'pe');
  assert.equal(r.municipios.length, 1);
  assert.deepEqual(r.municipios[0].cand, { 40: 40, 55: 30 });
  assert.deepEqual(r.nomes, { 40: ['ANA', 'PSB', 0], 55: ['BIA', 'PSD', 1] });
  assert.equal(r.consolidado.validos, 70);
  assert.equal(r.consolidado.nomes, undefined);
});

test('recorte de cargo nacional mantém os números dos candidatos', () => {
  const retrato = { uf: 'todas', municipios: [cidade('ba', '1', { 13: 50, 22: 20 }), cidade('rj', '2', { 13: 10, 22: 60 })], nomes: { 13: ['LULA', 'PT', 0] } };
  const r = recortarUf(retrato, 'rj');
  assert.deepEqual(r.municipios[0].cand, { 13: 10, 22: 60 });
  assert.deepEqual(r.nomes, { 13: ['LULA', 'PT', 0] });
  assert.equal(r.consolidado.cand[22], 60);
});
