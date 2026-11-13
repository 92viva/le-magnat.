'use strict';
// Test d'intégration : vrais clients WebSocket contre le vrai serveur.
process.env.MAGNAT_BOT_MS = '5';
process.env.MAGNAT_AFK_MS = '150';
process.env.MAGNAT_RATE = '2000';   // les clients du test jouent bien plus vite qu'un humain
const assert = require('assert');
const E = require('../public/engine.js');
const { server, wss, rooms } = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let cidN = 0;
const newCid = () => 'test-client-id-' + String(++cidN).padStart(6, '0');

class Client {
  constructor(port, name) {
    this.name = name; this.cid = newCid(); this.port = port;
    this.state = null; this.errors = []; this.log = []; this.autoplay = false; this.closedCode = null; this.kicked = false;
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://127.0.0.1:' + this.port + '/ws');
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = e => reject(new Error('ws error'));
      this.ws.onclose = ev => { this.closedCode = ev.code; };
      this.ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.t === 'state') { this.state = m; this.log.push(m); if (this.autoplay) this.act(); }
        else if (m.t === 'error') this.errors.push(m);
        else if (m.t === 'kicked') this.kicked = true;
      };
    });
  }
  send(o) { this.lastSent = o; this.sentN = (this.sentN || 0) + 1; this.ws.send(JSON.stringify(o)); }
  create(rounds) { this.send({ t: 'create', cid: this.cid, name: this.name, rounds }); }
  join(code) { this.send({ t: 'join', cid: this.cid, name: this.name, code }); }
  close() { this.ws.close(); }
  // Joue comme un humain raisonnable, à partir de sa seule vue.
  act() {
    const v = this.state;
    if (v && v.status === 'exchange' && v.exchange && v.exchange.mine && v.exchange.mine.role === 'rich' && !v.exchange.mine.done && this.lastActed !== v) {
      this.lastActed = v;       // rend les cartes les moins utiles
      const give = E.cheapestCards(v.hand, v.exchange.mine.k);
      const send = () => { if (this.ws.readyState === 1) this.send({ t: 'give', ids: give.map(c => c.id) }); };
      if (this.thinkMs) setTimeout(send, this.thinkMs); else send();
      return;
    }
    if (!v || v.status !== 'play' || v.current !== v.you || this.lastActed === v) return;
    this.lastActed = v;
    const S = { n: v.n, rev: v.rev, table: v.table, jokersPlayed: 0, hands: v.seats.map((s, i) => i === v.you ? v.hand : new Array(s.count).fill({ rank: 3, suit: 'H', id: -1 })) };
    const cards = E.chooseMove(S, v.you, 'medium');
    const go = () => { if (this.ws.readyState === 1) { if (cards) this.send({ t: 'play', ids: cards.map(c => c.id) }); else this.send({ t: 'pass' }); } };
    if (this.thinkMs) setTimeout(go, this.thinkMs); else go();
  }
}
function snapshot() {
  return [...rooms.values()].map(r => r.status + ' manche=' + r.round + ' cur=' + (r.S && r.S.current) + ' table=' + (r.S && r.S.table ? r.S.table.rank + 'x' + r.S.table.count : '-')
    + ' ' + r.seats.map((s, i) => (s.bot ? 'B' : s.connected ? 'H' : 'x') + (r.S ? r.S.hands[i].length : '')).join(',') + ' msg="' + r.msg + '"').join(' | ');
}
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = fn(); if (r) return r; await sleep(10); }
  throw new Error('délai dépassé: ' + label + ' [' + snapshot() + ']');
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const mk = async name => new Client(port, name).open();

  // ---------- Salon ----------
  const a = await mk('Alice');
  a.create(3);
  await waitFor(() => a.state, 1000, 'état après création');
  const code = a.state.code;
  assert(/^[A-Z]{4}$/.test(code), 'code de table à 4 lettres');
  assert.strictEqual(a.state.host, 0);

  const ghost = await mk('Fantôme');
  ghost.join('ZZZZ');
  await waitFor(() => ghost.errors.length, 1000, 'erreur table introuvable');
  assert.strictEqual(ghost.errors[0].code, 'noroom');
  ghost.close();

  const b = await mk('Bob'); b.join(code);
  await waitFor(() => a.state.n === 2, 1000, 'Bob rejoint');
  b.send({ t: 'start' });                       // pas l'hôte : sans effet
  await sleep(50);
  assert.strictEqual(a.state.status, 'lobby', 'un non-hôte ne lance pas la partie');

  a.send({ t: 'start' });                       // 2 joueurs : trop peu
  await waitFor(() => a.errors.some(e => e.code === 'few'), 1000, 'refus: moins de 4 joueurs');

  const c = await mk('Chloé'); c.join(code);
  const d = await mk('<b>Dan</b>"'); d.join(code);
  await waitFor(() => a.state.n === 4, 1000, '4 joueurs');
  assert(!/[<>"]/.test(a.state.seats[3].name), 'nom nettoyé: ' + a.state.seats[3].name);

  // 5e et 6e joueur, puis table pleine
  const e = await mk('Eve'); e.join(code);
  const f = await mk('Félix'); f.join(code);
  await waitFor(() => a.state.n === 6, 1000, '6 joueurs');
  const g = await mk('Gaby'); g.join(code);
  await waitFor(() => g.errors.some(x => x.code === 'full'), 1000, 'table pleine');
  g.close();

  // retrait d'un joueur par l'hôte
  a.send({ t: 'kick', seat: 5 });
  await waitFor(() => a.state.n === 5 && f.kicked, 1000, 'Félix retiré');
  f.close();
  // l'hôte ajoute un bot
  a.send({ t: 'addbot' });
  await waitFor(() => a.state.n === 6 && a.state.seats[5].bot, 1000, 'bot ajouté');
  a.send({ t: 'config', level: 'hard', rounds: 1 });
  await waitFor(() => a.state.level === 'hard' && a.state.rounds === 1, 1000, 'configuration');

  // ---------- Partie à 6 : 5 humains + 1 bot ----------
  const humans = [a, b, c, d, e];
  a.send({ t: 'start' });
  await waitFor(() => humans.every(h => h.state.status === 'play'), 1000, 'partie lancée');
  for (const h of humans) {
    const v = h.log.find(s => s.status === 'play');      // premier état de la partie, avant tout coup
    assert(!('hands' in v) && !JSON.stringify(v).includes('"hands"'), 'la vue ne contient pas toutes les mains');
    assert.strictEqual(v.hand.length, v.seats[v.you].count, 'sa main correspond au compteur');
    assert.strictEqual(v.seats.reduce((s, x) => s + x.count, 0), 54, '54 cartes en jeu');
  }
  // la main de chacun est différente
  const ids = humans.flatMap(h => h.log.find(s => s.status === 'play').hand.map(x => x.id));
  assert.strictEqual(new Set(ids).size, ids.length, 'aucune carte en double entre les mains');

  // triche : jouer hors tour, jouer une carte qu'on n'a pas
  const cur = a.state.current;
  const notCur = humans.find(h => h.state.you !== cur);
  if (notCur) {
    notCur.send({ t: 'play', ids: [notCur.state.hand[0].id] });
    await waitFor(() => notCur.errors.some(x => x.code === 'turn'), 1000, 'refus hors tour');
  }
  const curClient = humans.find(h => h.state.you === cur);
  if (curClient) {
    const foreign = humans.find(h => h !== curClient).state.hand[0].id;
    curClient.send({ t: 'play', ids: [foreign] });
    await waitFor(() => curClient.errors.some(x => x.code === 'bad'), 1000, 'refus carte étrangère');
    curClient.send({ t: 'play', ids: [curClient.state.hand[0].id, curClient.state.hand[0].id] });
    await waitFor(() => curClient.errors.length >= 2, 1000, 'refus carte en double');
  }

  // tout le monde joue ; Dan se déconnecte et revient ; Eve disparaît pour de bon (le bot la remplace)
  for (const h of humans) { h.thinkMs = 12; h.autoplay = true; h.act(); }
  await sleep(150);
  d.close();
  await sleep(120);
  const d2 = new Client(port, 'Dan'); d2.cid = d.cid; d2.thinkMs = 12;
  await d2.open(); d2.join(code); d2.autoplay = true;
  await waitFor(() => d2.state && d2.state.you === 3, 1000, 'reconnexion de Dan');
  assert(d2.state.seats[3].connected, 'Dan est de nouveau connecté');
  e.autoplay = false; e.close();                // ne reviendra pas : le bot joue à sa place après le délai

  await waitFor(() => a.state.status === 'gameover', 20000, 'fin de la partie à 6');
  const sixTotal = a.state.seats.reduce((s, x) => s + x.score, 0);
  assert.strictEqual(sixTotal, 1 * (6 * 5) / 2, 'points distribués à 6: ' + sixTotal);
  assert.strictEqual(a.state.results.finished.length, 6);
  assert.strictEqual(new Set(a.state.results.finished).size, 6);

  // revanche : retour au salon, les déconnectés sont retirés
  assert(e.closedCode !== null, 'Eve s’est bien déconnectée pendant la partie');
  await sleep(100);
  a.send({ t: 'again' });
  await waitFor(() => a.state.status === 'lobby', 1000, 'retour au salon');
  assert(a.state.n <= 6 && a.state.seats.every(s => s.connected), 'plus de joueur fantôme au salon: ' + JSON.stringify(a.state.seats.map(s => [s.name, s.bot, s.connected])) + ' serveur=' + [...rooms.values()].map(r => r.status + ':' + r.seats.map(s => s.name + (s.connected ? '+' : '-')).join(',')).join('/'));

  // ---------- Partie à 4 sur 3 manches (2 humains + 2 bots) ----------
  a.send({ t: 'leave' }); b.send({ t: 'leave' }); c.send({ t: 'leave' }); d2.send({ t: 'leave' });
  await sleep(100);
  const h1 = await mk('Hana'); h1.create(3);
  await waitFor(() => h1.state, 1000, 'nouvelle table');
  const h2 = await mk('Ivan'); h2.join(h1.state.code);
  await waitFor(() => h1.state.n === 2, 1000, 'Ivan rejoint');
  h1.send({ t: 'addbot' }); h1.send({ t: 'addbot' });
  await waitFor(() => h1.state.n === 4, 1000, '4 sièges');
  h1.send({ t: 'config', level: 'medium', rounds: 3 });
  await sleep(30);
  h1.send({ t: 'start' });
  await waitFor(() => h2.state.status === 'play', 1000, 'départ à 4');
  const late = await mk('Retard'); late.join(h1.state.code);
  await waitFor(() => late.errors.some(x => x.code === 'started'), 1000, 'refus: partie commencée');
  late.close();
  const seenRounds = new Set();
  for (const h of [h1, h2]) { h.autoplay = true; h.act(); }
  const t0 = Date.now();
  while (h1.state.status !== 'gameover') {
    if (Date.now() - t0 > 30000) throw new Error('délai dépassé: partie à 4 [' + snapshot() + '] erreurs=' + JSON.stringify([...h1.errors, ...h2.errors].slice(-3)) + ' h1=' + JSON.stringify({ st: h1.state.status, cur: h1.state.current, you: h1.state.you, table: h1.state.table && h1.state.table.rank, hand: h1.state.hand.map(c => c.rank + c.suit), last: h1.lastSent, sent: h1.sentN, acted: h1.lastActed === h1.state, ready: h1.ws.readyState }) + ' h2=' + JSON.stringify({ cur: h2.state.current, you: h2.state.you, hand: h2.state.hand.length, last: h2.lastSent, acted: h2.lastActed === h2.state }));
    seenRounds.add(h1.state.round);
    if (h1.state.status === 'roundover') h2.send({ t: 'next' });      // n'importe quel humain peut continuer
    await sleep(15);
  }
  seenRounds.add(h1.state.round);
  assert.deepStrictEqual([...seenRounds].sort(), [1, 2, 3], 'trois manches jouées');
  const total4 = h1.state.seats.reduce((s, x) => s + x.score, 0);
  assert.strictEqual(total4, 3 * (4 * 3) / 2, 'points à 4 sur 3 manches: ' + total4);

  // ---------- Échange de cartes : 4 humains, 2 manches, l'échange est piloté à la main ----------
  h1.send({ t: 'leave' }); h2.send({ t: 'leave' });
  await sleep(50);
  const P = [];
  for (const nm of ['Pia', 'Quentin', 'Rose', 'Sam']) P.push(await mk(nm));
  P[0].create(2);
  await waitFor(() => P[0].state, 1000, 'table pour l’échange');
  const xcode = P[0].state.code;
  for (const p of P.slice(1)) p.join(xcode);
  await waitFor(() => P[0].state.n === 4, 1000, '4 humains');
  P[0].send({ t: 'start' });
  await waitFor(() => P.every(p => p.state.status === 'play'), 1000, 'manche 1 lancée');
  assert.strictEqual(P[0].state.exchange, null, 'pas d’échange à la première manche');
  P.forEach(p => { p.thinkMs = 3; p.autoplay = true; p.act(); });
  await waitFor(() => P[0].state.status === 'roundover', 30000, 'fin de la manche 1');
  P.forEach(p => { p.autoplay = false; });
  await sleep(50);
  const order = P[0].state.results.finished.slice();          // classement de la manche 1
  P[0].send({ t: 'next' });
  await waitFor(() => P.every(p => p.state.status === 'exchange'), 1000, 'phase d’échange');
  const xroom = [...rooms.values()].find(r => r.code === xcode);
  const [big, small] = xroom.exchange.pairs;                  // dernier→premier (2 cartes), avant-dernier→deuxième (1 carte)
  assert.deepStrictEqual([big.poor, big.rich, big.k, small.poor, small.rich, small.k], [order[3], order[0], 2, order[2], order[1], 1], 'bons partenaires d’échange');
  for (const pr of xroom.exchange.pairs) {
    const minBest = Math.min(...pr.best.map(c => E.strength(c.rank, false)));
    assert(xroom.S.hands[pr.poor].every(c => E.strength(c.rank, false) <= minBest), 'le pauvre a donné ses meilleures cartes');
    assert(pr.best.every(c => xroom.S.hands[pr.rich].some(h => h.id === c.id)), 'le riche a reçu ces cartes');
  }
  P.forEach((p, i) => {
    const m = p.state.exchange.mine;
    assert(m && (m.role === 'rich' || m.role === 'poor'), 'rôle d’échange pour le joueur ' + i);
    const pub = JSON.stringify(p.state.exchange.pairs);
    assert(!pub.includes('"rank"') && !pub.includes('"best"'), 'la liste publique ne montre aucune carte');
  });
  const bigRich = P[big.rich], smallRich = P[small.rich], bigPoor = P[big.poor];
  // refus : un pauvre ne rend rien, mauvais nombre de cartes, carte qui n'est pas dans sa main
  bigPoor.send({ t: 'give', ids: [bigPoor.state.hand[0].id, bigPoor.state.hand[1].id] });
  await waitFor(() => bigPoor.errors.some(x => x.code === 'turn'), 1000, 'refus : rien à donner');
  bigRich.send({ t: 'give', ids: [bigRich.state.hand[0].id] });
  await waitFor(() => bigRich.errors.some(x => x.code === 'bad'), 1000, 'refus : mauvais nombre');
  bigRich.send({ t: 'give', ids: [bigRich.state.hand[0].id, bigPoor.state.hand[0].id] });
  await waitFor(() => bigRich.errors.filter(x => x.code === 'bad').length >= 2, 1000, 'refus : carte étrangère');
  // le Millionnaire rend librement ses 2 MEILLEURES cartes
  const chosen = E.bestCards(bigRich.state.hand, 2);
  bigRich.send({ t: 'give', ids: chosen.map(c => c.id) });
  await waitFor(() => bigRich.state.exchange.mine.done, 1000, 'le Millionnaire a rendu ses cartes');
  assert(chosen.every(c => xroom.S.hands[big.poor].some(h => h.id === c.id)), 'le dernier a reçu les 2 cartes choisies');
  assert(chosen.every(c => !xroom.S.hands[big.rich].some(h => h.id === c.id)), 'le Millionnaire ne les a plus');
  assert.strictEqual(xroom.status, 'exchange', 'l’échange attend encore le deuxième');
  // le deuxième disparaît : après le délai, ses cartes les moins utiles sont rendues à sa place
  const expected = E.cheapestCards(xroom.S.hands[small.rich], 1).map(c => c.id);
  smallRich.close();
  await waitFor(() => xroom.status === 'play', 3000, 'échange terminé sans le joueur absent');
  assert.deepStrictEqual(small.gave.map(c => c.id), expected, 'carte rendue par l’absent = la moins utile');
  assert.deepStrictEqual(xroom.S.hands.map(h => h.length), [14, 14, 13, 13], 'tailles de mains conservées');
  assert.strictEqual(xroom.S.hands.reduce((s, h) => s + h.length, 0), 54);
  await waitFor(() => bigPoor.state.exchange.mine.done, 1000, 'récapitulatif pour le dernier');
  assert.deepStrictEqual(bigPoor.state.exchange.mine.received.map(c => c.id).sort(), chosen.map(c => c.id).sort(), 'le dernier voit ce qu’il a reçu');
  assert.strictEqual(bigPoor.state.status, 'play');

  // ---------- Nettoyage ----------
  for (const x of [h1, h2, a, b, c, d2, e, ...P]) try { x.close(); } catch (er) {}
  await sleep(100);
  wss.close(); server.close();
  console.log('serveur OK : salon, triche refusée, reconnexion, remplacement par un bot, parties à 4 et à 6, échange de cartes');
  process.exit(0);
})().catch(err => { console.error('ECHEC:', err.message); process.exit(1); });
