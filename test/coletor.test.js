import test from 'node:test';
import assert from 'node:assert/strict';
import { criarColetor, marcasAcompanhamento } from '../src/coletor.js';
import { resumoVotos, somarResumos } from '../public/tse.js';

const resultado = ({ st = '0', c = '0', tv = '0', vb = '0', tvn = '0', van = '0', vansj = '0' } = {}) => ({
  dg: '04/10/2026', hg: '19:00:00',
  s: { ts: '10', st }, e: { te: '1.000', c }, v: { tv, vv: '0', vb, tvn, van, vansj },
  carg: [{ agr: [] }],
});

// TSE falso: arquivos em memória, contando quantas vezes cada um foi pedido.
function tseFalso(arquivos) {
  const pedidos = new Map();
  return {
    pedidos,
    arquivos,
    async buscarJson(caminho) {
      pedidos.set(caminho, (pedidos.get(caminho) ?? 0) + 1);
      return arquivos[caminho] ?? null;
    },
  };
}

const MUN = 'ele2026/6257/config/mun-e006257-cm.json';
const AB = 'ele2026/6257/dados/pe/pe-e006257-ab.json';
const arqMun = (cd) => `ele2026/6257/dados/pe/pe${cd}-c0001-e006257-u.json`;

function cenario() {
  return tseFalso({
    [MUN]: { abr: [{ cd: 'PE', mu: [{ cd: '25313', nm: 'RECIFE' }, { cd: '25003', nm: 'FERNANDO DE NORONHA' }] }] },
    [AB]: { abr: [
      { tpabr: 'mun', cdabr: '25313', s: { st: '5' }, e: { c: '500' } },
      { tpabr: 'mun', cdabr: '25003', s: { st: '1' }, e: { c: '100' } },
    ] },
    [arqMun('25313')]: resultado({ st: '5', c: '500', tv: '500', vb: '20', tvn: '30' }),
    [arqMun('25003')]: resultado({ st: '1', c: '100', tv: '100', vb: '5', tvn: '5', van: '1', vansj: '1' }),
  });
}

function coletorDeTeste(tse) {
  const timers = [];
  let relogio = 0;
  const coletor = criarColetor({
    buscarJson: tse.buscarJson,
    agora: () => relogio,
    agendar: (fn) => { timers.push(fn); return timers.length; },
    cancelar: () => {},
  });
  return {
    coletor,
    async tique(ms = 120_000) {
      relogio += ms;
      for (const fn of timers) fn();
      await Promise.all([...coletor.alvos.values()].map((a) => a.rodando));
    },
  };
}

test('resumoVotos usa total de nulos e soma anulados sub judice', () => {
  const r = resumoVotos(resultado({ tv: '1.000', vb: '40', tvn: '60', van: '3', vansj: '2' }));
  assert.equal(r.brancos, 40);
  assert.equal(r.nulos, 60);
  assert.equal(r.anulados, 5);
  assert.equal(r.pctBrancosNulos, 10);
  const s = somarResumos([r, r]);
  assert.equal(s.total, 2000);
  assert.equal(s.pctBrancos, 4);
});

test('marcasAcompanhamento normaliza os números', () => {
  const m = marcasAcompanhamento({ abr: [{ tpabr: 'mun', cdabr: '1', s: { st: '1.234' }, e: { c: '10' } }, { tpabr: 'uf', cdabr: 'pe' }] });
  assert.deepEqual([...m], [['1', '1234:10']]);
});

test('lê todos os municípios na primeira consulta e consolida', async () => {
  const tse = cenario();
  const { coletor } = coletorDeTeste(tse);
  const r = await coletor.municipios('6257', 1, 'pe');
  assert.equal(r.total, 2);
  assert.equal(r.lidos, 2);
  assert.equal(r.consolidado.brancos, 25);
  assert.equal(r.consolidado.nulos, 35);
  assert.equal(r.consolidado.anulados, 2);
  assert.equal(r.municipios.find((m) => m.nome === 'RECIFE').pctBrancos, 4);
});

test('nas passadas seguintes só baixa o município que mudou no acompanhamento', async () => {
  const tse = cenario();
  const { coletor, tique } = coletorDeTeste(tse);
  await coletor.municipios('6257', 1, 'pe');

  await tique();
  assert.equal(tse.pedidos.get(arqMun('25313')), 1, 'sem mudança, não relê');

  tse.arquivos[AB].abr[0].s.st = '7';
  tse.arquivos[arqMun('25313')] = resultado({ st: '7', c: '500', tv: '700', vb: '70', tvn: '0' });
  await tique();
  assert.equal(tse.pedidos.get(arqMun('25313')), 2);
  assert.equal(tse.pedidos.get(arqMun('25003')), 1);
  const r = await coletor.municipios('6257', 1, 'pe');
  assert.equal(r.municipios.find((m) => m.nome === 'RECIFE').brancos, 70);
});

test('arquivo do município atrasado em relação ao acompanhamento é relido depois', async () => {
  const tse = cenario();
  const { coletor, tique } = coletorDeTeste(tse);
  await coletor.municipios('6257', 1, 'pe');

  tse.arquivos[AB].abr[0].s.st = '7'; // acompanhamento já diz 7, o arquivo ainda diz 5
  await tique();
  assert.equal(tse.pedidos.get(arqMun('25313')), 2);
  tse.arquivos[arqMun('25313')] = resultado({ st: '7', c: '500', tv: '700' });
  await tique();
  assert.equal(tse.pedidos.get(arqMun('25313')), 3);
  await tique();
  assert.equal(tse.pedidos.get(arqMun('25313')), 3, 'em dia, pára de reler');
});

test('estados lê o arquivo de cada UF e o do Brasil', async () => {
  const tse = tseFalso({
    'ele2026/6257/dados/pe/pe-c0001-e006257-u.json': resultado({ tv: '100', vb: '10' }),
    'ele2026/6257/dados/sp/sp-c0001-e006257-u.json': resultado({ tv: '300', vb: '6' }),
  });
  const { coletor } = coletorDeTeste(tse);
  const r = await coletor.estados('6257', 1, ['br', 'pe', 'sp', 'rj']);
  assert.equal(r.total, 3);
  assert.equal(r.lidos, 2);
  assert.equal(r.estados.find((e) => e.uf === 'pe').nome, 'Pernambuco');
  assert.equal(r.brasil.brancos, 16, 'sem arquivo do Brasil, soma as UFs');
});
