// Campo minado 9×9, no visual do Windows 98.

const LADO = 9;
const MINAS = 10;
const CORES = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];
const CHAVE_RECORDE = 'votolab:campo-recorde';

const CSS = `
.campo { display: flex; flex-direction: column; align-items: center; padding: 6px; gap: 6px; user-select: none; -webkit-user-select: none; }
.campo-painel { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 4px 5px; box-sizing: border-box;
  box-shadow: inset 1px 1px #808080, inset -1px -1px #fff; }
.campo-led { background: #000; color: #f00; font: bold 22px/1 "Courier New", monospace; padding: 1px 3px; min-width: 42px; text-align: right;
  box-shadow: inset 1px 1px #808080, inset -1px -1px #fff; letter-spacing: 1px; }
.campo-rosto { width: 30px; height: 30px; font-size: 18px; line-height: 1; padding: 0; background: #c0c0c0; border: 0; cursor: pointer;
  box-shadow: inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px #808080, inset 2px 2px #dfdfdf; }
.campo-rosto:active { box-shadow: inset 1px 1px #808080; }
.campo-grade { display: grid; grid-template-columns: repeat(${LADO}, 26px); box-shadow: inset 2px 2px #808080, inset -2px -2px #fff; padding: 3px; touch-action: manipulation; }
.campo-casa { width: 26px; height: 26px; border: 0; padding: 0; font: bold 15px/26px "Tahoma", sans-serif; text-align: center; background: #c0c0c0;
  box-shadow: inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px #808080, inset 2px 2px #dfdfdf; cursor: default; }
.campo-casa.aberta { box-shadow: inset 1px 1px #808080; background: #c0c0c0; }
.campo-casa.explodiu { background: #f00; }
.campo-recorde { font-size: 11px; color: #000; }
`;

export function iniciarCampo(raiz) {
  if (!document.getElementById('campo-estilo')) {
    const st = document.createElement('style');
    st.id = 'campo-estilo';
    st.textContent = CSS;
    document.head.append(st);
  }
  raiz.innerHTML = `<div class="campo">
    <div class="campo-painel"><span class="campo-led" data-minas>010</span><button type="button" class="campo-rosto" data-rosto aria-label="Novo jogo">🙂</button><span class="campo-led" data-tempo>000</span></div>
    <div class="campo-grade" role="grid"></div>
    <span class="campo-recorde" data-recorde></span>
  </div>`;
  const grade = raiz.querySelector('.campo-grade');
  const rosto = raiz.querySelector('[data-rosto]');
  const ledMinas = raiz.querySelector('[data-minas]');
  const ledTempo = raiz.querySelector('[data-tempo]');
  const recorde = raiz.querySelector('[data-recorde]');
  const led = (n) => String(Math.max(-99, Math.min(999, n))).padStart(3, '0');
  let casas;
  let comecou;
  let fim;
  let relogio = null;
  let inicio = 0;

  const lerRecorde = () => { try { return Number(localStorage.getItem(CHAVE_RECORDE)) || null; } catch { return null; } };
  const mostrarRecorde = () => {
    const r = lerRecorde();
    recorde.textContent = r ? `Melhor tempo: ${r} s` : '';
  };

  function novo() {
    clearInterval(relogio);
    casas = Array.from({ length: LADO * LADO }, () => ({ mina: false, aberta: false, bandeira: false, vizinhas: 0 }));
    comecou = false;
    fim = false;
    rosto.textContent = '🙂';
    ledTempo.textContent = '000';
    grade.innerHTML = casas.map((_, i) => `<button type="button" class="campo-casa" data-i="${i}" aria-label="casa"></button>`).join('');
    atualizarContador();
    mostrarRecorde();
  }

  const vizinhos = (i) => {
    const l = Math.floor(i / LADO);
    const c = i % LADO;
    const out = [];
    for (let dl = -1; dl <= 1; dl += 1) for (let dc = -1; dc <= 1; dc += 1) {
      if (!dl && !dc) continue;
      const nl = l + dl;
      const nc = c + dc;
      if (nl >= 0 && nl < LADO && nc >= 0 && nc < LADO) out.push(nl * LADO + nc);
    }
    return out;
  };

  // A primeira casa (e as vizinhas) nunca têm mina.
  function semear(primeira) {
    const proibidas = new Set([primeira, ...vizinhos(primeira)]);
    let postas = 0;
    while (postas < MINAS) {
      const i = Math.floor(Math.random() * casas.length);
      if (casas[i].mina || proibidas.has(i)) continue;
      casas[i].mina = true;
      postas += 1;
    }
    casas.forEach((k, i) => { k.vizinhas = vizinhos(i).filter((v) => casas[v].mina).length; });
    comecou = true;
    inicio = Date.now();
    relogio = setInterval(() => { ledTempo.textContent = led(Math.floor((Date.now() - inicio) / 1000)); }, 250);
  }

  function pintar(i) {
    const k = casas[i];
    const b = grade.children[i];
    b.classList.toggle('aberta', k.aberta);
    if (k.aberta) {
      b.textContent = k.mina ? '💣' : k.vizinhas || '';
      b.style.color = CORES[k.vizinhas] ?? '';
    } else {
      b.textContent = k.bandeira ? '🚩' : '';
    }
  }

  function atualizarContador() {
    ledMinas.textContent = led(MINAS - casas.filter((k) => k.bandeira).length);
  }

  function abrir(i) {
    const pilha = [i];
    while (pilha.length) {
      const j = pilha.pop();
      const k = casas[j];
      if (k.aberta || k.bandeira) continue;
      k.aberta = true;
      pintar(j);
      if (!k.mina && !k.vizinhas) pilha.push(...vizinhos(j));
    }
  }

  function terminar(venceu, explodiu = null) {
    fim = true;
    clearInterval(relogio);
    rosto.textContent = venceu ? '😎' : '😵';
    casas.forEach((k, i) => {
      if (venceu && k.mina) { k.bandeira = true; pintar(i); }
      if (!venceu && k.mina && !k.bandeira) { k.aberta = true; pintar(i); }
    });
    if (explodiu !== null) grade.children[explodiu].classList.add('explodiu');
    if (venceu) {
      const t = Math.max(1, Math.round((Date.now() - inicio) / 1000));
      const r = lerRecorde();
      if (!r || t < r) { try { localStorage.setItem(CHAVE_RECORDE, String(t)); } catch { /* sem armazenamento */ } }
      recorde.textContent = `Apuração concluída em ${t} s!${!r || t < r ? ' Novo recorde.' : ` Recorde: ${r} s.`}`;
      atualizarContador();
    }
  }

  function clicar(i) {
    if (fim || casas[i].bandeira) return;
    if (!comecou) semear(i);
    if (casas[i].mina) {
      casas[i].aberta = true;
      pintar(i);
      terminar(false, i);
      return;
    }
    abrir(i);
    if (casas.every((k) => k.mina || k.aberta)) terminar(true);
  }

  function marcar(i) {
    if (fim || casas[i].aberta) return;
    casas[i].bandeira = !casas[i].bandeira;
    pintar(i);
    atualizarContador();
  }

  // Clique abre; botão direito (ou toque longo) põe bandeira.
  let toque = null;
  grade.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('[data-i]');
    if (!b || fim) return;
    if (ev.button === 0) rosto.textContent = '😮';
    if (ev.pointerType !== 'mouse') {
      toque = { i: Number(b.dataset.i), longo: false, timer: setTimeout(() => { toque.longo = true; marcar(toque.i); navigator.vibrate?.(30); }, 450) };
    }
  });
  grade.addEventListener('pointerup', (ev) => {
    if (!fim) rosto.textContent = '🙂';
    const b = ev.target.closest('[data-i]');
    if (toque) {
      clearTimeout(toque.timer);
      const t = toque;
      toque = null;
      if (!t.longo && b && Number(b.dataset.i) === t.i) clicar(t.i);
      return;
    }
    if (b && ev.button === 0) clicar(Number(b.dataset.i));
  });
  grade.addEventListener('pointercancel', () => { if (toque) clearTimeout(toque.timer); toque = null; });
  grade.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const b = ev.target.closest('[data-i]');
    if (b) marcar(Number(b.dataset.i));
  });
  rosto.addEventListener('click', novo);
  novo();
  return { parar: () => clearInterval(relogio) };
}
