// Tutorial da área de trabalho: na primeira visita, uma sequência de balões apontando para as
// partes da tela (janela, botões do título, menu da janela, ícones, Iniciar, barra de tarefas),
// com "Pular tutorial", "Voltar" e "Próximo". Pode ser revisto pelo menu Iniciar → Tutorial.

const CHAVE = 'apuracao2026:tutorial';

/** Já viu (ou pulou) o tutorial neste navegador? */
export function tutorialVisto() {
  try { return localStorage.getItem(CHAVE) === '1'; } catch { return true; }
}

function marcarVisto() {
  try { localStorage.setItem(CHAVE, '1'); } catch { /* vale só nesta visita */ }
}

/**
 * passos: [{ titulo, texto, alvo?: () => Element|null, elevar?: () => Element|null }]
 * alvo: o que fica recortado em destaque (elemento ou retângulo) (sem alvo, o balão aparece no meio da tela).
 * classe: classe posta no <body> enquanto o passo está na tela (ex.: esconder as janelas).
 */
export function iniciarTutorial(passos) {
  document.querySelector('.tutorial')?.remove();
  const raiz = document.createElement('div');
  raiz.className = 'tutorial';
  raiz.innerHTML = `
    <div class="tutorial-bloqueio"></div>
    <div class="tutorial-foco" hidden></div>
    <section class="tutorial-balao janela ativa" role="dialog" aria-modal="true" aria-labelledby="tutorial-titulo">
      <header class="titulo"><span class="titulo-texto" id="tutorial-titulo"></span>
        <span class="titulo-botoes"><button type="button" class="tb tb-fechar" data-t="pular" aria-label="Fechar tutorial"><i class="i-fechar"></i></button></span>
      </header>
      <div class="tutorial-corpo"><p class="tutorial-texto"></p></div>
      <footer class="tutorial-botoes">
        <span class="tutorial-passo"></span>
        <button type="button" class="item-botao" data-t="pular">Pular tutorial</button>
        <button type="button" class="item-botao" data-t="voltar">&lt; Voltar</button>
        <button type="button" class="item-botao" data-t="proximo">Próximo &gt;</button>
      </footer>
    </section>`;
  document.body.append(raiz);
  const foco = raiz.querySelector('.tutorial-foco');
  const balao = raiz.querySelector('.tutorial-balao');
  let i = 0;
  let classe = null;

  function soltar() {
    if (classe) document.body.classList.remove(classe);
    classe = null;
  }

  function posicionar() {
    const p = passos[i];
    const alvo = p.alvo?.();
    // O alvo pode ser um elemento ou já um retângulo ({ left, top, right, bottom, width, height }).
    const r = alvo?.getBoundingClientRect ? alvo.getBoundingClientRect() : alvo;
    const larg = innerWidth;
    const alt = innerHeight;
    balao.style.width = `${Math.min(340, larg - 16)}px`;
    const bw = balao.offsetWidth;
    const bh = balao.offsetHeight;
    if (!r || !r.width) {
      foco.hidden = true;
      balao.style.left = `${(larg - bw) / 2}px`;
      balao.style.top = `${Math.max(8, (alt - bh) / 2)}px`;
      return;
    }
    // Recorte com folga em volta do alvo, preso à tela.
    const f = 4;
    const x = Math.max(2, r.left - f);
    const y = Math.max(2, r.top - f);
    const w = Math.min(larg - 2, r.right + f) - x;
    const h = Math.min(alt - 2, r.bottom + f) - y;
    Object.assign(foco.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    foco.hidden = false;
    // Balão abaixo do alvo se couber; senão acima; senão (alvo grande) dentro dele, embaixo.
    let top;
    if (y + h + 10 + bh <= alt - 4) top = y + h + 10;
    else if (y - 10 - bh >= 4) top = y - 10 - bh;
    else top = Math.max(4, Math.min(alt - bh - 4, y + h - bh - 12));
    const left = Math.max(8, Math.min(larg - bw - 8, x + w / 2 - bw / 2));
    balao.style.left = `${left}px`;
    balao.style.top = `${top}px`;
  }

  function mostrar(n) {
    soltar();
    i = n;
    const p = passos[i];
    classe = p.classe ?? null;
    if (classe) document.body.classList.add(classe);
    raiz.querySelector('#tutorial-titulo').textContent = p.titulo;
    raiz.querySelector('.tutorial-texto').innerHTML = p.texto;
    raiz.querySelector('.tutorial-passo').textContent = `${i + 1} de ${passos.length}`;
    raiz.querySelector('[data-t="voltar"]').hidden = i === 0;
    const ultimo = i === passos.length - 1;
    raiz.querySelector('[data-t="pular"].item-botao').hidden = ultimo;
    raiz.querySelector('[data-t="proximo"]').innerHTML = ultimo ? 'Concluir' : i === 0 ? 'Começar &gt;' : 'Próximo &gt;';
    posicionar();
    raiz.querySelector('[data-t="proximo"]').focus({ preventScroll: true });
  }

  function encerrar() {
    soltar();
    marcarVisto();
    raiz.remove();
    removeEventListener('resize', posicionar);
    document.removeEventListener('keydown', teclas, true);
  }

  function teclas(ev) {
    if (ev.key === 'Escape') { ev.stopPropagation(); encerrar(); }
    else if (ev.key === 'ArrowRight') { ev.stopPropagation(); if (i < passos.length - 1) mostrar(i + 1); }
    else if (ev.key === 'ArrowLeft') { ev.stopPropagation(); if (i > 0) mostrar(i - 1); }
  }

  raiz.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-t]')?.dataset.t;
    if (t === 'pular') encerrar();
    else if (t === 'voltar' && i > 0) mostrar(i - 1);
    else if (t === 'proximo') { if (i < passos.length - 1) mostrar(i + 1); else encerrar(); }
  });
  addEventListener('resize', posicionar);
  document.addEventListener('keydown', teclas, true);
  mostrar(0);
}
