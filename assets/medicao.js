/* Pixel da Meta: so depois de um "aceito" explicito em window.consentimento.
   Carregar o fbevents.js ja grava cookie, entao nao ha "carregar para deixar pronto".
   Sem ID do pixel, nada carrega. */
(function () {
  'use strict';

  var PIXEL = '1822901875395995';   // conjunto de dados "Clube Importacao - site", portfolio Avorex

  if (!PIXEL || !window.consentimento) return;

  var carregado = false;

  // Fila oficial da Meta: guarda as chamadas ate o fbevents.js chegar
  function prepararFila() {
    if (window.fbq) return;
    var fbq = window.fbq = function () {
      if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
      else fbq.queue.push(arguments);
    };
    window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
  }

  function carregar() {
    if (carregado) return;
    carregado = true;
    prepararFila();
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
    window.fbq('init', PIXEL);
    window.fbq('track', 'PageView');
  }

  window.consentimento.quandoAceito(carregar);

  // Revogar para o envio, e aceitar de novo volta a liberar, sem recarregar a pagina
  var revogado = false;
  window.consentimento.assinar(function (estado) {
    if (!carregado || (estado === 'aceito') !== revogado) return;
    revogado = !revogado;
    window.fbq('consent', revogado ? 'revoke' : 'grant');
  });

  // O botao abre o checkout em outra aba: esta pagina continua viva para o envio terminar
  document.addEventListener('click', function (e) {
    var link = e.target.closest ? e.target.closest('a[href^="https://go.hotmart.com/"]') : null;
    if (!link || window.consentimento.ler() !== 'aceito') return;
    carregar();
    window.fbq('track', 'InitiateCheckout');
  });
})();
