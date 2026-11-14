(() => {
'use strict';
const M = window.Magnat;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORD = ['1er', '2e', '3e', '4e', '5e', '6e'];
const LEVEL_LABEL = { easy: 'Tranquille', medium: 'Sérieuse', hard: 'À couteaux tirés' };
const CID_RE = /^[A-Za-z0-9_-]{16,64}$/;

// ---------- Stockage local (facultatif) ----------
function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function makeCid() {
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
let cid = load('magnat-cid');
if (!CID_RE.test(cid || '')) { cid = makeCid(); store('magnat-cid', cid); }

// ---------- État ----------
let V = null;            // dernière vue envoyée par le serveur
let sel = [];            // ids des cartes sélectionnées
let ws = null, backoff = 1000, pingTimer = null, replaced = false;
let queue = [];          // création / jonction demandées avant l'ouverture de la connexion
let shownOverlay = '';   // pour ne donner le focus à la fenêtre qu'une fois

// ---------- Connexion ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws');
  ws.onopen = () => {
    backoff = 1000; showConn(false);
    const saved = load('magnat-room');
    if (saved && !queue.length) queue.push({ t: 'join', cid, name: myName(), code: saved });
    queue.forEach(o => ws.send(JSON.stringify(o)));
    queue = [];
    clearInterval(pingTimer);
    pingTimer = setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"t":"ping"}'); }, 25000);
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onServer(m); };
  ws.onclose = ev => {
    clearInterval(pingTimer); ws = null;
    if (ev.code === 4000) { replaced = true; showConn(true, 'Cette table est ouverte dans un autre onglet.'); return; }
    showConn(true);
    setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 8000);
  };
  ws.onerror = () => {};
}
function send(o) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
  else if (o.t === 'create' || o.t === 'join') { queue = [o]; toast('Connexion en cours…'); }
  else toast('Connexion perdue. Réessaie dans un instant.');
}
function showConn(on, text) {
  const el = $('conn');
  el.hidden = !on;
  el.textContent = text || 'Connexion perdue. Reconnexion…';
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !ws && !replaced) { backoff = 1000; connect(); }
});

function onServer(m) {
  switch (m.t) {
    case 'state':
      V = m; store('magnat-room', m.code);
      sel = sel.filter(id => V.hand.some(c => c.id === id));
      if (!(V.status === 'play' && V.current === V.you) && !needGive()) sel = [];
      render();
      break;
    case 'error':
      toast(m.msg);
      if (m.code === 'noroom' || m.code === 'started' || m.code === 'full') {
        if (m.code === 'noroom') V = null;
        store('magnat-room', null);
        render();
      }
      break;
    case 'kicked':
      V = null; store('magnat-room', null); toast('L’hôte t’a retiré de la table.'); render(); break;
    case 'left':
      V = null; store('magnat-room', null); render(); break;
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- Accueil ----------
function myName() { return ($('name').value || load('magnat-name') || '').trim(); }
function needName() {
  const n = myName();
  if (!n) { toast('Choisis un pseudo d’abord.'); $('name').focus(); return null; }
  store('magnat-name', n);
  return n;
}
$('name').value = load('magnat-name') || '';
const hashCode = (location.hash || '').replace('#', '').toUpperCase();
if (/^[A-Z]{4}$/.test(hashCode)) $('code').value = hashCode;

$('createForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = needName(); if (!name) return;
  store('magnat-room', null);
  send({ t: 'create', cid, name, rounds: Number($('roundsNew').value) });
});
$('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = needName(); if (!name) return;
  const code = $('code').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { toast('Le code a 4 lettres.'); $('code').focus(); return; }
  send({ t: 'join', cid, name, code });
});
$('code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });

// ---------- Salon ----------
function renderLobby() {
  const amHost = V.host === V.you;
  $('lobbyCode').textContent = V.code;
  $('lobbyCount').textContent = V.n + ' joueur' + (V.n > 1 ? 's' : '') + ' sur 6';
  const link = location.origin + '/#' + V.code;
  if ($('shareLink').value !== link) $('shareLink').value = link;
  $('seatList').innerHTML = V.seats.map((s, i) => {
    const tags = (i === V.host ? '<span class="tag host">Hôte</span>' : '')
      + (s.bot ? '<span class="tag">Bot</span>' : '')
      + (i === V.you ? '<span class="tag">Toi</span>' : '')
      + (!s.connected ? '<span class="tag off">Absent</span>' : '');
    const kick = amHost && i !== V.you ? '<button class="btn small" type="button" data-kick="' + i + '">Retirer</button>' : '';
    return '<li class="seatrow"><span class="who">' + esc(s.name) + '</span><span class="tags">' + tags + '</span>' + kick + '</li>';
  }).join('');
  $('hostCtl').hidden = !amHost;
  $('addBot').disabled = V.n >= 6;
  if (document.activeElement !== $('levelSel')) $('levelSel').value = V.level;
  if (document.activeElement !== $('roundsSel')) $('roundsSel').value = String(V.rounds);
  $('cfgInfo').textContent = amHost ? '' : 'Bots : niveau ' + LEVEL_LABEL[V.level].toLowerCase() + ' · ' + V.rounds + ' manche' + (V.rounds > 1 ? 's' : '');
  const hostName = V.seats[V.host] ? V.seats[V.host].name : 'l’hôte';
  $('startBtn').hidden = !amHost;
  $('startBtn').disabled = V.n < 4;
  $('lobbyHint').textContent = V.n < 4
    ? 'Il faut au moins 4 joueurs. Ajoute des bots ou attends tes amis (' + V.n + '/4).'
    : amHost ? 'La partie peut commencer.' : 'En attente de ' + hostName + '…';
}
$('seatList').addEventListener('click', e => {
  const b = e.target.closest('[data-kick]'); if (!b) return;
  send({ t: 'kick', seat: Number(b.dataset.kick) });
});
$('addBot').addEventListener('click', () => send({ t: 'addbot' }));
$('levelSel').addEventListener('change', e => send({ t: 'config', level: e.target.value }));
$('roundsSel').addEventListener('change', e => send({ t: 'config', rounds: Number(e.target.value) }));
$('startBtn').addEventListener('click', () => send({ t: 'start' }));
$('leaveLobby').addEventListener('click', () => send({ t: 'leave' }));
$('leaveGame').addEventListener('click', () => {
  if (confirmLeave) { confirmLeave = false; $('leaveGame').textContent = 'Quitter'; send({ t: 'leave' }); }
  else { confirmLeave = true; $('leaveGame').textContent = 'Confirmer : un bot te remplace'; setTimeout(() => { confirmLeave = false; $('leaveGame').textContent = 'Quitter'; }, 4000); }
});
let confirmLeave = false;
$('copyLink').addEventListener('click', async () => {
  const link = $('shareLink').value;
  try { await navigator.clipboard.writeText(link); toast('Lien copié.'); }
  catch (e) { $('shareLink').select(); toast('Sélectionné : copie-le avec Ctrl+C.'); }
});

// ---------- Partie ----------
function cardLabel(c) { return M.cardName(c); }
function faceHTML(c, tag, extra, attrs) {
  const red = (c.suit === 'H' || c.suit === 'D') ? ' red' : '';
  const jk = c.rank === M.JOKER ? ' joker' : '';
  return '<' + tag + (tag === 'button' ? ' type="button"' : ' role="img"') + ' class="card' + red + jk + (extra || '') + '" ' + (attrs || '')
    + ' aria-label="' + esc(cardLabel(c)) + '"><span class="r">' + M.RANK_LABEL[c.rank] + '</span><span class="s">' + M.SUITS[c.suit] + '</span></' + tag + '>';
}
function sortedHand() {
  return V.hand.slice().sort((a, b) => M.strength(a.rank, V.rev) - M.strength(b.rank, V.rev) || a.suit.localeCompare(b.suit));
}
let PI = { ranks: new Set(), joker: false, all: true };
function computePI() {
  const t = V.table;
  if (!t) { PI = { ranks: new Set(), joker: false, all: true }; return; }
  const mv = M.generateMoves(V.hand, t, V.rev);
  PI = { ranks: new Set(), joker: false, all: false, moves: mv };
  for (const m of mv) {
    if (m.rank === M.JOKER) PI.joker = true;
    else { PI.ranks.add(m.rank); if (m.jokers > 0) PI.joker = true; }
    if (m.cards.length === 1 && M.isSpade3(m.cards[0]) && t.rank === M.JOKER) PI.ranks.add(m.rank);
  }
}
function cardPlayable(c) {
  if (PI.all) return true;
  return c.rank === M.JOKER ? PI.joker : PI.ranks.has(c.rank);
}
function autoPick(c, need) {
  const same = V.hand.filter(x => x.rank === c.rank && x.id !== c.id).sort((a, b) => (M.isSpade3(a) ? 1 : 0) - (M.isSpade3(b) ? 1 : 0));
  let pick = [c].concat(same).slice(0, need);
  if (pick.length < need) pick = pick.concat(V.hand.filter(x => x.rank === M.JOKER).slice(0, need - pick.length));
  return pick.map(x => x.id);
}
function needText() {
  const t = V.table;
  if (!t) return 'Tu ouvres : joue une carte ou un groupe de même valeur.';
  if (t.rank === M.JOKER) return 'Seul le 3 de pique bat le Joker.';
  const q = t.count === 1 ? 'une carte' : t.count + ' cartes de même valeur';
  return 'Il faut ' + q + ' plus forte' + (t.count > 1 ? 's' : '') + ' que ' + M.rankWord(t.rank, t.count > 1) + ', ou passer.';
}
function seatHTML(i) {
  const s = V.seats[i];
  const exWait = V.status === 'exchange' && V.exchange && V.exchange.pairs.some(p => p.rich === i && !p.done);
  const turn = (V.status === 'play' && V.current === i) || exWait;
  const backs = Math.min(s.count, 6);
  let status;
  if (s.pos >= 0) status = '<span class="chip' + (s.pos === V.n - 1 ? ' last' : '') + '">' + ORD[s.pos] + ' · ' + M.roleName(V.n, s.pos) + '</span>';
  else if (turn) status = '<span class="now">' + (exWait ? 'Choisit ses cartes…' : 'Réfléchit…') + '</span>';
  else if (s.passed) status = '<span class="now quiet">A passé</span>';
  else status = '<span class="now"></span>';
  const where = (s.bot ? ' · bot' : '') + (!s.connected ? ' · absent' : '');
  return '<div class="seat' + (turn ? ' turn' : '') + (!s.connected ? ' away' : '') + '">'
    + '<span class="nm">' + esc(s.name) + '</span>'
    + '<span class="stack" aria-hidden="true">' + '<span class="mini"></span>'.repeat(backs) + '</span>'
    + '<span class="meta">' + (s.pos >= 0 && s.count === 0 ? 'Terminé' : s.count + ' carte' + (s.count > 1 ? 's' : '')) + ' · ' + s.score + ' pt' + (s.score > 1 ? 's' : '') + where + '</span>'
    + status + '</div>';
}
function renderLadder() {
  const order = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  if (V.rev) order.reverse();
  $('ladder').innerHTML = order.map(r => '<li class="' + (r === 8 ? 'cut' : '') + '" title="' + M.RANK_WORD[r] + '">' + M.RANK_LABEL[r] + '</li>').join('')
    + '<li class="jk" title="Joker">★</li>';
  $('gRev').hidden = !V.rev;
}
function renderCenter() {
  let inner = '';
  const t = V.table;
  const name = i => esc(V.seats[i] ? V.seats[i].name : '');
  if (V.status === 'exchange' && V.exchange) {
    const waiting = V.exchange.pairs.filter(p => !p.done).map(p => '<b>' + name(p.rich) + '</b> choisit ' + p.k + ' carte' + (p.k > 1 ? 's' : '') + ' pour ' + name(p.poor));
    inner += '<div class="empty-table">Échange de cartes</div><div class="cap">' + (waiting.join(' · ') || 'Échanges terminés') + '</div>';
  } else if (t) {
    inner += '<div class="pile">' + t.cards.map(c => faceHTML(c, 'span')).join('') + '</div>'
      + '<div class="cap"><b>' + name(t.by) + '</b> · ' + (t.count === 1 ? 'seul' : t.count === 2 ? 'paire' : t.count === 3 ? 'brelan' : 'carré')
      + (t.count > 1 && t.rank !== M.JOKER ? ' de ' + M.RANK_WORD[t.rank] : '')
      + (t.count > 1 ? (() => { const j = t.cards.filter(c => c.rank === M.JOKER).length; return j ? ' avec ' + (j === 1 ? 'un Joker' : 'deux Jokers') : ''; })() : '') + '</div>';
  } else if (V.shown && V.shown.cut) {
    inner += '<div class="pile faded">' + V.shown.cards.map(c => faceHTML(c, 'span')).join('') + '</div>'
      + '<div class="cap">Table balayée par <b>' + name(V.shown.by) + '</b></div>';
  } else {
    inner += '<div class="empty-table">Table vide</div><div class="cap">' + (V.status === 'play' ? '<b>' + name(V.current) + '</b> ouvre' : '') + '</div>';
  }
  inner += '<div class="msg" aria-live="polite">' + esc(V.msg || '') + '</div>';
  $('center').innerHTML = inner;
}
function needGive() {
  return !!(V && V.status === 'exchange' && V.exchange && V.exchange.mine && V.exchange.mine.role === 'rich' && !V.exchange.mine.done);
}
function shortCard(c) { return c.rank === M.JOKER ? 'Joker' : M.RANK_LABEL[c.rank] + M.SUITS[c.suit]; }
function shortList(cards) { return cards.map(shortCard).join(' '); }
function exchangeHint() {
  const m = V.exchange && V.exchange.mine;
  if (!m) return 'Les échanges de cartes sont en cours…';
  const partner = V.seats[m.partner].name;
  if (m.role === 'rich') {
    if (!m.done) return 'Tu es ' + (m.k === 2 ? 'Millionnaire' : 'Riche') + '. Tu as reçu ' + shortList(m.received) + '. Choisis ' + m.k + ' carte' + (m.k > 1 ? 's' : '') + ' à donner à ' + partner + ' (' + sel.length + '/' + m.k + ').';
    return 'Tu as donné ' + shortList(m.gave) + ' à ' + partner + '. Les autres échanges sont en cours…';
  }
  return 'Tu es ' + (m.k === 2 ? 'Misérable' : 'Pauvre') + ' : tu donnes ' + shortList(m.gave) + ' à ' + partner + '. '
    + (m.done ? 'Tu reçois ' + shortList(m.received) + '.' : partner + ' choisit les cartes à te rendre…');
}
function renderHand() {
  const mine = V.status === 'play' && V.current === V.you;
  const giving = needGive();
  computePI();
  const recv = new Set(((V.exchange && V.exchange.mine && V.exchange.mine.received) || []).map(c => c.id));
  $('hand').innerHTML = sortedHand().map(c => {
    let ex = '';
    if (sel.includes(c.id)) ex = ' sel'; else if (mine && !cardPlayable(c)) ex = ' dim';
    if (recv.has(c.id)) ex += ' new';
    return faceHTML(c, 'button', ex, 'data-id="' + c.id + '" aria-pressed="' + sel.includes(c.id) + '"' + ((mine || giving) ? '' : ' aria-disabled="true"'));
  }).join('');
  $('me').classList.toggle('turn', mine || giving);
  const me = V.seats[V.you];
  $('meName').textContent = me.name;
  $('meMeta').textContent = (me.pos >= 0 ? ORD[me.pos] + ' · ' + M.roleName(V.n, me.pos) + ' · ' : V.hand.length + ' carte' + (V.hand.length > 1 ? 's' : '') + ' · ') + me.score + ' pt' + (me.score > 1 ? 's' : '');
  const cards = sel.map(id => V.hand.find(c => c.id === id)).filter(Boolean);
  const ok = giving ? sel.length === V.exchange.mine.k : (mine && M.validate(cards, V.table, V.rev).ok);
  const stuck = mine && V.table && PI.moves && PI.moves.length === 0;
  $('playBtn').textContent = giving ? 'Donner à ' + V.seats[V.exchange.mine.partner].name : 'Jouer';
  $('playBtn').hidden = V.status === 'exchange' && !giving;
  $('playBtn').disabled = !ok;
  $('passBtn').hidden = V.status === 'exchange';
  $('passBtn').disabled = !(mine && V.table);
  $('passBtn').classList.toggle('hint-pulse', !!stuck);
  const h = $('hint');
  if (V.status === 'exchange') { h.textContent = exchangeHint(); h.className = 'hint' + (giving ? ' go' : ''); }
  else if (V.status !== 'play') { h.textContent = ''; h.className = 'hint'; }
  else if (!mine) {
    h.textContent = V.hand.length === 0 ? 'Tu as fini. Les autres jouent encore.' : 'Au tour de ' + V.seats[V.current].name + '…';
    h.className = 'hint';
  } else if (stuck) { h.textContent = 'Aucun coup possible. Passe ton tour.'; h.className = 'hint go'; }
  else { h.textContent = needText(); h.className = 'hint go'; }
  // rappel de l'échange pendant la manche
  const ei = $('exInfo'), xm = V.exchange && V.exchange.mine;
  if (xm && xm.done && V.status === 'play') {
    ei.hidden = false;
    ei.textContent = xm.role === 'rich'
      ? 'Échange : tu as reçu ' + shortList(xm.received) + ' et donné ' + shortList(xm.gave) + '.'
      : 'Échange : tu as donné ' + shortList(xm.gave) + ' et reçu ' + shortList(xm.received) + '.';
  } else ei.hidden = true;
}
function renderGame() {
  $('gRound').textContent = V.round;
  $('gRounds').textContent = V.rounds;
  $('gCode').textContent = V.code;
  renderLadder();
  const order = [];
  for (let k = 1; k < V.n; k++) order.push((V.you + k) % V.n);
  $('opps').dataset.count = order.length;
  $('opps').innerHTML = order.map(seatHTML).join('');
  renderCenter();
  renderHand();
}

$('hand').addEventListener('click', e => {
  const b = e.target.closest('.card'); if (!b) return;
  if (!V) return;
  const id = Number(b.dataset.id);
  if (needGive()) {                                  // échange : on choisit librement les cartes à rendre
    const k = V.exchange.mine.k;
    if (sel.includes(id)) sel = sel.filter(x => x !== id);
    else { sel.push(id); if (sel.length > k) sel = sel.slice(sel.length - k); }
    renderHand();
    return;
  }
  if (V.status !== 'play' || V.current !== V.you) return;
  const c = V.hand.find(x => x.id === id); if (!c) return;
  const t = V.table;
  const J = M.JOKER, limit = t ? t.count : 4;
  const cur = sel.map(i => V.hand.find(x => x.id === i)).filter(Boolean);
  const real = cur.filter(x => x.rank !== J), jk = cur.length - real.length;
  const lone = t && t.rank === J;
  if (sel.includes(id)) {
    sel = sel.filter(x => x !== id);
  } else if (lone) {
    sel = [id];
  } else if (!cur.length && t && t.count > 1) {
    sel = c.rank === J ? [id] : autoPick(c, t.count);
  } else if (c.rank === J) {
    if (real.length && jk < 2 && cur.length < limit) sel.push(id);
    else if (!real.length && !cur.length) sel = [id];
    else if (!real.length && cur.length < limit && jk < 1) sel.push(id);
    else sel = [id];
  } else if (!real.length && cur.length && cur.length < limit) {
    sel.push(id);
  } else if (real.length && real[0].rank === c.rank && cur.length < limit) {
    sel.push(id);
  } else {
    sel = (t && t.count > 1) ? autoPick(c, t.count) : [id];
  }
  renderHand();
});
$('playBtn').addEventListener('click', () => {
  if (needGive()) {
    if (sel.length !== V.exchange.mine.k) return;
    $('playBtn').disabled = true;
    send({ t: 'give', ids: sel.slice() });
    sel = [];
    return;
  }
  if (!V || V.status !== 'play' || V.current !== V.you) return;
  const cards = sel.map(id => V.hand.find(c => c.id === id)).filter(Boolean);
  if (!M.validate(cards, V.table, V.rev).ok) return;
  $('playBtn').disabled = true; $('passBtn').disabled = true;
  send({ t: 'play', ids: cards.map(c => c.id) });
  sel = [];
});
$('passBtn').addEventListener('click', () => {
  if (!V || V.status !== 'play' || V.current !== V.you || !V.table) return;
  $('playBtn').disabled = true; $('passBtn').disabled = true;
  send({ t: 'pass' });
  sel = [];
});

// ---------- Fin de manche ----------
function renderOverlay() {
  const show = V && (V.status === 'roundover' || V.status === 'gameover') && V.results;
  $('overlay').hidden = !show;
  if (!show) { shownOverlay = ''; return; }
  const key = V.status + V.round;
  const r = V.results, n = V.n;
  let html;
  if (V.status === 'roundover') {
    html = '<h2 id="ovTitle">Manche ' + V.round + ' terminée</h2><ol>'
      + r.finished.map((p, i) => '<li><span class="pos">' + ORD[i] + '</span><span class="who">' + esc(V.seats[p].name) + '</span><span class="role">' + M.roleName(n, i) + '</span><span class="pts">+' + r.gained[i] + '</span></li>').join('')
      + '</ol><div class="total">Points : ' + V.seats.map(s => esc(s.name) + ' ' + s.score).join(' · ') + '</div>'
      + '<div class="btnrow"><button class="btn primary" id="ovNext" type="button">Manche suivante</button></div>';
  } else {
    const order = V.seats.map((s, i) => i).sort((a, b) => V.seats[b].score - V.seats[a].score);
    const top = V.seats[order[0]].score;
    const winners = order.filter(i => V.seats[i].score === top);
    const title = winners.length > 1 ? 'Égalité en tête' : (winners[0] === V.you ? 'Tu es le Magnat !' : esc(V.seats[winners[0]].name) + ' est le Magnat');
    html = '<h2 id="ovTitle">' + title + '</h2><ol>'
      + order.map((p, k) => '<li><span class="pos">' + (k + 1) + '</span><span class="who">' + esc(V.seats[p].name) + '</span><span class="role">' + (V.seats[p].score === top ? 'En tête' : '') + '</span><span class="pts">' + V.seats[p].score + ' pts</span></li>').join('')
      + '</ol><div class="btnrow"><button class="btn primary" id="ovAgain" type="button">Rejouer</button><button class="btn" id="ovLeave" type="button">Quitter</button></div>';
  }
  if (key === shownOverlay) return;      // déjà affichée : ne pas la reconstruire
  shownOverlay = key;
  $('panel').innerHTML = html;
  const next = $('ovNext'), again = $('ovAgain'), leave = $('ovLeave');
  if (next) { next.addEventListener('click', () => { next.disabled = true; send({ t: 'next' }); }); next.focus(); }
  if (again) { again.addEventListener('click', () => { again.disabled = true; send({ t: 'again' }); }); again.focus(); }
  if (leave) leave.addEventListener('click', () => send({ t: 'leave' }));
}

// ---------- Rendu ----------
function render() {
  const screen = !V ? 'home' : V.status === 'lobby' ? 'lobby' : 'game';
  $('home').hidden = screen !== 'home';
  $('lobby').hidden = screen !== 'lobby';
  $('game').hidden = screen !== 'game';
  if (screen === 'lobby') renderLobby();
  if (screen === 'game') renderGame();
  renderOverlay();
}

render();
connect();
})();
