import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { num, normalizar, urlResultado, urlMunicipios, urlFoto, votosPorPartido, lerMunicipios } from '../public/tse.js';

const bruto = JSON.parse(readFileSync(new URL('./fixtures/br-c0001-e006257-u.json', import.meta.url)));

test('num lê números em pt-BR', () => {
  assert.equal(num('1.234.567'), 1234567);
  assert.equal(num('45,67'), 45.67);
  assert.equal(num(''), 0);
  assert.equal(num(undefined), 0);
});

test('URLs seguem o layout do TSE 2026', () => {
  const base = 'https://resultados.tse.jus.br/oficial';
  assert.equal(urlResultado(base, '6257', 'br', 1), `${base}/ele2026/6257/dados/br/br-c0001-e006257-u.json`);
  assert.equal(urlResultado(base, '6259', 'SP', 3), `${base}/ele2026/6259/dados/sp/sp-c0003-e006259-u.json`);
  assert.equal(urlResultado(base, '6259', 'sp', 6, '71072'), `${base}/ele2026/6259/dados/sp/sp71072-c0006-e006259-u.json`);
  assert.equal(urlMunicipios(base, '6261'), `${base}/ele2026/6261/config/mun-e006261-cm.json`);
  assert.equal(urlFoto(base, '6257', 'br', '280001'), `${base}/ele2026/6257/fotos/br/280001.jpeg`);
});

test('normalizar converte o arquivo de resultado', () => {
  const d = normalizar(bruto);
  assert.equal(d.cargo.nome, 'Presidente');
  assert.equal(d.secoes.total, 472075);
  assert.equal(d.secoes.percentual, 50.02);
  assert.equal(d.eleitorado.comparecimento, 61004112);
  assert.equal(d.votos.validos, 56120900);
  assert.equal(d.atualizadoEm, '04/10/2026 19:42:10');
  assert.deepEqual(d.candidatos.map((c) => c.nomeUrna), ['CANDIDATO A', 'CANDIDATO B', 'CANDIDATO C']);
  assert.equal(d.candidatos[0].vice, 'VICE A');
  assert.equal(d.candidatos[0].partido, 'PT');
  assert.equal(d.candidatos[0].percentual, 45);
  assert.equal(d.candidatos[0].situacao, '2º turno');
});

test('normalizar tolera arquivo sem votos', () => {
  const d = normalizar({ carg: [] });
  assert.equal(d.candidatos.length, 0);
  assert.equal(d.secoes.percentual, 0);
});

test('votosPorPartido agrega candidatos', () => {
  const p = votosPorPartido(normalizar(bruto).candidatos);
  assert.equal(p[0].partido, 'PT');
  assert.equal(p.length, 3);
});

test('lerMunicipios indexa por UF', () => {
  const m = lerMunicipios({ abr: [{ cd: 'PE', mu: [{ cd: '25810', nm: 'RECIFE' }, { cd: '25003', nm: 'FERNANDO DE NORONHA' }] }] });
  assert.deepEqual(m.pe.map((x) => x.nome), ['FERNANDO DE NORONHA', 'RECIFE']);
});
