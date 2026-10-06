// Leitor de ZIP mínimo (sem dependências): em 2026 o TSE passou a publicar o log da urna
// (.jez/.logjez) como ZIP com o logd.dat comprimido por deflate; até 2024 era 7z.
// Lê o diretório central e extrai cada arquivo (armazenado ou deflate) com o zlib do Node.

import { inflateRawSync } from 'node:zlib';

const ASSINATURA_FIM = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

/** Bytes começam como ZIP ("PK\x03\x04")? */
export const ehZip = (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** [{ nome, dados: Uint8Array }] de um ZIP. */
export function abrirZip(entrada) {
  const b = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Fim do diretório central: procura de trás para frente (pode haver comentário depois).
  let fim = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i -= 1) {
    if (v.getUint32(i, true) === ASSINATURA_FIM) { fim = i; break; }
  }
  if (fim < 0) throw new Error('ZIP sem diretório central');
  const quantos = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const arquivos = [];
  for (let k = 0; k < quantos; k += 1) {
    if (v.getUint32(p, true) !== ASSINATURA_CENTRAL) throw new Error('ZIP com diretório central inválido');
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const tamNome = v.getUint16(p + 28, true);
    const tamExtra = v.getUint16(p + 30, true);
    const tamComentario = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = new TextDecoder('latin1').decode(b.subarray(p + 46, p + 46 + tamNome));
    p += 46 + tamNome + tamExtra + tamComentario;
    if (v.getUint32(local, true) !== ASSINATURA_LOCAL) throw new Error('ZIP com cabeçalho local inválido');
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const bruto = b.subarray(inicio, inicio + comprimido);
    if (nome.endsWith('/')) continue;
    if (metodo === 0) arquivos.push({ nome, dados: bruto });
    else if (metodo === 8) arquivos.push({ nome, dados: new Uint8Array(inflateRawSync(bruto)) });
    else throw new Error(`ZIP com método de compressão ${metodo} não suportado`);
  }
  return arquivos;
}
