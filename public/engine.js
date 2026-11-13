/* Moteur de règles du Magnat, pour 4 à 6 joueurs.
   Utilisé tel quel par le serveur (autorité) et par le navigateur (aide à l'affichage). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Magnat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const JOKER = 16;
  const RANK_LABEL = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'V', 12: 'D', 13: 'R', 14: 'A', 15: '2', 16: 'Jo' };
  const RANK_WORD = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'Valet', 12: 'Dame', 13: 'Roi', 14: 'As', 15: '2', 16: 'Joker' };
  const SUITS = { S: '♠', H: '♥', D: '♦', C: '♣', J: '★' };
  const SUIT_NAME = { S: 'pique', H: 'cœur', D: 'carreau', C: 'trèfle' };

  function makeDeck() {
    const d = []; let id = 0;
    for (const s of ['S', 'H', 'D', 'C']) for (let r = 3; r <= 15; r++) d.push({ id: id++, rank: r, suit: s });
    d.push({ id: id++, rank: JOKER, suit: 'J' });
    d.push({ id: id++, rank: JOKER, suit: 'J' });
    return d;
  }
  function shuffle(a, rnd) {
    rnd = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function strength(rank, rev) {
    if (rank === JOKER) return 100;
    return rev ? 18 - rank : rank;
  }
  function isSpade3(c) { return c.rank === 3 && c.suit === 'S'; }

  function validate(cards, table, rev) {
    if (!cards.length) return { ok: false, why: 'empty' };
    const r = cards[0].rank;
    if (cards.some(c => c.rank !== r)) return { ok: false, why: 'mixed' };
    if (cards.length > 4) return { ok: false, why: 'toomany' };
    if (r === JOKER && cards.length > 1) return { ok: false, why: 'jokeralone' };
    if (!table) return { ok: true };
    if (table.rank === JOKER) {
      return (cards.length === 1 && isSpade3(cards[0])) ? { ok: true, counter: true } : { ok: false, why: 'joker' };
    }
    if (cards.length !== table.count) return { ok: false, why: 'count' };
    if (strength(r, rev) <= strength(table.rank, rev)) return { ok: false, why: 'weak' };
    return { ok: true };
  }

  function generateMoves(hand, table, rev) {
    const moves = [];
    if (table && table.rank === JOKER) {
      const sp = hand.find(isSpade3);
      if (sp) moves.push({ cards: [sp], rank: 3, count: 1, groupSize: 1 });
      return moves;
    }
    const groups = new Map();
    for (const c of hand) {
      if (c.rank === JOKER) continue;
      if (!groups.has(c.rank)) groups.set(c.rank, []);
      groups.get(c.rank).push(c);
    }
    for (const [r, g] of groups) {
      g.sort((a, b) => (isSpade3(a) ? 1 : 0) - (isSpade3(b) ? 1 : 0));
      for (let k = 1; k <= g.length; k++) {
        const cards = g.slice(0, k);
        if (validate(cards, table, rev).ok) moves.push({ cards, rank: r, count: k, groupSize: g.length });
      }
    }
    const jk = hand.find(c => c.rank === JOKER);
    if (jk && validate([jk], table, rev).ok) moves.push({ cards: [jk], rank: JOKER, count: 1, groupSize: 1 });
    return moves;
  }

  function active(S, p) { return S.hands[p].length > 0; }
  function seatList(S) { return Array.from({ length: S.n }, (_, i) => i); }
  function nextActive(S, p) {
    for (let i = 1; i <= S.n; i++) { const q = (p + i) % S.n; if (active(S, q)) return q; }
    return p;
  }

  function newRound(S, starter, n, rnd) {
    const deck = shuffle(makeDeck(), rnd);
    S.n = n;
    S.hands = Array.from({ length: n }, () => []);
    deck.forEach((c, i) => S.hands[i % n].push(c));
    S.table = null; S.lastPlayer = null; S.passes = [];
    S.finished = []; S.rev = false; S.current = starter; S.over = false; S.jokersPlayed = 0;
  }

  function playCards(S, p, cards) {
    const v = validate(cards, S.table, S.rev);
    if (!v.ok) throw new Error('coup illegal: ' + v.why);
    const ids = new Set(cards.map(c => c.id));
    if (ids.size !== cards.length) throw new Error('carte en double');
    if (cards.some(c => !S.hands[p].some(h => h.id === c.id))) throw new Error('carte absente de la main');
    S.hands[p] = S.hands[p].filter(c => !ids.has(c.id));
    const rank = cards[0].rank, count = cards.length;
    const ev = { p, cards, rank, count, rev: false, cut: false, counter: !!v.counter, finished: false };
    S.table = { cards, rank, count, by: p };
    S.lastPlayer = p; S.passes = [];
    if (rank === JOKER) S.jokersPlayed++;
    if (count === 4) { S.rev = !S.rev; ev.rev = true; }
    if (S.hands[p].length === 0) { S.finished.push(p); ev.finished = true; }
    const act = seatList(S).filter(q => active(S, q));
    if (act.length <= 1) {
      if (act.length === 1) S.finished.push(act[0]);
      S.over = true;
      return ev;
    }
    if (rank === 8 || v.counter) {
      ev.cut = true;
      S.table = null; S.lastPlayer = null; S.passes = [];
      S.current = active(S, p) ? p : nextActive(S, p);
    } else {
      S.current = nextActive(S, p);
    }
    return ev;
  }

  function passTurn(S, p) {
    if (!S.table) throw new Error('on ne peut pas passer en ouvrant');
    S.passes.push(p);
    const others = seatList(S).filter(q => active(S, q) && q !== S.lastPlayer);
    if (others.every(q => S.passes.includes(q))) {
      const lp = S.lastPlayer;
      S.table = null; S.lastPlayer = null; S.passes = [];
      S.current = active(S, lp) ? lp : nextActive(S, lp);
      return { trickEnd: true };
    }
    S.current = nextActive(S, p);
    return { trickEnd: false };
  }

  // ---- IA ----
  function vcard(c, rev) { return c.rank === JOKER ? 1.2 : (strength(c.rank, rev) - 3) / 12; }
  function meanV(cards, rev) { return cards.length ? cards.reduce((s, c) => s + vcard(c, rev), 0) / cards.length : 0.5; }

  function chooseMove(S, p, level, rnd) {
    rnd = rnd || Math.random;
    const hand = S.hands[p], rev = S.rev, table = S.table;
    const moves = generateMoves(hand, table, rev);
    if (!moves.length) return null;
    const finish = moves.find(m => m.count === hand.length);
    if (finish) return finish.cards;
    const opp = seatList(S).filter(q => q !== p && active(S, q)).map(q => S.hands[q].length);
    const minOpp = Math.min(...opp);
    const sv = m => strength(m.rank, rev);

    if (level === 'easy') {
      if (table && rnd() < 0.3) return null;
      return moves[Math.floor(rnd() * moves.length)].cards;
    }

    if (level === 'medium') {
      const cost = m => sv(m) + (m.count < m.groupSize ? 1.5 : 0)
        + (table ? 0 : (m.rank === 8 ? 5 : 0) + (m.count === 4 ? 6 : 0) + (sv(m) >= 15 ? 4 : 0) - m.count * 0.3);
      moves.sort((a, b) => cost(a) - cost(b));
      const best = moves[0];
      if (table && sv(best) >= 14 && minOpp > 3 && hand.length > 3 && rnd() < 0.6) return null;
      return best.cards;
    }

    // hard
    const jokerUnseen = S.jokersPlayed + hand.filter(c => c.rank === JOKER).length < 2;
    const cost = m => {
      const v = m.rank === JOKER ? 1.2 : (strength(m.rank, rev) - 3) / 12;
      let c = v * (m.count === 1 ? 1 : 0.8);
      if (m.count < m.groupSize) c += 0.35 * (m.groupSize - m.count);
      if (m.rank === 8) c -= 0.25;
      if (m.cards.some(isSpade3) && jokerUnseen) c += 0.5;
      c -= 0.12 * m.count;
      if (m.count === 4) {
        const ids = new Set(m.cards.map(x => x.id));
        const rest = hand.filter(x => !ids.has(x.id));
        c += meanV(rest, rev) < 0.45 ? -1.2 : 1.5;
      }
      if (minOpp <= 2) c = table ? -v : -m.count + v * 0.3;
      return c;
    };
    moves.sort((a, b) => cost(a) - cost(b));
    const best = moves[0];
    const topV = best.rank === JOKER ? 1.2 : (strength(best.rank, rev) - 3) / 12;
    if (table && topV > 0.85 && minOpp >= 4 && hand.length > 3 && rnd() < 0.75) return null;
    return best.cards;
  }

  // ---- Échange de cartes entre les manches ----
  // Les k meilleures cartes d'une main (donnée d'office par les derniers).
  function bestCards(hand, k) {
    return hand.slice().sort((a, b) => strength(b.rank, false) - strength(a.rank, false) || a.id - b.id).slice(0, k);
  }
  // Les k cartes les moins utiles (rendues par un bot ou un absent). Le 3 de pique est gardé : il bat le Joker.
  function cheapestCards(hand, k) {
    const cost = c => strength(c.rank, false) + (isSpade3(c) ? 50 : 0);
    return hand.slice().sort((a, b) => cost(a) - cost(b) || a.id - b.id).slice(0, k);
  }

  // ---- Points et rôles ----
  function pointsFor(n, i) { return n - 1 - i; }
  function roleName(n, i) {
    if (i === 0) return 'Millionnaire';
    if (i === 1) return 'Riche';
    if (i === n - 1) return 'Misérable';
    if (i === n - 2) return 'Pauvre';
    return 'Classe moyenne';
  }

  // ---- Texte ----
  function rankWord(r, plural) {
    const w = RANK_WORD[r];
    if (!plural || r === JOKER) return w;
    if (r <= 10 || r === 14) return w;
    return w + 's';
  }
  function describePlay(ev, name) {
    let what;
    if (ev.rank === JOKER) what = 'le Joker';
    else if (ev.count === 1) what = (ev.rank === 12 ? 'une ' : 'un ') + rankWord(ev.rank);
    else if (ev.count === 2) what = 'une paire de ' + rankWord(ev.rank, true);
    else if (ev.count === 3) what = 'un brelan de ' + rankWord(ev.rank, true);
    else what = 'un carré de ' + rankWord(ev.rank, true);
    let s = name + ' joue ' + what + '.';
    if (ev.counter) s = name + ' contre le Joker avec le 3 de pique. La table est balayée.';
    else if (ev.rank === 8) s += ' Le 8 coupe : la table est balayée.';
    if (ev.rev) s += ' Révolution !';
    if (ev.finished) s += ' ' + name + ' n’a plus de cartes.';
    return s;
  }
  function cardName(c) {
    if (c.rank === JOKER) return 'Joker';
    return RANK_WORD[c.rank] + ' de ' + SUIT_NAME[c.suit];
  }

  return {
    JOKER, RANK_LABEL, RANK_WORD, SUITS, SUIT_NAME,
    makeDeck, shuffle, strength, isSpade3, validate, generateMoves,
    active, nextActive, newRound, playCards, passTurn, chooseMove,
    bestCards, cheapestCards,
    pointsFor, roleName, rankWord, describePlay, cardName
  };
});
