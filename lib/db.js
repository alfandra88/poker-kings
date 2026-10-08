'use strict';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  user_id    INTEGER PRIMARY KEY,
  username   TEXT NOT NULL,
  streak     INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS rooms (
  code       TEXT PRIMARY KEY,
  seed       BIGINT NOT NULL,
  host_id    INTEGER NOT NULL,
  host_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS room_members (
  code      TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES players(user_id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code, user_id)
);
CREATE TABLE IF NOT EXISTS answers (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES players(user_id),
  token      TEXT NOT NULL,
  room_code  TEXT,
  kind       TEXT NOT NULL,
  correct    BOOLEAN NOT NULL,
  points     INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);
CREATE INDEX IF NOT EXISTS answers_room_idx ON answers (room_code, user_id);
`;

async function migrate(pool) {
  await pool.query(SCHEMA);
}

// Fake identities only, never the visitor, so the preview's leaderboard and
// demo room are not empty.
async function seedStaging(pool) {
  const fakes = [
    [900001, 'Staging demo Ada'],
    [900002, 'Staging demo Ben'],
    [900003, 'Staging demo Cleo'],
  ];
  for (const [id, name] of fakes) {
    await pool.query(
      'INSERT INTO players (user_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, name],
    );
  }
  await pool.query(
    `INSERT INTO rooms (code, seed, host_id, host_name)
     VALUES ('DEMO22', 1234567, 900001, 'Staging demo Ada') ON CONFLICT DO NOTHING`,
  );
  const rows = [
    [900001, 'compare', 10, 'seed-a1'], [900001, 'order', 25, 'seed-a2'],
    [900001, 'compare', 12, 'seed-a3'], [900002, 'compare', 10, 'seed-b1'],
    [900002, 'compare', 12, 'seed-b2'], [900003, 'order', 25, 'seed-c1'],
  ];
  for (const [uid, kind, points, token] of rows) {
    await pool.query(
      `INSERT INTO answers (user_id, token, kind, correct, points)
       VALUES ($1, $2, $3, TRUE, $4) ON CONFLICT DO NOTHING`,
      [uid, `staging:${token}`, kind, points],
    );
  }
  for (const [uid, points] of [[900001, 10], [900002, 10], [900003, 0]]) {
    await pool.query(
      `INSERT INTO answers (user_id, token, room_code, kind, correct, points)
       VALUES ($1, 'r:DEMO22:0', 'DEMO22', 'compare', $2, $3) ON CONFLICT DO NOTHING`,
      [uid, points > 0, points],
    );
  }
  for (const [id] of fakes) {
    await pool.query(
      'INSERT INTO room_members (code, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      ['DEMO22', id],
    );
  }
}

module.exports = { migrate, seedStaging };
