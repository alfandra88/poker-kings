/**
 * Poker Kings — authoritative SHOWDOWN table state machine (Stay/Pass format).
 *
 * The old format was betting poker (blinds, pots, side pots). Homeroom's content
 * rules ban simulated gambling, so this engine keeps the poker hand-strength
 * contest and replaces betting with a Stay/Pass decision game:
 *   - Each street every participant chooses Stay or Pass.
 *   - Pass is always safe: you sit the round out, no penalty.
 *   - Contest the showdown and lose: +1 strike. Three strikes bench you (cash)
 *     or eliminate you (tournament, via deps.onStrike).
 *   - Showdown winner(s) earn points. Walkover (everyone else passed) earns a
 *     smaller award. Points have no monetary value anywhere.
 *
 * Interface invariants kept from the previous engine so the service layer keeps
 * its shape: deps {timers{schedule,cancel,now}, random, sha256, broadcast,
 * onStateDirty, onPayout, onHandEnd, onPlayersLeft, onStrike}; methods seatOf,
 * sitDown, sitDownFirstFree, standUp, clearLeavingSeats, sitOutToggle,
 * removePlayer, setConnected, act, tryStartHand, scheduleNextHand, pause, close,
 * abortHand, snapshotFor, exportEvents, lastEvents, seatedPlayers,
 * handEligibleSeats.
 *
 * Invariants enforced here:
 *  - Hidden info never leaves the engine except through redaction (snapshotFor).
 *  - The decision loop always terminates: every path reaches endHand.
 *  - Points are only minted by showdown wins and walkovers, never by chips.
 */
import { deckFromSeed, evalBest, evalOmaha, seedToHex } from "./cards.js";

const NEXT_HAND_DELAY_MS = 4000;
const SHOWDOWN_BASE_POINTS = 50;
const SHOWDOWN_PER_LOSER = 25;
const WALKOVER_POINTS = 25;
const STRIKES_TO_BENCH = 3;
const BENCH_ROUNDS = 3;

function clone(v) {
    return JSON.parse(JSON.stringify(v));
}
function realId(seat) {
    const pid = seat.playerId;
    if (!pid)
        return null;
    return pid.startsWith("leaving:") ? pid.slice("leaving:".length) : pid;
}

export class ShowdownTable {
    code;
    cfg;
    deps;
    hostId;
    seats;
    button = null;
    stage = "lobby";
    handNo = 0;
    handActive = false;
    paused = false;
    closed = false;
    deck = [];
    board = [];
    toAct = null;
    turnDeadline = 0;
    seed = 0;
    seedHash = "";
    handEvents = [];
    lastHandSummary = null;
    hAction = null;
    hNext = null;
    timeOuts = new Map();
    levelIdx = 0;
    levelEndsAt = null;
    pausedRemainingAction = 0;
    hadActionTimer = false;
    tournamentId;
    constructor(code, cfg, deps, host) {
        this.code = code;
        this.cfg = clone(cfg);
        // PRIVACY (defense in depth): the engine itself clamps spectator reveal off
        // so no service layer can accidentally re-enable public hole cards.
        this.cfg.spectatorCards = false;
        // Tournament mode must always end in a showdown — Pass would let players
        // stall forever, so it is disabled there (timeouts auto-Stay instead).
        if (this.cfg.mode === "tournament")
            this.cfg.noPass = true;
        this.deps = deps;
        this.hostId = host.playerId;
        this.seats = Array.from({ length: Math.max(2, Math.min(10, cfg.maxSeats)) }, () => null);
    }
    now() {
        return this.deps.timers.now();
    }
    ev(e, internal = false) {
        this.handEvents.push(e);
        if (!internal)
            this.deps.broadcast(e);
    }
    dirty() {
        this.deps.onStateDirty();
    }
    seatOf(playerId) {
        return this.seats.find((s) => s && realId(s) === playerId) ?? null;
    }
    eligibleForHand(s) {
        return !s.sittingOut && !s.benched;
    }
    handEligibleSeats() {
        return this.seats.filter((s) => s !== null && this.eligibleForHand(s));
    }
    seatedPlayers() {
        return this.seats
            .filter((s) => !!s && !!realId(s))
            .map((s) => ({ playerId: realId(s), points: s.points }));
    }
    nextSeat(from, step, pred) {
        const n = this.seats.length;
        for (let i = 1; i <= n; i++) {
            const idx = (from + step * i + n * 4) % n;
            const s = this.seats[idx];
            if (s && pred(s))
                return idx;
        }
        return null;
    }
    sitDown(seatId, player, _buyIn) {
        if (this.closed)
            return { ok: false, error: "table_closed" };
        if (this.seatOf(player.playerId))
            return { ok: false, error: "already_seated" };
        if (seatId < 0 || seatId >= this.seats.length)
            return { ok: false, error: "bad_seat" };
        if (this.seats[seatId])
            return { ok: false, error: "seat_taken" };
        this.seats[seatId] = {
            seatId,
            playerId: player.playerId,
            // PRIVACY — opaque identity shown to other clients. seatId in the suffix
            // guarantees uniqueness within the table even on a (24-bit) uid clash.
            seatUid: `p${seatId}-${Math.floor(this.deps.random() * 0xffffff)
                .toString(16)
                .padStart(6, "0")}`,
            nickname: player.nickname,
            avatar: player.avatar,
            points: 0,
            strikes: 0,
            benchRounds: 0,
            benched: false,
            sittingOut: this.handActive,
            autoWait: this.handActive,
            lastAction: null,
            lastActionBy: null,
            cards: [],
            revealed: false,
            passed: false,
            decided: false,
            stayed: false,
            timeBankMs: this.cfg.timeBankSec * 1000,
            joinedHandNo: this.handNo,
            connected: false, // registry flips this on as soon as the socket joins
        };
        this.dirty();
        if (this.cfg.mode === "cash" && !this.handActive && !this.paused && !this.closed) {
            this.scheduleNextHand(1200);
        }
        return { ok: true };
    }

    sitDownFirstFree(player) {
        for (let i = 0; i < this.seats.length; i++) {
            if (!this.seats[i]) {
                return this.sitDown(i, player, 0).ok;
            }
        }
        return false;
    }
    standUp(playerId) {
        const idx = this.seats.findIndex((s) => s && realId(s) === playerId);
        if (idx < 0)
            return { ok: false, error: "not_seated" };
        const s = this.seats[idx];
        if (this.handActive) {
            if (!s.decided) {
                s.decided = true;
                s.passed = true;
                s.lastAction = "pass";
            }
            s.playerId = `leaving:${playerId}`;
            this.advanceIfTurn(s);
            this.dirty();
            return { ok: true };
        }
        this.seats[idx] = null;
        this.dirty();
        return { ok: true };
    }
    clearLeavingSeats() {
        const out = [];
        for (let i = 0; i < this.seats.length; i++) {
            const s = this.seats[i];
            if (s && s.playerId?.startsWith("leaving:")) {
                out.push({ playerId: realId(s), points: s.points });
                this.seats[i] = null;
            }
        }
        return out;
    }
    sitOutToggle(playerId, on) {
        const s = this.seatOf(playerId);
        if (!s)
            return false;
        s.sittingOut = on;
        s.autoWait = false;
        this.advanceIfTurn(s);
        this.dirty();
        return true;
    }

    advanceIfTurn(s) {
        if (this.handActive && this.toAct === s.seatId) {
            this.cancelActionTimer();
            this.advanceAction();
        }
    }

    addChips() {
        // No chips exist in the Stay/Pass format — nothing to top up.
        return false;
    }
    removePlayer(playerId) {
        const idx = this.seats.findIndex((s) => s && realId(s) === playerId);
        if (idx < 0)
            return;
        const s = this.seats[idx];
        if (this.handActive) {
            if (!s.decided) {
                s.decided = true;
                s.passed = true;
                s.lastAction = "pass";
            }
            s.playerId = `leaving:${playerId}`;
            this.advanceIfTurn(s);
        }
        else {
            this.seats[idx] = null;
        }
        this.dirty();
    }
    setConnected(playerId, connected) {
        const s = this.seatOf(playerId);
        if (s) {
            s.connected = connected;
            this.dirty();
        }
    }
    setBlinds() {
        // No blinds in this format — kept as a no-op so the service layer keeps its shape.
    }
    setLevelInfo(idx, endsAt) {
        this.levelIdx = idx;
        this.levelEndsAt = endsAt;
    }
    updateConfig(patch) {
        const locked = ["mode", "variant", "maxSeats"];
        for (const k of Object.keys(patch)) {
            if (locked.includes(k))
                continue;
            this.cfg[k] = patch[k];
        }
        this.dirty();
    }
    tryStartHand() {
        if (this.closed || this.handActive || this.paused)
            return;
        if (this.handEligibleSeats().length >= 2)
            this.startHand();
    }
    startHand() {
        this.handNo++;
        this.handActive = true;
        this.stage = "preflop";
        this.board = [];
        this.handEvents = [];
        this.seed = Math.floor(this.deps.random() * 4294967296) >>> 0;
        const hex = seedToHex(this.seed);
        this.seedHash = this.deps.sha256 ? this.deps.sha256(hex) : `sha256:${hex}`;
        this.deck = deckFromSeed(this.seed);
        for (const s of this.seats) {
            if (!s)
                continue;
            if (s.benchRounds > 0) {
                s.benchRounds--;
                s.benched = s.benchRounds > 0;
            }
            s.lastAction = null;
            s.lastActionBy = null;
            s.revealed = false;
            s.passed = false;
            s.decided = false;
            s.stayed = false;
            s.cards = [];
            s.timeBankMs = this.cfg.timeBankSec * 1000;
            if (s.autoWait) {
                s.autoWait = false;
                s.sittingOut = false;
            }
        }
        this.button =
            this.button === null
                ? (this.nextSeat(this.seats.length - 1, 1, (s) => this.eligibleForHand(s)) ?? 0)
                : (this.nextSeat(this.button, 1, (s) => this.eligibleForHand(s)) ?? this.button);
        const participants = this.handEligibleSeats();
        this.ev({
            t: "hand_start",
            handNo: this.handNo,
            seedHash: this.seedHash,
            seat: this.button ?? 0,
            amount: 0,
            kind: this.cfg.variant,
        });
        const cardsPer = this.cfg.variant === "plo4" ? 4 : 2;
        for (let round = 0; round < cardsPer; round++) {
            for (const s of participants) {
                s.cards.push(this.drawCard());
            }
        }
        this.ev({ t: "deal", kind: "hole", cardsPer }, true);
        this.ev({
            t: "phase",
            stage: "preflop",
            seats: participants.map((s) => s.seatId),
        });
        this.beginPhase(participants);
    }

    drawCard() {
        const c = this.deck.pop();
        if (c !== undefined)
            return c;
        this.deck = deckFromSeed((this.seed ^ Math.imul(this.handNo + 1, 0x9e3779b9)) >>> 0);
        return this.deck.pop();
    }
    participants() {
        // People still contesting the hand: dealt in, not passed, not sitting out.
        return this.seats.filter((s) => !!s && s.cards.length > 0 && !s.passed && !s.sittingOut && !s.benched);
    }
    beginPhase(participants) {
        const first = this.nextSeat(this.button, 1, (s) => !s.decided && participants.includes(s));
        if (first === null) {
            this.onPhaseClosed();
            return;
        }
        this.toAct = first;
        this.armActionTimer();
        this.dirty();
    }
    legalActionsFor(seatId) {
        const s = this.seats[seatId];
        if (!s || this.toAct !== seatId || !this.handActive || this.paused)
            return { canStay: false, canPass: false };
        return { canStay: true, canPass: !this.cfg.noPass };
    }
    act(playerId, type) {
        const seat = this.seatOf(playerId);
        if (!seat)
            return { ok: false, error: "not_seated" };
        if (this.closed)
            return { ok: false, error: "table_closed" };
        if (!this.handActive || this.paused)
            return { ok: false, error: "not_your_turn" };
        if (this.toAct !== seat.seatId)
            return { ok: false, error: "not_your_turn" };
        if (type !== "stay" && type !== "pass")
            return { ok: false, error: "unknown_action" };
        const legal = this.legalActionsFor(seat.seatId);
        if (!legal.canStay)
            return { ok: false, error: "not_your_turn" };
        if (type === "pass" && !legal.canPass)
            return { ok: false, error: "pass_not_allowed" };
        this.cancelActionTimer();
        seat.decided = true;
        seat.stayed = type === "stay";
        seat.passed = type === "pass";
        seat.lastAction = type;
        seat.lastActionBy = null;
        this.timeOuts.delete(seat.seatId);
        this.ev({ t: "action", seat: seat.seatId, kind: type, amount: 0 });
        this.advanceAction();
        return { ok: true };
    }
    advanceAction() {
        const next = this.nextSeat(this.toAct, 1, (s) => !s.decided && this.participants().includes(s));
        if (next === null) {
            this.onPhaseClosed();
            return;
        }
        this.toAct = next;
        this.armActionTimer();
        this.dirty();
    }
    armActionTimer() {
        this.cancelActionTimer();
        if (this.toAct === null)
            return;
        const s = this.seats[this.toAct];
        if (!s)
            return;
        const ms = this.cfg.actionTimerSec * 1000 + s.timeBankMs;
        this.turnDeadline = this.now() + ms;
        this.hAction = this.deps.timers.schedule(() => {
            this.autoAct(s.seatId);
        }, ms);
    }
    cancelActionTimer() {
        if (this.hAction) {
            this.deps.timers.cancel(this.hAction);
            this.hAction = null;
        }
    }
    autoAct(seatId) {
        if (this.closed)
            return;
        if (!this.handActive || this.toAct !== seatId || this.paused)
            return;
        const s = this.seats[seatId];
        if (!s)
            return;
        const type = this.cfg.noPass ? "stay" : "pass";
        s.timeBankMs = 0;
        s.lastActionBy = "time";
        const misses = (this.timeOuts.get(seatId) ?? 0) + 1;
        this.timeOuts.set(seatId, misses);
        this.ev({ t: "action", seat: seatId, kind: type, amount: 0, by: "time" });
        s.decided = true;
        s.stayed = type === "stay";
        s.passed = type === "pass";
        s.lastAction = type;
        if (this.cfg.mode === "cash" && misses >= 3 && !s.sittingOut && !s.benched) {
            s.sittingOut = true;
            this.ev({ t: "note", seat: seatId, text: "auto_sitout" });
        }
        this.advanceAction();
    }
    onPhaseClosed() {
        this.toAct = null;
        this.cancelActionTimer();
        const stayers = this.participants().filter((s) => s.stayed);
        this.dirty();
        if (stayers.length === 0) {
            this.ev({ t: "note", text: "round_skipped" });
            this.endHand([], []);
            return;
        }
        if (stayers.length === 1) {
            this.walkover(stayers[0]);
            return;
        }
        if (this.stage === "river") {
            this.showdown(stayers);
            return;
        }
        const nextStage = this.stage === "preflop" ? "flop" : this.stage === "flop" ? "turn" : "river";
        this.stage = nextStage;
        if (nextStage === "flop")
            this.board.push(this.drawCard(), this.drawCard(), this.drawCard());
        else
            this.board.push(this.drawCard());
        this.ev({ t: "street", stage: nextStage, cards: this.boardCardsFor(nextStage) });
        this.ev({
            t: "phase",
            stage: nextStage,
            seats: stayers.map((s) => s.seatId),
        });
        this.beginPhase(stayers);
    }
    boardCardsFor(stage) {
        if (stage === "flop")
            return this.board.slice(0, 3);
        if (stage === "turn")
            return this.board.slice(0, 4);
        if (stage === "river")
            return this.board.slice(0, 5);
        return this.board;
    }
    scoreFor(s, board) {
        return this.cfg.variant === "plo4" ? evalOmaha(s.cards, board) : evalBest([...s.cards, ...board]);
    }
    walkover(winner) {
        this.stage = "payout";
        const amount = WALKOVER_POINTS;
        winner.points += amount;
        this.ev({ t: "payout", pot: 0, winners: [{ seat: winner.seatId, amount, walkover: true }] });
        this.endHand([{ seat: winner.seatId, amount }], []);
    }
    showdown(stayers) {
        this.stage = "showdown";
        this.revealAll(stayers);
        let best = null;
        let winners = [];
        for (const s of stayers) {
            const score = this.scoreFor(s, this.board);
            if (!best || score.score > best.score) {
                best = score;
                winners = [s];
            }
            else if (score.score === best.score) {
                winners.push(s);
            }
        }
        const losers = stayers.filter((s) => !winners.includes(s));
        const total = SHOWDOWN_BASE_POINTS + SHOWDOWN_PER_LOSER * losers.length;
        const entries = this.splitPoints(total, winners.map((s) => s.seatId));
        for (const e of entries) {
            const s = this.seats[e.seat];
            if (s)
                s.points += e.amount;
        }
        this.ev({
            t: "showdown",
            winners: entries.map((e) => ({ seat: e.seat, amount: e.amount, label: best.label })),
        });
        for (const l of losers) {
            l.strikes += 1;
            this.ev({ t: "strike", seat: l.seatId, amount: l.strikes });
            this.applyStrike(l);
        }
        this.ev({
            t: "payout",
            pot: 0,
            winners: entries.map((e) => ({ seat: e.seat, amount: e.amount, label: best.label })),
        });
        this.endHand(entries.map((e) => ({ seat: e.seat, amount: e.amount })), []);
    }
    applyStrike(s) {
        const pid = realId(s);
        if (this.cfg.mode === "tournament") {
            if (s.strikes >= STRIKES_TO_BENCH && pid) {
                this.ev({ t: "note", seat: s.seatId, text: "eliminated" });
                this.deps.onStrike?.({ playerId: pid, strikes: s.strikes, eliminated: true });
            }
            return;
        }
        if (s.strikes >= STRIKES_TO_BENCH) {
            s.strikes = 0;
            s.benchRounds = BENCH_ROUNDS;
            s.benched = true;
            this.ev({ t: "note", seat: s.seatId, text: "benched" });
        }
    }
    splitPoints(total, winnerSeats) {
        if (winnerSeats.length === 0 || total <= 0)
            return [];
        const base = Math.floor(total / winnerSeats.length);
        let remainder = total - base * winnerSeats.length;
        const ring = this.ringFromButton();
        const ordered = [...winnerSeats].sort((a, b) => ring.indexOf(a) - ring.indexOf(b));
        return ordered.map((seat, i) => ({
            seat,
            amount: base + (i < remainder ? 1 : 0),
        }));
    }
    revealAll(participants) {
        for (const s of participants) {
            if (!s.revealed) {
                s.revealed = true;
                this.ev({ t: "reveal", seat: s.seatId, cards: [...s.cards] });
            }
        }
    }
    ringFromButton() {
        const seated = this.seats.filter((s) => !!s).map((s) => s.seatId);
        if (this.button === null || seated.length === 0)
            return seated;
        const start = seated.indexOf(this.button);
        const startIdx = start >= 0 ? start : seated.length - 1;
        const ring = [];
        for (let i = 1; i <= seated.length; i++) {
            ring.push(seated[(startIdx + i) % seated.length]);
        }
        return ring;
    }
    endHand(entries, _refunds) {
        this.stage = "payout";
        // PRIVACY (seed): a raw seed reconstructs the whole deck → every hole card
        // of the round. Only the commitment hash is public; the seed itself goes to
        // the room layer via deps.onHandEnd (server-side persistence) below.
        this.ev({ t: "hand_end", seedHash: this.seedHash, handNo: this.handNo });
        const payoutEntries = entries
            .map((e) => ({
                seat: e.seat,
                playerId: this.seats[e.seat] ? realId(this.seats[e.seat]) ?? "" : "",
                delta: e.amount,
            }))
            .filter((e) => e.playerId && !e.playerId.startsWith("leaving:"));
        const wonBy = new Map();
        for (const e of entries)
            wonBy.set(e.seat, (wonBy.get(e.seat) ?? 0) + e.amount);
        const nets = [];
        for (const s of this.participants()) {
            const pid = realId(s);
            if (!pid || pid.startsWith("leaving:"))
                continue;
            const won = wonBy.get(s.seatId) ?? 0;
            nets.push({ seat: s.seatId, playerId: pid, won, net: won });
        }
        this.deps.onPayout({ handNo: this.handNo, entries: payoutEntries, nets });
        this.lastHandSummary = this.handEvents.filter((e) => e.t !== "deal");
        this.deps.onHandEnd({
            handNo: this.handNo,
            seed: seedToHex(this.seed),
            seedHash: this.seedHash,
            events: clone(this.handEvents),
        });
        this.handActive = false;
        this.toAct = null;
        const leaving = this.clearLeavingSeats();
        if (leaving.length)
            this.deps.onPlayersLeft(leaving);
        for (const s of this.seats) {
            if (s) {
                s.revealed = false;
                s.passed = false;
                s.decided = false;
                s.stayed = false;
                s.lastAction = null;
                s.lastActionBy = null;
                s.cards = [];
            }
        }
        this.board = [];
        this.stage = "lobby";
        this.dirty();
        if (this.cfg.mode === "cash" && !this.closed) {
            this.scheduleNextHand(NEXT_HAND_DELAY_MS);
        }
    }

    abortHand() {
        if (!this.handActive)
            return;
        this.cancelActionTimer();
        for (const s of this.seats) {
            if (!s)
                continue;
            s.revealed = false;
            s.passed = false;
            s.decided = false;
            s.stayed = false;
            s.cards = [];
            s.lastAction = null;
            s.lastActionBy = null;
        }
        this.handActive = false;
        this.toAct = null;
        this.stage = "lobby";
        this.board = [];
        this.ev({ t: "note", text: "hand_void" });
        this.dirty();
    }

    scheduleNextHand(delayMs = NEXT_HAND_DELAY_MS) {
        if (this.hNext)
            this.deps.timers.cancel(this.hNext);
        this.hNext = this.deps.timers.schedule(() => {
            this.hNext = null;
            this.tryStartHand();
        }, delayMs);
    }
    pause(on) {
        if (on === this.paused)
            return;
        if (on) {
            this.paused = true;
            this.pausedRemainingAction = this.hAction ? Math.max(0, this.turnDeadline - this.now()) : 0;
            this.hadActionTimer = !!this.hAction;
            this.cancelActionTimer();
            if (this.hNext) {
                this.deps.timers.cancel(this.hNext);
                this.hNext = null;
            }
        }
        else {
            this.paused = false;
            if (this.hadActionTimer && this.toAct !== null) {
                this.turnDeadline = this.now() + this.pausedRemainingAction;
                this.hAction = this.deps.timers.schedule(() => this.autoAct(this.toAct), this.pausedRemainingAction);
            }
            if (!this.handActive)
                this.scheduleNextHand(1500);
        }
        this.dirty();
    }
    close() {
        this.closed = true;
        this.cancelActionTimer();
        if (this.hNext)
            this.deps.timers.cancel(this.hNext);
    }
    snapshotFor(viewer) {
        const seats = this.seats.map((s) => {
            if (!s)
                return null;
            const pid = realId(s);
            const isSelf = pid === viewer.playerId;
            const isBotSeat = typeof pid === "string" && pid.startsWith("bot:");
            const showCards = s.cards.length > 0 &&
                (s.revealed || isSelf || (viewer.isSpectator && this.cfg.spectatorCards));
            return {
                seatId: s.seatId,
                // PRIVACY (identity): other humans' bearer tokens never leave the
                // server — clients get the opaque seatUid instead. Own seat and bot
                // ids stay real (bot ids cannot authenticate: auth requires 32-hex).
                playerId: isSelf || isBotSeat ? pid : s.seatUid,
                self: isSelf,
                isBot: isBotSeat,
                nickname: s.nickname,
                avatar: s.avatar,
                points: s.points,
                strikes: s.strikes,
                benchRounds: s.benchRounds,
                sittingOut: s.sittingOut,
                benched: s.benched,
                passed: s.passed && s.cards.length > 0,
                lastAction: s.lastAction,
                lastActionBy: s.lastActionBy ?? null,
                cards: showCards ? [...s.cards] : s.cards.length > 0 ? null : [],
                revealed: s.revealed,
                timeBankMs: s.timeBankMs,
                connected: s.connected,
                isHost: pid === this.hostId,
            };
        });
        const mySeat = this.seatOf(viewer.playerId);
        const legal = mySeat ? this.legalActionsFor(mySeat.seatId) : { canStay: false, canPass: false };
        // FAIRPLAY: the table password must never leave the server — not even to
        // players already inside. Every snapshot gets a password-free config.
        const cfgView = clone(this.cfg);
        delete cfgView.password;
        const msLeft = this.toAct !== null && !this.paused ? Math.max(0, this.turnDeadline - this.now()) : null;
        return {
            code: this.code,
            name: this.cfg.name,
            mySeatUid: mySeat ? mySeat.seatUid : null,
            config: cfgView,
            status: this.closed ? "closed" : this.paused ? "paused" : this.handActive ? "running" : "lobby",
            mode: this.cfg.mode,
            variant: this.cfg.variant,
            seats,
            board: [...this.board],
            pot: 0,
            stage: this.stage,
            handNo: this.handNo,
            buttonSeat: this.button,
            toAct: this.toAct,
            canStay: legal.canStay,
            canPass: legal.canPass,
            participants: this.participants().length,
            msLeft,
            spectators: 0,
            levelIdx: this.levelIdx,
            levelEndsAt: this.levelEndsAt,
            tournamentId: this.tournamentId,
            lastHandSummary: this.lastHandSummary ? clone(this.lastHandSummary) : null,
        };
    }

    exportEvents() {
        return clone(this.handEvents.filter((e) => e.t !== "deal"));
    }
    lastEvents(n) {
        return this.handEvents.filter((e) => e.t !== "deal").slice(-n);
    }
}