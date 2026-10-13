/* FlyJack - the 3D model of the whole nervous system (drawn with three.js).

   Every neuron of the connectome that has a measured cell-body position is one small shaded sphere,
   in the mixed colours connectome pictures use to tell neighbouring neurons apart. The brain and
   the nerve cord are joined by one strand per descending or ascending neuron, running from its
   cell body to its strongest partner on the other side of the neck. The strands are connections,
   not the neurons' real shapes, which this project does not have.

   On top of that, the neurons of the learning circuit light up when they are active.

   The camera maths lives in the shaders and is repeated in web/app.js (project), so that pointing
   at a neuron finds the same spot the picture shows. */
(function (root) {
  'use strict';
  var T = root.THREE;

  // the colours of the reference picture: mostly blues and cyans, with orange, yellow, pink and violet
  var PALETTE = ['#2f7fd6', '#3b93e6', '#4aa7ee', '#5cc3f2', '#38c6d9', '#6f8cf0', '#2a6cc4', '#58b4f0',
    '#f39a2e', '#f6b340', '#f2d54a', '#ee6fb0', '#e488d8', '#c86bdc', '#8f6be0', '#3cc9a8', '#7fd48a', '#f0805a'];

  function bytes(b64) {
    var s = atob(b64), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  function hash(n) { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return ((n ^ (n >>> 15)) >>> 0) / 4294967296; }

  /* Connectome voxels (x across the head, y downwards, z towards the back) -> model space:
     centred on the whole nervous system, about -1..1, y up. */
  function Space(cloud) {
    var lo = cloud.lo, hi = cloud.hi;
    this.mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    this.half = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
  }
  Space.prototype.toModel = function (p) {
    return [(p[0] - this.mid[0]) / this.half, -(p[1] - this.mid[1]) / this.half, (p[2] - this.mid[2]) / this.half];
  };

  var PROJECT = [
    'uniform vec4 uRot; uniform vec3 uTarget; uniform float uDist; uniform float uScale; uniform vec2 uCentre; uniform vec2 uView; uniform float uDpr;',
    'vec3 place(vec3 p, out float k) {',
    '  p -= uTarget;',
    '  float x1 = p.x * uRot.x + p.z * uRot.y, z1 = -p.x * uRot.y + p.z * uRot.x;',
    '  float y2 = p.y * uRot.z - z1 * uRot.w, z2 = p.y * uRot.w + z1 * uRot.z;',
    '  k = uDist / (uDist + z2);',
    '  vec2 px = vec2(uCentre.x + x1 * k * uScale, uCentre.y - y2 * k * uScale);',
    '  return vec3(px.x / uView.x * 2.0 - 1.0, 1.0 - px.y / uView.y * 2.0, z2 * 0.25);',
    '}'].join('\n');

  var CELL_VERT = PROJECT + [
    'attribute vec3 aColor; attribute float aSize;',
    'varying vec3 vColor; varying float vFar;',
    'void main() {',
    '  float k; vec3 q = place(position, k);',
    '  gl_Position = vec4(q, 1.0);',
    '  gl_PointSize = max(1.6 * uDpr, aSize * k * uScale * uDpr);',
    '  vFar = clamp(q.z * 1.6 + 0.35, 0.0, 1.0);',
    '  vColor = aColor;',
    '}'].join('\n');
  var CELL_FRAG = [
    'varying vec3 vColor; varying float vFar; uniform float uFocus; uniform float uGhost; uniform vec3 uPaper;',
    'void main() {',
    '  vec2 d = gl_PointCoord * 2.0 - 1.0; float r2 = dot(d, d);',
    '  if (r2 > 1.0) discard;',
    '  vec3 n = vec3(d.x, -d.y, sqrt(1.0 - r2));',
    '  vec3 l = normalize(vec3(-0.5, 0.62, 0.6));',
    '  float diff = max(dot(n, l), 0.0);',
    '  float spec = pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0);',
    '  vec3 c = vColor * (0.68 + 0.46 * diff) + spec * 0.28;',
    '  c *= mix(0.66, 1.0, smoothstep(0.0, 0.55, n.z));',          // a darker rim sets each cell off from its neighbours
    '  c = mix(c, uPaper, vFar * 0.2);',                           // far cells pale towards the background
    '  c = mix(c, mix(uPaper, vec3(0.6, 0.63, 0.68), 0.14), uFocus);',
    '  float fade = dot(uPaper, vec3(0.333)) < 0.5 ? 0.45 : 0.64;',      // a dark panel swallows colour sooner, so fade less
    '  gl_FragColor = vec4(mix(c, uPaper, fade * uGhost), 1.0);',   // see-through: every cell fades most of the way into the background
    '}'].join('\n');

  var LINE_VERT = PROJECT + [
    'attribute vec3 aColor; varying vec3 vColor; uniform float uFocus;',
    'void main() { float k; vec3 q = place(position, k); gl_Position = vec4(q, 1.0);',
    '  vColor = mix(aColor, vec3(0.92, 0.93, 0.95), uFocus); }'].join('\n');
  var LINE_FRAG = 'varying vec3 vColor; uniform float uGhost; uniform vec3 uPaper; void main() { gl_FragColor = vec4(mix(vColor, uPaper, 0.7 * uGhost), 1.0); }';

  // active neurons of the learning circuit: a coloured ball with a dark edge and a white halo, always on top
  var ACT_VERT = PROJECT + [
    'attribute vec3 aColor; attribute float aSize; attribute float aAlpha;',
    'varying vec3 vColor; varying float vAlpha;',
    'void main() {',
    '  float k; vec3 q = place(position, k);',
    '  gl_Position = vec4(q.xy, -0.9, 1.0);',
    '  gl_PointSize = aAlpha > 0.01 ? max(5.0 * uDpr, aSize * k * uScale * uDpr) * 1.7 : 0.0;',
    '  vColor = aColor; vAlpha = aAlpha * mix(1.0, 0.55, clamp(q.z * 1.6 + 0.35, 0.0, 1.0));',
    '}'].join('\n');
  var ACT_FRAG = [
    'varying vec3 vColor; varying float vAlpha; uniform vec3 uPaper; uniform float uGhost;',
    'void main() {',
    '  vec2 d = gl_PointCoord * 2.0 - 1.0; float r = length(d) * 1.7;',
    '  if (r > 1.7 || vAlpha < 0.01) discard;',
    '  if (r > 1.0) { gl_FragColor = vec4(mix(uPaper, vColor, uGhost), vAlpha * mix(0.7, 0.42, uGhost) * (1.0 - smoothstep(1.0, 1.68, r))); return; }',
    '  vec3 n = vec3(d.x * 1.7, -d.y * 1.7, sqrt(max(0.0, 1.0 - r * r)));',
    '  vec3 l = normalize(vec3(-0.5, 0.62, 0.6));',
    '  vec3 c = vColor * (0.7 + 0.45 * max(dot(n, l), 0.0)) + pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 16.0) * 0.45;',
    '  vec3 rim = dot(uPaper, vec3(0.333)) < 0.5 ? vec3(1.0) : vec3(0.05, 0.07, 0.1);',          // the edge that sets a lit cell off: light on a dark panel
    '  c = mix(c, rim, 0.85 * smoothstep(0.78, 0.92, r));',
    '  gl_FragColor = vec4(c, vAlpha);',
    '}'].join('\n');

  /* cells: the learning circuit's neurons as [{x, y, z}] in model space, in the order the overlay is addressed. */
  function Model(canvas, cloud, cells) {
    var space = new Space(cloud), n = cloud.count, q = new Uint16Array(bytes(cloud.xyz).buffer);
    var lo = cloud.lo, hi = cloud.hi, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), i, c = new T.Color();
    for (i = 0; i < n; i++) {
      var p = space.toModel([lo[0] + q[3 * i] / 65535 * (hi[0] - lo[0]), lo[1] + q[3 * i + 1] / 65535 * (hi[1] - lo[1]), lo[2] + q[3 * i + 2] / 65535 * (hi[2] - lo[2])]);
      pos[3 * i] = p[0]; pos[3 * i + 1] = p[1]; pos[3 * i + 2] = p[2];
      c.set(PALETTE[Math.floor(hash(i * 2 + 1) * PALETTE.length)]);
      col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
      size[i] = 0.013 + 0.017 * Math.pow(hash(i * 2 + 2), 2.2);            // most cell bodies small, a few large
    }
    this.uniforms = {
      uRot: { value: new T.Vector4(1, 0, 1, 0) }, uTarget: { value: new T.Vector3() }, uDist: { value: 4.2 }, uScale: { value: 100 },
      uCentre: { value: new T.Vector2() }, uView: { value: new T.Vector2(1, 1) }, uDpr: { value: 1 }, uFocus: { value: 0 }, uGhost: { value: 0 }, uPaper: { value: new T.Color(0xffffff) }
    };
    this.renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0xffffff, 0);
    this.scene = new T.Scene(); this.camera = new T.Camera();

    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aColor', new T.BufferAttribute(col, 3)); g.setAttribute('aSize', new T.BufferAttribute(size, 1));
    var somas = this.somas = new T.Points(g, new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: CELL_VERT, fragmentShader: CELL_FRAG }));
    somas.frustumCulled = false; this.scene.add(somas);

    // strands across the neck: cell body -> into the bundle -> out of it -> the partner's cell body
    var pairs = new Uint32Array(bytes(cloud.tracts).buffer), a = space.toModel(cloud.neck.a), b = space.toModel(cloud.neck.b), rad = cloud.neck.radius / space.half;
    var STEPS = 14, lp = new Float32Array(pairs.length / 2 * STEPS * 6), lc = new Float32Array(lp.length), at = 0;
    function bez(p0, p1, p2, p3, t, o) { var u = 1 - t; for (var d = 0; d < 3; d++) o[d] = u * u * u * p0[d] + 3 * u * u * t * p1[d] + 3 * u * t * t * p2[d] + t * t * t * p3[d]; }
    for (i = 0; i < pairs.length; i += 2) {
      var s = pairs[i], e = pairs[i + 1], front = pos[3 * s + 2] < pos[3 * e + 2] ? s : e, back = front === s ? e : s;
      var ang = hash(i + 7) * 6.2832, rr = rad * Math.sqrt(hash(i + 11)), off = [Math.cos(ang) * rr, Math.sin(ang) * rr, 0];
      var p0 = [pos[3 * front], pos[3 * front + 1], pos[3 * front + 2]], p3 = [pos[3 * back], pos[3 * back + 1], pos[3 * back + 2]];
      var na = [a[0] + off[0], a[1] + off[1], a[2]], nb = [b[0] + off[0], b[1] + off[1], b[2]], prev = [0, 0, 0], cur = [0, 0, 0];
      // three joined curves: soma -> neck start, along the neck, neck end -> partner
      var legs = [[p0, [p0[0], p0[1], p0[2] + 0.12], [na[0], na[1], na[2] - 0.14], na], [na, [na[0], na[1], na[2] + 0.1], [nb[0], nb[1], nb[2] - 0.1], nb], [nb, [nb[0], nb[1], nb[2] + 0.14], [p3[0], p3[1], p3[2] - 0.12], p3]];
      var share = [5, 4, 5];
      c.set(PALETTE[Math.floor(hash(s * 2 + 1) * PALETTE.length)]);
      for (var leg = 0; leg < 3; leg++) for (var st = 0; st < share[leg]; st++) {
        bez(legs[leg][0], legs[leg][1], legs[leg][2], legs[leg][3], st / share[leg], prev);
        bez(legs[leg][0], legs[leg][1], legs[leg][2], legs[leg][3], (st + 1) / share[leg], cur);
        for (var d = 0; d < 3; d++) { lp[at + d] = prev[d]; lp[at + 3 + d] = cur[d]; }
        lc[at] = lc[at + 3] = c.r; lc[at + 1] = lc[at + 4] = c.g; lc[at + 2] = lc[at + 5] = c.b;
        at += 6;
      }
    }
    var lg = new T.BufferGeometry();
    lg.setAttribute('position', new T.BufferAttribute(lp, 3)); lg.setAttribute('aColor', new T.BufferAttribute(lc, 3));
    var strands = this.strands = new T.LineSegments(lg, new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG }));
    strands.frustumCulled = false; this.scene.add(strands);

    // the learning circuit's active neurons
    var m = cells.length, ap = new Float32Array(m * 3);
    for (i = 0; i < m; i++) { ap[3 * i] = cells[i].x; ap[3 * i + 1] = cells[i].y; ap[3 * i + 2] = cells[i].z; }
    this.actColor = new Float32Array(m * 3); this.actSize = new Float32Array(m); this.actAlpha = new Float32Array(m);
    var ag = this.actGeometry = new T.BufferGeometry();
    ag.setAttribute('position', new T.BufferAttribute(ap, 3)); ag.setAttribute('aColor', new T.BufferAttribute(this.actColor, 3));
    ag.setAttribute('aSize', new T.BufferAttribute(this.actSize, 1)); ag.setAttribute('aAlpha', new T.BufferAttribute(this.actAlpha, 1));
    var act = new T.Points(ag, new T.ShaderMaterial({ uniforms: this.uniforms, vertexShader: ACT_VERT, fragmentShader: ACT_FRAG, transparent: true, depthTest: false, depthWrite: false }));
    act.frustumCulled = false; act.renderOrder = 2; this.scene.add(act);
  }
  /* the model fades into whatever the panel behind the canvas is painted with */
  Model.prototype.setPaper = function (cssColor) { try { this.uniforms.uPaper.value.set(cssColor); } catch (e) { /* keep white */ } };
  Model.prototype.resize = function (w, h, dpr) {
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.uniforms.uView.value.set(w, h); this.uniforms.uDpr.value = dpr;
  };
  Model.prototype.clearActivity = function () { this.actAlpha.fill(0); };
  /* rgb: [r, g, b] 0..1; size in model units (the diameter of the ball); alpha 0..1 */
  Model.prototype.light = function (i, rgb, size, alpha) {
    this.actColor[3 * i] = rgb[0]; this.actColor[3 * i + 1] = rgb[1]; this.actColor[3 * i + 2] = rgb[2];
    this.actSize[i] = size; this.actAlpha[i] = alpha;
  };
  Model.prototype.commitActivity = function () {
    var a = this.actGeometry.attributes;
    a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  };
  /* cam: {yaw, pitch, dist, scale, cx, cy, tx, ty, tz}; focus 0..1 washes the background cells out;
     ghost 0..1 fades them towards the background, so the lit cells are the only solid things left */
  Model.prototype.render = function (cam, focus, ghost) {
    var u = this.uniforms;
    u.uRot.value.set(Math.cos(cam.yaw), Math.sin(cam.yaw), Math.cos(cam.pitch), Math.sin(cam.pitch));
    u.uTarget.value.set(cam.tx, cam.ty, cam.tz); u.uDist.value = cam.dist; u.uScale.value = cam.scale; u.uCentre.value.set(cam.cx, cam.cy);
    u.uFocus.value = focus || 0; u.uGhost.value = ghost || 0;
    this.renderer.render(this.scene, this.camera);
  };

  function rgb(hex) { var c = new T.Color(hex); return [c.r, c.g, c.b]; }
  root.Brain3D = {
    Space: Space, rgb: rgb,
    create: function (canvas, cloud, cells) { try { return new Model(canvas, cloud, cells); } catch (e) { return null; } }
  };
})(self);
