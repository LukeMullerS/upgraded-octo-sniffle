import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { categoriaTotal, criarCenso, lerValores, numeroIbge } from '../src/censo.js';

const META = {
  nome: 'Taxa de alfabetização',
  nivelTerritorial: { Administrativo: ['N1', 'N3', 'N6'] },
  variaveis: [{ id: 2513, nome: 'Taxa de alfabetização das pessoas de 15 anos ou mais', unidade: '%' }],
  classificacoes: [
    { id: 2, nome: 'Sexo', categorias: [{ id: 4, nome: 'Homens', nivel: 1 }, { id: 6794, nome: 'Total', nivel: 0 }] },
    { id: 58, nome: 'Idade', categorias: [{ id: 95253, nome: '15 anos ou mais', nivel: 0 }, { id: 1, nome: '15 a 19', nivel: 1 }] },
  ],
};
const valores = (ids) => [{ id: '2513', resultados: [{ series: ids.map(([id, v]) => ({ localidade: { id }, serie: { 2022: v } })) }] }];

function fetchFalso() {
  const urls = [];
  const buscar = async (url) => {
    urls.push(url);
    let corpo;
    if (url.endsWith('/metadados')) corpo = META;
    else if (url.endsWith('/periodos')) corpo = [{ id: '2022' }];
    else if (url.includes('N6')) corpo = valores([['3550308', '97.5'], ['2611606', '-']]);
    else corpo = valores([['35', '97.1'], ['26', '88.2']]);
    return { ok: true, json: async () => corpo };
  };
  return { buscar, urls };
}

test('helpers', () => {
  assert.equal(numeroIbge('12.5'), 12.5);
  assert.equal(numeroIbge('-'), null);
  assert.equal(numeroIbge('...'), null);
  assert.equal(categoriaTotal(META.classificacoes[0]).id, 6794);
  assert.equal(categoriaTotal(META.classificacoes[1]).id, 95253, 'sem "Total", usa o nível mais alto');
  assert.deepEqual(lerValores(valores([['1', '2'], ['3', 'X']]), '2022'), { 1: 2 });
});

test('preset acha a variável pelo nome, usa os totais e guarda em disco', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'censo-'));
  const f = fetchFalso();
  const censo = criarCenso({ pasta, buscar: f.buscar });
  const r = await censo.preset('alfabetizacao');
  assert.deepEqual(r.municipios, { 3550308: 97.5 });
  assert.deepEqual(r.ufs, { sp: 97.1, pe: 88.2 });
  const urlMun = f.urls.find((u) => u.includes('N6'));
  assert.match(decodeURIComponent(urlMun), /periodos\/2022\/variaveis\/2513\?localidades=N6\[all\]&classificacao=2\[6794\]\|58\[95253\]/);
  assert.equal((await readdir(pasta)).length, 1);

  // Outra instância lê do disco, sem pedir valores ao IBGE de novo.
  const g = fetchFalso();
  const r2 = await criarCenso({ pasta, buscar: g.buscar }).preset('alfabetizacao');
  assert.deepEqual(r2.ufs, r.ufs);
  assert.equal(g.urls.filter((u) => u.includes('localidades')).length, 0);
});

test('categoria escolhida substitui o total', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'censo-'));
  const f = fetchFalso();
  const r = await criarCenso({ pasta, buscar: f.buscar }).serie({ tabela: '9543', variavel: '2513', classificacao: { 2: '4' } });
  assert.deepEqual(r.categorias, ['Sexo: Homens', 'Idade: 15 anos ou mais']);
});
