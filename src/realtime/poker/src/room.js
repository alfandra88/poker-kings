import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { ShowdownTable } from "../../../lib/poker-engine/showdown.js";

export const ROOM_ID_LENGTH = 40;
const ROOM_ID_RE = /^[0-9a-f]{40}$/;

export const MAX_SEATS_PER_TABLE = 8;
const MAX_PLAYERS = 200;

const UNLIMITED_CAP = 10_000;
const MIN_START_DELAY_MS = 30_000; const MAX_START_DELAY_MS = 30 * 86_400_000; const STARTING_GRACE_MS = 6_000;
const NEXT_HAND_DELAY_MS = 1_800;
const BALANCE_MAX_MOVES = 200; const EVENT_LOG_CAP = 400;
const SAVE_FILE = "rooms.json";
const START_MODES = ["immediate", "when_full", "scheduled", "scheduled_min", "manual"];
const FALLBACKS = ["cancel", "extend", "start_anyway", "keep_waiting"];

const TRANSITIONS = {
    waiting: ["starting", "cancelled"],
    scheduled: ["starting", "cancelled"],
    starting: ["active", "cancelled"],
    active: ["final_table", "completed", "cancelled"],
    final_table: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
};
export function realTimers() {
    return {
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: (h) => clearTimeout(h),
        now: () => Date.now(),
    };
}
const num = (v, def) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : def;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

export function sanitizeRoomConfig(raw) {
    if (!raw || typeof raw !== "object")
        return { ok: false, error: "bad_config" };
    const modeRaw = typeof raw.startMode === "string" ? raw.startMode : "immediate";
    const startMode = START_MODES.includes(modeRaw) ? modeRaw : "immediate";
    const fallbackRaw = typeof raw.fallback === "string" ? raw.fallback : "keep_waiting";
    const fallback = FALLBACKS.includes(fallbackRaw) ? fallbackRaw : "keep_waiting";
    const variant = raw.variant === "plo4" ? "plo4" : "nlhe";
    const unlimited = raw.unlimited === true;
    const maxPlayers = unlimited
        ? UNLIMITED_CAP
        : clamp(num(raw.maxPlayers, 8), 2, MAX_PLAYERS);
    const seatsPerTable = clamp(num(raw.seatsPerTable, MAX_SEATS_PER_TABLE), 2, MAX_SEATS_PER_TABLE);
    const turnSec = clamp(num(raw.turnSec, 15), 5, 120);     const extendSec = clamp(num(raw.extendSec, 600), 60, 86_400);
    let requiredPlayers = null;
    let minPlayers = null;
    let startsAt = null;
    if (startMode === "when_full") {
        const req = clamp(num(raw.requiredPlayers, maxPlayers), 2, maxPlayers);
        requiredPlayers = Math.min(req, maxPlayers);
    }
    if (startMode === "scheduled_min") {
        minPlayers = clamp(num(raw.minPlayers, 2), 2, maxPlayers);
    }
    if (startMode === "scheduled" || startMode === "scheduled_min") {
        const now = Date.now();
        const at = num(raw.startsAt, now + 60 * 60_000);
        startsAt = clamp(at, now + MIN_START_DELAY_MS, now + MAX_START_DELAY_MS);
    }
    const name = (typeof raw.name === "string" && raw.name.trim().slice(0, 40)) || "Poker Kings Tournament";
    return {
        ok: true,
        cfg: {
            name,
            variant,
            maxPlayers,
            seatsPerTable,
            turnSec,
            startMode,
            requiredPlayers,
            minPlayers,
            startsAt,
            fallback,
            extendSec,
            lateJoin: !!raw.lateJoin,
            unlimited,
        },
    };
}
export class Room {
    roomId;
    name;
    cfg;
    status = "waiting";
    hostId;
    entrants = new Map();
    tables = [];
    results = [];
    createdAt = Date.now();
    startedAt = null;
    completedAt = null;
    events = [];
    extendCount = 0;
    hooks;
    store;
    dirty = false;
    hStart = null;
    hFallback = null;
    hStarting = null;
    startingAt = 0;
    constructor(roomId, cfg, host, hooks, store) {
        this.roomId = roomId;
        this.name = cfg.name;
        this.cfg = cfg;
        this.hostId = host.token;
        this.hooks = hooks;
        this.store = store;
        this.status = cfg.startMode === "scheduled" || cfg.startMode === "scheduled_min" ? "scheduled" : "waiting";
    }
    static isRoomId(x) {
        return typeof x === "string" && ROOM_ID_RE.test(x);
    }

    static generateId(taken) {
        for (let attempt = 0; attempt < 8; attempt++) {
            const id = randomBytes(20).toString("hex");             if (!taken.has(id))
                return id;
        }
        throw new Error("room_id_generation_failed");
    }
    transition(next) {
        const allowed = TRANSITIONS[this.status];
        if (!allowed.includes(next)) {
            this.log("invalid_transition", { from: this.status, to: next });
            return { ok: false };
        }
        this.status = next;
        this.markDirty();
        this.push();
        return { ok: true };
    }
    log(type, params) {
        this.events.push({ ts: Date.now(), type, params });
        if (this.events.length > EVENT_LOG_CAP)
            this.events.splice(0, 120);
        this.markDirty();
    }
    markDirty() {
        this.dirty = true;
    }
    consumeDirty() {
        const d = this.dirty;
        this.dirty = false;
        return d;
    }
    push() {
        try {
            this.hooks.broadcastRoom(this.roomId);
        }
        catch {
            // broadcast is best-effort — never let UI pushes break game state
        }
    }

    joinableStatus() {
        if (this.status === "waiting" || this.status === "scheduled")
            return true;
        if (this.status === "active" || this.status === "final_table")
            return this.cfg.lateJoin;
        return false;     }

    join(profile) {
        if (!profile || !profile.token)
            return { ok: false, error: "bad_request" };
        if (this.entrants.has(profile.token))
            return { ok: false, error: "already_registered" };
        if (!this.joinableStatus()) {
            return { ok: false, error: this.status === "completed" || this.status === "cancelled" ? "room_closed" : "tournament_running" };
        }
        const totalRegistered = this.entrants.size;
        if (totalRegistered >= this.cfg.maxPlayers)
            return { ok: false, error: "tournament_full" };
        const entrant = {
            profile,
            isBot: false,
            botDifficulty: "normal",
            status: "registered",
            finalRank: null,
            points: 0,
            joinedAt: Date.now(),
            tableCode: null,
        };
        this.entrants.set(profile.token, entrant);
        this.log("player_joined", { name: profile.nickname, n: this.entrants.size });
        if (this.status === "active" || this.status === "final_table") {
            const seated = this.seatLateJoin(entrant);
            if (!seated) {
                this.entrants.delete(profile.token);
                this.push();
                return { ok: false, error: "tournament_full" };
            }
            this.log("late_join_seated", { name: profile.nickname, table: entrant.tableCode ?? "?" });
        }
        this.push();
        this.evaluateAutoStart();
        return { ok: true };
    }

    leave(profile) {
        const e = profile ? this.entrants.get(profile.token) : undefined;
        if (!e)
            return { ok: false, error: "not_registered" };
        if (this.status !== "waiting" && this.status !== "scheduled")
            return { ok: false, error: "cannot_leave" };
        this.entrants.delete(profile.token);
        this.log("player_left", { name: profile.nickname, n: this.entrants.size });
        this.push();
        return { ok: true };
    }

    evaluateAutoStart() {
        if (this.status !== "waiting")
            return;
        if (this.cfg.startMode === "when_full") {
            const required = this.cfg.requiredPlayers ?? this.cfg.maxPlayers;
            if (this.entrants.size >= required)
                this.beginStart("required_players_reached");
            return;
        }
        if (this.cfg.startMode === "immediate" && this.entrants.size >= 2) {
            this.beginStart("immediate_pair_reached");
        }
    }

    startByHost(token) {
        if (token !== this.hostId)
            return { ok: false, error: "not_host" };
        if (this.status !== "waiting" && this.status !== "scheduled")
            return { ok: false, error: "already_started" };
        if (this.entrants.size < 2)
            return { ok: false, error: "need_two_players" };
        this.clearTimers();
        return this.beginStart("host_start");
    }

    cancelByHost(token) {
        if (token !== this.hostId)
            return { ok: false, error: "not_host" };
        if (this.status === "active" || this.status === "final_table" || this.status === "completed" || this.status === "cancelled") {
            return { ok: false, error: "cannot_cancel" };
        }
        this.clearTimers();
        this.transition("cancelled");
        this.completedAt = Date.now();
        this.log("room_cancelled", {});
        this.push();
        this.markDirty();
        return { ok: true };
    }

    beginStart(reason) {
        if (this.status !== "waiting" && this.status !== "scheduled")
            return { ok: false, error: "already_started" };
        if (this.entrants.size < 2) {
            this.status = this.cfg.startMode === "scheduled" || this.cfg.startMode === "scheduled_min" ? "scheduled" : "waiting";
            return { ok: false, error: "need_two_players" };
        }
        this.clearTimers();
        this.transition("starting");
        this.startedAt = Date.now();
        this.startingAt = Date.now();
        this.log("tournament_starting", { reason });
        this.hStarting = realTimers().schedule(() => {
            try {
                this.seatAll();
            }
            catch (err) {
                console.error(`[room ${this.roomId}] seating failed`, err);
                this.transition("cancelled");
                this.completedAt = Date.now();
                this.push();
                return;
            }
            this.transition("active");
            this.log("tournament_started", { n: this.entrants.size });
            if (this.tables.length === 1) {
                this.transition("final_table");
                this.log("final_table", {});
            }
            this.kickOffTables();
            this.push();
            this.markDirty();
        }, STARTING_GRACE_MS);
        return { ok: true };
    }

    onScheduledTime() {
        if (this.status !== "scheduled")
            return;
        const eligible = [...this.entrants.values()].filter((e) => e.status === "registered" || e.status === "active");
        if (this.cfg.startMode === "scheduled_min") {
            const min = this.cfg.minPlayers ?? 2;
            if (eligible.length < min) {
                this.applyFallback(eligible.length, min);
                return;
            }
            this.beginStart("scheduled_min_reached");
            return;
        }
        if (eligible.length < 2) {
            this.applyFallback(eligible.length, 2);
            return;
        }
        this.beginStart("scheduled_time");
    }
    applyFallback(current, required) {
        switch (this.cfg.fallback) {
            case "cancel": {
                this.clearTimers();
                this.transition("cancelled");
                this.completedAt = Date.now();
                this.log("room_cancelled", { reason: "not_enough_players" });
                this.push();
                return;
            }
            case "extend": {
                this.extendCount += 1;
                const base = this.cfg.startsAt ?? Date.now();
                const next = Math.max(Date.now(), base) + this.cfg.extendSec * 1000;
                this.cfg.startsAt = next;
                this.log("start_extended", { until: next, n: current });
                this.armStartTimer();
                this.push();
                return;
            }
            case "start_anyway": {
                if (current >= 2) {
                    this.beginStart("start_anyway");
                }
                else {
                    this.log("start_postponed", { n: current, need: required });
                    this.armFallbackPoll();
                }
                return;
            }
            case "keep_waiting":
            default: {
                this.log("start_postponed", { n: current, need: required });
                this.armFallbackPoll();
                return;
            }
        }
    }

    armFallbackPoll() {
        if (this.hFallback)
            realTimers().cancel(this.hFallback);
        this.hFallback = realTimers().schedule(() => {
            if (this.status !== "scheduled" && this.status !== "waiting")
                return;
            if (this.cfg.startMode === "when_full") {
                this.evaluateAutoStart();
                return;
            }
            const eligible = [...this.entrants.values()].filter((e) => e.status === "registered");
            const min = this.cfg.startMode === "scheduled_min" ? this.cfg.minPlayers ?? 2 : 2;
            if (eligible.length >= min)
                this.beginStart("min_reached_late");
            else
                this.armFallbackPoll();
        }, 30_000);
    }
    armStartTimer() {
        if (this.hStart)
            realTimers().cancel(this.hStart);
        if (this.cfg.startsAt === null)
            return;
        const delay = Math.max(250, this.cfg.startsAt - Date.now());
        this.hStart = realTimers().schedule(() => this.onScheduledTime(), delay);
    }
    clearTimers() {
        for (const h of [this.hStart, this.hFallback, this.hStarting]) {
            if (h)
                realTimers().cancel(h);
        }
        this.hStart = this.hFallback = this.hStarting = null;
    }
    addBots(count, difficulty) {
        if (this.status !== "waiting" && this.status !== "scheduled")
            return { ok: false, error: "already_started" };
        const want = clamp(count, 1, 50);
        const freeTotal = this.cfg.maxPlayers - this.entrants.size;
        if (freeTotal <= 0)
            return { ok: false, error: "tournament_full" };
        const n = Math.min(want, freeTotal);
        let added = 0;
        for (let i = 0; i < n; i++) {
            const token = `bot:${randomBytes(4).toString("hex")}`;
            const profile = this.makeBotProfile(token);
            this.entrants.set(token, {
                profile,
                isBot: true,
                botDifficulty: difficulty,
                status: "registered",
                finalRank: null,
                points: 0,
                joinedAt: Date.now(),
                tableCode: null,
            });
            added++;
        }
        if (added > 0) {
            this.log("bots_added", { n: added });
            this.push();
            this.evaluateAutoStart();
        }
        return { ok: true, added };
    }
    removeBot(byToken, playerId) {
        if (byToken !== this.hostId)
            return { ok: false, error: "not_host" };
        if (this.status !== "waiting" && this.status !== "scheduled")
            return { ok: false, error: "already_started" };
        const e = this.entrants.get(playerId);
        if (!e || !e.isBot)
            return { ok: false, error: "not_found" };
        this.entrants.delete(playerId);
        this.log("bot_removed", { name: e.profile.nickname });
        this.push();
        return { ok: true };
    }

    makeBotProfile(token) {
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const names = ["AceHunter", "RiverRat", "SlowrollSam", "Bluffy", "TightTed", "ManiacMo", "SneakyPete", "LuckyLucy"];
        return {
            token,
            nickname: `${pick(names)}${Math.floor(Math.random() * 90 + 10)}`,
            avatar: `av${Math.floor(Math.random() * 8)}`,
        };
    }
    makeTableConfig(index) {
        return {
            name: `${this.name} · T${index + 1}`,
            variant: this.cfg.variant,
            mode: "tournament",
            maxSeats: clamp(this.cfg.seatsPerTable, 2, MAX_SEATS_PER_TABLE),
            actionTimerSec: this.cfg.turnSec,
            timeBankSec: 15,
            approveJoin: false,
            // PRIVACY (hard rule): spectators never see hole cards (see registry.sanitizeConfig).
            spectatorCards: false,
            botDifficulty: "normal",
            botsYieldSeats: false, // room bots are real entrants — they never yield
            noPass: true, // tournaments always end in a showdown
        };
    }

    seatAll() {
        const active = [...this.entrants.values()].filter((e) => e.status === "registered" || e.status === "active");
        const shuffled = [...active].sort(() => Math.random() - 0.5);
        const perTable = clamp(this.cfg.seatsPerTable, 2, MAX_SEATS_PER_TABLE);
        const tableCount = Math.max(1, Math.ceil(shuffled.length / perTable));
        const buckets = Array.from({ length: tableCount }, () => []);
        shuffled.forEach((e, i) => buckets[i % tableCount].push(e));
        for (let i = 0; i < tableCount; i++) {
            const cfg = this.makeTableConfig(i);
            const code = genTableCode();
            const first = buckets[i][0];
            if (!first)
                continue;
            const table = new ShowdownTable(code, cfg, this.tableDeps(code), sitOf(first.profile));
            table.tournamentId = this.roomId;
            this.tables.push(table);
            this.hooks.registerTable(table, this.hostId);
            for (const e of buckets[i]) {
                const okSeat = table.sitDownFirstFree(sitOf(e.profile));
                if (okSeat) {
                    e.status = "active";
                    e.tableCode = code;
                    if (e.isBot)
                        this.attachBotDriver(code, e);
                }
                else {
                    const alt = this.tables.find((t) => t.seatedPlayers().length < t.seats.length);
                    if (alt && alt.sitDownFirstFree(sitOf(e.profile))) {
                        e.status = "active";
                        e.tableCode = alt.code;
                        if (e.isBot)
                            this.attachBotDriver(alt.code, e);
                    }
                }
            }
            this.log("table_created", { table: code, n: buckets[i].length });
            this.hooks.broadcastTableState(code);
        }
    }
    attachBotDriver(code, e) {
        try {
            this.hooks.bots.attachBot(code, e.profile.token, e.botDifficulty);
        }
        catch (err) {
            console.error(`[room ${this.roomId}] bot driver attach failed`, err);
        }
    }

    seatLateJoin(e) {
        const withSpace = this.tables
            .filter((t) => t.seatedPlayers().length < t.seats.length)
            .sort((a, b) => a.seatedPlayers().length - b.seatedPlayers().length);
        const target = withSpace[0];
        if (!target)
            return false;
        const ok = target.sitDownFirstFree(sitOf(e.profile));
        if (!ok)
            return false;
        e.status = "active";
        e.tableCode = target.code;
        this.hooks.broadcastTableState(target.code);
        return true;
    }
    tableDeps(code) {
        return {
            timers: realTimers(),
            random: () => randomBytes(4).readUInt32BE(0) / 4294967296,
            sha256: () => "", // room tables publish the hash via events; no extra service needed
            broadcast: (ev) => {
                this.hooks.broadcast(code, ev);
                try {
                    this.hooks.bots.notifyEvent(code, ev);
                }
                catch {
                    // bot loop must never break the hand pipeline
                }
            },
            onStateDirty: () => this.hooks.broadcastTableState(code),
            onPlayersLeft: (players) => {
                for (const p of players) {
                    const e = this.entrants.get(p.playerId);
                    if (e && e.status === "active")
                        this.eliminate(e, "forfeit");
                }
            },
            onPayout: () => { },
            onHandEnd: () => {
                this.checkRebalance();
                this.scheduleNextHandOnTable(code);
            },
            // 3 strikes = out of the tournament. Rank = how many were still in.
            onStrike: ({ playerId }) => {
                const e = this.entrants.get(playerId);
                if (e && e.status === "active")
                    this.eliminate(e, "strikes");
            },
        };
    }

    scheduleNextHandOnTable(code) {
        if (this.status !== "active" && this.status !== "final_table")
            return;
        const table = this.tables.find((t) => t.code === code);
        if (!table || table.closed || table.handActive)
            return;
        const activeHere = [...this.entrants.values()].filter((e) => e.status === "active" && e.tableCode === code);
        if (activeHere.length >= 2)
            table.scheduleNextHand(NEXT_HAND_DELAY_MS);
    }

    eliminate(e, reason) {
        if (e.status !== "active")
            return;
        const activeBefore = [...this.entrants.values()].filter((x) => x.status === "active").length;
        e.status = "eliminated";
        e.finalRank = Math.max(1, activeBefore);
        e.reason = reason;
        this.log("player_eliminated", { name: e.profile.nickname, rank: e.finalRank, total: this.entrants.size });
        if (e.tableCode) {
            const table = this.tables.find((t) => t.code === e.tableCode);
            if (table) {
                try {
                    table.removePlayer(e.profile.token);
                }
                catch {
                    // seat already gone — nothing to clean up
                }
                if (e.isBot) {
                    try {
                        this.hooks.bots.removeBot(e.tableCode, e.profile.token);
                    }
                    catch {
                        // driver may not exist for restored rooms — harmless
                    }
                }
                this.hooks.broadcastTableState(e.tableCode);
                this.scheduleNextHandOnTable(e.tableCode);
            }
        }
        if (!e.isBot) {
            this.hooks.toastProfile(e.profile.token, {
                kind: "info",
                i18n: { key: "toast.eliminated", params: { rank: e.finalRank, total: this.entrants.size } },
            });
        }
        this.checkRebalance();
        this.maybeFinish();
    }

    checkRebalance() {
        if (this.status !== "active" && this.status !== "final_table")
            return;
        for (const t of [...this.tables]) {
            if (t.seatedPlayers().length === 0) {
                this.closeTable(t, "empty");
            }
        }
        if (this.tables.length === 1 && this.status === "active") {
            this.transition("final_table");
            this.log("final_table", {});
        }
        if (this.tables.length <= 1) {
            this.push();
            return;
        }
        const perTable = clamp(this.cfg.seatsPerTable, 2, MAX_SEATS_PER_TABLE);
        const activeCount = [...this.entrants.values()].filter((e) => e.status === "active").length;
        const targetTables = Math.max(1, Math.ceil(activeCount / perTable));
        let moves = 0;
        while (moves < BALANCE_MAX_MOVES) {
            const sizes = this.tables.map((t) => t.seatedPlayers().length);
            if (sizes.length <= 1)
                break;
            const maxSize = Math.max(...sizes);
            const minSize = Math.min(...sizes);
            if (this.tables.length > targetTables) {
                const breakable = [...this.tables]
                    .filter((t) => !t.handActive)
                    .sort((a, b) => a.seatedPlayers().length - b.seatedPlayers().length)[0];
                if (!breakable)
                    break;                 const victim = this.lowestPointsPlayer(breakable);
                if (!victim)
                    break;
                const dest = this.smallestTableWithSpace(breakable.code);
                if (!dest)
                    break;
                this.movePlayer(breakable, dest, victim);
                moves++;
                if (breakable.seatedPlayers().length === 0)
                    this.closeTable(breakable, "broken");
                continue;
            }
            if (maxSize - minSize >= 2) {
                const src = [...this.tables]
                    .filter((t) => t.seatedPlayers().length === maxSize && !t.handActive)
                    .sort((a, b) => a.code.localeCompare(b.code))[0];
                if (!src)
                    break;                 const dest = this.smallestTableWithSpace(src.code);
                if (!dest)
                    break;
                const victim = this.lowestPointsPlayer(src);
                if (!victim)
                    break;
                this.movePlayer(src, dest, victim);
                moves++;
                continue;
            }
            break;         }
        if (this.tables.length === 1 && this.status === "active") {
            this.transition("final_table");
            this.log("final_table", {});
        }
        if (moves > 0) {
            this.log("tables_balanced", { moves });
            this.push();
            this.markDirty();
        }
    }
    lowestPointsPlayer(table) {
        let pick = null;
        for (const s of table.seats) {
            if (!s)
                continue;
            const pid = s.playerId;
            if (!pid || pid.startsWith("leaving:"))
                continue;
            if (!pick || s.points < pick.points || (s.points === pick.points && s.seatId < pick.seatId)) {
                pick = { playerId: pid, nickname: s.nickname, avatar: s.avatar, points: s.points, seatId: s.seatId };
            }
        }
        return pick;
    }
    smallestTableWithSpace(excludeCode) {
        const candidates = this.tables
            .filter((t) => t.code !== excludeCode && t.seatedPlayers().length < t.seats.length)
            .sort((a, b) => a.seatedPlayers().length - b.seatedPlayers().length || a.code.localeCompare(b.code));
        return candidates[0] ?? null;
    }
    movePlayer(src, dest, victim) {
        try {
            src.removePlayer(victim.playerId);
        }
        catch {
            return;         }
        const ok = dest.sitDownFirstFree({ playerId: victim.playerId, nickname: victim.nickname, avatar: victim.avatar });
        if (!ok) {
            src.sitDownFirstFree({ playerId: victim.playerId, nickname: victim.nickname, avatar: victim.avatar });
            return;
        }
        // Carry the player's points and strikes across the table move so the
        // tournament standings stay continuous.
        const seat = dest.seatOf(victim.playerId);
        const oldSeat = src.seatOf(victim.playerId);
        if (seat) {
            seat.points = oldSeat?.points ?? 0;
            seat.strikes = oldSeat?.strikes ?? 0;
        }
        const e = this.entrants.get(victim.playerId);
        if (e) {
            e.tableCode = dest.code;
            if (e.isBot) {
                try {
                    this.hooks.bots.removeBot(src.code, victim.playerId);
                    this.hooks.bots.attachBot(dest.code, victim.playerId, e.botDifficulty);
                }
                catch {
                    // bot driver problems must never break balancing
                }
            }
        }
        this.log("player_moved", { name: victim.nickname, from: src.code, to: dest.code });
        this.hooks.toastProfile(victim.playerId, {
            kind: "info",
            i18n: { key: "toast.table_moved", params: { table: dest.code } },
        });
        this.hooks.broadcastTableState(src.code);
        this.hooks.broadcastTableState(dest.code);
        this.scheduleNextHandOnTable(src.code);
        this.scheduleNextHandOnTable(dest.code);
    }
    closeTable(t, reason) {
        try {
            t.close();
        }
        catch {
            // already closed
        }
        this.hooks.unregisterTable(t.code);
        this.tables = this.tables.filter((x) => x.code !== t.code);
        this.log("table_closed", { table: t.code });
    }
    kickOffTables() {
        for (const t of this.tables) {
            if (!t.handActive)
                t.scheduleNextHand(1200);
            this.hooks.broadcastTableState(t.code);
        }
    }
    maybeFinish() {
        const active = [...this.entrants.values()].filter((e) => e.status === "active");
        if ((this.status === "active" || this.status === "final_table") && active.length <= 1) {
            this.finish(active[0] ?? null);
        }
    }
    finish(winner) {
        if (this.status === "completed" || this.status === "cancelled")
            return;         this.clearTimers();
        if (winner) {
            winner.status = "finished";
            winner.finalRank = 1;
        }
        else {
            const lastStanding = [...this.entrants.values()]
                .filter((e) => e.status === "eliminated")
                .sort((a, b) => (b.finalRank ?? 0) - (a.finalRank ?? 0))[0];
            if (lastStanding) {
                lastStanding.status = "finished";
                lastStanding.finalRank = 1;
                this.log("winner_promoted", { name: lastStanding.profile.nickname });
            }
        }
        if (winner)
            this.log("winner", { name: winner.profile.nickname });
        const paid = [...this.entrants.values()]
            .filter((e) => e.finalRank !== null)
            .sort((a, b) => (a.finalRank ?? 999) - (b.finalRank ?? 999));
        const n = this.entrants.size;
        for (const e of paid) {
            const pts = Math.round(10 * Math.sqrt(n) * ((n - (e.finalRank ?? n) + 1) / n));
            e.points = pts;
            if (!e.isBot) {
                e.profile.seasonPoints = (e.profile.seasonPoints ?? 0) + pts;
                this.store.addSeasonPoints(e.profile.id ?? e.profile.token, pts);
                this.store.addXp(e.profile, e.finalRank === 1 ? 200 : 100);
                if (e.finalRank === 1)
                    this.store.counter(e.profile, "tourWins", 1);
                this.store.checkAchievements(e.profile);
            }
        }
        this.results = paid.map((e) => ({
            rank: e.finalRank ?? 0,
            nickname: e.profile.nickname,
            avatar: e.profile.avatar,
            isBot: e.isBot,
            points: e.points,
            title: e.finalRank === 1 ? "champion" : e.finalRank === 2 ? "runner_up" : e.finalRank === 3 ? "third_place" : "eliminated",
        }));
        const showcase = this.pickShowcaseTable()?.code ?? null;
        for (const t of [...this.tables]) {
            if (showcase && t.code === showcase)
                continue;
            this.closeTable(t, "tournament_finished");
        }
        if (showcase) {
            const st = this.tables.find((x) => x.code === showcase);
            if (st) {
                try {
                    st.close();                 }
                catch {
                    // already closed — showcase remains viewable via snapshots
                }
                for (const e of this.entrants.values()) {
                    if (e.isBot && e.tableCode === showcase) {
                        try {
                            this.hooks.bots.removeBot(showcase, e.profile.token);
                        }
                        catch {
                            // bot driver already gone — best-effort cleanup
                        }
                    }
                }
                this.log("table_showcase", { table: showcase });
                this.hooks.broadcastTableState(showcase);
            }
        }
        this.transition("completed");
        this.completedAt = Date.now();
        this.log("tournament_completed", { n: this.entrants.size });
        this.push();
        try {
            this.hooks.broadcastRoomToTables(this.roomId, this.tables.map((t) => t.code));
        }
        catch {
            // best-effort — the lobby push above already covered room watchers
        }
        this.markDirty();
    }

    showcaseCode() {
        if (this.status !== "completed")
            return null;
        return this.pickShowcaseTable()?.code ?? null;
    }

    pickShowcaseTable() {
        const winner = [...this.entrants.values()].find((e) => e.finalRank === 1);
        const byWinner = winner?.tableCode ? this.tables.find((t) => t.code === winner.tableCode) : undefined;
        if (byWinner)
            return byWinner;
        return this.tables.length ? this.tables[this.tables.length - 1] : null;
    }

    publicView(token) {
        const all = [...this.entrants.values()].sort((x, y) => x.joinedAt - y.joinedAt);
        const me = token ? this.entrants.get(token) ?? null : null;
        const isHost = !!token && token === this.hostId;
        const players = all.map((e) => ({
            nickname: e.profile.nickname,
            avatar: e.profile.avatar,
            isBot: e.isBot,
            status: e.status,
            joinedAt: e.joinedAt,
            tableCode: e.tableCode ?? undefined,
            points: e.status === "active" ? this.pointsOf(e.profile.token) : undefined,
            rank: e.finalRank,
        }));
        const live = all
            .filter((e) => e.status === "active")
            .sort((x, y) => this.pointsOf(y.profile.token) - this.pointsOf(x.profile.token));
        const out = all
            .filter((e) => e.finalRank !== null)
            .sort((x, y) => (x.finalRank ?? 0) - (y.finalRank ?? 0));
        const standings = [
            ...live.map((e, i) => ({
                rank: i + 1,
                nickname: e.profile.nickname,
                avatar: e.profile.avatar,
                points: this.pointsOf(e.profile.token),
                out: false,
                isBot: e.isBot,
                tableCode: e.tableCode ?? undefined,
            })),
            ...out.map((e) => ({
                rank: e.finalRank ?? 0,
                nickname: e.profile.nickname,
                avatar: e.profile.avatar,
                points: 0,
                out: true,
                isBot: e.isBot,
            })),
        ];
        const total = all.length;
        const eliminated = all.filter((e) => e.status === "eliminated").length;
        const hostProfile = this.entrants.get(this.hostId)?.profile;
        const hostNickname = hostProfile?.nickname ?? "Host";
        let myStatus = "spectator";
        if (isHost)
            myStatus = "host";
        else if (me)
            myStatus = me.status;
        return {
            roomId: this.roomId,
            name: this.name,
            status: this.status,
            variant: this.cfg.variant,
            startMode: this.cfg.startMode,
            fallback: this.cfg.fallback,
            requiredPlayers: this.cfg.requiredPlayers,
            minPlayers: this.cfg.minPlayers,
            startsAt: this.cfg.startsAt,
            lateJoin: this.cfg.lateJoin,
            turnSec: this.cfg.turnSec,
            seatsPerTable: this.cfg.seatsPerTable,
            maxPlayers: this.cfg.maxPlayers,
            unlimited: this.cfg.unlimited,
            createdAt: this.createdAt,
            startedAt: this.startedAt,
            completedAt: this.completedAt,
            hostNickname,
            tables: this.tables.map((t) => ({
                code: t.code,
                name: t.cfg.name,
                players: t.seatedPlayers().length,
                seats: t.seats.length,
                playing: t.handActive,
            })),
            players,
            standings,
            results: this.results,
            winner: this.results.find((r) => r.rank === 1)
                ? { nickname: this.results.find((r) => r.rank === 1).nickname, avatar: this.results.find((r) => r.rank === 1).avatar }
                : null,
            events: this.events.slice(-120),
            counts: {
                registered: total,
                remaining: live.length,
                eliminated,
                tables: this.tables.length,
            },
            progress: total > 1 ? Math.max(0, Math.min(1, eliminated / (total - 1))) : 0,
            myStatus,
            myTableCode: me && (me.status === "active") ? me.tableCode ?? undefined : undefined,
        };
    }
    pointsOf(token) {
        for (const t of this.tables) {
            const seat = t.seatOf(token);
            if (seat)
                return seat.points;
        }
        return 0;
    }
    serialize() {
        return {
            id: this.roomId,
            name: this.name,
            cfg: { ...this.cfg },
            status: this.status,
            hostId: this.hostId,
            createdAt: this.createdAt,
            startedAt: this.startedAt,
            completedAt: this.completedAt,
            events: this.events.slice(-EVENT_LOG_CAP),
            results: this.results,
            entrants: [...this.entrants.values()].map((e) => ({
                token: e.profile.token,
                nickname: e.profile.nickname,
                avatar: e.profile.avatar,
                isBot: e.isBot,
                botDifficulty: e.botDifficulty,
                status: e.status,
                finalRank: e.finalRank,
                points: e.points,
                joinedAt: e.joinedAt,
                tableCode: e.tableCode,
            })),
            tables: this.tables.map((t) => ({
                code: t.code,
                seats: t.seats
                    .filter((s) => !!s && !s.playerId?.startsWith("leaving:"))
                    .map((s) => ({
                    token: s.playerId?.startsWith("leaving:") ? s.playerId.slice(8) : s.playerId,
                    nickname: s.nickname,
                    avatar: s.avatar,
                    points: s.points,
                    strikes: s.strikes,
                    connected: s.connected,
                })),
            })),
        };
    }

    static restore(rec, hooks, store) {
        const room = new Room(rec.id, rec.cfg, { token: rec.hostId, nickname: "Host" }, hooks, store);
        room.name = rec.name;
        room.status = rec.status;
        room.createdAt = rec.createdAt;
        room.startedAt = rec.startedAt;
        room.completedAt = rec.completedAt;
        room.events = Array.isArray(rec.events) ? rec.events.slice(-EVENT_LOG_CAP) : [];
        room.results = Array.isArray(rec.results) ? rec.results : [];
        for (const r of rec.entrants ?? []) {
            const allowedStatus = ["registered", "active", "eliminated", "finished"];
            const safeStatus = allowedStatus.includes(r.status) ? r.status : "registered";
            const profile = r.isBot
                ? room.makeBotProfile(r.token)
                : store.getOrCreate(r.token, r.nickname);
            if (!r.isBot && profile.nickname !== r.nickname) {
                profile.nickname = r.nickname;
                store.markDirty(profile);
            }
            room.entrants.set(r.token, {
                profile,
                isBot: !!r.isBot,
                botDifficulty: r.botDifficulty ?? "normal",
                status: safeStatus,
                finalRank: r.finalRank ?? null,
                points: r.points ?? 0,
                joinedAt: r.joinedAt ?? Date.now(),
                tableCode: r.tableCode ?? null,
            });
        }
        if (room.status === "active" || room.status === "final_table" || room.status === "starting") {
            let tableIdx = 0;
            for (const t of rec.tables ?? []) {
                if (!t.seats.length)
                    continue;
                const cfg = room.makeTableConfig(tableIdx++);
                const firstSeat = t.seats[0];
                const firstProfile = room.entrants.get(firstSeat.token)?.profile;
                if (!firstProfile)
                    continue;
                const table = new ShowdownTable(t.code, cfg, room.tableDeps(t.code), sitOf(firstProfile));
                table.tournamentId = room.roomId;
                room.tables.push(table);
                hooks.registerTable(table, room.hostId);
                for (const s of t.seats) {
                    const e = room.entrants.get(s.token);
                    if (!e)
                        continue;
                    if (table.seatOf(s.token))
                        continue;
                    const ok = table.sitDownFirstFree(sitOf(e.profile));
                    if (ok) {
                        const seat = table.seatOf(s.token);
                        if (seat) {
                            seat.points = Math.max(0, s.points ?? 0);
                            seat.strikes = Math.max(0, s.strikes ?? 0);
                        }
                        e.status = "active";
                        e.tableCode = t.code;
                        if (e.isBot)
                            room.attachBotDriver(t.code, e);
                    }
                }
                table.scheduleNextHand(2500);
            }
            if (room.tables.length > 0) {
                room.log("recovered_after_restart", { tables: room.tables.length });
            }
        }
        if (room.status === "scheduled") {
            const at = room.cfg.startsAt ?? 0;
            if (at && at <= Date.now()) {
                realTimers().schedule(() => room.onScheduledTime(), 2_000);
            }
            else {
                room.armStartTimer();
            }
        }
        else if (room.status === "waiting") {
            if (room.cfg.startMode === "immediate") {
                realTimers().schedule(() => {
                    if (room.status === "waiting" && room.entrants.size >= 2)
                        room.beginStart("recovered_immediate");
                }, 2_000);
            }
            else {
                realTimers().schedule(() => room.evaluateAutoStart(), 2_000);
            }
        }
        else if (room.status === "starting") {
            room.status = "waiting";
            realTimers().schedule(() => {
                if (room.status === "waiting" && room.entrants.size >= 2)
                    room.beginStart("recovered_starting");
            }, 2_500);
        }
        room.markDirty();
        return room;
    }
}
function sitOf(profile) {
    return { playerId: profile.token, nickname: profile.nickname, avatar: profile.avatar };
}
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genTableCode() {
    let c = "";
    for (let i = 0; i < 6; i++)
        c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return c;
}
export class RoomRunner {
    hooks;
    store;
    dataDir;
    rooms = new Map();
    saveTimer = null;
    dirtySinceSave = false;
    constructor(hooks, store, dataDir) {
        this.hooks = hooks;
        this.store = store;
        this.dataDir = dataDir;
        this.loadFromDisk();
        this.saveTimer = setInterval(() => this.flush(), 3000);
        if (this.saveTimer.unref)
            this.saveTimer.unref();
    }

    freshRoomId() {
        const taken = new Set(this.rooms.keys());
        return Room.generateId(taken);
    }
    create(raw, host) {
        const parsed = sanitizeRoomConfig(raw);
        if (!parsed.ok)
            return { ok: false, error: parsed.error };
        if (!host || !host.token)
            return { ok: false, error: "bad_request" };
        let roomId;
        try {
            roomId = this.freshRoomId();
        }
        catch {
            return { ok: false, error: "room_id_failed" };
        }
        const room = new Room(roomId, parsed.cfg, host, this.hooks, this.store);
        room.log("room_created", { name: parsed.cfg.name, mode: parsed.cfg.startMode });
        const joinRes = room.join(host);         if (!joinRes.ok)
            return { ok: false, error: joinRes.error ?? "join_failed" };
        this.rooms.set(roomId, room);
        this.store.counter(host, "gamesHosted", 1);
        this.store.checkAchievements(host);
        if (parsed.cfg.startMode === "scheduled" || parsed.cfg.startMode === "scheduled_min") {
            room.armStartTimer();
        }
        else if (parsed.cfg.startMode === "when_full") {
            room.evaluateAutoStart();
        }
        else if (parsed.cfg.startMode === "immediate") {
            room.beginStart("immediate");
        }
        room.markDirty();
        this.dirtySinceSave = true;
        return { ok: true, room };
    }
    get(id) {
        return Room.isRoomId(id) ? this.rooms.get(id) : undefined;
    }

    listFor(token) {
        return [...this.rooms.values()].filter((r) => {
            const mine = r.entrants.has(token) || r.hostId === token;
            if (!mine)
                return false;
            if (r.status !== "completed" && r.status !== "cancelled")
                return true;
            return Date.now() - (r.completedAt ?? r.createdAt) < 24 * 3600_000;
        });
    }

    prune() {
        const now = Date.now();
        for (const [id, r] of this.rooms) {
            if ((r.status === "completed" || r.status === "cancelled") && now - (r.completedAt ?? r.createdAt) > 7 * 86_400_000) {
                this.rooms.delete(id);
            }
        }
    }
    notifyChanged() {
        this.dirtySinceSave = true;
    }
    flush() {
        if (!this.dirtySinceSave) {
            let any = false;
            for (const r of this.rooms.values())
                if (r.consumeDirty())
                    any = true;
            if (!any)
                return;
        }
        this.dirtySinceSave = false;
        try {
            mkdirSync(this.dataDir, { recursive: true });
            const records = [...this.rooms.values()].map((r) => r.serialize());
            const tmp = `${this.dataDir}${SAVE_FILE}.tmp`;
            writeFileSync(tmp, JSON.stringify({ rooms: records }));
            renameSync(tmp, `${this.dataDir}${SAVE_FILE}`);
        }
        catch (e) {
            console.error("[rooms] flush failed", e);
        }
    }
    loadFromDisk() {
        const file = `${this.dataDir}${SAVE_FILE}`;
        if (!existsSync(file)) {
            console.log("[rooms] no saved rooms — fresh start");
            return;
        }
        try {
            const raw = readFileSync(file, "utf8");
            const data = JSON.parse(raw);
            const list = Array.isArray(data.rooms) ? data.rooms : [];
            let restored = 0;
            for (const rec of list) {
                if (!Room.isRoomId(rec.id) || !rec.cfg)
                    continue;                 try {
                    const room = Room.restore(rec, this.hooks, this.store);
                    this.rooms.set(room.roomId, room);
                    restored++;
                }
                catch (e) {
                    console.error(`[rooms] restore failed for ${rec.id}`, e);
                }
            }
            console.log(`[rooms] restored ${restored}/${list.length} rooms from disk`);
        }
        catch (e) {
            console.error("[rooms] load failed — starting fresh", e);
        }
    }
    dispose() {
        if (this.saveTimer)
            clearInterval(this.saveTimer);
        this.flush();
    }
}