/* Cena 3D do conteiner: WebGL puro, sem dependencia. Modelo procedural em pecas
   independentes; desconstrucao ligada ao scroll. Todos os ajustes finos ficam em CONFIG. */
(function () {
  'use strict';

  var CONFIG = {
    // Trecho de scroll da sequencia, em % da altura da tela
    scrollVh: { desktop: 420, mobile: 340 },
    // Fases da sequencia (progresso 0..1)
    fases: { monta: 0.20, afasta: 0.45, distribui: 0.75, libera: 0.86 },
    // Saida: no fim do scroll as pecas vao para fora da tela e o canvas some por completo
    saida: { empurra: [0.84, 1], alcance: 1.5, apaga: [0.93, 0.995] },
    suavizacaoMs: 90,          // resposta ao scroll: quanto menor, mais colado no dedo
    // Enquadramento: largura do conteiner em fracao da tela e centro (-1..1)
    quadro: {
      desktop: { largura: 0.40, cx: 0.20, cy: -0.02 },
      mobile: { largura: 0.86, cx: 0, cy: null, folga: 0.92 }   // cy null: mede o espaco abaixo do texto
    },
    yaw: 35, pitch: 13,        // perspectiva de tres quartos (graus)
    fov: 28,
    afastamento: 0.75,         // distancia da 1a separacao, em metros do modelo
    rotacao: 1,                // multiplica as rotacoes individuais
    parallax: 0.16,            // pecas proximas vao mais longe
    ambiente: { bob: 0.05, giroGraus: 5, some: [0.02, 0.22] },
    particulas: { desktop: 240, mobile: 70, entra: [0.42, 0.60], sai: [0.82, 0.98] },
    chuva: { desktop: 110, mobile: 40, alfa: 0.075 },
    dpr: { desktop: 2, mobile: 1.5 },
    corFundo: [0x1e / 255, 0x20 / 255, 0x23 / 255],
    // Saida do texto do hero e queda da luz; a entrada dos textos vem do HTML (data-entra)
    heroSai: [0.07, 0.24]
  };

  var cena = document.querySelector('.cena');
  if (!cena) return;
  var glCanvas = cena.querySelector('.cena-gl');
  var chuvaCanvas = cena.querySelector('.cena-chuva');
  var heroTexto = cena.querySelector('.cena-hero');
  var rolar = cena.querySelector('.rolar');
  var fundo = cena.querySelector('.cena-fundo');
  var entradas = Array.prototype.map.call(cena.querySelectorAll('[data-entra]'), function (el) {
    var v = el.getAttribute('data-entra').split(',');
    return { el: el, a: parseFloat(v[0]), b: parseFloat(v[1]), q: -1 };
  });

  function estatica(semGl) {
    cena.classList.add(semGl ? 'cena--sem3d' : 'cena--estatica');
  }

  var reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gl = null;
  try {
    gl = glCanvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
  } catch (e) { gl = null; }
  if (!gl) { estatica(true); return; }

  // ---------- matematica ----------
  var RAD = Math.PI / 180;
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function suave(a, b, x) { var t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; }
  // matrizes 3x3 em colunas
  function mul3(a, b) {
    var r = new Array(9);
    for (var c = 0; c < 3; c++) for (var l = 0; l < 3; l++) {
      r[c * 3 + l] = a[l] * b[c * 3] + a[3 + l] * b[c * 3 + 1] + a[6 + l] * b[c * 3 + 2];
    }
    return r;
  }
  function apl3(m, v) {
    return [m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
            m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
            m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
  }
  function perspectiva(fovY, asp, perto, longe) {
    var f = 1 / Math.tan(fovY / 2), nf = 1 / (perto - longe);
    return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (longe + perto) * nf, -1, 0, 0, 2 * longe * perto * nf, 0];
  }

  // ---------- geometria: cada peca e uma malha propria, centrada em si mesma ----------
  function Peca(nome, opcoes) {
    this.nome = nome;
    this.v = [];      // x y z  nx ny nz  albedo rugosidade
    this.op = opcoes;
  }
  Peca.prototype.tri = function (a, b, c, alb, rug) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var n = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= n; ny /= n; nz /= n;
    [a, b, c].forEach(function (p) {
      this.v.push(p[0], p[1], p[2], nx, ny, nz, alb, rug);
    }, this);
  };
  Peca.prototype.quad = function (a, b, c, d, alb, rug) {
    this.tri(a, b, c, alb, rug);
    this.tri(a, c, d, alb, rug);
  };
  Peca.prototype.caixa = function (cx, cy, cz, sx, sy, sz, alb, rug) {
    var x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], alb, rug);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], alb, rug);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], alb, rug);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], alb, rug);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], alb, rug);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], alb, rug);
  };
  // Barra octogonal vertical (travas das portas)
  Peca.prototype.barra = function (cx, y0, y1, cz, r, alb, rug) {
    for (var i = 0; i < 8; i++) {
      var a = i / 8 * Math.PI * 2, b = (i + 1) / 8 * Math.PI * 2;
      this.quad([cx + r * Math.cos(a), y0, cz + r * Math.sin(a)], [cx + r * Math.cos(b), y0, cz + r * Math.sin(b)],
                [cx + r * Math.cos(b), y1, cz + r * Math.sin(b)], [cx + r * Math.cos(a), y1, cz + r * Math.sin(a)], alb, rug);
    }
  };
  // Chapa corrugada com espessura. mapa(u, v, w) -> [x, y, z]; u ao longo do perfil,
  // v na direcao das ondas, w para fora da chapa.
  Peca.prototype.corrugada = function (u0, u1, v0, v1, passo, fundoOnda, esp, mapa, alb, rug) {
    var pts = [], u = u0, n = Math.max(1, Math.round((u1 - u0) / passo)), d = (u1 - u0) / n;
    for (var i = 0; i < n; i++) {
      pts.push([u0 + d * i, 0], [u0 + d * (i + 0.18), fundoOnda], [u0 + d * (i + 0.5), fundoOnda], [u0 + d * (i + 0.68), 0]);
    }
    pts.push([u1, 0]);
    for (var k = 0; k < pts.length - 1; k++) {
      var a = pts[k], b = pts[k + 1];
      this.quad(mapa(a[0], v0, a[1]), mapa(b[0], v0, b[1]), mapa(b[0], v1, b[1]), mapa(a[0], v1, a[1]), alb, rug);
      this.quad(mapa(b[0], v0, b[1] - esp), mapa(a[0], v0, a[1] - esp), mapa(a[0], v1, a[1] - esp), mapa(b[0], v1, b[1] - esp), alb * 0.75, rug);
      this.quad(mapa(a[0], v1, a[1]), mapa(b[0], v1, b[1]), mapa(b[0], v1, b[1] - esp), mapa(a[0], v1, a[1] - esp), alb, rug);
      this.quad(mapa(b[0], v0, b[1]), mapa(a[0], v0, a[1]), mapa(a[0], v0, a[1] - esp), mapa(b[0], v0, b[1] - esp), alb, rug);
    }
  };
  Peca.prototype.fechar = function () {
    var v = this.v, min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9], i, c;
    for (i = 0; i < v.length; i += 8) for (c = 0; c < 3; c++) {
      if (v[i + c] < min[c]) min[c] = v[i + c];
      if (v[i + c] > max[c]) max[c] = v[i + c];
    }
    this.centro = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    for (i = 0; i < v.length; i += 8) for (c = 0; c < 3; c++) v[i + c] -= this.centro[c];
    this.dados = new Float32Array(v);
    this.total = v.length / 8;
    this.v = null;
    return this;
  };

  // Medidas de um conteiner de 20 pes, em metros
  var L = 6.06, H = 2.59, W = 2.44;
  var CH = 0.13;              // secao das colunas e longarinas
  var AC = { parede: 0.17, estrut: 0.12, canto: 0.09, metal: 0.42, porta: 0.15, piso: 0.1 };
  var pecas = [];
  function nova(nome, op) { var p = new Peca(nome, op); pecas.push(p); return p; }

  // Paredes laterais (corrugadas), com a onda para fora
  var frente = nova('parede-frente', {
    dir: [0, 0, 1], ativo: 0.02,
    l: { fx: -0.90, fy: 0.02, z: 2.2, rot: [4, 62, -4] }, p: { fx: -0.12, fy: 0.74, z: -1, rot: [-20, 6, -5] }
  });
  frente.corrugada(-L / 2 + CH, L / 2 - CH, -H / 2 + CH, H / 2 - CH, 0.278, 0.038, 0.012,
    function (u, v, w) { return [u, v, W / 2 - 0.04 + w]; }, AC.parede, 0.56);
  var tras = nova('parede-tras', {
    dir: [0, 0, -1], ativo: 0.0,
    l: { fx: 0.98, fy: -0.06, z: -2.4, rot: [-5, -58, 5] }, p: { fx: 0.10, fy: -0.80, z: -2, rot: [18, -8, 6] }
  });
  tras.corrugada(-L / 2 + CH, L / 2 - CH, -H / 2 + CH, H / 2 - CH, 0.278, 0.038, 0.012,
    function (u, v, w) { return [-u, v, -W / 2 + 0.04 - w]; }, AC.parede, 0.56);

  // Fundo do conteiner, em +X
  var fim = nova('parede-fim', {
    dir: [1, 0, 0], ativo: 0.03,
    l: { fx: 0.70, fy: 0.74, z: -5, rot: [24, -32, 10] }, p: { fx: 0.92, fy: 0.90, z: -6, rot: [22, -30, 8] }
  });
  fim.corrugada(-W / 2 + CH, W / 2 - CH, -H / 2 + CH, H / 2 - CH, 0.26, 0.035, 0.012,
    function (u, v, w) { return [L / 2 - 0.04 + w, v, -u]; }, AC.parede, 0.56);

  // Teto: chapa corrugada transversal
  var teto = nova('teto', {
    dir: [0, 1, 0], ativo: 0.0,
    l: { fx: -0.10, fy: 0.98, z: -4, rot: [32, 6, -5] }, p: { fx: -0.62, fy: 0.97, z: -7, rot: [26, 10, -6] }
  });
  teto.corrugada(-L / 2 + CH, L / 2 - CH, -W / 2 + CH, W / 2 - CH, 0.22, 0.022, 0.01,
    function (u, v, w) { return [u, H / 2 - 0.03 + w, -v]; }, AC.parede * 0.94, 0.6);

  // Piso com travessas
  var piso = nova('piso', {
    dir: [0, -1, 0], ativo: 0.05,
    l: { fx: 0.05, fy: -1.0, z: -3, rot: [-28, -5, 4] }, p: { fx: 0.62, fy: -0.98, z: -6, rot: [-26, -10, 5] }
  });
  piso.caixa(0, -H / 2 + 0.09, 0, L - CH * 2, 0.03, W - CH * 2, AC.piso, 0.72);
  for (var tv = -2.6; tv <= 2.61; tv += 0.65) piso.caixa(tv, -H / 2 + 0.03, 0, 0.07, 0.09, W - CH * 2, AC.estrut, 0.6);

  // Portas (em -X): chapa, reforcos, 2 travas por folha, manoplas e dobradicas
  function porta(nome, sinal, final) {
    var p = nova(nome, final);
    var xp = -L / 2 + 0.03, zc = sinal * (W / 4 - CH / 4), lz = W / 2 - CH - 0.02, alt = H - CH * 2 - 0.02;
    p.caixa(xp, 0, zc, 0.03, alt, lz, AC.porta, 0.58);
    // moldura e nervuras em relevo
    p.caixa(xp - 0.022, alt / 2 - 0.05, zc, 0.03, 0.1, lz, AC.porta * 1.1, 0.5);
    p.caixa(xp - 0.022, -alt / 2 + 0.05, zc, 0.03, 0.1, lz, AC.porta * 1.1, 0.5);
    p.caixa(xp - 0.022, 0, zc + lz / 2 - 0.04, 0.03, alt, 0.07, AC.porta * 1.1, 0.5);
    p.caixa(xp - 0.022, 0, zc - lz / 2 + 0.04, 0.03, alt, 0.07, AC.porta * 1.1, 0.5);
    for (var i = -2; i <= 2; i++) p.caixa(xp - 0.016, i * 0.42, zc, 0.012, 0.16, lz - 0.2, AC.porta * 0.85, 0.62);
    // travas verticais, guias, manoplas
    [-0.3, 0.3].forEach(function (d) {
      var zb = zc + d * lz * 0.75, xb = xp - 0.07;
      p.barra(xb, -alt / 2 - 0.02, alt / 2 + 0.02, zb, 0.018, AC.metal, 0.34);
      [-0.95, -0.35, 0.35, 0.95].forEach(function (f) { p.caixa(xb + 0.02, f * alt / 2, zb, 0.05, 0.05, 0.06, AC.metal * 0.75, 0.42); });
      p.caixa(xb - 0.012, -0.4, zb + sinal * 0.13, 0.03, 0.035, 0.28, AC.metal, 0.36);
      p.caixa(xb - 0.012, -0.4, zb, 0.05, 0.08, 0.06, AC.metal * 0.8, 0.4);
    });
    // dobradicas na borda externa
    [-0.8, -0.27, 0.27, 0.8].forEach(function (f) {
      p.caixa(xp - 0.03, f * alt / 2, zc + sinal * (lz / 2 - 0.02), 0.05, 0.1, 0.1, AC.metal * 0.6, 0.45);
    });
  }
  porta('porta-esq', 1, {
    dir: [-1, 0, 0.35], ativo: 0.0,
    l: { fx: -0.72, fy: 0.72, z: 1, rot: [12, 48, 8] }, p: { fx: -0.86, fy: -0.70, z: 0, rot: [8, 30, 6] }
  });
  porta('porta-dir', -1, {
    dir: [-1, 0, -0.35], ativo: 0.015,
    l: { fx: 0.70, fy: -0.78, z: 3, rot: [-14, -44, -10] }, p: { fx: 0.90, fy: -0.66, z: 1, rot: [-8, -30, -6] }
  });

  // Estrutura: colunas, longarinas e travessas (pecas separadas)
  var estruturais = [];
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (c, i) {
    var p = nova('coluna-' + i, { dir: [c[0], 0, c[1]], ativo: 0.04, pequeno: true, comprimento: true });
    p.caixa(c[0] * (L / 2 - CH / 2), 0, c[1] * (W / 2 - CH / 2), CH, H - 0.2, CH, AC.estrut, 0.52);
    estruturais.push(p);
  });
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (c, i) {
    var p = nova('longarina-' + i, { dir: [0, c[0], c[1]], ativo: 0.05, pequeno: true, comprimento: true });
    p.caixa(0, c[0] * (H / 2 - CH / 2), c[1] * (W / 2 - CH / 2), L - 0.3, CH, CH, AC.estrut, 0.52);
    estruturais.push(p);
  });
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (c, i) {
    var p = nova('travessa-' + i, { dir: [c[1], c[0], 0], ativo: 0.05, pequeno: true });
    p.caixa(c[1] * (L / 2 - CH / 2), c[0] * (H / 2 - CH / 2), 0, CH, CH, W - 0.3, AC.estrut, 0.52);
    estruturais.push(p);
  });
  // 8 cantoneiras de canto
  for (var sx = -1; sx <= 1; sx += 2) for (var sy = -1; sy <= 1; sy += 2) for (var sz = -1; sz <= 1; sz += 2) {
    var cp = nova('canto', { dir: [sx, sy, sz], ativo: 0.06, pequeno: true });
    cp.caixa(sx * (L / 2 - 0.09), sy * (H / 2 - 0.06), sz * (W / 2 - 0.08), 0.18, 0.12, 0.16, AC.canto, 0.48);
    cp.caixa(sx * (L / 2 + 0.001), sy * (H / 2 - 0.06), sz * (W / 2 - 0.08), 0.004, 0.06, 0.08, 0.02, 0.8);
    estruturais.push(cp);
  }

  // Pecas pequenas: posicao final distribuida ao redor do centro, sem entrar nele
  (function distribuir() {
    var n = estruturais.length;
    estruturais.forEach(function (p, i) {
      var t = (i + 0.5) / n * Math.PI * 2 + 0.35;
      var c = Math.cos(t), s = Math.sin(t);
      var zona = (i * 7) % 5;
      var z = [-6, -3.5, -1.5, 1, 3][zona];
      var giro = [(i * 37 % 60) - 30, (i * 53 % 80) - 40, (i * 29 % 50) - 25];
      p.op.l = { fx: c * (0.80 + (i % 3) * 0.07), fy: s * (0.74 + (i % 4) * 0.07), z: z, rot: giro };
      var giroRetrato = p.op.comprimento ? [giro[0] * 0.3, giro[1] * 0.3, giro[2] * 0.25] : giro;
      p.op.p = { fx: c * (0.86 + (i % 3) * 0.05), fy: (s >= 0 ? 1 : -1) * (0.66 + Math.abs(s) * 0.30), z: z, rot: giroRetrato };
    });
  })();

  pecas.forEach(function (p) { p.fechar(); });

  // ---------- shaders ----------
  var VS = 'attribute vec3 aP;attribute vec3 aN;attribute vec2 aM;' +
    'uniform mat4 uVP;uniform mat4 uM;varying vec3 vN;varying vec3 vW;varying vec2 vM;varying vec3 vL;' +
    'void main(){vec4 w=uM*vec4(aP,1.);vW=w.xyz;vN=mat3(uM)*aN;vM=aM;vL=aP;gl_Position=uVP*w;}';
  var FS = 'precision mediump float;varying vec3 vN;varying vec3 vW;varying vec2 vM;varying vec3 vL;' +
    'uniform vec3 uCam;uniform vec3 uFundo;uniform float uLuz;' +
    'const float PI=3.14159;' +
    'float ruido(vec3 p){return fract(sin(dot(floor(p),vec3(12.9898,78.233,37.719)))*43758.5453);}' +
    'float D(float nh,float a){float a2=a*a;float d=nh*nh*(a2-1.)+1.;return a2/(PI*d*d);}' +
    'float G(float nl,float nv,float r){float k=(r+1.)*(r+1.)/8.;return nl/(nl*(1.-k)+k)*nv/(nv*(1.-k)+k);}' +
    'vec3 luz(vec3 n,vec3 v,vec3 l,vec3 cor,vec3 base,float rug){' +
    'vec3 h=normalize(l+v);float nl=max(dot(n,l),0.);float nv=max(dot(n,v),.02);float nh=max(dot(n,h),0.);float vh=max(dot(v,h),0.);' +
    'vec3 f0=mix(vec3(.04),base,.5);vec3 F=f0+(1.-f0)*pow(1.-vh,5.);' +
    'vec3 esp=D(nh,rug*rug)*G(nl,nv,rug)*F/(4.*nv*max(nl,.02));' +
    'return (base*(1.-.65)/PI*(1.-F)+esp)*cor*nl;}' +
    'void main(){vec3 n=normalize(vN);vec3 v=normalize(uCam-vW);float dentro=1.;if(dot(n,v)<0.){n=-n;dentro=.38;}' +
    'float grao=mix(.9,1.08,ruido(vL*vec3(5.,9.,5.)));float mancha=mix(.94,1.05,ruido(vL*1.3));' +
    'vec3 base=vec3(vM.x)*vec3(.98,.99,1.03)*grao*mancha;float rug=vM.y;' +
    'vec3 c=vec3(0.);' +
    'c+=luz(n,v,normalize(vec3(-.70,.66,.28)),vec3(1.,.66,.30)*1.5*uLuz,base,rug);' +     // chave dourada: topo e lateral esquerda
    'c+=luz(n,v,normalize(vec3(.40,.10,.90)),vec3(.70,.74,.82)*.85,base,rug);' +          // preenchimento frio e fraco: a cor cinza vem daqui
    'c+=luz(n,v,normalize(vec3(.42,.34,-.84)),vec3(1.,.84,.62)*3.*uLuz,base,rug);' +      // contraluz nas bordas
    'c+=base*mix(vec3(.05,.052,.058),vec3(.11,.105,.10),n.y*.5+.5);' +
    'c+=vec3(1.,.8,.55)*pow(1.-max(dot(n,v),0.),5.)*.04*uLuz;' +
    'c*=dentro;' +
    'c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);c=pow(clamp(c,0.,1.),vec3(1./2.2));' +
    'float dist=length(uCam-vW);float nevoa=smoothstep(uCam.z+2.,uCam.z+11.,dist)*.34;' +
    'gl_FragColor=vec4(mix(c,uFundo,nevoa),1.);}';
  var VSP = 'attribute vec3 aO;attribute vec3 aD;attribute vec3 aS;uniform mat4 uVP;uniform float uE;uniform float uT;uniform float uEsc;varying float vA;varying float vO;' +
    'void main(){vec3 p=aO+aD*uE+vec3(sin(uT*.3+aS.x*6.)*.03,cos(uT*.25+aS.y*6.)*.03,0.);vec4 c=uVP*vec4(p,1.);gl_Position=c;' +
    'gl_PointSize=uEsc*(.6+aS.z*1.5)*18./c.w;vA=aS.y;vO=aS.x;}';
  var FSP = 'precision mediump float;varying float vA;varying float vO;uniform float uA;' +
    'void main(){vec2 d=gl_PointCoord-.5;float r=dot(d,d);if(r>.25)discard;float a=(1.-r*4.)*uA*(.25+vA*.75);' +
    'vec3 c=vO>.72?vec3(.85,.62,.32):vec3(.55,.56,.6);gl_FragColor=vec4(c*a,a);}';

  function compilar(vs, fs) {
    function sh(t, s) {
      var x = gl.createShader(t);
      gl.shaderSource(x, s);
      gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x));
      return x;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  var prog, progP, loc = {}, locP = {};
  try {
    prog = compilar(VS, FS);
    progP = compilar(VSP, FSP);
  } catch (e) {
    console.error('Cena 3D: falha nos shaders.', e);
    estatica(true);
    return;
  }
  ['uVP', 'uM', 'uCam', 'uFundo', 'uLuz'].forEach(function (n) { loc[n] = gl.getUniformLocation(prog, n); });
  ['aP', 'aN', 'aM'].forEach(function (n) { loc[n] = gl.getAttribLocation(prog, n); });
  ['uVP', 'uE', 'uT', 'uA', 'uEsc'].forEach(function (n) { locP[n] = gl.getUniformLocation(progP, n); });
  ['aO', 'aD', 'aS'].forEach(function (n) { locP[n] = gl.getAttribLocation(progP, n); });

  pecas.forEach(function (p) {
    p.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buf);
    gl.bufferData(gl.ARRAY_BUFFER, p.dados, gl.STATIC_DRAW);
    p.dados = null;
    // Atraso determinista dentro de cada fase (evita trajetorias aleatorias)
    p.atraso = p.op.ativo;
    var n = p.op.dir, m = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    p.dirA = [n[0] / m, n[1] / m, n[2] / m];
  });

  // ---------- estado de layout ----------
  var ehMobile, cfg, W_ = 1, H_ = 1, D = 17, asp = 1, tan2 = Math.tan(CONFIG.fov * RAD / 2);
  var centro = [0, 0], VP = new Float32Array(16), cam = [0, 0, 17];
  var nPart = 0, bufPart = null, chuvaLinhas = [];

  function montarParticulas() {
    nPart = ehMobile ? CONFIG.particulas.mobile : CONFIG.particulas.desktop;
    var d = new Float32Array(nPart * 9);
    function r(i, k) { var x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }
    for (var i = 0; i < nPart; i++) {
      var o = [(r(i, 1) - 0.5) * L, (r(i, 2) - 0.5) * H, (r(i, 3) - 0.5) * W];
      var dir = [o[0] * (0.6 + r(i, 4)), o[1] * (1.2 + r(i, 5) * 1.5), o[2] * (1.2 + r(i, 6) * 2) + (r(i, 7) - 0.5) * 3];
      d.set([o[0], o[1], o[2], dir[0], dir[1], dir[2], r(i, 8), r(i, 9), r(i, 10)], i * 9);
    }
    if (!bufPart) bufPart = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPart);
    gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
  }

  function medir() {
    // Mede o proprio canvas: na apresentacao estatica ele e menor que o palco
    var w = glCanvas.clientWidth || cena.clientWidth, h = glCanvas.clientHeight || window.innerHeight;
    var era = ehMobile;
    ehMobile = w < 1024 || w / h < 1.1;
    cfg = ehMobile ? CONFIG.quadro.mobile : CONFIG.quadro.desktop;
    var dpr = Math.min(window.devicePixelRatio || 1, ehMobile ? CONFIG.dpr.mobile : CONFIG.dpr.desktop);
    W_ = w; H_ = h; asp = w / h;
    glCanvas.width = Math.round(w * dpr);
    glCanvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    if (chuvaCanvas) { chuvaCanvas.width = w; chuvaCanvas.height = h; }
    // Largura aparente do modelo em tres quartos
    var yaw = CONFIG.yaw * RAD;
    var largura = L * Math.cos(yaw) + W * Math.sin(yaw);
    D = largura / (2 * cfg.largura * tan2 * asp);
    var cy = cfg.cy, cx = cfg.cx;
    if (cena.classList.contains('cena--estatica')) {
      cx = 0; cy = 0;
    } else if (cy === null) {
      // Celular: cabe no espaco entre o fim do texto do hero e o "Role"
      var topoLivre = heroTexto ? heroTexto.offsetTop + heroTexto.offsetHeight + 12 : h * 0.6;
      var baseLivre = h - (rolar ? rolar.offsetHeight + 14 : 20);
      var altLivre = Math.max(baseLivre - topoLivre, h * 0.16);
      cy = -((topoLivre + altLivre / 2) / h * 2 - 1);
      // Altura aparente do modelo em tres quartos
      var pit = CONFIG.pitch * RAD;
      var alturaModelo = H * Math.cos(pit) + (L * Math.sin(yaw) + W * Math.cos(yaw)) * Math.sin(pit);
      D = Math.max(D, alturaModelo * h / (2 * tan2 * altLivre * CONFIG.quadro.mobile.folga));
    }
    D = Math.max(D, 9);
    cam = [0, 0, D];
    centro = [cx * D * tan2 * asp, cy * D * tan2];
    var P = perspectiva(CONFIG.fov * RAD, asp, 0.5, 60);
    // VP = P * translacao(0, 0, -D)
    for (var i = 0; i < 16; i++) VP[i] = P[i];
    VP[12] = P[8] * -D + P[12]; VP[13] = P[9] * -D + P[13];
    VP[14] = P[10] * -D + P[14]; VP[15] = P[11] * -D + P[15];
    if (era !== ehMobile || !bufPart) { montarParticulas(); semearChuva(); }
  }

  function semearChuva() {
    if (!chuvaCanvas) return;
    var n = ehMobile ? CONFIG.chuva.mobile : CONFIG.chuva.desktop;
    chuvaLinhas = [];
    for (var i = 0; i < n; i++) {
      chuvaLinhas.push({ x: Math.random(), y: Math.random(), l: 40 + Math.random() * 110, v: 0.02 + Math.random() * 0.035, a: 0.45 + Math.random() * 0.55 });
    }
  }
  var ctx2 = chuvaCanvas ? chuvaCanvas.getContext('2d') : null;
  var RAIO = 18 * RAD;     // inclinacao da chuva em relacao a vertical
  function desenharChuva(dt) {
    if (!ctx2) return;
    ctx2.clearRect(0, 0, W_, H_);
    ctx2.lineWidth = 1;
    var dx = Math.sin(RAIO), dy = Math.cos(RAIO);
    for (var i = 0; i < chuvaLinhas.length; i++) {
      var g = chuvaLinhas[i];
      g.y += g.v * dt / 1000;
      if (g.y > 1.15) { g.y = -0.15; g.x = Math.random(); }
      var x = (g.x + (g.y - 0.5) * dx * 1.2) * W_ * 1.1 - W_ * 0.05, y = g.y * H_;
      ctx2.strokeStyle = 'rgba(205,205,210,' + (CONFIG.chuva.alfa * g.a).toFixed(3) + ')';
      ctx2.beginPath();
      ctx2.moveTo(x, y);
      ctx2.lineTo(x + dx * g.l, y + dy * g.l);
      ctx2.stroke();
    }
  }

  // ---------- quadro ----------
  var M = new Float32Array(16);
  var fases = CONFIG.fases;
  function desenharPeca(p, progresso, G, base, ambiente) {
    var d = p.atraso;
    var s1 = suave(fases.monta + d, fases.afasta + d, progresso);
    var s2 = suave(fases.afasta + d, fases.distribui + d * 0.5, progresso);
    var s3 = suave(fases.distribui + d * 0.5, fases.libera, progresso);
    // P0: lugar na estrutura. P1: pequena separacao ao longo da normal da peca.
    var c0 = apl3(G, p.centro);
    var P0 = [c0[0] + base[0], c0[1] + base[1], c0[2]];
    var dA = apl3(G, p.dirA);
    var dist = CONFIG.afastamento * (p.op.pequeno ? 0.8 : 1);
    var P1 = [P0[0] + dA[0] * dist, P0[1] + dA[1] * dist, P0[2] + dA[2] * dist];
    // P3: posicao final em fracoes da tela, na profundidade da peca
    var f = ehMobile ? p.op.p : p.op.l;
    var perto = (D - f.z);
    var par = 1 + CONFIG.parallax * (f.z / 3);
    var fora = 1 + CONFIG.saida.alcance * suave(CONFIG.saida.empurra[0], CONFIG.saida.empurra[1], progresso);
    var P3 = [f.fx * par * perto * tan2 * asp * fora, f.fy * par * perto * tan2 * fora, f.z];
    var P2 = [P1[0] + (P3[0] - P1[0]) * 0.62, P1[1] + (P3[1] - P1[1]) * 0.62, P1[2] + (P3[2] - P1[2]) * 0.62];
    var x = P0[0] + (P1[0] - P0[0]) * s1 + (P2[0] - P1[0]) * s2 + (P3[0] - P2[0]) * s3;
    var y = P0[1] + (P1[1] - P0[1]) * s1 + (P2[1] - P1[1]) * s2 + (P3[1] - P2[1]) * s3;
    var z = P0[2] + (P1[2] - P0[2]) * s1 + (P2[2] - P1[2]) * s2 + (P3[2] - P2[2]) * s3;
    // Rotacao individual cresce devagar ao longo da sequencia
    var r = (0.18 * s1 + 0.52 * s2 + 0.30 * s3) * RAD * CONFIG.rotacao;
    var R = mul3(G, mul3(rotZ(f.rot[2] * r), mul3(rotY(f.rot[1] * r), rotX(f.rot[0] * r))));
    M[0] = R[0]; M[1] = R[1]; M[2] = R[2]; M[3] = 0;
    M[4] = R[3]; M[5] = R[4]; M[6] = R[5]; M[7] = 0;
    M[8] = R[6]; M[9] = R[7]; M[10] = R[8]; M[11] = 0;
    M[12] = x; M[13] = y; M[14] = z; M[15] = 1;
    gl.uniformMatrix4fv(loc.uM, false, M);
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buf);
    gl.vertexAttribPointer(loc.aP, 3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(loc.aN, 3, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(loc.aM, 2, gl.FLOAT, false, 32, 24);
    gl.drawArrays(gl.TRIANGLES, 0, p.total);
  }

  function renderizar(progresso, t) {
    var amb = 1 - suave(CONFIG.ambiente.some[0], CONFIG.ambiente.some[1], progresso);
    var yaw = (CONFIG.yaw + amb * Math.sin(t * 0.22) * CONFIG.ambiente.giroGraus) * RAD;
    var G = mul3(rotX(CONFIG.pitch * RAD), rotY(yaw));
    var base = [centro[0], centro[1] + amb * Math.sin(t * 0.7) * CONFIG.ambiente.bob];

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uVP, false, VP);
    gl.uniform3fv(loc.uCam, cam);
    gl.uniform3fv(loc.uFundo, CONFIG.corFundo);
    gl.uniform1f(loc.uLuz, 1 - suave(0.7, 1, progresso) * 0.15);
    gl.enableVertexAttribArray(loc.aP);
    gl.enableVertexAttribArray(loc.aN);
    gl.enableVertexAttribArray(loc.aM);
    for (var i = 0; i < pecas.length; i++) desenharPeca(pecas[i], progresso, G, base, amb);
    gl.disableVertexAttribArray(loc.aP);
    gl.disableVertexAttribArray(loc.aN);
    gl.disableVertexAttribArray(loc.aM);

    // Particulas: so durante a abertura
    var pc = CONFIG.particulas;
    var alfa = suave(pc.entra[0], pc.entra[1], progresso) * (1 - suave(pc.sai[0], pc.sai[1], progresso));
    if (alfa > 0.003 && nPart) {
      gl.useProgram(progP);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      // Particulas no mesmo referencial do conteiner parado
      var GP = G, VPp = new Float32Array(16);
      var m = [GP[0], GP[1], GP[2], 0, GP[3], GP[4], GP[5], 0, GP[6], GP[7], GP[8], 0, base[0], base[1], 0, 1];
      for (var c = 0; c < 4; c++) for (var l = 0; l < 4; l++) {
        VPp[c * 4 + l] = VP[l] * m[c * 4] + VP[4 + l] * m[c * 4 + 1] + VP[8 + l] * m[c * 4 + 2] + VP[12 + l] * m[c * 4 + 3];
      }
      gl.uniformMatrix4fv(locP.uVP, false, VPp);
      gl.uniform1f(locP.uE, suave(pc.entra[0], 1, progresso) * 1.6);
      gl.uniform1f(locP.uT, t);
      gl.uniform1f(locP.uA, alfa);
      gl.uniform1f(locP.uEsc, glCanvas.width / W_);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufPart);
      gl.enableVertexAttribArray(locP.aO);
      gl.enableVertexAttribArray(locP.aD);
      gl.enableVertexAttribArray(locP.aS);
      gl.vertexAttribPointer(locP.aO, 3, gl.FLOAT, false, 36, 0);
      gl.vertexAttribPointer(locP.aD, 3, gl.FLOAT, false, 36, 12);
      gl.vertexAttribPointer(locP.aS, 3, gl.FLOAT, false, 36, 24);
      gl.drawArrays(gl.POINTS, 0, nPart);
      gl.disableVertexAttribArray(locP.aO);
      gl.disableVertexAttribArray(locP.aD);
      gl.disableVertexAttribArray(locP.aS);
    }
  }

  // ---------- camadas de HTML ligadas ao progresso ----------
  var heroVisivel = true;
  function atualizarCamadas(p) {
    var h = 1 - suave(CONFIG.heroSai[0], CONFIG.heroSai[1], p);
    if (heroTexto) {
      heroTexto.style.opacity = h.toFixed(3);
      heroTexto.style.transform = 'translate3d(0,' + ((1 - h) * -28).toFixed(1) + 'px,0)';
      var vis = h > 0.01;
      if (vis !== heroVisivel) {
        heroVisivel = vis;
        heroTexto.style.visibility = vis ? '' : 'hidden';    // CTA oculto nao recebe Tab
      }
    }
    if (rolar) rolar.classList.toggle('sumiu', p > 0.015);
    // Canvas apagado no fim: nenhuma peca sobra na tela, e voltar o scroll traz tudo de volta
    var opGl = 1 - suave(CONFIG.saida.apaga[0], CONFIG.saida.apaga[1], p);
    glCanvas.style.opacity = opGl.toFixed(3);
    glCanvas.style.visibility = opGl <= 0 ? 'hidden' : '';
    if (fundo) {
      fundo.style.setProperty('--luz', (1 - suave(0.5, 1, p) * 0.6).toFixed(3));
      fundo.style.setProperty('--luz-x', (cfg.cx * 50 + 50 + suave(0.2, 1, p) * -cfg.cx * 50).toFixed(1) + '%');
      fundo.style.setProperty('--luz-y', (46 + suave(0.2, 1, p) * 6).toFixed(1) + '%');
    }
    for (var i = 0; i < entradas.length; i++) {
      var e = entradas[i], q = suave(e.a, e.b, p);
      if (Math.abs(q - e.q) < 0.002) continue;
      e.q = q;
      e.el.style.opacity = q.toFixed(3);
      e.el.style.transform = 'translate3d(0,' + ((1 - q) * 26).toFixed(1) + 'px,0)';
      e.el.style.clipPath = 'inset(0 0 ' + ((1 - q) * 100).toFixed(1) + '% 0)';
    }
  }

  // ---------- inicio ----------
  medir();

  if (reduzir) {
    // Apresentacao simplificada: conteiner montado, parado; texto no fluxo normal
    estatica(false);
    medir();
    renderizar(0, 0);
    window.addEventListener('resize', function () { medir(); renderizar(0, 0); });
    return;
  }

  cena.classList.add('cena--ativa');
  cena.style.height = (ehMobile ? CONFIG.scrollVh.mobile : CONFIG.scrollVh.desktop) + 'vh';
  medir();

  var alvo = 0, atual = 0, anterior = 0, visivel = true, perdido = false;
  function lerScroll() {
    var r = cena.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    alvo = total > 0 ? clamp01(-r.top / total) : 0;
  }
  lerScroll();
  atual = alvo;
  atualizarCamadas(atual);

  function quadro(agora) {
    requestAnimationFrame(quadro);
    if (!visivel || perdido) { anterior = agora; return; }
    var dt = Math.min(agora - (anterior || agora), 100);
    anterior = agora;
    lerScroll();
    atual += (alvo - atual) * (1 - Math.exp(-dt / CONFIG.suavizacaoMs));
    if (Math.abs(alvo - atual) < 0.0002) atual = alvo;
    renderizar(atual, agora / 1000);
    desenharChuva(dt);
    atualizarCamadas(atual);
    cena.style.setProperty('--p', atual.toFixed(4));
  }
  requestAnimationFrame(quadro);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { visivel = e[0].isIntersecting; }).observe(cena);
  }
  window.addEventListener('resize', function () {
    medir();
    cena.style.height = (ehMobile ? CONFIG.scrollVh.mobile : CONFIG.scrollVh.desktop) + 'vh';
  });
  glCanvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    perdido = true;
    console.error('Cena 3D: contexto WebGL perdido.');
    estatica(true);
  });

  // "Role": leva ao ponto em que os textos ja apareceram, em vez de pular a sequencia
  if (rolar) {
    rolar.addEventListener('click', function (e) {
      e.preventDefault();
      var r = cena.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + r.top + (r.height - window.innerHeight) * 0.9, behavior: 'smooth' });
    });
  }
})();
