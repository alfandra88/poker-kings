// Player profiles, round results and contest results, kept in Postgres.
// Profiles are cached in memory; every write is queued so shutdown can wait
// for the last one before the pool closes.

export const ACHIEVEMENTS = [
    "first_round", "score_50", "score_100", "score_150", "flush_line", "full_house_line",
    "quads_line", "royal_line", "rounds_10", "rounds_100", "contest_win", "host_5", "level_10",
];

export function xpForLevel(level) {
    return Math.round(500 * Math.pow(level, 1.5));
}
export function levelFromXp(xp) {
    let lvl = 1;
    while (xp >= xpForLevel(lvl) && lvl < 200)
        lvl++;
    return lvl;
}

export const PERIODS = ["daily", "weekly", "monthly", "yearly", "forever"];

// Start of each leaderboard period, in UTC.
export function periodStart(period, now) {
    const d = new Date(now);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    if (period === "daily")
        return new Date(Date.UTC(y, m, d.getUTCDate()));
    if (period === "weekly") {
        const day = (d.getUTCDay() + 6) % 7;
        return new Date(Date.UTC(y, m, d.getUTCDate() - day));
    }
    if (period === "monthly")
        return new Date(Date.UTC(y, m, 1));
    if (period === "yearly")
        return new Date(Date.UTC(y, 0, 1));
    return new Date(0);
}

const LINE_RANK = ["nothing", "pair", "two_pair", "trips", "straight", "flush", "full_house", "quads", "straight_flush", "royal_flush"];

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  user_id bigint PRIMARY KEY,
  username text NOT NULL,
  xp integer NOT NULL DEFAULT 0,
  achievements jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS round_results (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL,
  username text NOT NULL,
  table_code text NOT NULL,
  contest_id text,
  points integer NOT NULL,
  best_line text,
  finished_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE round_results ADD COLUMN IF NOT EXISTS contest_id text;
CREATE INDEX IF NOT EXISTS round_results_finished_points ON round_results (finished_at, points DESC);
CREATE TABLE IF NOT EXISTS contest_results (
  contest_id text NOT NULL,
  user_id bigint NOT NULL,
  username text NOT NULL,
  place integer NOT NULL,
  total_points integer NOT NULL,
  season_points integer NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contest_id, user_id)
);
`;

// Season points for a finishing place in a contest.
export function seasonPointsFor(place, entrants) {
    const table = [10, 6, 4, 3, 2];
    if (entrants < 2)
        return 1;
    return table[place - 1] ?? 1;
}

export class PlayerStore {
    constructor(pool) {
        this.pool = pool;
        this.cache = new Map();
        this.pending = new Set();
    }
    async migrate() {
        await this.pool.query(SCHEMA);
    }
    track(p) {
        this.pending.add(p);
        p.finally(() => this.pending.delete(p)).catch(() => { });
        return p;
    }
    async flush() {
        while (this.pending.size)
            await Promise.allSettled([...this.pending]);
    }
    // Loads (or creates) the profile for a signed-in Homeroom user.
    async ensure(user) {
        const id = String(user.id);
        const cached = this.cache.get(id);
        if (cached) {
            if (user.username && cached.username !== user.username) {
                cached.username = user.username;
                this.save(cached);
            }
            return cached;
        }
        const { rows } = await this.track(this.pool.query(`INSERT INTO players (user_id, username) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, updated_at = now()
       RETURNING user_id, username, xp, achievements, stats`, [id, user.username]));
        const r = rows[0];
        const p = {
            id,
            username: r.username,
            xp: r.xp,
            achievements: Array.isArray(r.achievements) ? r.achievements : [],
            stats: { rounds: 0, best: 0, total: 0, bestLine: null, hosted: 0, contestWins: 0, ...(r.stats ?? {}) },
        };
        this.cache.set(id, p);
        return p;
    }
    get(id) {
        return this.cache.get(String(id)) ?? null;
    }
    save(p) {
        return this.track(this.pool.query(`UPDATE players SET username = $2, xp = $3, achievements = $4::jsonb, stats = $5::jsonb, updated_at = now() WHERE user_id = $1`, [p.id, p.username, p.xp, JSON.stringify(p.achievements), JSON.stringify(p.stats)]));
    }
    me(p) {
        const level = levelFromXp(p.xp);
        const lo = level > 1 ? xpForLevel(level - 1) : 0;
        const hi = xpForLevel(level);
        return {
            id: p.id,
            username: p.username,
            xp: p.xp,
            level,
            levelProgress: Math.max(0, Math.min(1, (p.xp - lo) / Math.max(1, hi - lo))),
            stats: {
                rounds: p.stats.rounds,
                best: p.stats.best,
                total: p.stats.total,
                average: p.stats.rounds ? Math.round(p.stats.total / p.stats.rounds) : 0,
                bestLine: p.stats.bestLine,
                contestWins: p.stats.contestWins,
            },
            achievements: p.achievements,
        };
    }
    grant(p, unlocked, key, cond) {
        if (cond && !p.achievements.includes(key)) {
            p.achievements.push(key);
            unlocked.push(key);
        }
    }
    checkAchievements(p) {
        const s = p.stats;
        const unlocked = [];
        const lineAtLeast = (k) => LINE_RANK.indexOf(s.bestLine ?? "nothing") >= LINE_RANK.indexOf(k);
        this.grant(p, unlocked, "first_round", s.rounds >= 1);
        this.grant(p, unlocked, "score_50", s.best >= 50);
        this.grant(p, unlocked, "score_100", s.best >= 100);
        this.grant(p, unlocked, "score_150", s.best >= 150);
        this.grant(p, unlocked, "flush_line", lineAtLeast("flush"));
        this.grant(p, unlocked, "full_house_line", lineAtLeast("full_house"));
        this.grant(p, unlocked, "quads_line", lineAtLeast("quads"));
        this.grant(p, unlocked, "royal_line", s.bestLine === "royal_flush");
        this.grant(p, unlocked, "rounds_10", s.rounds >= 10);
        this.grant(p, unlocked, "rounds_100", s.rounds >= 100);
        this.grant(p, unlocked, "contest_win", s.contestWins >= 1);
        this.grant(p, unlocked, "host_5", s.hosted >= 5);
        this.grant(p, unlocked, "level_10", levelFromXp(p.xp) >= 10);
        return unlocked;
    }
    countHosted(p) {
        p.stats.hosted = (p.stats.hosted ?? 0) + 1;
        const unlocked = this.checkAchievements(p);
        this.save(p);
        return unlocked;
    }
    // One finished round for one human player.
    recordRound(p, { points, bestLine, tableCode, contestId }) {
        const s = p.stats;
        s.rounds += 1;
        s.total += points;
        if (points > s.best)
            s.best = points;
        if (bestLine && LINE_RANK.indexOf(bestLine) > LINE_RANK.indexOf(s.bestLine ?? "nothing"))
            s.bestLine = bestLine;
        const levelBefore = levelFromXp(p.xp);
        p.xp += 10 + Math.floor(points / 10);
        const unlocked = this.checkAchievements(p);
        this.track(this.pool.query(`INSERT INTO round_results (user_id, username, table_code, contest_id, points, best_line) VALUES ($1, $2, $3, $4, $5, $6)`, [p.id, p.username, tableCode, contestId ?? null, points, bestLine ?? null]));
        this.save(p);
        return { unlocked, levelUp: levelFromXp(p.xp) > levelBefore ? levelFromXp(p.xp) : null };
    }
    recordContest(contestId, rows) {
        for (const r of rows) {
            const p = this.get(r.id);
            if (p && r.place === 1) {
                p.stats.contestWins = (p.stats.contestWins ?? 0) + 1;
                this.checkAchievements(p);
                this.save(p);
            }
            this.track(this.pool.query(`INSERT INTO contest_results (contest_id, user_id, username, place, total_points, season_points) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (contest_id, user_id) DO NOTHING`, [contestId, r.id, r.username, r.place, r.total, r.seasonPoints]));
        }
    }
    async leaderboard(now = Date.now()) {
        const periods = {};
        for (const period of PERIODS) {
            const { rows } = await this.pool.query(`SELECT username, max(points)::int AS best, count(*)::int AS rounds
         FROM round_results WHERE finished_at >= $1
         GROUP BY user_id, username ORDER BY best DESC, rounds DESC, username ASC LIMIT 25`, [periodStart(period, now)]);
            periods[period] = rows;
        }
        const { rows: season } = await this.pool.query(`SELECT username, sum(season_points)::int AS points, count(*)::int AS played
       FROM contest_results WHERE finished_at >= $1
       GROUP BY user_id, username ORDER BY points DESC, played DESC, username ASC LIMIT 25`, [periodStart("monthly", now)]);
        return { periods, season };
    }
}

// Staging only: a few obviously fake players and results so the leaderboard
// is not empty in a preview. Fixed ids, so a reboot inserts nothing new.
export async function seedStaging(pool) {
    const names = ["ana", "ben", "cleo", "dev", "eli", "fay"];
    for (let i = 0; i < names.length; i++) {
        await pool.query(`INSERT INTO players (user_id, username, xp, stats) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (user_id) DO NOTHING`, [-(900001 + i), `staging-demo-${names[i]}`, 400 + i * 150, JSON.stringify({ rounds: 2, best: 60 + i * 20, total: 100 + i * 30 })]);
    }
    const points = [42, 65, 88, 120, 74, 180, 56, 95, 133, 47, 102, 61];
    for (let i = 0; i < points.length; i++) {
        const who = i % names.length;
        await pool.query(`INSERT INTO round_results (id, user_id, username, table_code, points, best_line, finished_at)
       VALUES ($1, $2, $3, 'DEMO00', $4, 'flush', now()) ON CONFLICT (id) DO NOTHING`, [900001 + i, -(900001 + who), `staging-demo-${names[who]}`, points[i]]);
    }
    // Keep the serial ahead of the fixed demo ids.
    await pool.query(`SELECT setval(pg_get_serial_sequence('round_results', 'id'), GREATEST((SELECT max(id) FROM round_results), 1000000))`);
    for (let i = 0; i < 3; i++) {
        await pool.query(`INSERT INTO contest_results (contest_id, user_id, username, place, total_points, season_points)
       VALUES ('staging-demo-contest', $1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [-(900001 + i), `staging-demo-${names[i]}`, i + 1, 300 - i * 40, seasonPointsFor(i + 1, 3)]);
    }
}
