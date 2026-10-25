import test from 'node:test';
import assert from 'node:assert/strict';
import { projetar } from '../public/projecao-modelo.js';
import { aleatorio } from '../public/calculos.js';

// 27 unidades sintéticas com resultado "verdadeiro" conhecido: no 2º turno, A fica com a fatia do
// 1º turno, mais 60% dos votos dos outros candidatos, mais 2 p.p., com um ruído pequeno por unidade.
function cenario({ apurado, semente = 3 }) {
  const rng = aleatorio(semente);
  const unidades = [];
  let verdadeA = 0;
  let verdadeV = 0;
  for (let i = 0; i < 27; i += 1) {
    const aptos = Math.round(500_000 + rng() * 9_000_000);
    const A1 = 0.25 + rng() * 0.4;
    const O1 = 0.05 + rng() * 0.15;
    const B1 = 1 - A1 - O1;
    const comp1 = 0.75 + rng() * 0.1;
    const validos1 = Math.round(aptos * comp1 * 0.94);
    const y = Math.min(0.95, Math.max(0.05, A1 + 0.6 * O1 + 0.02 + (rng() - 0.5) * 0.02));
    const validosTot = Math.round(aptos * comp1 * 0.96);
    verdadeA += y * validosTot;
    verdadeV += validosTot;
    const f = apurado(i);
    const validos = Math.round(validosTot * f);
    // A parte apurada primeiro difere um pouco do resto da unidade.
    const yApurado = Math.min(0.99, Math.max(0.01, y + (f < 1 ? (rng() - 0.5) * 0.03 : 0)));
    const votosA = Math.round(validos * yApurado);
    unidades.push({
      id: `u${i}`, nome: `U${i}`, aptos, aptosApurados: Math.round(aptos * f),
      comparecimento: Math.round(aptos * f * comp1), validos, votosA, votosB: validos - votosA,
      t1: { aptos, comparecimento: Math.round(aptos * comp1), validos: validos1, votosA: Math.round(validos1 * A1), votosB: Math.round(validos1 * B1) },
    });
  }
  return { unidades, verdade: verdadeA / verdadeV };
}

test('projeção: com parte dos estados apurada, acerta o resultado dentro do intervalo', () => {
  // Metade das unidades com 30% apurado, as outras sem nada.
  const { unidades, verdade } = cenario({ apurado: (i) => (i % 2 ? 0.3 : 0) });
  const r = projetar({ unidades, simulacoes: 2000 });
  assert.ok(Math.abs(r.projecao - verdade) < 0.015, `projeção ${r.projecao} longe da verdade ${verdade}`);
  assert.ok(r.intervalo[0] <= verdade && verdade <= r.intervalo[1], `verdade ${verdade} fora de ${r.intervalo}`);
  assert.ok(r.modelo.beta > 0, 'os votos dos outros pendem para A');
  assert.ok(r.fracaoApurada > 0.05 && r.fracaoApurada < 0.3);
});

test('projeção: tudo apurado dá exatamente o resultado, com intervalo fechado', () => {
  const { unidades, verdade } = cenario({ apurado: () => 1 });
  const r = projetar({ unidades, simulacoes: 300 });
  assert.ok(Math.abs(r.projecao - verdade) < 1e-4);
  assert.ok(r.intervalo[1] - r.intervalo[0] < 1e-6);
  assert.ok(r.chanceA === 0 || r.chanceA === 1);
});

test('projeção: nada apurado usa só o 1º turno (metade dos outros para cada lado) e fica incerta', () => {
  const { unidades } = cenario({ apurado: () => 0 });
  const r = projetar({ unidades, simulacoes: 2000 });
  const base = unidades.reduce((t, u) => t + (u.t1.votosA + 0.5 * (u.t1.validos - u.t1.votosA - u.t1.votosB)), 0)
    / unidades.reduce((t, u) => t + u.t1.validos, 0);
  assert.ok(Math.abs(r.projecao - base) < 0.01);
  assert.ok(r.intervalo[1] - r.intervalo[0] > 0.05, 'sem apuração o intervalo tem de ser largo');
  assert.equal(r.modelo.n, 0);
});

import { valorP } from '../public/projecao-modelo.js';

test('valor p bilateral da normal: z = 1,96 → 0,05; z = 3,29 → 0,001; z = 0 → 1', () => {
  assert.ok(Math.abs(valorP(1.96) - 0.05) < 1e-3);
  assert.ok(Math.abs(valorP(3.2905) - 0.001) < 1e-4);
  assert.ok(Math.abs(valorP(0) - 1) < 1e-6);
});

test('teste da vantagem: sem nada apurado não é significativo; com tudo apurado, p ≈ 0', () => {
  const vazio = cenario({ apurado: () => 0 });
  assert.ok(projetar({ unidades: vazio.unidades, simulacoes: 1500 }).teste.p > 0.001);
  const cheio = cenario({ apurado: () => 1 });
  assert.ok(projetar({ unidades: cheio.unidades, simulacoes: 300 }).teste.p < 0.001);
});
