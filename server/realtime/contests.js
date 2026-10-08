import { randomBytes } from "node:crypto";
import { randomSeed, MAX_PLAYERS, TIMER_CHOICES } from "./table.js";
import { botId } from "./bots.js";
import { seasonPointsFor } from "./store.js";

export const ROUND_CHOICES = [3, 5, 10];
export const LIMIT_CHOICES = [8, 16, 32, 64];
export const CONTEST_FIRST_ROUND_MS = 5000;
export const CONTEST_NEXT_ROUND_MS = 10000;
export const DEMO_CONTEST_ID = "5a".repeat(20);

export function isContestId(x) {
    return typeof x === "string" && /^[0-9a-f]{40}$/.test(x);
}

export function sanitizeContestOptions(raw = {}) {
    return {
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : "Poker Squares contest",
        rounds: ROUND_CHOICES.includes(Number(raw.rounds)) ? Number(raw.rounds) : 5,
        maxPlayers: LIMIT_CHOICES.includes(Number(raw.maxPlayers)) ? Number(raw.maxPlayers) : 16,
        startMode: raw.startMode === "manual" ? "manual" : "immediate",
        timerSec: TIMER_CHOICES.includes(Number(raw.timerSec)) ? Number(raw.timerSec) : 15,
        botCount: Math.max(0, Math.min(7, Number.parseInt(raw.botCount, 10) || 0)),
        botDifficulty: ["easy", "normal", "hard"].includes(raw.botDifficulty) ? raw.botDifficulty : "normal",
    };
}

// Total points first, then the best single round. Equal on both shares a place.
export function rankStandings(entrants) {
    const rows = entrants.slice().sort((a, b) => b.total - a.total || b.best - a.best || a.username.localeCompare(b.username));
    let place = 0;
    let prev = null;
    rows.forEach((r, i) => {
        const key = `${r.total}|${r.best}`;
        if (key !== prev) {
            place = i + 1;
            prev = key;
        }
        r.place = place;
    });
    return rows;
}

// Runs every contest: who has joined, which tables they play at, and the
// shared deck each round so every table gets the same cards.
export class ContestRunner {
    constructor({ timers, tables, store, notify, bots }) {
        this.timers = timers;
        this.tables = tables;
        this.store = store;
        this.notify = notify;
        this.bots = bots;
        this.contests = new Map();
    }
    get(id) {
        return this.contests.get(id) ?? null;
    }
    event(c, type, params = {}) {
        c.events.push({ type, params, at: this.timers.now() });
        if (c.events.length > 120)
            c.events.splice(0, 20);
    }
    create(host, raw, { id } = {}) {
        const opts = sanitizeContestOptions(raw);
        const c = {
            id: id ?? randomBytes(20).toString("hex"),
            ...opts,
            hostId: host ? host.id : null,
            status: "waiting",
            roundNo: 0,
            roundsDone: new Set(),
            entrants: new Map(),
            tables: [],
            events: [],
            createdAt: this.timers.now(),
            startedAt: null,
            completedAt: null,
            nextRoundAt: 0,
            timer: null,
            standings: null,
        };
        this.contests.set(c.id, c);
        this.event(c, "room_created");
        if (host)
            this.addEntrant(c, { id: host.id, username: host.username });
        this.addBots(c, opts.botCount, opts.botDifficulty);
        this.maybeAutoStart(c);
        return c;
    }
    addBots(c, count, skill = c.botDifficulty) {
        let added = 0;
        for (let i = 0; i < count; i++) {
            if (c.entrants.size >= c.maxPlayers)
                break;
            const name = this.bots.pickName([...c.entrants.values()].map((e) => e.username));
            this.addEntrant(c, { id: botId(), username: name, isBot: true, skill });
            added++;
        }
        if (added)
            this.event(c, "bots_added", { n: added });
        return added;
    }
    lateJoinOpen(c) {
        return c.status === "waiting" || (c.status === "active" && c.roundNo < 2);
    }
    addEntrant(c, { id, username, isBot = false, skill = "normal" }) {
        const e = { id, username, isBot, skill, total: 0, best: 0, rounds: [], tableCode: null, place: null };
        c.entrants.set(id, e);
        if (c.status === "active")
            this.seat(c, e);
        if (!isBot)
            this.event(c, "player_joined", { name: username, n: c.entrants.size });
        return e;
    }
    join(c, user) {
        if (c.entrants.has(user.id))
            return { ok: false, error: "already_registered" };
        if (c.status === "completed" || c.status === "cancelled")
            return { ok: false, error: "room_closed" };
        if (!this.lateJoinOpen(c))
            return { ok: false, error: "contest_running" };
        if (c.entrants.size >= c.maxPlayers)
            return { ok: false, error: "contest_full" };
        this.addEntrant(c, user);
        if (!c.hostId)
            c.hostId = user.id;
        this.maybeAutoStart(c);
        this.changed(c);
        return { ok: true };
    }
    leave(c, userId) {
        const e = c.entrants.get(userId);
        if (!e)
            return { ok: false, error: "not_registered" };
        if (c.status !== "waiting")
            return { ok: false, error: "cannot_leave" };
        c.entrants.delete(userId);
        this.event(c, "player_left", { name: e.username });
        if (c.hostId === userId) {
            const next = [...c.entrants.values()].find((x) => !x.isBot);
            c.hostId = next ? next.id : null;
        }
        this.changed(c);
        return { ok: true };
    }
    removeBot(c, id) {
        const e = c.entrants.get(id);
        if (!e || !e.isBot || c.status !== "waiting")
            return false;
        c.entrants.delete(id);
        this.event(c, "bot_removed", { name: e.username });
        this.changed(c);
        return true;
    }
    maybeAutoStart(c) {
        if (c.status === "waiting" && c.startMode === "immediate" && c.entrants.size >= 2 && [...c.entrants.values()].some((e) => !e.isBot))
            this.start(c);
    }
    start(c) {
        if (c.status !== "waiting")
            return { ok: false, error: "already_started" };
        if (c.entrants.size < 2)
            return { ok: false, error: "need_two_players" };
        c.status = "active";
        c.startedAt = this.timers.now();
        for (const e of c.entrants.values())
            this.seat(c, e);
        this.event(c, "contest_started", { n: c.entrants.size });
        this.scheduleRound(c, CONTEST_FIRST_ROUND_MS);
        this.changed(c);
        return { ok: true };
    }
    // Fill tables of up to 8, opening a new one when all are full.
    seat(c, e) {
        if (e.tableCode && this.tables.get(e.tableCode))
            return;
        let table = c.tables.map((code) => this.tables.get(code)).find((t) => t && !t.isFull());
        if (!table) {
            table = this.tables.createContestTable(c, `${c.name} · ${c.tables.length + 1}`);
            c.tables.push(table.code);
            this.event(c, "table_created", { table: table.code });
        }
        table.addPlayer({ id: e.id, username: e.username, isBot: e.isBot, skill: e.skill });
        e.tableCode = table.code;
    }
    scheduleRound(c, ms) {
        if (c.timer)
            this.timers.cancel(c.timer);
        c.nextRoundAt = this.timers.now() + ms;
        c.timer = this.timers.schedule(() => {
            c.timer = null;
            this.startRound(c);
        }, ms);
    }
    startRound(c) {
        if (c.status !== "active")
            return;
        c.roundNo += 1;
        c.nextRoundAt = 0;
        c.roundsDone = new Set();
        const seed = randomSeed();
        let started = 0;
        for (const code of c.tables) {
            const t = this.tables.get(code);
            if (t && t.startRound(seed))
                started++;
            else
                c.roundsDone.add(code);
        }
        this.event(c, "round_started", { round: c.roundNo, of: c.rounds });
        this.changed(c);
        if (started === 0)
            this.finishRound(c);
    }
    // Called by the table registry when a contest table finishes a round.
    tableRoundDone(c, table, results) {
        if (c.status !== "active")
            return;
        for (const r of results) {
            const e = c.entrants.get(r.id);
            if (!e)
                continue;
            e.total += r.points;
            e.rounds.push(r.points);
            if (r.points > e.best)
                e.best = r.points;
        }
        c.roundsDone.add(table.code);
        if (c.tables.every((code) => c.roundsDone.has(code)))
            this.finishRound(c);
        else
            this.changed(c);
    }
    finishRound(c) {
        this.event(c, "round_finished", { round: c.roundNo, of: c.rounds });
        if (c.roundNo >= c.rounds)
            this.complete(c);
        else
            this.scheduleRound(c, CONTEST_NEXT_ROUND_MS);
        this.changed(c);
    }
    complete(c) {
        c.status = "completed";
        c.completedAt = this.timers.now();
        const standings = rankStandings([...c.entrants.values()]);
        const humans = standings.filter((e) => !e.isBot);
        c.standings = standings.map((e) => ({ ...e, seasonPoints: e.isBot ? 0 : seasonPointsFor(e.place, standings.length) }));
        this.store?.recordContest(c.id, c.standings.filter((e) => !e.isBot).map((e) => ({ id: e.id, username: e.username, place: e.place, total: e.total, seasonPoints: e.seasonPoints })));
        if (standings[0])
            this.event(c, "winner", { name: standings[0].username });
        this.event(c, "contest_completed", { n: humans.length });
        for (const code of c.tables)
            this.tables.get(code)?.pause(true);
    }
    cancel(c) {
        if (c.status !== "waiting")
            return { ok: false, error: "already_started" };
        c.status = "cancelled";
        this.event(c, "room_cancelled");
        this.changed(c);
        return { ok: true };
    }
    changed(c) {
        this.notify(c);
    }
    listFor(userId) {
        return [...this.contests.values()]
            .filter((c) => c.hostId === userId || c.entrants.has(userId))
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 30)
            .map((c) => this.publicView(c, userId));
    }
    publicView(c, viewerId = null) {
        const standings = c.standings ?? rankStandings([...c.entrants.values()]);
        const me = viewerId ? c.entrants.get(viewerId) : null;
        const winner = c.status === "completed" && standings[0] ? { username: standings[0].username } : null;
        return {
            roomId: c.id,
            name: c.name,
            status: c.status,
            rounds: c.rounds,
            roundNo: c.roundNo,
            maxPlayers: c.maxPlayers,
            startMode: c.startMode,
            timerSec: c.timerSec,
            isHost: !!viewerId && viewerId === c.hostId,
            hostName: c.hostId ? c.entrants.get(c.hostId)?.username ?? null : null,
            lateJoinOpen: this.lateJoinOpen(c) && c.entrants.size < c.maxPlayers,
            nextRoundAt: c.nextRoundAt,
            serverNow: this.timers.now(),
            createdAt: c.createdAt,
            startedAt: c.startedAt,
            completedAt: c.completedAt,
            registered: !!me,
            myTableCode: me ? me.tableCode : null,
            winner,
            standings: standings.map((e) => ({
                id: e.isBot ? null : e.id,
                botId: e.isBot ? e.id : null,
                username: e.username,
                isBot: e.isBot,
                total: e.total,
                best: e.best,
                rounds: e.rounds.length,
                place: e.place,
                self: !!viewerId && e.id === viewerId,
                seasonPoints: e.seasonPoints ?? null,
                tableCode: e.tableCode,
            })),
            tables: c.tables.map((code) => {
                const t = this.tables.get(code);
                return { code, players: t ? t.players.size : 0 };
            }),
            events: c.events.slice(-40),
        };
    }
    dispose() {
        for (const c of this.contests.values())
            if (c.timer)
                this.timers.cancel(c.timer);
    }
}
