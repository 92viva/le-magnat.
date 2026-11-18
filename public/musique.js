/* Musique de fond du Magnat.
   - Sans fichier : musique d'ambiance generee par le navigateur (Web Audio), en boucle.
   - Avec des fichiers public/musique/1.mp3, 2.mp3... : lus dans l'ordre, en boucle (voir LISEZMOI.txt). */
(function () {
  'use strict';
  const KEY = 'magnat-music', VOL = 0.35;
  let on = true, active = false, started = false;
  try { if (localStorage.getItem(KEY) === '0') on = false; } catch (e) {}

  // ----- fichiers
  let tracks = null, idx = 0, audio = null, probing = false;
  const EXTS = ['mp3', 'm4a', 'ogg', 'wav'];
  function probe(i, cb) {                                   // cherche 1.xxx, 2.xxx... jusqu'au premier numéro absent
    const next = e => {
      if (e >= EXTS.length) return cb(null);
      const url = '/musique/' + i + '.' + EXTS[e];
      fetch(url, { method: 'HEAD' }).then(r => (r.ok && /audio|ogg|mpeg|mp4|wav/.test(r.headers.get('content-type') || '')) ? cb(url) : next(e + 1)).catch(() => next(e + 1));
    };
    next(0);
  }
  function discover(done) {
    if (tracks) return done(); if (probing) return; probing = true;
    const list = [], go = i => probe(i, u => { if (u && i < 30) { list.push(u); go(i + 1); } else { tracks = list; probing = false; done(); } });
    go(1);
  }
  function playFile() {
    if (!audio) { audio = new Audio(); audio.volume = VOL; audio.preload = 'auto';
      audio.addEventListener('ended', () => { idx = (idx + 1) % tracks.length; audio.src = tracks[idx]; audio.play().catch(() => {}); }); }
    audio.loop = tracks.length === 1;
    if (!audio.src) audio.src = tracks[idx];
    audio.play().catch(() => { started = false; });         // bloqué par le navigateur : on réessaiera au prochain clic
  }

  // ----- musique par défaut (synthèse)
  let ctx = null, out = null, timer = 0, nextT = 0, step = 0;
  const BPM = 92, S16 = 60 / BPM / 4;
  const BASS = [55, 0, 0, 55, 0, 0, 82.4, 0, 65.4, 0, 0, 65.4, 0, 73.4, 0, 0];             // La mineur (A1, E2, C2, D2)
  const PAD = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
  function note(f, t, d, type, v, lp) {
    const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = lp || 1200;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(fl); fl.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
  }
  let nb = null;
  function hat(t, v) {
    if (!nb) { nb = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate); const a = nb.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = nb; f.type = 'highpass'; f.frequency.value = 7000; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + 0.06);
  }
  function schedule() {
    while (nextT < ctx.currentTime + 0.4) {
      const s = step % 64, bar = (s / 16) | 0, k = s % 16;
      if (BASS[k]) { const f = BASS[k] * [1, 0.89, 0.794, 0.891][bar]; note(f, nextT, S16 * 2.2, 'sawtooth', 0.5, 500); }
      if (k === 0) PAD[bar].forEach(f => note(f, nextT, S16 * 15, 'triangle', 0.09, 900));
      if (k % 4 === 0) note(48, nextT, 0.18, 'sine', 0.6, 300);                           // grosse caisse douce
      if (k % 2 === 1) hat(nextT, k % 4 === 3 ? 0.12 : 0.07);
      if (k === 4 || k === 12) hat(nextT, 0.16);
      nextT += S16; step++;
    }
  }
  function startSynth() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); out = ctx.createGain(); out.gain.value = 0.22; out.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    if (!timer) { nextT = ctx.currentTime + 0.1; step = 0; timer = setInterval(schedule, 100); }
  }
  function stopSynth() { if (timer) { clearInterval(timer); timer = 0; } if (ctx && ctx.state === 'running') ctx.suspend(); }

  // ----- contrôle
  function sync() {
    const want = on && active;
    if (!want) { if (audio) audio.pause(); stopSynth(); started = false; return; }
    if (started) return;
    started = true;
    discover(() => { if (!(on && active)) { started = false; return; } if (tracks.length) playFile(); else startSynth(); });
  }
  window.Music = {
    setActive(v) { v = !!v; if (v !== active) { active = v; sync(); } },
    setOn(v) { on = !!v; try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {} sync(); },
    isOn: () => on
  };
  // les navigateurs exigent un clic avant de jouer du son : on relance au prochain clic si besoin
  addEventListener('pointerdown', () => { if (on && active && !started) sync(); else if (ctx && ctx.state === 'suspended' && started) ctx.resume(); });
})();
