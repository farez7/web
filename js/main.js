/* =========================================================
   Jh Company — interacciones
   Cada sección ocupa una sola pantalla. Se cambia de pantalla
   con el menú, la rueda del mouse, deslizando o con el teclado,
   y las capas se mueven a distinta velocidad (parallax 3D).
   ========================================================= */
(() => {
  'use strict';

  const cfg = window.JH_CONFIG || {};
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const TAU = Math.PI * 2;
  const root = document.documentElement;

  /* ---------- Enlaces desde config.js ---------- */
  if (cfg.playStoreUrl) {
    $$('[data-playstore]').forEach((a) => {
      a.href = cfg.playStoreUrl;
      a.target = '_blank';
      a.rel = 'noopener';
    });
  }
  if (cfg.email) {
    const mail = 'mailto:' + cfg.email + (cfg.emailSubject ? '?subject=' + encodeURIComponent(cfg.emailSubject) : '');
    $$('[data-email]').forEach((a) => { a.href = mail; });
    $$('[data-email-text]').forEach((el) => { el.textContent = cfg.email; });
  }
  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });

  /* ---------- Página de privacidad: la barra se oscurece al bajar ---------- */
  const nav = $('#nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', scrollY > 30);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  const screens = $$('.screen');
  if (!screens.length || !root.classList.contains('fp')) return;

  /* ---------- Bienvenida: el clic en "Enter" activa la música ---------- */
  const intro = $('#intro');
  const musicCfg = cfg.music || {};
  let introOpen = !!(intro && musicCfg.youtubeId && musicCfg.intro !== false);
  if (intro && !introOpen) intro.remove();
  if (introOpen) root.classList.add('intro-open');

  const ids = screens.map((s) => s.id);
  const fits = screens.map((s) => $('.fit', s));
  const navLinks = $$('a[href^="#"]').filter((a) => ids.includes(a.getAttribute('href').slice(1)));
  const counter = $('.counter b');
  const nextBtn = $('.next');
  let index = -1;
  let activeDepth = [];

  /* ---------- Iconos Lottie (solo se animan los de la pantalla visible) ---------- */
  const anims = screens.map(() => []);
  if (window.lottie && window.JH_ICONS) {
    $$('[data-lottie]').forEach((el, i) => {
      const make = window.JH_ICONS[el.dataset.lottie];
      if (!make) return;
      const anim = window.lottie.loadAnimation({
        container: el,
        renderer: 'svg',
        loop: true,
        autoplay: false,
        animationData: make(),
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet' }
      });
      anim.goToAndStop(reduce ? 70 : (i * 37) % 180, true);
      const k = screens.indexOf(el.closest('.screen'));
      if (k >= 0) anims[k].push(anim);
      const card = el.closest('.app');
      if (card && !reduce) {
        card.addEventListener('mouseenter', () => anim.setSpeed(1.8));
        card.addEventListener('mouseleave', () => anim.setSpeed(1));
      }
    });
  }
  const playAnims = (k) => { if (!reduce) anims[k].forEach((a) => a.play()); };
  const pauseAnims = (k) => anims[k].forEach((a) => a.pause());

  /* ---------- Anillos de porcentaje ---------- */
  const CIRC = 2 * Math.PI * 54;
  const ringRuns = new WeakMap();
  function fillRings(k) {
    $$('.ring[data-level]', screens[k]).forEach((ring) => {
      const level = clamp(parseFloat(ring.dataset.level) || 0, 0, 100);
      const bar = $('.ring-bar', ring);
      const out = $('.ring-val b', ring);
      if (bar) bar.style.strokeDashoffset = String(CIRC * (1 - level / 100));
      if (!out) return;
      if (reduce) { out.textContent = level; return; }
      const run = {};
      ringRuns.set(ring, run);
      const t0 = performance.now() + 450;
      const step = (now) => {
        if (ringRuns.get(ring) !== run) return;
        const p = clamp((now - t0) / 1600, 0, 1);
        out.textContent = Math.round(level * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  function emptyRings(k) {
    $$('.ring[data-level]', screens[k]).forEach((ring) => {
      ringRuns.delete(ring);
      const bar = $('.ring-bar', ring);
      const out = $('.ring-val b', ring);
      if (bar) {
        bar.style.transition = 'none';
        bar.style.strokeDashoffset = String(CIRC);
        bar.getBoundingClientRect();
        bar.style.transition = '';
      }
      if (out) out.textContent = '0';
    });
  }

  /* ---------- Cambio de pantalla ---------- */
  function go(k, opts) {
    k = clamp(k, 0, screens.length - 1);
    if (k === index) return;
    const prev = index;
    const hadFocus = prev >= 0 && screens[prev].contains(document.activeElement);
    index = k;

    screens.forEach((s, i) => {
      s.classList.toggle('is-active', i === k);
      s.classList.toggle('is-before', i < k);
    });
    root.dataset.screen = ids[k];
    navLinks.forEach((a) => {
      if (a.getAttribute('href') === '#' + ids[k]) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
    if (counter) counter.textContent = String(k + 1).padStart(2, '0');
    if (nextBtn) {
      const last = k === screens.length - 1;
      nextBtn.classList.toggle('is-up', last);
      nextBtn.setAttribute('aria-label', last ? 'Back to the first screen' : 'Next screen');
    }
    if (!(opts && opts.keepHash)) {
      try { history.replaceState(null, '', '#' + ids[k]); } catch (e) { /* sin historial */ }
    }

    playAnims(k);
    fillRings(k);
    if (prev >= 0) {
      setTimeout(() => {
        if (index === prev) return;
        pauseAnims(prev);
        emptyRings(prev);
      }, 1100);
    }
    activeDepth = $$('[data-depth]', screens[k]);
    if (hadFocus) screens[k].focus({ preventScroll: true });
  }

  // Menú superior, puntos, barra inferior y botones internos
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const k = ids.indexOf(a.getAttribute('href').slice(1));
    if (k < 0) return;
    e.preventDefault();
    go(k);
  });
  if (nextBtn) nextBtn.addEventListener('click', () => go(index === screens.length - 1 ? 0 : index + 1));
  addEventListener('hashchange', () => {
    const k = ids.indexOf(location.hash.slice(1));
    if (k >= 0) go(k, { keepHash: true });
  });

  // Teclado
  addEventListener('keydown', (e) => {
    if (introOpen || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;
    let k = null;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') k = index + 1;
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') k = index - 1;
    else if (e.key === 'Home') k = 0;
    else if (e.key === 'End') k = screens.length - 1;
    else if (e.key === ' ' && tag !== 'button' && tag !== 'a') k = index + (e.shiftKey ? -1 : 1);
    if (k === null) return;
    e.preventDefault();
    go(k);
  });

  // Rueda del mouse / trackpad: un gesto = una pantalla
  let wheelSum = 0;
  let wheelLast = 0;
  let wheelLock = 0;
  let wheelWait = false;
  addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // zoom con el trackpad
    e.preventDefault();
    if (introOpen) return;
    const now = performance.now();
    const gap = now - wheelLast;
    wheelLast = now;
    if (now < wheelLock) { wheelWait = true; return; }
    if (wheelWait && gap < 160) return; // todavía es la inercia del mismo gesto
    wheelWait = false;
    if (gap > 300) wheelSum = 0;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
    if (Math.abs(e.deltaX) > Math.abs(dy)) return;
    wheelSum += dy;
    if (Math.abs(wheelSum) < 40) return;
    const dir = wheelSum > 0 ? 1 : -1;
    wheelSum = 0;
    wheelLock = now + 850;
    wheelWait = true;
    go(index + dir);
  }, { passive: false });

  // Deslizar con el dedo
  let touch = null;
  addEventListener('touchstart', (e) => {
    touch = e.touches.length === 1
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() }
      : null;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    // evita el rebote de la página y "jalar para recargar"; el zoom con dos dedos sigue funcionando
    if (e.touches.length === 1 && e.cancelable) e.preventDefault();
  }, { passive: false });
  addEventListener('touchend', (e) => {
    if (introOpen || !touch || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    const dt = performance.now() - touch.t;
    touch = null;
    if (dt > 800 || Math.abs(dy) < 50 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
    go(index + (dy < 0 ? 1 : -1));
  }, { passive: true });

  /* ---------- Que cada pantalla quepa completa ---------- */
  function fit() {
    screens.forEach((s, k) => {
      const f = fits[k];
      if (!f) return;
      f.style.scale = '';
      const cs = getComputedStyle(s);
      const h = s.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const w = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const sc = Math.min(1, h / f.offsetHeight, w / f.offsetWidth);
      if (sc < 0.995) f.style.scale = sc.toFixed(3);
    });
  }

  /* ---------- Tarjetas con inclinación 3D ---------- */
  if (finePointer && !reduce) {
    $$('[data-tilt]').forEach((el) => {
      const max = parseFloat(el.dataset.tilt) || 8;
      let raf = 0;
      let last = null;
      el.addEventListener('pointermove', (e) => {
        last = e;
        el.classList.add('is-tilting');
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const r = el.getBoundingClientRect();
          const px = clamp((last.clientX - r.left) / r.width, 0, 1);
          const py = clamp((last.clientY - r.top) / r.height, 0, 1);
          el.style.setProperty('--rx', ((0.5 - py) * max * 2).toFixed(2) + 'deg');
          el.style.setProperty('--ry', ((px - 0.5) * max * 2).toFixed(2) + 'deg');
          el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
          el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        });
      });
      el.addEventListener('pointerleave', () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        el.classList.remove('is-tilting');
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ---------- Escena 3D del inicio ---------- */
  const scene = $('#scene');
  const logo3d = $('#logo3d');
  const orbitPath = $('.orbit-path');
  const orbitItems = $$('#orbit .orbit-item');

  // Volumen del logo: copias apiladas en profundidad
  if (logo3d) {
    const img = logo3d.querySelector('img');
    for (let i = 1; i <= 14; i++) {
      const c = img.cloneNode();
      c.alt = '';
      c.style.transform = 'translateZ(' + (-i * 1.7) + 'px)';
      c.style.filter = 'brightness(' + Math.max(0.2, 0.62 - i * 0.03).toFixed(2) + ') saturate(1.25)';
      logo3d.appendChild(c);
    }
    const glow = img.cloneNode();
    glow.alt = '';
    glow.style.transform = 'translateZ(-40px) scale(1.05)';
    glow.style.filter = 'blur(22px) brightness(1.1)';
    glow.style.opacity = '.65';
    logo3d.appendChild(glow);
    img.style.transform = 'translateZ(1px)';
  }

  let orbitRX = 240;
  let orbitRY = 66;
  let orbitY = 40;
  function measure() {
    if (!scene || !orbitPath) return;
    orbitRX = orbitPath.offsetWidth / 2;
    orbitRY = orbitPath.offsetHeight / 2;
    orbitY = scene.clientHeight * 0.08;
  }

  let sx = 0;
  let sy = 0;
  function placeOrbit(t) {
    const n = orbitItems.length;
    orbitItems.forEach((el, i) => {
      const a = t * 0.00024 + i * TAU / n;
      const depth = Math.sin(a); // -1 atrás · 1 adelante
      const x = Math.cos(a) * orbitRX + sx * 14 * depth;
      const y = orbitY + depth * orbitRY - sy * 16 * depth;
      const k = (depth + 1) / 2;
      el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) scale(' + (0.66 + k * 0.38).toFixed(3) + ')';
      el.style.opacity = (0.45 + k * 0.55).toFixed(3);
      el.style.zIndex = depth > 0 ? 200 : 50;
    });
  }

  /* ---------- Estrellas del fondo ---------- */
  const canvas = $('#stars');
  let ctx = null;
  let parts = [];
  let cw = 0;
  let ch = 0;
  function setupStars() {
    if (!canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cw = canvas.clientWidth;
    ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = clamp(Math.round(cw * ch / 9000), 40, 170);
    parts = Array.from({ length: n }, () => ({
      x: Math.random() * cw,
      y: Math.random() * ch,
      z: 0.15 + Math.random() * 0.85,
      tw: Math.random() * TAU,
      red: Math.random() < 0.3
    }));
  }

  let world = 0; // posición suavizada entre pantallas
  function drawStars(t) {
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    for (const p of parts) {
      p.y -= p.z * 0.2;
      if (p.y < -ch) p.y += ch;
      let y = (p.y - world * 180 * p.z - sy * 26 * p.z) % ch;
      if (y < 0) y += ch;
      const x = p.x - sx * 40 * p.z;
      const a = (0.25 + 0.75 * Math.abs(Math.sin(t / 1100 + p.tw))) * p.z;
      ctx.fillStyle = p.red ? 'rgba(255,90,70,' + a.toFixed(3) + ')' : 'rgba(255,255,255,' + (a * 0.85).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 0.4 + p.z * 1.5, 0, TAU);
      ctx.fill();
    }
  }

  /* ---------- Parallax con el mouse o el giroscopio ---------- */
  const blobs = $$('.world .blob');
  let mx = 0;
  let my = 0;
  let gyro = false;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mx = e.clientX / innerWidth * 2 - 1;
    my = e.clientY / innerHeight * 2 - 1;
  }, { passive: true });
  root.addEventListener('mouseleave', () => { mx = 0; my = 0; });
  if (!finePointer) {
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return;
      gyro = true;
      mx = clamp(e.gamma / 30, -1, 1);
      my = clamp((e.beta - 45) / 30, -1, 1);
    }, { passive: true });
  }

  function frame(t) {
    const auto = !finePointer && !gyro;
    const tx = auto ? Math.sin(t / 2600) * 0.6 : mx;
    const ty = auto ? Math.cos(t / 3100) * 0.35 : my;
    sx += (tx - sx) * 0.06;
    sy += (ty - sy) * 0.06;
    world += (index - world) * 0.045;

    activeDepth.forEach((el) => {
      const d = parseFloat(el.dataset.depth) || 0;
      el.style.translate = (sx * d).toFixed(1) + 'px ' + (sy * d).toFixed(1) + 'px';
    });
    if (logo3d) {
      const rx = -sy * 16 + Math.sin(t / 1700) * 4;
      const ry = sx * 26 + Math.sin(t / 2300) * 12;
      logo3d.style.transform = 'translateY(' + (Math.sin(t / 1300) * 8).toFixed(2) + 'px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
    }
    placeOrbit(t);
    blobs.forEach((b, i) => {
      b.style.translate = (sx * (i + 1) * -18).toFixed(1) + 'px ' + (-world * (36 + i * 26)).toFixed(1) + 'px';
    });
    drawStars(t);
    requestAnimationFrame(frame);
  }

  /* ---------- Inicio ---------- */
  measure();
  setupStars();
  fit();

  let resizeRaf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      measure();
      setupStars();
      fit();
      if (reduce) { placeOrbit(0); drawStars(0); }
    });
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fit(); measure(); });
  addEventListener('load', () => { fit(); measure(); });

  // Pantalla inicial (por ejemplo index.html#apps abre directo en Apps)
  const first = Math.max(0, ids.indexOf(location.hash.slice(1)));
  const showFirst = () => requestAnimationFrame(() => requestAnimationFrame(() => go(first, { keepHash: !location.hash })));

  if (introOpen) {
    const enter = (withMusic) => {
      if (!introOpen) return;
      introOpen = false;
      root.classList.remove('intro-open');
      // music.js escucha este aviso y arranca la música dentro del mismo clic
      document.dispatchEvent(new CustomEvent('jh:enter', { detail: { music: withMusic } }));
      intro.classList.add('is-leaving');
      setTimeout(() => intro.remove(), 1000);
      showFirst();
    };
    intro.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-enter]');
      if (btn) enter(btn.dataset.enter === 'music');
    });
    addEventListener('keydown', (e) => { if (introOpen && e.key === 'Escape') enter(false); });
  } else {
    showFirst();
  }

  if (reduce) {
    placeOrbit(0);
    drawStars(0);
  } else {
    requestAnimationFrame(frame);
  }
})();
