// Tema do app. Script clássico (não módulo) carregado no <head> de cada página.
//
// * Visual "98" (padrão): a página aberta diretamente vai para a área de trabalho
//   (desktop.html), que a abre dentro de uma janela. Dentro da janela (iframe ou
//   ?embed=1) a página usa o visual 98 sem cabeçalho nem abas próprias.
// * Visual "moderno": a página aparece como sempre, com um botão para voltar ao 98.
(function tema() {
  var CHAVE = 'apuracao2026:tema';
  var tema = '98';
  try { tema = localStorage.getItem(CHAVE) || '98'; } catch (e) { /* sem armazenamento */ }
  var params = new URLSearchParams(location.search);
  var embutida = params.has('embed') || window.self !== window.top;
  var raiz = document.documentElement;

  if (embutida) {
    raiz.dataset.tema = '98';
    raiz.dataset.embed = '1';
    if (params.get('modulo')) raiz.dataset.modulo = params.get('modulo');
    // Avisa a área de trabalho para trazer esta janela para a frente ao clicar nela.
    addEventListener('pointerdown', function () {
      try { parent.postMessage({ tipo: 'foco' }, location.origin); } catch (e) { /* sem área de trabalho */ }
    }, true);
    return;
  }

  raiz.dataset.tema = tema;
  if (tema === '98') {
    var arquivo = location.pathname.split('/').pop();
    var app = { '': 'apuracao', 'index.html': 'apuracao', 'brancos.html': 'brancos', 'explorar.html': 'explorar' }[arquivo];
    if (app) {
      var destino = 'desktop.html#abrir=' + app + (location.hash ? '&h=' + encodeURIComponent(location.hash) : '');
      location.replace(destino);
    }
    return;
  }

  // Visual moderno: botão discreto para voltar ao Windows 98.
  var montar = function () {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'voltar98';
    b.textContent = 'Visual Windows 98';
    b.addEventListener('click', function () {
      try { localStorage.setItem(CHAVE, '98'); } catch (e) { /* ignora */ }
      location.reload();
    });
    document.body.appendChild(b);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
}());
