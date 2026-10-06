// Tema do app. Script clássico (não módulo) carregado no <head> de cada página.
//
// * Visual "98" (padrão): a página aberta diretamente vai para a área de trabalho
//   (desktop.html), que a abre dentro de uma janela. Dentro da janela (iframe ou
//   ?embed=1) a página usa o visual 98 sem cabeçalho nem abas próprias.
// * Visual "moderno": a página aparece como sempre, com um botão para voltar ao 98.
// Erros de carregamento ficam visíveis: caixa de aviso na página e linha no terminal do
// servidor. Também avisa se a página não iniciar (ex.: um script que não carregou).
(function relatarErros() {
  var pagina = location.pathname.split('/').pop() || 'index.html';
  var caixa = null;
  function relatar(tipo, msg, origem) {
    try {
      var q = 'pagina=' + encodeURIComponent(pagina) + '&tipo=' + encodeURIComponent(tipo)
        + '&msg=' + encodeURIComponent(String(msg).slice(0, 500)) + '&origem=' + encodeURIComponent(origem || '');
      fetch('api/erro?' + q, { cache: 'no-store' }).catch(function () {});
    } catch (e) { /* sem servidor */ }
  }
  function mostrar(msg) {
    var corpo = document.body;
    if (!corpo) { addEventListener('DOMContentLoaded', function () { mostrar(msg); }); return; }
    if (!caixa) {
      caixa = document.createElement('div');
      caixa.setAttribute('role', 'alertdialog');
      caixa.style.cssText = 'position:fixed;z-index:99999;left:50%;top:40px;transform:translateX(-50%);width:min(440px,92vw);'
        + 'background:#c0c0c0;color:#000;font:12px Tahoma,sans-serif;padding:3px;'
        + 'box-shadow:inset -1px -1px #0a0a0a,inset 1px 1px #dfdfdf,inset -2px -2px #808080,inset 2px 2px #fff,4px 4px 0 rgba(0,0,0,.3)';
      caixa.innerHTML = '<div style="background:linear-gradient(90deg,#000080,#1084d0);color:#fff;font-weight:bold;padding:3px 5px">Erro ao abrir ' + pagina + '</div>'
        + '<div style="display:flex;gap:10px;padding:10px"><div style="font-size:28px;line-height:1">⛔</div><div>'
        + '<p style="margin:0 0 6px" data-msg></p><p style="margin:0 0 6px">Tente recarregar com <b>Ctrl+F5</b>. Se continuar, copie a mensagem do terminal onde o <code>npm start</code> está rodando.</p></div></div>'
        + '<div style="text-align:right;padding:0 8px 8px"><button type="button" style="min-width:75px;font:inherit;padding:3px 10px">OK</button></div>';
      caixa.querySelector('button').addEventListener('click', function () { caixa.remove(); caixa = null; });
      corpo.appendChild(caixa);
    }
    var p = caixa.querySelector('[data-msg]');
    p.textContent = (p.textContent ? p.textContent + ' · ' : '') + msg;
  }
  // Um módulo que falha acusa só o script principal. Baixa um a um o principal e o que ele
  // importa, para dizer exatamente qual arquivo falhou e por quê.
  function sondar(url) {
    var vistos = {};
    var achou = false;
    function nome(u) { return u.split('/').pop().split('?')[0]; }
    function visitar(u) {
      if (vistos[u]) return Promise.resolve();
      vistos[u] = true;
      return fetch(u, { cache: 'no-store' }).then(function (r) {
        var tipo = r.headers.get('content-type') || '';
        if (!r.ok || !/javascript/.test(tipo)) {
          achou = true;
          var m = nome(u) + ': o servidor respondeu HTTP ' + r.status + (tipo ? ' (' + tipo + ')' : '');
          relatar('arquivo', m);
          mostrar(m);
          return null;
        }
        return r.text().then(function (texto) {
          var re = /(?:from\s*|import\s*\(\s*)['"](\.\/[^'"]+)['"]/g;
          var filhos = [];
          var m;
          while ((m = re.exec(texto))) filhos.push(visitar(new URL(m[1], u).href));
          return Promise.all(filhos);
        });
      }, function () {
        achou = true;
        var m = nome(u) + ' foi bloqueado pelo navegador (provavelmente um bloqueador de anúncios ou outra extensão). Libere 127.0.0.1 no bloqueador.';
        relatar('bloqueado', m);
        mostrar(m);
      });
    }
    visitar(url).then(function () {
      if (!achou) relatar('arquivo', 'todos os scripts baixaram normalmente na sondagem de ' + nome(url));
    });
  }

  addEventListener('error', function (ev) {
    var alvo = ev.target;
    if (alvo && alvo !== window && alvo.tagName) {
      if (alvo.tagName === 'IMG') return; // foto de candidato que não existe: normal
      var msg = 'não foi possível carregar ' + (alvo.src || alvo.href || alvo.tagName);
      relatar('arquivo', msg);
      mostrar(msg);
      if (alvo.tagName === 'SCRIPT' && alvo.src) sondar(alvo.src);
      return;
    }
    relatar('erro', ev.message, (ev.filename || '').split('/').pop() + ':' + (ev.lineno || ''));
    mostrar(ev.message || 'erro no script');
  }, true);
  addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    relatar('promessa', (r && (r.stack || r.message)) || String(r));
  });
  addEventListener('load', function () {
    setTimeout(function () {
      var st = document.getElementById('status');
      if (st && /^carregando/.test(st.textContent.trim())) {
        relatar('travada', 'a página não iniciou em 15 s (status ainda "carregando")');
        mostrar('A página não terminou de iniciar.');
      }
    }, 15000);
  });
}());

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
    var app = { '': 'apuracao', 'index.html': 'apuracao', 'brancos.html': 'brancos', 'explorar.html': 'explorar', 'urnas.html': 'logs', 'candidatos.html': 'candidatos', 'municipio.html': 'municipio' }[arquivo];
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

// Vercel Web Analytics e Speed Insights (sem cookies), só quando o app roda no Vercel. Os
// scripts vêm do próprio domínio (/_vercel/…), então a política de segurança os aceita; a
// fila é criada aqui (e não num <script> inline, que a política bloqueia).
(function () {
  if (!/\.vercel\.app$/.test(location.hostname) && !document.querySelector('meta[name="vercel-insights"]')) return;
  if (window.__votolabInsights || /[?&]embed=1/.test(location.search)) return; // janelas da área de trabalho não contam de novo
  window.__votolabInsights = true;
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
  ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'].forEach(function (src) {
    var s = document.createElement('script');
    s.defer = true;
    s.src = src;
    document.head.appendChild(s);
  });
}());
