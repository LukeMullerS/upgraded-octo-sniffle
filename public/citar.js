// "Como citar": referência do programa nas principais normas (ABNT, APA, MLA, Chicago e
// BibTeX) e das fontes de dados. Aparece pelo botão "Como citar" (qualquer elemento com
// data-citar) e antes de cada exportação (antesDeExportar).
//
// Módulo independente (não importa comum.js): também é usado pela área de trabalho.

export const PROGRAMA = {
  sobrenome: 'Müller-Silveira',
  nome: 'Lucas',
  titulo: 'Voto Lab',
  subtitulo: 'análise das Eleições 2026 com dados públicos',
  versao: '1.0',
  ano: 2026,
};

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MESES_ABNT = ['jan.', 'fev.', 'mar.', 'abr.', 'maio', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];
const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** Endereço do programa: a origem da página (o servidor onde ele está rodando). */
export const enderecoPrograma = () => (typeof location !== 'undefined' && /^https?:/.test(location.origin) ? `${location.origin}/` : 'https://github.com/lukemullers/upgraded-octo-sniffle');

/**
 * Referências do programa. Cada uma tem `html` (com itálico/negrito da norma) e `texto` (para copiar).
 * @param {{url?: string, data?: Date}} o
 */
export function citacoes({ url = enderecoPrograma(), data = new Date() } = {}) {
  const p = PROGRAMA;
  const dia = data.getDate();
  const acessoAbnt = `${dia} ${MESES_ABNT[data.getMonth()]} ${data.getFullYear()}`;
  const iso = data.toISOString().slice(0, 10);
  const tituloCompleto = `${p.titulo}: ${maiuscula(p.subtitulo)}`;
  const lista = [
    {
      id: 'abnt', nome: 'ABNT (NBR 6023:2018)',
      html: `${esc(p.sobrenome.toUpperCase())}, ${esc(p.nome)}. <strong>${esc(p.titulo)}</strong>: ${esc(p.subtitulo)}. Versão ${p.versao}. [<em>S. l.</em>]: [<em>s. n.</em>], ${p.ano}. Aplicativo web. Disponível em: ${esc(url)}. Acesso em: ${acessoAbnt}.`,
      texto: `${p.sobrenome.toUpperCase()}, ${p.nome}. ${p.titulo}: ${p.subtitulo}. Versão ${p.versao}. [S. l.]: [s. n.], ${p.ano}. Aplicativo web. Disponível em: ${url}. Acesso em: ${acessoAbnt}.`,
    },
    {
      id: 'apa', nome: 'APA (7ª edição)',
      html: `${esc(p.sobrenome)}, ${esc(p.nome.charAt(0))}. (${p.ano}). <em>${esc(tituloCompleto)}</em> (Versão ${p.versao}) [Aplicativo web]. ${esc(url)}`,
      texto: `${p.sobrenome}, ${p.nome.charAt(0)}. (${p.ano}). ${tituloCompleto} (Versão ${p.versao}) [Aplicativo web]. ${url}`,
    },
    {
      id: 'mla', nome: 'MLA (9ª edição)',
      html: `${esc(p.sobrenome)}, ${esc(p.nome)}. <em>${esc(tituloCompleto)}</em>. Versão ${p.versao}, ${p.ano}, ${esc(url)}. Acesso em ${acessoAbnt}`,
      texto: `${p.sobrenome}, ${p.nome}. ${tituloCompleto}. Versão ${p.versao}, ${p.ano}, ${url}. Acesso em ${acessoAbnt}`,
    },
    {
      id: 'chicago', nome: 'Chicago (17ª edição, autor-data)',
      html: `${esc(p.sobrenome)}, ${esc(p.nome)}. ${p.ano}. <em>${esc(tituloCompleto)}</em>. Versão ${p.versao}. Aplicativo web. ${esc(url)}.`,
      texto: `${p.sobrenome}, ${p.nome}. ${p.ano}. ${tituloCompleto}. Versão ${p.versao}. Aplicativo web. ${url}.`,
    },
  ];
  const bib = `@software{mullersilveira${p.ano}votolab,
  author  = {${p.sobrenome}, ${p.nome}},
  title   = {${p.titulo}: ${maiuscula(p.subtitulo)}},
  year    = {${p.ano}},
  version = {${p.versao}},
  url     = {${url}},
  urldate = {${iso}},
  note    = {Aplicativo web com dados públicos do TSE, IBGE e IPEA}
}`;
  lista.push({ id: 'bibtex', nome: 'BibTeX (LaTeX, Zotero, Mendeley)', html: `<pre>${esc(bib)}</pre>`, texto: bib });
  return lista;
}

// Fontes dos dados, para citar junto com o programa.
const FONTES = [
  { chave: 'tse2026resultados', autorAbnt: 'BRASIL. Tribunal Superior Eleitoral', autor: 'Tribunal Superior Eleitoral', sigla: 'TSE',
    titulo: 'Resultados', subtitulo: 'Eleições 2026', local: 'Brasília, DF', url: 'https://resultados.tse.jus.br' },
  { chave: 'ibge2026sidra', autorAbnt: 'INSTITUTO BRASILEIRO DE GEOGRAFIA E ESTATÍSTICA (IBGE)', autor: 'Instituto Brasileiro de Geografia e Estatística', sigla: 'IBGE',
    titulo: 'Sistema IBGE de Recuperação Automática – SIDRA', subtitulo: '', local: 'Rio de Janeiro', url: 'https://sidra.ibge.gov.br' },
  { chave: 'ipea2026ipeadata', autorAbnt: 'INSTITUTO DE PESQUISA ECONÔMICA APLICADA (IPEA)', autor: 'Instituto de Pesquisa Econômica Aplicada', sigla: 'Ipea',
    titulo: 'Ipeadata', subtitulo: 'Atlas do Desenvolvimento Humano no Brasil', local: 'Brasília, DF', url: 'http://www.ipeadata.gov.br' },
];
export const FORMATOS = [['abnt', 'ABNT'], ['apa', 'APA'], ['mla', 'MLA'], ['chicago', 'Chicago'], ['bibtex', 'BibTeX']];

/**
 * Referências das fontes de dados no formato escolhido: [{html, texto}].
 * @param {Date} data  data de acesso
 * @param {'abnt'|'apa'|'mla'|'chicago'|'bibtex'} formato
 */
export function fontesDeDados(data = new Date(), formato = 'abnt') {
  const ano = PROGRAMA.ano;
  const acesso = `${data.getDate()} ${MESES_ABNT[data.getMonth()]} ${data.getFullYear()}`;
  return FONTES.map((f) => {
    const tituloAbnt = `<strong>${esc(f.titulo)}</strong>${f.subtitulo ? `: ${esc(f.subtitulo)}` : ''}`;
    const tituloTexto = `${f.titulo}${f.subtitulo ? `: ${f.subtitulo}` : ''}`;
    if (formato === 'apa') {
      return { html: `${esc(f.autor)}. (${ano}). <em>${esc(tituloTexto)}</em> [Base de dados]. ${esc(f.url)}`,
        texto: `${f.autor}. (${ano}). ${tituloTexto} [Base de dados]. ${f.url}` };
    }
    if (formato === 'mla') {
      return { html: `${esc(f.autor)}. <em>${esc(tituloTexto)}</em>. ${esc(f.sigla)}, ${ano}, ${esc(f.url.replace(/^https?:\/\//, ''))}. Acesso em ${acesso}.`,
        texto: `${f.autor}. ${tituloTexto}. ${f.sigla}, ${ano}, ${f.url.replace(/^https?:\/\//, '')}. Acesso em ${acesso}.` };
    }
    if (formato === 'chicago') {
      return { html: `${esc(f.autor)}. ${ano}. <em>${esc(tituloTexto)}</em>. ${esc(f.local)}: ${esc(f.sigla)}. ${esc(f.url)}.`,
        texto: `${f.autor}. ${ano}. ${tituloTexto}. ${f.local}: ${f.sigla}. ${f.url}.` };
    }
    if (formato === 'bibtex') {
      const bib = `@misc{${f.chave},\n  author  = {{${f.autor}}},\n  title   = {${tituloTexto}},\n  year    = {${ano}},\n  url     = {${f.url}},\n  urldate = {${data.toISOString().slice(0, 10)}}\n}`;
      return { html: `<pre>${esc(bib)}</pre>`, texto: bib };
    }
    return { html: `${esc(f.autorAbnt)}. ${tituloAbnt}. ${esc(f.local)}: ${esc(f.sigla)}, ${ano}. Disponível em: ${esc(f.url)}. Acesso em: ${acesso}.`,
      texto: `${f.autorAbnt}. ${tituloTexto}. ${f.local}: ${f.sigla}, ${ano}. Disponível em: ${f.url}. Acesso em: ${acesso}.` };
  });
}

/** Uma linha curta de crédito para imagens e relatórios exportados. */
export const creditoCurto = () => `${PROGRAMA.titulo} · ${PROGRAMA.nome} ${PROGRAMA.sobrenome} (${PROGRAMA.ano}) · Dados: TSE, IBGE, IPEA · ${enderecoPrograma()}`;

// ---------- janela ----------

const CSS = `
.citar-dialogo { max-width: min(720px, calc(100vw - 32px)); width: 100%; padding: 0; border: 1px solid #c9d1db; border-radius: 12px;
  background: #fff; color: #1b2430; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 18px 50px rgba(0,0,0,.25); }
.citar-dialogo::backdrop { background: rgba(10, 20, 30, .45); }
.citar-topo { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #e3e8ee; }
.citar-topo h2 { margin: 0; font-size: 1.05rem; }
.citar-fechar { border: 0; background: none; font-size: 1.4rem; line-height: 1; cursor: pointer; color: inherit; padding: 4px 8px; }
.citar-corpo { padding: 12px 16px 16px; max-height: min(70vh, 640px); overflow: auto; display: grid; gap: 12px; }
.citar-aviso { margin: 0; padding: 10px 12px; background: #eef5ff; border-left: 3px solid #0b5cad; border-radius: 0 8px 8px 0; }
.citar-item { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid #e3e8ee; border-radius: 8px; }
.citar-item header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.citar-item h3 { margin: 0; font-size: .85rem; text-transform: uppercase; letter-spacing: .03em; color: #4a5a6e; }
.citar-item p, .citar-item pre { margin: 0; overflow-wrap: anywhere; }
.citar-item pre { white-space: pre-wrap; font: 12.5px/1.4 ui-monospace, Consolas, monospace; background: #f6f8fa; padding: 8px; border-radius: 6px; }
.citar-copiar, .citar-acoes button { border: 1px solid #0b5cad; background: #fff; color: #0b5cad; border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; font-size: .85rem; }
.citar-acoes { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid #e3e8ee; }
.citar-acoes .citar-continuar { background: #0b5cad; color: #fff; }
.citar-acoes label { font-size: .85rem; display: flex; gap: 6px; align-items: center; }
.citar-fontes header > span { display: inline-flex; gap: 6px; align-items: center; }
.citar-fontes select { font: inherit; font-size: .85rem; padding: 2px 4px; }
.citar-fontes p { margin: 6px 0 0; font-size: .9rem; overflow-wrap: anywhere; }
@media (prefers-color-scheme: dark) {
  :root:not([data-tema="98"]) .citar-dialogo { background: #161d26; color: #e6edf3; border-color: #2a3542; }
  :root:not([data-tema="98"]) .citar-topo, :root:not([data-tema="98"]) .citar-acoes, :root:not([data-tema="98"]) .citar-item { border-color: #2a3542; }
  :root:not([data-tema="98"]) .citar-item h3 { color: #9fb0c3; }
  :root:not([data-tema="98"]) .citar-item pre { background: #0f141b; }
  :root:not([data-tema="98"]) .citar-aviso { background: #12243a; border-color: #4c9be8; }
  :root:not([data-tema="98"]) .citar-copiar, :root:not([data-tema="98"]) .citar-acoes button { background: transparent; color: #4c9be8; border-color: #4c9be8; }
  :root:not([data-tema="98"]) .citar-acoes .citar-continuar { background: #4c9be8; color: #0b1118; }
}
[data-tema="98"] .citar-dialogo { border-radius: 0; border: 0; background: #c0c0c0; color: #000; font: 12px "Tahoma", "MS Sans Serif", sans-serif;
  box-shadow: inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff; padding: 3px; }
[data-tema="98"] .citar-topo { background: linear-gradient(90deg, #000080, #1084d0); color: #fff; padding: 3px 4px 3px 6px; border: 0; }
[data-tema="98"] .citar-topo h2 { font-size: 12px; font-weight: bold; }
[data-tema="98"] .citar-fechar { background: #c0c0c0; color: #000; width: 18px; height: 16px; font-size: 12px; padding: 0; box-shadow: inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px #808080; }
[data-tema="98"] .citar-corpo { padding: 8px; }
[data-tema="98"] .citar-item { border-radius: 0; border: 0; background: #fff; box-shadow: inset 1px 1px #808080, inset -1px -1px #fff; }
[data-tema="98"] .citar-item h3 { color: #000080; font-size: 11px; }
[data-tema="98"] .citar-aviso { background: #ffffe1; border: 1px solid #000; border-radius: 0; }
[data-tema="98"] .citar-copiar, [data-tema="98"] .citar-acoes button, [data-tema="98"] .citar-acoes .citar-continuar { border: 0; border-radius: 0; background: #c0c0c0; color: #000; padding: 4px 12px; min-height: 23px;
  box-shadow: inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px #808080, inset 2px 2px #dfdfdf; font: inherit; }
[data-tema="98"] .citar-acoes { border-top: 0; padding: 6px 8px; }
`;

function garantirEstilo() {
  if (document.getElementById('citar-estilo')) return;
  const st = document.createElement('style');
  st.id = 'citar-estilo';
  st.textContent = CSS;
  document.head.append(st);
}

const CHAVE_LEMBRETE = 'votolab:citar-ate';
const CHAVE_FORMATO = 'votolab:citar-formato';
const lembreteAtivo = () => {
  try { return (localStorage.getItem(CHAVE_LEMBRETE) ?? '') !== new Date().toISOString().slice(0, 10); } catch { return true; }
};

async function copiar(texto, botao) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: texto });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const antes = botao.textContent;
  botao.textContent = 'Copiado ✓';
  setTimeout(() => { botao.textContent = antes; }, 1500);
}

/**
 * Abre a janela "Como citar".
 * @param {{aoContinuar?: () => void, rotuloContinuar?: string}} o  com aoContinuar, a janela
 *   aparece antes de uma exportação e tem o botão para seguir com ela.
 */
export function abrirCitacao({ aoContinuar = null, rotuloContinuar = 'Continuar exportação' } = {}) {
  garantirEstilo();
  document.querySelector('.citar-dialogo')?.remove();
  const refs = citacoes();
  const dlg = document.createElement('dialog');
  dlg.className = 'citar-dialogo';
  dlg.setAttribute('aria-labelledby', 'citar-titulo');
  dlg.innerHTML = `<div class="citar-topo"><h2 id="citar-titulo">Como citar o ${esc(PROGRAMA.titulo)}</h2><button type="button" class="citar-fechar" data-fechar aria-label="Fechar">×</button></div>
    <div class="citar-corpo">
      <p class="citar-aviso">${aoContinuar ? 'Vai usar esta análise num trabalho, reportagem ou publicação? ' : ''}Cite o <strong>${esc(PROGRAMA.titulo)}</strong>, de <strong>${esc(PROGRAMA.nome)} ${esc(PROGRAMA.sobrenome)}</strong>, e as fontes dos dados. Escolha a norma e copie.</p>
      ${refs.map((r) => `<section class="citar-item"><header><h3>${esc(r.nome)}</h3><button type="button" class="citar-copiar" data-copiar="${r.id}">Copiar</button></header>${r.id === 'bibtex' ? r.html : `<p>${r.html}</p>`}</section>`).join('')}
      <section class="citar-item citar-fontes"><header><h3>Fontes dos dados</h3>
        <span><select data-formato-fontes aria-label="Formato das referências das fontes">${FORMATOS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
        <button type="button" class="citar-copiar" data-copiar-fontes>Copiar</button></span></header>
        <div data-lista-fontes></div></section>
    </div>
    <div class="citar-acoes">
      ${aoContinuar ? '<label><input type="checkbox" data-nao-lembrar> não mostrar de novo hoje</label>' : '<span></span>'}
      <span>${aoContinuar ? `<button type="button" data-fechar>Cancelar</button> <button type="button" class="citar-continuar" data-continuar>${esc(rotuloContinuar)}</button>` : '<button type="button" class="citar-continuar" data-fechar>Fechar</button>'}</span>
    </div>`;
  document.body.append(dlg);
  // Fontes no formato escolhido, atualizado na hora (lembra a última escolha).
  const seletor = dlg.querySelector('[data-formato-fontes]');
  try { seletor.value = localStorage.getItem(CHAVE_FORMATO) || 'abnt'; } catch { /* sem armazenamento */ }
  const pintarFontes = () => {
    const f = fontesDeDados(new Date(), seletor.value);
    dlg.querySelector('[data-lista-fontes]').innerHTML = f.map((x) => (seletor.value === 'bibtex' ? x.html : `<p>${x.html}</p>`)).join('');
    try { localStorage.setItem(CHAVE_FORMATO, seletor.value); } catch { /* sem armazenamento */ }
  };
  seletor.addEventListener('change', pintarFontes);
  pintarFontes();
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) { dlg.close(); return; } // clique fora
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.copiar) copiar(refs.find((r) => r.id === b.dataset.copiar).texto, b);
    else if ('copiarFontes' in b.dataset) copiar(fontesDeDados(new Date(), seletor.value).map((x) => x.texto).join('\n\n'), b);
    else if ('fechar' in b.dataset) dlg.close();
    else if ('continuar' in b.dataset) {
      if (dlg.querySelector('[data-nao-lembrar]')?.checked) {
        try { localStorage.setItem(CHAVE_LEMBRETE, new Date().toISOString().slice(0, 10)); } catch { /* sem armazenamento */ }
      }
      dlg.close();
      aoContinuar?.();
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}

/** Antes de exportar: mostra a janela de citação (a menos que a pessoa tenha pedido para não lembrar hoje). */
export function antesDeExportar(exportar) {
  if (typeof document === 'undefined' || !lembreteAtivo()) { exportar(); return; }
  abrirCitacao({ aoContinuar: exportar });
}

// Qualquer elemento com data-citar abre a janela.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    if (ev.target.closest?.('[data-citar]')) { ev.preventDefault(); abrirCitacao(); }
  });
}
