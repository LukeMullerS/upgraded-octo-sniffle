import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { abrirZip, ehZip } from '../src/zip.js';
import { resumirLog } from '../src/log-urna.js';
import { COLUNAS_SECAO, linhaSecao, criarRitmo } from '../scripts/atualizar-urnas.mjs';
import { expandirSecoes } from '../public/comum.js';

/** ZIP mínimo com um arquivo (deflate), como o .jez das urnas em 2026. */
function zip(nome, conteudo) {
  const dados = Buffer.from(conteudo, 'latin1');
  const comp = deflateRawSync(dados);
  const n = Buffer.from(nome, 'latin1');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const inicioCentral = 30 + n.length + comp.length;
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(46 + n.length, 12); fim.writeUInt32LE(inicioCentral, 16);
  return new Uint8Array(Buffer.concat([local, n, comp, central, n, fim]));
}

const linha = (hora, msg) => `04/10/2026 ${hora}\tINFO\t02020667\tVOTA\t${msg}\t0`;
const LOG_2026 = [
  linha('07:00:00', 'Urna pronta para receber votos'),
  linha('07:02:57', 'Identificador do eleitor digitado pelo mesário'),
  linha('07:03:59', 'Capturada a digital. Tentativa [2] de [4]'),
  linha('07:04:04', 'Tipo de habilitação do eleitor [biométrica]'),
  linha('07:04:04', 'Eleitor foi habilitado'),
  linha('07:04:45', 'O voto do eleitor foi computado'),
  linha('07:10:00', 'Identificador do eleitor digitado pelo mesário'),
  linha('07:10:30', 'Solicitação de dado pessoal do eleitor para habilitação manual'),
  linha('07:11:00', 'Eleitor foi habilitado'),
  linha('07:12:00', 'O voto do eleitor foi computado'),
].join('\r\n');

test('ZIP (formato do log da urna em 2026) é aberto e o logd.dat lido', () => {
  const z = zip('logd.dat', LOG_2026);
  assert.equal(ehZip(z), true);
  assert.equal(ehZip(new Uint8Array([0x37, 0x7a, 0xbc, 0xaf])), false);
  const [arq] = abrirZip(z);
  assert.equal(arq.nome, 'logd.dat');
  assert.equal(new TextDecoder('latin1').decode(arq.dados), LOG_2026);
});

test('mensagens de 2026: identificador digitado e tipo de habilitação', () => {
  const r = resumirLog(LOG_2026);
  assert.equal(r.votos, 2);
  assert.deepEqual(r.tipos, { biometrica: 1, manual: 1, semBiometria: 0 });
  assert.equal(r.atendimento.n, 2);
  assert.equal(r.atendimento.soma, 108 + 120);
  assert.equal(r.habilitacao.soma, 67 + 60);
  assert.equal(r.cabine.soma, 41 + 60);
});

test('seções em linhas compactas voltam ao formato da página', () => {
  const r = { zona: '0001', secao: '0002', votos: 220, modelo: 'UE2020', bateria: 1, cabine: { media: 59.559, mediana: 47, p90: 86 },
    atendimento: { media: 82.686 }, tipos: { biometrica: 208 }, primeiroVoto: 25288, ultimoVoto: 57172 };
  const d = expandirSecoes({ uf: 'rr', colunas: COLUNAS_SECAO, linhas: [linhaSecao(r)] });
  assert.equal(d.colunas, undefined);
  assert.deepEqual(d.secoes[0], { ...r, cabine: { media: 59.6, mediana: 47, p90: 86 }, atendimento: { media: 82.7 } });
  assert.equal(expandirSecoes({ secoes: [1] }).secoes.length, 1);
});

test('ritmo espaça as seções', async () => {
  let t = 0;
  const ritmo = criarRitmo(600, () => t); // 600/min = uma a cada 100 ms
  const inicio = Date.now();
  await ritmo(); await ritmo(); await ritmo();
  assert.ok(Date.now() - inicio >= 190);
  t = 0;
  await criarRitmo(0)();
});
