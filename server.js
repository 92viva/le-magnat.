'use strict';
/* Serveur du Magnat : sert la page de jeu et gère les tables en WebSocket.
   Le serveur détient l'état de chaque partie et valide tous les coups.
   Chaque joueur ne reçoit que sa propre main. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const M = require('./public/engine.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 6;
const MAX_ROOMS = 500;
const BOT_MS = Number(process.env.MAGNAT_BOT_MS) || 900;      // délai de réflexion d'un bot
const AFK_MS = Number(process.env.MAGNAT_AFK_MS) || 25000;    // délai avant qu'un bot joue pour un joueur déconnecté
const RATE_PER_S = Number(process.env.MAGNAT_RATE) || 15;     // messages par seconde et par connexion (rafale de 30)
const LEVELS = ['easy', 'medium', 'hard'];
const BOT_NAMES = ['Robin', 'Camille', 'Sasha', 'Noa', 'Ali', 'Maya', 'Jules', 'Lina'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ');

const rooms = new Map();

// ---------- HTTP : fichiers statiques ----------
function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (e) { res.writeHead(400); return res.end(); }
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

// ---------- Tables ----------
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}
function newRoom(rounds) {
  const room = {
    code: makeCode(), seats: [], hostCid: null, status: 'lobby',
    rounds, level: 'medium', round: 0, scores: [], S: null,
    msg: '', shown: null, results: null, exchange: null, timer: null, turnToken: 0, last: Date.now()
  };
  rooms.set(room.code, room);
  return room;
}
function cleanName(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s || 'Joueur';
}
function uniqueName(room, base) {
  let name = base, k = 2;
  while (room.seats.some(s => s.name === name)) name = base.slice(0, 13) + ' ' + k++;
  return name;
}
function seatOf(room, cid) { return room.seats.findIndex(s => s.cid === cid); }
function hostSeat(room) { return room.seats.findIndex(s => s.cid && s.cid === room.hostCid); }
function humans(room) { return room.seats.filter(s => !s.bot); }

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function view(room, idx) {
  const S = room.S;
  const inGame = !!S && room.status !== 'lobby';
  return {
    t: 'state',
    code: room.code, you: idx, host: hostSeat(room),
    status: room.status, round: room.round, rounds: room.rounds, level: room.level, n: room.seats.length,
    seats: room.seats.map((s, i) => ({
      name: s.name, bot: !!s.bot, connected: s.bot ? true : !!s.connected,
      count: inGame ? S.hands[i].length : 0,
      score: room.scores[i] || 0,
      pos: inGame ? (S.out && S.out.includes(i) ? room.seats.length - 1 : S.finished.indexOf(i)) : -1,
      passed: inGame && S.passes.includes(i)
    })),
    current: inGame ? S.current : -1,
    table: inGame && S.table ? { rank: S.table.rank, count: S.table.count, by: S.table.by, cards: S.table.cards } : null,
    rev: inGame ? S.rev : false,
    hand: inGame && idx >= 0 ? S.hands[idx] : [],
    spec: idx >= 0 && !!room.seats[idx].spec,
    // mode spectateur : seul un joueur qui a fini (et l'a demandé) voit les mains des autres
    spectate: (inGame && idx >= 0 && room.status === 'play' && room.seats[idx].spec && S.hands[idx].length === 0)
      ? S.hands.map((h, i) => i === idx ? [] : h) : null,
    msg: room.msg, shown: room.shown, results: room.results,
    exchange: room.exchange && idx >= 0 ? exchangeView(room, idx) : null
  };
}
// Ce que chacun voit de l'échange : lui seul connaît les cartes qu'il donne et reçoit.
function exchangeView(room, idx) {
  const pairs = room.exchange.pairs;
  const pub = pairs.map(p => ({ rich: p.rich, poor: p.poor, k: p.k, done: p.done }));
  const p = pairs.find(q => q.rich === idx || q.poor === idx);
  let mine = null;
  if (p) {
    mine = idx === p.rich
      ? { role: 'rich', k: p.k, partner: p.poor, received: p.best, gave: p.gave, done: p.done }
      : { role: 'poor', k: p.k, partner: p.rich, gave: p.best, received: p.gave, done: p.done };
  }
  return { pairs: pub, mine };
}
function broadcast(room) {
  room.last = Date.now();
  room.seats.forEach((s, i) => { if (!s.bot && s.ws) send(s.ws, view(room, i)); });
}
function destroyIfEmpty(room) {
  if (humans(room).length === 0) {
    clearTimeout(room.timer);
    rooms.delete(room.code);
    return true;
  }
  return false;
}
function ensureHost(room) {
  if (hostSeat(room) >= 0) return;
  const h = room.seats.find(s => !s.bot);
  room.hostCid = h ? h.cid : null;
}

// ---------- Déroulement ----------
function startGame(room) {
  room.scores = room.seats.map(() => 0);
  room.round = 1; room.results = null; room.magnat = null; room.rank = null;
  startRound(room, null);
}
function S_magnat(room) { room.S.magnat = room.magnat == null ? null : room.magnat; }
function startRound(room, starter, prevOrder) {
  room.S = {};
  M.newRound(room.S, starter == null ? 0 : starter, room.seats.length);
  if (starter == null) {                       // 1re manche : celui qui a la Dame de cœur ouvre
    starter = room.S.hands.findIndex(h => h.some(c => c.rank === 12 && c.suit === 'H'));
    if (starter < 0) starter = 0;
    room.S.current = starter;
  }
  S_magnat(room);
  room.shown = null; room.results = null; room.exchange = null;
  room.msg = 'Manche ' + room.round + ' : ' + room.seats[starter].name + ' ouvre'
    + (prevOrder ? ' (dernier de la manche précédente).' : ' (il a la Dame de cœur).');
  if (prevOrder) return startExchange(room, prevOrder);   // dès la 2e manche
  room.status = 'play';
  broadcast(room);
  schedule(room);
}

// ---------- Échange de cartes ----------
// Le dernier donne ses 2 meilleures cartes au premier, qui lui en rend 2 de son choix.
// L'avant-dernier donne sa meilleure carte au deuxième, qui lui en rend 1 de son choix.
function moveCards(room, from, to, cards) {
  const S = room.S, ids = new Set(cards.map(c => c.id));
  S.hands[from] = S.hands[from].filter(c => !ids.has(c.id));
  S.hands[to] = S.hands[to].concat(cards);
}
function giveCards(room, p, cards) {
  moveCards(room, p.rich, p.poor, cards);
  p.gave = cards; p.done = true;
}
function autoGive(room, p) { giveCards(room, p, M.cheapestCards(room.S.hands[p.rich], p.k)); }
function startExchange(room, prevOrder) {
  const n = room.seats.length;
  const pairs = [{ poor: prevOrder[n - 1], rich: prevOrder[0], k: 2 }, { poor: prevOrder[n - 2], rich: prevOrder[1], k: 1 }];
  for (const p of pairs) {
    p.best = M.bestCards(room.S.hands[p.poor], p.k);
    moveCards(room, p.poor, p.rich, p.best);
    p.gave = null; p.done = false;
  }
  room.exchange = { pairs };
  room.status = 'exchange';
  const nm = i => room.seats[i].name;
  room.msg = 'Échange de cartes : ' + nm(pairs[0].poor) + ' donne ses 2 meilleures cartes à ' + nm(pairs[0].rich)
    + ', ' + nm(pairs[1].poor) + ' donne sa meilleure carte à ' + nm(pairs[1].rich) + '.';
  for (const p of pairs) if (room.seats[p.rich].bot) autoGive(room, p);
  afterExchange(room);
}
function afterExchange(room) {
  if (room.exchange.pairs.every(p => p.done)) {
    room.status = 'play';
    room.msg = 'Échanges terminés. ' + room.seats[room.S.current].name + ' ouvre.';
  }
  broadcast(room);
  schedule(room);
}
// Un joueur déconnecté qui doit rendre des cartes : après un délai, on rend les moins utiles à sa place.
function scheduleExchange(room) {
  const absent = p => !p.done && !room.seats[p.rich].bot && !room.seats[p.rich].connected;
  if (!room.exchange.pairs.some(absent)) return;
  const token = ++room.turnToken;
  room.timer = setTimeout(() => {
    if (room.turnToken !== token || room.status !== 'exchange') return;
    for (const p of room.exchange.pairs) if (absent(p)) autoGive(room, p);
    afterExchange(room);
  }, AFK_MS);
}
function endRound(room) {
  const S = room.S, n = room.seats.length;
  const gained = S.finished.map((p, i) => M.pointsFor(n, i));
  S.finished.forEach((p, i) => { room.scores[p] += gained[i]; });
  // Le Magnat qui n'a pas fini premier a été éliminé en cours de manche : il est déjà dernier.
  const rank = S.finished.slice();
  const demoted = S.out && S.out.length ? S.out[0] : null;
  room.rank = rank; room.magnat = rank[0];
  room.results = { finished: S.finished.slice(), gained, rank, demoted };
  room.status = room.round >= room.rounds ? 'gameover' : 'roundover';
  clearTimeout(room.timer); room.timer = null;
}
function applyPlay(room, idx, cards, prefix) {
  const ev = M.playCards(room.S, idx, cards);
  room.msg = (prefix || '') + M.describePlay(ev, room.seats[idx].name);
  if (ev.out != null) room.msg += ' ' + room.seats[ev.out].name + ' n’a pas gardé son titre de Magnat : il est éliminé et finit dernier.';
  room.shown = { cards, by: idx, cut: ev.cut };
  if (room.S.over) endRound(room);
  broadcast(room);
  schedule(room);
}
function applyPass(room, idx, prefix) {
  const r = M.passTurn(room.S, idx);
  room.msg = (prefix || '') + room.seats[idx].name + ' passe.';
  if (r.trickEnd) { room.msg += ' Tout le monde a passé : ' + room.seats[room.S.current].name + ' ouvre.'; room.shown = null; }
  broadcast(room);
  schedule(room);
}
// Un bot joue (ou un joueur déconnecté depuis trop longtemps, remplacé le temps d'un coup).
function schedule(room) {
  clearTimeout(room.timer); room.timer = null;
  if (room.status === 'exchange') return scheduleExchange(room);
  if (room.status !== 'play') return;
  const S = room.S, cur = S.current, seat = room.seats[cur];
  let delay;
  if (seat.bot) {
    const humanStillIn = S.hands.some((h, i) => !room.seats[i].bot && h.length > 0);
    delay = humanStillIn ? BOT_MS : Math.min(200, BOT_MS);
  } else if (!seat.connected) {
    delay = AFK_MS;
  } else {
    return;
  }
  const token = ++room.turnToken;
  room.timer = setTimeout(() => {
    if (room.turnToken !== token || room.status !== 'play' || room.S.current !== cur) return;
    const cards = M.chooseMove(room.S, cur, seat.bot ? room.level : 'medium');
    const prefix = seat.bot ? '' : seat.name + ' est déconnecté : un bot joue à sa place. ';
    if (cards) applyPlay(room, cur, cards, prefix); else applyPass(room, cur, prefix);
  }, delay);
}

// ---------- Sièges ----------
function addSeat(room, conn, name) {
  const seat = { cid: conn.cid, name: uniqueName(room, cleanName(name)), bot: false, ws: conn.ws, connected: true, dcTimer: null };
  room.seats.push(seat);
  room.scores.push(0);
  conn.room = room;
  if (!room.hostCid) room.hostCid = conn.cid;
  return seat;
}
function removeSeat(room, idx) {
  const [s] = room.seats.splice(idx, 1);
  room.scores.splice(idx, 1);
  clearTimeout(s.dcTimer);
  ensureHost(room);
  return s;
}
function botify(room, idx) {
  const s = room.seats[idx];
  clearTimeout(s.dcTimer);
  s.bot = true; s.cid = null; s.ws = null; s.connected = true;
  if (room.status === 'play' && room.S.current === idx) schedule(room);
  if (room.status === 'exchange') {                       // le bot rend les cartes à la place du joueur parti
    for (const p of room.exchange.pairs) if (!p.done && p.rich === idx) autoGive(room, p);
    afterExchange(room);
  }
  ensureHost(room);
}
function detach(conn) {
  const room = conn.room;
  conn.room = null;
  if (!room) return;
  const idx = seatOf(room, conn.cid);
  if (idx < 0) return;
  if (room.status === 'lobby') removeSeat(room, idx);
  else botify(room, idx);
  if (destroyIfEmpty(room)) return;
  broadcast(room);
}

// ---------- Messages ----------
function err(conn, code, msg) { send(conn.ws, { t: 'error', code, msg }); }
function validCid(c) { return typeof c === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(c); }
function validCode(c) { return typeof c === 'string' && /^[A-Z]{4}$/.test(c); }

function onMessage(conn, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  if (msg.t === 'ping') return send(conn.ws, { t: 'pong' });

  if (msg.t === 'create' || msg.t === 'join') {
    if (!validCid(msg.cid)) return err(conn, 'bad', 'Identifiant invalide.');
    conn.cid = msg.cid;
    if (msg.t === 'create') {
      if (rooms.size >= MAX_ROOMS) return err(conn, 'busy', 'Le serveur est plein, réessaie plus tard.');
      if (conn.room) detach(conn);
      const rounds = [1, 3, 5, 7].includes(msg.rounds) ? msg.rounds : 3;
      const room = newRoom(rounds);
      addSeat(room, conn, msg.name);
      return broadcast(room);
    }
    const code = String(msg.code || '').toUpperCase();
    if (!validCode(code)) return err(conn, 'noroom', 'Code de table invalide.');
    const room = rooms.get(code);
    if (!room) return err(conn, 'noroom', 'Table introuvable. Vérifie le code.');
    const idx = seatOf(room, conn.cid);
    if (idx >= 0) {                       // reconnexion
      const seat = room.seats[idx];
      if (seat.ws && seat.ws !== conn.ws) { try { seat.ws.close(4000, 'replaced'); } catch (e) {} }
      clearTimeout(seat.dcTimer);
      seat.ws = conn.ws; seat.connected = true;
      conn.room = room;
      broadcast(room);
      if (room.status === 'play' || room.status === 'exchange') schedule(room);
      return;
    }
    if (room.status !== 'lobby') return err(conn, 'started', 'La partie a déjà commencé.');
    if (room.seats.length >= MAX_PLAYERS) return err(conn, 'full', 'La table est pleine (6 joueurs).');
    if (conn.room) detach(conn);
    addSeat(room, conn, msg.name);
    return broadcast(room);
  }

  const room = conn.room;
  if (!room) return err(conn, 'noroom', 'Tu n’es dans aucune table.');
  const me = seatOf(room, conn.cid);
  if (me < 0) { conn.room = null; return err(conn, 'noroom', 'Tu n’es plus dans cette table.'); }
  const isHost = room.hostCid === conn.cid;
  room.last = Date.now();

  switch (msg.t) {
    case 'leave': {
      detach(conn);
      return send(conn.ws, { t: 'left' });
    }
    case 'spec': {
      room.seats[me].spec = !!msg.on;
      return send(conn.ws, view(room, me));
    }
    case 'addbot': {
      if (!isHost || room.status !== 'lobby') return;
      if (room.seats.length >= MAX_PLAYERS) return err(conn, 'full', 'La table est pleine.');
      const free = BOT_NAMES.find(n => !room.seats.some(s => s.name === n)) || 'Bot';
      room.seats.push({ cid: null, name: uniqueName(room, free), bot: true, ws: null, connected: true });
      room.scores.push(0);
      return broadcast(room);
    }
    case 'kick': {
      if (!isHost || room.status !== 'lobby') return;
      const i = msg.seat;
      if (!Number.isInteger(i) || i < 0 || i >= room.seats.length || i === me) return;
      const s = removeSeat(room, i);
      if (s.ws) { send(s.ws, { t: 'kicked' }); }
      return broadcast(room);
    }
    case 'config': {
      if (!isHost || room.status !== 'lobby') return;
      if (LEVELS.includes(msg.level)) room.level = msg.level;
      if ([1, 3, 5, 7].includes(msg.rounds)) room.rounds = msg.rounds;
      return broadcast(room);
    }
    case 'start': {
      if (!isHost || room.status !== 'lobby') return;
      if (room.seats.length < MIN_PLAYERS) return err(conn, 'few', 'Il faut au moins 4 joueurs (bots compris).');
      return startGame(room);
    }
    case 'botify': {
      if (!isHost) return;
      const i = msg.seat;
      if (!Number.isInteger(i) || i < 0 || i >= room.seats.length || i === me || room.seats[i].bot) return;
      room.msg = room.seats[i].name + ' est remplacé par un bot.';
      botify(room, i);
      return broadcast(room);
    }
    case 'play': {
      if (room.status !== 'play' || room.S.current !== me) return err(conn, 'turn', 'Ce n’est pas ton tour.');
      if (!Array.isArray(msg.ids) || msg.ids.length < 1 || msg.ids.length > 4 || !msg.ids.every(Number.isInteger)
        || new Set(msg.ids).size !== msg.ids.length) return err(conn, 'bad', 'Coup invalide.');
      const hand = room.S.hands[me];
      const cards = msg.ids.map(id => hand.find(c => c.id === id));
      if (cards.some(c => !c)) return err(conn, 'bad', 'Carte absente de ta main.');
      const v = M.validate(cards, room.S.table, room.S.rev);
      if (!v.ok) return err(conn, 'illegal', 'Ce coup n’est pas autorisé.');
      return applyPlay(room, me, cards);
    }
    case 'pass': {
      if (room.status !== 'play' || room.S.current !== me) return err(conn, 'turn', 'Ce n’est pas ton tour.');
      if (!room.S.table) return err(conn, 'illegal', 'Tu ouvres : tu dois jouer.');
      return applyPass(room, me);
    }
    case 'give': {
      if (room.status !== 'exchange') return err(conn, 'turn', 'Pas d’échange en cours.');
      const p = room.exchange.pairs.find(q => q.rich === me && !q.done);
      if (!p) return err(conn, 'turn', 'Tu n’as rien à donner.');
      if (!Array.isArray(msg.ids) || msg.ids.length !== p.k || !msg.ids.every(Number.isInteger)
        || new Set(msg.ids).size !== p.k) return err(conn, 'bad', 'Choisis exactement ' + p.k + ' carte' + (p.k > 1 ? 's' : '') + '.');
      const hand = room.S.hands[me];
      const cards = msg.ids.map(id => hand.find(c => c.id === id));
      if (cards.some(c => !c)) return err(conn, 'bad', 'Carte absente de ta main.');
      giveCards(room, p, cards);
      return afterExchange(room);
    }
    case 'next': {
      if (room.status !== 'roundover') return;
      const prev = (room.rank || room.S.finished).slice();
      room.round++;
      return startRound(room, prev[room.seats.length - 1], prev);
    }
    case 'again': {
      if (room.status !== 'gameover') return;
      room.status = 'lobby'; room.S = null; room.round = 0; room.results = null; room.shown = null; room.exchange = null;
      room.scores = room.seats.map(() => 0);
      room.msg = '';
      // les joueurs déconnectés quittent la table pour la prochaine partie
      for (let i = room.seats.length - 1; i >= 0; i--) if (!room.seats[i].bot && !room.seats[i].connected) removeSeat(room, i);
      if (destroyIfEmpty(room)) return;
      return broadcast(room);
    }
  }
}

wss.on('connection', ws => {
  const conn = { ws, cid: null, room: null, tokens: 30, ts: Date.now() };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    const now = Date.now();
    conn.tokens = Math.min(30, conn.tokens + (now - conn.ts) / 1000 * RATE_PER_S);
    conn.ts = now;
    if (conn.tokens < 1) {
      if (now - (conn.warned || 0) > 1000) { conn.warned = now; err(conn, 'rate', 'Trop de clics d’un coup, réessaie.'); }
      return;
    }
    conn.tokens--;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    try { onMessage(conn, msg); } catch (e) { console.error('erreur de message:', e); err(conn, 'bad', 'Action impossible.'); }
  });
  ws.on('close', () => {
    const room = conn.room;
    if (!room) return;
    const idx = seatOf(room, conn.cid);
    if (idx < 0 || room.seats[idx].ws !== ws) return;     // remplacé par une autre connexion
    const seat = room.seats[idx];
    seat.ws = null; seat.connected = false;
    if (room.status === 'lobby') {
      seat.dcTimer = setTimeout(() => {
        const i = room.seats.indexOf(seat);
        if (i >= 0 && !seat.connected && room.status === 'lobby') {
          removeSeat(room, i);
          if (!destroyIfEmpty(room)) broadcast(room);
        }
      }, 45000);
    } else if ((room.status === 'play' && room.S.current === idx) || room.status === 'exchange') {
      schedule(room);
    }
    broadcast(room);
  });
  ws.on('error', () => {});
});

// Vérifie régulièrement que les connexions répondent, et supprime les tables abandonnées.
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyone = humans(room).some(s => s.connected);
    if (!anyone && now - room.last > 30 * 60 * 1000) { clearTimeout(room.timer); rooms.delete(room.code); }
  }
}, 30000);
heartbeat.unref();

if (require.main === module) {
  server.listen(PORT, () => console.log('Le Magnat écoute sur http://localhost:' + PORT));
  const stop = () => { wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
module.exports = { server, wss, rooms };
