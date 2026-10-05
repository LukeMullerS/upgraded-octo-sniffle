import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrir7z } from '../src/sete-zip.js';
import { agregarResumos, resumirLog } from '../src/log-urna.js';
import { amostrar, arquivoDeLog, criarColetorLogs, lerConfigSecoes } from '../src/logs.js';

const fixture = (nome) => readFileSync(new URL(`./fixtures/logs/${nome}`, import.meta.url));
const logd = fixture('logd.dat');

test('7z: LZMA e LZMA2 descompactam o logd.dat byte a byte', () => {
  for (const nome of ['lzma.7z', 'lzma2.7z']) {
    const [arq] = abrir7z(fixture(nome));
    assert.equal(arq.nome, 'logd.dat');
    assert.equal(Buffer.compare(Buffer.from(arq.dados), logd), 0, nome);
  }
});

test('7z: vários arquivos, inclusive vazio, sem compressão', () => {
  const arqs = abrir7z(fixture('varios.7z'));
  assert.deepEqual(arqs.map((a) => [a.nome, new TextDecoder().decode(a.dados)]),
    [['a.txt', 'primeiro arquivo\n'], ['vazio.txt', ''], ['b.txt', 'fim\n']]);
  assert.throws(() => abrir7z(new Uint8Array(40)), /não é um arquivo 7z/);
});

test('resumo do log: tempos, biometria e horários do dia da votação', () => {
  const r = resumirLog(logd);
  assert.equal(r.dia, '02/10/2022');
  assert.equal(r.modelo, 'UE2020');
  assert.equal(r.votos, 47);
  assert.equal(r.cabine.n, 47);
  assert.equal(r.cabine.mediana, 59);
  assert.ok(Math.abs(r.cabine.media - 64.34) < 0.01);
  assert.ok(Math.abs(r.atendimento.media - 88.43) < 0.01);
  assert.deepEqual(r.tipos, { biometrica: 39, manual: 5, semBiometria: 3 });
  assert.equal(r.abertura, 8 * 3600 + 1);
  assert.deepEqual(r.porHora, { 8: 21, 9: 26 });
  assert.equal(r.hist.reduce((a, b) => a + b, 0), 47);
});

test('resumo do log: voto sem habilitação registrada não quebra e eleitor cancelado não conta', () => {
  const linha = (h, msg) => `04/10/2026 ${h}\tINFO\t1\tVOTA\t${msg}\tX`;
  const r = resumirLog([
    linha('08:00:00', 'Urna pronta para receber votos'),
    linha('08:01:00', 'Título digitado pelo mesário'),
    linha('08:01:10', 'Habilitação cancelada durante reconhecimento biométrico'),
    linha('08:02:00', 'Título digitado pelo mesário'),
    linha('08:02:20', 'Eleitor foi habilitado'),
    linha('08:03:20', 'O voto do eleitor foi computado'),
    linha('08:04:00', 'O voto do eleitor foi computado'),
  ].join('\n'));
  assert.equal(r.votos, 2);
  assert.equal(r.cabine.n, 1);
  assert.equal(r.cabine.media, 60);
  assert.equal(r.atendimento.media, 80);
  assert.equal(r.canceladas, 1);
});

test('agregado pondera pelos eleitores', () => {
  const r = resumirLog(logd);
  const a = agregarResumos([r, r, null]);
  assert.equal(a.secoes, 2);
  assert.equal(a.votos, 94);
  assert.ok(Math.abs(a.cabine.media - r.cabine.media) < 1e-9);
  assert.ok(Math.abs(a.pctBiometrica - (39 / 47) * 100) < 1e-9);
});

test('config, aux e amostra', () => {
  const m = lerConfigSecoes({ abr: [{ cd: 'AP', mu: [{ cd: '6050', nm: 'MACAPÁ', zon: [{ cd: '2', sec: [{ ns: '824' }, { ns: '825' }] }] }] }] }, 'ap');
  assert.deepEqual(m, [{ codigo: '06050', nome: 'MACAPÁ', secoes: [{ zona: '0002', secao: '0824' }, { zona: '0002', secao: '0825' }] }]);
  assert.deepEqual(arquivoDeLog({ hashes: [{ hash: '0' }, { hash: 'abc', arq: [{ nm: 'o03220ap0605000020824-bu.dat' }, { nm: 'o03220ap0605000020824-log.jez' }] }] }),
    { hash: 'abc', nome: 'o03220ap0605000020824-log.jez' });
  assert.deepEqual(arquivoDeLog({ hashes: [{ hash: 'h', nmarq: ['o00406-0605000020824.logjez'] }] }), { hash: 'h', nome: 'o00406-0605000020824.logjez' });
  assert.equal(arquivoDeLog({ hashes: [{ hash: 'h', arq: [{ nm: 'x-bu.dat' }] }] }), null);
  assert.deepEqual(amostrar([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3), [2, 6, 9]);
  assert.deepEqual(amostrar([1, 2], 5), [1, 2]);
});

test('compilação nacional: lê o que foi publicado, usa o acompanhamento e não relê', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'logs-'));
  const base = 'ele2026/arquivo-urna/3220';
  const json = {
    [`${base}/config/ap/ap-p003220-cs.json`]: { abr: [{ cd: 'AP', mu: [
      { cd: '06050', nm: 'MACAPÁ', zon: [{ cd: '0002', sec: [{ ns: '0001' }, { ns: '0002' }] }] },
      { cd: '06100', nm: 'OIAPOQUE', zon: [{ cd: '0003', sec: [{ ns: '0001' }] }] },
    ] }] },
    [`${base}/dados/ap/06050/0002/0001/p003220-ap-m06050-z0002-s0001-aux.json`]: { hashes: [{ hash: 'h1', arq: [{ nm: 'o-0001-log.jez' }] }] },
  };
  const binarios = { [`${base}/dados/ap/06050/0002/0001/h1/o-0001-log.jez`]: fixture('lzma2.7z') };
  const pedidos = [];
  let st = new Map([['06050', 1], ['06100', 0]]);
  const opcoes = {
    pasta, ufs: ['ap', 'sp'],
    buscarJson: async (c) => { pedidos.push(c); return json[c] ?? null; },
    buscarBinario: async (c) => { pedidos.push(c); return binarios[c] ?? null; },
    totalizadas: async (uf) => (uf === 'ap' ? st : null),
    agendar: () => 0, cancelar: () => {},
  };
  const col = criarColetorLogs(opcoes);
  await col.iniciar();
  await col.rodar();
  let r = await col.municipio('ap', '06050');
  assert.equal(r.totalSecoes, 2);
  assert.equal(r.secoes.length, 1, 'só a seção publicada');
  assert.equal(r.resumo.votos, 47);
  assert.ok(!pedidos.some((c) => c.includes('/06100/')), 'Oiapoque sem seções totalizadas não é consultado');
  let n = await col.nacional();
  assert.equal(n.lidas, 1);
  assert.equal(n.porUf.find((u) => u.uf === 'ap').total, 3);
  assert.deepEqual((await readdir(join(pasta, '3220'))).sort(), ['ap', 'resumo.json']);

  // Passada seguinte: Macapá já tem tantas lidas quanto totalizadas → nada é pedido.
  const antes = pedidos.length;
  await col.rodar();
  assert.ok(!pedidos.slice(antes).some((c) => c.includes('/06050/')), 'Macapá em dia não é consultado de novo');

  // Sai a segunda seção: o acompanhamento passa a 2 e só ela é baixada.
  st = new Map([['06050', 2], ['06100', 0]]);
  json[`${base}/dados/ap/06050/0002/0002/p003220-ap-m06050-z0002-s0002-aux.json`] = { hashes: [{ hash: 'h2', arq: [{ nm: 'o-0002-log.jez' }] }] };
  binarios[`${base}/dados/ap/06050/0002/0002/h2/o-0002-log.jez`] = fixture('lzma.7z');
  await col.rodar();
  assert.equal((await col.municipio('ap', '06050')).secoes.length, 2);
  assert.equal(pedidos.filter((c) => c.endsWith('h1/o-0001-log.jez')).length, 1, 'seção já lida nunca é baixada de novo');

  // Reinício: o índice volta do disco, sem baixar nada.
  const col2 = criarColetorLogs({ ...opcoes, buscarBinario: async () => { throw new Error('não devia baixar'); } });
  const e = await col2.estado('ap');
  assert.equal(e.municipios.find((m) => m.codigo === '06050').lidas, 2);
  assert.equal(e.resumo.votos, 94);
  const b = await col2.brasil(['ap', 'sp']);
  assert.deepEqual(b.estados.map((x) => x.uf), ['ap']);
  assert.equal(b.resumo.votos, 94);
  const todos = await col2.todosMunicipios();
  assert.deepEqual(todos.map((m) => [m.uf, m.codigo, m.lidas]), [['ap', '06050', 2]]);
});

test('compilação nacional: pausada não lê nada; município pedido na tela é lido na hora', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'logs-'));
  const base = 'ele2026/arquivo-urna/3220';
  const json = {
    [`${base}/config/ap/ap-p003220-cs.json`]: { abr: [{ cd: 'AP', mu: [{ cd: '06050', nm: 'MACAPÁ', zon: [{ cd: '0002', sec: [{ ns: '0001' }] }] }] }] },
    [`${base}/dados/ap/06050/0002/0001/p003220-ap-m06050-z0002-s0001-aux.json`]: { hashes: [{ hash: 'h1', arq: [{ nm: 'o-log.jez' }] }] },
  };
  const col = criarColetorLogs({
    pasta, ufs: ['ap'], agendar: () => 0, cancelar: () => {},
    buscarJson: async (c) => json[c] ?? null,
    buscarBinario: async () => fixture('lzma.7z'),
  });
  await col.iniciar();
  col.pausar();
  await col.rodar();
  assert.equal((await col.nacional()).lidas, 0);
  const r = await col.municipio('ap', '06050', { coletar: true });
  assert.equal(r.secoes.length, 1);
});
