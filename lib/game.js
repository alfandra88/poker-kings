'use strict';

const { mulberry32, dealHands, eval5 } = require('./hands');

const KINDS = ['compare', 'order'];
const HAND_COUNT = { compare: 2, order: 4 };
const BASE_POINTS = { compare: 10, order: 25 };
const STREAK_BONUS_STEP = 2;
const STREAK_BONUS_CAP = 5; // bonus stops growing after five correct answers in a row
const ROOM_ROUNDS = 10;

function isKind(kind) {
  return KINDS.includes(kind);
}

// Mixes a base seed with a round number so every round of a room is different
// but identical for everyone in that room.
function deriveSeed(baseSeed, round) {
  return (Math.imul(baseSeed >>> 0, 0x9e3779b1) ^ Math.imul((round + 1) >>> 0, 0x85ebca6b)) >>> 0;
}

// Every third round of a room is an ordering question, the rest are comparisons.
function roomRoundKind(round) {
  return round % 3 === 2 ? 'order' : 'compare';
}

function buildQuestion(kind, seed) {
  if (!isKind(kind)) throw new Error('Unknown question kind');
  const hands = dealHands(mulberry32(seed), HAND_COUNT[kind], { allowTies: kind === 'compare' });
  return { kind, seed: seed >>> 0, hands };
}

function seedToHex(seed) {
  return (seed >>> 0).toString(16).padStart(8, '0');
}

function soloToken(kind, seed) {
  return `s:${kind}:${seedToHex(seed)}`;
}

function parseSoloToken(token) {
  const m = /^s:(compare|order):([0-9a-f]{8})$/.exec(String(token || ''));
  if (!m) return null;
  return { kind: m[1], seed: parseInt(m[2], 16) >>> 0 };
}

function roomToken(code, round) {
  return `r:${code}:${round}`;
}

function parseRoomToken(token) {
  const m = /^r:([A-Z0-9]{6}):(\d{1,3})$/.exec(String(token || ''));
  if (!m) return null;
  return { code: m[1], round: Number(m[2]) };
}

function describe(hand) {
  const r = eval5(hand);
  return { name: r.name, detail: r.detail, category: r.category };
}

// Strongest-first order of hand indices. Equal hands keep their dealt order.
function bestOrder(hands) {
  return hands
    .map((hand, index) => ({ index, score: eval5(hand).score }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((x) => x.index);
}

function isPermutation(answer, size) {
  if (!Array.isArray(answer) || answer.length !== size) return false;
  const seen = new Set(answer);
  return seen.size === size && answer.every((i) => Number.isInteger(i) && i >= 0 && i < size);
}

// Returns null when the answer is malformed, otherwise { correct, solution, hands }.
function checkAnswer(question, answer) {
  const scores = question.hands.map((h) => eval5(h).score);
  const hands = question.hands.map(describe);
  if (question.kind === 'compare') {
    if (!['a', 'b', 'tie'].includes(answer)) return null;
    const solution = scores[0] === scores[1] ? 'tie' : scores[0] > scores[1] ? 'a' : 'b';
    return { correct: answer === solution, solution, hands };
  }
  if (!isPermutation(answer, question.hands.length)) return null;
  const correct = answer.every((idx, i) => i === 0 || scores[answer[i - 1]] >= scores[idx]);
  return { correct, solution: bestOrder(question.hands), hands };
}

// Points for one answer. `streak` is the run of correct answers before this one.
function scoreAnswer({ kind, correct, streak }) {
  if (!isKind(kind)) throw new Error('Unknown question kind');
  if (!correct) return { points: 0, base: 0, bonus: 0, streak: 0 };
  const base = BASE_POINTS[kind];
  const bonus = Math.min(Math.max(streak, 0), STREAK_BONUS_CAP) * STREAK_BONUS_STEP;
  return { points: base + bonus, base, bonus, streak: streak + 1 };
}

module.exports = {
  KINDS,
  HAND_COUNT,
  BASE_POINTS,
  ROOM_ROUNDS,
  isKind,
  deriveSeed,
  roomRoundKind,
  buildQuestion,
  soloToken,
  parseSoloToken,
  roomToken,
  parseRoomToken,
  checkAnswer,
  scoreAnswer,
  bestOrder,
};
