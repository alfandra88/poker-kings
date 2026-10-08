import { createHash, randomBytes } from "node:crypto";
import { deckFromSeed, seedToHex } from "../../src/lib/poker-engine/cards.js";
import { SquaresRound, scoreGrid, CELLS } from "../../src/lib/squares-engine/index.js";

export const TIMER_CHOICES = [10, 15, 30];
export const NEXT_ROUND_MS = 10000;
export const FIRST_ROUND_MS = 3000;
export const MAX_PLAYERS = 8;

export function randomSeed() {
    return randomBytes(4).readUInt32BE(0);
}
export function seedHashOf(seed) {
    return createHash("sha256").update(seedToHex(seed)).digest("hex");
}

export function sanitizeTableConfig(raw = {}, base = {}) {
    const cfg = {
        name: base.name ?? "Poker Squares",
        timerSec: base.timerSec ?? 15,
        maxPlayers: base.maxPlayers ?? MAX_PLAYERS,
        approveJoin: base.approveJoin ?? false,
        password: base.password ?? null,
        botsYieldSeats: base.botsYieldSeats ?? true,
        botDifficulty: base.botDifficulty ?? "normal",
    };
    if (typeof raw.name === "string" && raw.name.trim())
        cfg.name = raw.name.trim().slice(0, 40);
    if (TIMER_CHOICES.includes(Number(raw.timerSec)))
        cfg.timerSec = Number(raw.timerSec);
    if (Number.isInteger(Number(raw.maxPlayers)))
        cfg.maxPlayers = Math.max(2, Math.min(MAX_PLAYERS, Number(raw.maxPlayers)));
    if (typeof raw.approveJoin === "boolean")
        cfg.approveJoin = raw.approveJoin;
    if (raw.password === null || raw.password === "")
        cfg.password = null;
    else if (typeof raw.password === "string")
        cfg.password = raw.password.trim().slice(0, 12) || null;
    if (typeof raw.botsYieldSeats === "boolean")
        cfg.botsYieldSeats = raw.botsYieldSeats;
    if (["easy", "normal", "hard"].includes(raw.botDifficulty))
        cfg.botDifficulty = raw.botDifficulty;
    return cfg;
}

// One Poker Squares table: its players, the current round and the timing
// between rounds. Contest tables are driven by the contest instead.
export class SquaresTable {
    constructor(code, cfg, hostId, deps, { contestId = null } = {}) {
        this.code = code;
        this.cfg = cfg;
        this.hostId = hostId;
        this.deps = deps;
        this.contestId = contestId;
        this.players = new Map();
        this.names = new Map();
        this.status = "open";
        this.phase = "lobby";
        this.round = null;
        this.roundNo = 0;
        this.seed = null;
        this.seedHash = null;
        this.nextRoundAt = 0;
        this.nextTimer = null;
        this.lastResults = null;
        this.watchers = 0;
    }
    get playing() {
        return this.phase === "placing";
    }
    humans() {
        return [...this.players.values()].filter((p) => !p.isBot);
    }
    bots() {
        return [...this.players.values()].filter((p) => p.isBot);
    }
    isFull() {
        return this.players.size >= this.cfg.maxPlayers;
    }
    addPlayer({ id, username, isBot = false, skill = "normal" }) {
        if (this.status === "closed")
            return { ok: false, error: "table_not_found" };
        if (this.players.has(id))
            return { ok: false, error: "already_seated" };
        if (this.isFull())
            return { ok: false, error: "table_full" };
        const p = { id, username, isBot, skill, connected: true, waiting: this.playing, leaving: false };
        this.players.set(id, p);
        this.names.set(id, { username, isBot });
        if (!isBot && this.phase !== "placing" && !this.contestId)
            this.scheduleNext(this.roundNo === 0 ? FIRST_ROUND_MS : NEXT_ROUND_MS, false);
        this.deps.onChange();
        return { ok: true, waiting: p.waiting };
    }
    removePlayer(id) {
        const p = this.players.get(id);
        if (!p)
            return false;
        this.players.delete(id);
        if (this.round?.has(id))
            this.round.setAuto(id, true);
        if (this.humans().length === 0)
            this.cancelNext();
        this.deps.onChange();
        return true;
    }
    setConnected(id, on) {
        const p = this.players.get(id);
        if (!p)
            return;
        p.connected = on;
        if (this.round?.has(id))
            this.round.setAuto(id, !on);
        this.deps.onChange();
    }
    cancelNext() {
        if (this.nextTimer)
            this.deps.timers.cancel(this.nextTimer);
        this.nextTimer = null;
        this.nextRoundAt = 0;
    }
    // Plain tables start their own rounds; "force" restarts the countdown.
    scheduleNext(ms, force = true) {
        if (this.contestId || this.status !== "open" || this.humans().length === 0)
            return;
        if (this.nextTimer && !force)
            return;
        this.cancelNext();
        this.nextRoundAt = this.deps.timers.now() + ms;
        this.nextTimer = this.deps.timers.schedule(() => {
            this.nextTimer = null;
            this.nextRoundAt = 0;
            this.startRound();
        }, ms);
    }
    startRound(seed = randomSeed()) {
        if (this.status === "closed" || this.playing)
            return false;
        if (this.players.size === 0)
            return false;
        this.cancelNext();
        for (const p of this.players.values())
            p.waiting = false;
        this.roundNo += 1;
        this.seed = seed;
        this.seedHash = seedHashOf(seed);
        this.phase = "placing";
        this.lastResults = null;
        const ids = [...this.players.keys()];
        this.round = new SquaresRound({
            deck: deckFromSeed(seed),
            playerIds: ids,
            timerMs: this.cfg.timerSec * 1000,
            deps: {
                timers: this.deps.timers,
                onChange: () => this.deps.onChange(),
                onEvent: (ev) => this.deps.onEvent({ ...ev, round: this.roundNo }),
                onDone: (results) => this.finishRound(results),
            },
        });
        this.deps.onEvent({ t: "round_start", round: this.roundNo, seedHash: this.seedHash, players: ids.length });
        for (const p of this.players.values())
            if (!p.connected)
                this.round.setAuto(p.id, true);
        this.round.start();
        this.deps.onRoundStart?.(this);
        this.deps.onChange();
        return true;
    }
    finishRound(results) {
        this.phase = "results";
        this.lastResults = results.map((r) => {
            const n = this.names.get(r.id) ?? { username: "?", isBot: false };
            return {
                id: r.id, username: n.username, isBot: n.isBot, points: r.points, place: r.place,
                bestLine: r.bestLine, grid: r.grid, rows: r.score.rows, cols: r.score.cols,
            };
        });
        this.deps.onEvent({ t: "seed_reveal", round: this.roundNo, seed: seedToHex(this.seed), seedHash: this.seedHash });
        for (const p of [...this.players.values()])
            if (p.leaving)
                this.players.delete(p.id);
        this.deps.onRoundDone(this, this.lastResults);
        if (this.status === "open")
            this.scheduleNext(NEXT_ROUND_MS);
        this.deps.onChange();
    }
    pause(on) {
        if (this.status === "closed")
            return;
        this.status = on ? "paused" : "open";
        if (on)
            this.cancelNext();
        else if (!this.playing)
            this.scheduleNext(this.roundNo === 0 ? FIRST_ROUND_MS : NEXT_ROUND_MS);
        this.deps.onChange();
    }
    close() {
        this.status = "closed";
        this.cancelNext();
        this.round?.abort();
        this.round = null;
    }
    place(id, cell) {
        if (!this.round || !this.playing)
            return { ok: false, error: "not_placing" };
        return this.round.place(id, cell);
    }
    // What one viewer may see. Players see only their own grid while a round
    // is on; people watching see every grid; everyone sees all after it.
    snapshotFor(viewerId) {
        const seated = this.players.get(viewerId) ?? null;
        const inRound = !!(this.round && this.round.has(viewerId) && this.playing);
        const canSeeAll = !inRound;
        const ids = new Set([...this.players.keys(), ...(this.round ? this.round.grids.keys() : [])]);
        const players = [];
        for (const id of ids) {
            const p = this.players.get(id);
            const n = this.names.get(id) ?? { username: "?", isBot: false };
            const grid = this.round?.grid(id) ?? null;
            const sc = grid ? scoreGrid(grid) : null;
            players.push({
                id,
                username: n.username,
                isBot: n.isBot,
                isHost: id === this.hostId,
                connected: p ? p.connected : false,
                gone: !p,
                waiting: p ? p.waiting : false,
                placedCurrent: !!(this.round && this.playing && this.round.placed.has(id)),
                linePoints: sc ? sc.total : 0,
                self: id === viewerId,
                grid: grid && (id === viewerId || canSeeAll) ? grid.slice() : null,
            });
        }
        const mine = this.round?.grid(viewerId) ?? null;
        const myScore = mine ? scoreGrid(mine) : null;
        return {
            code: this.code,
            name: this.cfg.name,
            status: this.status,
            phase: this.phase,
            contestId: this.contestId,
            hostId: this.hostId,
            isHost: viewerId === this.hostId,
            config: {
                timerSec: this.cfg.timerSec,
                maxPlayers: this.cfg.maxPlayers,
                approveJoin: this.cfg.approveJoin,
                hasPassword: !!this.cfg.password,
                botsYieldSeats: this.cfg.botsYieldSeats,
                botDifficulty: this.cfg.botDifficulty,
            },
            roundNo: this.roundNo,
            index: this.round && this.playing ? this.round.index : null,
            card: this.round && this.playing ? this.round.card : null,
            deadline: this.round && this.playing ? this.round.deadline : 0,
            serverNow: this.deps.timers.now(),
            nextRoundAt: this.nextRoundAt,
            seedHash: this.seedHash,
            cells: CELLS,
            me: {
                seated: !!seated,
                waiting: seated ? seated.waiting : false,
                inRound: !!(this.round && this.round.has(viewerId)),
                placedCurrent: !!(this.round && this.playing && this.round.placed.has(viewerId)),
                grid: mine ? mine.slice() : null,
                rows: myScore ? myScore.rows : null,
                cols: myScore ? myScore.cols : null,
                total: myScore ? myScore.total : 0,
            },
            players,
            watching: Math.max(0, this.watchers - this.humans().length),
            results: this.phase === "placing" ? null : this.lastResults,
        };
    }
}
