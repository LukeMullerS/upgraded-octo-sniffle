// Leitor do boletim de urna (BU) publicado pelo TSE para cada seção (arquivo -bu.dat):
// ASN.1 em BER, um "envelope" cujo conteúdo é o boletim com os votos de cada cargo. Sem
// bibliotecas: lê a estrutura BER e pega os campos pela posição e pelas marcas (tags) da
// especificação do TSE.
//
// Boletim (sequência): cabeçalho · fase · urna · identificação da seção · data de emissão ·
//   abertura/encerramento · ... · resultados por eleição [ { eleição, aptos, ..., resultados
//   [ { tipo de cargo, comparecimento, totais por cargo [ { [1] cargo, ordem, votáveis
//   [ { [1] tipo de voto, [2] quantidade, [3] { partido, número }, ... } ] } ] } ] } ]

/** Nós BER de bytes[i..fim): { cls, tag, cons, filhos | val }. */
export function lerBer(b, i = 0, fim = b.length) {
  const out = [];
  while (i < fim) {
    const t0 = b[i++];
    let tag = t0 & 0x1f;
    if (tag === 0x1f) { tag = 0; let x; do { x = b[i++]; tag = (tag << 7) | (x & 0x7f); } while (x & 0x80); }
    let len = b[i++];
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k += 1) len = len * 256 + b[i++]; }
    if (i + len > fim) throw new Error('boletim corrompido (tamanho além do fim)');
    const no = { cls: t0 >> 6, tag, cons: Boolean(t0 & 0x20) };
    if (no.cons) no.filhos = lerBer(b, i, i + len); else no.val = b.subarray(i, i + len);
    out.push(no);
    i += len;
  }
  return out;
}

const inteiro = (n) => {
  if (!n?.val?.length) return null;
  let x = 0;
  for (const c of n.val) x = x * 256 + c;
  return n.val[0] & 0x80 ? x - 2 ** (8 * n.val.length) : x;
};
const texto = (n) => (n?.val ? new TextDecoder('latin1').decode(n.val) : null);
const ctx = (n, tag) => n?.filhos?.find((f) => f.cls === 2 && f.tag === tag);
const TIPOS_VOTO = { 1: 'nominal', 2: 'branco', 3: 'nulo', 4: 'legenda', 5: 'cargoSemCandidato' };
// "20261004T070001" → "04/10/2026 07:00:01"
const dataHora = (t) => (t && /^\d{8}T\d{6}$/.test(t) ? `${t.slice(6, 8)}/${t.slice(4, 6)}/${t.slice(0, 4)} ${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}` : t);

/**
 * Boletim de urna → { municipio, zona, local, secao, abertura, encerramento, eleicoes: [{ eleicao,
 *   aptos, cargos: [{ cargo, comparecimento, votos: [{ tipo, partido, numero, votos }] }] }] }
 */
export function lerBoletim(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const envelope = lerBer(b)[0];
  if (!envelope?.cons) throw new Error('não é um boletim de urna');
  const conteudo = envelope.filhos.at(-1);
  const bu = lerBer(conteudo.val)[0];
  const f = bu.filhos;
  // Identificação da seção: { { município, zona }, local, seção }
  const sec = f.find((n) => n.cons && n.filhos.length === 3 && n.filhos[0].cons && n.filhos[0].filhos.length === 2 && !n.filhos[1].cons);
  const resultados = f.find((n) => n.cons && n.filhos.length && n.filhos.every((e) => e.cons && inteiro(e.filhos[0]) > 1000));
  const datas = f.find((n) => n.cons && n.filhos.length === 2 && n.filhos.every((x) => /^\d{8}T\d{6}$/.test(texto(x) ?? '')));
  if (!resultados) throw new Error('boletim sem resultados');
  const eleicoes = resultados.filhos.map((e) => {
    const lista = e.filhos.find((x) => x.cons);
    const cargos = [];
    for (const rv of lista?.filhos ?? []) {
      const comparecimento = inteiro(rv.filhos[1]);
      const totais = rv.filhos.find((x, k) => k > 1 && x.cons);
      for (const tc of totais?.filhos ?? []) {
        const codigo = ctx(tc, 1);
        const cargo = codigo?.cons ? inteiro(codigo.filhos[0]) : inteiro(codigo);
        const votaveis = tc.filhos.find((x) => x.cls === 0 && x.cons);
        const votos = (votaveis?.filhos ?? []).map((v) => {
          const id = ctx(v, 3);
          return {
            tipo: TIPOS_VOTO[inteiro(ctx(v, 1))] ?? 'outro',
            votos: inteiro(ctx(v, 2)) ?? 0,
            partido: id ? inteiro(id.filhos[0]) : null,
            numero: id ? inteiro(id.filhos[1]) : null,
          };
        });
        cargos.push({ cargo, comparecimento, votos });
      }
    }
    return { eleicao: String(inteiro(e.filhos[0])), aptos: inteiro(e.filhos[1]), cargos };
  });
  return {
    municipio: sec ? String(inteiro(sec.filhos[0].filhos[0])).padStart(5, '0') : null,
    zona: sec ? String(inteiro(sec.filhos[0].filhos[1])).padStart(4, '0') : null,
    local: sec ? inteiro(sec.filhos[1]) : null,
    secao: sec ? String(inteiro(sec.filhos[2])).padStart(4, '0') : null,
    abertura: datas ? dataHora(texto(datas.filhos[0])) : null,
    encerramento: datas ? dataHora(texto(datas.filhos[1])) : null,
    eleicoes,
  };
}
