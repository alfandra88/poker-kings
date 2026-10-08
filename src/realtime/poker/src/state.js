/**
 * Player profiles, XP, achievements and season points.
 *
 * Storage: Postgres (profiles + season_points) when a pool is supplied, with an
 * in-memory fallback (used by offline tests / no-DATABASE_URL boots). Profiles
 * are loaded into memory on boot and flushed back every few seconds — the sync
 * API surface is unchanged for callers.
 */
const FLUSH_MS = 3000;

export const ACHIEVEMENTS = [
    { id: "first_win", icon: "🥇", test: (p) => p.roundsWon >= 1 },
    { id: "flush_win", icon: "🃏", test: (p) => (p.counters.hand_flush ?? 0) >= 1 },
    { id: "boat_plus", icon: "🚤", test: (p) => (p.counters.hand_full_house ?? 0) >= 1 },
    { id: "quads_plus", icon: "🎯", test: (p) => ((p.counters.hand_quads ?? 0) + (p.counters.hand_straight_flush ?? 0)) >= 1 },
    { id: "showdown_100", icon: "🎪", test: (p) => p.showdowns >= 100 },
    { id: "hands_500", icon: "⚒️", test: (p) => p.handsPlayed >= 500 },
    { id: "host_10", icon: "🏠", test: (p) => (p.counters.host ?? 0) >= 10 },
    { id: "gg_50", icon: "🤝", test: (p) => (p.counters.gg ?? 0) >= 50 },
    { id: "chat_100", icon: "💬", test: (p) => (p.counters.chat ?? 0) >= 100 },
    { id: "mtt_ko3", icon: "👑", test: (p) => (p.counters.tourWins ?? 0) >= 3 },
    { id: "level_10", icon: "⭐", test: (p) => p.level >= 10 },
];

export function sanitizeLanguage(x) {
    return typeof x === "string" && /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(x) ? x.slice(0, 16) : "en";
}
export function sanitizeNickname(x, fallback) {
    if (typeof x !== "string")
        return fallback;
    const s = x.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
    return s || fallback;
}
export function sanitizeAvatar(x) {
    if (typeof x !== "string")
        return null;
    const s = x.trim().slice(0, 64);
    // Avatars are emoji or short glyph strings — never URLs.
    return /^[\p{L}\p{N}\p{Emoji_Presentation}\p{Extended_Pictographic} -]+$/u.test(s) ? s : null;
}
export function seasonKey(now = new Date()) {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function xpForLevel(level) {
    return Math.round(500 * Math.pow(Math.max(1, level), 1.5));
}

export class StateStore {
    pool; // pg.Pool | null
    profiles = new Map();
    season = new Map(); // `${season}|${userId}` -> { season, userId, points, played }
    dirtyProfiles = new Set();
    dirtySeason = new Set();
    hFlush = null;

    constructor(pool) {
        this.pool = pool ?? null;
    }
    /** Load persisted state into memory. Safe to call repeatedly. */
    async load() {
        if (!this.pool)
            return;
        try {
            const r = await this.pool.query(
                "SELECT id, nickname, avatar, language, xp, rounds_won, hands_played, showdowns, achievements, counters FROM profiles");
            for (const row of r.rows)
                this.profiles.set(row.id, this.rowToProfile(row));
            const s = await this.pool.query(
                "SELECT season, user_id, points, played FROM season_points");
            for (const row of s.rows) {
                const key = `${row.season}|${row.user_id}`;
                this.season.set(key, { season: row.season, userId: row.user_id, points: row.points, played: row.played });
            }
        }
        catch (e) {
            console.error("[state] load failed, starting from memory:", e.message);
        }
    }
    rowToProfile(row) {
        return {
            id: row.id,
            nickname: sanitizeNickname(row.nickname, "Player"),
            avatar: sanitizeAvatar(row.avatar) ?? "🂡",
            language: sanitizeLanguage(row.language),
            xp: row.xp ?? 0,
            level: 1,
            roundsWon: row.rounds_won ?? 0,
            handsPlayed: row.hands_played ?? 0,
            showdowns: row.showdowns ?? 0,
            achievements: row.achievements ?? {},
            counters: row.counters ?? {},
            createdAt: Date.now(),
            dirty: false,
        };
    }
    startFlushTimer() {
        if (this.hFlush)
            return;
        this.hFlush = setInterval(() => {
            this.flush().catch((e) => console.error("[state] flush failed:", e.message));
        }, FLUSH_MS);
        if (this.hFlush.unref)
            this.hFlush.unref();
    }
    getOrCreate(id, seed = {}) {
        let p = this.profiles.get(id);
        if (!p) {
            p = {
                id,
                nickname: sanitizeNickname(seed.nickname, `Player ${id.slice(-4)}`),
                avatar: sanitizeAvatar(seed.avatar) ?? "🂡",
                language: sanitizeLanguage(seed.language),
                xp: 0,
                level: 1,
                roundsWon: 0,
                handsPlayed: 0,
                showdowns: 0,
                achievements: {},
                counters: {},
                createdAt: Date.now(),
                dirty: true,
            };
            this.profiles.set(id, p);
            this.dirtyProfiles.add(id);
        }
        return p;
    }
    markDirty(p) {
        p.dirty = true;
        this.dirtyProfiles.add(p.id);
    }
    updateIdentity(id, { nickname, avatar, language } = {}) {
        const p = this.getOrCreate(id);
        if (nickname !== undefined) {
            p.nickname = sanitizeNickname(nickname, p.nickname);
        }
        if (avatar !== undefined) {
            const a = sanitizeAvatar(avatar);
            if (a !== null)
                p.avatar = a;
        }
        if (language !== undefined) {
            p.language = sanitizeLanguage(language);
        }
        this.markDirty(p);
        return p;
    }
    addXp(p, amount) {
        if (!Number.isFinite(amount) || amount <= 0)
            return;
        p.xp += Math.round(amount);
        while (p.xp >= xpForLevel(p.level + 1))
            p.level += 1;
        this.markDirty(p);
    }
    recordHandResult(p, { won } = {}) {
        p.handsPlayed += 1;
        if (won > 0)
            p.roundsWon += 1;
        this.markDirty(p);
    }
    counter(p, key, delta = 1) {
        if (typeof key !== "string" || !key)
            return;
        p.counters[key] = (p.counters[key] ?? 0) + delta;
        this.markDirty(p);
    }
    checkAchievements(p) {
        const unlocked = [];
        for (const a of ACHIEVEMENTS) {
            if (p.achievements[a.id])
                continue;
            let ok = false;
            try {
                ok = !!a.test(p);
            }
            catch {
                ok = false;
            }
            if (ok) {
                p.achievements[a.id] = Date.now();
                unlocked.push(a);
            }
        }
        if (unlocked.length)
            this.markDirty(p);
        return unlocked;
    }
    me(p) {
        const s = this.seasonPointsOf(p.id);
        return {
            id: p.id,
            nickname: p.nickname,
            avatar: p.avatar,
            level: p.level,
            xp: p.xp,
            nextLevelXp: xpForLevel(p.level + 1),
            roundsWon: p.roundsWon,
            handsPlayed: p.handsPlayed,
            seasonPoints: s.points,
            seasonPlayed: s.played,
            achievements: Object.keys(p.achievements),
        };
    }
    statsView(p) {
        const showdowns = Math.max(1, p.showdowns);
        return {
            nickname: p.nickname,
            avatar: p.avatar,
            level: p.level,
            xp: p.xp,
            nextLevelXp: xpForLevel(p.level + 1),
            roundsWon: p.roundsWon,
            handsPlayed: p.handsPlayed,
            showdowns: p.showdowns,
            winRate: Math.round((p.counters.hand_win ?? 0) / showdowns * 100),
            achievements: Object.keys(p.achievements),
        };
    }
    seasonPointsOf(id) {
        return this.season.get(`${seasonKey()}|${id}`) ?? { points: 0, played: 0 };
    }
    addSeasonPoints(id, points, played = 1) {
        if (!Number.isFinite(points) || points === 0)
            return;
        const key = `${seasonKey()}|${id}`;
        let row = this.season.get(key);
        if (!row) {
            row = { season: seasonKey(), userId: id, points: 0, played: 0 };
            this.season.set(key, row);
        }
        row.points += Math.round(points);
        row.played += played;
        this.dirtySeason.add(key);
    }
    leaderboard(limit = 50) {
        return [...this.profiles.values()]
            .sort((a, b) => b.xp - a.xp || b.roundsWon - a.roundsWon)
            .slice(0, limit)
            .map((p) => ({
                id: p.id,
                nickname: p.nickname,
                avatar: p.avatar,
                xp: p.xp,
                level: p.level,
                roundsWon: p.roundsWon,
            }));
    }
    seasonLeaderboard(limit = 50) {
        const cur = seasonKey();
        return [...this.season.values()]
            .filter((r) => r.season === cur)
            .sort((a, b) => b.points - a.points || b.played - a.played)
            .slice(0, limit)
            .map((r) => {
                const p = this.profiles.get(r.userId);
                return {
                    id: r.userId,
                    nickname: p?.nickname ?? `Player ${r.userId.slice(-4)}`,
                    avatar: p?.avatar ?? "🂡",
                    points: r.points,
                    played: r.played,
                };
            });
    }
    async flush() {
        if (!this.pool)
            return;
        const profIds = [...this.dirtyProfiles];
        this.dirtyProfiles.clear();
        for (const id of profIds) {
            const p = this.profiles.get(id);
            if (!p)
                continue;
            p.dirty = false;
            await this.pool.query(
                `INSERT INTO profiles (id, nickname, avatar, language, xp, rounds_won, hands_played, showdowns, achievements, counters, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                   nickname = EXCLUDED.nickname, avatar = EXCLUDED.avatar, language = EXCLUDED.language,
                   xp = EXCLUDED.xp, rounds_won = EXCLUDED.rounds_won, hands_played = EXCLUDED.hands_played,
                   showdowns = EXCLUDED.showdowns, achievements = EXCLUDED.achievements,
                   counters = EXCLUDED.counters, updated_at = NOW()`,
                [p.id, p.nickname, p.avatar, p.language, p.xp, p.roundsWon, p.handsPlayed, p.showdowns,
                    JSON.stringify(p.achievements), JSON.stringify(p.counters)]);
        }
        const sKeys = [...this.dirtySeason];
        this.dirtySeason.clear();
        for (const key of sKeys) {
            const row = this.season.get(key);
            if (!row)
                continue;
            await this.pool.query(
                `INSERT INTO season_points (season, user_id, points, played)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (season, user_id) DO UPDATE SET points = EXCLUDED.points, played = EXCLUDED.played`,
                [row.season, row.userId, row.points, row.played]);
        }
    }
    async close() {
        if (this.hFlush) {
            clearInterval(this.hFlush);
            this.hFlush = null;
        }
        try {
            await this.flush();
        }
        catch { /* best effort on shutdown */ }
    }
}