import test from 'node:test';
import assert from 'node:assert/strict';
import { citacoes, fontesDeDados } from '../public/citar.js';

const data = new Date(2026, 9, 5, 12);
const url = 'https://votolab.exemplo/';
const ref = (id) => citacoes({ url, data }).find((r) => r.id === id).texto;

test('ABNT: sobrenome em maiúsculas, título em negrito no HTML, acesso com mês abreviado', () => {
  assert.equal(ref('abnt'), 'MÜLLER-SILVEIRA, Lucas. Voto Lab: análise das Eleições 2026 com dados públicos. Versão 1.0. [S. l.]: [s. n.], 2026. Aplicativo web. Disponível em: https://votolab.exemplo/. Acesso em: 5 out. 2026.');
  assert.match(citacoes({ url, data })[0].html, /<strong>Voto Lab<\/strong>/);
});

test('APA, MLA e Chicago', () => {
  assert.equal(ref('apa'), 'Müller-Silveira, L. (2026). Voto Lab: Análise das Eleições 2026 com dados públicos (Versão 1.0) [Aplicativo web]. https://votolab.exemplo/');
  assert.equal(ref('mla'), 'Müller-Silveira, Lucas. Voto Lab: Análise das Eleições 2026 com dados públicos. Versão 1.0, 2026, https://votolab.exemplo/. Acesso em 5 out. 2026');
  assert.equal(ref('chicago'), 'Müller-Silveira, Lucas. 2026. Voto Lab: Análise das Eleições 2026 com dados públicos. Versão 1.0. Aplicativo web. https://votolab.exemplo/.');
});

test('BibTeX e fontes dos dados', () => {
  const bib = ref('bibtex');
  assert.match(bib, /^@software\{mullersilveira2026votolab,/);
  assert.match(bib, /urldate = \{2026-10-05\}/);
  const f = fontesDeDados(data);
  assert.equal(f.length, 3);
  assert.equal(f[0].texto, 'BRASIL. Tribunal Superior Eleitoral. Resultados: Eleições 2026. Brasília, DF: TSE, 2026. Disponível em: https://resultados.tse.jus.br. Acesso em: 5 out. 2026.');
  assert.equal(fontesDeDados(data, 'apa')[1].texto, 'Instituto Brasileiro de Geografia e Estatística. (2026). Sistema IBGE de Recuperação Automática – SIDRA [Base de dados]. https://sidra.ibge.gov.br');
  assert.match(fontesDeDados(data, 'mla')[2].texto, /^Instituto de Pesquisa Econômica Aplicada\. Ipeadata: Atlas do Desenvolvimento Humano no Brasil\. Ipea, 2026, www\.ipeadata\.gov\.br\. Acesso em 5 out\. 2026\.$/);
  assert.match(fontesDeDados(data, 'chicago')[0].texto, /^Tribunal Superior Eleitoral\. 2026\. Resultados: Eleições 2026\. Brasília, DF: TSE\./);
  assert.match(fontesDeDados(data, 'bibtex')[0].texto, /^@misc\{tse2026resultados,/);
});
