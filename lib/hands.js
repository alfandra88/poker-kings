'use strict';

// Cards are integers 0..51: rank = card >> 2 (0 = deuce .. 12 = ace), suit = card & 3.
const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUIT_KEYS = ['spade', 'heart', 'diamond', 'club'];

const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

const RANK_WORDS = [
  'twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights',
  'nines', 'tens', 'jacks', 'queens', 'kings', 'aces',
];

function rankOf(card) {
  return card >> 2;
}

function suitOf(card) {
  return card & 3;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledDeck(prng) {
  const deck = [];
  for (let i = 0; i < 52; i++) deck.push(i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

// Scores one five-card hand. A higher `score` always beats a lower one;
// equal scores are a tie.
function eval5(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) {
    throw new Error('A hand has exactly five cards');
  }
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);

  let straightHigh = -1;
  const uniq = Array.from(new Set(ranks));
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0) straightHigh = 3; // wheel: A-2-3-4-5
  }

  const count = new Map();
  for (const r of ranks) count.set(r, (count.get(r) || 0) + 1);
  const groups = [...count.entries()].sort((x, y) => (y[1] - x[1]) || (y[0] - x[0]));

  const encode = (cat, tiebreak) => {
    let s = cat;
    for (let i = 0; i < 5; i++) s = s * 15 + (tiebreak[i] === undefined ? 0 : tiebreak[i]) + 1;
    return s;
  };
  const lead = groups[0][0];
  const make = (cat, tiebreak, detail) => ({
    category: cat,
    score: encode(cat, tiebreak),
    name: CATEGORY_NAMES[cat],
    detail,
  });

  if (isFlush && straightHigh >= 0) {
    return make(8, [straightHigh], straightHigh === 12 ? 'ace high (royal)' : `${RANK_WORDS[straightHigh]} high`);
  }
  if (groups[0][1] === 4) return make(7, [lead, groups[1][0]], RANK_WORDS[lead]);
  if (groups[0][1] === 3 && groups[1] && groups[1][1] === 2) {
    return make(6, [lead, groups[1][0]], `${RANK_WORDS[lead]} full of ${RANK_WORDS[groups[1][0]]}`);
  }
  if (isFlush) return make(5, ranks, `${RANK_WORDS[ranks[0]]} high`);
  if (straightHigh >= 0) return make(4, [straightHigh], `${RANK_WORDS[straightHigh]} high`);
  if (groups[0][1] === 3) return make(3, [lead, ...groups.slice(1).map((g) => g[0])], RANK_WORDS[lead]);
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    const kicker = groups[2] ? groups[2][0] : 0;
    return make(2, [lead, groups[1][0], kicker], `${RANK_WORDS[lead]} and ${RANK_WORDS[groups[1][0]]}`);
  }
  if (groups[0][1] === 2) return make(1, [lead, ...groups.slice(1).map((g) => g[0])], RANK_WORDS[lead]);
  return make(0, ranks, `${RANK_WORDS[ranks[0]]} high`);
}

// -1 if a loses to b, 1 if a beats b, 0 for a tie.
function compareHands(a, b) {
  const sa = eval5(a).score;
  const sb = eval5(b).score;
  return sa === sb ? 0 : sa > sb ? 1 : -1;
}

// Deals `handCount` distinct five-card hands. Hands in one question never
// share a card, and for ordering questions ties are redrawn so there is one
// clear answer.
function dealHands(prng, handCount, { allowTies }) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const deck = shuffledDeck(prng);
    const hands = [];
    for (let h = 0; h < handCount; h++) hands.push(deck.slice(h * 5, h * 5 + 5));
    const scores = hands.map((h) => eval5(h).score);
    if (allowTies || new Set(scores).size === scores.length) return hands;
  }
  throw new Error('Could not deal distinct hands');
}

module.exports = {
  RANK_CHARS,
  SUIT_KEYS,
  CATEGORY_NAMES,
  rankOf,
  suitOf,
  mulberry32,
  shuffledDeck,
  eval5,
  compareHands,
  dealHands,
};
