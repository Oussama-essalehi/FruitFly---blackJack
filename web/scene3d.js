/* FlyJack - the casino in 3D (three.js, bundled from web/vendor). A Stage is one room with a
   table, a lamp that casts shadows, a camera you can drag around, and an HTML overlay for the
   words (totals, name plates, thought bubbles), which stay crisp at any size.
   Table positions are given in "table units": the x, y of the old flat drawing (1200 x 675).
   Each table says how those map onto its felt, so the game code still thinks in x and y. */
(function (root) {
  'use strict';
  var T = root.THREE, K = root.SceneKit, clamp01 = K.clamp01, easeIn = K.easeIn, now = K.now;
  var PIPS = K.PIPS, RED = '#c2332d', INK = '#1c1c1c';
  var CHIPS = { red: ['#c0392b', '#7d1f17'], blue: ['#2c5aa0', '#1a3866'], green: ['#1f7a4a', '#11482b'], black: ['#26262b', '#0e0e10'], white: ['#ece6d6', '#b9b09c'], purple: ['#6a2c8a', '#3e1752'] };
  var FONT = '"Bricolage Grotesque", "Arial Narrow", Arial, sans-serif', MONO = '"IBM Plex Mono", ui-monospace, monospace';

  /* ---------- small helpers ---------- */
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texture(c, repeat) {
    var t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function std(color, o) {
    o = o || {};
    var m = new T.MeshStandardMaterial({ color: color, roughness: o.rough === undefined ? 0.6 : o.rough, metalness: o.metal || 0 });
    if (o.map) m.map = o.map;
    if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.glow || 1; }
    if (o.opacity !== undefined) { m.transparent = true; m.opacity = o.opacity; }
    if (o.side) m.side = o.side;
    return m;
  }
  function mesh(geo, mat, parent, shadow) {
    var m = new T.Mesh(geo, mat);
    if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; }
    if (parent) parent.add(m);
    return m;
  }
  var SPHERE = new T.SphereGeometry(1, 28, 20), CYL = new T.CylinderGeometry(1, 1, 1, 14), UP = new T.Vector3(0, 1, 0);
  /* Stretch a unit cylinder between two points. */
  function rod(m, a, b, r) {
    var d = new T.Vector3().subVectors(b, a), len = d.length() || 1e-3;
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
    m.scale.set(r, len, r);
  }
  /* Two-bone reach: the elbow (or knee) between a and the target, bent towards `bend`. */
  function joint(a, target, l1, l2, bend) {
    var d = new T.Vector3().subVectors(target, a), dist = Math.min(d.length(), l1 + l2 - 0.5);
    var dir = d.normalize(), along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    var perp = bend.clone().addScaledVector(dir, -bend.dot(dir)).normalize();
    var mid = a.clone().addScaledVector(dir, along).addScaledVector(perp, h);
    return { mid: mid, end: a.clone().addScaledVector(dir, dist) };
  }
  function glowTexture(color) {
    var c = canvas(128, 128), g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, color); r.addColorStop(0.3, color + '88'); r.addColorStop(1, color + '00');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    return texture(c);
  }
  var glows = {};
  function glowSprite(color, size, opacity) {
    var t = glows[color] || (glows[color] = glowTexture(color));
    var s = new T.Sprite(new T.SpriteMaterial({ map: t, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: opacity === undefined ? 1 : opacity }));
    s.scale.set(size, size, 1);
    return s;
  }

  /* ---------- the stage ---------- */
  /* el: the box to fill. o: { map: function (x, y) -> [X, Z] on the felt, views: { wide, narrow: {pos, target, fov} },
     label: an accessible name } */
  function Stage(el, o) {
    var self = this;
    this.el = el; this.o = o; this.mapXY = o.map;
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    this.renderer.outputEncoding = T.sRGBEncoding;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement; this.canvas.className = 'scene-gl';
    el.appendChild(this.canvas);
    this.overlay = document.createElement('div'); this.overlay.className = 'scene-overlay'; el.appendChild(this.overlay);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.svg.setAttribute('class', 'scene-trails'); this.overlay.appendChild(this.svg);
    this.scene = new T.Scene();
    this.scene.background = new T.Color('#050505');
    this.table = new T.Group(); this.scene.add(this.table);
    this.camera = new T.PerspectiveCamera(38, 16 / 9, 10, 6000);
    this.labels = []; this.tickers = []; this.view = null;
    this.orbit = { yaw: 0, pitch: 0, vYaw: 0, drag: null };
    this.visible = true; this.w = 0; this.h = 0;
    this.fit();
    if (root.ResizeObserver) new ResizeObserver(function () { self.fit(); }).observe(el); else root.addEventListener('resize', function () { self.fit(); });
    if (root.IntersectionObserver) new IntersectionObserver(function (es) { self.visible = es[es.length - 1].isIntersecting; }).observe(el);
    this.controls();
  }
  Stage.prototype.fit = function () {
    var r = this.el.getBoundingClientRect();
    if (!r.width) return;
    this.w = r.width; this.h = r.height;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.view = this.o.views[r.width < 560 ? 'narrow' : 'wide'];
    this.camera.fov = this.view.fov; this.camera.updateProjectionMatrix();
  };
  /* A point on (or above) the felt, from table units. */
  Stage.prototype.map = function (x, y, h, out) {
    var p = this.mapXY(x, y);
    return (out || new T.Vector3()).set(p[0], h || 0, p[1]);
  };
  Stage.prototype.toPoint = function (p) {      // {x, y, h} in table units, or a Vector3 already in the room
    if (!p) return null;
    return p.isVector3 ? p : this.map(p.x, p.y, p.h || 0);
  };
  /* Drag to walk around the table; double-click (or Home) to come back. */
  Stage.prototype.controls = function () {
    var self = this, c = this.canvas, orb = this.orbit;
    c.setAttribute('tabindex', '0');
    c.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      orb.drag = { x: e.clientX, y: e.clientY, t: now(), id: e.pointerId }; orb.vYaw = 0;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* released already */ }
    });
    c.addEventListener('pointermove', function (e) {
      var d = orb.drag;
      if (!d || e.pointerId !== d.id) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y, dt = Math.max(1, now() - d.t);
      orb.yaw = Math.max(-1.1, Math.min(1.1, orb.yaw - dx * 0.006)); orb.pitch = Math.max(-0.25, Math.min(0.45, orb.pitch + dy * 0.004));
      orb.vYaw = -dx * 0.006 / dt; d.x = e.clientX; d.y = e.clientY; d.t = now();
    });
    function end(e) { if (orb.drag && e.pointerId === orb.drag.id) { if (now() - orb.drag.t > 80) orb.vYaw = 0; orb.drag = null; } }
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', function () { orb.yaw = orb.pitch = orb.vYaw = 0; });
    c.addEventListener('keydown', function (e) {
      var k = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, -0.06], ArrowDown: [0, 0.06] }[e.key];
      if (e.key === 'Home') { orb.yaw = orb.pitch = 0; e.preventDefault(); return; }
      if (!k) return;
      orb.yaw = Math.max(-1.1, Math.min(1.1, orb.yaw + k[0])); orb.pitch = Math.max(-0.25, Math.min(0.45, orb.pitch + k[1]));
      e.preventDefault();
    });
  };
  Stage.prototype.placeCamera = function (dt) {
    var orb = this.orbit, v = this.view;
    if (!orb.drag && Math.abs(orb.vYaw) > 1e-6) { orb.yaw = Math.max(-1.1, Math.min(1.1, orb.yaw + orb.vYaw * dt)); orb.vYaw *= 0.9; }
    var tgt = new T.Vector3().fromArray(v.target), off = new T.Vector3().fromArray(v.pos).sub(tgt);
    var r = off.length(), yaw = Math.atan2(off.x, off.z) + orb.yaw, pitch = Math.max(0.12, Math.min(1.35, Math.asin(off.y / r) + orb.pitch));
    this.camera.position.set(tgt.x + r * Math.cos(pitch) * Math.sin(yaw), tgt.y + r * Math.sin(pitch), tgt.z + r * Math.cos(pitch) * Math.cos(yaw));
    this.camera.lookAt(tgt);
  };
  /* Screen position (CSS pixels) of a point in the room. */
  Stage.prototype.project = function (v) {
    var p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.w, y: (1 - p.y) / 2 * this.h, behind: p.z > 1 };
  };
  Stage.prototype.render = function (t) {
    var dt = Math.min(64, t - (this.lastT || t)); this.lastT = t;
    if (!this.w) this.fit();
    if (!this.w || !this.visible) return;
    this.placeCamera(dt);
    for (var i = 0; i < this.tickers.length; i++) this.tickers[i](t, dt);
    this.renderer.render(this.scene, this.camera);
    for (i = 0; i < this.labels.length; i++) this.labels[i].place();
  };

  /* ---------- words over the room ---------- */
  /* A label pinned to a point: x, y (table units) and h (height), or follow: function -> Vector3. */
  function Label(stage, cls, parent) {
    this.stage = stage; this.el = document.createElement('div'); this.el.className = 'tag ' + (cls || '');
    (parent || stage.overlay).appendChild(this.el);
    this.x = 0; this.y = 0; this.h = 0; this.lift = 0; this.o = 1; this.s = 1; this.r = 0; this.dx = 0; this.dy = 0; this.follow = null; this.shown = true;
    stage.labels.push(this);
  }
  Label.prototype.text = function (s) { this.el.textContent = s; return this; };
  Label.prototype.draw = function () { this.el.style.opacity = this.shown ? this.o : 0; };
  Label.prototype.show = function (on) { this.shown = on; this.draw(); };
  Label.prototype.place = function () {
    var v = this.follow ? this.follow() : this.stage.map(this.x, this.y, this.h + this.lift), p = this.stage.project(v);
    this.el.style.transform = 'translate(' + (p.x + this.dx).toFixed(1) + 'px,' + (p.y + this.dy).toFixed(1) + 'px) translate(-50%,-50%) scale(' + this.s.toFixed(3) + ')';
    this.el.style.visibility = p.behind ? 'hidden' : '';
  };
  Label.prototype.remove = function () {
    var l = this.stage.labels, i = l.indexOf(this);
    if (i >= 0) l.splice(i, 1);
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  };

  /* A thought bubble near a head, with two dots trailing back to it. */
  function Bubble(stage) {
    this.stage = stage; this.head = null; this.side = 1;
    this.el = document.createElement('div'); this.el.className = 'think';
    this.dots = [0, 1].map(function (i) { var d = document.createElement('i'); d.className = 'think-dot d' + i; stage.overlay.appendChild(d); return d; });
    stage.overlay.appendChild(this.el);
    var self = this;
    stage.labels.push({ place: function () { self.place(); } });
    this.show(false);
  }
  Bubble.prototype.show = function (on) { this.on = on; this.el.classList.toggle('on', on); this.dots.forEach(function (d) { d.classList.toggle('on', on); }); };
  Bubble.prototype.place = function () {
    if (!this.on || !this.head) return;
    var st = this.stage, p = st.project(this.head()), w = this.el.offsetWidth, h = this.el.offsetHeight;
    var bx = Math.max(w / 2 + 6, Math.min(st.w - w / 2 - 6, p.x + this.side * (w / 2 + 34))), by = Math.max(h / 2 + 6, p.y - 70 - h / 2);
    this.el.style.transform = 'translate(' + bx.toFixed(1) + 'px,' + by.toFixed(1) + 'px) translate(-50%,-50%)';
    var tx = bx - this.side * w * 0.2, ty = by + h / 2;
    [[0.45, 9], [0.75, 6]].forEach(function (k, i) {
      var x = tx + (p.x - tx) * k[0], y = ty + (p.y - ty) * k[0];
      this.dots[i].style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
    }, this);
  };

  /* Puffs of smell drifting from a card to a head, drawn over the room. */
  function Trail(stage) {
    var NS = 'http://www.w3.org/2000/svg', self = this;
    this.stage = stage; this.from = null; this.to = null; this.g = document.createElementNS(NS, 'g'); this.g.setAttribute('class', 'wisps');
    stage.svg.appendChild(this.g);
    this.paths = [0, 1, 2].map(function () { var p = document.createElementNS(NS, 'path'); self.g.appendChild(p); return p; });
    stage.labels.push({ place: function () { self.place(); } });
  }
  Trail.prototype.show = function (color, from, to) {
    this.g.classList.toggle('on', !!color);
    if (!color) return;
    this.from = from; this.to = to;
    this.paths.forEach(function (p) { p.style.stroke = color; });
  };
  Trail.prototype.place = function () {
    if (!this.from || !this.g.classList.contains('on')) return;
    var a = this.stage.project(this.from()), b = this.stage.project(this.to());
    this.paths.forEach(function (p, i) {
      var ox = (i - 1) * 9, oy = (i - 1) * 6, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      p.setAttribute('d', 'M' + (a.x + ox).toFixed(1) + ' ' + (a.y + oy).toFixed(1) + 'C' + (mx - 18 + ox).toFixed(1) + ' ' + (my - 30).toFixed(1) + ' ' + (mx + 18).toFixed(1) + ' ' + (my + 24 + oy).toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + (b.y + oy / 2).toFixed(1));
    });
  };

  /* ---------- things that move ---------- */
  /* Anything on the table: x, y in table units, h above the felt, turned by r (degrees), sized by
     s, faded by o; lift raises it on its way through the air; turn flips a card (0 down, 1 up). */
  function Piece(stage, obj) {
    this.stage = stage; this.obj = obj; this.x = 0; this.y = 0; this.h = 0; this.r = 0; this.s = 1; this.o = 1; this.lift = 0; this.turn = 1; this.fx = 1;
    this.mats = []; var mats = this.mats;
    obj.traverse(function (n) { if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(function (m) { if (mats.indexOf(m) < 0) mats.push(m); }); });
    (stage.pieces || stage.table).add(obj);
  }
  Piece.prototype.draw = function () {
    var st = this.stage, o = this.obj;
    st.map(this.x, this.y, this.h + this.lift, o.position);
    o.rotation.y = -this.r * Math.PI / 180;
    o.scale.setScalar(Math.max(0.001, this.s));
    if (this.flipper) {     // a card turning over about its long side, rising so it clears the felt
      this.flipper.rotation.z = Math.PI * (1 - this.turn);
      this.flipper.position.y = 0.6 + 30 * Math.sin(Math.PI * this.turn);
    }
    var op = Math.max(0, Math.min(1, this.o));
    this.mats.forEach(function (m) { var b = m.userData.base || 1; m.opacity = op * b; m.transparent = op < 0.999 || b < 1; });
    o.visible = op > 0.01;
  };
  Piece.prototype.remove = function () {
    if (this.obj.parent) this.obj.parent.remove(this.obj);
    if (this.own) this.mats.forEach(function (m) { m.dispose(); });
  };

  /* ---------- cards ---------- */
  var faces = {}, backTex = null, CARD_W = 64, CARD_H = 90;
  function drawFace(c, card) {
    var g = c.getContext('2d'), col = card.suit === 'h' || card.suit === 'd' ? RED : INK, W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#fbfaf5'; roundRect(g, 2, 2, W - 4, H - 4, 22); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 64px ' + FONT; g.fillText(card.face, 40, 52);
    g.font = '44px Arial, sans-serif'; g.fillText(PIPS[card.suit], 40, 104);
    g.font = '150px Arial, sans-serif'; g.fillText(PIPS[card.suit], W / 2 + 6, H / 2 + 24);
    g.save(); g.translate(W - 40, H - 52); g.rotate(Math.PI); g.font = '700 64px ' + FONT; g.fillText(card.face, 0, 0); g.restore();
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function faceTexture(card) {
    var key = card.face + card.suit;
    if (faces[key]) return faces[key].tex;
    var c = canvas(256, 360); drawFace(c, card);
    faces[key] = { c: c, card: card, tex: texture(c) };
    return faces[key].tex;
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () {   // redraw faces once the fonts arrive
    Object.keys(faces).forEach(function (k) { drawFace(faces[k].c, faces[k].card); faces[k].tex.needsUpdate = true; });
  });
  function backTexture() {
    if (backTex) return backTex;
    var c = canvas(256, 360), g = c.getContext('2d');
    g.fillStyle = '#f4f1e8'; roundRect(g, 2, 2, 252, 356, 22); g.fill();
    g.save(); roundRect(g, 18, 18, 220, 324, 14); g.clip();
    g.fillStyle = '#7a1d2a'; g.fillRect(0, 0, 256, 360);
    g.strokeStyle = '#97303e'; g.lineWidth = 12;
    for (var i = -400; i < 600; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 360, 360); g.stroke(); }
    g.restore();
    g.strokeStyle = 'rgba(244,241,232,0.6)'; g.lineWidth = 6; g.beginPath(); g.ellipse(128, 180, 48, 68, 0, 0, 6.2832); g.stroke();
    return (backTex = texture(c));
  }
  var CARD_GEO = new T.BoxGeometry(CARD_W, 0.8, CARD_H);
  function card(stage, c) {
    var edge = std('#efeadc', { rough: 0.7 });
    var mats = [edge, edge, std('#ffffff', { rough: 0.45, map: faceTexture(c) }), std('#ffffff', { rough: 0.5, map: backTexture() }), edge, edge];
    var obj = new T.Group(), flipper = new T.Group(); obj.add(flipper);
    mesh(CARD_GEO, mats, flipper);
    var p = new Piece(stage, obj); p.flipper = flipper; p.card = c; p.up = false; p.turn = 0; p.own = true;
    return p;
  }
  function setFace(p, up) { p.up = up; p.turn = up ? 1 : 0; p.draw(); }
  function flip(tl, p, up) {
    p.up = up;
    if (tl.instant()) { p.turn = up ? 1 : 0; p.draw(); return; }
    tl.move(p, { turn: up ? 1 : 0 }, 300, 0, { ease: K.easeInOut });
  }

  /* ---------- chips ---------- */
  var chipTex = {};
  function chipMaterials(color) {
    if (chipTex[color]) return chipTex[color];
    var c = CHIPS[color] || CHIPS.red, top = canvas(128, 128), g = top.getContext('2d');
    g.fillStyle = c[0]; g.beginPath(); g.arc(64, 64, 64, 0, 6.2832); g.fill();
    g.strokeStyle = '#fbfaf5'; g.lineWidth = 12; g.setLineDash([16, 24]); g.beginPath(); g.arc(64, 64, 56, 0, 6.2832); g.stroke();
    g.setLineDash([]); g.lineWidth = 3; g.strokeStyle = 'rgba(251,250,245,0.6)'; g.beginPath(); g.arc(64, 64, 34, 0, 6.2832); g.stroke();
    var side = canvas(128, 16), s = side.getContext('2d');
    s.fillStyle = c[0]; s.fillRect(0, 0, 128, 16); s.fillStyle = '#fbfaf5';
    for (var i = 0; i < 8; i++) s.fillRect(i * 16 + 4, 0, 7, 16);
    var faceM = std('#ffffff', { rough: 0.4, map: texture(top) });
    return (chipTex[color] = [std('#ffffff', { rough: 0.45, map: texture(side) }), faceM, faceM]);
  }
  var CHIP_GEO = new T.CylinderGeometry(17, 17, 5, 32), CHIP_STEP = 5.2;
  function chipStack(colors) {
    var g = new T.Group();
    colors.forEach(function (col, i) {
      var m = mesh(CHIP_GEO, chipMaterials(col).map(function (x) { return x.clone(); }), g);
      m.position.set((i % 2) * 0.8 - 0.4, 2.5 + i * CHIP_STEP, 0); m.rotation.y = i * 0.7;
    });
    return g;
  }
  function chip(stage, color) { var p = new Piece(stage, chipStack([color || 'red'])); p.own = true; return p; }
  /* A stack of chips worth `amount`: one chip per two units, at most `max`. */
  function stack(stage, amount, max) {
    var n = Math.max(1, Math.min(max || 8, Math.ceil(amount / 2))), colors = ['red', 'blue', 'green', 'black'], list = [];
    for (var i = 0; i < n; i++) list.push(colors[Math.floor(i / 2) % 4]);
    var p = new Piece(stage, chipStack(list)); p.own = true;
    return p;
  }

  /* ---------- sparkle and ripples ---------- */
  var starTex = null;
  function star() {
    if (starTex) return starTex;
    var c = canvas(64, 64), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.translate(32, 32); g.beginPath();
    for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4, r = i % 2 ? 7 : 30; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
    return (starTex = texture(c));
  }
  /* n stars bursting from point p (Vector3) */
  function sparkle(stage, tl, n, p, spread, colors, delay) {
    if (tl.instant()) return;
    for (var i = 0; i < n; i++) {
      var s = new T.Sprite(new T.SpriteMaterial({ map: star(), color: colors[i % colors.length], blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.set(16, 16, 1);
      var g = new T.Group(); g.add(s);
      var pc = new Piece(stage, g), a = Math.PI * 2 * i / n + Math.random() * 0.5, d = spread * (0.6 + Math.random() * 0.6);
      pc.follow = p; pc.draw = sparkDraw; pc.dx = 0; pc.dy = 0; pc.dz = 0; pc.o = 0; pc.s = 0.4; pc.draw();
      (function (pc, dl) { tl.later(dl, function () { pc.o = 1; pc.draw(); }); })(pc, delay + i * 18);
      tl.move(pc, { dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.8 + 20, dz: (Math.random() - 0.5) * d * 0.6, s: 0.7 + Math.random() * 0.8 }, 650, delay + i * 18);
      tl.move(pc, { o: 0 }, 900, delay + i * 18, { ease: easeIn, done: pc.remove.bind(pc) });
    }
  }
  function sparkDraw() {
    this.obj.position.copy(this.follow).add(new T.Vector3(this.dx, this.dy, this.dz));
    this.obj.scale.setScalar(this.s);
    var op = Math.max(0, this.o); this.mats.forEach(function (m) { m.opacity = op; });
  }
  var RING_GEO = new T.RingGeometry(8, 10.5, 40).rotateX(-Math.PI / 2);
  function ripple(stage, tl, x, y, delay) {
    if (tl.instant()) return;
    var g = new T.Group(), m = new T.Mesh(RING_GEO, new T.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
    g.add(m); m.position.y = 0.8;
    var pc = new Piece(stage, g); pc.x = x; pc.y = y; pc.s = 0.5; pc.o = 0; pc.draw();
    tl.later(delay, function () { pc.o = 0.9; pc.draw(); });
    tl.move(pc, { s: 3, o: 0 }, 480, delay, { done: pc.remove.bind(pc) });
  }

  /* ---------- the dealer ---------- */
  /* stage, tl, o: {z: where the dealer stands, restL, restR: hands at rest (table units)} */
  function Dealer(stage, tl, o) {
    this.stage = stage; this.tl = tl; this.o = o;
    var g = this.g = new T.Group(); g.position.set(0, 0, o.z); stage.scene.add(g);
    var skin = std('#e6b68e', { rough: 0.7 }), shirt = std('#f2ede2', { rough: 0.8 }), vest = std('#1d1a20', { rough: 0.55 }), dark = std('#2b1d16', { rough: 0.8 });
    var torso = this.torso = new T.Group(); g.add(torso);
    var body = mesh(new T.CylinderGeometry(64, 54, 260, 32), shirt, torso); body.position.y = 30;
    var v = mesh(new T.CylinderGeometry(66.5, 56.5, 230, 32, 1, true, 0.42, Math.PI * 2 - 0.84), vest, torso); v.position.y = 18; v.material.side = T.DoubleSide;
    var sh = mesh(SPHERE, shirt, torso); sh.position.set(0, 158, 0); sh.scale.set(72, 26, 46);
    [-1, 1].forEach(function (s) { var b = mesh(SPHERE, std('#d6b25e', { rough: 0.3, metal: 0.6 }), torso); b.position.set(0, 60 - (s + 1) * 14, 62); b.scale.setScalar(3); });
    var neck = mesh(CYL, skin, torso); neck.position.set(0, 180, 0); neck.scale.set(15, 30, 15);
    [-1, 1].forEach(function (s) { var t = mesh(new T.ConeGeometry(11, 22, 12), std('#b3202a', { rough: 0.5 }), torso); t.position.set(s * 11, 168, 44); t.rotation.z = s * Math.PI / 2; });
    var knot = mesh(SPHERE, std('#8e1820', { rough: 0.5 }), torso); knot.position.set(0, 168, 46); knot.scale.setScalar(6);
    var head = this.head = new T.Group(); head.position.set(0, 228, 4); torso.add(head);
    var hd = mesh(SPHERE, skin, head); hd.scale.set(36, 42, 36);
    var hair = mesh(SPHERE, dark, head); hair.position.set(0, 12, -6); hair.scale.set(37.5, 37, 36);
    [-1, 1].forEach(function (s) { var e = mesh(SPHERE, skin, head); e.position.set(s * 36, 0, -2); e.scale.set(6, 10, 7); });
    var nose = mesh(SPHERE, std('#d99c74', { rough: 0.7 }), head); nose.position.set(0, -4, 36); nose.scale.set(6, 8, 7);
    this.eyes = [-1, 1].map(function (s) {
      var eg = new T.Group(); eg.position.set(s * 13, 6, 31); head.add(eg);
      var w = mesh(SPHERE, std('#ffffff', { rough: 0.3 }), eg, false); w.scale.set(7, 8, 5);
      var p = mesh(SPHERE, std('#1a1410', { rough: 0.2 }), eg, false); p.scale.set(3.6, 3.6, 2.5); p.position.z = 4;
      return { g: eg, pupil: p };
    });
    this.brows = [-1, 1].map(function (s) { var b = mesh(new T.BoxGeometry(14, 3, 3), dark, head, false); b.position.set(s * 13, 17, 34); b.rotation.z = -s * 0.15; return b; });
    [-1, 1].forEach(function (s) { var m = mesh(SPHERE, dark, head, false); m.position.set(s * 9, -14, 34); m.scale.set(10, 3.6, 4); m.rotation.z = s * 0.25; });
    var lipM = std('#8e3b30', { rough: 0.6 });
    this.mouths = {
      neutral: mesh(new T.TorusGeometry(7, 1.6, 6, 16, Math.PI * 0.5), lipM, head, false),
      smile: mesh(new T.TorusGeometry(9, 2, 6, 16, Math.PI * 0.8), lipM, head, false),
      surprised: mesh(new T.TorusGeometry(4.5, 1.8, 8, 18), lipM, head, false)
    };
    this.mouths.neutral.position.set(0, -14, 35); this.mouths.neutral.rotation.z = Math.PI * 1.25;
    this.mouths.smile.position.set(0, -18, 34); this.mouths.smile.rotation.z = Math.PI * 1.1;
    this.mouths.surprised.position.set(0, -23, 34);
    var visorM = std('#2aa36a', { rough: 0.4, opacity: 0.85, side: T.DoubleSide }); visorM.userData.base = 0.85;
    var band = mesh(new T.CylinderGeometry(39, 39, 9, 32, 1, true, -1.9, 3.8), visorM, head); band.position.y = 24;
    var brim = mesh(new T.CircleGeometry(38, 32, 0, Math.PI), visorM, head); brim.rotation.x = -Math.PI / 2 + 0.35; brim.position.set(0, 21, 14); brim.scale.set(1, 0.9, 1);
    // arms: shoulder, elbow, hand, each hand reaching for a point on the table
    this.arms = [-1, 1].map(function (s) {
      var a = { side: s, upper: mesh(CYL, shirt, torso), fore: mesh(CYL, shirt, torso), elbow: mesh(SPHERE, shirt, torso), hand: mesh(SPHERE, skin, torso) };
      a.hand.scale.set(13, 10, 15); a.elbow.scale.setScalar(13);
      return a;
    });
    this.handL = new K.Point(o.restL); this.handR = new K.Point(o.restR);
    this.lookAt = null; this.lookUntil = 0; this.moodName = 'neutral'; this.moodUntil = 0;
  }
  Dealer.prototype.flick = function (from) {
    var h = this.handR, tl = this.tl, rest = this.o.restR;
    tl.move(h, { x: from.x + 4, y: from.y + 6 }, 90, 0, { done: function () { tl.move(h, { x: rest.x, y: rest.y }, 160, 0); } });
  };
  Dealer.prototype.reach = function (left, target, delay) {
    var h = left ? this.handL : this.handR, back = left ? this.o.restL : this.o.restR, tl = this.tl;
    tl.move(h, { x: target.x, y: target.y + 8 }, 200, delay, { done: function () { tl.move(h, { x: back.x, y: back.y }, 300, 120); } });
  };
  Dealer.prototype.look = function (p, ms) { this.lookAt = p; this.lookUntil = now() + ms; };
  Dealer.prototype.mood = function (m, ms) { this.moodName = m; this.moodUntil = now() + ms; };
  Dealer.prototype.reset = function () { this.handL = new K.Point(this.o.restL); this.handR = new K.Point(this.o.restR); };
  Dealer.prototype.pose = function (t, idleLook, reduce) {
    var st = this.stage, self = this;
    var targets = [this.handL, this.handR].map(function (h) { return st.map(h.x, h.y, 8); });
    // lean over the table when a hand has far to go
    var far = 0;
    targets.forEach(function (p) { far = Math.max(far, Math.hypot(p.x, p.z - self.o.z)); });
    this.torso.rotation.x = Math.min(0.45, Math.max(0, (far - 130) / 380));
    this.g.updateMatrixWorld(true);
    this.arms.forEach(function (a, i) {
      var sh = new T.Vector3(a.side * 66, 150, 6), local = self.torso.worldToLocal(targets[i].clone());
      var j = joint(sh, local, 108, 104, new T.Vector3(a.side * 0.8, -0.7, -0.5));
      rod(a.upper, sh, j.mid, 13); rod(a.fore, j.mid, j.end, 12);
      a.elbow.position.copy(j.mid); a.hand.position.copy(j.end);
    });
    var tp = st.toPoint(t < this.lookUntil && this.lookAt ? this.lookAt : idleLook);
    if (tp) {
      var hw = this.head.getWorldPosition(new T.Vector3()), d = tp.clone().sub(hw);
      this.head.rotation.y = Math.max(-0.6, Math.min(0.6, Math.atan2(d.x, d.z) * 0.6));
      this.head.rotation.x = Math.max(-0.1, Math.min(0.4, -Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.5 - this.torso.rotation.x * 0.5));
      this.eyes.forEach(function (e) {
        var lp = e.g.worldToLocal(tp.clone()).normalize();
        e.pupil.position.set(lp.x * 3, lp.y * 3, 4);
      });
    }
    var blink = !reduce && t % 4300 < 120;
    this.eyes.forEach(function (e) { e.g.scale.y = blink ? 0.12 : 1; });
    var m = t < this.moodUntil ? this.moodName : 'neutral';
    for (var k in this.mouths) this.mouths[k].visible = k === m;
    this.brows.forEach(function (b) { b.position.y = m === 'surprised' ? 21 : m === 'smile' ? 16 : 17; });
  };

  /* ---------- the room ---------- */
  function panelTexture() {
    var c = canvas(512, 512), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#19161a'); gr.addColorStop(1, '#0b0a0c');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(232,194,122,0.2)'; g.lineWidth = 4;
    for (var x = 32; x < 512; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
    for (x = 96; x < 512; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
    return texture(c, [6, 1]);
  }
  function carpetTexture() {
    var c = canvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#0b0a0b'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(232,194,122,0.11)'; g.lineWidth = 3;
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      g.beginPath(); g.moveTo(i * 64 + 32, j * 64 + 8); g.lineTo(i * 64 + 56, j * 64 + 32); g.lineTo(i * 64 + 32, j * 64 + 56); g.lineTo(i * 64 + 8, j * 64 + 32); g.closePath(); g.stroke();
    }
    return texture(c, [14, 14]);
  }
  function neonTexture(str, fill, glow, size) {
    var c = canvas(1024, 256), g = c.getContext('2d');
    g.font = '700 ' + (size || 150) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = glow; g.shadowBlur = 40; g.lineWidth = 6; g.strokeStyle = glow; g.fillStyle = fill;
    for (var i = 0; i < 3; i++) { g.strokeText(str, 512, 128); }
    g.shadowBlur = 12; g.fillText(str, 512, 128);
    return { c: c, tex: texture(c) };
  }
  /* The room around the table: o {wallZ, neon: [{text, fill, glow, x, y, w, size}], lamp: {x, y, z, aim: [x,y,z]}} */
  function buildRoom(stage, o) {
    var S = stage.scene, wallM = std('#ffffff', { rough: 0.85, map: panelTexture() });
    var wall = mesh(new T.PlaneGeometry(4200, 1500), wallM, S); wall.position.set(0, 560, o.wallZ); wall.receiveShadow = true; wall.castShadow = false;
    var dado = mesh(new T.BoxGeometry(4200, 30, 16), std('#b8924a', { rough: 0.3, metal: 0.8 }), S); dado.position.set(0, 220, o.wallZ + 8);
    var lower = mesh(new T.PlaneGeometry(4200, 400), std('#060506', { rough: 0.9 }), S); lower.position.set(0, 20, o.wallZ + 2);
    var floor = mesh(new T.PlaneGeometry(5000, 5000), std('#ffffff', { rough: 0.95, map: carpetTexture() }), S); floor.rotation.x = -Math.PI / 2; floor.position.y = -190; floor.castShadow = false;
    [-1, 1].forEach(function (s) {
      var side = mesh(new T.PlaneGeometry(3000, 1500), wallM, S); side.rotation.y = -s * Math.PI / 2; side.position.set(s * 1500, 560, o.wallZ + 1500);
    });
    // neon signs: glowing letters on the wall, with a soft light spilling from each
    stage.neon = (o.neon || []).map(function (n) {
      var nt = neonTexture(n.text, n.fill, n.glow, n.size), m = new T.MeshBasicMaterial({ map: nt.tex, transparent: true, depthWrite: false, toneMapped: false });
      var p = new T.Mesh(new T.PlaneGeometry(n.w, n.w / 4), m); p.position.set(n.x, n.y, o.wallZ + 4); S.add(p);
      var l = new T.PointLight(n.glow, 0.55, 700); l.position.set(n.x, n.y, o.wallZ + 120); S.add(l);
      return { m: m, l: l, phase: n.phase || 0 };
    });
    // soft out-of-focus lights along the wall
    var seed = o.seed || 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var colors = ['#ffcf7a', '#ff8fb0', '#ffe0a8', '#9fd8ff'], bokeh = [];
    for (var i = 0; i < 22; i++) {
      var b = glowSprite(colors[i % 4], 40 + rnd() * 90, 0.25); b.position.set(-1500 + rnd() * 3000, 280 + rnd() * 700, o.wallZ + 30); S.add(b);
      bokeh.push({ s: b, speed: 4 + rnd() * 6, phase: rnd() * 8 });
    }
    // the lamp over the table
    var L = o.lamp, lampG = new T.Group(); lampG.position.set(L.x, L.y, L.z); S.add(lampG);
    var cord = mesh(CYL, std('#111', { rough: 0.5 }), lampG, false); cord.scale.set(1.5, 900, 1.5); cord.position.y = 470;
    var shadeM = std('#141414', { rough: 0.3, metal: 0.4, side: T.DoubleSide });
    var shade = mesh(new T.CylinderGeometry(34, 78, 50, 32, 1, true), shadeM, lampG, false); shade.position.y = 6;
    var rim = mesh(new T.TorusGeometry(78, 2.5, 8, 40), std('#d6b25e', { rough: 0.3, metal: 0.8 }), lampG, false); rim.rotation.x = Math.PI / 2; rim.position.y = -19;
    var bulb = mesh(SPHERE, new T.MeshBasicMaterial({ color: '#fff6dc', toneMapped: false }), lampG, false); bulb.scale.setScalar(16); bulb.position.y = -12;
    var halo = glowSprite('#fff1c4', 220, 0.55); halo.position.y = -20; lampG.add(halo);
    var spot = new T.SpotLight('#fff1d6', 1.05, 0, 0.78, 0.6); spot.position.set(L.x, L.y - 18, L.z);
    spot.target.position.fromArray(L.aim); S.add(spot.target);
    spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.camera.near = 80; spot.shadow.camera.far = 1600; spot.shadow.bias = -0.0004; spot.shadow.radius = 4;
    S.add(spot);
    var coneM = new T.MeshBasicMaterial({ color: '#ffe9b0', transparent: true, opacity: 0.03, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide });
    var hgt = L.y - 30, cone = new T.Mesh(new T.ConeGeometry(Math.tan(0.6) * hgt, hgt, 40, 1, true), coneM);
    cone.position.set(L.x, L.y - 20 - hgt / 2, L.z); S.add(cone);
    S.add(new T.HemisphereLight('#ffeedd', '#111111', 0.5));
    var fill = new T.DirectionalLight('#ffd9c0', 0.38); fill.position.set(-600, 700, 900); S.add(fill);
    var back = new T.DirectionalLight('#9fc4ff', 0.22); back.position.set(500, 400, -800); S.add(back);
    stage.tickers.push(function (t) {
      stage.neon.forEach(function (n) {           // the neon flickers now and then
        var k = ((t / 1000 + n.phase) % 9) / 9, on = k > 0.18 && k < 0.2 ? 0.35 : k > 0.2 && k < 0.22 ? 0.8 : k > 0.62 && k < 0.63 ? 0.55 : 1;
        if (stage.reduce) on = 1;
        n.m.opacity = on; n.l.intensity = 0.55 * on;
      });
      if (!stage.reduce) bokeh.forEach(function (b) { b.s.material.opacity = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin((t / 1000 + b.phase) * 2 * Math.PI / b.speed)); });
    });
  }

  /* ---------- tables ---------- */
  /* A curve around an ellipse (rx, rz), from angle a0 to a1, at height y. */
  function ring(rx, rz, a0, a1, y) {
    var c = new T.Curve();
    c.getPoint = function (u, out) { var a = a0 + (a1 - a0) * u; return (out || new T.Vector3()).set(rx * Math.cos(a), y, rz * Math.sin(a)); };
    return c;
  }
  var woodM = null, railM = null;
  function woods() {
    if (woodM) return;
    var c = canvas(256, 64), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, '#26221f'); gr.addColorStop(1, '#0c0b0a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 64);
    g.strokeStyle = 'rgba(255,240,220,0.05)'; g.lineWidth = 2;
    for (var i = 0; i < 12; i++) { g.beginPath(); g.moveTo(0, 5 * i + 3); g.bezierCurveTo(80, 5 * i - 4, 170, 5 * i + 9, 256, 5 * i + 2); g.stroke(); }
    woodM = std('#ffffff', { rough: 0.25, map: texture(c, [8, 1]) });
    railM = std('#161417', { rough: 0.32, metal: 0.05 });
  }
  /* The felt is drawn on a canvas seen from above; draw(g, px) paints in table-plane units scaled by px. */
  function feltTexture(size, rx, rz, draw) {
    var c = canvas(2048, 2048), g = c.getContext('2d'), gr = g.createRadialGradient(1024, 1024, 100, 1024, 1024, 1100);
    gr.addColorStop(0, '#34383d'); gr.addColorStop(0.65, '#202326'); gr.addColorStop(1, '#101113');
    g.fillStyle = gr; g.fillRect(0, 0, 2048, 2048);
    g.globalAlpha = 0.05;                                   // a little cloth grain
    for (var i = 0; i < 9000; i++) { g.fillStyle = i % 2 ? '#000' : '#fff'; g.fillRect(Math.random() * 2048, Math.random() * 2048, 2, 2); }
    g.globalAlpha = 1;
    g.save(); g.translate(1024, 1024); g.scale(1024 / rx, 1024 / rz); draw(g); g.restore();
    return texture(c);
  }
  /* A blackjack table: a half circle of felt (radius R) with its straight side towards the dealer. */
  function blackjackTable(stage, R, draw) {
    woods();
    var g = stage.table;
    var felt = mesh(new T.CircleGeometry(R, 96, Math.PI, Math.PI).rotateX(-Math.PI / 2), std('#ffffff', { rough: 0.95, map: feltTexture(2048, R, R, draw) }), g);
    felt.castShadow = false;
    var rail = mesh(new T.TubeGeometry(ring(R + 14, R + 14, 0, Math.PI, 6), 96, 20, 16, false), railM, g);
    var back = mesh(new T.BoxGeometry(2 * R + 60, 18, 26), woodM, g); back.position.set(0, -2, -10);
    var body = mesh(new T.CylinderGeometry(R + 30, R - 10, 150, 64, 1, false, -Math.PI / 2, Math.PI), woodM, g); body.position.y = -84;
    var lip = mesh(new T.BoxGeometry(2 * R + 60, 150, 10), woodM, g); lip.position.set(0, -84, -20);
    [-1, 1].forEach(function (s) { var cap = mesh(SPHERE, railM, g); cap.position.set(s * (R + 14), 6, 0); cap.scale.setScalar(20); });
    return felt;
  }
  /* An oval poker table, rx by rz. */
  function pokerTable(stage, rx, rz, draw) {
    woods();
    var g = stage.table;
    var felt = mesh(new T.CircleGeometry(1, 128).rotateX(-Math.PI / 2), std('#ffffff', { rough: 0.95, map: feltTexture(2048, rx, rz, draw) }), g);
    felt.scale.set(rx, 1, rz); felt.castShadow = false;
    var rail = mesh(new T.TubeGeometry(ring(rx + 18, rz + 18, 0, Math.PI * 2, 6), 160, 22, 16, true), railM, g);
    var body = mesh(new T.CylinderGeometry(1, 0.94, 150, 64), woodM, g); body.scale.set(rx + 34, 1, rz + 34); body.position.y = -84;
    var foot = mesh(new T.CylinderGeometry(120, 160, 40, 32), woodM, g); foot.position.y = -170;
    return felt;
  }

  /* ---------- a chip tray, a card shoe, a wine glass and a snack ---------- */
  function chipTray(stage, x, z, rows) {
    var g = new T.Group(); g.position.set(x, 0, z); stage.table.add(g);
    var box = mesh(new T.BoxGeometry(rows.length * 26 + 14, 10, 40), woodM, g); box.position.y = 3;
    rows.forEach(function (col, i) {
      for (var k = 0; k < 7; k++) {
        var m = mesh(CHIP_GEO, chipMaterials(col), g); m.rotation.x = Math.PI / 2; m.scale.set(0.62, 1, 0.62);
        m.position.set(-rows.length * 13 + 13 + i * 26, 15, -15 + k * 5);
      }
    });
    return g;
  }
  function shoe(stage, x, z) {
    var g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = -0.35; stage.table.add(g);
    var b = mesh(new T.BoxGeometry(80, 44, 100), std('#161416', { rough: 0.3 }), g); b.position.y = 22;
    var top = mesh(new T.BoxGeometry(66, 2, 86), std('#f4f1e8', { rough: 0.6, map: backTexture() }), g); top.position.y = 45; top.rotation.x = 0.12;
    var lipM = mesh(new T.BoxGeometry(82, 8, 10), std('#d6b25e', { rough: 0.3, metal: 0.7 }), g); lipM.position.set(0, 10, 52);
    return g;
  }
  function wineGlass(stage, x, z) {
    var g = new T.Group(); g.position.set(x, 0, z); stage.table.add(g);
    var glass = new T.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.35, thickness: 2 });
    var pts = [[0, 0], [24, 0], [24, 2], [3, 6], [3, 60], [20, 74], [27, 100], [24, 126], [23, 127]].map(function (p) { return new T.Vector2(p[0], p[1]); });
    mesh(new T.LatheGeometry(pts, 32), glass, g, false);
    var wine = mesh(new T.LatheGeometry([[0, 66], [16, 70], [24, 88], [25, 98], [0, 98]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 32), std('#7a0d1e', { rough: 0.2, opacity: 0.92 }), g, false);
    wine.castShadow = true;
    return g;
  }
  function snack(stage, x, z) {
    var g = new T.Group(); g.position.set(x, 0, z); stage.table.add(g);
    var plate = mesh(new T.CylinderGeometry(52, 40, 6, 40), std('#f6f2e8', { rough: 0.3 }), g); plate.position.y = 3;
    var curve = new T.CatmullRomCurve3([new T.Vector3(-40, 12, 6), new T.Vector3(-14, 20, -8), new T.Vector3(16, 20, -8), new T.Vector3(40, 14, 8)]);
    var banana = mesh(new T.TubeGeometry(curve, 30, 9, 12, false), std('#f2cf3b', { rough: 0.5 }), g);
    [[-40, 12, 6], [40, 14, 8]].forEach(function (p) { var t = mesh(SPHERE, std('#4a3514', { rough: 0.7 }), g); t.position.fromArray(p); t.scale.setScalar(5); });
    return g;
  }
  /* A tiny gnat that circles over the table. */
  function gnat(stage, cx, cy, cz) {
    var g = new T.Group(); stage.scene.add(g);
    var b = mesh(SPHERE, std('#2a1a0c', { rough: 0.5 }), g); b.scale.set(4, 3, 3);
    [-1, 1].forEach(function (s) { var w = mesh(SPHERE, std('#ffffff', { rough: 0.2, opacity: 0.6 }), g, false); w.scale.set(4, 1, 2); w.position.set(-1, 3, s * 3); });
    stage.tickers.push(function (t) {
      if (stage.reduce) t = 0;
      g.position.set(cx + 40 * Math.cos(t / 520), cy + 14 * Math.sin(t / 260) + 4 * Math.sin(t / 70), cz + 30 * Math.sin(t / 520));
      g.rotation.y = -t / 520;
    });
    return g;
  }

  root.Scene3D = {
    THREE: T, Stage: Stage, Label: Label, Bubble: Bubble, Trail: Trail, Piece: Piece, Dealer: Dealer,
    card: card, setFace: setFace, flip: flip, chip: chip, stack: stack, sparkle: sparkle, ripple: ripple, glowSprite: glowSprite,
    buildRoom: buildRoom, blackjackTable: blackjackTable, pokerTable: pokerTable, chipTray: chipTray, shoe: shoe, wineGlass: wineGlass, snack: snack, gnat: gnat,
    std: std, mesh: mesh, rod: rod, joint: joint, SPHERE: SPHERE, CYL: CYL, canvas: canvas, texture: texture, FONT: FONT, MONO: MONO
  };
})(self);
