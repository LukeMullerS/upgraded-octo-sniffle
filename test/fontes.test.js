import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarFontes, lerIpea, lerLocalidades } from '../src/fontes.js';
import { criarCenso, dividir } from '../src/censo.js';

test('lerIpea fica com o valor mais recente de municípios e UFs', () => {
  const r = lerIpea({ value: [
    { VALDATA: '2000-01-01T00:00:00-02:00', VALVALOR: 0.5, NIVNOME: 'Municípios', TERCODIGO: '2611606' },
    { VALDATA: '2010-01-01T00:00:00-03:00', VALVALOR: 0.772, NIVNOME: 'Municípios', TERCODIGO: '2611606' },
    { VALDATA: '2010-01-01T00:00:00-03:00', VALVALOR: 0.673, NIVNOME: 'Estados', TERCODIGO: '26' },
    { VALDATA: '2010-01-01T00:00:00-03:00', VALVALOR: null, NIVNOME: 'Municípios', TERCODIGO: '1' },
    { VALDATA: '2010-01-01T00:00:00-03:00', VALVALOR: 0.727, NIVNOME: 'Brasil', TERCODIGO: '0' },
  ] });
  assert.deepEqual(r, { municipios: { 2611606: 0.772 }, ufs: { pe: 0.673 } });
});

test('lerLocalidades monta a divisão regional (e aceita município sem microrregião)', () => {
  const r = lerLocalidades([
    { id: 2611606, nome: 'Recife', microrregiao: { nome: 'Recife', mesorregiao: { nome: 'Metropolitana de Recife' } }, 'regiao-imediata': { nome: 'Recife', 'regiao-intermediaria': { nome: 'Recife' } } },
    { id: 5101837, nome: 'Boa Esperança do Norte', microrregiao: null, 'regiao-imediata': { nome: 'Sorriso', 'regiao-intermediaria': { nome: 'Sinop' } } },
  ]);
  assert.equal(r['2611606'].meso, 'Metropolitana de Recife');
  assert.equal(r['5101837'].micro, null);
  assert.equal(r['5101837'].intermediaria, 'Sinop');
});

test('série do Ipeadata é baixada uma vez e guardada', async () => {
  let pedidos = 0;
  const buscar = async (url) => {
    pedidos += 1;
    assert.match(url, /ValoresSerie\(SERCODIGO='ADH_IDHM'\)$/);
    return { ok: true, json: async () => ({ value: [{ VALDATA: '2010', VALVALOR: 0.8, NIVNOME: 'Municípios', TERCODIGO: '3550308' }] }) };
  };
  const pasta = await mkdtemp(join(tmpdir(), 'fontes-'));
  const f = criarFontes({ pasta, buscar, ipea: 'http://ipea.falso' });
  const s = await f.serieIpea('idhm');
  assert.equal(s.municipios['3550308'], 0.8);
  await f.serieIpea('idhm');
  assert.equal(pedidos, 1);
  const f2 = criarFontes({ pasta, buscar: async () => { throw new Error('sem rede'); }, ipea: 'http://ipea.falso' });
  assert.equal((await f2.serieIpea('idhm')).municipios['3550308'], 0.8, 'lida do disco');
  await assert.rejects(f.serieIpea('naoexiste'));
});

test('presets com categoria percentual e razão entre séries', async () => {
  const META = {
    9605: { nome: 'Cor', nivelTerritorial: { Administrativo: ['N3', 'N6'] }, variaveis: [{ id: 93, nome: 'População residente', unidade: 'Pessoas' }],
      classificacoes: [{ id: 86, nome: 'Cor ou raça', categorias: [{ id: 95251, nome: 'Total', nivel: 0 }, { id: 2779, nome: 'Parda', nivel: 1 }] }] },
    4714: { nome: 'Pop', nivelTerritorial: { Administrativo: ['N3', 'N6'] }, variaveis: [{ id: 93, nome: 'População residente', unidade: 'Pessoas' }], classificacoes: [] },
    5938: { nome: 'PIB', nivelTerritorial: { Administrativo: ['N3', 'N6'] }, variaveis: [{ id: 37, nome: 'Produto Interno Bruto a preços correntes', unidade: 'Mil Reais' }], classificacoes: [] },
  };
  const buscar = async (url) => {
    const tabela = url.match(/agregados\/(\d+)/)[1];
    let corpo;
    if (url.endsWith('/metadados')) corpo = META[tabela];
    else if (url.endsWith('/periodos')) corpo = [{ id: '2022' }];
    else {
      const parda = decodeURIComponent(url).includes('86[2779]');
      const v = { 9605: parda ? 600 : 1000, 4714: 1000, 5938: 50_000 }[tabela];
      const nivel = url.includes('N6') ? '2611606' : '26';
      corpo = [{ resultados: [{ series: [{ localidade: { id: nivel }, serie: { 2022: String(v) } }] }] }];
    }
    return { ok: true, json: async () => corpo };
  };
  const c = criarCenso({ pasta: await mkdtemp(join(tmpdir(), 'censo-')), buscar, base: 'http://ibge.falso/agregados' });
  const p = await c.preset('cor_pardos');
  assert.equal(p.municipios['2611606'], 60);
  assert.equal(p.ufs.pe, 60);
  assert.equal(p.unidade, '%');
  const pib = await c.preset('pibPerCapita');
  assert.equal(pib.municipios['2611606'], 50_000);
  assert.deepEqual(dividir({ a: 1, b: 2 }, { a: 4, b: 0 }, 100), { a: 25 });
});
