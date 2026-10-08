'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const game = require('./lib/game');
const { migrate, seedStaging } = require('./lib/db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const DRAIN_MS = 3000;

const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '').replace(/\\n/g, '\n');
const GUEST_JWT_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '').replace(/\\n/g, '\n');
const APP_AUDIENCE = process.env.USERNODE_APP_ID ? `usernode:app:${process.env.USERNODE_APP_ID}` : null;
const PUBLIC_API_PATHS = new Set(['/health']);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('[db] idle client error', err.message));

let dbReady = false;
let shuttingDown = false;

async function initDb() {
  for (;;) {
    try {
      await migrate(pool);
      if (IS_STAGING) await seedStaging(pool);
      dbReady = true;
      console.log('[db] ready');
      return;
    } catch (err) {
      console.error('[db] not ready, retrying:', err.message);
      await new Promise((r) => setTimeout(r, 2000));
      if (shuttingDown) return;
    }
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ ok: false, shuttingDown: true });
  res.json({ ok: true, db: dbReady });
});

// Identity: the shell injects an RS256 iframe token; visitors without an
// account carry an ES256 guest token. Writes and /api/* need a real user.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {
      // fall through to the guest check
    }
  }
  if (!req.user && token && GUEST_JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      const claims = jwt.verify(token, GUEST_JWT_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: `${APP_AUDIENCE}:guest`,
      });
      if (claims && claims.pur === 'guest') req.guest = true;
    } catch {
      // not a guest token either
    }
  }
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (req.user) return next();
    // Guests may read, never write.
    if (req.guest && req.method === 'GET') return next();
    if (req.guest) return res.status(401).json({ error: 'account_required' });
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

function needDb(_req, res, next) {
  if (!dbReady) return res.status(503).json({ error: 'database_unavailable' });
  next();
}

function wrap(fn) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(`[api] ${req.method} ${req.path}`, err);
      if (!res.headersSent) res.status(500).json({ error: 'server_error' });
    });
  };
}

function publicQuestion(token, q) {
  return { token, kind: q.kind, hands: q.hands };
}

function newRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

async function upsertPlayer(db, user) {
  await db.query(
    `INSERT INTO players (user_id, username) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, updated_at = NOW()`,
    [user.id, user.username],
  );
}

app.get('/api/me', (req, res) => {
  res.json({
    user: req.user ? { id: req.user.id, username: req.user.username } : null,
    guest: !req.user,
  });
});

// A fresh solo question. Reading one writes nothing, so guests can try it.
app.get('/api/question', (req, res) => {
  const kind = String(req.query.kind || 'compare');
  if (!game.isKind(kind)) return res.status(400).json({ error: 'unknown_kind' });
  const seed = crypto.randomInt(0, 2 ** 32);
  res.json(publicQuestion(game.soloToken(kind, seed), game.buildQuestion(kind, seed)));
});

app.get('/api/leaderboard', needDb, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.user_id, p.username, SUM(a.points)::int AS points,
            COUNT(*)::int AS answered, COUNT(*) FILTER (WHERE a.correct)::int AS correct
       FROM answers a JOIN players p ON p.user_id = a.user_id
      GROUP BY p.user_id, p.username
      ORDER BY points DESC, answered ASC, p.username ASC
      LIMIT 20`,
  );
  res.json({ entries: rows.map(toEntry), me: req.user ? req.user.id : null });
}));

function toEntry(r) {
  return { userId: r.user_id, username: r.username, points: r.points, answered: r.answered, correct: r.correct };
}

app.post('/api/rooms', needDb, wrap(async (req, res) => {
  await upsertPlayer(pool, req.user);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newRoomCode();
    const seed = crypto.randomInt(0, 2 ** 32);
    const ins = await pool.query(
      `INSERT INTO rooms (code, seed, host_id, host_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING code`,
      [code, seed, req.user.id, req.user.username],
    );
    if (ins.rowCount) {
      await pool.query('INSERT INTO room_members (code, user_id) VALUES ($1, $2)', [code, req.user.id]);
      return res.status(201).json({ code });
    }
  }
  res.status(503).json({ error: 'try_again' });
}));

async function loadRoom(code) {
  if (!/^[A-Z0-9]{6}$/.test(code)) return null;
  const { rows } = await pool.query('SELECT code, seed, host_id, host_name FROM rooms WHERE code = $1', [code]);
  return rows[0] || null;
}

app.post('/api/rooms/:code/join', needDb, wrap(async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const room = await loadRoom(code);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  await upsertPlayer(pool, req.user);
  await pool.query(
    'INSERT INTO room_members (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [code, req.user.id],
  );
  res.json({ code });
}));

app.get('/api/rooms/:code', needDb, wrap(async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const room = await loadRoom(code);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  const { rows } = await pool.query(
    `SELECT p.user_id, p.username,
            COALESCE(SUM(a.points), 0)::int AS points,
            COUNT(a.id)::int AS answered,
            COUNT(a.id) FILTER (WHERE a.correct)::int AS correct
       FROM room_members m
       JOIN players p ON p.user_id = m.user_id
       LEFT JOIN answers a ON a.user_id = m.user_id AND a.room_code = m.code
      WHERE m.code = $1
      GROUP BY p.user_id, p.username
      ORDER BY points DESC, answered DESC, p.username ASC`,
    [code],
  );
  const entries = rows.map(toEntry);
  const mine = req.user ? entries.find((e) => e.userId === req.user.id) : null;
  res.json({
    code,
    host: room.host_name,
    rounds: game.ROOM_ROUNDS,
    entries,
    joined: !!mine,
    answered: mine ? mine.answered : 0,
    me: req.user ? req.user.id : null,
  });
}));

// The caller's next room question: round n, where n is how many they have answered.
app.get('/api/rooms/:code/question', needDb, wrap(async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const room = await loadRoom(code);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  let round = 0;
  if (req.user) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM answers WHERE user_id = $1 AND room_code = $2',
      [req.user.id, code],
    );
    round = rows[0].n;
  }
  if (round >= game.ROOM_ROUNDS) return res.json({ finished: true });
  const q = game.buildQuestion(game.roomRoundKind(round), game.deriveSeed(Number(room.seed), round));
  res.json({ ...publicQuestion(game.roomToken(code, round), q), round, rounds: game.ROOM_ROUNDS });
}));

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Works out which question a token names, or throws.
async function resolveQuestion(client, user, token) {
  const solo = game.parseSoloToken(token);
  if (solo) return { question: game.buildQuestion(solo.kind, solo.seed), roomCode: null };
  const r = game.parseRoomToken(token);
  if (!r) throw new HttpError(400, 'bad_token');
  const room = (await client.query('SELECT seed FROM rooms WHERE code = $1', [r.code])).rows[0];
  if (!room) throw new HttpError(404, 'room_not_found');
  const done = (await client.query(
    'SELECT COUNT(*)::int AS n FROM answers WHERE user_id = $1 AND room_code = $2',
    [user.id, r.code],
  )).rows[0].n;
  if (r.round >= game.ROOM_ROUNDS || r.round !== done) throw new HttpError(409, 'wrong_round');
  const question = game.buildQuestion(game.roomRoundKind(r.round), game.deriveSeed(Number(room.seed), r.round));
  return { question, roomCode: r.code };
}

app.post('/api/answer', needDb, wrap(async (req, res) => {
  const { token, answer } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsertPlayer(client, req.user);
    const { question, roomCode } = await resolveQuestion(client, req.user, token);
    const checked = game.checkAnswer(question, answer);
    if (!checked) throw new HttpError(400, 'bad_answer');
    const streak = (await client.query(
      'SELECT streak FROM players WHERE user_id = $1 FOR UPDATE',
      [req.user.id],
    )).rows[0].streak;
    const score = game.scoreAnswer({ kind: question.kind, correct: checked.correct, streak });
    const ins = await client.query(
      `INSERT INTO answers (user_id, token, room_code, kind, correct, points)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, token) DO NOTHING`,
      [req.user.id, token, roomCode, question.kind, checked.correct, score.points],
    );
    if (!ins.rowCount) throw new HttpError(409, 'already_answered');
    await client.query('UPDATE players SET streak = $2 WHERE user_id = $1', [req.user.id, score.streak]);
    const total = (await client.query(
      'SELECT COALESCE(SUM(points), 0)::int AS t FROM answers WHERE user_id = $1',
      [req.user.id],
    )).rows[0].t;
    await client.query('COMMIT');
    res.json({
      correct: checked.correct,
      solution: checked.solution,
      hands: checked.hands,
      points: score.points,
      base: score.base,
      bonus: score.bonus,
      streak: score.streak,
      totalPoints: total,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code });
    throw err;
  } finally {
    client.release();
  }
}));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// Same page for /room/CODE links; the client reads the code from the path.
app.get('/room/:code', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, HOST, () => {
  console.log(`listening on ${HOST}:${PORT}`);
  initDb();
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, draining`);
  server.close(() => {});
  if (server.closeIdleConnections) server.closeIdleConnections();
  const t = setTimeout(() => server.closeAllConnections && server.closeAllConnections(), DRAIN_MS);
  if (t.unref) t.unref();
  try {
    await pool.end();
  } catch (err) {
    console.error('[shutdown] pool.end failed', err.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
