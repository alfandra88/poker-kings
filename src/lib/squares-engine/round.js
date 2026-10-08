import { CELLS, emptyGrid, firstEmpty, scoreGrid } from "./scoring.js";

// One round of Poker Squares for a set of players who all receive the same
// 25 cards in the same order. Pure: timers and the deck are injected.
//
// deps: { timers: { schedule(fn, ms), cancel(h), now() }, onChange(), onEvent(ev), onDone(results) }
export class SquaresRound {
    constructor({ deck, playerIds, timerMs, deps }) {
        if (!Array.isArray(deck) || deck.length < CELLS)
            throw new Error("deck must hold at least 25 cards");
        this.deck = deck.slice(0, CELLS);
        this.timerMs = timerMs;
        this.deps = deps;
        this.grids = new Map();
        this.auto = new Set();
        for (const id of playerIds)
            this.grids.set(id, emptyGrid());
        this.index = -1;
        this.placed = new Set();
        this.deadline = 0;
        this.timer = null;
        this.phase = "ready";
        this.results = null;
    }
    get card() {
        return this.index >= 0 && this.index < CELLS ? this.deck[this.index] : null;
    }
    has(id) {
        return this.grids.has(id);
    }
    grid(id) {
        return this.grids.get(id) ?? null;
    }
    start() {
        if (this.phase !== "ready")
            return;
        this.phase = "placing";
        this.next();
    }
    // Players who left or disconnected get their card placed for them.
    setAuto(id, on) {
        if (!this.grids.has(id))
            return;
        if (on)
            this.auto.add(id);
        else
            this.auto.delete(id);
        if (on && this.phase === "placing" && !this.placed.has(id)) {
            this.autoPlace(id, "away");
            this.maybeAdvance();
        }
    }
    place(id, cell) {
        if (this.phase !== "placing")
            return { ok: false, error: "not_placing" };
        const g = this.grids.get(id);
        if (!g)
            return { ok: false, error: "not_playing" };
        if (this.placed.has(id))
            return { ok: false, error: "already_placed" };
        if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS)
            return { ok: false, error: "bad_cell" };
        if (g[cell] !== null)
            return { ok: false, error: "cell_taken" };
        g[cell] = this.card;
        this.placed.add(id);
        this.deps.onEvent?.({ t: "place", id, cell, card: this.card, index: this.index });
        this.maybeAdvance();
        this.deps.onChange?.();
        return { ok: true };
    }
    autoPlace(id, by) {
        const g = this.grids.get(id);
        const cell = firstEmpty(g);
        if (cell < 0)
            return;
        g[cell] = this.card;
        this.placed.add(id);
        this.deps.onEvent?.({ t: "place", id, cell, card: this.card, index: this.index, by });
    }
    maybeAdvance() {
        if (this.phase !== "placing")
            return;
        for (const id of this.grids.keys())
            if (!this.placed.has(id))
                return;
        this.next();
    }
    onTimeout() {
        this.timer = null;
        if (this.phase !== "placing")
            return;
        for (const id of this.grids.keys())
            if (!this.placed.has(id))
                this.autoPlace(id, "time");
        this.next();
        this.deps.onChange?.();
    }
    next() {
        if (this.timer) {
            this.deps.timers.cancel(this.timer);
            this.timer = null;
        }
        this.index++;
        this.placed = new Set();
        if (this.index >= CELLS) {
            this.finish();
            return;
        }
        this.deps.onEvent?.({ t: "deal", index: this.index, card: this.card });
        for (const id of this.auto)
            this.autoPlace(id, "away");
        if (this.grids.size > 0 && this.placed.size === this.grids.size) {
            this.next();
            return;
        }
        this.deadline = this.deps.timers.now() + this.timerMs;
        this.timer = this.deps.timers.schedule(() => this.onTimeout(), this.timerMs);
        this.deps.onChange?.();
    }
    finish() {
        this.phase = "results";
        this.deadline = 0;
        const rows = [];
        for (const [id, g] of this.grids) {
            const s = scoreGrid(g);
            rows.push({ id, points: s.total, bestLine: s.bestLine, grid: g.slice(), score: s });
        }
        this.results = rankResults(rows);
        this.deps.onEvent?.({ t: "round_end", results: this.results.map((r) => ({ id: r.id, points: r.points, place: r.place })) });
        this.deps.onDone?.(this.results);
        this.deps.onChange?.();
    }
    abort() {
        if (this.timer)
            this.deps.timers.cancel(this.timer);
        this.timer = null;
        this.phase = "aborted";
    }
}

// Highest points first; equal points share a place.
export function rankResults(rows) {
    const sorted = rows.slice().sort((a, b) => b.points - a.points);
    let place = 0;
    let prev = null;
    sorted.forEach((r, i) => {
        if (r.points !== prev) {
            place = i + 1;
            prev = r.points;
        }
        r.place = place;
    });
    return sorted;
}
