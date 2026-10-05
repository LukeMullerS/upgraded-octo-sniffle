// Acrescenta a versão dos arquivos (?v=…) aos endereços de scripts e estilos servidos pelo
// app, para que o navegador nunca misture um arquivo novo com outro antigo do cache.

/** Acrescenta ?v=versão aos imports relativos (.js) e aos src/href de scripts e estilos. */
export function versionar(texto, tipo, v) {
  if (tipo === '.js') {
    return texto.replace(/(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\/[^'"?]+\.js)\2/g, `$1$2$3?v=${v}$2`);
  }
  if (tipo === '.html') {
    return texto.replace(/(\b(?:src|href)=")((?![a-z]+:|\/\/|#)[^"?#]+\.(?:js|css))"/g, `$1$2?v=${v}"`);
  }
  return texto;
}
