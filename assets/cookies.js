/* Consentimento de cookies (LGPD). Fonte unica do estado: window.consentimento.
   Regra:
   'desconhecido' NUNCA e 'aceito'; o padrao e nao rastrear; valor estranho, versao
   velha ou cookie corrompido significam "pergunte de novo", nunca "pode rastrear".

   Rastreamento (hoje, so assets/medicao.js) so pode carregar assim:
     window.consentimento.quandoAceito(function () { ...carrega o script... });

   A faixa e criada por este arquivo, nao vem no HTML: sem JS nao ha rastreamento, logo
   nao ha o que consentir, e botoes que nao fazem nada seriam interface que mente. */
(function () {
  'use strict';

  var NOME = 'ii_consentimento';
  // Mudou o que pedimos permissao para fazer? Suba a versao: a pessoa e perguntada de novo.
  var VERSAO = '2';
  var VALIDADE = 60 * 60 * 24 * 180;   // 180 dias: consentimento envelhece

  function interpretar(cru) {
    if (!cru) return 'desconhecido';
    var partes = String(cru).split(':');
    // EXATAMENTE duas partes: "1:aceito:extra" nao pode autorizar nada
    if (partes.length !== 2 || partes[0] !== VERSAO) return 'desconhecido';
    return partes[1] === 'aceito' || partes[1] === 'recusado' ? partes[1] : 'desconhecido';
  }

  function lerDoCookie() {
    var pedacos = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < pedacos.length; i++) {
      var corte = pedacos[i].indexOf('=');
      if (corte === -1 || pedacos[i].slice(0, corte).trim() !== NOME) continue;
      try {
        return interpretar(decodeURIComponent(pedacos[i].slice(corte + 1).trim()));
      } catch (e) {
        return 'desconhecido';    // cookie corrompido: pergunta de novo
      }
    }
    return 'desconhecido';
  }

  var ouvintes = [];
  function avisar() {
    var estado = lerDoCookie();
    ouvintes.slice().forEach(function (f) { f(estado); });
  }

  function definir(estado) {
    // Secure: em HTTPS nao viaja por HTTP; localhost conta como contexto seguro
    document.cookie = NOME + '=' + encodeURIComponent(VERSAO + ':' + estado) +
      '; path=/; max-age=' + VALIDADE + '; SameSite=Lax; Secure';
    avisar();
  }

  // Revogar: a faixa volta e nada de rastreamento e liberado. Cookies de terceiro ja
  // gravados nao da para apagar daqui; a politica de privacidade precisa dizer isso.
  function esquecer() {
    document.cookie = NOME + '=; path=/; max-age=0; SameSite=Lax; Secure';
    avisar();
  }

  window.consentimento = {
    ler: lerDoCookie,
    definir: definir,
    esquecer: esquecer,
    interpretar: interpretar,
    assinar: function (f) {
      ouvintes.push(f);
      return function () { ouvintes = ouvintes.filter(function (o) { return o !== f; }); };
    },
    // Roda uma unica vez, e so depois de um "aceito" explicito
    quandoAceito: function (f) {
      if (lerDoCookie() === 'aceito') { f(); return; }
      var cancelar = this.assinar(function (estado) {
        if (estado === 'aceito') { cancelar(); f(); }
      });
    }
  };

  // ---------- faixa ----------
  var faixa = null, voltarFocoPara = null;

  function esconderFaixa() {
    if (!faixa) return;
    faixa.remove();
    faixa = null;
    if (voltarFocoPara) { voltarFocoPara.focus(); voltarFocoPara = null; }
  }

  function mostrarFaixa(focar) {
    if (faixa) return;
    faixa = document.createElement('div');
    faixa.className = 'cookies';
    faixa.setAttribute('role', 'region');
    faixa.setAttribute('aria-label', 'Aviso de cookies');
    faixa.innerHTML =
      '<p class="cookies-texto">Com a sua permissão, usamos cookies da Meta (Facebook e Instagram) para medir de qual anúncio você veio e os cliques na inscrição. Sem permissão, nada de medição é carregado.</p>' +
      '<div class="cookies-acoes">' +
        '<button type="button" class="cookies-botao" data-escolha="recusado">Recusar</button>' +
        '<button type="button" class="cookies-botao" data-escolha="aceito">Aceitar</button>' +
      '</div>';
    faixa.addEventListener('click', function (e) {
      var b = e.target.closest('[data-escolha]');
      if (b) definir(b.getAttribute('data-escolha'));
    });
    document.body.appendChild(faixa);
    if (focar) faixa.querySelector('button').focus();
  }

  window.consentimento.assinar(function (estado) {
    if (estado === 'desconhecido') mostrarFaixa(!!voltarFocoPara);
    else esconderFaixa();
  });

  // Link no rodape para mudar de ideia. Criado aqui: sem JS nao teria o que fazer.
  var nav = document.querySelector('.rodape nav');
  if (nav) {
    var abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'rodape-cookies';
    abrir.textContent = 'Preferências de cookies';
    abrir.addEventListener('click', function () {
      voltarFocoPara = abrir;
      esquecer();
    });
    nav.appendChild(abrir);
  }

  if (lerDoCookie() === 'desconhecido') mostrarFaixa(false);
})();
