/* =========================================================
   Música de fondo — Jh Company
   Reproduce un fragmento de un video de YouTube en bucle.
   Usa dos reproductores que se turnan con un fundido cruzado,
   así el regreso al inicio del fragmento no se escucha cortado.
   Ajustes en js/config.js → music.
   ========================================================= */
(() => {
  'use strict';

  const conf = (window.JH_CONFIG && window.JH_CONFIG.music) || {};
  const ui = document.getElementById('music');
  const host = document.getElementById('yt-decks');
  if (!ui || !host || !conf.youtubeId) return;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const START = Math.max(0, num(conf.start, 0));
  const END = Math.max(START + 6, num(conf.end, START + 60));
  const VOLUME = clamp(num(conf.volume, 70), 0, 100);
  const FADE = clamp(num(conf.fade, 3), 0.5, (END - START) / 3); // segundos

  const ENDED = 0;
  const PLAYING = 1;
  const PAUSED = 2;
  const BUFFERING = 3;

  // iPhone y iPad no permiten cambiar el volumen desde la página: ahí no hay fundido
  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const canFade = !isIOS;

  const playBtn = ui.querySelector('[data-music="play"]');
  const muteBtn = ui.querySelector('[data-music="mute"]');

  // Recuerda si el visitante pausó o silenció la música
  const store = {
    get(k) { try { return localStorage.getItem('jh-music-' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('jh-music-' + k, v); } catch (e) { /* sin almacenamiento */ } }
  };

  let muted = store.get('muted') === '1';
  let userPaused = store.get('paused') === '1';
  let wantStart = false;   // hubo un clic antes de que YouTube estuviera listo
  let phase = 'loading';   // loading · waiting · starting · playing · paused · off
  let single = !canFade;   // true = un solo reproductor (sin fundido cruzado)
  let cur = 0;             // reproductor que suena ahora
  let xf = null;           // fundido cruzado en curso
  let fadeIn = null;
  let tryTimer = 0;
  let verifyTimer = 0;
  let hiddenPause = false;
  let armed = false;
  let lastSeek = 0;
  const decks = [];

  function Deck() {
    this.p = null;        // YT.Player
    this.ready = false;
    this.state = -1;
    this.started = false; // ya reprodujo alguna vez
    this.primed = false;  // pausado en el inicio del fragmento, listo para sonar
    this.priming = false;
    this.want = false;    // debe estar sonando
    this.vol = -1;
  }

  const call = (d, fn, ...args) => {
    try { return d.p[fn](...args); } catch (e) { return undefined; }
  };
  const setVol = (d, v) => {
    v = Math.round(clamp(v, 0, 100));
    if (d.vol !== v) { d.vol = v; call(d, 'setVolume', v); }
  };
  const timeOf = (d) => {
    const t = call(d, 'getCurrentTime');
    return typeof t === 'number' ? t : null;
  };

  function render() {
    ui.dataset.state = phase;
    ui.dataset.muted = String(muted);
    playBtn.setAttribute('aria-label', phase === 'playing' ? 'Pause music' : 'Play music');
    muteBtn.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
    muteBtn.setAttribute('aria-pressed', String(muted));
  }

  /* ---------- Cargar YouTube ---------- */
  function loadApi() {
    if (window.YT && window.YT.Player) { init(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      init();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = off;
    document.head.appendChild(s);
    setTimeout(() => { if (phase === 'loading') off(); }, 25000);
  }

  function init() {
    if (decks.length) return;
    const count = single ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const d = new Deck();
      const el = document.createElement('div');
      host.appendChild(el);
      decks.push(d);
      d.p = new window.YT.Player(el, {
        width: 200,
        height: 200,
        videoId: conf.youtubeId,
        playerVars: {
          autoplay: 0, controls: 0, disablekb: 1, fs: 0,
          iv_load_policy: 3, playsinline: 1, rel: 0, start: Math.floor(START)
        },
        events: {
          onReady: () => ready(d),
          onStateChange: (e) => changed(d, e.data),
          onError: () => failed(d),
          onAutoplayBlocked: () => blockedEvent(d)
        }
      });
    }
  }

  function ready(d) {
    d.ready = true;
    call(d, 'mute');
    setVol(d, 0);
    const frame = call(d, 'getIframe');
    if (frame) { frame.tabIndex = -1; frame.title = 'Background music'; }
    if (d !== decks[0]) return;
    ui.hidden = false;
    if (wantStart && !userPaused) { play(false); return; } // ya hubo un clic: el navegador lo permite
    if (userPaused) {
      phase = 'paused';
      render();
      prime(d);
      return;
    }
    // Firefox avisa de antemano si el navegador bloqueará el sonido
    let policy = '';
    try { policy = navigator.getAutoplayPolicy ? navigator.getAutoplayPolicy('mediaelement') : ''; } catch (e) { policy = ''; }
    if (policy && policy !== 'allowed' && !muted) {
      waitForTap();
      return;
    }
    play(true);
  }

  /* ---------- Reproducir / esperar el primer toque ---------- */
  function play(auto) {
    const d = decks[cur];
    if (!d || !d.ready || phase === 'off') return;
    clearTimeout(tryTimer);
    clearTimeout(verifyTimer);
    wantStart = false;
    d.priming = false;
    d.want = true;
    phase = 'starting';
    render();
    call(d, muted ? 'mute' : 'unMute');
    setVol(d, 0);
    call(d, 'playVideo');
    let tries = 0;
    const check = () => {
      if (phase !== 'starting' || d.state === PLAYING) return;
      tries += 1;
      if (d.state === BUFFERING && tries < 8) { tryTimer = setTimeout(check, 1500); return; } // internet lento
      waitForTap();
    };
    tryTimer = setTimeout(check, auto ? 2500 : 3000);
  }

  // El navegador no dejó sonar la música sin interacción: se prepara en silencio
  // y empieza con el primer toque, clic o tecla del visitante.
  function waitForTap() {
    clearTimeout(tryTimer);
    clearTimeout(verifyTimer);
    const d = decks[cur];
    d.want = false;
    call(d, 'mute');
    phase = 'waiting';
    render();
    prime(d);
    if (!muted && !userPaused) arm();
  }

  function blockedEvent(d) {
    if (d === decks[cur] && phase === 'starting') waitForTap();
    else if (xf && d === xf.to) abortXfade(true);
  }

  const GESTURES = ['pointerup', 'touchend', 'keydown'];
  function arm() {
    if (armed) return;
    armed = true;
    GESTURES.forEach((t) => addEventListener(t, gesture, true));
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    GESTURES.forEach((t) => removeEventListener(t, gesture, true));
  }
  function gesture(e) {
    if (muted || userPaused || phase === 'off' || phase === 'playing') { disarm(); return; }
    if (e.target && e.target.closest && e.target.closest('#music')) return; // los botones de música deciden solos
    if (e.type === 'keydown' && (e.key === 'Escape' || e.altKey || e.ctrlKey || e.metaKey)) return;
    const d = decks[cur];
    if (!d || !d.ready) { wantStart = true; return; } // YouTube aún carga: sonará en cuanto esté listo
    if (phase === 'waiting' || (phase === 'starting' && d.state !== PLAYING)) play(false);
  }

  // Deja un reproductor pausado en el inicio del fragmento, listo para sonar
  function prime(d) {
    if (!d || !d.ready) return;
    d.want = false;
    d.primed = false;
    call(d, 'mute');
    setVol(d, 0);
    if (d.started) {
      call(d, 'pauseVideo');
      call(d, 'seekTo', START, true);
      d.primed = true;
    } else {
      // nunca ha sonado: arranca en silencio y se pausa en cuanto empieza (así se carga)
      d.priming = true;
      call(d, 'seekTo', START, true);
      call(d, 'playVideo');
    }
  }

  function changed(d, s) {
    d.state = s;
    if (s === PLAYING) d.started = true;

    if (d.priming) {
      if (s === PLAYING) {
        d.priming = false;
        call(d, 'pauseVideo');
        call(d, 'seekTo', START, true);
        d.primed = true;
      }
      return;
    }
    if (s === PLAYING && !d.want) { call(d, 'pauseVideo'); return; } // uno en espera nunca debe sonar
    if (d !== decks[cur] || !d.want) return;

    if (s === PLAYING && phase === 'starting') {
      clearTimeout(tryTimer);
      disarm();
      phase = 'playing';
      fadeIn = { d, t0: performance.now(), dur: 1500 };
      render();
      // Algunos navegadores arrancan el video pero en silencio: se trata como bloqueado
      clearTimeout(verifyTimer);
      verifyTimer = setTimeout(() => {
        if (phase === 'playing' && !muted && call(d, 'isMuted') === true) waitForTap();
      }, 1200);
    } else if (s === ENDED) {
      call(d, 'seekTo', START, true);
      call(d, 'playVideo');
    } else if (s === PAUSED && phase === 'playing' && !hiddenPause && !xf) {
      // pausado desde fuera (por ejemplo, los controles multimedia del celular)
      d.want = false;
      fadeIn = null;
      phase = 'paused';
      render();
    }
  }

  function failed(d) {
    if (d === decks[cur] && !(xf && xf.to === d)) { off(); return; }
    if (xf && xf.to === d) abortXfade(true);
    d.ready = false;
    single = true; // el segundo reproductor falló: se sigue con uno solo
  }

  function off() {
    phase = 'off';
    clearTimeout(tryTimer);
    clearTimeout(verifyTimer);
    disarm();
    ui.hidden = true;
    decks.forEach((d) => call(d, 'pauseVideo'));
  }

  /* ---------- Bucle con fundido cruzado ---------- */
  function tick() {
    if (phase !== 'playing') return;
    const now = performance.now();
    if (xf) { stepXfade(now); return; }

    const d = decks[cur];
    if (fadeIn) {
      const p = clamp((now - fadeIn.t0) / fadeIn.dur, 0, 1);
      setVol(fadeIn.d, VOLUME * p);
      if (p >= 1) fadeIn = null;
    }
    const t = timeOf(d);
    if (t === null || d.state !== PLAYING) return;

    // Fuera del fragmento (por ejemplo después de un anuncio): vuelve al inicio
    if ((t < START - 3 || t > END + 6) && now - lastSeek > 2000) {
      lastSeek = now;
      call(d, 'seekTo', START, true);
      return;
    }

    const other = single ? null : decks[1 - cur];
    if (other && other.ready && !other.primed && !other.priming) prime(other);

    if (t >= END - FADE) {
      if (t < END && other && other.ready && other.primed) { startXfade(now); return; }
      if (t >= END) { if (now - lastSeek > 1000) loopSingle(d, now); return; }
      if (canFade && !fadeIn) setVol(d, VOLUME * clamp((END - t) / FADE, 0, 1));
    }
  }

  // Con un solo reproductor: baja el volumen, vuelve al inicio y lo sube de nuevo
  function loopSingle(d, now) {
    lastSeek = now;
    call(d, 'seekTo', START, true);
    if (canFade) {
      setVol(d, 0);
      fadeIn = { d, t0: now, dur: 900 };
    }
  }

  function startXfade(now) {
    const from = decks[cur];
    const to = decks[1 - cur];
    fadeIn = null;
    to.primed = false;
    to.want = true;
    xf = { from, to, asked: now, t0: 0, fromVol: VOLUME };
    call(to, muted ? 'mute' : 'unMute');
    setVol(to, 0);
    call(to, 'playVideo');
  }

  function stepXfade(now) {
    const { from, to } = xf;
    if (!xf.t0) {
      if (to.state === PLAYING) {
        xf.t0 = now;
        xf.fromVol = from.vol < 0 ? VOLUME : from.vol;
        return;
      }
      // Mientras el segundo arranca, el primero se va apagando hacia el final del fragmento.
      // Si tarda demasiado, este ciclo vuelve al inicio con un solo reproductor.
      const t = timeOf(from);
      if (t !== null && canFade) setVol(from, VOLUME * clamp((END - t) / FADE, 0, 1));
      if (now - xf.asked > 3500 || (t !== null && t > END + 0.3)) abortXfade(false);
      return;
    }
    const p = clamp((now - xf.t0) / (FADE * 1000), 0, 1);
    // Fundido de igual potencia: el volumen total se mantiene parejo
    setVol(from, xf.fromVol * Math.cos(p * Math.PI / 2));
    setVol(to, VOLUME * Math.sin(p * Math.PI / 2));
    if (p > 0.3 && !muted && call(to, 'isMuted') === true) { abortXfade(true); return; } // arrancó sin sonido
    if (p >= 1) finishXfade();
  }

  function finishXfade() {
    const { from, to } = xf;
    xf = null;
    from.want = false;
    call(from, 'pauseVideo');
    call(from, 'mute');
    setVol(from, 0);
    setVol(to, VOLUME);
    cur = decks.indexOf(to);
    prime(from);
  }

  function abortXfade(goSingle) {
    if (!xf) return;
    const { from, to } = xf;
    xf = null;
    to.want = false;
    to.primed = false;
    call(to, 'pauseVideo');
    call(to, 'mute');
    setVol(to, 0);
    const t = timeOf(from);
    if (t !== null && t < END - FADE) setVol(from, VOLUME); // si ya va de salida, el bucle normal lo apaga
    if (goSingle) single = true;
  }

  function pauseNow() {
    clearTimeout(tryTimer);
    clearTimeout(verifyTimer);
    fadeIn = null;
    if (xf) {
      if (xf.t0) finishXfade();
      else abortXfade(false);
    }
    const d = decks[cur];
    if (!d) return;
    d.want = false;
    call(d, 'pauseVideo');
  }

  /* ---------- Botones ---------- */
  playBtn.addEventListener('click', () => {
    if (phase === 'off') return;
    if (phase === 'playing') {
      userPaused = true;
      store.set('paused', '1');
      pauseNow();
      phase = 'paused';
      render();
      return;
    }
    // Si todavía no suena (cargando, esperando o intentando), este clic la arranca
    userPaused = false;
    store.set('paused', '0');
    const d = decks[cur];
    if (!d || !d.ready) { wantStart = true; return; }
    play(false);
  });


  muteBtn.addEventListener('click', () => {
    if (phase === 'off') return;
    muted = !muted;
    store.set('muted', muted ? '1' : '0');
    decks.forEach((d) => {
      if (!d.ready) return;
      const onAir = d.want && (d === decks[cur] || (xf && d === xf.to));
      call(d, muted || !onAir ? 'mute' : 'unMute');
    });
    if (!muted && phase === 'waiting' && !userPaused) play(false);
    render();
  });

  // Pausa cuando la pestaña no se ve y sigue al volver
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (phase === 'playing' || phase === 'starting') {
        hiddenPause = true;
        pauseNow();
      }
    } else if (hiddenPause) {
      hiddenPause = false;
      if (!userPaused && phase !== 'off') play(false);
    }
  });

  render();
  setInterval(tick, 50);
  // El primer clic, toque o tecla en cualquier parte de la página arranca la música
  if (!userPaused && !muted) arm();
  loadApi(); // YouTube empieza a cargar de inmediato para estar listo al primer clic
})();
