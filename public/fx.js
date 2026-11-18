/* Effets sonores et visuels du Magnat (pose de carte, revolution, fin de manche...).
   Independant de la musique de fond (musique.js) : chacun a son propre bouton.
   Les sons sont generes par le navigateur (Web Audio). Tes propres sons : public/sons/LISEZMOI.txt */
(function () {
  'use strict';
  const KEY = 'magnat-fx';
  let on = true;
  try { if (localStorage.getItem(KEY) === '0') on = false; } catch (e) {}
  let ctx = null, master = null;
  const custom = {};
  const NAMES = ['pose', 'passe', 'tour', 'distribution', 'revolution', 'contre-revolution', 'victoire', 'magnat', 'defaite', 'fin'];

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
      loadCustom();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function loadCustom() {
    NAMES.forEach(n => {
      const tryExt = i => {
        const exts = ['mp3', 'ogg', 'wav']; if (i >= exts.length) return;
        fetch('/sons/' + n + '.' + exts[i]).then(r => r.ok && /audio|ogg|mpeg|wav/.test(r.headers.get('content-type') || '') ? r.arrayBuffer() : Promise.reject())
          .then(b => ctx.decodeAudioData(b)).then(buf => { custom[n] = buf; }).catch(() => tryExt(i + 1));
      };
      tryExt(0);
    });
  }
  function playCustom(n) {
    if (!custom[n]) return false;
    const s = ctx.createBufferSource(); s.buffer = custom[n]; s.connect(master); s.start(); return true;
  }
  function tone(f, t, d, type, v, to) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.05);
  }
  let nbuf = null;
  function noise(t, d, v, f, type, f2) {
    if (!nbuf) { nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const a = nbuf.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = nbuf; fl.type = type || 'highpass'; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.05);
  }
  const N = { C4: 261.6, E4: 329.6, G4: 392, C5: 523.3, E5: 659.3, G5: 784, C6: 1046.5 };
  const SND = {
    pose(o) { const t = ctx.currentTime, k = Math.min((o && o.count) || 1, 4), up = o && o.rank ? (o.rank - 3) / 13 : 0.3;
      for (let i = 0; i < k; i++) { const u = t + i * 0.045; noise(u, 0.07, 0.5, 1500 + up * 1500, 'highpass'); tone(150 + up * 60, u, 0.12, 'sine', 0.5, 55); }
      if (k >= 3) tone(90, t, 0.25, 'triangle', 0.5, 40); },
    passe() { const t = ctx.currentTime; tone(260, t, 0.09, 'triangle', 0.18, 180); },
    tour() { const t = ctx.currentTime; tone(880, t, 0.12, 'sine', 0.25); tone(1318, t + 0.09, 0.2, 'sine', 0.22); },
    distribution() { const t = ctx.currentTime; for (let i = 0; i < 9; i++) noise(t + i * 0.055, 0.05, 0.28, 2500, 'bandpass'); },
    revolution() { const t = ctx.currentTime; tone(70, t, 0.8, 'sawtooth', 0.28, 520); noise(t, 0.8, 0.45, 300, 'bandpass', 5000);
      tone(55, t + 0.78, 0.7, 'sine', 0.7, 32); noise(t + 0.78, 0.3, 0.6, 800, 'lowpass'); },
    'contre-revolution'() { const t = ctx.currentTime; tone(520, t, 0.7, 'sawtooth', 0.26, 70); noise(t, 0.7, 0.4, 5000, 'bandpass', 300);
      tone(220, t + 0.68, 0.4, 'square', 0.22, 110); },
    victoire() { const t = ctx.currentTime; [N.C5, N.E5, N.G5].forEach((f, i) => tone(f, t + i * 0.1, 0.35, 'triangle', 0.3)); },
    magnat() { const t = ctx.currentTime; [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => { tone(f, t + i * 0.11, 0.5, 'square', 0.16); tone(f * 2, t + i * 0.11, 0.5, 'sine', 0.12); });
      [N.C5, N.E5, N.G5, N.C6].forEach(f => tone(f, t + 0.5, 1.1, 'triangle', 0.22)); noise(t + 0.5, 0.6, 0.18, 6000, 'highpass'); },
    defaite() { const t = ctx.currentTime; [N.G4, 311, 261.6, 196].forEach((f, i) => tone(f, t + i * 0.16, 0.4, 'sawtooth', 0.14, f * 0.97)); },
    fin() { SND.magnat(); },
  };
  function play(n, o) {
    if (!on) return; const c = ac(); if (!c) return;
    try { if (!playCustom(n) && SND[n]) SND[n](o); } catch (e) {}
  }

  // ----- effets visuels
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cv = null, cx = null, parts = [], raf = 0;
  function canvas() {
    if (cv) return cv;
    cv = document.createElement('canvas'); cv.id = 'fxc'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv); cx = cv.getContext('2d');
    const fit = () => { cv.width = innerWidth; cv.height = innerHeight; }; fit(); addEventListener('resize', fit);
    return cv;
  }
  const COLS = ['#e60012', '#ffffff', '#ffd24a', '#ff4d5e', '#0a0a0a'];
  function spawn(n, x, y, o) {
    canvas();
    for (let i = 0; i < n; i++) {
      const a = o.rain ? Math.PI / 2 + (Math.random() - .5) * .6 : Math.random() * Math.PI * 2, sp = o.speed * (0.4 + Math.random());
      parts.push({ x: o.rain ? Math.random() * cv.width : x, y: o.rain ? -10 - Math.random() * 120 : y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: o.g,
        w: 4 + Math.random() * 8, h: 8 + Math.random() * 14, r: Math.random() * 6, vr: (Math.random() - .5) * .4, life: o.life * (0.6 + Math.random() * .6), age: 0,
        c: o.colors ? o.colors[(Math.random() * o.colors.length) | 0] : COLS[(Math.random() * COLS.length) | 0] });
    }
    if (!raf) { let last = performance.now(); const step = now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; frame(dt); raf = parts.length ? requestAnimationFrame(step) : 0; }; raf = requestAnimationFrame(step); }
  }
  function frame(dt) {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter(p => (p.age += dt) < p.life);
    for (const p of parts) {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr;
      cx.save(); cx.globalAlpha = Math.max(0, 1 - p.age / p.life); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c;
      cx.beginPath(); cx.moveTo(-p.w / 2, -p.h / 2); cx.lineTo(p.w / 2, -p.h / 3); cx.lineTo(p.w / 3, p.h / 2); cx.lineTo(-p.w / 2, p.h / 3); cx.fill(); cx.restore();
    }
    if (!parts.length) cx.clearRect(0, 0, cv.width, cv.height);
  }
  function shake() {
    if (reduce) return; const b = document.body; b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 650);
  }
  function burst(kind, el) {
    if (reduce || !on) return;
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 }, x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (kind === 'pose') spawn(14, x, y, { speed: 260, g: 500, life: 0.6, colors: ['#ffffff', '#e60012', '#ffd24a'] });
    else if (kind === 'rev') { shake(); spawn(70, innerWidth / 2, innerHeight / 2, { speed: 700, g: 200, life: 1.1, colors: ['#e60012', '#ff4d5e', '#ffffff'] }); }
    else if (kind === 'counter') { shake(); spawn(60, innerWidth / 2, innerHeight / 2, { speed: 600, g: 200, life: 1, colors: ['#ffffff', '#ffd24a', '#e60012'] }); }
    else if (kind === 'gold') spawn(120, 0, 0, { rain: true, speed: 340, g: 260, life: 2.6, colors: ['#ffd24a', '#ffffff', '#e60012', '#ffb800'] });
    else if (kind === 'win') spawn(50, 0, 0, { rain: true, speed: 300, g: 240, life: 2, colors: ['#ffffff', '#e60012', '#ffd24a'] });
  }

  // ----- réactions aux changements d'état du jeu
  function onState(prev, cur) {
    if (!on || !cur || !prev || prev.code !== cur.code) return;
    if (cur.status === 'play' && prev.status === 'play' && prev.round === cur.round) {
      const a = prev.table ? prev.table.cards.map(c => c.id).join() : '', b = cur.table ? cur.table.cards.map(c => c.id).join() : '';
      if (b && a !== b) { play('pose', cur.table); burst('pose', document.querySelector('.pile')); }
      if (!prev.rev && cur.rev) { play('revolution'); burst('rev'); }
      else if (prev.rev && !cur.rev) { play('contre-revolution'); burst('counter'); }
      if (prev.current !== cur.current) {
        if (a === b && b) play('passe');
        if (cur.current === cur.you) play('tour');
      }
    }
    if (cur.status === 'play' && (prev.status !== 'play' || prev.round !== cur.round) && cur.hand.length) play('distribution');
    if (cur.status === 'gameover' && prev.status !== 'gameover') { play('fin'); burst('gold'); }
  }
  function onFinish(pos, n) {
    if (!on) return;
    if (pos === 0) { play('magnat'); burst('gold'); }
    else if (pos === n - 1) play('defaite');
    else { play('victoire'); burst('win'); }
  }
  function setOn(v) { on = !!v; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {} if (on) { ac(); play('tour'); } }
  window.FX = { play, onState, onFinish, setOn, isOn: () => on };
  addEventListener('pointerdown', () => { if (on) ac(); }, { once: true });
})();
