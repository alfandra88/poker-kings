import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
export const ACHIEVEMENTS = [
    { key: "first_win", name: "First Blood", desc: "Win your first pot" },
    { key: "flush_win", name: "Flush Fancy", desc: "Win a pot with a flush or better" },
    { key: "boat_plus", name: "Boat Racer", desc: "Win a pot with a full house or better" },
    { key: "quads_plus", name: "Four of a Kind", desc: "Win a pot with quads or a straight flush" },
    { key: "big_pot_100bb", name: "Monster Pot", desc: "Win a pot of 100+ big blinds" },
    { key: "win_72o", name: "The Hammer", desc: "Win a showdown with 7-2 offsuit" },
    { key: "showdown_100", name: "Showdown Regular", desc: "Reach 100 showdowns" },
    { key: "hands_500", name: "Grinder", desc: "Play 500 hands" },
    { key: "streak_7", name: "Loyal Player", desc: "Claim the daily bonus 7 days in a row" },
    { key: "host_10", name: "The Host", desc: "Create 10 tables" },
    { key: "gg_50", name: "Good Game", desc: "Receive 50 NH/GG reactions" },
    { key: "chat_100", name: "Chatty", desc: "Send 100 chat messages" },
    { key: "hu_win", name: "Duelist", desc: "Win a heads-up Sit & Go" },
    { key: "mtt_ko3", name: "Bounty Hunter", desc: "Eliminate 3 players in one tournament" },
    { key: "level_10", name: "Rising Star", desc: "Reach level 10" },
];
const DATA_DIR = new URL("../../data/", import.meta.url).pathname;
const DATA_FILE = `${DATA_DIR}state.json`;

const SAFE_LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
export function sanitizeLanguage(v) {
    if (typeof v !== "string")
        return undefined;
    const s = v.trim().toLowerCase().slice(0, 10);
    return SAFE_LANG_RE.test(s) ? s : undefined;
}
function todayUTC() {
    return new Date().toISOString().slice(0, 10);
}
export function dayKey(now) {
    return new Date(now).toISOString().slice(0, 10);
}

export function weekKey(now) {
    const t = new Date(now);
    const date = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;     date.setUTCDate(date.getUTCDate() - dayNum + 3);     const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
export function monthKey(now) {
    return new Date(now).toISOString().slice(0, 7);
}
export function yearKey(now) {
    return new Date(now).toISOString().slice(0, 4);
}
export function periodKeyOf(period, now) {
    if (period === "daily")
        return dayKey(now);
    if (period === "weekly")
        return weekKey(now);
    if (period === "monthly")
        return monthKey(now);
    return yearKey(now);
}
function freshPeriods(now = Date.now()) {
    const mk = (period) => ({
        key: periodKeyOf(period, now), net: 0, hands: 0, wins: 0, biggestPot: 0,
    });
    return { daily: mk("daily"), weekly: mk("weekly"), monthly: mk("monthly"), yearly: mk("yearly") };
}
export function newToken() {
    return randomBytes(16).toString("hex");
}
export function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
export function xpForLevel(level) {
    return Math.round(500 * Math.pow(level, 1.5));
}
export function levelFromXp(xp) {
    let lvl = 1;
    while (xp >= xpForLevel(lvl) && lvl < 200)
        lvl++;
    return lvl;
}
function defaultStats() {
    return {
        hands: 0, showdowns: 0, showdownWins: 0, vpipHands: 0, pfrHands: 0,
        biggestPot: 0, net: 0, netSamples: [], counters: {},
    };
}
export class StateStore {
    profiles = new Map();
    dirty = false;
    saveTimer = null;
    constructor() {
        try {
            mkdirSync(DATA_DIR, { recursive: true });
            const raw = readFileSync(DATA_FILE, "utf8");
            const data = JSON.parse(raw);
            for (const [k, v] of data.profiles) {
                if (!v.stats)
                    v.stats = defaultStats();
                if (!v.stats.counters)
                    v.stats.counters = {};
                if (typeof v.stats.net !== "number")
                    v.stats.net = 0;                 if (!v.achievements)
                    v.achievements = [];
                if (!v.periods)
                    v.periods = freshPeriods();                 this.profiles.set(k, v);
            }
            console.log(`[state] loaded ${this.profiles.size} profiles`);
        }
        catch {
            console.log("[state] fresh state");
        }
        this.saveTimer = setInterval(() => this.flush(), 3000);
    }
    markDirty() {
        this.dirty = true;
    }
    flush() {
        if (!this.dirty)
            return;
        try {
            const profiles = [...this.profiles.entries()].slice(-5000);
            writeFileSync(DATA_FILE, JSON.stringify({ profiles }));
            this.dirty = false;
        }
        catch (e) {
            console.error("[state] flush failed", e);
        }
    }
    getOrCreate(token, nickname, language) {
        const safeLang = sanitizeLanguage(language);
        let p = this.profiles.get(token);
        if (!p) {
            p = {
                token,
                nickname: nickname?.trim().slice(0, 20) || `Player${Math.floor(Math.random() * 9000 + 1000)}`,
                avatar: `av${Math.floor(Math.random() * 8)}`,
                chips: 10000,
                xp: 0,
                level: 1,
                language: safeLang ?? "en",
                lastBonusDate: null,
                bonusStreak: 0,
                lastTopUpAt: 0,
                seasonPoints: 0,
                tournamentsPlayed: 0,
                achievements: [],
                stats: defaultStats(),
                periods: freshPeriods(),
                createdAt: Date.now(),
            };
            this.profiles.set(token, p);
            this.markDirty();
        }
        else if (nickname && nickname.trim()) {
            p.nickname = nickname.trim().slice(0, 20);
            this.markDirty();
        }
        if (safeLang && p.language !== safeLang) {
            p.language = safeLang;
            this.markDirty();
        }
        return p;
    }
    me(p) {
        const next = xpForLevel(p.level);
        const prev = p.level > 1 ? xpForLevel(p.level - 1) : 0;
        const canClaim = p.lastBonusDate !== todayUTC();
        const streakNext = this.nextStreak(p);
        const lastTopUp = Date.now() - p.lastTopUpAt;
        return {
            token: p.token,
            nickname: p.nickname,
            avatar: p.avatar,
            chips: p.chips,
            xp: p.xp,
            level: p.level,
            levelProgress: Math.max(0, Math.min(1, (p.xp - prev) / Math.max(1, next - prev))),
            bonusStreak: p.bonusStreak,
            canClaimDaily: canClaim,
            dailyAmount: this.dailyAmount(streakNext),
            canTopUp: p.chips < 2000 && lastTopUp >= 15 * 60 * 1000,
            topUpAmount: 5000,
            language: p.language,
        };
    }
    nextStreak(p) {
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (p.lastBonusDate === todayUTC())
            return p.bonusStreak;
        if (p.lastBonusDate === yesterday)
            return p.bonusStreak + 1;
        return 1;
    }
    dailyAmount(streak) {
        return Math.min(2000 * Math.max(1, streak), 6000);
    }
    claimDaily(p) {
        if (p.lastBonusDate === todayUTC())
            return null;
        const streak = this.nextStreak(p);
        const amount = this.dailyAmount(streak);
        p.lastBonusDate = todayUTC();
        p.bonusStreak = streak;
        p.chips += amount;
        this.addXp(p, 50);
        this.markDirty();
        return { amount, streak };
    }
    topUp(p) {
        if (p.chips >= 2000)
            return null;
        if (Date.now() - p.lastTopUpAt < 15 * 60 * 1000)
            return null;
        p.lastTopUpAt = Date.now();
        p.chips += 5000;
        this.markDirty();
        return 5000;
    }
    addXp(p, amount) {
        const before = p.level;
        p.xp += amount;
        p.level = levelFromXp(p.xp);
        if (p.level > before) {
            p.stats.counters.levelUps = (p.stats.counters.levelUps ?? 0) + 1;
        }
        this.markDirty();
    }
    addSeasonPoints(p, points) {
        p.seasonPoints += points;
        this.markDirty();
    }

    recordHandResult(p, r) {
        p.stats.net += r.net;
        if ((r.biggestPot ?? r.won) > p.stats.biggestPot)
            p.stats.biggestPot = r.biggestPot ?? r.won;
        const now = r.at ?? Date.now();
        for (const period of ["daily", "weekly", "monthly", "yearly"]) {
            const key = periodKeyOf(period, now);
            const agg = p.periods[period];
            if (!agg) {
                p.periods[period] = { key, net: r.net, hands: 1, wins: r.won > 0 ? 1 : 0, biggestPot: Math.max(0, r.won) };
                continue;
            }
            if (agg.key !== key) {
                agg.key = key;
                agg.net = 0;
                agg.hands = 0;
                agg.wins = 0;
                agg.biggestPot = 0;
            }
            agg.net += r.net;
            agg.hands += 1;
            if (r.won > 0)
                agg.wins += 1;
            if (r.won > agg.biggestPot)
                agg.biggestPot = r.won;
        }
        this.markDirty();
    }
    counter(p, key, by = 1) {
        p.stats.counters[key] = (p.stats.counters[key] ?? 0) + by;
        this.markDirty();
        return p.stats.counters[key];
    }

    checkAchievements(p) {
        const s = p.stats;
        const c = s.counters;
        const unlocked = [];
        const grant = (key, cond) => {
            if (cond && !p.achievements.includes(key)) {
                p.achievements.push(key);
                unlocked.push(key);
            }
        };
        grant("first_win", (c.wins ?? 0) >= 1);
        grant("flush_win", (c.flushWins ?? 0) >= 1);
        grant("boat_plus", (c.boatWins ?? 0) >= 1);
        grant("quads_plus", (c.quadsWins ?? 0) >= 1);
        grant("big_pot_100bb", (c.bigPots ?? 0) >= 1);
        grant("win_72o", (c.hammerWins ?? 0) >= 1);
        grant("showdown_100", s.showdowns >= 100);
        grant("hands_500", s.hands >= 500);
        grant("streak_7", p.bonusStreak >= 7);
        grant("host_10", (c.gamesHosted ?? 0) >= 10);
        grant("gg_50", (c.ggReceived ?? 0) >= 50);
        grant("chat_100", (c.chatMessages ?? 0) >= 100);
        grant("hu_win", (c.huWins ?? 0) >= 1);
        grant("mtt_ko3", (c.mttKos ?? 0) >= 3);
        grant("level_10", p.level >= 10);
        if (unlocked.length)
            this.markDirty();
        return unlocked;
    }
    statsView(p) {
        const hands = Math.max(1, p.stats.hands);
        return {
            hands: p.stats.hands,
            showdowns: p.stats.showdowns,
            showdownWins: p.stats.showdownWins,
            vpip: Math.round((p.stats.vpipHands / hands) * 100),
            pfr: Math.round((p.stats.pfrHands / hands) * 100),
            biggestPot: p.stats.biggestPot,
            netTrend: p.stats.netSamples.slice(-40),
            achievements: p.achievements,
            counters: p.stats.counters,
        };
    }
    leaderboard() {
        const all = [...this.profiles.values()];
        const xp = all
            .filter((p) => p.level > 1 || p.xp > 0)
            .sort((a, b) => b.xp - a.xp)
            .slice(0, 25)
            .map((p) => ({ nickname: p.nickname, avatar: p.avatar, level: p.level, xp: p.xp }));
        const points = all
            .filter((p) => p.seasonPoints > 0)
            .sort((a, b) => b.seasonPoints - a.seasonPoints)
            .slice(0, 25)
            .map((p) => ({ nickname: p.nickname, avatar: p.avatar, points: p.seasonPoints, played: p.tournamentsPlayed }));
        return { xp, points };
    }

    leaderboardRows(period, now = Date.now()) {
        const rows = [];
        for (const p of this.profiles.values()) {
            if (p.nickname.startsWith("bot:"))
                continue;
            if (period === "forever") {
                if (p.stats.hands === 0)
                    continue;
                rows.push({
                    nickname: p.nickname,
                    avatar: p.avatar,
                    net: p.stats.net ?? 0,
                    hands: p.stats.hands,
                    wins: p.stats.counters.wins ?? 0,
                    biggestPot: p.stats.biggestPot,
                });
            }
            else {
                const agg = p.periods?.[period];
                if (!agg || agg.key !== periodKeyOf(period, now) || agg.hands === 0)
                    continue;
                rows.push({
                    nickname: p.nickname,
                    avatar: p.avatar,
                    net: agg.net,
                    hands: agg.hands,
                    wins: agg.wins,
                    biggestPot: agg.biggestPot,
                });
            }
        }
        rows.sort((a, b) => b.net - a.net || b.wins - a.wins || b.biggestPot - a.biggestPot || a.nickname.localeCompare(b.nickname));
        return rows.slice(0, 50);
    }
    leaderboardPeriodKeys(now = Date.now()) {
        return {
            daily: dayKey(now),
            weekly: weekKey(now),
            monthly: monthKey(now),
            yearly: yearKey(now),
            forever: "all-time",
        };
    }

    leaderboardData() {
        const base = this.leaderboard();
        return {
            ...base,
            periods: {
                daily: this.leaderboardRows("daily"),
                weekly: this.leaderboardRows("weekly"),
                monthly: this.leaderboardRows("monthly"),
                yearly: this.leaderboardRows("yearly"),
                forever: this.leaderboardRows("forever"),
            },
            periodKeys: this.leaderboardPeriodKeys(),
        };
    }
    dispose() {
        if (this.saveTimer)
            clearInterval(this.saveTimer);
        this.flush();
    }
}
