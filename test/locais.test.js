import test from 'node:test';
import assert from 'node:assert/strict';
import { campos, lerCsv } from '../scripts/atualizar-locais.mjs';
import { celulasVoronoi } from '../public/voronoi.js';

const CAB = '"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";"NR_SECAO";"NR_SECAO_PRINCIPAL";"NR_LOCAL_VOTACAO";"NM_LOCAL_VOTACAO";"NM_BAIRRO";"DS_ENDERECO";"NR_LATITUDE";"NR_LONGITUDE";"QT_ELEITOR_SECAO"';
const linha = (sec, principal, local, nome, lat, lon, n) => `"RR";"03018";"BOA VISTA";1;${sec};${principal};${local};"${nome}";"CENTRO";"RUA A; 10";"${lat}";"${lon}";${n}`;

test('CSV do TSE: campos com aspas e ";" dentro', () => {
  assert.deepEqual(campos('"a";"b;c";3;"d ""e"""'), ['a', 'b;c', '3', 'd "e"']);
});

test('locais de votação: seções agrupadas por local, agregadas e posição', () => {
  const csv = [CAB,
    linha(1, -1, 1015, 'ESCOLA A', '2,83194', '-60,66518', 300),
    linha(2, -1, 1015, 'ESCOLA A', '2,83194', '-60,66518', 250),
    linha(9, 2, 1015, 'ESCOLA A', '2,83194', '-60,66518', 40),
    linha(3, -1, 1023, 'ESCOLA B', '-1', '-1', 100),
  ].join('\r\n');
  const c = lerCsv(csv)['03018'];
  assert.equal(c.nome, 'BOA VISTA');
  const [a, b] = [...c.locais.values()];
  assert.deepEqual(a, ['0001', 1015, 'ESCOLA A', 'CENTRO', 'RUA A; 10', 2.83194, -60.66518, 590, ['0001', '0002', '0009']]);
  assert.equal(b[5], null); // -1 = sem posição
  assert.deepEqual(c.agregadas, { '0001-0009': '0001-0002' });
});

test('Voronoi: as células cobrem a caixa inteira e cada aresta interna aponta o vizinho', () => {
  const area = (cel) => Math.abs(cel.reduce((t, v, i) => { const w = cel[(i + 1) % cel.length]; return t + v.x * w.y - w.x * v.y; }, 0)) / 2;
  let semente = 7;
  const aleatorio = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  const pontos = Array.from({ length: 400 }, () => ({ x: aleatorio() * 10, y: aleatorio() * 5 }));
  const cels = celulasVoronoi(pontos, [0, 0, 10, 5]);
  assert.ok(Math.abs(cels.reduce((t, c) => t + area(c), 0) - 50) < 1e-6);
  // Cada ponto está dentro da própria célula, e o vizinho de uma aresta tem a aresta de volta.
  cels.forEach((cel, i) => {
    for (const v of cel) if (v.viz !== null) assert.ok(cels[v.viz].some((w) => w.viz === i));
  });
  const dois = celulasVoronoi([{ x: 1, y: 1 }, { x: 3, y: 1 }], [0, 0, 4, 2]);
  assert.deepEqual(dois[0].map((v) => [v.x, v.y, v.viz]), [[0, 0, null], [2, 0, 1], [2, 2, null], [0, 2, null]]);
});
