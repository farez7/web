/* =========================================================
   Iconos animados Lottie — Jh Company
   Cada icono es un JSON Lottie (formato Bodymovin) construido en código,
   así funcionan abriendo index.html directamente, sin servidor.

   ¿Quieres usar un Lottie descargado de LottieFiles?
   Pega su JSON y devuélvelo en la función del icono, por ejemplo:
     qr: () => ({ "v": "5.7.4", "fr": 60, ... })
   ========================================================= */
(function () {
  'use strict';

  const FR = 60;      // cuadros por segundo
  const OP = 180;     // duración: 3 s por ciclo
  const SIZE = 120;   // lienzo 120 × 120

  /* ---------- Colores ---------- */
  const hex = (h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1];
  };
  const C = {
    red: hex('#ff4a3d'),
    crimson: hex('#ee0a3f'),
    white: [1, 1, 1, 1],
    ink: hex('#15121c'),
    amber: hex('#ffb547'),
    violet: hex('#b86bff'),
    sky: hex('#3db2ff'),
    yellow: hex('#ffd23d'),
    teal: hex('#2ee6c5'),
    pink: hex('#ff5fa2'),
    night: hex('#1a1422')
  };

  /* ---------- Propiedades ---------- */
  const EASE = [0.45, 0, 0.55, 1];
  const LINEAR = [0, 0, 1, 1];
  const st = (v) => ({ a: 0, k: v });
  const prop = (v) => (v && typeof v === 'object' && v.a !== undefined ? v : st(v));
  const arr = (v) => (Array.isArray(v) ? v : [v]);

  // anim([[cuadro, valor], ...]) → propiedad animada
  function anim(keys, ease) {
    const e = ease || EASE;
    return {
      a: 1,
      k: keys.map(([t, v], i) => {
        const k = { t, s: arr(v) };
        if (i < keys.length - 1) {
          k.e = arr(keys[i + 1][1]);
          k.o = { x: e[0], y: e[1] };
          k.i = { x: e[2], y: e[3] };
        }
        return k;
      })
    };
  }

  // Ida y vuelta suave repartida en todo el ciclo: loop([a, b, a])
  const loop = (vals) => anim(vals.map((v, i) => [Math.round(OP * i / (vals.length - 1)), v]));

  // Oscilación senoidal que cierra el ciclo sin saltos
  function wave(lo, hi, cycles, phase) {
    const keys = [];
    for (let t = 0; t <= OP; t += 10) {
      const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * (cycles || 1) * t / OP + (phase || 0));
      keys.push([t, Array.isArray(lo) ? lo.map((l, i) => l + (hi[i] - l) * k) : lo + (hi - lo) * k]);
    }
    return anim(keys, LINEAR);
  }

  /* ---------- Formas ---------- */
  const rect = (w, h, r, p) => ({ ty: 'rc', d: 1, s: st([w, h]), p: st(p || [0, 0]), r: st(r || 0) });
  const ellipse = (w, h, p) => ({ ty: 'el', d: 1, s: st([w, h]), p: st(p || [0, 0]) });
  const star = (outer, inner, points, p) => ({
    ty: 'sr', sy: 1, d: 1, pt: st(points || 5), p: st(p || [0, 0]), r: st(0),
    ir: st(inner), is: st(0), or: st(outer), os: st(0)
  });
  const path = (v, closed, inT, outT) => ({
    ty: 'sh', d: 1,
    ks: st({ v, i: inT || v.map(() => [0, 0]), o: outT || v.map(() => [0, 0]), c: closed !== false })
  });
  const fill = (c, o) => ({ ty: 'fl', c: st(c), o: prop(o === undefined ? 100 : o), r: 1, bm: 0 });
  const stroke = (c, w, o) => ({ ty: 'st', c: st(c), o: prop(o === undefined ? 100 : o), w: st(w), lc: 2, lj: 2, ml: 4, bm: 0 });
  const grad = (c1, c2, s, e) => ({
    ty: 'gf', o: st(100), r: 1, bm: 0, t: 1,
    g: { p: 2, k: st([0, c1[0], c1[1], c1[2], 1, c2[0], c2[1], c2[2]]) },
    s: st(s), e: st(e)
  });
  const trim = (s, e) => ({ ty: 'tm', s: prop(s), e: prop(e), o: st(0), m: 1 });

  function group(items, t) {
    t = t || {};
    return {
      ty: 'gr',
      it: items.concat([{
        ty: 'tr',
        p: prop(t.p || [0, 0]), a: prop(t.a || [0, 0]), s: prop(t.s || [100, 100]),
        r: prop(t.r || 0), o: prop(t.o === undefined ? 100 : t.o), sk: st(0), sa: st(0)
      }])
    };
  }

  function layer(shapes, t) {
    t = t || {};
    return {
      ddd: 0, ty: 4, sr: 1, ao: 0, bm: 0, ip: 0, op: OP, st: 0,
      ks: {
        o: prop(t.o === undefined ? 100 : t.o), r: prop(t.r || 0),
        p: prop(t.p || [60, 60, 0]), a: prop(t.a || [0, 0, 0]), s: prop(t.s || [100, 100, 100])
      },
      shapes
    };
  }

  // Las capas se listan de adelante hacia atrás
  function comp(name, layers) {
    return {
      v: '5.7.4', fr: FR, ip: 0, op: OP, w: SIZE, h: SIZE, nm: name, ddd: 0, assets: [], markers: [],
      layers: layers.map((l, i) => Object.assign(l, { ind: i + 1, nm: name + '_' + (i + 1) }))
    };
  }

  // Corazón: cuadrado girado + dos círculos (centro visual en 0,0)
  function heart(color, size, border) {
    const shapes = () => [rect(16, 16, 0), ellipse(16, 16, [0, -8]), ellipse(16, 16, [-8, 0])];
    const k = (size || 100);
    const out = [group(shapes().concat([fill(color)]), { a: [-4, -4], r: 45, s: [k, k] })];
    if (border) out.push(group(shapes().concat([fill(border)]), { a: [-4, -4], r: 45, s: [k * 1.4, k * 1.4] }));
    return out;
  }

  // Aparece con rebote, se mantiene y desaparece
  const pop = (tin, tout) => anim([
    [0, [0, 0, 100]], [tin, [0, 0, 100]], [tin + 12, [115, 115, 100]], [tin + 20, [100, 100, 100]],
    [tout, [100, 100, 100]], [tout + 12, [0, 0, 100]], [OP, [0, 0, 100]]
  ]);

  const sparkle = (p, size, color, phase) => layer(
    [group([star(size, size * 0.28, 4), fill(color || C.white)])],
    { p, s: wave([25, 25, 100], [100, 100, 100], 2, phase || 0), r: wave(0, 45, 1, phase || 0) }
  );

  /* =========================================================
     ICONOS
     ========================================================= */
  const ICONS = {

    /* ---------- QR Generator ---------- */
    qr() {
      const finders = [[-20, -20], [20, -20], [-20, 20]];
      const mods = [[-3, -27], [3, -21], [-3, -15], [-27, 3], [-21, -3], [-15, 3], [-3, -3], [3, 3],
        [9, -3], [-3, 9], [15, -3], [21, 3], [27, -3], [3, 15], [-3, 21], [3, 27], [15, 15],
        [21, 21], [27, 15], [15, 27], [27, 27], [21, 9]];
      const card = [
        group([ // línea de escaneo
          group([rect(66, 4, 2), fill(C.red)]),
          group([rect(66, 18, 9), fill(C.red, 25)])
        ], { p: anim([[0, [0, -28]], [90, [0, 28]], [180, [0, -28]]]) }),
        group(finders.map((p) => rect(8, 8, 2, p)).concat([fill(C.ink)])),
        group(finders.map((p) => rect(18, 18, 4, p)).concat([stroke(C.ink, 4)])),
        group(mods.map((p) => rect(5, 5, 1, p)).concat([fill(C.ink)]), { o: wave(100, 55, 2) }),
        group([rect(76, 76, 14), fill(C.white)]),
        group([rect(76, 76, 14, [3, 5]), fill([0, 0, 0, 1], 35)])
      ];
      const brackets = group([
        path([[-46, -30], [-46, -46], [-30, -46]], false),
        path([[30, -46], [46, -46], [46, -30]], false),
        path([[46, 30], [46, 46], [30, 46]], false),
        path([[-30, 46], [-46, 46], [-46, 30]], false),
        stroke(C.red, 5)
      ]);
      return comp('qr', [
        sparkle([100, 18, 0], 9, C.white, 0),
        layer(card, { r: wave(-5, 5, 1) }),
        layer([brackets], { s: wave([100, 100, 100], [108, 108, 100], 2) })
      ]);
    },

    /* ---------- Stickers ---------- */
    stickers() {
      const face = [
        group([ellipse(7, 11, [-10, -6]), ellipse(7, 11, [10, -6]), fill(C.ink)], {
          a: [0, -6], p: [0, -6],
          s: anim([[0, [100, 100]], [96, [100, 100]], [102, [100, 12]], [108, [100, 100]], [180, [100, 100]]])
        }),
        group([path([[-14, 6], [14, 6]], false, [[0, 0], [-7, 10]], [[7, 10], [0, 0]]), stroke(C.ink, 5)]),
        group([ellipse(9, 6, [-19, 8]), ellipse(9, 6, [19, 8]), fill(C.crimson, 45)]),
        group([ellipse(60, 60), fill(C.amber)]),
        group([ellipse(72, 72), fill(C.white)]),
        group([ellipse(72, 72, [3, 5]), fill([0, 0, 0, 1], 35)])
      ];
      return comp('stickers', [
        layer(heart(C.red, 100, C.white), { p: [90, 30, 0], s: pop(20, 150), r: wave(-12, 12, 2) }),
        sparkle([22, 26, 0], 8, C.yellow, 1.5),
        layer(face, { p: wave([54, 66, 0], [54, 61, 0], 1), r: wave(-8, 6, 1) }),
        layer([
          group([star(12, 5.5, 5), fill(C.amber)]),
          group([star(17, 8.5, 5), fill(C.white)])
        ], { p: [28, 92, 0], r: anim([[0, 0], [OP, 72]], LINEAR), s: wave([90, 90, 100], [110, 110, 100], 2) })
      ]);
    },

    /* ---------- Wallpapers ---------- */
    wallpapers() {
      const phone = [
        group([rect(14, 4, 2, [0, -34]), fill(C.ink)]),
        group([path([[-22, 39], [-22, 18], [-9, 5], [3, 17], [11, 9], [22, 20], [22, 39]]), fill(C.night)]),
        group([path([[-22, 39], [-22, 8], [-12, -2], [1, 11], [22, -6], [22, 39]]), fill(C.white, 22)]),
        group([ellipse(14, 14), fill(C.white, 95)], { p: anim([[0, [8, 22]], [55, [8, -20]], [125, [8, -20]], [180, [8, 22]]]) }),
        group([rect(44, 78, 8), grad(C.amber, C.crimson, [0, -39], [0, 39])], {
          o: anim([[0, 0], [70, 0], [90, 100], [160, 100], [180, 0]])
        }),
        group([rect(44, 78, 8), grad(C.violet, C.crimson, [0, -39], [0, 39])]),
        group([rect(54, 90, 13), stroke(C.white, 3.5), fill(C.ink)])
      ];
      return comp('wallpapers', [
        layer(phone, { r: wave(-7, 5, 1) }),
        layer([group([rect(24, 32, 5), grad(C.red, C.amber, [0, -16], [0, 16])])],
          { p: wave([24, 78, 0], [22, 70, 0], 1), r: -16 }),
        layer([group([rect(24, 32, 5), grad(C.violet, C.sky, [0, -16], [0, 16])])],
          { p: wave([96, 42, 0], [98, 50, 0], 1), r: 14 })
      ]);
    },

    /* ---------- Chat ---------- */
    chat() {
      const dots = [-13, 0, 13].map((x, i) => {
        const keys = [[0, [x, 0]]];
        for (let t = i * 8; t + 20 <= OP; t += 45) {
          if (t > 0) keys.push([t, [x, 0]]);
          keys.push([t + 10, [x, -7]], [t + 20, [x, 0]]);
        }
        keys.push([OP, [x, 0]]);
        return group([ellipse(9, 9), fill(C.white)], { p: anim(keys) });
      });
      const big = dots.concat([
        group([rect(66, 46, 23), path([[-18, 14], [-26, 30], [-4, 20]]), grad(C.red, C.crimson, [-33, -23], [33, 23])])
      ]);
      const small = heart(C.red, 55).concat([
        group([rect(40, 28, 14), path([[8, 8], [18, 20], [0, 13]]), fill(C.white)]),
        group([rect(40, 28, 14, [2, 4]), fill([0, 0, 0, 1], 30)])
      ]);
      return comp('chat', [
        layer(small, { a: [18, 20, 0], p: [102, 102, 0], s: pop(55, 160) }),
        layer(big, { p: wave([50, 50, 0], [50, 45, 0], 1), r: wave(-3, 3, 1) }),
        sparkle([98, 22, 0], 7, C.sky, 2)
      ]);
    },

    /* ---------- Quiz ---------- */
    quiz() {
      const q = path([[-12, -10], [0, -22], [12, -10], [0, 2], [0, 8]], false,
        [[0, 0], [-7, 0], [0, -7], [0, -6], [0, 0]],
        [[0, -7], [7, 0], [0, 6], [0, 0], [0, 0]]);
      const mark = [
        group([ellipse(10, 10, [0, 20]), fill(C.white)], {
          a: [0, 20], p: [0, 20],
          s: anim([[0, [0, 0]], [38, [0, 0]], [50, [135, 135]], [58, [100, 100]], [150, [100, 100]], [164, [0, 0]], [180, [0, 0]]])
        }),
        group([q,
          trim(anim([[0, 0], [140, 0], [168, 100], [180, 100]]), anim([[0, 0], [42, 100], [180, 100]])),
          stroke(C.white, 8)])
      ];
      const badge = [
        group([ellipse(62, 62), stroke(C.white, 2, 25)]),
        group([ellipse(76, 76), grad(C.red, C.crimson, [-38, -38], [38, 38])])
      ];
      const orbit = [
        group([ellipse(12, 12, [0, -50]), fill(C.yellow)]),
        group([ellipse(9, 9, [43.3, 25]), fill(C.white)]),
        group([ellipse(7, 7, [-43.3, 25]), fill(C.yellow, 70)])
      ];
      return comp('quiz', [
        layer(mark, { p: [60, 59, 0] }),
        layer(orbit, { r: anim([[0, 0], [OP, 360]], LINEAR) }),
        layer(badge, { s: wave([100, 100, 100], [106, 106, 100], 2) })
      ]);
    },

    /* ---------- Ringtones ---------- */
    ringtone() {
      const swing = anim([[0, 0], [8, 16], [18, -14], [28, 10], [38, -6], [48, 3], [58, 0], [90, 0],
        [98, 16], [108, -14], [118, 10], [128, -6], [138, 3], [148, 0], [180, 0]]);
      const bellBody = path([[-22, 12], [-16, -4], [0, -20], [16, -4], [22, 12]], true,
        [[0, 0], [0, 7], [-9, 0], [0, -9], [-5, -5]],
        [[5, -5], [0, -9], [9, 0], [0, 7], [0, 0]]);
      const bell = [
        group([path([[-9, -9], [-12, 4]], false), stroke(C.white, 3.5, 45)]),
        group([rect(50, 7, 3.5, [0, 15]), fill(C.white)]),
        group([bellBody, grad(C.red, C.crimson, [0, -20], [0, 14])]),
        group([ellipse(9, 9, [0, -23]), fill(C.white)]),
        group([ellipse(12, 12, [0, 21]), fill(C.white)])
      ];
      const waveProps = (d) => ({
        o: anim([[0, 0], [6 + d, 100], [44 + d, 100], [56 + d, 0], [90, 0], [96 + d, 100], [134 + d, 100], [146 + d, 0], [180, 0]]),
        s: anim([[0, [85, 85]], [20 + d, [105, 105]], [56 + d, [112, 112]], [90, [85, 85]], [110 + d, [105, 105]], [146 + d, [112, 112]], [180, [85, 85]]])
      });
      const arc = (d, s, e, delay) => group([ellipse(d, d), trim(s, e), stroke(C.teal, 5)], waveProps(delay));
      const note = (p, phase) => layer([
        group([ellipse(11, 8, [-3, 8]), rect(3, 20, 1.5, [1.5, -2]), path([[0, -12], [11, -8], [11, -3], [0, -7]]), fill(C.teal)], { r: -8 })
      ], { p: wave([p[0], p[1] + 6, 0], [p[0] + 4, p[1] - 8, 0], 1, phase), o: wave(35, 100, 1, phase), s: [75, 75, 100] });
      return comp('ringtone', [
        layer(bell, { p: [60, 36, 0], a: [0, -22, 0], r: swing }),
        layer([arc(60, 17, 33, 0), arc(60, 67, 83, 0), arc(84, 18, 32, 8), arc(84, 68, 82, 8)], { p: [60, 58, 0] }),
        note([98, 26], 0),
        note([22, 28], Math.PI)
      ]);
    },

    /* ---------- Nick Name ---------- */
    nickname() {
      const card = [
        group([path([[-4, -8], [28, -8]], false),
          trim(0, anim([[0, 0], [30, 100], [150, 100], [166, 0], [180, 0]])), stroke(C.ink, 5)]),
        group([path([[-4, 3], [20, 3]], false),
          trim(0, anim([[0, 0], [16, 0], [44, 100], [150, 100], [162, 0], [180, 0]])), stroke(C.ink, 5, 30)]),
        group([path([[-4, 14], [10, 14]], false),
          trim(0, anim([[0, 0], [30, 0], [56, 100], [150, 100], [158, 0], [180, 0]])), stroke(C.pink, 5)]),
        group([ellipse(9, 9, [-24, -4]), rect(15, 8, 4, [-24, 6]), fill(C.white)]),
        group([ellipse(28, 28, [-24, 0]), grad(C.red, C.pink, [-38, -14], [-10, 14])]),
        group([rect(86, 58, 14), fill(C.white)]),
        group([rect(86, 58, 14, [3, 5]), fill([0, 0, 0, 1], 35)])
      ];
      const crown = [
        group([ellipse(4, 4, [-14, -8]), ellipse(4, 4, [0, -12]), ellipse(4, 4, [14, -8]), fill(C.white)]),
        group([path([[-12, 6], [-14, -7], [-6, -1], [0, -10], [6, -1], [14, -7], [12, 6]]), fill(C.yellow)])
      ];
      return comp('nickname', [
        layer(crown, { p: wave([36, 29, 0], [36, 23, 0], 2), r: -14 }),
        sparkle([102, 24, 0], 9, C.white, 0),
        sparkle([106, 98, 0], 6, C.pink, 2),
        sparkle([14, 96, 0], 7, C.yellow, 4),
        layer(card, { p: wave([60, 66, 0], [60, 62, 0], 1), r: wave(-4, 4, 1) })
      ]);
    }
  };

  window.JH_ICONS = ICONS;
})();
