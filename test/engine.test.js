'use strict';
// Règles de base et simulation de manches à 4, 5 et 6 joueurs.
const E = require('../public/engine.js');
const assert = require('assert');

let id = 1000;
const c = (rank, suit) => ({ id: id++, rank, suit });
const V = (cards, table, rev) => E.validate(cards, table, rev).ok;

// --- règles ---
const t1 = { rank: 7, count: 2 };
assert(V([c(9, 'H'), c(9, 'S')], t1, false), 'paire de 9 bat paire de 7');
assert(!V([c(5, 'H'), c(5, 'S')], t1, false), 'paire de 5 ne bat pas 7');
assert(!V([c(9, 'H')], t1, false), 'carte seule sur une paire interdite');
assert(!V([c(9, 'H'), c(10, 'S')], null, false), 'mélange interdit');
assert(V([c(15, 'H')], { rank: 14, count: 1 }, false), 'le 2 bat l’As');
assert(V([c(16, 'J')], { rank: 15, count: 1 }, false), 'le Joker bat le 2');
assert(!V([c(16, 'J'), c(16, 'J')], null, false), 'pas de paire de Jokers');
assert(V([c(3, 'H')], { rank: 15, count: 1 }, true), 'le 3 bat le 2 en révolution');
assert(!V([c(15, 'H')], { rank: 3, count: 1 }, true), 'le 2 ne bat pas le 3 en révolution');
assert(V([c(16, 'J')], { rank: 3, count: 1 }, true), 'le Joker reste le plus fort en révolution');
const tj = { rank: 16, count: 1 };
assert(V([c(3, 'S')], tj, false), '3 de pique bat le Joker');
assert(!V([c(3, 'H')], tj, false), '3 de cœur ne bat pas le Joker');
assert(!V([c(15, 'H')], tj, false), 'le 2 ne bat pas le Joker');

function mk(n, hands) {
  return { n, hands, table: null, lastPlayer: null, passes: [], finished: [], rev: false, current: 0, over: false, jokersPlayed: 0 };
}
const filler = n => Array.from({ length: n }, () => [c(4, 'H'), c(9, 'D')]);

// le 8 coupe
let S = mk(4, [[c(8, 'H'), c(4, 'D'), c(9, 'C')], ...filler(3)]);
let ev = E.playCards(S, 0, [S.hands[0][0]]);
assert(ev.cut && S.table === null && S.current === 0, 'le 8 coupe et son auteur rejoue');

// le carré provoque la révolution
S = mk(4, [[c(5, 'H'), c(5, 'D'), c(5, 'C'), c(5, 'S'), c(9, 'H')], ...filler(3)]);
ev = E.playCards(S, 0, S.hands[0].slice(0, 4));
assert(S.rev === true && ev.rev, 'un carré déclenche la révolution');

// tout le monde passe : le dernier joueur rouvre (4, 5 et 6 joueurs)
for (const n of [4, 5, 6]) {
  S = mk(n, [[c(4, 'H'), c(9, 'D')], ...filler(n - 1)]);
  E.playCards(S, 0, [S.hands[0][0]]);
  let r;
  for (let p = 1; p < n; p++) r = E.passTurn(S, p);
  assert(r.trickEnd && S.table === null && S.current === 0, 'après ' + (n - 1) + ' passes, le joueur 0 rouvre (n=' + n + ')');
}

// un joueur qui vient de finir : le suivant rouvre
S = mk(5, [[c(4, 'H')], ...filler(4)]);
E.playCards(S, 0, [S.hands[0][0]]);
assert(S.finished[0] === 0 && S.current === 1, 'le joueur 0 a fini');
for (let p = 1; p < 5; p++) E.passTurn(S, p);
assert(S.table === null && S.current === 1, 'le joueur suivant rouvre quand l’auteur est sorti');

// triche : cartes absentes ou en double refusées
S = mk(4, [[c(4, 'H'), c(9, 'D')], ...filler(3)]);
assert.throws(() => E.playCards(S, 0, [c(4, 'H')]), /absente/, 'carte absente');
assert.throws(() => E.playCards(S, 0, [S.hands[0][0], S.hands[0][0]]), /double|illegal/, 'carte en double');

// échange de cartes : meilleures cartes à donner, moins utiles à rendre
{
  const hand = [c(4, 'H'), c(15, 'D'), c(3, 'S'), c(3, 'H'), c(14, 'C'), c(16, 'J'), c(9, 'S')];
  assert.deepStrictEqual(E.bestCards(hand, 2).map(x => x.rank), [16, 15], 'Joker puis 2');
  assert.deepStrictEqual(E.bestCards(hand, 1).map(x => x.rank), [16]);
  const cheap = E.cheapestCards(hand, 2);
  assert.deepStrictEqual(cheap.map(x => x.rank + x.suit), ['3H', '4H'], 'le 3 de pique est gardé');
  assert.deepStrictEqual(E.cheapestCards([c(3, 'S'), c(16, 'J')], 1).map(x => x.rank), [3], 'à défaut, le 3 de pique part avant le Joker');
}

// points et rôles
assert.strictEqual(E.pointsFor(6, 0), 5);
assert.strictEqual(E.pointsFor(4, 3), 0);
assert.deepStrictEqual([0, 1, 2, 3].map(i => E.roleName(4, i)), ['Millionnaire', 'Riche', 'Pauvre', 'Misérable']);
assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(i => E.roleName(6, i)), ['Millionnaire', 'Riche', 'Classe moyenne', 'Classe moyenne', 'Pauvre', 'Misérable']);

// --- simulation ---
let seed = 987654;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const levels = ['easy', 'medium', 'hard'];
const stats = {};
for (const n of [4, 5, 6]) {
  let maxSteps = 0;
  const wins = { easy: 0, medium: 0, hard: 0 };
  const rounds = 1500;
  for (let g = 0; g < rounds; g++) {
    const S = {};
    const lv = Array.from({ length: n }, (_, i) => levels[(g + i) % 3]);
    E.newRound(S, g % n, n, rnd);
    assert.strictEqual(S.hands.reduce((s, h) => s + h.length, 0), 54, '54 cartes distribuées');
    const sizes = S.hands.map(h => h.length);
    assert(Math.max(...sizes) - Math.min(...sizes) <= 1, 'distribution équilibrée');
    let steps = 0;
    while (!S.over) {
      assert(++steps < 3000, 'manche bloquée (n=' + n + ')');
      const p = S.current;
      assert(E.active(S, p), 'le joueur courant a des cartes');
      const mv = E.chooseMove(S, p, lv[p], rnd);
      if (mv) E.playCards(S, p, mv);
      else { assert(S.table, 'ne passe jamais en ouvrant'); E.passTurn(S, p); }
    }
    assert.strictEqual(S.finished.length, n);
    assert.strictEqual(new Set(S.finished).size, n, 'classement sans doublon');
    wins[lv[S.finished[0]]]++;
    maxSteps = Math.max(maxSteps, steps);
  }
  stats[n] = { rounds, maxSteps, wins };
}
console.log('moteur OK', JSON.stringify(stats));
