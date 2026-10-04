/* =========================================================
   Flork Animator — análisis automático de SVG → Lottie
   Se ejecuta dentro del navegador (Chromium vía Playwright).

   1. Monta el SVG y lo recorre en orden de pintado.
   2. Convierte cada elemento a formas Lottie (trazados, rellenos,
      degradados, contornos, recortes). Lo que no se puede convertir
      fielmente se incrusta como imagen.
   3. Verifica píxel a píxel contra el SVG original; corrige los
      elementos que no coinciden.
   4. Detecta ojos, boca, partes salientes y elementos sueltos y
      decide qué animar, con amplitudes limitadas para no romper uniones.
   5. Renderiza fotogramas para detectar recortes del lienzo y
      saltos en el loop; corrige y repite.
   ========================================================= */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const FR = 30;
  const OP = 90;               // 3 s exactos a 30 fps
  const SCALE_PX = 420;        // resolución de análisis (lado mayor)
  const RASTER_SCALE = 3;      // calidad de imágenes de respaldo
  const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'linearGradient', 'radialGradient',
    'style', 'title', 'desc', 'metadata', 'script', 'filter', 'font', 'font-face', 'switch']);
  const VECTOR = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

  // ---------------------------------------------------------------- geometry
  function quad(p0, q, p) {
    return [p0, [p0[0] + 2 / 3 * (q[0] - p0[0]), p0[1] + 2 / 3 * (q[1] - p0[1])],
      [p[0] + 2 / 3 * (q[0] - p[0]), p[1] + 2 / 3 * (q[1] - p[1])], p];
  }

  function arc(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    if (!rx || !ry) return [[[x1, y1], [x1, y1], [x2, y2], [x2, y2]]];
    rx = Math.abs(rx); ry = Math.abs(ry);
    const p = phi * Math.PI / 180, cp = Math.cos(p), sp = Math.sin(p);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
    const sign = fa !== fs ? 1 : -1;
    const num = Math.max(0, rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p);
    const co = sign * Math.sqrt(num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p));
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)), d = dt / n, k = 4 / 3 * Math.tan(d / 4);
    const pt = t => [cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp];
    const dv = t => [-rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp];
    const out = [];
    let prev = [x1, y1], t = t1;
    for (let j = 0; j < n; j++) {
      const t2 = t + d, p2 = j === n - 1 ? [x2, y2] : pt(t2), d1 = dv(t), d2 = dv(t2);
      out.push([prev, [prev[0] + k * d1[0], prev[1] + k * d1[1]], [p2[0] - k * d2[0], p2[1] - k * d2[1]], p2]);
      prev = p2; t = t2;
    }
    return out;
  }

  function parsePath(d) {
    const toks = (d || '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, lc = null, lq = null;
    const subs = [];
    let segs = [], closed = false;
    const n = () => parseFloat(toks[i++]);
    const flag = () => { const t = toks[i]; if (t.length > 1) { toks[i] = t.slice(1); return +t[0]; } i++; return +t; };
    const flush = () => { if (segs.length) subs.push({ segs, closed }); segs = []; closed = false; };
    const line = (x, y) => { segs.push([[cx, cy], [cx, cy], [x, y], [x, y]]); cx = x; cy = y; };
    while (i < toks.length) {
      if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
      else if (!cmd) { i++; continue; }
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      const ox = rel ? cx : 0, oy = rel ? cy : 0;
      if (C === 'Z') {
        if (Math.hypot(cx - sx, cy - sy) > 1e-9) line(sx, sy);
        closed = true; flush(); cx = sx; cy = sy; lc = lq = null;
        continue;
      }
      if (i >= toks.length) break;
      if (C === 'M') { flush(); cx = n() + ox; cy = n() + oy; sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; lc = lq = null; }
      else if (C === 'L') { line(n() + ox, n() + oy); lc = lq = null; }
      else if (C === 'H') { line(n() + (rel ? cx : 0), cy); lc = lq = null; }
      else if (C === 'V') { line(cx, n() + (rel ? cy : 0)); lc = lq = null; }
      else if (C === 'C') {
        const c1 = [n() + ox, n() + oy], c2 = [n() + ox, n() + oy], p = [n() + ox, n() + oy];
        segs.push([[cx, cy], c1, c2, p]); lc = c2; lq = null; cx = p[0]; cy = p[1];
      } else if (C === 'S') {
        const c1 = lc ? [2 * cx - lc[0], 2 * cy - lc[1]] : [cx, cy];
        const c2 = [n() + ox, n() + oy], p = [n() + ox, n() + oy];
        segs.push([[cx, cy], c1, c2, p]); lc = c2; lq = null; cx = p[0]; cy = p[1];
      } else if (C === 'Q') {
        const q = [n() + ox, n() + oy], p = [n() + ox, n() + oy];
        segs.push(quad([cx, cy], q, p)); lq = q; lc = null; cx = p[0]; cy = p[1];
      } else if (C === 'T') {
        const q = lq ? [2 * cx - lq[0], 2 * cy - lq[1]] : [cx, cy], p = [n() + ox, n() + oy];
        segs.push(quad([cx, cy], q, p)); lq = q; lc = null; cx = p[0]; cy = p[1];
      } else if (C === 'A') {
        const rx = n(), ry = n(), phi = n(), fa = flag(), fs = flag(), x = n() + ox, y = n() + oy;
        for (const s of arc(cx, cy, rx, ry, phi, fa, fs, x, y)) segs.push(s);
        cx = x; cy = y; lc = lq = null;
      } else i++;
    }
    flush();
    return subs;
  }

  function shapePath(el) {
    const tag = el.tagName;
    const v = a => (el[a] && el[a].baseVal ? el[a].baseVal.value : parseFloat(el.getAttribute(a)) || 0);
    if (tag === 'path') return el.getAttribute('d');
    if (tag === 'rect') {
      const x = v('x'), y = v('y'), w = v('width'), h = v('height');
      if (w <= 0 || h <= 0) return '';
      let rx = el.hasAttribute('rx') ? v('rx') : null, ry = el.hasAttribute('ry') ? v('ry') : null;
      if (rx === null) rx = ry || 0; if (ry === null) ry = rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
        `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    if (tag === 'circle' || tag === 'ellipse') {
      const cx = v('cx'), cy = v('cy');
      const rx = tag === 'circle' ? v('r') : v('rx'), ry = tag === 'circle' ? v('r') : v('ry');
      if (rx <= 0 || ry <= 0) return '';
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    if (tag === 'line') return `M${v('x1')} ${v('y1')}L${v('x2')} ${v('y2')}`;
    if (tag === 'polyline' || tag === 'polygon') {
      const nums = (el.getAttribute('points') || '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
      if (nums.length < 4) return '';
      let d = `M${nums[0]} ${nums[1]}`;
      for (let k = 2; k + 1 < nums.length; k += 2) d += `L${nums[k]} ${nums[k + 1]}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
    return '';
  }

  const tp = (m, p) => [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
  const transformSubs = (subs, m) => subs.map(s => ({ closed: s.closed, segs: s.segs.map(seg => seg.map(p => tp(m, p))) }));
  const r2 = v => Math.round(v * 100) / 100;

  function lottiePath(sub, ox, oy) {
    const v = [[sub.segs[0][0][0] + ox, sub.segs[0][0][1] + oy]], ins = [[0, 0]], outs = [];
    for (const [p0, c1, c2, p3] of sub.segs) {
      outs.push([c1[0] - p0[0], c1[1] - p0[1]]);
      v.push([p3[0] + ox, p3[1] + oy]);
      ins.push([c2[0] - p3[0], c2[1] - p3[1]]);
    }
    outs.push([0, 0]);
    if (sub.closed && v.length > 1 && Math.hypot(v[0][0] - v[v.length - 1][0], v[0][1] - v[v.length - 1][1]) < 1e-3) {
      ins[0] = ins[ins.length - 1]; v.pop(); ins.pop(); outs.pop();
    }
    const R = a => a.map(p => [r2(p[0]), r2(p[1])]);
    return { i: R(ins), o: R(outs), v: R(v), c: !!sub.closed };
  }

  // ---------------------------------------------------------------- colours & paints
  function parseColor(s) {
    if (!s || s === 'none' || s === 'transparent') return null;
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    return { rgb: [p[0] / 255, p[1] / 255, p[2] / 255], a };
  }
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  function numAttr(g, name, def, obb, extent) {
    let el = g, s = null;
    while (el) {
      if (el.hasAttribute(name)) { s = el.getAttribute(name); break; }
      const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      el = href ? el.ownerSVGElement.querySelector(href) : null;
    }
    if (s === null) return def;
    if (s.trim().endsWith('%')) return parseFloat(s) / 100 * (obb ? 1 : extent);
    return parseFloat(s);
  }

  function gradientChain(g) {
    const chain = [];
    let el = g;
    while (el && chain.length < 10) {
      chain.push(el);
      const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      el = href ? g.ownerSVGElement.querySelector(href) : null;
    }
    return chain;
  }

  // Devuelve un ítem Lottie de degradado o null si no se puede representar.
  function gradientItem(paintStr, el, M, isStroke, opacity, vb, approxFlags) {
    const m = paintStr.match(/url\(["']?#([^"')]+)["']?\)/);
    if (!m) return null;
    const svg = el.ownerSVGElement || el.closest('svg');
    const g = svg.querySelector('#' + CSS.escape(m[1]));
    if (!g || !/Gradient$/.test(g.tagName)) return null;
    const chain = gradientChain(g);
    const stopsHost = chain.find(c => c.querySelector('stop'));
    if (!stopsHost) return null;
    const stops = [...stopsHost.querySelectorAll(':scope > stop')].map(s => {
      const cs = getComputedStyle(s);
      const c = parseColor(cs.stopColor) || { rgb: [0, 0, 0], a: 1 };
      let off = s.getAttribute('offset') || '0';
      off = off.trim().endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
      return { off: Math.min(1, Math.max(0, off || 0)), rgb: c.rgb, a: c.a * parseFloat(cs.stopOpacity || 1) };
    });
    for (let k = 1; k < stops.length; k++) stops[k].off = Math.max(stops[k].off, stops[k - 1].off);
    const unitsHost = chain.find(c => c.hasAttribute('gradientUnits'));
    const obb = !unitsHost || unitsHost.getAttribute('gradientUnits') !== 'userSpaceOnUse';
    const spread = (chain.find(c => c.hasAttribute('spreadMethod')) || { getAttribute: () => 'pad' }).getAttribute('spreadMethod');
    if (spread && spread !== 'pad') approxFlags.push('spread');
    const gtHost = chain.find(c => c.hasAttribute('gradientTransform'));
    const gt = gtHost ? (gtHost.gradientTransform.baseVal.consolidate() || { matrix: new DOMMatrix() }).matrix : new DOMMatrix();
    let bb = { x: 0, y: 0, width: 1, height: 1 };
    if (obb) { try { bb = el.getBBox(); } catch (e) { return null; } if (!bb.width || !bb.height) return null; }
    const toComp = p => {
      let q = tp(gt, p);
      if (obb) q = [bb.x + q[0] * bb.width, bb.y + q[1] * bb.height];
      return tp(M, q);
    };
    let s, e, t;
    if (g.tagName === 'linearGradient') {
      t = 1;
      s = toComp([numAttr(g, 'x1', 0, obb, vb.width), numAttr(g, 'y1', 0, obb, vb.height)]);
      e = toComp([numAttr(g, 'x2', obb ? 1 : vb.width, obb, vb.width), numAttr(g, 'y2', 0, obb, vb.height)]);
    } else {
      t = 2;
      const cx = numAttr(g, 'cx', obb ? 0.5 : vb.width / 2, obb, vb.width);
      const cy = numAttr(g, 'cy', obb ? 0.5 : vb.height / 2, obb, vb.height);
      const r = numAttr(g, 'r', obb ? 0.5 : Math.hypot(vb.width, vb.height) / Math.SQRT2 / 2, obb, Math.hypot(vb.width, vb.height) / Math.SQRT2);
      const fx = numAttr(g, 'fx', cx, obb, vb.width), fy = numAttr(g, 'fy', cy, obb, vb.height);
      if (fx !== cx || fy !== cy) approxFlags.push('focal');
      s = toComp([cx, cy]);
      e = toComp([cx + r, cy]);
      const ey = toComp([cx, cy + r]);
      const rx = Math.hypot(e[0] - s[0], e[1] - s[1]), ry = Math.hypot(ey[0] - s[0], ey[1] - s[1]);
      if (Math.abs(rx - ry) > 0.02 * Math.max(rx, ry)) approxFlags.push('elliptical');
    }
    const colors = [], alphas = [];
    let needAlpha = false;
    for (const st of stops) {
      colors.push(st.off, ...st.rgb.map(r2v));
      alphas.push(st.off, st.a);
      if (st.a < 0.999) needAlpha = true;
    }
    const item = {
      ty: isStroke ? 'gs' : 'gf', o: { a: 0, k: Math.round(opacity * 1000) / 10 }, r: 1,
      g: { p: stops.length, k: { a: 0, k: needAlpha ? colors.concat(alphas) : colors } },
      s: { a: 0, k: s }, e: { a: 0, k: e }, t, nm: 'gradient', _pts: [s, e],
    };
    if (t === 2) { item.h = { a: 0, k: 0 }; item.a = { a: 0, k: 0 }; }
    return item;
  }
  const r2v = v => Math.round(v * 10000) / 10000;

  // ---------------------------------------------------------------- render helpers
  function loadImage(svgString) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('render failed'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    });
  }

  async function rasterize(svgString, cw, ch, dx = 0, dy = 0, w = cw, h = ch) {
    const img = await loadImage(svgString);
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const x = c.getContext('2d');
    x.drawImage(img, dx, dy, w, h);
    return x.getImageData(0, 0, cw, ch).data;
  }

  function dilate(mask, w, h, r = 1) {
    let src = mask;
    for (let k = 0; k < r; k++) {
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] || (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) out[i] = 1;
      }
      src = out;
    }
    return src;
  }

  function fillRegion(mask, w, h) {
    const m = dilate(mask, w, h, 1);
    const outside = new Uint8Array(w * h), stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      if (outside[i] || m[i]) continue;
      outside[i] = 1;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - w); if (y < h - 1) stack.push(i + w);
    }
    const reg = new Uint8Array(w * h);
    let n = 0;
    for (let i = 0; i < w * h; i++) if (!outside[i]) { reg[i] = 1; n++; }
    return { reg, n };
  }

  function maskStats(mask, w, h) {
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { n, bb: n ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null };
  }

  function toUrl(data, w, h, isMask) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'), im = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      if (isMask) { const v = data[i] ? 0 : 255; im.data.set([255, v, v, 255], i * 4); }
      else im.data.set([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]], i * 4);
    }
    x.putImageData(im, 0, 0); return c.toDataURL();
  }

  // ---------------------------------------------------------------- keyframes
  const EASE = {
    out: { o: 0.61, oy: 1, i: 0.88, iy: 1 },     // ease-out sine: 0 → extremo
    in: { o: 0.12, oy: 0, i: 0.39, iy: 0 },      // ease-in sine: extremo → 0
    inout: { o: 0.37, oy: 0, i: 0.63, iy: 1 },   // ease-in-out sine
    snap: { o: 0.4, oy: 0, i: 0.6, iy: 1 },
  };

  function kf(keys, spatial = false) {
    return {
      a: 1, k: keys.map((k, j) => {
        const o = { t: r2(k.t), s: k.s };
        if (j < keys.length - 1) {
          const e = EASE[k.e || 'inout'], n = k.s.length;
          o.o = { x: Array(n).fill(e.o), y: Array(n).fill(e.oy) };
          o.i = { x: Array(n).fill(e.i), y: Array(n).fill(e.iy) };
          if (spatial) { o.to = Array(n).fill(0); o.ti = Array(n).fill(0); }
        }
        return o;
      }),
    };
  }

  // Oscilación seno perfecta en bucle: 0 → +A → 0 → −A → 0
  function oscillate(rest, amp, sign = 1) {
    const at = f => rest.map((r, k) => r2(r + f * amp[k] * sign));
    return [
      { t: 0, s: at(0), e: 'out' }, { t: OP / 4, s: at(1), e: 'in' }, { t: OP / 2, s: at(0), e: 'out' },
      { t: OP * 3 / 4, s: at(-1), e: 'in' }, { t: OP, s: at(0) },
    ];
  }

  function staticKs(a = [0, 0]) {
    return { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [a[0], a[1], 0] }, a: { a: 0, k: [a[0], a[1], 0] }, s: { a: 0, k: [100, 100, 100] } };
  }

  // ================================================================ main
  async function analyze(svgText, options = {}) {
    const report = { checks: [], corrections: [], tracks: [], warnings: [] };
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;';
    host.innerHTML = svgText;
    document.body.appendChild(host);
    const svg = host.querySelector('svg');
    if (!svg) throw new Error('No se encontró un elemento <svg>.');

    const kill = document.createElementNS(NS, 'style');
    kill.textContent = '*{animation:none!important;transition:none!important}';
    svg.insertBefore(kill, svg.firstChild);

    // <use> → copia real del elemento referenciado
    for (const u of [...svg.querySelectorAll('use')]) {
      const href = u.getAttribute('href') || u.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      const ref = href && svg.querySelector(href);
      if (!ref || ref.tagName === 'symbol' || ref.tagName === 'svg') continue;
      const g = document.createElementNS(NS, 'g');
      for (const a of u.attributes) if (!['href', 'xlink:href', 'x', 'y', 'width', 'height'].includes(a.name)) g.setAttribute(a.name, a.value);
      const x = parseFloat(u.getAttribute('x')) || 0, y = parseFloat(u.getAttribute('y')) || 0;
      g.setAttribute('transform', `${u.getAttribute('transform') || ''} translate(${x} ${y})`);
      const clone = ref.cloneNode(true);
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
      g.appendChild(clone);
      u.replaceWith(g);
    }

    let vbv = svg.viewBox && svg.viewBox.baseVal;
    let vb = vbv && vbv.width ? { x: vbv.x, y: vbv.y, width: vbv.width, height: vbv.height } : null;
    if (!vb) {
      const w = parseFloat(svg.getAttribute('width')) || svg.getBBox().width || 512;
      const h = parseFloat(svg.getAttribute('height')) || svg.getBBox().height || 512;
      vb = { x: 0, y: 0, width: w, height: h };
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    const W = vb.width, H = vb.height;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.display = 'block';
    // coordenadas del usuario raíz → lienzo (origen del viewBox en 0,0)
    const rootInv = new DOMMatrix([1, 0, 0, 1, -vb.x, -vb.y]).multiply(svg.getScreenCTM().inverse());
    const S = SCALE_PX / Math.max(W, H);
    const AW = Math.round(W * S), AH = Math.round(H * S);

    // ------------------------------------------------ collect leaves in paint order
    const leaves = [];
    (function walk(node) {
      for (const ch of node.children) {
        const tag = ch.tagName;
        if (SKIP.has(tag) || ch.namespaceURI !== NS) continue;
        const cs = getComputedStyle(ch);
        if (cs.display === 'none') continue;
        if (tag === 'g' || tag === 'a' || tag === 'svg') { walk(ch); continue; }
        leaves.push(ch);
      }
    })(svg);
    leaves.forEach((el, i) => el.setAttribute('data-fa-i', i));
    const work = svg.cloneNode(true);
    const workLeaves = [...work.querySelectorAll('[data-fa-i]')];
    const serialize = (node, attrs) => {
      for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
      return new XMLSerializer().serializeToString(node);
    };
    const isolate = idxSet => workLeaves.forEach((el, i) => { el.style.visibility = idxSet.has(i) ? 'visible' : 'hidden'; });

    // ------------------------------------------------ convert each leaf
    const ancestry = el => { const out = []; let p = el.parentNode; while (p && p !== svg) { out.push(p); p = p.parentNode; } return out; };

    const elements = leaves.map((el, idx) => {
      const tag = el.tagName;
      const cs = getComputedStyle(el);
      const rec = { idx, tag, kind: 'vector', reasons: [], name: (el.id || '') + ' ' + (el.getAttribute('class') || '') };
      let M;
      try { M = rootInv.multiply(el.getScreenCTM()); } catch (e) { rec.kind = 'raster'; rec.reasons.push('ctm'); return rec; }
      rec.M = M;
      let opacity = 1;
      for (const a of [el, ...ancestry(el)]) {
        const s = getComputedStyle(a);
        opacity *= parseFloat(s.opacity);
        if (s.filter && s.filter !== 'none') rec.reasons.push('filter');
        if (s.mask && s.mask !== 'none' && s.mask !== 'none 0% 0% / auto repeat border-box border-box add match-source') {
          if (!/^none/.test(s.mask)) rec.reasons.push('mask');
        }
        if (s.mixBlendMode && s.mixBlendMode !== 'normal') rec.reasons.push('blend');
        rec.name += ' ' + (a.id || '') + ' ' + (a.getAttribute && (a.getAttribute('class') || ''));
      }
      if (cs.visibility === 'hidden' || opacity === 0) { rec.kind = 'skip'; return rec; }
      if (!VECTOR.has(tag)) { rec.kind = 'raster'; rec.reasons.push(tag); return rec; }

      // clip-path (propio y de ancestros) → máscaras Lottie
      const clips = [];
      for (const a of [el, ...ancestry(el)]) {
        const cp = getComputedStyle(a).clipPath;
        if (!cp || cp === 'none') continue;
        const m = cp.match(/url\(["']?#([^"')]+)["']?\)/);
        const cpe = m && svg.querySelector('#' + CSS.escape(m[1]));
        if (!cpe) { rec.reasons.push('clip-shape'); continue; }
        if (getComputedStyle(cpe).clipPath !== 'none') rec.reasons.push('nested-clip');
        let Mref;
        try { Mref = rootInv.multiply(a.getScreenCTM()); } catch (e) { rec.reasons.push('clip-ctm'); continue; }
        if (cpe.getAttribute('clipPathUnits') === 'objectBoundingBox') {
          const bb = a.getBBox();
          Mref = Mref.multiply(new DOMMatrix([bb.width, 0, 0, bb.height, bb.x, bb.y]));
        }
        const paths = [];
        for (const ch of cpe.children) {
          if (!VECTOR.has(ch.tagName)) { if (ch.tagName !== 'title') rec.reasons.push('clip-' + ch.tagName); continue; }
          const ctf = ch.transform && ch.transform.baseVal.consolidate();
          const Mc = ctf ? Mref.multiply(ctf.matrix) : Mref;
          for (const sub of transformSubs(parsePath(shapePath(ch)), Mc)) paths.push({ ...sub, closed: true });
        }
        clips.push(paths);
      }
      if (clips.length > 1 && clips.some(c => c.length > 1)) rec.reasons.push('multi-clip');
      rec.clips = clips;
      rec.clipSig = clips.length ? JSON.stringify(clips.map(c => c.map(s => s.segs[0][0].map(Math.round)))) : '';

      rec.subs = transformSubs(parsePath(shapePath(el)), M);
      if (!rec.subs.length) { rec.kind = 'skip'; return rec; }
      const det = Math.abs(M.a * M.d - M.b * M.c);
      const linScale = Math.sqrt(det);
      if (Math.abs(Math.hypot(M.a, M.b) - Math.hypot(M.c, M.d)) > 0.01 * linScale) rec.approxStroke = true;

      const approx = [];
      const fill = cs.fill, stroke = cs.stroke;
      const fo = parseFloat(cs.fillOpacity) * opacity, so = parseFloat(cs.strokeOpacity) * opacity;
      const sw = parseFloat(cs.strokeWidth) * linScale;
      rec.items = [];
      let fillLum = null, strokeLum = null;
      if (stroke && stroke !== 'none' && sw > 0) {
        let st;
        if (/url\(/.test(stroke)) {
          st = gradientItem(stroke, el, M, true, so, vb, approx);
          if (!st) rec.reasons.push('stroke-paint');
        } else {
          const c = parseColor(stroke);
          if (c) { st = { ty: 'st', c: { a: 0, k: [...c.rgb.map(r2v), 1] }, o: { a: 0, k: Math.round(c.a * so * 1000) / 10 } }; strokeLum = lum(c.rgb); }
        }
        if (st) {
          Object.assign(st, {
            w: { a: 0, k: r2(sw) },
            lc: { butt: 1, round: 2, square: 3 }[cs.strokeLinecap] || 1,
            lj: { miter: 1, round: 2, bevel: 3 }[cs.strokeLinejoin] || 1,
            ml: parseFloat(cs.strokeMiterlimit) || 4,
          });
          if (cs.strokeDasharray && cs.strokeDasharray !== 'none') {
            let arr = cs.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter(x => !isNaN(x)).map(x => x * linScale);
            if (arr.length % 2) arr = arr.concat(arr);
            if (arr.some(x => x > 0)) {
              st.d = arr.map((x, k) => ({ n: k % 2 ? 'g' : 'd', nm: k % 2 ? 'gap' : 'dash', v: { a: 0, k: r2(x) } }));
              st.d.push({ n: 'o', nm: 'offset', v: { a: 0, k: r2((parseFloat(cs.strokeDashoffset) || 0) * linScale) } });
            }
          }
          rec.items.push(st);
          rec.strokeWidth = sw;
        }
      }
      if (fill && fill !== 'none') {
        let fl;
        if (/url\(/.test(fill)) {
          fl = gradientItem(fill, el, M, false, fo, vb, approx);
          if (!fl) rec.reasons.push('fill-paint');
        } else {
          const c = parseColor(fill);
          if (c) { fl = { ty: 'fl', c: { a: 0, k: [...c.rgb.map(r2v), 1] }, o: { a: 0, k: Math.round(c.a * fo * 1000) / 10 } }; fillLum = lum(c.rgb); }
        }
        if (fl) { fl.r = cs.fillRule === 'evenodd' ? 2 : 1; rec.items.push(fl); }
      }
      rec.fillLum = fillLum; rec.strokeLum = strokeLum;
      rec.closed = rec.subs.every(s => s.closed);
      rec.ink = (fillLum !== null && fillLum < 0.3) || (strokeLum !== null && strokeLum < 0.3);
      if (!rec.items.length) rec.kind = 'skip';
      if (approx.length) rec.approx = approx;
      if (rec.reasons.length && rec.kind === 'vector') rec.kind = 'raster';
      return rec;
    });

    // ------------------------------------------------ isolated masks
    const visible = elements.filter(e => e.kind !== 'skip');
    for (const e of visible) {
      isolate(new Set([e.idx]));
      const data = await rasterize(serialize(work, { width: AW, height: AH }), AW, AH);
      const mask = new Uint8Array(AW * AH);
      for (let i = 0; i < AW * AH; i++) if (data[i * 4 + 3] > 24) mask[i] = 1;
      e.mask = mask;
      Object.assign(e, maskStats(mask, AW, AH));
      if (!e.n) continue;
      const fr = fillRegion(mask, AW, AH);
      e.region = fr.reg; e.regionN = fr.n;
    }
    isolate(new Set(elements.map(e => e.idx)));
    const toComp = bb => ({ x: bb.x0 / S, y: bb.y0 / S, w: (bb.x1 - bb.x0) / S, h: (bb.y1 - bb.y0) / S });

    // ------------------------------------------------ raster fallback assets
    async function rasterAsset(e) {
      const pad = 2;
      const b = e.bb ? toComp(e.bb) : { x: 0, y: 0, w: W, h: H };
      const x = Math.max(0, Math.floor(b.x - pad)), y = Math.max(0, Math.floor(b.y - pad));
      const w = Math.min(W, Math.ceil(b.x + b.w + pad)) - x, h = Math.min(H, Math.ceil(b.y + b.h + pad)) - y;
      isolate(new Set([e.idx]));
      const clone = work.cloneNode(true);
      const pw = Math.max(1, Math.round(w * RASTER_SCALE)), ph = Math.max(1, Math.round(h * RASTER_SCALE));
      const str = serialize(clone, { viewBox: `${vb.x + x} ${vb.y + y} ${w} ${h}`, width: pw, height: ph });
      isolate(new Set(elements.map(q => q.idx)));
      const img = await loadImage(str);
      const c = document.createElement('canvas'); c.width = pw; c.height = ph;
      c.getContext('2d').drawImage(img, 0, 0, pw, ph);
      e.asset = { x, y, w: pw, h: ph, p: c.toDataURL('image/png') };
    }

    // ------------------------------------------------ build Lottie
    function buildLottie(model) {
      const { tracks, trackOf, margins, animate } = model;
      const ox = margins.l, oy = margins.t;
      const CW = Math.ceil(W + margins.l + margins.r), CH = Math.ceil(H + margins.t + margins.b);
      const layers = [], assets = [];
      let ind = 1;
      const trackInd = {};
      const rigInd = ind++;
      const rig = tracks.rig;
      layers.push({
        ddd: 0, ind: rigInd, ty: 3, nm: 'cuerpo (respiración)', sr: 1, ao: 0, ip: 0, op: OP, st: 0, bm: 0,
        ks: (() => {
          const k = staticKs([rig.anchor[0] + ox, rig.anchor[1] + oy]);
          if (animate && rig.scale) k.s = kf([{ t: 0, s: [100, 100, 100] }, { t: OP / 2, s: rig.scale }, { t: OP, s: [100, 100, 100] }]);
          return k;
        })(),
      });
      for (const [id, tr] of Object.entries(tracks)) {
        if (id === 'rig' || id === 'static') continue;
        const k = staticKs([tr.pivot[0] + ox, tr.pivot[1] + oy]);
        if (animate) {
          if (tr.rot) k.r = kf(oscillate([0], [tr.rot], tr.sign));
          if (tr.scaleKeys) k.s = kf(tr.scaleKeys);
          if (tr.bob) k.p = kf(oscillate([tr.pivot[0] + ox, tr.pivot[1] + oy, 0], [0, tr.bob, 0], tr.sign), true);
        }
        trackInd[id] = ind;
        const nl = { ddd: 0, ind: ind++, ty: 3, nm: tr.label, sr: 1, ao: 0, ip: 0, op: OP, st: 0, bm: 0, ks: k };
        if (!tr.free) nl.parent = rigInd;
        layers.push(nl);
      }
      // segmentos consecutivos → capas (respetando el orden de pintado)
      const drawable = elements.filter(e => e.kind !== 'skip' && e.n);
      const segs = [];
      for (const e of drawable) {
        const t = trackOf[e.idx] || 'static';
        const last = segs[segs.length - 1];
        if (e.kind === 'vector' && last && last.kind === 'vector' && last.track === t && last.clipSig === e.clipSig) last.els.push(e);
        else segs.push({ kind: e.kind, track: t, clipSig: e.clipSig || '', els: [e] });
      }
      const contentLayers = [];
      for (const sg of segs) {
        const parent = sg.track === 'static' ? rigInd : trackInd[sg.track];
        const free = sg.track !== 'static' && tracks[sg.track].free;
        const base = { ddd: 0, ind: ind++, sr: 1, ao: 0, ip: 0, op: OP, st: 0, bm: 0 };
        if (parent && !(free && !trackInd[sg.track])) base.parent = parent;
        if (sg.kind === 'raster') {
          const e = sg.els[0];
          const id = 'img_' + e.idx;
          assets.push({ id, w: e.asset.w, h: e.asset.h, u: '', p: e.asset.p, e: 1 });
          const ks = staticKs([0, 0]);
          ks.p.k = [e.asset.x + ox, e.asset.y + oy, 0];
          ks.s.k = [100 / RASTER_SCALE, 100 / RASTER_SCALE, 100];
          contentLayers.push({ ...base, ty: 2, nm: `${e.tag} #${e.idx} (imagen)`, refId: id, ks });
          continue;
        }
        const shapes = sg.els.slice().reverse().map(e => {
          const it = e.subs.map(s => ({ ty: 'sh', ks: { a: 0, k: lottiePath(s, ox, oy) } }));
          const styles = e.items.map(src => {
            const c = JSON.parse(JSON.stringify(src, (k, v) => (k === '_pts' ? undefined : v)));
            if (c.s && c.e) { c.s.k = [r2(src._pts[0][0] + ox), r2(src._pts[0][1] + oy)]; c.e.k = [r2(src._pts[1][0] + ox), r2(src._pts[1][1] + oy)]; }
            return c;
          });
          return { ty: 'gr', nm: `${e.tag} #${e.idx}`, it: [...it, ...styles, { ty: 'tr', ...staticKs2() }] };
        });
        const L = { ...base, ty: 4, nm: `${tracks[sg.track] ? tracks[sg.track].label : 'estático'} · ${sg.els[0].idx}-${sg.els[sg.els.length - 1].idx}`, ks: staticKs([0, 0]), shapes };
        const clips = sg.els[0].clips || [];
        if (clips.length) {
          L.hasMask = true;
          L.masksProperties = [];
          clips.forEach((paths, ci) => paths.forEach((p, pi) => L.masksProperties.push({
            inv: false, mode: ci > 0 ? 'i' : 'a', pt: { a: 0, k: lottiePath(p, ox, oy) }, o: { a: 0, k: 100 }, x: { a: 0, k: 0 }, nm: 'clip',
          })));
        }
        contentLayers.push(L);
      }
      // Lottie: la primera capa es la de arriba
      const all = layers.concat(contentLayers.reverse());
      return { v: '5.7.4', fr: FR, ip: 0, op: OP, w: CW, h: CH, nm: options.name || 'Flork animado', ddd: 0, assets, layers: all, markers: [] };
    }
    function staticKs2() {
      return { p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } };
    }

    // ------------------------------------------------ Lottie renderer for checks
    async function renderLottie(json, frame, cw, ch, unclipPad = 0, scale = 0) {
      const div = document.createElement('div');
      div.style.cssText = `position:absolute;left:0;top:0;width:${json.w}px;height:${json.h}px;`;
      document.body.appendChild(div);
      let err = null;
      let anim;
      try {
        anim = lottie.loadAnimation({ container: div, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(json)) });
        anim.goToAndStop(frame, true);
      } catch (e) { err = e; }
      await new Promise(r => setTimeout(r, 0));
      const ls = div.querySelector('svg');
      if (!ls || err) { div.remove(); throw new Error('Lottie no se pudo renderizar: ' + (err && err.message)); }
      const c = ls.cloneNode(true);
      if (unclipPad) {
        const g = c.querySelector(':scope > g[clip-path]');
        if (g) g.removeAttribute('clip-path');
        c.setAttribute('viewBox', `${-unclipPad} ${-unclipPad} ${json.w + 2 * unclipPad} ${json.h + 2 * unclipPad}`);
      }
      c.removeAttribute('style');
      c.setAttribute('preserveAspectRatio', 'none');
      const dw = scale ? (json.w + 2 * unclipPad) * scale : cw, dh = scale ? (json.h + 2 * unclipPad) * scale : ch;
      const str = serialize(c, { width: dw, height: dh });
      anim.destroy(); div.remove();
      return rasterize(str, cw, ch, 0, 0, dw, dh);
    }

    // Diferencia tolerante: un píxel cuenta como distinto sólo si ningún
    // píxel vecino (±1) de la otra imagen se le parece. Así se ignoran los
    // bordes suavizados desplazados un subpíxel, pero no los cambios reales.
    function compare(a, b, n, w) {
      w = w || AW;
      const h = n / w;
      const flat = img => {
        const o = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const al = img[i * 4 + 3] / 255;
          for (let c = 0; c < 3; c++) o[i * 3 + c] = img[i * 4 + c] * al + 255 * (1 - al);
        }
        return o;
      };
      const A = flat(a), B = flat(b);
      const near = (X, Y, i) => {
        const x = i % w, y = (i / w) | 0;
        let best = 1e9;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          const d = Math.max(Math.abs(X[i * 3] - Y[j * 3]), Math.abs(X[i * 3 + 1] - Y[j * 3 + 1]), Math.abs(X[i * 3 + 2] - Y[j * 3 + 2]));
          if (d < best) best = d;
          if (best <= 48) return best;
        }
        return best;
      };
      const bad = new Uint8Array(n);
      let count = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.max(Math.abs(A[i * 3] - B[i * 3]), Math.abs(A[i * 3 + 1] - B[i * 3 + 1]), Math.abs(A[i * 3 + 2] - B[i * 3 + 2]));
        if (d <= 48) continue;
        if (near(A, B, i) > 48 || near(B, A, i) > 48) { bad[i] = 1; count++; }
      }
      return { bad, count };
    }

    // ------------------------------------------------ STEP 1: fidelity loop
    const live = visible.filter(e => e.n);
    const owner = new Int32Array(AW * AH).fill(-1);
    for (const e of live) for (let i = 0; i < AW * AH; i++) if (e.mask[i]) owner[i] = e.idx;
    const SV = 2 * S, VW = Math.round(W * SV), VH = Math.round(H * SV);
    const origFull = await rasterize(serialize(work, { width: VW, height: VH }), VW, VH);
    for (const e of elements) if (e.kind === 'raster' && e.n) await rasterAsset(e);
    let staticModel = { tracks: { rig: { anchor: [W / 2, H] } }, trackOf: {}, margins: { l: 0, r: 0, t: 0, b: 0 }, animate: false };
    let fidelity;
    for (let pass = 0; pass < 4; pass++) {
      const frame = await renderLottie(buildLottie(staticModel), 0, VW, VH, 0, SV);
      const { bad, count } = compare(origFull, frame, VW * VH, VW);
      const per = {};
      for (let i = 0; i < VW * VH; i++) {
        if (!bad[i]) continue;
        const ax = Math.min(AW - 1, ((i % VW) * S / SV) | 0), ay = Math.min(AH - 1, (((i / VW) | 0) * S / SV) | 0);
        const o = owner[ay * AW + ax];
        if (o >= 0) per[o] = (per[o] || 0) + 1;
      }
      fidelity = { pass, badPixels: count, badPct: +(100 * count / (VW * VH)).toFixed(3) };
      if (options.debug && pass === 0) report.debug = { a: toUrl(origFull, VW, VH), b: toUrl(frame, VW, VH), d: toUrl(bad, VW, VH, true) };
      const flagged = live.filter(e => e.kind === 'vector' && (per[e.idx] || 0) >= Math.max(24, 0.03 * e.n * 4));
      if (!flagged.length) break;
      for (const e of flagged) {
        e.kind = 'raster';
        e.reasons.push('diff');
        await rasterAsset(e);
        report.corrections.push(`Elemento <${e.tag}> #${e.idx} no coincidía al convertirlo (${per[e.idx]} px distintos): se incrusta como imagen para conservar el diseño.`);
      }
    }
    report.checks.push({ name: 'Fidelidad estática', ok: fidelity.badPct < 0.5, detail: `${fidelity.badPct}% de píxeles distintos tras ${fidelity.pass + 1} pasada(s)` });

    // ------------------------------------------------ STEP 2: structure analysis
    const N = AW * AH;
    const bgCandidate = live[0] && live[0].bb && (live[0].bb.x1 - live[0].bb.x0) * (live[0].bb.y1 - live[0].bb.y0) > 0.95 * N && live[0].closed;
    const analyzable = live.filter((e, k) => !(k === 0 && bgCandidate));
    if (bgCandidate) report.warnings.push('El primer elemento cubre todo el lienzo: se trata como fondo fijo.');

    // componentes conectados (solapamiento real de píxeles)
    const parentUF = new Map(analyzable.map(e => [e.idx, e.idx]));
    const find = x => { while (parentUF.get(x) !== x) { parentUF.set(x, parentUF.get(parentUF.get(x))); x = parentUF.get(x); } return x; };
    const unite = (a, b) => parentUF.set(find(a), find(b));
    const dil = new Map(analyzable.map(e => [e.idx, dilate(e.mask, AW, AH, 2)]));
    const bbOverlap = (a, b, p = 3) => a.bb && b.bb && a.bb.x0 - p < b.bb.x1 && b.bb.x0 - p < a.bb.x1 && a.bb.y0 - p < b.bb.y1 && b.bb.y0 - p < a.bb.y1;
    for (let a = 0; a < analyzable.length; a++) for (let b = a + 1; b < analyzable.length; b++) {
      const A = analyzable[a], B = analyzable[b];
      if (!bbOverlap(A, B)) continue;
      const da = dil.get(A.idx);
      let hit = 0;
      for (let y = Math.max(A.bb.y0, B.bb.y0) - 3; y < Math.min(A.bb.y1, B.bb.y1) + 3 && hit < 3; y++) {
        if (y < 0 || y >= AH) continue;
        for (let x = Math.max(A.bb.x0, B.bb.x0) - 3; x < Math.min(A.bb.x1, B.bb.x1) + 3; x++) {
          if (x < 0 || x >= AW) continue;
          if (da[y * AW + x] && B.mask[y * AW + x]) { if (++hit >= 3) break; }
        }
      }
      if (hit >= 3) unite(A.idx, B.idx);
    }
    const comps = new Map();
    for (const e of analyzable) { const r = find(e.idx); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(e); }
    const compList = [...comps.values()].map(els => {
      const area = els.reduce((s, e) => s + (e.regionN || 0), 0);
      const bb = els.reduce((b, e) => ({ x0: Math.min(b.x0, e.bb.x0), y0: Math.min(b.y0, e.bb.y0), x1: Math.max(b.x1, e.bb.x1), y1: Math.max(b.y1, e.bb.y1) }), { x0: AW, y0: AH, x1: 0, y1: 0 });
      return { els, area, bb };
    }).sort((a, b) => b.area - a.area);
    const main = compList[0];
    if (!main) throw new Error('El SVG no tiene elementos visibles.');
    const mainBB = toComp(main.bb);

    const tracks = {
      rig: { anchor: [mainBB.x + mainBB.w / 2, mainBB.y + mainBB.h], scale: [100.7, 101.4, 100] },
    };
    const trackOf = {};
    const assign = (els, id) => els.forEach(e => { trackOf[e.idx] = id; });

    // --- elementos sueltos (flotan)
    let fi = 0;
    for (const c of compList.slice(1)) {
      if (c.area > 0.35 * main.area) continue;
      if (c.els.every(e => e.tag === 'text')) continue;
      const b = toComp(c.bb);
      const id = 'float' + fi;
      tracks[id] = {
        label: `flotante ${fi + 1}`, kind: 'float', free: true, pivot: [b.x + b.w / 2, b.y + b.h / 2],
        bob: -Math.max(1.5, 0.012 * H), rot: 3, sign: fi % 2 ? -1 : 1, bbox: b,
      };
      assign(c.els, id);
      report.tracks.push({ id, tipo: 'elemento suelto', animación: `flota ±${r2(Math.abs(tracks[id].bob))} px y gira ±3°`, elementos: c.els.map(e => e.idx) });
      fi++;
    }

    // --- núcleo del personaje
    const mainEls = main.els.filter(e => e.tag !== 'text');
    const E0 = mainEls.reduce((a, b) => ((b.regionN || 0) > (a.regionN || 0) ? b : a));
    const e0dil = dilate(E0.region, AW, AH, 3);
    const insideFrac = e => { let k = 0; for (let i = 0; i < N; i++) if (e.region[i] && e0dil[i]) k++; return k / Math.max(1, e.regionN); };
    mainEls.forEach(e => { e.inE0 = e === E0 ? 1 : insideFrac(e); });

    // --- ojos
    const E0area = E0.regionN;
    const hint = (e, re) => re.test(e.name || '');
    const eyeCand = mainEls.filter(e => {
      if (!e.bb || e.tag === 'text') return false;
      const bw = e.bb.x1 - e.bb.x0, bh = e.bb.y1 - e.bb.y0;
      const named = hint(e, /\b(eye|ojo|pupil|pupila)/i);
      const dark = e.fillLum !== null && e.fillLum < 0.35;
      const size = e.regionN / E0area;
      const top = (e.bb.y0 + e.bb.y1) / 2 < main.bb.y0 + 0.62 * (main.bb.y1 - main.bb.y0);
      return (named || (dark && e.closed && size > 0.00015 && size < 0.02 && e.n / (bw * bh) > 0.5 && bw / bh > 0.45 && bw / bh < 2.2 && top));
    });
    let eyes = null, best = Infinity;
    for (let a = 0; a < eyeCand.length; a++) for (let b = a + 1; b < eyeCand.length; b++) {
      const A = eyeCand[a], B = eyeCand[b];
      const ha = A.bb.y1 - A.bb.y0, hb = B.bb.y1 - B.bb.y0, wa = A.bb.x1 - A.bb.x0, wb = B.bb.x1 - B.bb.x0;
      const ca = [(A.bb.x0 + A.bb.x1) / 2, (A.bb.y0 + A.bb.y1) / 2], cb = [(B.bb.x0 + B.bb.x1) / 2, (B.bb.y0 + B.bb.y1) / 2];
      const dx = Math.abs(ca[0] - cb[0]), dy = Math.abs(ca[1] - cb[1]);
      const ratio = Math.max(A.n, B.n) / Math.min(A.n, B.n);
      if (dy > 0.8 * Math.max(ha, hb) || ratio > 1.8 || dx < 1.2 * Math.max(wa, wb) || dx > 0.45 * (main.bb.x1 - main.bb.x0)) continue;
      const score = (ca[1] + cb[1]) / 2 + dy * 2 + (ratio - 1) * 20;
      if (score < best) { best = score; eyes = ca[0] < cb[0] ? [A, B] : [B, A]; }
    }
    const used = new Set();
    if (eyes) {
      eyes.forEach((eye, k) => {
        const pad = 0.2;
        const ex = { x0: eye.bb.x0 - (eye.bb.x1 - eye.bb.x0) * pad, x1: eye.bb.x1 + (eye.bb.x1 - eye.bb.x0) * pad, y0: eye.bb.y0 - (eye.bb.y1 - eye.bb.y0) * pad, y1: eye.bb.y1 + (eye.bb.y1 - eye.bb.y0) * pad };
        const members = mainEls.filter(e => e === eye || (e !== E0 && e.bb && Math.abs(e.idx - eye.idx) <= 4 && e.bb.x0 >= ex.x0 && e.bb.x1 <= ex.x1 && e.bb.y0 >= ex.y0 && e.bb.y1 <= ex.y1));
        // contenedor claro (blanco del ojo)
        const ew = eye.bb.x1 - eye.bb.x0;
        const white = mainEls.find(e => e !== E0 && e.fillLum !== null && e.fillLum > 0.7 && e.idx < eye.idx && eye.idx - e.idx <= 4 && e.bb &&
          e.bb.x0 <= eye.bb.x0 && e.bb.x1 >= eye.bb.x1 && e.bb.y0 <= eye.bb.y0 && e.bb.y1 >= eye.bb.y1 && (e.bb.x1 - e.bb.x0) < 3.2 * ew);
        if (white) members.push(white);
        const b = toComp(eye.bb);
        const id = 'eye' + k;
        tracks[id] = {
          label: k ? 'ojo derecho' : 'ojo izquierdo', kind: 'eye', pivot: [b.x + b.w / 2, b.y + b.h / 2],
          scaleKeys: [{ t: 0, s: [100, 100, 100], e: 'snap' }, { t: 54, s: [100, 100, 100], e: 'snap' }, { t: 57, s: [100, 8, 100], e: 'snap' },
            { t: 59, s: [100, 8, 100], e: 'snap' }, { t: 63, s: [100, 100, 100], e: 'snap' }, { t: OP, s: [100, 100, 100] }],
        };
        assign(members, id);
        members.forEach(m => used.add(m.idx));
        report.tracks.push({ id, tipo: tracks[id].label, animación: 'parpadeo (se cierra y abre en 0,3 s)', elementos: members.map(e => e.idx) });
      });
    } else report.warnings.push('No se encontraron ojos rellenos y separados (p. ej. ojos de línea): no se añade parpadeo.');

    // --- boca
    if (eyes) {
      const ca = eyes.map(e => [(e.bb.x0 + e.bb.x1) / 2, (e.bb.y0 + e.bb.y1) / 2]);
      const eyeDist = ca[1][0] - ca[0][0], eyeY = (ca[0][1] + ca[1][1]) / 2, eyeH = eyes[0].bb.y1 - eyes[0].bb.y0;
      const mc = mainEls.filter(e => !used.has(e.idx) && e !== E0 && e.closed && e.bb && e.fillLum !== null && e.tag !== 'text').filter(e => {
        const cx = (e.bb.x0 + e.bb.x1) / 2, cy = (e.bb.y0 + e.bb.y1) / 2, bw = e.bb.x1 - e.bb.x0, bh = e.bb.y1 - e.bb.y0;
        const named = hint(e, /\b(mouth|boca)/i);
        return named || (cy > eyeY + 0.6 * eyeH && cy < eyeY + 2.2 * eyeDist && cx > ca[0][0] - 0.6 * eyeDist && cx < ca[1][0] + 0.6 * eyeDist &&
          bw > 1.1 * bh && bw >= 0.5 * eyeDist && bw < 2.2 * eyeDist && e.regionN < 0.05 * E0area && e.fillLum < 0.55 && e.n / (bw * bh) > 0.3);
      }).sort((a, b) => b.n - a.n);
      const mouth = mc[0];
      if (mouth && (mouth.bb.y1 - mouth.bb.y0) / S >= 5) {
        const p = 4;
        const members = mainEls.filter(e => e === mouth || (!used.has(e.idx) && e !== E0 && e.bb && Math.abs(e.idx - mouth.idx) <= 4 &&
          e.bb.x0 >= mouth.bb.x0 - p && e.bb.x1 <= mouth.bb.x1 + p && e.bb.y0 >= mouth.bb.y0 - p && e.bb.y1 <= mouth.bb.y1 + p));
        const b = toComp(mouth.bb);
        tracks.mouth = {
          label: 'boca', kind: 'mouth', pivot: [b.x + b.w / 2, b.y],
          scaleKeys: [{ t: 0, s: [100, 100, 100] }, { t: OP / 4, s: [100, 92, 100] }, { t: OP / 2, s: [100, 100, 100] }, { t: OP * 3 / 4, s: [100, 95, 100] }, { t: OP, s: [100, 100, 100] }],
        };
        assign(members, 'mouth');
        members.forEach(m => used.add(m.idx));
        report.tracks.push({ id: 'mouth', tipo: 'boca', animación: 'se abre y cierra suavemente (anclada arriba)', elementos: members.map(e => e.idx) });
      }
    }

    // --- partes salientes (cola, brazos, manos, accesorios)
    const coreSet = new Set(mainEls.filter(e => e.inE0 >= 0.85).map(e => e.idx));
    let partEls = mainEls.filter(e => !coreSet.has(e.idx) && !used.has(e.idx));
    // calcomanías: elementos dibujados encima de una parte y dentro de ella
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of mainEls) {
        if (used.has(e.idx) || e === E0 || partEls.includes(e)) continue;
        for (const p of partEls) {
          if (p.idx >= e.idx || !bbOverlap(p, e, 0)) continue;
          let k = 0;
          for (let i = 0; i < N; i++) if (e.mask[i] && p.region[i]) k++;
          if (k / e.n >= 0.7) { partEls.push(e); grew = true; break; }
        }
      }
    }
    const pSet = new Set(partEls.map(e => e.idx));
    const pUF = new Map(partEls.map(e => [e.idx, e.idx]));
    const pf = x => { while (pUF.get(x) !== x) x = pUF.get(x); return x; };
    for (let a = 0; a < partEls.length; a++) for (let b = a + 1; b < partEls.length; b++) {
      const A = partEls[a], B = partEls[b];
      if (!bbOverlap(A, B)) continue;
      const da = dil.get(A.idx);
      let hit = 0;
      for (let i = 0; i < N && hit < 3; i++) if (da[i] && B.mask[i]) hit++;
      if (hit >= 3) pUF.set(pf(A.idx), pf(B.idx));
    }
    const clusters = new Map();
    for (const e of partEls) { const r = pf(e.idx); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(e); }
    const mainH = mainBB.h;
    const jointLimit = 0.003 * Math.max(W, H);
    let pi = 0;
    for (const els of clusters.values()) {
      const pm = new Uint8Array(N), pr = new Uint8Array(N);
      els.forEach(e => { for (let i = 0; i < N; i++) { if (e.mask[i]) pm[i] = 1; if (e.region[i]) pr[i] = 1; } });
      let pn = 0, outside = 0;
      for (let i = 0; i < N; i++) if (pm[i]) { pn++; if (!e0dil[i]) outside++; }
      if (pn < 0.002 * N || outside / pn < 0.3) continue;
      // tinta del resto del personaje
      const ink = new Uint8Array(N);
      mainEls.forEach(e => { if (!pSet.has(e.idx) && e.ink) for (let i = 0; i < N; i++) if (e.mask[i]) ink[i] = 1; });
      const inkD = dilate(ink, AW, AH, 1);
      const att = [];
      for (let i = 0; i < N; i++) if (pm[i] && inkD[i]) att.push([(i % AW) / S, ((i / AW) | 0) / S]);
      const pts = [];
      for (let i = 0; i < N; i += 2) if (pm[i]) pts.push([(i % AW) / S, ((i / AW) | 0) / S]);
      let pivot, rJoint;
      if (att.length) {
        pivot = att.reduce((s, p) => [s[0] + p[0] / att.length, s[1] + p[1] / att.length], [0, 0]);
        rJoint = Math.max(...att.map(p => Math.hypot(p[0] - pivot[0], p[1] - pivot[1])));
      } else {
        const b = pts.reduce((b, p) => ({ x0: Math.min(b.x0, p[0]), x1: Math.max(b.x1, p[0]), y1: Math.max(b.y1, p[1]) }), { x0: Infinity, x1: -Infinity, y1: -Infinity });
        pivot = [(b.x0 + b.x1) / 2, b.y1]; rJoint = 0;
      }
      const rTip = Math.max(...pts.map(p => Math.hypot(p[0] - pivot[0], p[1] - pivot[1])));
      const deg = x => x * 180 / Math.PI;
      const aTip = deg(Math.asin(Math.min(1, 0.03 * mainH / Math.max(1, rTip))));
      const aJoint = rJoint > 0 ? deg(Math.asin(Math.min(1, jointLimit / rJoint))) : 3;
      let A = Math.min(6, aTip, aJoint);
      const id = 'part' + pi;
      const ids = els.map(e => e.idx).sort((a, b) => a - b);
      if (A < 1) {
        report.corrections.push(`Parte saliente (elementos ${ids.join(', ')}) unida en una zona amplia: moverla rompería la unión (±${r2(A)}° máx.), se deja fija.`);
        continue;
      }
      if (aJoint < Math.min(6, aTip)) report.corrections.push(`Parte ${pi + 1}: amplitud limitada a ±${r2(A)}° para que la unión no se separe más de ${r2(jointLimit)} px.`);
      tracks[id] = { label: `parte ${pi + 1}`, kind: 'part', pivot, rot: r2(A), sign: pi % 2 ? -1 : 1, pts, rTip };
      assign(els, id);
      report.tracks.push({ id, tipo: 'parte saliente (cola/brazo/accesorio)', animación: `balanceo ±${r2(A)}° desde la unión`, pivote: pivot.map(r2), elementos: ids });
      pi++;
    }
    report.tracks.unshift({ id: 'rig', tipo: 'cuerpo completo', animación: 'respiración suave (+1,4 % alto, anclada abajo)' });

    // ------------------------------------------------ STEP 3: margins (analytic + render check)
    const touchBottom = main.bb.y1 >= AH - 2;
    const margins = { l: 0, r: 0, t: 0, b: 0 };
    const need = { x0: 0, y0: 0, x1: W, y1: H };
    const grow = (x, y) => { need.x0 = Math.min(need.x0, x); need.y0 = Math.min(need.y0, y); need.x1 = Math.max(need.x1, x); need.y1 = Math.max(need.y1, y); };
    const rigS = tracks.rig.scale, ra = tracks.rig.anchor;
    const rigT = p => [ra[0] + (p[0] - ra[0]) * rigS[0] / 100, ra[1] + (p[1] - ra[1]) * rigS[1] / 100];
    grow(...rigT([mainBB.x, mainBB.y])); grow(...rigT([mainBB.x + mainBB.w, mainBB.y]));
    for (const [id, tr] of Object.entries(tracks)) {
      if (tr.kind === 'part') {
        for (const sgn of [-1, 1]) {
          const a = sgn * tr.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
          for (const p of tr.pts) {
            const q = [tr.pivot[0] + (p[0] - tr.pivot[0]) * c - (p[1] - tr.pivot[1]) * s, tr.pivot[1] + (p[0] - tr.pivot[0]) * s + (p[1] - tr.pivot[1]) * c];
            const r = rigT(q);
            if (touchBottom && r[1] > H + 0.5) { tr.rot = r2(tr.rot * 0.6); report.corrections.push(`${tr.label}: se salía por abajo, amplitud reducida a ±${tr.rot}°.`); break; }
            grow(...r);
          }
        }
      } else if (tr.kind === 'float') {
        const b = tr.bbox, d = Math.abs(tr.bob) + 0.1 * Math.max(b.w, b.h);
        grow(b.x - d, b.y - d); grow(b.x + b.w + d, b.y + b.h + d);
      }
    }
    margins.l = Math.ceil(Math.max(0, -need.x0) + (need.x0 < 0 ? 2 : 0));
    margins.t = Math.ceil(Math.max(0, -need.y0) + (need.y0 < 0 ? 2 : 0));
    margins.r = Math.ceil(Math.max(0, need.x1 - W) + (need.x1 > W ? 2 : 0));
    margins.b = touchBottom ? 0 : Math.ceil(Math.max(0, need.y1 - H) + (need.y1 > H ? 2 : 0));

    const model = { tracks, trackOf, margins, animate: true };
    let json;
    for (let pass = 0; pass < 4; pass++) {
      json = buildLottie(model);
      const pad = Math.ceil(0.15 * Math.max(W, H));
      const cw = Math.round((json.w + 2 * pad) * S), ch = Math.round((json.h + 2 * pad) * S);
      let ext = { l: 0, r: 0, t: 0, b: 0 };
      for (let f = 0; f < OP; f += 5) {
        const img = await renderLottie(json, f, cw, ch, pad, S);
        const inner = { x0: Math.round(pad * S), y0: Math.round(pad * S), x1: Math.round((pad + json.w) * S), y1: Math.round((pad + json.h) * S) };
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          if (img[(y * cw + x) * 4 + 3] < 24) continue;
          if (x < inner.x0) ext.l = Math.max(ext.l, (inner.x0 - x) / S);
          if (x >= inner.x1) ext.r = Math.max(ext.r, (x - inner.x1 + 1) / S);
          if (y < inner.y0) ext.t = Math.max(ext.t, (inner.y0 - y) / S);
          if (y >= inner.y1) ext.b = Math.max(ext.b, (y - inner.y1 + 1) / S);
        }
      }
      if (touchBottom) ext.b = 0;
      const over = Object.entries(ext).filter(([, v]) => v > 0.5);
      if (!over.length) { report.checks.push({ name: 'Nada se sale del lienzo', ok: true, detail: `lienzo ${json.w}×${json.h}, márgenes ${JSON.stringify(margins)}` }); break; }
      for (const [k, v] of over) margins[k] += Math.ceil(v) + 2;
      report.corrections.push(`Al animar, el dibujo se salía del lienzo (${over.map(([k, v]) => k + ':' + r2(v) + 'px').join(', ')}): se amplía el lienzo.`);
    }

    // ------------------------------------------------ STEP 4: final checks
    // a) bucle: cada propiedad animada empieza y termina igual
    let loopOk = true;
    (function scan(o) {
      if (Array.isArray(o)) return o.forEach(scan);
      if (o && typeof o === 'object') {
        if (o.a === 1 && Array.isArray(o.k)) {
          const f = o.k[0], l = o.k[o.k.length - 1];
          if (f.t !== 0 || l.t !== OP || JSON.stringify(f.s) !== JSON.stringify(l.s)) loopOk = false;
        }
        Object.values(o).forEach(scan);
      }
    })(json.layers);
    // b) el fotograma 0 coincide con el diseño original
    const cw0 = Math.round(json.w * S), ch0 = Math.round(json.h * S);
    const orig0 = await rasterize(serialize(work, { width: AW, height: AH }), cw0, ch0, margins.l * S, margins.t * S, W * S, H * S);
    const f0 = await renderLottie(json, 0, cw0, ch0, 0, S);
    const d0 = compare(orig0, f0, cw0 * ch0, cw0);
    const fEnd = await renderLottie(json, OP - 0.01, cw0, ch0, 0, S);
    const dLoop = compare(f0, fEnd, cw0 * ch0, cw0);
    report.checks.push({ name: 'Bucle perfecto (inicio = final)', ok: loopOk && dLoop.count / (cw0 * ch0) < 0.002, detail: `${dLoop.count} px distintos entre el primer y el último instante` });
    report.checks.push({ name: 'Fotograma 0 idéntico al SVG', ok: d0.count / (cw0 * ch0) < 0.005, detail: `${(100 * d0.count / (cw0 * ch0)).toFixed(3)}% de píxeles distintos` });
    report.checks.push({ name: 'Duración', ok: json.op / json.fr === 3, detail: `${json.op} fotogramas a ${json.fr} fps = ${json.op / json.fr} s` });
    report.summary = {
      lienzo: [json.w, json.h], elementos: elements.length, vectoriales: elements.filter(e => e.kind === 'vector').length,
      imagenes: elements.filter(e => e.kind === 'raster' && e.n).length, capas: json.layers.length,
    };
    host.remove();
    return { json, report };
  }

  window.FlorkAnimator = { analyze, FR, OP };
})();
