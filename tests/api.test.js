'use strict';

// End-to-end check of the answer/room/leaderboard SQL against a real Postgres.
// Skipped unless DATABASE_URL is set. Tokens are signed with a throwaway key
// generated here and given to the child server as its "platform" public key.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const game = require('../lib/game');

const DATABASE_URL = process.env.DATABASE_URL || process.env.INLOOP_DATABASE_URL;
const PORT = 3900 + Math.floor(Math.random() * 90);
const APP_ID = '77';
const base = `http://127.0.0.1:${PORT}`;

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const suffix = Date.now() % 1000000;
const mint = (id, username) => jwt.sign(
  { id, username, pur: 'iframe' },
  privateKey,
  { algorithm: 'RS256', issuer: 'usernode', audience: `usernode:app:${APP_ID}` },
);
const alice = mint(800000 + suffix, `alice${suffix}`);
const bob = mint(900000 + suffix, `bob${suffix}`);

async function call(method, url, token, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { 'x-usernode-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// The answer a correct player would give for a served question.
function correctAnswer(q) {
  const question = { kind: q.kind, hands: q.hands };
  const probe = game.checkAnswer(question, q.kind === 'compare' ? 'a' : [0, 1, 2, 3]);
  return probe.solution;
}

test('answers, streaks, rooms and the leaderboard', { skip: !DATABASE_URL }, async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL,
      USERNODE_ENV: 'production',
      USERNODE_APP_ID: APP_ID,
      USERNODE_JWT_PUBLIC_KEY: publicKey,
    },
    stdio: 'ignore',
  });
  t.after(() => child.kill('SIGTERM'));

  for (let i = 0; i < 50; i++) {
    try {
      const h = await (await fetch(`${base}/health`)).json();
      if (h.db) break;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }

  assert.equal((await call('GET', '/api/me')).status, 401, 'no token is refused');
  assert.equal((await call('POST', '/api/answer', null, {})).status, 401);

  const q1 = (await call('GET', '/api/question?kind=compare', alice)).body;
  assert.equal(q1.hands.length, 2);
  const r1 = await call('POST', '/api/answer', alice, { token: q1.token, answer: correctAnswer(q1) });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.correct, true);
  assert.equal(r1.body.points, 10);
  assert.equal(r1.body.streak, 1);

  const again = await call('POST', '/api/answer', alice, { token: q1.token, answer: correctAnswer(q1) });
  assert.equal(again.status, 409, 'a question can only be answered once');

  const q2 = (await call('GET', '/api/question?kind=order', alice)).body;
  const r2 = await call('POST', '/api/answer', alice, { token: q2.token, answer: correctAnswer(q2) });
  assert.equal(r2.body.points, 25 + 2, 'streak bonus applies to the second correct answer');
  assert.equal(r2.body.totalPoints, 37);

  const q3 = (await call('GET', '/api/question?kind=order', alice)).body;
  const wrong = correctAnswer(q3).slice().reverse();
  const r3 = await call('POST', '/api/answer', alice, { token: q3.token, answer: wrong });
  if (!r3.body.correct) {
    assert.equal(r3.body.points, 0);
    assert.equal(r3.body.streak, 0, 'a wrong answer resets the streak');
  }
  assert.equal((await call('POST', '/api/answer', alice, { token: q3.token, answer: correctAnswer(q3) })).status, 409);
  assert.equal((await call('POST', '/api/answer', alice, { token: 's:compare:00000001', answer: 'zzz' })).status, 400);

  const created = await call('POST', '/api/rooms', alice);
  assert.equal(created.status, 201);
  const code = created.body.code;
  assert.equal((await call('POST', `/api/rooms/${code}/join`, bob)).status, 200);
  assert.equal((await call('POST', '/api/rooms/ZZZZZZ/join', bob)).status, 404);

  const rq = (await call('GET', `/api/rooms/${code}/question`, bob)).body;
  assert.equal(rq.round, 0);
  const rqAlice = (await call('GET', `/api/rooms/${code}/question`, alice)).body;
  assert.deepEqual(rqAlice.hands, rq.hands, 'everyone in a room gets the same hands');

  const skip = await call('POST', '/api/answer', bob, { token: `r:${code}:3`, answer: 'a' });
  assert.equal(skip.status, 409, 'rounds cannot be skipped');
  const ra = await call('POST', '/api/answer', bob, { token: rq.token, answer: correctAnswer(rq) });
  assert.equal(ra.body.points, 10);

  const room = (await call('GET', `/api/rooms/${code}`, bob)).body;
  assert.equal(room.entries.length, 2);
  assert.equal(room.entries[0].username, `bob${suffix}`);
  assert.equal(room.entries[0].points, 10);
  assert.equal(room.answered, 1);

  const board = (await call('GET', '/api/leaderboard', alice)).body;
  const me = board.entries.find((e) => e.username === `alice${suffix}`);
  assert.ok(me, 'player appears on the leaderboard');
  assert.ok(me.points >= 37);
});
