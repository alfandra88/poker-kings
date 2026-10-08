'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { eval5, compareHands, dealHands, mulberry32 } = require('../lib/hands');

// card = rank * 4 + suit; rank 0 = deuce .. 12 = ace; suit 0 spade, 1 heart, 2 diamond, 3 club
const c = (rank, suit) => rank * 4 + suit;
const R = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, T: 8, J: 9, Q: 10, K: 11, A: 12 };
const hand = (...specs) => specs.map(([r, s]) => c(R[r], s));

const straightFlush = hand(['5', 0], ['6', 0], ['7', 0], ['8', 0], ['9', 0]);
const quads = hand(['9', 0], ['9', 1], ['9', 2], ['9', 3], ['K', 0]);
const fullHouse = hand(['K', 0], ['K', 1], ['K', 2], ['4', 0], ['4', 1]);
const flush = hand(['A', 2], ['J', 2], ['8', 2], ['6', 2], ['3', 2]);
const straight = hand(['5', 0], ['6', 1], ['7', 2], ['8', 3], ['9', 0]);
const trips = hand(['7', 0], ['7', 1], ['7', 2], ['K', 3], ['2', 0]);
const twoPair = hand(['J', 0], ['J', 1], ['4', 2], ['4', 3], ['A', 0]);
const pair = hand(['Q', 0], ['Q', 1], ['9', 2], ['5', 3], ['2', 0]);
const highCard = hand(['A', 0], ['J', 1], ['8', 2], ['6', 3], ['3', 0]);

test('each category is recognised', () => {
  const expected = [
    [highCard, 0, 'High card'], [pair, 1, 'Pair'], [twoPair, 2, 'Two pair'],
    [trips, 3, 'Three of a kind'], [straight, 4, 'Straight'], [flush, 5, 'Flush'],
    [fullHouse, 6, 'Full house'], [quads, 7, 'Four of a kind'], [straightFlush, 8, 'Straight flush'],
  ];
  for (const [cards, category, name] of expected) {
    const r = eval5(cards);
    assert.equal(r.category, category, name);
    assert.equal(r.name, name);
  }
});

test('categories rank in the official order', () => {
  const ordered = [highCard, pair, twoPair, trips, straight, flush, fullHouse, quads, straightFlush];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareHands(ordered[i], ordered[i - 1]), 1, `category ${i} beats ${i - 1}`);
    assert.equal(compareHands(ordered[i - 1], ordered[i]), -1);
  }
});

test('the wheel (A-2-3-4-5) is the lowest straight', () => {
  const wheel = hand(['A', 0], ['2', 1], ['3', 2], ['4', 3], ['5', 0]);
  const sixHigh = hand(['2', 0], ['3', 1], ['4', 2], ['5', 3], ['6', 0]);
  assert.equal(eval5(wheel).category, 4);
  assert.equal(compareHands(sixHigh, wheel), 1);
});

test('a royal flush beats a lower straight flush', () => {
  const royal = hand(['T', 1], ['J', 1], ['Q', 1], ['K', 1], ['A', 1]);
  assert.equal(compareHands(royal, straightFlush), 1);
});

test('kickers break ties within a category', () => {
  const pairAcesKing = hand(['A', 0], ['A', 1], ['K', 2], ['5', 3], ['2', 0]);
  const pairAcesQueen = hand(['A', 2], ['A', 3], ['Q', 0], ['5', 1], ['2', 1]);
  assert.equal(compareHands(pairAcesKing, pairAcesQueen), 1);
  const aTwoPairHigh = hand(['K', 0], ['K', 1], ['3', 2], ['3', 3], ['2', 0]);
  const aTwoPairLow = hand(['Q', 0], ['Q', 1], ['J', 2], ['J', 3], ['A', 0]);
  assert.equal(compareHands(aTwoPairHigh, aTwoPairLow), 1);
});

test('suits never break a tie', () => {
  const a = hand(['A', 0], ['K', 1], ['9', 2], ['6', 3], ['3', 0]);
  const b = hand(['A', 1], ['K', 2], ['9', 3], ['6', 0], ['3', 1]);
  assert.equal(compareHands(a, b), 0);
});

test('full house compares the three-of-a-kind first', () => {
  const kingsOverTwos = hand(['K', 0], ['K', 1], ['K', 2], ['2', 0], ['2', 1]);
  const queensOverAces = hand(['Q', 0], ['Q', 1], ['Q', 2], ['A', 0], ['A', 1]);
  assert.equal(compareHands(kingsOverTwos, queensOverAces), 1);
});

test('a hand must have five cards', () => {
  assert.throws(() => eval5([0, 1, 2, 3]));
});

test('dealt hands never share a card and are reproducible from a seed', () => {
  const a = dealHands(mulberry32(42), 4, { allowTies: false });
  const b = dealHands(mulberry32(42), 4, { allowTies: false });
  assert.deepEqual(a, b);
  const all = a.flat();
  assert.equal(new Set(all).size, 20);
  assert.equal(new Set(a.map((h) => eval5(h).score)).size, 4, 'no ties when ties are disallowed');
});
