'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../lib/game');

const c = (rank, suit) => rank * 4 + suit;
// 7-high straight vs pair of aces vs ace-high vs flush
const straight = [c(3, 0), c(4, 1), c(5, 2), c(6, 3), c(7, 0)];
const pair = [c(12, 0), c(12, 1), c(9, 2), c(5, 3), c(0, 0)];
const high = [c(12, 2), c(10, 1), c(8, 0), c(6, 3), c(1, 1)];
const flush = [c(12, 3), c(9, 3), c(7, 3), c(4, 3), c(1, 3)];

test('compare: picks the winner, detects ties, rejects junk', () => {
  const q = { kind: 'compare', hands: [pair, high] };
  assert.equal(game.checkAnswer(q, 'a').correct, true);
  assert.equal(game.checkAnswer(q, 'b').correct, false);
  assert.equal(game.checkAnswer(q, 'a').solution, 'a');
  const tie = {
    kind: 'compare',
    hands: [[c(12, 0), c(11, 1), c(9, 2), c(6, 3), c(3, 0)], [c(12, 1), c(11, 2), c(9, 3), c(6, 0), c(3, 1)]],
  };
  assert.equal(game.checkAnswer(tie, 'tie').correct, true);
  assert.equal(game.checkAnswer(tie, 'a').correct, false);
  assert.equal(game.checkAnswer(q, 'c'), null);
  assert.equal(game.checkAnswer(q, undefined), null);
});

test('order: strongest-first order is correct, anything else is not', () => {
  const q = { kind: 'order', hands: [high, flush, pair, straight] };
  assert.deepEqual(game.checkAnswer(q, [1, 3, 2, 0]).solution, [1, 3, 2, 0]);
  assert.equal(game.checkAnswer(q, [1, 3, 2, 0]).correct, true);
  assert.equal(game.checkAnswer(q, [0, 1, 2, 3]).correct, false);
  assert.equal(game.checkAnswer(q, [3, 1, 2, 0]).correct, false, 'straight is weaker than flush');
});

test('order: malformed answers are rejected', () => {
  const q = { kind: 'order', hands: [high, flush, pair, straight] };
  assert.equal(game.checkAnswer(q, [0, 1, 2]), null);
  assert.equal(game.checkAnswer(q, [0, 0, 1, 2]), null);
  assert.equal(game.checkAnswer(q, [0, 1, 2, 9]), null);
  assert.equal(game.checkAnswer(q, 'a'), null);
});

test('scoring: base points, streak bonus, cap and reset', () => {
  assert.deepEqual(game.scoreAnswer({ kind: 'compare', correct: true, streak: 0 }), { points: 10, base: 10, bonus: 0, streak: 1 });
  assert.deepEqual(game.scoreAnswer({ kind: 'order', correct: true, streak: 0 }), { points: 25, base: 25, bonus: 0, streak: 1 });
  assert.equal(game.scoreAnswer({ kind: 'compare', correct: true, streak: 3 }).points, 16);
  assert.equal(game.scoreAnswer({ kind: 'compare', correct: true, streak: 50 }).points, 20, 'bonus is capped');
  assert.deepEqual(game.scoreAnswer({ kind: 'order', correct: false, streak: 4 }), { points: 0, base: 0, bonus: 0, streak: 0 });
  assert.throws(() => game.scoreAnswer({ kind: 'bet', correct: true, streak: 0 }));
});

test('questions are deterministic per seed and round, and differ between rounds', () => {
  const a = game.buildQuestion('compare', game.deriveSeed(99, 0));
  const b = game.buildQuestion('compare', game.deriveSeed(99, 0));
  const next = game.buildQuestion('compare', game.deriveSeed(99, 1));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.hands, next.hands);
  assert.equal(game.buildQuestion('order', 5).hands.length, 4);
  assert.equal(game.buildQuestion('compare', 5).hands.length, 2);
});

test('room rounds mix compare and order questions', () => {
  const kinds = Array.from({ length: game.ROOM_ROUNDS }, (_, i) => game.roomRoundKind(i));
  assert.ok(kinds.includes('order'));
  assert.ok(kinds.includes('compare'));
});

test('tokens round-trip and reject garbage', () => {
  assert.deepEqual(game.parseSoloToken(game.soloToken('order', 0xabcdef)), { kind: 'order', seed: 0xabcdef });
  assert.equal(game.parseSoloToken('s:bet:00000001'), null);
  assert.deepEqual(game.parseRoomToken(game.roomToken('ABC234', 3)), { code: 'ABC234', round: 3 });
  assert.equal(game.parseRoomToken('r:abc:3'), null);
});

test('the game has no betting vocabulary', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const files = ['server.js', 'lib/game.js', 'lib/hands.js', 'lib/db.js', 'public/app.js', 'public/index.html'];
  for (const f of files) {
    const text = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.doesNotMatch(text, /\b(chips?|bets?|betting|pot|wager|raise|casino|bankroll)\b/i, f);
  }
});
