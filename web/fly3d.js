/* FlyJack - the fly, modelled in 3D (three.js). Head, compound eyes, thorax and a striped
   abdomen are ellipsoids; each leg has a hip, knee and ankle that bend to put the foot where it
   needs to go; the wings are thin glassy blades. The table places fly.group and calls
   act(state), glow(color, a, fade) and pose(t, busy) as it always has. */
(function (root) {
  'use strict';
  var T = root.THREE, K = root.SceneKit, S3 = root.Scene3D, clamp01 = K.clamp01, easeInOut = K.easeInOut, now = K.now;
  var std = S3.std, mesh = S3.mesh, rod = S3.rod, joint = S3.joint, SPHERE = S3.SPHERE, CYL = S3.CYL;
  var uid = 0;
  /* Fly coordinates: x towards the head, y up, z to one side; the feet stand on y = 0. */
  var PIVOT = new T.Vector3(0, 82, 0), NECK = new T.Vector3(38, 100, 0);

  var LOOKS = {
    'Canton-S': { body: '#d6a45c', abdomen: '#e0b26a', stripe: '#3b2414', head: '#c99652', eye: '#d42b22', leg: '#3a2818' },
    'white': { eye: '#eee8da' },
    'yellow': { body: '#efd27c', abdomen: '#f4dc8c', stripe: '#9a7428', head: '#e6c26a', leg: '#7a5a2a' },
    'ebony': { body: '#4e3b2e', abdomen: '#57412f', stripe: '#17100a', head: '#4d382a', leg: '#1a120b' },
    'Curly': { wingCurl: 0.45 }
  };

  /* Textures: dark bands across the top of the abdomen, and the facets of a compound eye. */
  var bandTex = {}, facetTex = null;
  function abdomenTexture(base, stripe) {
    var key = base + stripe;
    if (bandTex[key]) return bandTex[key];
    var c = S3.canvas(256, 256), g = c.getContext('2d'), gr;
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    // canvas rows run from the tip of the abdomen (top) to its front; columns go round it, the back in the middle
    [[0.53, 0.05], [0.64, 0.055], [0.74, 0.06], [0.86, 0.14]].forEach(function (b) {
      var y = (1 - b[0]) * 256, h = b[1] * 256;
      gr = g.createLinearGradient(0, 0, 256, 0);
      gr.addColorStop(0.18, stripe + '00'); gr.addColorStop(0.32, stripe); gr.addColorStop(0.68, stripe); gr.addColorStop(0.82, stripe + '00');
      g.fillStyle = gr; g.fillRect(0, y - h / 2, 256, h);
    });
    gr = g.createLinearGradient(0, 0, 256, 0);          // the tip is dark all over its top
    gr.addColorStop(0.12, stripe + '00'); gr.addColorStop(0.3, stripe); gr.addColorStop(0.7, stripe); gr.addColorStop(0.88, stripe + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 0.08 * 256);
    return (bandTex[key] = S3.texture(c));
  }
  function facets() {
    if (facetTex) return facetTex;
    var c = S3.canvas(512, 256), g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = 'rgba(40,0,0,0.45)'; g.lineWidth = 1.4;
    for (var y = 0; y < 34; y++) for (var x = 0; x < 70; x++) {
      var cx = x * 7.4 + (y % 2) * 3.7, cy = y * 7.6;
      g.beginPath();
      for (var k = 0; k < 6; k++) { var a = Math.PI / 3 * k + Math.PI / 6; g.lineTo(cx + 4 * Math.cos(a), cy + 4 * Math.sin(a)); }
      g.closePath(); g.stroke();
    }
    return (facetTex = S3.texture(c));
  }
  var ABD_GEO = new T.SphereGeometry(1, 40, 28).rotateZ(Math.PI / 2);   // poles along the body, so the bands wrap round it
  var WING_GEO = new T.CircleGeometry(1, 48).rotateX(-Math.PI / 2);

  /* o: {reduce, look (a strain name in LOOKS)}. nearSide: which side (-1 or 1) faces the camera, for gestures. */
  function Fly(o) {
    o = o || {};
    this.reduce = !!o.reduce; this.id = ++uid; this.nearSide = -1;
    var look = {}, k, base = LOOKS['Canton-S'], extra = LOOKS[o.look] || {};
    for (k in base) look[k] = base[k];
    for (k in extra) look[k] = extra[k];
    this.look = look;
    var g = this.group = new T.Group();
    var pivot = this.pivot = new T.Group(); pivot.rotation.order = 'YZX'; g.add(pivot);
    var body = this.body = new T.Group(); body.position.copy(PIVOT).negate(); pivot.add(body);
    var M = {
      body: std(look.body, { rough: 0.5 }), abdomen: std('#ffffff', { rough: 0.45, map: abdomenTexture(look.abdomen, look.stripe) }),
      head: std(look.head, { rough: 0.55 }), eye: std(look.eye, { rough: 0.22, map: facets() }), leg: std(look.leg, { rough: 0.45 }),
      dark: std('#2a1a0c', { rough: 0.6 }), ocelli: std('#7a1a10', { rough: 0.3 })
    };
    M.wing = new T.MeshPhysicalMaterial({ color: '#eef6ff', roughness: 0.12, transparent: true, opacity: 0.42, side: T.DoubleSide, depthWrite: false,
      iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 420], sheen: 0.4, sheenColor: new T.Color('#cfe6ff') });
    M.wing.userData.base = 0.42;
    M.vein = new T.LineBasicMaterial({ color: '#6e5032', transparent: true, opacity: 0.55 }); M.vein.userData.base = 0.55;
    function ell(mat, parent, c, r, rz) { var m = mesh(SPHERE, mat, parent); m.position.fromArray(c); m.scale.fromArray(r); if (rz) m.rotation.z = rz; return m; }

    ell(M.body, body, [8, 92, 0], [44, 38, 36]);
    ell(std(look.body, { rough: 0.45 }), body, [-26, 112, 0], [15, 8, 13]);
    ell(std(look.body, { rough: 0.6 }), body, [36, 96, 0], [10, 13, 12]);
    var abd = mesh(ABD_GEO, M.abdomen, body); abd.position.set(-62, 80, 0); abd.scale.set(62, 40, 38); abd.rotation.z = -0.2;
    // stiff bristles along the back of the thorax
    [[0.35, 0.9, 0.25], [0.35, 0.9, -0.25], [0, 0.95, 0.3], [0, 0.95, -0.3], [-0.4, 0.85, 0.32], [-0.4, 0.85, -0.32], [0.55, 0.7, 0.45], [0.55, 0.7, -0.45]].forEach(function (u) {
      var n = new T.Vector3().fromArray(u).normalize(), a = new T.Vector3(8 + n.x * 44, 92 + n.y * 38, n.z * 36);
      var b = new T.Vector3(8 + n.x * 44 * 1.28 - 8, 92 + n.y * 38 * 1.28, n.z * 36 * 1.28);
      rod(mesh(CYL, M.dark, body, false), a, b, 0.9);
    });

    var head = this.head = new T.Group(); head.rotation.order = 'YZX'; head.position.copy(NECK); body.add(head);
    var hb = new T.Group(); hb.position.copy(NECK).negate(); head.add(hb);     // head parts, in fly coordinates
    this.headBall = ell(M.head, hb, [60, 104, 0], [24, 32, 34]);
    [-1, 1].forEach(function (s) { ell(M.eye, hb, [66, 106, s * 20], [20, 27, 18]); });
    [[56, 136, 0], [50, 134, 5], [50, 134, -5]].forEach(function (p) { ell(M.ocelli, hb, p, [2.2, 2.2, 2.2]); });
    rod(mesh(CYL, std(look.head, { rough: 0.6 }), hb), new T.Vector3(72, 80, 0), new T.Vector3(84, 60, 0), 3.2);
    ell(std(look.head, { rough: 0.5 }), hb, [86, 57, 0], [8, 4, 7]);
    this.antennae = [-1, 1].map(function (s) {
      var a = new T.Group(); a.position.set(80, 120, s * 9); hb.add(a);
      ell(std(look.head, { rough: 0.6 }), a, [0, 0, 0], [5, 6, 4]);
      ell(std(look.head, { rough: 0.5 }), a, [5, -9, s], [6, 9, 5], 0.5);
      var p0 = new T.Vector3(6, -4, s), p1 = new T.Vector3(2, 20, s * 3), p2 = new T.Vector3(-2, 38, s * 4);
      rod(mesh(CYL, M.dark, a, false), p0, p1, 0.8); rod(mesh(CYL, M.dark, a, false), p1, p2, 0.6);
      [[4, 12], [2, 22], [0, 30]].forEach(function (q) {     // the feathery arista
        rod(mesh(CYL, M.dark, a, false), new T.Vector3(q[0] - 6, q[1] + 2, s * 3), new T.Vector3(q[0] + 6, q[1] + 3, s * 3), 0.4);
      });
      return a;
    });
    // a glow over the head when dopamine arrives
    this.light = new T.PointLight('#3987e5', 0, 260); this.light.position.set(60, 140, 0); hb.add(this.light);
    this.halo = S3.glowSprite('#ffffff', 170, 0); this.halo.position.set(60, 110, 0); hb.add(this.halo);

    // wings, hinged at the thorax; a second blade blurs in when they beat
    this.wings = [-1, 1].map(function (s) {
      var w = { side: s, pivot: new T.Group(), ghost: new T.Group() };
      [w.pivot, w.ghost].forEach(function (p, i) {
        p.rotation.order = 'YZX'; p.position.set(-4, 118, s * 12); body.add(p);
        var blade = mesh(WING_GEO, M.wing, p, false); blade.scale.set(80, 1, 27); blade.position.set(-78, 0, 0); blade.renderOrder = 2;
        if (i === 0) {
          var pts = [];
          [[0, 0, -150, -3], [-6, 3, -136, 15], [-10, 6, -112, 21], [-72, -5, -76, 13], [-102, -3, -106, 15]].forEach(function (v) {
            pts.push(new T.Vector3(v[0], 0.4, s * v[1]), new T.Vector3(v[2], 0.4, s * v[3]));
          });
          p.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(pts), M.vein));
        }
      });
      return w;
    });

    // legs: front, middle, hind on each side, each a femur, tibia and tarsus
    var self = this;
    this.legs = [];
    [-1, 1].forEach(function (s) {
      [[[32, 68, 12], [80, 0, 38], [50, 46], [0.35, 1, 0.7]],
       [[10, 62, 16], [6, 0, 62], [46, 42], [0, 1, 0.9]],
       [[-12, 66, 14], [-62, 0, 50], [50, 46], [-0.35, 1, 0.7]]].forEach(function (d, i) {
        var leg = { side: s, front: i === 0, hip: new T.Vector3(d[0][0], d[0][1], s * d[0][2]), foot: new T.Vector3(d[1][0], d[1][1], s * d[1][2]),
          len: d[2], bend: new T.Vector3(d[3][0], d[3][1], s * d[3][2]).normalize() };
        leg.segs = [mesh(CYL, M.leg, body), mesh(CYL, M.leg, body), mesh(CYL, M.leg, body)];
        leg.knee = mesh(SPHERE, M.leg, body); leg.knee.scale.setScalar(3.4);
        self.legs.push(leg);
      });
    });
    var all = this.allMats = [];
    g.traverse(function (n) { if (n.material && all.indexOf(n.material) < 0) all.push(n.material); });
    this.state = 'idle'; this.since = -1e6; this.glowA = 0; this.glowAt = 0; this.glowFade = 0;
  }
  Fly.prototype.act = function (state) { this.state = state; this.since = now(); };
  Fly.prototype.glow = function (color, a, fade) {
    this.light.color.set(color); this.halo.material.color.set(color);
    this.glowA = a; this.glowAt = now(); this.glowFade = fade;
  };
  /* Where the head is, in the room. */
  Fly.prototype.headAt = function () { return this.headBall.getWorldPosition(new T.Vector3()); };
  /* Faded (a player who folded) or solid. */
  Fly.prototype.fade = function (a) {
    var halo = this.halo.material;
    this.allMats.forEach(function (m) {
      if (m === halo) return;
      var b = m.userData.base || 1;
      m.opacity = a * b; m.transparent = a < 1 || b < 1;
    });
  };

  /* States: idle (grooms now and then, looks around), sniff, tap (hit or check), wave (stand),
     push (chips in), fold, win (a hop and a pirouette), blackjack (a flying backflip), lose, bust,
     shrug, and hover when busy. */
  Fly.prototype.pose = function (t, busy) {
    var reduce = this.reduce, tt = reduce ? 0 : t, e = reduce ? 1e6 : t - this.since, st = busy ? 'hover' : this.state, p, k;
    var x = 0, lift = 0.8 + Math.sin(tt / 700) * 0.8, pitch = 0, flip = 0, yaw = 0, hp = 0, hy = 0, ant = Math.sin(tt / 1300) * 0.05;
    var spread = 0, elev = 0, buzz = false, near = null, far = null, groom = 0, dangle = 0, ns = this.nearSide;
    if (st === 'idle') {
      yaw = 0.07 * Math.sin(tt / 4300); hy = 0.28 * Math.sin(tt / 3100);
      k = (e - 2600) % 8000;
      if (e > 2600 && k < 1800) { groom = Math.sin(Math.PI * k / 1800); hp = -0.1 * groom; pitch = -0.04 * groom; hy *= 1 - groom; }
      k = e % 5200; if (k < 260) { p = Math.sin(Math.PI * k / 260); spread += 0.3 * p; elev += 0.2 * p; }
      k = tt % 3100; if (k < 160) ant += 0.18 * Math.sin(Math.PI * k / 160);
    } else if (st === 'sniff') {
      p = clamp01(e / 260); pitch = -0.09 * p; hp = -0.14 * p; ant = -0.12 + 0.12 * Math.sin(tt / 38);
    } else if (st === 'tap') {
      pitch = -0.05; hp = -0.08;
      near = [8, 32 * Math.abs(Math.sin(Math.PI * Math.min(e, 760) / 380)), 0];
    } else if (st === 'wave') {
      p = clamp01(e / 220) * clamp01((1250 - e) / 250); k = Math.sin((e - 220) / 95);
      near = [26 * p, (105 + 16 * k) * p, ns * (10 + 18 * k) * p]; hy = 0.08 * Math.sin(e / 140) * p; pitch = 0.04 * p;
    } else if (st === 'push') {
      p = clamp01(e / 200) * clamp01((900 - e) / 250); near = [42 * p, 6 * p, -ns * 12 * p]; far = [30 * p, 4 * p, ns * 10 * p]; pitch = -0.08 * p; hp = -0.05 * p;
    } else if (st === 'fold') {
      p = clamp01(e / 350); hp = -0.2 * p; ant = -0.4 * p; pitch = 0.03 * p; spread = -0.2 * Math.sin(Math.PI * clamp01(e / 300));
    } else if (st === 'win') {
      p = e / 430;
      if (p < 2) { lift += 42 * Math.abs(Math.sin(Math.PI * p)); buzz = true; yaw = 2 * Math.PI * easeInOut(clamp01(e / 860)); dangle = Math.abs(Math.sin(Math.PI * p)); }
      else { spread = 0.4 * clamp01(1 - (e - 860) / 1000); elev = 0.3 * clamp01(1 - (e - 860) / 1000); }
      ant = 0.12;
    } else if (st === 'blackjack') {
      k = e / 1900;
      if (k < 1) {
        lift += 120 * Math.sin(Math.PI * k); x = -60 * Math.sin(2 * Math.PI * k); flip = 2 * Math.PI * easeInOut(clamp01((k - 0.25) / 0.5));
        buzz = true; dangle = Math.sin(Math.PI * k);
      }
      ant = 0.12;
    } else if (st === 'lose' || st === 'bust') {
      p = clamp01(e / 500);
      if (st === 'bust' && e < 500) x = Math.sin(e / 22) * 5 * (1 - e / 500);
      hp = -0.2 * p; ant = -0.45 * p; spread = 0.14 * p; pitch = -0.05 * p; yaw = -0.12 * p;
    } else if (st === 'shrug') {
      p = Math.sin(Math.PI * clamp01(e / 700)); spread = 0.35 * p; elev = 0.3 * p; near = [10 * p, 26 * p, 0]; lift += 4 * p; hy = 0.2 * p;
    } else if (st === 'hover') {             // Fast and Turbo: too busy to land
      lift = 36 + Math.sin(tt / 170 + this.id) * 5; x = Math.sin(tt / 530) * 6; pitch = -0.07 + Math.sin(tt / 410) * 0.05;
      yaw = 0.3 * Math.sin(tt / 1300 + this.id); ant = Math.sin(tt / 90) * 0.09; buzz = true; dangle = 1;
    }

    this.pivot.position.set(PIVOT.x + x, PIVOT.y + lift, 0);
    this.pivot.rotation.set(0, yaw, pitch + flip);
    this.head.rotation.set(0, hy, hp);
    this.antennae.forEach(function (a) { a.rotation.z = ant; });

    // wings: a narrow V at rest, sloping down at the edges like a tent; beating when it flies
    var curl = this.look.wingCurl || 0, beat = Math.sin(t * 0.83 + this.id);
    this.wings.forEach(function (w) {
      var sp = buzz ? 0.95 : 0.12 + spread;
      w.pivot.rotation.set(buzz ? 0 : w.side * 0.3, w.side * sp, -(buzz ? 0.45 + 0.6 * beat : 0.04 + elev + curl));
      w.ghost.visible = buzz;
      if (buzz) w.ghost.rotation.set(0, w.side * sp, -(0.45 - 0.6 * beat));
    });

    // legs: feet planted, the front pair gestures; tucked up in flight
    var tr = 0.5 + 0.5 * Math.sin(tt / 55);
    this.legs.forEach(function (leg) {
      var ankle = leg.foot.clone().add(new T.Vector3(-2, 13, 0)), toe = new T.Vector3(5, -13, leg.side * 3);
      if (leg.front) {
        var off = leg.side === ns ? near : far;
        if (groom) {                       // rub the front legs together in front of the face
          ankle.lerp(new T.Vector3(100, 66 + 8 * (leg.side === ns ? tr : 1 - tr), leg.side * (6 + 5 * tr)), groom);
          toe.lerp(new T.Vector3(10, 4, -leg.side * 3), groom);
        }
        if (off) { ankle.add(new T.Vector3(off[0], off[1], off[2])); toe.lerp(new T.Vector3(12, -4, 0), clamp01(off[1] / 24)); }
      }
      if (dangle) { ankle.add(new T.Vector3(-10 * dangle, 24 * dangle, -leg.side * 6 * dangle)); toe.lerp(new T.Vector3(-4, -12, 0), dangle); }
      var j = joint(leg.hip, ankle, leg.len[0], leg.len[1], leg.bend);
      rod(leg.segs[0], leg.hip, j.mid, 3.4); rod(leg.segs[1], j.mid, j.end, 2.8); rod(leg.segs[2], j.end, j.end.clone().add(toe), 2);
      leg.knee.position.copy(j.mid);
    });

    var gl = this.glowFade ? this.glowA * clamp01(1 - (t - this.glowAt) / this.glowFade) : this.glowA;
    this.light.intensity = gl * 2.2; this.halo.material.opacity = gl * 0.75;
  };

  K.Fly = Fly;
  K.FLY_LOOKS = LOOKS;
})(self);
