import test from 'node:test';
import assert from 'node:assert/strict';
import { compactar, somarCsv } from '../scripts/atualizar-zonas.mjs';

const CAB = '"NR_TURNO";"SG_UF";"CD_MUNICIPIO";"NM_MUNICIPIO";"NR_ZONA";"CD_CARGO";"NR_CANDIDATO";"NM_URNA_CANDIDATO";"SG_PARTIDO";"DS_SIT_TOT_TURNO";"NM_TIPO_DESTINACAO_VOTOS";"QT_VOTOS_NOMINAIS"';
const linha = (turno, zona, cargo, n, nome, votos, destino = 'Válido') =>
  `${turno};"RR";3018;"BOA VISTA";${zona};${cargo};${n};"${nome}";"PX";"ELEITO";"${destino}";${votos}`;

test('votos por zona: soma por cidade, zona e candidato (só o turno pedido) e ordena pelo total', async () => {
  const cidades = {};
  await somarCsv([CAB,
    linha(1, 1, 3, 22, 'ANA', 100), linha(1, 5, 3, 22, 'ANA', 80),
    linha(1, 1, 3, 10, 'BETO', 30), linha(1, 5, 3, 10, 'BETO', 200),
    linha(1, 5, 3, 10, 'BETO', 5), // voto em trânsito: outra linha da mesma zona
    linha(1, 1, 3, 77, 'CAIO', 9, 'Anulado'),
    linha(1, 1, 3, 50, 'DANI', 0),
    linha(2, 1, 3, 22, 'ANA', 999), // 2º turno: fica de fora
  ], cidades, 1);
  const c = compactar(cidades['rr/03018']);
  assert.deepEqual(c.zonas, ['0001', '0005']);
  assert.deepEqual(c.cargos, [{ cargo: 3, candidatos: [
    [10, 'BETO', 'PX', 'ELEITO', 1, [30, 205]],
    [22, 'ANA', 'PX', 'ELEITO', 1, [100, 80]],
    [77, 'CAIO', 'PX', 'ELEITO', 0, [9, 0]],
  ] }]); // DANI (0 votos) sai
});
