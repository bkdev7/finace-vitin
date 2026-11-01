'use strict';
/* Vitin7 Finance — guardião de inicialização.
   Se o painel não iniciar (erro de JavaScript, app.js que não carregou ou servidor que não responde),
   mostra o motivo na tela em vez de ficar em "Conectando…" para sempre. Não altera nenhum dado. */
(function () {
  function show(title, detail) {
    if (window.__v7ready) return; // painel já iniciou: erros posteriores não apagam a tela
    var c = document.getElementById('content');
    if (!c) return;
    var conn = document.getElementById('conn');
    if (conn) { conn.className = 'conn err'; var t = conn.querySelector('span:last-child'); if (t) t.textContent = 'Sem conexão'; }
    c.textContent = '';
    var box = document.createElement('div'); box.className = 'hint warn';
    var b = document.createElement('b'); b.textContent = title; box.appendChild(b);
    box.appendChild(document.createElement('br'));
    box.appendChild(document.createTextNode(detail));
    box.appendChild(document.createElement('br')); box.appendChild(document.createElement('br'));
    var reload = document.createElement('button'); reload.type = 'button'; reload.className = 'btn sm'; reload.textContent = 'Recarregar';
    reload.addEventListener('click', function () { location.reload(); });
    box.appendChild(reload);
    box.appendChild(document.createTextNode(' '));
    var h = document.createElement('a'); h.href = '/api/health'; h.target = '_blank'; h.rel = 'noopener'; h.textContent = 'Testar servidor (/api/health)';
    box.appendChild(h);
    c.appendChild(box);
  }
  window.addEventListener('error', function (e) {
    if (e.filename && e.filename.indexOf(location.origin) !== 0) return; // script de terceiros (extensão/proxy): não é do painel
    show('O painel encontrou um erro ao iniciar.', (e.message || 'Erro desconhecido') + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    show('O painel encontrou um erro ao iniciar.', String((e.reason && e.reason.message) || e.reason || 'Erro desconhecido'));
  });
  // Recarga de emergência: se o app.js não executou (cache antigo/arquivo bloqueado), pede de novo com URL única, uma vez só.
  setTimeout(function () {
    if (window.__v7loaded || window.__v7ready) return;
    var sc = document.createElement('script');
    sc.src = '/app.js?r=' + Date.now();
    document.head.appendChild(sc);
  }, 4000);
  setTimeout(function () {
    if (window.__v7ready) return;
    if (!window.__v7loaded) show('O painel não conseguiu iniciar.', 'O arquivo app.js não foi carregado ou foi bloqueado (extensão do navegador, cache antigo ou hospedagem). Tente recarregar com Ctrl+F5 ou abrir em aba anônima.');
    else show('O servidor não respondeu a tempo.', 'A página abriu, mas os dados não chegaram em 12 segundos. Verifique se a aplicação está online e sem erros nos logs.');
  }, 12000);
})();
