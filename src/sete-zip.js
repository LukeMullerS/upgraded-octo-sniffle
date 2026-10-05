// Leitor mínimo de arquivos 7z, em JavaScript puro (sem dependências nem 7-Zip instalado).
//
// Serve para abrir os logs das urnas (log.jez / .logjez), que são 7z com um arquivo de
// texto (logd.dat). Suporta os métodos LZMA, LZMA2 e "Copy", com ou sem cabeçalho
// compactado. Baseado na especificação do formato 7z (7zFormat.txt) e no decodificador de
// referência do LZMA (LzmaSpec.cpp), ambos de domínio público, de Igor Pavlov.

const ASSINATURA = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
const ID = {
  fim: 0x00, cabecalho: 0x01, propriedades: 0x02, streamsAdicionais: 0x03, streamsPrincipais: 0x04,
  arquivos: 0x05, pacotes: 0x06, desempacotar: 0x07, subStreams: 0x08, tamanho: 0x09, crc: 0x0a,
  pasta: 0x0b, tamanhosDesempacotados: 0x0c, numStreams: 0x0d, streamVazio: 0x0e, arquivoVazio: 0x0f,
  nome: 0x11, cabecalhoCodificado: 0x17, dummy: 0x19,
};

// ---------------------------------------------------------------------------
// Decodificador LZMA (LzmaSpec.cpp)
// ---------------------------------------------------------------------------

const PROB_INICIAL = 1024;
const novaProb = (n) => new Uint16Array(n).fill(PROB_INICIAL);

class Faixa {
  constructor(dados, inicio) {
    this.d = dados;
    this.p = inicio;
    if (this.d[this.p++] !== 0) throw new Error('7z: fluxo LZMA corrompido');
    this.faixa = 0xffffffff;
    this.codigo = 0;
    for (let i = 0; i < 4; i += 1) this.codigo = ((this.codigo << 8) | this.d[this.p++]) >>> 0;
  }

  normalizar() {
    if (this.faixa < 0x1000000) {
      this.faixa = (this.faixa << 8) >>> 0;
      this.codigo = ((this.codigo << 8) | (this.d[this.p++] ?? 0)) >>> 0;
    }
  }

  bit(probs, i) {
    const prob = probs[i];
    const limite = (this.faixa >>> 11) * prob;
    let b;
    if (this.codigo < limite) {
      this.faixa = limite;
      probs[i] = prob + ((2048 - prob) >>> 5);
      b = 0;
    } else {
      this.faixa = (this.faixa - limite) >>> 0;
      this.codigo = (this.codigo - limite) >>> 0;
      probs[i] = prob - (prob >>> 5);
      b = 1;
    }
    this.normalizar();
    return b;
  }

  diretos(n) {
    let res = 0;
    for (let k = 0; k < n; k += 1) {
      this.faixa >>>= 1;
      this.codigo = (this.codigo - this.faixa) >>> 0;
      const t = 0 - (this.codigo >>> 31);
      this.codigo = (this.codigo + (this.faixa & t)) >>> 0;
      this.normalizar();
      res = ((res << 1) + t + 1) >>> 0;
    }
    return res;
  }

  arvore(probs, base, bits) {
    let m = 1;
    for (let i = 0; i < bits; i += 1) m = (m << 1) + this.bit(probs, base + m);
    return m - (1 << bits);
  }

  arvoreReversa(probs, base, bits) {
    let m = 1;
    let sym = 0;
    for (let i = 0; i < bits; i += 1) {
      const b = this.bit(probs, base + m);
      m = (m << 1) + b;
      sym |= b << i;
    }
    return sym;
  }
}

class DecodificadorLzma {
  constructor(saida) {
    this.saida = saida; // Uint8Array com o tamanho final; serve também de dicionário
    this.pos = 0;
  }

  propriedades(lc, lp, pb) {
    if (lc > 8 || lp > 4 || pb > 4) throw new Error('7z: propriedades LZMA inválidas');
    Object.assign(this, { lc, lp, pb });
    this.reiniciarEstado();
  }

  reiniciarEstado() {
    this.literais = novaProb(0x300 << (this.lc + this.lp));
    this.ehMatch = novaProb(12 << 4);
    this.ehRep = novaProb(12);
    this.ehRepG0 = novaProb(12);
    this.ehRepG1 = novaProb(12);
    this.ehRepG2 = novaProb(12);
    this.ehRep0Longo = novaProb(12 << 4);
    this.slots = novaProb(4 << 6);
    this.posicoes = novaProb(115);
    this.alinhamento = novaProb(16);
    this.compr = this.novoComprimento();
    this.comprRep = this.novoComprimento();
    this.estado = 0;
    this.reps = [0, 0, 0, 0];
  }

  novoComprimento() {
    return { escolha: novaProb(2), baixo: novaProb(16 << 3), medio: novaProb(16 << 3), alto: novaProb(256) };
  }

  comprimento(f, c, posState) {
    if (!f.bit(c.escolha, 0)) return f.arvore(c.baixo, posState << 3, 3);
    if (!f.bit(c.escolha, 1)) return 8 + f.arvore(c.medio, posState << 3, 3);
    return 16 + f.arvore(c.alto, 0, 8);
  }

  distancia(f, len) {
    const lenState = Math.min(len, 3);
    const slot = f.arvore(this.slots, lenState << 6, 6);
    if (slot < 4) return slot;
    const bits = (slot >>> 1) - 1;
    let dist = ((2 | (slot & 1)) << bits) >>> 0;
    if (slot < 14) return (dist + f.arvoreReversa(this.posicoes, dist - slot, bits)) >>> 0;
    dist = (dist + (f.diretos(bits - 4) << 4)) >>> 0;
    return (dist + f.arvoreReversa(this.alinhamento, 0, 4)) >>> 0;
  }

  /** Decodifica um fluxo LZMA até produzir `quantos` bytes (ou achar o marcador de fim). */
  decodificar(dados, inicio, quantos) {
    const f = new Faixa(dados, inicio);
    const out = this.saida;
    const fim = this.pos + quantos;
    const { lc, lp, pb } = this;
    const maskLp = (1 << lp) - 1;
    const maskPb = (1 << pb) - 1;
    let { estado } = this;
    let [rep0, rep1, rep2, rep3] = this.reps;
    let pos = this.pos;
    while (pos < fim) {
      const posState = pos & maskPb;
      if (!f.bit(this.ehMatch, (estado << 4) + posState)) {
        const anterior = pos > 0 ? out[pos - 1] : 0;
        const base = 0x300 * (((pos & maskLp) << lc) + (anterior >>> (8 - lc)));
        let sym = 1;
        if (estado >= 7) {
          let byteMatch = out[pos - rep0 - 1];
          do {
            const bitMatch = (byteMatch >>> 7) & 1;
            byteMatch <<= 1;
            const b = f.bit(this.literais, base + ((1 + bitMatch) << 8) + sym);
            sym = (sym << 1) | b;
            if (bitMatch !== b) break;
          } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | f.bit(this.literais, base + sym);
        out[pos++] = sym & 0xff;
        estado = estado < 4 ? 0 : estado < 10 ? estado - 3 : estado - 6;
        continue;
      }
      let len;
      if (f.bit(this.ehRep, estado)) {
        if (pos === 0) throw new Error('7z: fluxo LZMA corrompido');
        if (!f.bit(this.ehRepG0, estado)) {
          if (!f.bit(this.ehRep0Longo, (estado << 4) + posState)) {
            estado = estado < 7 ? 9 : 11;
            out[pos] = out[pos - rep0 - 1];
            pos += 1;
            continue;
          }
        } else {
          let dist;
          if (!f.bit(this.ehRepG1, estado)) {
            dist = rep1;
          } else {
            if (!f.bit(this.ehRepG2, estado)) {
              dist = rep2;
            } else {
              dist = rep3;
              rep3 = rep2;
            }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = dist;
        }
        len = this.comprimento(f, this.comprRep, posState);
        estado = estado < 7 ? 8 : 11;
      } else {
        rep3 = rep2;
        rep2 = rep1;
        rep1 = rep0;
        len = this.comprimento(f, this.compr, posState);
        estado = estado < 7 ? 7 : 10;
        rep0 = this.distancia(f, len);
        if (rep0 === 0xffffffff) break; // marcador de fim
        if (rep0 >= pos) throw new Error('7z: fluxo LZMA corrompido (distância)');
      }
      len += 2;
      const copiar = Math.min(len, fim - pos);
      for (let i = 0; i < copiar; i += 1) {
        out[pos] = out[pos - rep0 - 1];
        pos += 1;
      }
    }
    this.estado = estado;
    this.reps = [rep0, rep1, rep2, rep3];
    this.pos = pos;
    return f.p;
  }
}

function lzma(props, dados, tamanho) {
  let d = props[0];
  const lc = d % 9;
  d = Math.floor(d / 9);
  const lp = d % 5;
  const pb = Math.floor(d / 5);
  const dec = new DecodificadorLzma(new Uint8Array(tamanho));
  dec.propriedades(lc, lp, pb);
  dec.decodificar(dados, 0, tamanho);
  return dec.saida;
}

function lzma2(dados, tamanho) {
  const dec = new DecodificadorLzma(new Uint8Array(tamanho));
  let p = 0;
  let temPropriedades = false;
  while (p < dados.length) {
    const ctrl = dados[p++];
    if (ctrl === 0x00) break;
    if (ctrl === 0x01 || ctrl === 0x02) {
      const n = ((dados[p] << 8) | dados[p + 1]) + 1;
      p += 2;
      dec.saida.set(dados.subarray(p, p + n), dec.pos);
      dec.pos += n;
      p += n;
      continue;
    }
    if (ctrl < 0x80) throw new Error('7z: bloco LZMA2 inválido');
    const desempacotado = ((ctrl & 0x1f) << 16) + (dados[p] << 8) + dados[p + 1] + 1;
    const empacotado = (dados[p + 2] << 8) + dados[p + 3] + 1;
    p += 4;
    const modo = (ctrl >>> 5) & 3;
    if (modo >= 2) {
      let b = dados[p++];
      const lc = b % 9;
      b = Math.floor(b / 9);
      dec.propriedades(lc, b % 5, Math.floor(b / 5));
      temPropriedades = true;
    } else if (!temPropriedades) {
      throw new Error('7z: LZMA2 sem propriedades');
    } else if (modo === 1) {
      dec.reiniciarEstado();
    }
    dec.decodificar(dados, p, desempacotado);
    p += empacotado;
  }
  return dec.saida.subarray(0, dec.pos);
}

// ---------------------------------------------------------------------------
// Formato 7z
// ---------------------------------------------------------------------------

class Leitor {
  constructor(dados, p = 0) {
    this.d = dados;
    this.p = p;
  }

  byte() {
    if (this.p >= this.d.length) throw new Error('7z: cabeçalho truncado');
    return this.d[this.p++];
  }

  numero() {
    const primeiro = this.byte();
    let mascara = 0x80;
    let valor = 0;
    for (let i = 0; i < 8; i += 1) {
      if ((primeiro & mascara) === 0) return valor + (primeiro & (mascara - 1)) * 2 ** (8 * i);
      valor += this.byte() * 2 ** (8 * i);
      mascara >>>= 1;
    }
    return valor;
  }

  uint32() {
    const v = this.d[this.p] | (this.d[this.p + 1] << 8) | (this.d[this.p + 2] << 16) | (this.d[this.p + 3] << 24);
    this.p += 4;
    return v >>> 0;
  }

  bytes(n) {
    const b = this.d.subarray(this.p, this.p + n);
    this.p += n;
    return b;
  }

  bits(n) {
    const v = [];
    let b = 0;
    let mascara = 0;
    for (let i = 0; i < n; i += 1) {
      if (mascara === 0) { b = this.byte(); mascara = 0x80; }
      v.push((b & mascara) !== 0);
      mascara >>>= 1;
    }
    return v;
  }

  bitsOuTodos(n) {
    return this.byte() ? new Array(n).fill(true) : this.bits(n);
  }

  esperar(id) {
    const v = this.numero();
    if (v !== id) throw new Error(`7z: esperado 0x${id.toString(16)}, veio 0x${v.toString(16)}`);
  }
}

const uint64 = (d, p) => d[p] + d[p + 1] * 2 ** 8 + d[p + 2] * 2 ** 16 + d[p + 3] * 2 ** 24 + d[p + 4] * 2 ** 32 + d[p + 5] * 2 ** 40;

function lerPacotes(l) {
  const info = { posicao: l.numero(), tamanhos: [] };
  const n = l.numero();
  for (;;) {
    const id = l.numero();
    if (id === ID.fim) break;
    if (id === ID.tamanho) for (let i = 0; i < n; i += 1) info.tamanhos.push(l.numero());
    else if (id === ID.crc) { const def = l.bitsOuTodos(n); def.forEach((v) => v && l.uint32()); }
    else throw new Error('7z: propriedade inesperada em PackInfo');
  }
  return info;
}

function lerPasta(l) {
  const coders = [];
  const nCoders = l.numero();
  let totalSaidas = 0;
  let totalEntradas = 0;
  for (let i = 0; i < nCoders; i += 1) {
    const flags = l.byte();
    const id = [...l.bytes(flags & 0x0f)].map((b) => b.toString(16).padStart(2, '0')).join('');
    let entradas = 1;
    let saidas = 1;
    if (flags & 0x10) { entradas = l.numero(); saidas = l.numero(); }
    const props = flags & 0x20 ? l.bytes(l.numero()) : new Uint8Array(0);
    if (flags & 0x80) throw new Error('7z: métodos alternativos não suportados');
    coders.push({ id, entradas, saidas, props });
    totalEntradas += entradas;
    totalSaidas += saidas;
  }
  const ligacoes = [];
  for (let i = 0; i < totalSaidas - 1; i += 1) ligacoes.push({ entrada: l.numero(), saida: l.numero() });
  const nPacotes = totalEntradas - ligacoes.length;
  if (nPacotes > 1) for (let i = 0; i < nPacotes; i += 1) l.numero();
  return { coders, ligacoes, totalSaidas, tamanhos: [] };
}

function lerDesempacotar(l) {
  l.esperar(ID.pasta);
  const n = l.numero();
  if (l.byte() !== 0) throw new Error('7z: pastas externas não suportadas');
  const pastas = [];
  for (let i = 0; i < n; i += 1) pastas.push(lerPasta(l));
  l.esperar(ID.tamanhosDesempacotados);
  for (const p of pastas) for (let i = 0; i < p.totalSaidas; i += 1) p.tamanhos.push(l.numero());
  for (;;) {
    const id = l.numero();
    if (id === ID.fim) break;
    if (id === ID.crc) { const def = l.bitsOuTodos(n); def.forEach((v) => v && l.uint32()); }
    else throw new Error('7z: propriedade inesperada em UnPackInfo');
  }
  return pastas;
}

function lerSubStreams(l, pastas) {
  for (const p of pastas) p.nStreams = 1;
  let id = l.numero();
  if (id === ID.numStreams) {
    for (const p of pastas) p.nStreams = l.numero();
    id = l.numero();
  }
  for (const p of pastas) p.subTamanhos = [];
  if (id === ID.tamanho) {
    for (const p of pastas) {
      if (!p.nStreams) continue;
      let soma = 0;
      for (let i = 0; i < p.nStreams - 1; i += 1) { const t = l.numero(); p.subTamanhos.push(t); soma += t; }
      p.subTamanhos.push(tamanhoFinal(p) - soma);
    }
    id = l.numero();
  } else {
    for (const p of pastas) if (p.nStreams === 1) p.subTamanhos.push(tamanhoFinal(p));
  }
  while (id !== ID.fim) {
    if (id === ID.crc) {
      const n = pastas.reduce((t, p) => t + (p.nStreams === 1 ? 0 : p.nStreams), 0) + pastas.filter((p) => p.nStreams === 1).length;
      const def = l.bitsOuTodos(n);
      def.forEach((v) => v && l.uint32());
    } else {
      throw new Error('7z: propriedade inesperada em SubStreamsInfo');
    }
    id = l.numero();
  }
}

// Saída final da pasta: a saída que não alimenta nenhum outro coder.
function tamanhoFinal(p) {
  for (let i = 0; i < p.totalSaidas; i += 1) if (!p.ligacoes.some((b) => b.saida === i)) return p.tamanhos[i];
  return p.tamanhos[0];
}

function lerStreams(l) {
  const info = { pacotes: null, pastas: [] };
  for (;;) {
    const id = l.numero();
    if (id === ID.fim) break;
    if (id === ID.pacotes) info.pacotes = lerPacotes(l);
    else if (id === ID.desempacotar) info.pastas = lerDesempacotar(l);
    else if (id === ID.subStreams) lerSubStreams(l, info.pastas);
    else throw new Error('7z: propriedade inesperada em StreamsInfo');
  }
  for (const p of info.pastas) {
    if (p.nStreams === undefined) { p.nStreams = 1; p.subTamanhos = [tamanhoFinal(p)]; }
  }
  return info;
}

/** Descompacta uma pasta (um único coder LZMA, LZMA2 ou Copy). */
// Um logd.dat tem poucos MB. Limite contra "bombas" de compressão: um arquivo pequeno que
// declara um tamanho descompactado enorme faria o servidor reservar gigabytes de memória.
export const MAX_DESCOMPACTADO = 256 * 1024 * 1024;

function decodificarPasta(arquivo, pasta, inicioPacote, tamanhoPacote) {
  if (pasta.coders.length !== 1) throw new Error('7z: cadeia de métodos não suportada');
  const { id, props } = pasta.coders[0];
  if (!Number.isSafeInteger(tamanhoPacote) || tamanhoPacote < 0 || inicioPacote + tamanhoPacote > arquivo.length) throw new Error('7z: pacote fora do arquivo');
  const dados = arquivo.subarray(inicioPacote, inicioPacote + tamanhoPacote);
  const tamanho = tamanhoFinal(pasta);
  if (!Number.isSafeInteger(tamanho) || tamanho < 0 || tamanho > MAX_DESCOMPACTADO) throw new Error('7z: tamanho descompactado inválido ou grande demais');
  if (id === '00') return dados.slice(0, tamanho);
  if (id === '030101') return lzma(props, dados, tamanho);
  if (id === '21') return lzma2(dados, tamanho);
  if (id === '06f10701') throw new Error('7z: arquivo protegido por senha');
  throw new Error(`7z: método ${id} não suportado`);
}

function extrairStreams(arquivo, info) {
  const saida = [];
  let pos = 32 + (info.pacotes?.posicao ?? 0);
  info.pastas.forEach((pasta, i) => {
    const tamanhoPacote = info.pacotes.tamanhos[i];
    const dados = decodificarPasta(arquivo, pasta, pos, tamanhoPacote);
    pos += tamanhoPacote;
    let off = 0;
    for (const t of pasta.subTamanhos) {
      saida.push(dados.subarray(off, off + t));
      off += t;
    }
  });
  return saida;
}

function lerArquivos(l) {
  const n = l.numero();
  const arquivos = Array.from({ length: n }, () => ({ nome: '', vazio: false }));
  for (;;) {
    const tipo = l.numero();
    if (tipo === ID.fim) break;
    const tamanho = l.numero();
    const fim = l.p + tamanho;
    if (tipo === ID.nome) {
      if (l.byte() !== 0) throw new Error('7z: nomes externos não suportados');
      for (const a of arquivos) {
        let nome = '';
        for (;;) {
          const c = l.byte() | (l.byte() << 8);
          if (c === 0) break;
          nome += String.fromCharCode(c);
        }
        a.nome = nome;
      }
    } else if (tipo === ID.streamVazio) {
      l.bits(n).forEach((v, i) => { arquivos[i].vazio = v; });
    }
    l.p = fim;
  }
  return arquivos;
}

/**
 * Abre um 7z e devolve [{nome, dados: Uint8Array}] de todos os arquivos.
 * @param {Uint8Array} arquivo
 */
export function abrir7z(arquivo) {
  const d = arquivo instanceof Uint8Array ? arquivo : new Uint8Array(arquivo);
  if (!ASSINATURA.every((b, i) => d[i] === b)) throw new Error('não é um arquivo 7z');
  const offset = uint64(d, 12);
  const tamanho = uint64(d, 20);
  let cab = d.subarray(32 + offset, 32 + offset + tamanho);
  let l = new Leitor(cab);
  let id = l.numero();
  // Cabeçalho compactado: descreve onde está o cabeçalho de verdade, ele mesmo comprimido.
  let voltas = 0;
  while (id === ID.cabecalhoCodificado) {
    if ((voltas += 1) > 4) throw new Error('7z: cabeçalho compactado aninhado demais');
    const info = lerStreams(l);
    cab = extrairStreams(d, info)[0];
    l = new Leitor(cab);
    id = l.numero();
  }
  if (id !== ID.cabecalho) throw new Error('7z: cabeçalho desconhecido');
  let streams = { pastas: [] };
  let arquivos = [];
  for (;;) {
    const prop = l.numero();
    if (prop === ID.fim) break;
    if (prop === ID.propriedades) {
      for (let t = l.numero(); t !== 0; t = l.numero()) l.p += l.numero();
    } else if (prop === ID.streamsAdicionais) {
      lerStreams(l);
    } else if (prop === ID.streamsPrincipais) {
      streams = lerStreams(l);
    } else if (prop === ID.arquivos) {
      arquivos = lerArquivos(l);
    } else {
      throw new Error(`7z: propriedade 0x${prop.toString(16)} inesperada no cabeçalho`);
    }
  }
  const dados = streams.pastas.length ? extrairStreams(d, streams) : [];
  let i = 0;
  return arquivos.map((a) => ({ nome: a.nome, dados: a.vazio ? new Uint8Array(0) : dados[i++] }));
}
