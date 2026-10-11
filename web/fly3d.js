/* FlyJack - the fly, modelled in 3D (three.js). The thorax, head and segmented abdomen are
   sculpted surfaces with their colours painted on (stripes, tergite bands), the compound eyes
   are domed facets, the wings are veined membranes, and each leg has a coxa, femur, tibia and
   two-part tarsus whose feet stay planted on the felt while the body moves. Every gesture is
   keyframed and blends smoothly out of the one before. The table places fly.group and calls
   act(state), glow(color, a, fade) and pose(t, busy) as it always has. */
(function (root) {
  'use strict';
  var T = root.THREE, K = root.SceneKit, S3 = root.Scene3D, clamp01 = K.clamp01, easeInOut = K.easeInOut, now = K.now;
  var std = S3.std, mesh = S3.mesh, rod = S3.rod, joint = S3.joint, SPHERE = S3.SPHERE;
  var uid = 0, TAU = Math.PI * 2;
  /* The whole scene is drawn low-poly, so the fly's surfaces are built with a fraction of their faces. */
  function few(n) { return Math.max(5, Math.round(n / 5)); }
  /* Fly coordinates: x towards the head, y up, z to one side; the feet stand on y = 0. */
  var PIVOT = new T.Vector3(0, 82, 0), NECK = new T.Vector3(40, 100, 0);
  var THORAX = new T.Vector3(6, 92, 0), HEAD = new T.Vector3(62, 104, 0);
  var WING_L = 150, WING_W = 54, BLEND = 260;

  var LOOKS = {
    'Canton-S': { body: '#8a5a2c', abdomen: '#a06a30', stripe: '#1e1008', head: '#7e5026', face: '#a8652a', eye: '#b0150e', leg: '#7a4e24' },
    'white': { eye: '#efe9dc' },
    'yellow': { body: '#c99a3a', abdomen: '#d4a845', stripe: '#7a5418', head: '#bf9036', face: '#d4a040', leg: '#b48a3a' },
    'ebony': { body: '#2a1c12', abdomen: '#2e1e12', stripe: '#0a0604', head: '#2a1c12', face: '#3e2816', leg: '#1e140c' },
    'Curly': { wingCurl: 1 }
  };

  /* ---------- small maths ---------- */
  function smooth(e0, e1, x) { var p = clamp01((x - e0) / (e1 - e0)); return p * p * (3 - 2 * p); }
  function bell(x) { return x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function hash(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  /* A value in [-1, 1] that holds still, then glides to a new one: how a fly looks around. */
  function wander(t, period, seed) {
    var k = t / period, i = Math.floor(k);
    return lerp(hash(i + seed) * 2 - 1, hash(i + 1 + seed) * 2 - 1, smooth(0.6, 1, k - i));
  }
  /* Keyframes [[ms, value], ...], eased between. */
  function kf(e, pts) {
    if (e <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) {
      if (e < pts[i][0]) { var a = pts[i - 1], b = pts[i]; return lerp(a[1], b[1], smooth(a[0], b[0], e)); }
    }
    return pts[pts.length - 1][1];
  }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function col(hex) { return new T.Color(hex); }

  /* ---------- geometry ---------- */
  /* Smooth normals across the seams of a deformed sphere or lathe. */
  function weld(geo) {
    geo.computeVertexNormals();
    var p = geo.attributes.position, n = geo.attributes.normal, groups = {}, i, key;
    for (i = 0; i < p.count; i++) {
      key = Math.round(p.getX(i) * 100) + ',' + Math.round(p.getY(i) * 100) + ',' + Math.round(p.getZ(i) * 100);
      (groups[key] || (groups[key] = [])).push(i);
    }
    for (key in groups) {
      var g = groups[key];
      if (g.length < 2) continue;
      var x = 0, y = 0, z = 0;
      g.forEach(function (j) { x += n.getX(j); y += n.getY(j); z += n.getZ(j); });
      var l = Math.sqrt(x * x + y * y + z * z) || 1;
      g.forEach(function (j) { n.setXYZ(j, x / l, y / l, z / l); });
    }
    n.needsUpdate = true;
    return geo;
  }
  /* A sphere with its poles along x, reshaped by shape(n) -> point and painted by paint(n, point) -> Color. */
  function sculpt(shape, paint, ws, hs) {
    var geo = new T.SphereGeometry(1, few(ws || 56), few(hs || 40)).rotateZ(-Math.PI / 2);
    var p = geo.attributes.position, n = new T.Vector3(), c = [], q;
    for (var i = 0; i < p.count; i++) {
      n.fromBufferAttribute(p, i).normalize();
      q = shape(n);
      var cc = paint(n, q); c.push(cc.r, cc.g, cc.b);
      p.setXYZ(i, q.x, q.y, q.z);
    }
    geo.setAttribute('color', new T.Float32BufferAttribute(c, 3));
    return weld(geo);
  }
  /* Many small pieces (bristles, the arista's branches) merged into one mesh. */
  function merge(parts) {
    var pos = [], nor = [], idx = [], base = 0, v = new T.Vector3(), nm = new T.Matrix3();
    parts.forEach(function (pt) {
      var P = pt.geo.attributes.position, N = pt.geo.attributes.normal, I = pt.geo.index, i;
      nm.getNormalMatrix(pt.m);
      for (i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(pt.m); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      }
      for (i = 0; i < I.count; i++) idx.push(base + I.getX(i));
      base += P.count;
    });
    var out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setIndex(idx);
    return out;
  }
  var CONE = new T.CylinderGeometry(0.1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  var TAPER = new T.CylinderGeometry(0.74, 1, 1, 5, 1);       // a leg segment, thinner at its far end
  var UP = new T.Vector3(0, 1, 0);
  /* A bristle from `a` along `dir`, bending by `curve` towards `bendTo` over its length. */
  function bristle(list, a, dir, len, r, bendTo, curve) {
    var d0 = dir.clone().normalize(), d1 = d0.clone().lerp(bendTo || d0, curve || 0).normalize();
    var mid = a.clone().addScaledVector(d0, len * 0.5);
    [[a, d0, r, len * 0.52], [mid, d1, r * 0.55, len * 0.5]].forEach(function (s) {
      var m = new T.Matrix4().compose(s[0], new T.Quaternion().setFromUnitVectors(UP, s[1]), new T.Vector3(s[2], s[3], s[2]));
      list.push({ geo: CONE, m: m });
    });
  }

  /* The thorax: an egg that narrows to the neck, humped on top, flatter underneath. */
  function thoraxPoint(n) {
    var front = Math.max(0, n.x), narrow = 1 - 0.3 * front * front * front;
    var y = 37 * n.y * narrow * (n.y < 0 ? 1 + 0.12 * n.y : 1) + (n.y > 0 ? 6 * n.y * n.y * (1 - 0.6 * n.x * n.x) : 0);
    return new T.Vector3(THORAX.x + 44 * n.x, THORAX.y + y, 34 * n.z * narrow);
  }
  /* The abdomen: a lathe along -x with a ridge between each of six segments, drooping at the tip. */
  var ABD_X = -12, ABD_LEN = 116, ABD_R = 40, ABD_Y = 82, SEGS = [0.2, 0.34, 0.47, 0.6, 0.72, 0.83, 0.93];
  function abdRadius(s) {
    var r = ABD_R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(s, 0.78))), 0.55);
    for (var k = 1; k < SEGS.length; k++) r *= 1 - 0.035 * Math.exp(-Math.pow((s - SEGS[k]) / 0.014, 2));
    return r;
  }

  var cache = {};
  function geometries(look) {
    var key = [look.body, look.abdomen, look.stripe, look.head, look.face].join();
    if (cache[key]) return cache[key];
    var body = col(look.body), stripe = col(look.stripe), abd = col(look.abdomen), head = col(look.head), face = col(look.face);
    var c = new T.Color();
    var thorax = sculpt(thoraxPoint, function (n) {
      c.copy(body);
      var top = smooth(0.15, 0.7, n.y);
      [-0.42, -0.16, 0.16, 0.42].forEach(function (z, i) {         // faint stripes down the back
        c.lerp(stripe, 0.16 * (i === 1 || i === 2 ? 1 : 0.7) * top * Math.exp(-Math.pow((n.z - z) / 0.07, 2)) * smooth(-0.8, 0.2, n.x));
      });
      c.lerp(stripe, 0.18 * smooth(0.4, 0.95, Math.abs(n.z)) * (1 - top));   // the sides are a little darker
      return c.clone().offsetHSL(0, 0, (hash(n.x * 91 + n.y * 37 + n.z * 13) - 0.5) * 0.02);
    });
    var scut = sculpt(function (n) { return new T.Vector3(16 * n.x, 8 * n.y * (n.y < 0 ? 0.4 : 1), 15 * n.z); },
      function () { return body.clone().lerp(stripe, 0.08); }, 28, 20);
    /* abdomen, built along +y and turned to run backwards along -x */
    var prof = [], N = 14, i;
    for (i = 0; i <= N; i++) { var s = i / N; prof.push(new T.Vector2(abdRadius(s), -s * ABD_LEN)); }
    var ag = new T.LatheGeometry(prof, few(56)), ap = ag.attributes.position, ac = [], v = new T.Vector3();
    for (i = 0; i < ap.count; i++) {
      v.fromBufferAttribute(ap, i);
      var sa = -v.y / ABD_LEN, ang = Math.atan2(v.x, v.z), up = -Math.sin(ang);   // up: 1 along the back, -1 underneath
      var r = Math.sqrt(v.x * v.x + v.z * v.z), ny = up, nz = Math.cos(ang);
      var Y = r * ny * (ny < 0 ? 0.8 : 0.94) - 10 * sa * sa, Z = r * nz;
      ap.setXYZ(i, ABD_X - sa * ABD_LEN, ABD_Y + Y, Z);
      // tergite bands: a dark band on the back half of each segment, the last two dark all over the top
      var k = 0; while (k < SEGS.length - 1 && sa > SEGS[k + 1]) k++;
      var q = (sa - SEGS[k]) / (SEGS[k + 1] - SEGS[k] || 1), back = smooth(-0.35, 0.35, up);
      var band = sa < SEGS[0] ? 0 : k >= 4 ? smooth(-0.55, 0.1, up) : smooth(0.5 + 0.3 * (1 - back), 0.6 + 0.3 * (1 - back), q) * back;
      c.copy(abd).lerp(stripe, 0.92 * band);
      if (q < 0.07 && sa > SEGS[0]) c.lerp(abd.clone().offsetHSL(0, -0.05, 0.07), 0.5 * back);   // pale joints between segments
      if (up < -0.35) c.lerp(abd.clone().offsetHSL(0, -0.1, 0.06), smooth(-0.35, -0.7, up));   // pale belly
      c.offsetHSL(0, 0, (hash(sa * 400 + ang * 9) - 0.5) * 0.02);
      ac.push(c.r, c.g, c.b);
    }
    ag.setAttribute('color', new T.Float32BufferAttribute(ac, 3));
    weld(ag);
    var hd = sculpt(function (n) {
      var x = 21 * n.x * (n.x < 0 ? 0.55 : 1), y = 30 * n.y, z = 33 * n.z * (1 - 0.12 * Math.max(0, n.y));
      return new T.Vector3(x, y, z);
    }, function (n) {
      c.copy(face).lerp(head, smooth(0.2, -0.4, n.x) * 0.8 + smooth(0.3, 0.9, n.y) * 0.4);
      return c.lerp(stripe, 0.25 * smooth(0.55, 0.95, n.y) * smooth(0.3, -0.3, n.x)).clone();   // the ocellar triangle
    }, 40, 30);
    var eye = new T.SphereGeometry(1, few(48), few(32)).rotateZ(-Math.PI / 2);
    return (cache[key] = { thorax: thorax, scut: scut, abdomen: ag, head: hd, eye: eye });
  }

  /* The wing: a veined membrane, narrow at the hinge, rounded at the tip. Curly wings curl up. */
  function wingWidth(u) { var q = (u - 0.53) / 0.47; return Math.sqrt(Math.max(0, 1 - q * q)) * (0.25 + 0.75 * smooth(0.06, 0.42, u)); }
  var wingGeos = {};
  function wingGeo(s, curl) {
    var key = s + ':' + curl;
    if (wingGeos[key]) return wingGeos[key];
    var NU = 56, NV = 12, pos = [], uv = [], idx = [], i, j;
    for (i = 0; i <= NU; i++) {
      var u = i / NU, E = wingWidth(u);
      for (j = 0; j <= NV; j++) {
        var v = j / NV * 2 - 1, w = (v > 0 ? 0.36 : 0.5) * v * E;
        pos.push(-u * WING_L, 2.5 * (1 - v * v) * E + curl * 64 * Math.pow(u, 2.4), s * w * WING_W);
        uv.push(u, (v + 1) / 2);
      }
    }
    for (i = 0; i < NU; i++) for (j = 0; j < NV; j++) { var a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return (wingGeos[key] = g);
  }
  /* The blur of a beating wing: a fan over the stroke, densest at the ends where the wing turns. */
  var fanGeos = {}, STROKE = [0.15, 1.75];
  function fanGeo(s) {
    if (fanGeos[s]) return fanGeos[s];
    var NA = 28, RINGS = [0, 0.2, 0.45, 0.7, 0.88, 1], pos = [], colr = [], idx = [], i, j;
    for (i = 0; i <= NA; i++) {
      var a = lerp(STROKE[0], STROKE[1], i / NA), edge = Math.pow(Math.abs(i / NA * 2 - 1), 5);
      for (j = 0; j < RINGS.length; j++) {
        var r = RINGS[j] * WING_L * 0.97;
        pos.push(-Math.cos(a) * r, 0, s * Math.sin(a) * r);
        colr.push(1, 1, 1, smooth(0.08, 0.55, RINGS[j]) * (RINGS[j] > 0.95 ? 0.5 : 1) * (0.45 + 0.55 * edge));
      }
    }
    for (i = 0; i < NA; i++) for (j = 0; j < RINGS.length - 1; j++) { var p = i * RINGS.length + j, q = p + RINGS.length; idx.push(p, q, p + 1, q, q + 1, p + 1); }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(colr, 4));
    g.setIndex(idx);
    return (fanGeos[s] = g);
  }

  /* ---------- textures ---------- */
  var tex = {};
  function dataTexture(c, repeat) {
    var t = new T.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    t.anisotropy = 4;
    return t;
  }
  /* Fine grain for the cuticle. */
  function grain() {
    if (tex.grain) return tex.grain;
    var c = S3.canvas(256, 256), g = c.getContext('2d'), small = S3.canvas(64, 64), sg = small.getContext('2d'), d = sg.createImageData(64, 64), i;
    for (i = 0; i < d.data.length; i += 4) { var v = 90 + Math.random() * 80; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    sg.putImageData(d, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(small, 0, 0, 256, 256);
    var fine = g.getImageData(0, 0, 256, 256);
    for (i = 0; i < fine.data.length; i += 4) { var f = (Math.random() - 0.5) * 50; fine.data[i] += f; fine.data[i + 1] += f; fine.data[i + 2] += f; }
    g.putImageData(fine, 0, 0);
    return (tex.grain = dataTexture(c, [3, 3]));
  }
  /* The compound eye: hundreds of little domes. */
  function facets() {
    if (tex.facets) return tex.facets;
    var W = 512, H = 256, cm = S3.canvas(W, H), gm = cm.getContext('2d'), cb = S3.canvas(W, H), gb = cb.getContext('2d');
    gm.fillStyle = '#ffffff'; gm.fillRect(0, 0, W, H);
    gb.fillStyle = '#202020'; gb.fillRect(0, 0, W, H);
    var dx = 7.3, dy = 6.4;
    for (var y = -1; y < H / dy + 1; y++) for (var x = -1; x < W / dx + 1; x++) {
      var cx = x * dx + (y % 2 ? dx / 2 : 0), cy = y * dy;
      var r = gb.createRadialGradient(cx - 0.8, cy - 0.8, 0, cx, cy, dx * 0.56);
      r.addColorStop(0, '#ffffff'); r.addColorStop(0.7, '#9a9a9a'); r.addColorStop(1, '#202020');
      gb.fillStyle = r; gb.beginPath(); gb.arc(cx, cy, dx * 0.56, 0, TAU); gb.fill();
      var m = gm.createRadialGradient(cx, cy, 0, cx, cy, dx * 0.6);
      m.addColorStop(0, '#ffffff'); m.addColorStop(0.75, '#f2e4e0'); m.addColorStop(1, '#6a4a44');
      gm.fillStyle = m; gm.beginPath(); gm.arc(cx, cy, dx * 0.6, 0, TAU); gm.fill();
    }
    return (tex.facets = { map: S3.texture(cm), bump: dataTexture(cb) });
  }
  /* The wing's veins and membrane: a colour map and an alpha map in the wing's own (u, v). */
  function wingTextures() {
    if (tex.wing) return tex.wing;
    var W = 512, H = 128, cm = S3.canvas(W, H), gm = cm.getContext('2d'), ca = S3.canvas(W, H), ga = ca.getContext('2d');
    var mem = gm.createLinearGradient(0, 0, W, 0);
    mem.addColorStop(0, '#c9c2b6'); mem.addColorStop(0.25, '#e4e8ec'); mem.addColorStop(1, '#eef2f6');
    gm.fillStyle = mem; gm.fillRect(0, 0, W, H);
    var al = ga.createLinearGradient(0, 0, W, 0);
    al.addColorStop(0, '#9a9a9a'); al.addColorStop(0.2, '#555555'); al.addColorStop(1, '#4a4a4a');
    ga.fillStyle = al; ga.fillRect(0, 0, W, H);
    function cy(v) { return (1 - v) * H / 2; }
    function vein(f, u0, u1, w0, w1) {
      for (var k = 0; k < 2; k++) {
        var g = k ? ga : gm; g.strokeStyle = k ? '#f4f4f4' : '#5b4128'; g.lineCap = 'round';
        for (var u = u0; u < u1; u += 0.01) {
          var p = (u - u0) / (u1 - u0);
          g.lineWidth = lerp(w0, w1, p);
          g.beginPath(); g.moveTo(u * W, cy(f(u))); g.lineTo(Math.min(u + 0.012, u1) * W, cy(f(Math.min(u + 0.012, u1)))); g.stroke();
        }
      }
    }
    vein(function () { return 0.95; }, 0.05, 0.64, 5, 3);                                        // costa
    vein(function (u) { return lerp(0.7, 0.95, smooth(0.05, 0.3, u)); }, 0.05, 0.3, 3, 2);         // L1
    vein(function (u) { return lerp(0.38, 0.95, smooth(0.12, 0.64, u)); }, 0.06, 0.64, 3.4, 2);     // L2
    vein(function (u) { return 0.12 + 0.18 * u; }, 0.06, 0.985, 3.4, 1.8);                         // L3
    vein(function (u) { return -0.14 - 0.1 * u; }, 0.06, 0.97, 3.4, 1.8);                          // L4
    vein(function (u) { return lerp(-0.42, -0.95, smooth(0.2, 0.82, u)); }, 0.06, 0.82, 3.2, 1.8); // L5
    vein(function (u) { return lerp(-0.66, -0.95, smooth(0.08, 0.32, u)); }, 0.06, 0.32, 2.6, 1.6); // L6
    [[0.41, 0.12 + 0.18 * 0.41, -0.14 - 0.1 * 0.41], [0.62, -0.14 - 0.1 * 0.62, lerp(-0.42, -0.95, smooth(0.2, 0.82, 0.62))]].forEach(function (x) {
      [gm, ga].forEach(function (g, k) {
        g.strokeStyle = k ? '#f4f4f4' : '#5b4128'; g.lineWidth = 2.6;
        g.beginPath(); g.moveTo(x[0] * W, cy(x[1])); g.lineTo(x[0] * W + 4, cy(x[2])); g.stroke();
      });
    });
    ga.fillStyle = '#9a9a9a'; ga.fillRect(0, 0, W, 2); ga.fillRect(0, H - 3, W, 3);              // the margin
    return (tex.wing = { map: S3.texture(cm), alpha: dataTexture(ca) });
  }

  /* ---------- the fly ---------- */
  /* o: {reduce, look (a strain name in LOOKS)}. nearSide: which side (-1 or 1) faces the camera, for gestures. */
  function Fly(o) {
    o = o || {};
    this.reduce = !!o.reduce; this.id = ++uid; this.seed = this.id * 7.31; this.nearSide = -1;
    var look = {}, k, base = LOOKS['Canton-S'], extra = LOOKS[o.look] || {};
    for (k in base) look[k] = base[k];
    for (k in extra) look[k] = extra[k];
    this.look = look;
    var G = geometries(look), grainTex = grain(), F = facets(), WT = wingTextures();
    var g = this.group = new T.Group();
    var pivot = this.pivot = new T.Group(); pivot.rotation.order = 'YZX'; g.add(pivot);
    var body = this.body = new T.Group(); body.position.copy(PIVOT).negate(); pivot.add(body);

    function cuticle(rough, coat, bump) {
      return new T.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: rough, clearcoat: coat, clearcoatRoughness: 0.42,
        bumpMap: grainTex, bumpScale: bump });
    }
    var M = {
      thorax: cuticle(0.62, 0.3, 0.35), abdomen: cuticle(0.42, 0.55, 0.25), head: cuticle(0.6, 0.25, 0.3),
      eye: new T.MeshPhysicalMaterial({ color: look.eye, map: F.map, bumpMap: F.bump, bumpScale: 0.9, roughness: 0.48, clearcoat: 0.6, clearcoatRoughness: 0.22,
        sheen: 0.35, sheenRoughness: 0.5, sheenColor: new T.Color(look.eye).lerp(new T.Color('#ffffff'), 0.25) }),
      leg: new T.MeshPhysicalMaterial({ color: look.leg, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.4 }),
      tarsus: new T.MeshPhysicalMaterial({ color: new T.Color(look.leg).lerp(new T.Color(look.stripe), 0.35), roughness: 0.5, clearcoat: 0.3 }),
      hair: std(new T.Color(look.stripe).lerp(new T.Color('#000000'), 0.3), { rough: 0.5 }),
      ocelli: new T.MeshPhysicalMaterial({ color: '#5a140c', roughness: 0.15, clearcoat: 1 }),
      face: std(look.face, { rough: 0.6 }), neck: std(look.body, { rough: 0.6 }),
      antenna: new T.MeshPhysicalMaterial({ color: new T.Color(look.face).lerp(new T.Color(look.stripe), 0.25), roughness: 0.55, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new T.Color('#e0c9a0') })
    };
    M.wing = new T.MeshPhysicalMaterial({ color: '#ffffff', map: WT.map, alphaMap: WT.alpha, transparent: true, side: T.DoubleSide, depthWrite: false,
      roughness: 0.18, iridescence: 1, iridescenceIOR: 1.33, iridescenceThicknessRange: [220, 480], sheen: 0.3, sheenColor: new T.Color('#d9ecff') });
    for (var mk in M) { M[mk].flatShading = true; M[mk].bumpMap = null; }     // facets, not fine grain
    M.fan = new T.MeshBasicMaterial({ color: '#e9eef4', vertexColors: true, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false });

    /* thorax, scutellum, bristles */
    mesh(G.thorax, M.thorax, body);
    var sc = mesh(G.scut, M.thorax, body); sc.position.set(-30, 116, 0); sc.rotation.z = -0.25;
    var hairs = [], back = new T.Vector3(-1, 0.25, 0), n = new T.Vector3();
    [[0.35, 0.82, 0.22], [0.0, 0.92, 0.24], [-0.4, 0.8, 0.26], [0.55, 0.55, 0.62], [0.1, 0.55, 0.78], [-0.35, 0.5, 0.72]].forEach(function (u, i) {
      [-1, 1].forEach(function (s) {
        n.set(u[0], u[1], s * u[2]).normalize();
        var a = thoraxPoint(n), d = n.clone().lerp(back, 0.62);
        bristle(hairs, a, d, i < 3 ? 26 : 18, 1.05, back.clone().setY(-0.15), 0.4);
      });
    });
    [-1, 1].forEach(function (s) {               // scutellar bristles, long and crossing behind
      bristle(hairs, new T.Vector3(-40, 119, s * 6), new T.Vector3(-1, 0.45, s * 0.1), 30, 1.05, new T.Vector3(-1, 0.1, -s * 0.15), 0.5);
      bristle(hairs, new T.Vector3(-30, 116, s * 13), new T.Vector3(-0.8, 0.45, s * 0.5), 20, 0.95, new T.Vector3(-1, 0, 0), 0.4);
    });
    for (var h = 0; h < 46; h++) {               // fine hairs all over the back
      n.set(lerp(-0.7, 0.75, hash(h * 3.1)), lerp(0.35, 1, hash(h * 5.7)), lerp(-0.85, 0.85, hash(h * 1.9))).normalize();
      if (n.y < 0.3) continue;
      bristle(hairs, thoraxPoint(n), n.clone().lerp(back, 0.8), 5.5, 0.45);
    }
    mesh(merge(hairs), M.hair, body, false).visible = false;      // bristles only make noise at this pixel size

    /* abdomen (pivots at its joint with the thorax, so it can droop and breathe) */
    var abdGroup = this.abd = new T.Group(); abdGroup.position.set(ABD_X, ABD_Y, 0); body.add(abdGroup);
    var abdMesh = mesh(G.abdomen, M.abdomen, abdGroup); abdMesh.position.set(-ABD_X, -ABD_Y, 0);
    var abdHairs = [];
    for (h = 0; h < 40; h++) {
      var sa = lerp(0.25, 0.95, hash(h * 2.3)), ang = lerp(-1.3, 1.3, hash(h * 4.1)), r = abdRadius(sa);
      var p0 = new T.Vector3(ABD_X - sa * ABD_LEN, ABD_Y + r * Math.cos(ang) * 0.94 - 10 * sa * sa, r * Math.sin(ang));
      bristle(abdHairs, p0, new T.Vector3(-1, Math.cos(ang) * 0.5, Math.sin(ang) * 0.5), 6, 0.5);
    }
    var ah = mesh(merge(abdHairs), M.hair, abdGroup, false); ah.position.copy(abdMesh.position);

    /* head */
    var head = this.head = new T.Group(); head.rotation.order = 'YZX'; head.position.copy(NECK); body.add(head);
    var hb = new T.Group(); hb.position.copy(NECK).negate(); head.add(hb);     // head parts, in fly coordinates
    var neck = mesh(SPHERE, M.neck, hb); neck.position.set(44, 100, 0); neck.scale.set(9, 13, 13);
    var hm = this.headBall = mesh(G.head, M.head, hb); hm.position.copy(HEAD);
    this.eyes = [-1, 1].map(function (s) {
      var e = mesh(G.eye, M.eye, hb); e.position.set(66, 106, s * 18); e.scale.set(19, 25, 17); e.rotation.set(s * 0.1, 0, -0.12);
      return e;
    });
    [[54, 135, 0], [49, 133, 5], [49, 133, -5]].forEach(function (p) { var m = mesh(SPHERE, M.ocelli, hb, false); m.position.fromArray(p); m.scale.setScalar(2.4); });
    var headHairs = [];
    [-1, 1].forEach(function (s) {
      bristle(headHairs, new T.Vector3(46, 132, s * 12), new T.Vector3(-0.5, 1, s * 0.5), 18, 0.9, new T.Vector3(-1, 0.4, s * 0.2), 0.4);   // verticals
      bristle(headHairs, new T.Vector3(50, 136, s * 4), new T.Vector3(0.4, 1, s * 0.6), 14, 0.8, new T.Vector3(1, 0.4, 0), 0.4);           // ocellars
      [0, 1, 2].forEach(function (i) {                                                                                                     // orbitals along the eye
        bristle(headHairs, new T.Vector3(70 - i * 9, 130 - i * 2, s * 20), new T.Vector3(0.6 - i * 0.4, 1, s * 0.3), 12, 0.7, new T.Vector3(-0.3, 1, 0), 0.3);
      });
      for (var i = 0; i < 7; i++) {                                                                                                        // behind the eyes
        var a = lerp(-0.9, 1.1, i / 6);
        bristle(headHairs, new T.Vector3(50, 104 + 26 * Math.sin(a), s * (26 * Math.cos(a) + 4)), new T.Vector3(-1, 0.2, s * 0.4), 7, 0.5);
      }
    });
    mesh(merge(headHairs), M.hair, hb, false);
    /* antennae: a small scape and pedicel, a round third segment, and the feathery arista */
    this.antennae = [-1, 1].map(function (s) {
      var a = new T.Group(); a.position.set(82, 114, s * 7); hb.add(a);
      var p = mesh(SPHERE, M.antenna, a, false); p.scale.set(3.4, 3.8, 3);
      var f = mesh(SPHERE, M.antenna, a, false); f.position.set(3.5, -7, s * 1.5); f.scale.set(4.2, 7.2, 3.4); f.rotation.z = 0.35;
      var parts = [], c0 = new T.Vector3(6, -4, s * 4), c1 = new T.Vector3(13, 10, s * 9), c2 = new T.Vector3(13, 30, s * 13);
      var curve = new T.QuadraticBezierCurve3(c0, c1, c2);
      for (var i = 0; i < 8; i++) {
        var p0 = curve.getPoint(i / 8), p1 = curve.getPoint((i + 1) / 8), d = p1.clone().sub(p0);
        parts.push({ geo: CONE, m: new T.Matrix4().compose(p0, new T.Quaternion().setFromUnitVectors(UP, d.clone().normalize()), new T.Vector3(lerp(0.75, 0.3, i / 8), d.length() * 1.05, lerp(0.75, 0.3, i / 8))) });
        if (i > 1) {
          var tng = d.clone().normalize(), side = new T.Vector3(-tng.y, tng.x, 0).normalize();
          bristle(parts, p0, side.clone().addScaledVector(tng, 0.6), lerp(7, 4, i / 8), 0.28);
          bristle(parts, p0, side.clone().negate().addScaledVector(tng, 0.6), lerp(5, 3, i / 8), 0.24);
        }
      }
      mesh(merge(parts), M.hair, a, false);
      return a;
    });
    /* proboscis: tucked under the head, it reaches down to taste */
    var pr = this.proboscis = new T.Group(); pr.position.set(70, 82, 0); hb.add(pr);
    var ros = mesh(TAPER, M.face, pr, false); rod(ros, new T.Vector3(0, 0, 0), new T.Vector3(2, -14, 0), 5);
    var lab = mesh(SPHERE, M.face, pr, false); lab.position.set(3, -17, 0); lab.scale.set(5.5, 3.5, 6.5);
    // a glow over the head when dopamine arrives
    this.light = new T.PointLight('#3987e5', 0, 260); this.light.position.set(60, 140, 0); hb.add(this.light);
    this.halo = S3.glowSprite('#ffffff', 170, 0); this.halo.position.set(60, 110, 0); hb.add(this.halo);

    /* wings, hinged at the thorax, with the blur fan of a beating wing; halteres behind them */
    var curl = look.wingCurl || 0;
    this.wings = [-1, 1].map(function (s) {
      var w = { side: s, pivot: new T.Group(), fan: new T.Group() };
      w.pivot.rotation.order = 'YZX'; w.pivot.position.set(-6, 117, s * 13); body.add(w.pivot);
      w.blade = mesh(wingGeo(s, curl), M.wing, w.pivot, false); w.blade.renderOrder = 2;
      w.fan.position.copy(w.pivot.position); w.fan.rotation.order = 'YZX'; body.add(w.fan);
      var fm = mesh(fanGeo(s), M.fan, w.fan, false); fm.renderOrder = 3;
      w.haltere = new T.Group(); w.haltere.position.set(-20, 104, s * 19); body.add(w.haltere);
      var st = mesh(SPHERE, M.leg, w.haltere, false); st.position.set(-3, 3, s * 2); st.scale.set(1.2, 5, 1.2); st.rotation.x = -s * 0.3;
      var kn = mesh(SPHERE, M.face, w.haltere, false); kn.position.set(-4, 8, s * 4); kn.scale.setScalar(3.4);
      return w;
    });

    /* legs: coxa, femur, tibia and tarsus on each side; the feet are planted on the felt */
    var self = this;
    this.legs = [];
    [-1, 1].forEach(function (s) {
      [{ coxa: [30, 74, 8], hip: [32, 60, 13], toe: [86, 0, 40], dir: [0.6, -0.5, 0.35], len: [42, 40, 24], bend: [0.5, 1, 0.55],
         hang: [26, 30, 20], hangDir: [0.5, -0.8, 0.2] },
       { coxa: [8, 68, 12], hip: [8, 56, 17], toe: [8, 0, 70], dir: [0.05, -0.5, 0.85], len: [46, 46, 26], bend: [0, 1, 0.6],
         hang: [0, 22, 30], hangDir: [-0.1, -0.85, 0.4] },
       { coxa: [-10, 70, 11], hip: [-14, 58, 16], toe: [-72, 0, 56], dir: [-0.6, -0.45, 0.5], len: [50, 50, 30], bend: [-0.4, 1, 0.5],
         hang: [-34, 22, 26], hangDir: [-0.5, -0.8, 0.25] }].forEach(function (d, i) {
        function v3(a, flip) { return new T.Vector3(a[0], a[1], (flip === false ? 1 : s) * a[2]); }
        var leg = { side: s, front: i === 0, mid: i === 1, hind: i === 2, coxaAt: v3(d.coxa), hip: v3(d.hip), toe: v3(d.toe), dir: v3(d.dir).normalize(),
          len: d.len, bend: v3(d.bend).normalize(), hang: v3(d.hang), hangDir: v3(d.hangDir).normalize() };
        leg.coxa = mesh(TAPER, M.leg, body);
        leg.femur = mesh(TAPER, M.leg, body); leg.tibia = mesh(TAPER, M.leg, body);
        leg.t1 = mesh(TAPER, M.tarsus, body); leg.t2 = mesh(TAPER, M.tarsus, body);
        leg.knee = mesh(SPHERE, M.leg, body); leg.ankle = mesh(SPHERE, M.tarsus, body, false); leg.claw = mesh(SPHERE, M.hair, body, false);
        leg.knee.scale.setScalar(2.75); leg.ankle.scale.setScalar(1.95); leg.claw.scale.set(1.6, 1.2, 1.6);
        self.legs.push(leg);
      });
    });
    var all = this.allMats = [];
    g.traverse(function (nd) { if (nd.material && all.indexOf(nd.material) < 0 && nd.material !== M.fan && nd.material !== M.wing) all.push(nd.material); });
    this.M = M; this.fadeA = 1;
    this.state = 'idle'; this.since = -1e6; this.glowA = 0; this.glowAt = 0; this.glowFade = 0;
    this.from = null; this.last = null;
    this._m = new T.Matrix4(); this._inv = new T.Matrix4();
  }
  Fly.prototype.act = function (state) {
    if (this.last) {                         // blend out of wherever the fly is now
      this.from = {};
      for (var k in this.last) this.from[k] = this.last[k];
      this.from.yaw = wrap(this.from.yaw); this.from.flip = wrap(this.from.flip);
    }
    this.state = state; this.since = now();
  };
  Fly.prototype.glow = function (color, a, fade) {
    this.light.color.set(color); this.halo.material.color.set(color);
    this.glowA = a; this.glowAt = now(); this.glowFade = fade;
  };
  /* Where the head is, in the room. */
  Fly.prototype.headAt = function () { return this.headBall.getWorldPosition(new T.Vector3()); };
  /* Faded (a player who folded) or solid. */
  Fly.prototype.fade = function (a) {
    var halo = this.halo.material;
    this.fadeA = a;
    this.allMats.forEach(function (m) {
      if (m === halo) return;
      m.opacity = a; m.transparent = a < 1;
    });
  };

  /* ---------- motion ---------- */
  var KEYS = ['x', 'lift', 'crouch', 'pitch', 'roll', 'yaw', 'flip', 'hp', 'hy', 'hr', 'ant', 'antF', 'wing', 'welev', 'buzz', 'prob', 'abd',
    'groomF', 'groomH', 'groomB', 'nx', 'ny', 'nz', 'fx', 'fy', 'fz', 'dangle'];
  /* Always alive: the head looks about, the body sways a little, the antennae drift. */
  function ambient(t, f) {
    var P = {};
    KEYS.forEach(function (k) { P[k] = 0; });
    P.hy = 0.2 * wander(t, 2300, f.seed); P.hp = 0.05 * wander(t, 2900, f.seed + 5); P.hr = 0.05 * wander(t, 3700, f.seed + 9);
    P.ant = 0.06 * wander(t, 1700, f.seed + 3);
    P.x = 1.4 * Math.sin(t / 2300 + f.seed); P.roll = 0.014 * Math.sin(t / 1900 + f.seed);
    return P;
  }
  /* A landing after a jump: legs give, then straighten. */
  function landing(e, at) { return kf(e, [[at - 40, 0], [at + 60, 10], [at + 320, 0]]); }
  /* Front legs raised in triumph, wings spread. */
  function cheer(P, e, at, ns) {
    var up = kf(e, [[at, 0], [at + 220, 1], [at + 1100, 1], [at + 1400, 0]]), w = Math.sin((e - at) / 110);
    P.ny += 52 * up; P.fy += 52 * up; P.nx += 14 * up; P.fx += 14 * up; P.nz += ns * (10 + 8 * w) * up; P.fz -= ns * (10 - 8 * w) * up;
    P.wing += 0.42 * up; P.welev += 0.3 * up; P.pitch += 0.07 * up; P.ant += 0.14 * up; P.hp += 0.08 * up;
  }
  var STATES = {
    idle: function (P, e, t, f) {
      if (f.reduce) return;
      if (e > 2400) {                        // grooming: front legs rub and wipe the eyes, or hind legs clean the wings
        var cyc = 9500, k = (e - 2400) % cyc, n = Math.floor((e - 2400) / cyc) + f.id;
        if (n % 2 === 0) {
          P.groomF = kf(k, [[0, 0], [350, 1], [1500, 1], [1750, 0]]);
          P.groomH = kf(k, [[1500, 0], [1800, 1], [3100, 1], [3400, 0]]);
          P.hp -= 0.1 * P.groomF + 0.08 * P.groomH; P.hy *= 1 - Math.max(P.groomF, P.groomH);
          P.hy += 0.25 * P.groomH * Math.sin(k / 260);
        } else {
          P.groomB = kf(k, [[0, 0], [450, 1], [2300, 1], [2700, 0]]);
          P.pitch -= 0.06 * P.groomB; P.welev -= 0.08 * P.groomB; P.wing += 0.05 * P.groomB; P.abd -= 0.05 * P.groomB;
        }
      }
      var fl = (t + f.seed * 977) % 6100;    // now and then a quick flick of the wings
      if (fl < 320) { P.wing += 0.28 * bell(fl / 320); P.welev += 0.12 * bell(fl / 320); }
    },
    sniff: function (P, e) {
      var on = kf(e, [[0, 0], [260, 1]]);
      P.pitch -= 0.09 * on; P.x += 5 * on; P.crouch += 4 * on; P.hp += (-0.14 + 0.035 * Math.sin(e / 110)) * on; P.hy *= 1 - 0.6 * on;
      P.antF = on; P.ant -= 0.08 * on; P.prob = on * (0.55 + 0.45 * Math.abs(Math.sin(e / 170)));
    },
    tap: function (P, e) {                   // hit or check: lift the near front leg and tap the felt twice
      var on = kf(e, [[0, 0], [160, 1], [820, 1], [1050, 0]]);
      P.ny += kf(e, [[0, 0], [220, 30], [380, -1], [560, 24], [760, -1], [900, 0]]);
      P.nx += kf(e, [[0, 0], [220, 24], [820, 24], [1050, 0]]);
      P.pitch -= 0.06 * on; P.hp -= 0.12 * on; P.crouch += 3 * on; P.x += 3 * on;
    },
    wave: function (P, e, t, f) {            // stand: a front leg up, waved side to side
      var on = kf(e, [[0, 0], [240, 1], [1000, 1], [1250, 0]]), w = Math.sin((e - 240) / 95), ns = f.nearSide;
      P.nx += 24 * on; P.ny += (86 + 12 * w) * on; P.nz += ns * (12 + 20 * w) * on;
      P.pitch += 0.07 * on; P.roll -= ns * 0.03 * on; P.hy = lerp(P.hy, -ns * 0.25, on); P.ant += 0.08 * on;
    },
    push: function (P, e, t, f) {            // chips in: both front legs shove forward
      var on = kf(e, [[0, 0], [200, 1], [650, 1], [900, 0]]), ns = f.nearSide;
      P.nx += 40 * on; P.fx += 34 * on; P.ny += 5 * on; P.fy += 5 * on; P.nz -= ns * 10 * on; P.fz += ns * 10 * on;
      P.x += 9 * on; P.crouch += 6 * on; P.pitch -= 0.08 * on; P.hp -= 0.06 * on;
    },
    fold: function (P, e, t, f) {            // backs away and sweeps the cards aside
      var on = kf(e, [[0, 0], [380, 1]]), ns = f.nearSide;
      P.nx += kf(e, [[0, 0], [200, 26], [450, 26], [650, 0]]); P.nz += ns * kf(e, [[200, 0], [450, 28], [650, 0]]); P.ny += kf(e, [[0, 0], [150, 9], [450, 4], [650, 0]]);
      P.x -= 8 * on; P.crouch += 7 * on; P.hp -= 0.22 * on; P.ant -= 0.4 * on; P.wing -= 0.06 * on; P.welev -= 0.04 * on; P.pitch += 0.03 * on;
    },
    win: function (P, e, t, f) {             // a crouch, a hop with a pirouette, a landing and a cheer
      P.crouch += kf(e, [[0, 0], [150, 10], [210, 0]]) + landing(e, 1060);
      P.lift += 46 * bell((e - 170) / 890);
      P.yaw += TAU * easeInOut(clamp01((e - 200) / 820));
      P.buzz = kf(e, [[110, 0], [190, 1], [1000, 1], [1120, 0]]); P.dangle = kf(e, [[150, 0], [260, 1], [940, 1], [1060, 0]]);
      cheer(P, e, 1300, f.nearSide); P.ant += 0.12;
    },
    blackjack: function (P, e, t, f) {       // takes off, loops the loop, lands and cheers
      var k = (e - 180) / 2000;
      P.crouch += kf(e, [[0, 0], [160, 12], [220, 0]]) + landing(e, 2180);
      if (k > 0 && k < 1) { P.lift += 130 * Math.sin(Math.PI * k); P.x -= 60 * Math.sin(TAU * k); }
      P.flip += TAU * easeInOut(clamp01((k - 0.25) / 0.5));
      P.buzz = kf(e, [[120, 0], [200, 1], [2100, 1], [2240, 0]]); P.dangle = kf(e, [[160, 0], [300, 1], [2050, 1], [2180, 0]]);
      cheer(P, e, 2400, f.nearSide); P.ant += 0.12;
    },
    lose: function (P, e) { slump(P, e, 0); },
    bust: function (P, e) {                  // a startled flutter and a shudder, then a slump
      if (e < 520) P.x += Math.sin(e / 22) * 5 * (1 - e / 520);
      P.buzz = kf(e, [[0, 0], [60, 0.8], [260, 0.8], [400, 0]]);
      slump(P, e, 300);
    },
    shrug: function (P, e, t, f) {
      var on = bell(clamp01(e / 950)), ns = f.nearSide;
      P.wing += 0.35 * on; P.welev += 0.3 * on; P.nx += 10 * on; P.fx += 10 * on; P.ny += 30 * on; P.fy += 30 * on;
      P.nz += ns * 14 * on; P.fz -= ns * 14 * on; P.hr += 0.18 * on; P.lift += 3 * on; P.ant += 0.1 * on;
    },
    hover: function (P, e, t, f) {           // too busy to land
      P.lift += 38 + Math.sin(t / 170 + f.id) * 5; P.x += Math.sin(t / 530) * 6; P.pitch += -0.07 + Math.sin(t / 410) * 0.05;
      P.yaw += 0.3 * Math.sin(t / 1300 + f.id); P.antF = 0.6; P.buzz = 1; P.dangle = 1;
    }
  };
  function slump(P, e, at) {
    var on = kf(e, [[at, 0], [at + 650, 1]]);
    P.crouch += 9 * on; P.hp -= 0.24 * on; P.ant -= 0.45 * on; P.welev -= 0.07 * on; P.wing -= 0.04 * on;
    P.pitch -= 0.04 * on; P.yaw -= 0.12 * on; P.abd -= 0.06 * on; P.hy *= 1 - 0.7 * on;
    P.lift -= 1.5 * on * (0.5 + 0.5 * Math.sin(e / 700));   // slow sighs
  }

  var V1 = new T.Vector3(), V2 = new T.Vector3(), V3 = new T.Vector3(), V4 = new T.Vector3();
  var GROOM_F = new T.Vector3(), GROOM_D = new T.Vector3(0.3, -0.15, 0);
  Fly.prototype.pose = function (t, busy) {
    var reduce = this.reduce, tt = reduce ? 0 : t, e = reduce ? 1e6 : t - this.since, st = busy ? 'hover' : this.state;
    var P = ambient(tt, this);
    (STATES[st] || STATES.idle)(P, e, tt, this);
    if (this.from && e < BLEND && !reduce) {
      var b = easeInOut(clamp01(e / BLEND)), from = this.from;
      KEYS.forEach(function (k) { P[k] = lerp(from[k], P[k], b); });
    }
    this.last = P;
    var ns = this.nearSide, fadeA = this.fadeA;

    this.pivot.position.set(PIVOT.x + P.x, PIVOT.y + 0.8 + P.lift - P.crouch, 0);
    this.pivot.rotation.set(P.roll, P.yaw, P.pitch + P.flip);
    this.head.rotation.set(P.hr, P.hy, P.hp);
    var flutter = P.antF * 0.13 * Math.sin(tt / 34 + this.id);
    this.antennae.forEach(function (a, i) { a.rotation.set(0, 0, P.ant + flutter * (i ? 1 : 0.8)); });
    this.proboscis.rotation.z = lerp(-1.15, 0.35, P.prob);
    this.proboscis.scale.setScalar(lerp(0.62, 1.05, P.prob));
    var breathe = 1 + 0.018 * Math.sin(tt / 820 + this.seed);
    this.abd.rotation.z = P.abd - 0.02; this.abd.scale.set(1, breathe, breathe);

    /* wings: folded flat over the abdomen at rest, sweeping a blurred stroke when they beat */
    var curl = this.look.wingCurl || 0, beat = 0.5 + 0.5 * Math.sin(t * 0.83 + this.id * 1.7), buzz = P.buzz;
    this.wings.forEach(function (w) {
      var s = w.side, stroke = lerp(STROKE[0], STROKE[1], beat);
      w.pivot.rotation.set(lerp(s * 0.18, s * 0.05, buzz), lerp(s * (-0.07 + P.wing), s * stroke, buzz), lerp(0.04 + 0.03 * curl - P.welev, -0.1 + 0.25 * beat, buzz));
      w.fan.visible = buzz > 0.02;
      w.fan.rotation.set(s * 0.05, 0, -0.06);
      w.haltere.rotation.z = buzz ? 0.5 * Math.sin(t * 1.3 + s) * buzz : 0.04 * Math.sin(tt / 300);
    });
    this.M.wing.opacity = fadeA * (1 - 0.5 * buzz);
    this.M.fan.opacity = fadeA * 0.34 * buzz;

    /* legs: planted feet are held in the room's frame and brought into the body's */
    this.pivot.updateMatrix(); this.body.updateMatrix();
    var inv = this._inv.multiplyMatrices(this.pivot.matrix, this.body.matrix).invert();
    var rub = Math.sin(tt / 70), sweep = Math.sin(tt / 240);
    this.legs.forEach(function (leg) {
      var s = leg.side, toe = V1.copy(leg.toe), dir = V2.copy(leg.dir);
      if (leg.front) {
        var near = s === ns, ox = near ? P.nx : P.fx, oy = near ? P.ny : P.fy, oz = near ? P.nz : P.fz;
        toe.x += ox; toe.y += Math.max(0, oy); toe.z += oz;
        dir.lerp(V3.set(0.8, 0.45, s * 0.1), clamp01(oy / 26)).normalize();
      }
      toe.applyMatrix4(inv); dir.transformDirection(inv);
      var ankle = V4.copy(toe).addScaledVector(dir, -leg.len[2]);
      if (leg.front && (P.groomF || P.groomH)) {
        GROOM_F.set(96, 70 + 6 * rub * s, s * (6 + 4 * rub));
        ankle.lerp(GROOM_F, P.groomF); dir.lerp(V3.set(0.3, -0.15, -s * 0.9), P.groomF).normalize();
        GROOM_F.set(72 + 8 * sweep, 104 + 14 * sweep, s * 44);
        ankle.lerp(GROOM_F, P.groomH); dir.lerp(V3.set(0.3, 0.5, -s * 0.8), P.groomH).normalize();
      }
      if (leg.hind && P.groomB) {
        GROOM_F.set(-96 + 8 * rub, 82 + 8 * rub, s * 30);
        ankle.lerp(GROOM_F, P.groomB); dir.lerp(V3.set(-0.6, 0.25, -s * 0.75), P.groomB).normalize();
      }
      if (P.dangle) { ankle.lerp(V3.copy(leg.hip).add(leg.hang.clone().setY(-leg.hang.y)), P.dangle); dir.lerp(leg.hangDir, P.dangle).normalize(); }
      var j = joint(leg.hip, ankle, leg.len[0], leg.len[1], leg.bend), end = j.end;
      var t1 = end.clone().addScaledVector(dir, leg.len[2] * 0.45), t2 = end.clone().addScaledVector(dir, leg.len[2]);
      rod(leg.coxa, leg.coxaAt, leg.hip, 5.2);
      rod(leg.femur, leg.hip, j.mid, 3.5); rod(leg.tibia, j.mid, end, 2.7);
      rod(leg.t1, end, t1, 1.9); rod(leg.t2, t1, t2, 1.5);
      leg.knee.position.copy(j.mid); leg.ankle.position.copy(end); leg.claw.position.copy(t2);
    });

    var gl = this.glowFade ? this.glowA * clamp01(1 - (t - this.glowAt) / this.glowFade) : this.glowA;
    this.light.intensity = gl * 2.2; this.halo.material.opacity = gl * 0.75;
  };

  K.Fly = Fly;
  K.FLY_LOOKS = LOOKS;
})(self);
