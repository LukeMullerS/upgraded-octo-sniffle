import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarMapas, simplificar } from '../src/mapas.js';

const quadrado = (x, y, l) => [[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]];

test('simplificar arredonda, remove repetidos e marca a UF', () => {
  const g = simplificar({ features: [
    { properties: { codarea: '35' }, geometry: { type: 'Polygon', coordinates: [[[-46.123456, -23.5], [-46.1234561, -23.5], [-46, -23.5], [-46, -23], [-46.123456, -23]]] } },
    { properties: { codarea: '3550308' }, geometry: { type: 'MultiPolygon', coordinates: [[quadrado(-46.6, -23.6, 0.1)]] } },
    { properties: { codarea: '1' }, geometry: { type: 'Point', coordinates: [0, 0] } },
  ] });
  assert.equal(g.features.length, 2);
  assert.equal(g.features[0].properties.uf, 'sp');
  assert.equal(g.features[0].geometry.type, 'MultiPolygon');
  assert.deepEqual(g.features[0].geometry.coordinates[0][0][0], [-46.123, -23.5]);
  assert.equal(g.features[0].geometry.coordinates[0][0].length, 4, 'ponto repetido removido');
  assert.equal(g.features[1].properties.uf, 'sp');
});

test('malha é baixada uma vez e guardada em disco', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'mapas-'));
  const urls = [];
  const buscar = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ features: [{ properties: { codarea: '16' }, geometry: { type: 'Polygon', coordinates: [quadrado(-52, 0, 1)] } }] }) };
  };
  const m = criarMapas({ pasta, base: 'https://ibge', buscar });
  const g = await m.malha({ uf: 'ap' });
  await m.malha({ uf: 'ap' });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /estados\/16\?.*intrarregiao=municipio/);
  assert.equal(g.features[0].properties.uf, 'ap');
  assert.deepEqual(await readdir(pasta), ['uf-ap.json']);
  const m2 = criarMapas({ pasta, buscar: async () => { throw new Error('não devia baixar'); } });
  assert.equal((await m2.malha({ uf: 'ap' })).features.length, 1);
  await assert.rejects(() => m.malha({ uf: 'zz' }), /exterior/);
});
