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

import { compactarRetrato, expandirRetrato } from '../public/tse.js';
import { versionarTexto } from '../scripts/versionar.mjs';

test('retrato compacto volta com os mesmos campos, na mesma ordem, e percentuais exatos', () => {
  const m = { ...cidade('pe', '1', { 13: 50, 22: 20 }), pctComparecimento: 80, pctAbstencao: 20, pctValidos: 87.5, pctBrancos: 6.25, pctNulos: 6.25, pctAnulados: 0, pctBrancosNulos: 12.5, efetivoCand: 1.6949152542, efetivoPar: null };
  const ordem = ['codigo', 'nome', 'uf', 'atualizadoEm', 'secoes', 'eleitorado', 'aptosTotalizadas', 'comparecimento', 'pctComparecimento', 'abstencao', 'pctAbstencao', 'total', 'validos', 'pctValidos', 'brancos', 'nulos', 'anulados', 'pctBrancos', 'pctNulos', 'pctAnulados', 'pctBrancosNulos', 'candidatos', 'cand', 'par', 'efetivoCand', 'efetivoPar'];
  const original = Object.fromEntries(ordem.map((k) => [k, m[k]]));
  const compacto = compactarRetrato({ retrato: { completo: true }, municipios: [original] });
  assert.equal(compacto.retrato.compacto, true);
  assert.equal('pctValidos' in compacto.municipios[0], false);
  const volta = expandirRetrato(JSON.parse(JSON.stringify(compacto))).municipios[0];
  assert.deepEqual(Object.keys(volta), ordem);
  assert.deepEqual({ ...volta, efetivoCand: 0 }, { ...original, efetivoCand: 0 });
  assert.ok(Math.abs(volta.efetivoCand - original.efetivoCand) < 1e-6);
});

test('versionar põe ?v= em todos os imports relativos, scripts e folhas de estilo', () => {
  const js = "import { a } from './comum.js';\nimport './exportar.js';\nconst m = await import('./campo.js');\nimport x from 'externo';";
  assert.equal(versionarTexto(js, 'js', 'abc'), "import { a } from './comum.js?v=abc';\nimport './exportar.js?v=abc';\nconst m = await import('./campo.js?v=abc');\nimport x from 'externo';");
  const html = '<link rel="stylesheet" href="style.css"><link rel="manifest" href="manifest.json"><script src="tema.js"></script><script type="module" src="app.js"></script><a href="x.js">';
  assert.equal(versionarTexto(html, 'html', 'abc'), '<link rel="stylesheet" href="style.css?v=abc"><link rel="manifest" href="manifest.json"><script src="tema.js?v=abc"></script><script type="module" src="app.js?v=abc"></script><a href="x.js">');
});
