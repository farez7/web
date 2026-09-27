/* =========================================================
   Jh Company — interacciones
   Parallax 3D, órbita de apps, tarjetas con inclinación,
   iconos Lottie y animaciones al hacer scroll.
   ========================================================= */
(() => {
  'use strict';

  const cfg = window.JH_CONFIG || {};
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

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

  /* ---------- Navegación ---------- */
  const nav = $('#nav');
  const menuBtn = $('.menu-btn');
  const setScrolled = () => nav && nav.classList.toggle('scrolled', scrollY > 30);
  addEventListener('scroll', setScrolled, { passive: true });
  setScrolled();

  if (nav && menuBtn) {
    const close = () => { nav.classList.remove('open'); menuBtn.setAttribute('aria-expanded', 'false'); };
    menuBtn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    $$('.nav-links a').forEach((a) => a.addEventListener('click', close));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // Resalta la sección visible en el menú
  const navLinks = $$('.nav-links a[href^="#"]');
  if (navLinks.length) {
    const byId = new Map(navLinks.map((a) => [a.getAttribute('href').slice(1), a]));
    const spy = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      navLinks.forEach((l) => l.classList.remove('active'));
      const link = byId.get(e.target.id);
      if (link) link.classList.add('active');
    }), { rootMargin: '-45% 0px -50% 0px' });
    byId.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
  }

  /* ---------- Aparición al hacer scroll ---------- */
  $$('[data-stagger]').forEach((g) => Array.from(g.children).forEach((c, i) => c.style.setProperty('--d', (i % 4) * 0.09 + 's')));
  const revealIO = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add('is-in');
    revealIO.unobserve(e.target);
  }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el) => revealIO.observe(el));

  /* ---------- Barras de nivel opcionales (data-level en .tool) ---------- */
  $$('.tool[data-level]').forEach((t) => {
    const v = clamp(parseFloat(t.dataset.level) || 0, 0, 100);
    const row = document.createElement('div');
    row.className = 'tool-level';
    row.innerHTML = '<div class="tool-bar"><i style="--v:' + v + '%"></i></div><span>' + v + '%</span>';
    (t.querySelector('div') || t).appendChild(row);
  });

  /* ---------- Anillo de porcentaje ---------- */
  const ringIO = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    ringIO.unobserve(e.target);
    const ring = e.target;
    const level = clamp(parseFloat(ring.dataset.level) || 0, 0, 100);
    const bar = $('.ring-bar', ring);
    const count = $('.count', ring);
    const len = 2 * Math.PI * 54;
    if (bar) bar.style.strokeDashoffset = String(len * (1 - level / 100));
    if (!count) return;
    if (reduce) { count.textContent = level; return; }
    const t0 = performance.now();
    const dur = 2000;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      count.textContent = Math.round(level * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { threshold: 0.4 });
  $$('.ring[data-level]').forEach((r) => ringIO.observe(r));

  /* ---------- Iconos Lottie ---------- */
  if (window.lottie && window.JH_ICONS) {
    const lottieIO = new IntersectionObserver((entries) => entries.forEach((e) => {
      const a = e.target._anim;
      if (a) e.isIntersecting ? a.play() : a.pause();
    }), { rootMargin: '100px' });

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
      el._anim = anim;
      anim.goToAndStop(reduce ? 70 : (i * 37) % 180, true);
      if (reduce) return;
      lottieIO.observe(el);
      const card = el.closest('.app-card');
      if (card) {
        card.addEventListener('mouseenter', () => anim.setSpeed(1.8));
        card.addEventListener('mouseleave', () => anim.setSpeed(1));
      }
    });
  }

  /* ---------- Tarjetas con inclinación 3D ---------- */
  if (finePointer && !reduce) {
    $$('[data-tilt]').forEach((el) => {
      const max = parseFloat(el.dataset.tilt) || 8;
      let frame = 0;
      let last = null;
      el.addEventListener('pointermove', (e) => {
        last = e;
        el.classList.add('is-tilting');
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
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
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        el.classList.remove('is-tilting');
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* =========================================================
     ESCENA 3D DEL HERO + PARALLAX
     ========================================================= */
  const hero = $('#home');
  const scene = $('#scene');
  const logo3d = $('#logo3d');
  const orbitItems = $$('#orbit .orbit-item');
  const heroCopy = $('.hero-copy');
  const heroVisual = $('.hero-visual');
  const glow = $('.cursor-glow');
  const depthEls = $$('[data-depth]');
  const speedEls = $$('[data-speed]');
  const blobs = $$('.bg span');
  const canvas = $('#stars');

  let vw = innerWidth;
  let vh = innerHeight;
  let mx = 0, my = 0;          // puntero (-1 a 1)
  let sx = 0, sy = 0;          // puntero suavizado
  let gx = vw / 2, gy = vh / 2, tgx = gx, tgy = gy;
  let heroOn = true;
  let gyro = false;
  let orbitR = 250;

  // Volumen del logo: copias apiladas en profundidad
  if (logo3d) {
    const img = logo3d.querySelector('img');
    const LAYERS = 14;
    for (let i = 1; i <= LAYERS; i++) {
      const c = img.cloneNode();
      c.alt = '';
      c.style.transform = 'translateZ(' + (-i * 1.7) + 'px)';
      c.style.filter = 'brightness(' + Math.max(0.2, 0.62 - i * 0.03).toFixed(2) + ') saturate(1.25)';
      logo3d.appendChild(c);
    }
    const shadow = img.cloneNode();
    shadow.alt = '';
    shadow.style.transform = 'translateZ(-40px) scale(1.05)';
    shadow.style.filter = 'blur(22px) brightness(1.1)';
    shadow.style.opacity = '.65';
    logo3d.appendChild(shadow);
    img.style.transform = 'translateZ(1px)';
  }

  const measure = () => {
    vw = innerWidth;
    vh = innerHeight;
    if (scene) orbitR = Math.min(scene.clientWidth * (vw < 640 ? 0.38 : 0.44), 260);
  };
  measure();

  // Puntero / giroscopio
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    mx = e.clientX / vw * 2 - 1;
    my = e.clientY / vh * 2 - 1;
    tgx = e.clientX;
    tgy = e.clientY;
    if (glow) glow.classList.add('on');
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { mx = 0; my = 0; if (glow) glow.classList.remove('on'); });

  if (!finePointer) {
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return;
      gyro = true;
      mx = clamp(e.gamma / 30, -1, 1);
      my = clamp((e.beta - 45) / 30, -1, 1);
    }, { passive: true });
  }

  if (hero) {
    new IntersectionObserver(([e]) => { heroOn = e.isIntersecting; }, { rootMargin: '60px' }).observe(hero);
  }

  /* ---------- Partículas ---------- */
  let ctx = null;
  let parts = [];
  let cw = 0, ch = 0;
  const setupStars = () => {
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
  };
  setupStars();

  const drawStars = (t) => {
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    for (const p of parts) {
      p.y -= p.z * 0.22;
      if (p.y < -6) { p.y = ch + 6; p.x = Math.random() * cw; }
      const x = p.x - sx * 40 * p.z;
      const y = p.y - sy * 26 * p.z;
      const a = (0.25 + 0.75 * Math.abs(Math.sin(t / 1100 + p.tw))) * p.z;
      ctx.fillStyle = p.red ? 'rgba(255,90,70,' + a.toFixed(3) + ')' : 'rgba(255,255,255,' + (a * 0.85).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 0.4 + p.z * 1.5, 0, TAU);
      ctx.fill();
    }
  };

  /* ---------- Órbita de apps ---------- */
  const placeOrbit = (t) => {
    const n = orbitItems.length;
    const ry = orbitR * 0.28;
    orbitItems.forEach((el, i) => {
      const a = t * 0.00024 + i * TAU / n;
      const depth = Math.sin(a);                      // -1 atrás · 1 adelante
      const x = Math.cos(a) * orbitR + sx * 14 * depth;
      const y = depth * ry + 40 * (orbitR / 260) - sy * 16 * depth;
      const k = (depth + 1) / 2;
      el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) scale(' + (0.66 + k * 0.38).toFixed(3) + ')';
      el.style.opacity = (0.45 + k * 0.55).toFixed(3);
      el.style.zIndex = depth > 0 ? 200 : 50;
    });
  };

  /* ---------- Bucle principal ---------- */
  const tick = (t) => {
    const auto = !finePointer && !gyro;
    const tx = auto ? Math.sin(t / 2600) * 0.6 : mx;
    const ty = auto ? Math.cos(t / 3100) * 0.35 : my;
    sx += (tx - sx) * 0.06;
    sy += (ty - sy) * 0.06;
    const y = scrollY;

    if (heroOn) {
      if (logo3d) {
        const rx = -sy * 16 + Math.sin(t / 1700) * 4;
        const ryDeg = sx * 26 + Math.sin(t / 2300) * 12;
        logo3d.style.transform = 'translateY(' + (Math.sin(t / 1300) * 10).toFixed(2) + 'px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ryDeg.toFixed(2) + 'deg)';
      }
      placeOrbit(t);
      depthEls.forEach((el) => {
        const d = parseFloat(el.dataset.depth) || 0;
        el.style.translate = (sx * d).toFixed(1) + 'px ' + (sy * d).toFixed(1) + 'px';
      });
      if (heroCopy) {
        heroCopy.style.translate = '0 ' + (y * 0.16).toFixed(1) + 'px';
        heroCopy.style.opacity = Math.max(0, 1 - y / (vh * 0.8)).toFixed(3);
      }
      if (heroVisual) heroVisual.style.translate = '0 ' + (y * 0.3).toFixed(1) + 'px';
      drawStars(t);
    }

    // Parallax de elementos con data-speed (lectura primero, luego escritura)
    const offsets = speedEls.map((el) => {
      const r = (el.offsetParent || el.parentElement).getBoundingClientRect();
      return r.top + r.height / 2 - vh / 2;
    });
    speedEls.forEach((el, i) => {
      el.style.translate = '0 ' + (-offsets[i] * (parseFloat(el.dataset.speed) || 0)).toFixed(1) + 'px';
    });

    blobs.forEach((b, i) => {
      b.style.translate = (sx * (i + 1) * -18).toFixed(1) + 'px ' + (-y * (0.12 + i * 0.1)).toFixed(1) + 'px';
    });

    if (glow && finePointer) {
      gx += (tgx - gx) * 0.12;
      gy += (tgy - gy) * 0.12;
      glow.style.transform = 'translate3d(' + gx.toFixed(1) + 'px,' + gy.toFixed(1) + 'px,0)';
    }

    requestAnimationFrame(tick);
  };

  addEventListener('resize', () => { measure(); setupStars(); }, { passive: true });

  if (reduce) {
    placeOrbit(0);
    drawStars(0);
  } else {
    requestAnimationFrame(tick);
  }
})();
