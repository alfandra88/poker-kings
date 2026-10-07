/**
 * Poker Kings — authoritative table state machine.
 *
 * Invariants enforced here:
 *  - Chips are conserved: Σ(seat stacks) + Σ(committed this hand) == total bought in.
 *  - Hidden info never leaves the engine except through redaction (snapshotFor).
 *  - The action loop always terminates: every degenerate path reaches payout.
 */
import { deckFromSeed, evalBest, evalOmaha, seedToHex } from "./cards.js";
import { buildPots, refundUncalled, splitPot } from "./pots.js";
const NEXT_HAND_DELAY_MS = 4000;
const FOLD_WIN_DELAY_MS = 2500;
const RIT_VOTE_MS = 6000;
const RUNOUT_STEP_MS = 900;
function clone(v) {
    return JSON.parse(JSON.stringify(v));
}
function realId(seat) {
    const pid = seat.playerId;
    if (!pid)
        return null;
    return pid.startsWith("leaving:") ? pid.slice("leaving:".length) : pid;
}
export class PokerTable {
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
    board2 = [];
    currentBet = 0;
    lastRaiseSize = 0;
    acted = new Set();
    restrictedRaise = new Set();
    toAct = null;
    lastAggressor = null;
    turnDeadline = 0;
    seed = 0;
    seedHash = "";
    handEvents = [];
    lastHandSummary = null;
    ritMode = false;
    ritVotes = new Map();
    ritWaiting = false;
    timeOuts = new Map();     pendingBlinds = null;
    rabbitDeck = [];
    rabbitStage = null;
    rabbitRevealedBy = new Set();
    hAction = null;
    hNext = null;
    hRunout = null;
    hRit = null;
    pausedRemainingAction = 0;
    hadActionTimer = false;
    levelIdx = 0;
    levelEndsAt = null;
    tournamentId;
    constructor(code, cfg, deps, host) {
        this.code = code;
        this.cfg = clone(cfg);
        // PRIVACY (defense in depth): the engine itself clamps spectator reveal off
        // so no service layer can accidentally re-enable public hole cards.
        this.cfg.spectatorCards = false;
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
    bb() {
        return this.cfg.bigBlind;
    }
    seatOf(playerId) {
        return this.seats.find((s) => s && realId(s) === playerId) ?? null;
    }
    eligibleForHand(s) {
        return !s.sittingOut && s.stack > 0;
    }
    handEligibleSeats() {
        return this.seats.filter((s) => s !== null && this.eligibleForHand(s));
    }
    seatedPlayers() {
        return this.seats
            .filter((s) => !!s && !!realId(s))
            .map((s) => ({ playerId: realId(s), stack: s.stack }));
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
    canActNow(s) {
        return !s.folded && !s.allIn && !s.sittingOut && s.stack > 0 && this.handActive;
    }
    sitDown(seatId, player, buyIn) {
        if (this.closed)
            return { ok: false, error: "table_closed" };
        if (this.seatOf(player.playerId))
            return { ok: false, error: "already_seated" };
        if (seatId < 0 || seatId >= this.seats.length)
            return { ok: false, error: "bad_seat" };
        if (this.seats[seatId])
            return { ok: false, error: "seat_taken" };
        let stack;
        if (this.cfg.mode === "tournament") {
            stack = this.cfg.startingStack;
        }
        else {
            const min = this.cfg.minBuyIn;
            const max = this.cfg.maxBuyIn > 0 ? this.cfg.maxBuyIn : Infinity;
            if (buyIn < min)
                return { ok: false, error: "buy_in_too_low" };
            if (buyIn > max)
                return { ok: false, error: "buy_in_too_high" };
            stack = buyIn;
        }
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
            stack,
            betThisStreet: 0,
            committedThisHand: 0,
            folded: false,
            allIn: false,
            sittingOut: this.handActive,
            autoWait: this.handActive,
            straddleIntent: false,
            lastAction: null,
            lastActionAmount: 0,
            cards: [],
            revealed: false,
            timeBankMs: this.cfg.timeBankSec * 1000,
            handNoRebuy: false,
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
                return this.sitDown(i, player, this.cfg.startingStack).ok;
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
            if (!s.folded && !s.allIn)
                this.doFold(s, true);
            s.playerId = `leaving:${playerId}`;
            this.foldAndAdvanceIfTurn(s);
            this.dirty();
            return { ok: true, stack: 0 };         }
        const stack = s.stack;
        this.seats[idx] = null;
        this.dirty();
        return { ok: true, stack };
    }
    clearLeavingSeats() {
        const out = [];
        for (let i = 0; i < this.seats.length; i++) {
            const s = this.seats[i];
            if (s && s.playerId?.startsWith("leaving:")) {
                out.push({ playerId: realId(s), stack: s.stack });
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
        this.foldAndAdvanceIfTurn(s);
        this.dirty();
        return true;
    }

    foldAndAdvanceIfTurn(s) {
        if (this.handActive && this.toAct === s.seatId) {
            this.cancelActionTimer();
            this.advanceAction();
        }
    }
    straddleToggle(playerId, on) {
        const s = this.seatOf(playerId);
        if (!s || !this.cfg.straddle || this.cfg.mode !== "cash")
            return false;
        s.straddleIntent = on;
        this.dirty();
        return true;
    }

    addChips(playerId, amount) {
        if (this.cfg.mode !== "cash" || !Number.isFinite(amount))
            return false;
        const s = this.seatOf(playerId);
        if (!s || amount <= 0)
            return false;
        const liveInHand = this.handActive && s.cards.length > 0 && !s.folded && !s.allIn && !s.sittingOut;
        if (liveInHand)
            return false;
        const max = this.cfg.maxBuyIn > 0 ? this.cfg.maxBuyIn : Infinity;
        s.stack = Math.min(s.stack + Math.floor(amount), Math.max(s.stack, max));
        this.dirty();
        if (this.cfg.mode === "cash" && !this.handActive && !this.paused && !this.closed) {
            this.scheduleNextHand(1200);
        }
        return true;
    }
    removePlayer(playerId) {
        const idx = this.seats.findIndex((s) => s && realId(s) === playerId);
        if (idx < 0)
            return;
        const s = this.seats[idx];
        if (this.handActive) {
            if (!s.folded && !s.allIn)
                this.doFold(s, true);
            s.playerId = `leaving:${playerId}`;
            this.foldAndAdvanceIfTurn(s);
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
    setBlinds(level) {
        this.cfg.smallBlind = level.sb;
        this.cfg.bigBlind = level.bb;
        this.cfg.ante = level.ante;
    }
    setLevelInfo(idx, endsAt) {
        this.levelIdx = idx;
        this.levelEndsAt = endsAt;
    }
    updateConfig(patch) {
        const locked = ["mode", "variant", "maxSeats", "entryFee"];
        const handLocked = ["smallBlind", "bigBlind", "ante"];
        for (const k of Object.keys(patch)) {
            if (locked.includes(k))
                continue;
            if (handLocked.includes(k)) {
                if (this.handActive) {
                    this.pendingBlinds = {
                        ...this.pendingBlinds,
                        ...(k === "smallBlind" ? { smallBlind: patch[k] }
                            : k === "bigBlind" ? { bigBlind: patch[k] }
                                : { ante: patch[k] }),
                    };
                    continue;
                }
            }
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
        if (this.pendingBlinds) {
            Object.assign(this.cfg, this.pendingBlinds);
            this.pendingBlinds = null;
        }
        this.board = [];
        this.board2 = [];
        this.currentBet = 0;
        this.lastRaiseSize = this.bb();
        this.acted.clear();
        this.restrictedRaise.clear();
        this.lastAggressor = null;
        this.ritMode = false;
        this.ritVotes.clear();
        this.ritWaiting = false;
        this.rabbitDeck = [];
        this.rabbitStage = null;
        this.rabbitRevealedBy.clear();
        this.handEvents = [];
        this.seed = Math.floor(this.deps.random() * 4294967296) >>> 0;
        const hex = seedToHex(this.seed);
        this.seedHash = this.deps.sha256 ? this.deps.sha256(hex) : `sha256:${hex}`;
        this.deck = deckFromSeed(this.seed);
        for (const s of this.seats) {
            if (!s)
                continue;
            s.folded = false;
            s.allIn = false;
            s.lastAction = null;
            s.lastActionAmount = 0;
            s.lastActionBy = null;
            s.committedThisHand = 0;
            s.betThisStreet = 0;
            s.revealed = false;
            s.cards = [];
            s.timeBankMs = this.cfg.timeBankSec * 1000;
            if (s.autoWait) {
                s.autoWait = false;
                if (s.stack > 0)
                    s.sittingOut = false;
            }
        }
        this.button =
            this.button === null
                ? (this.nextSeat(this.seats.length - 1, 1, (s) => this.eligibleForHand(s)) ?? 0)
                : (this.nextSeat(this.button, 1, (s) => this.eligibleForHand(s)) ?? this.button);
        const seats = this.handEligibleSeats();
        const n = seats.length;
        this.ev({
            t: "hand_start",
            handNo: this.handNo,
            seedHash: this.seedHash,
            seat: this.button ?? 0,
            amount: this.bb(),
            kind: `${this.cfg.smallBlind}/${this.cfg.bigBlind}`,
        });
        if (this.cfg.ante > 0) {
            for (const s of seats) {
                const amt = Math.min(this.cfg.ante, s.stack);
                s.stack -= amt;
                s.committedThisHand += amt;
                s.lastAction = "ante";
                s.lastActionAmount = amt;
                if (s.stack === 0)
                    s.allIn = true;
                this.ev({ t: "post", seat: s.seatId, kind: "ante", amount: amt });
            }
        }
        const hu = n === 2;
        const elig = (s) => this.eligibleForHand(s);
        const sbSeat = hu ? this.button : this.nextSeat(this.button, 1, elig);
        const bbSeat = this.nextSeat(sbSeat, 1, elig);
        this.postBlind(sbSeat, this.cfg.smallBlind, "sb");
        this.postBlind(bbSeat, this.cfg.bigBlind, "bb");
        this.currentBet = Math.max(this.cfg.bigBlind, ...this.seats.map((s) => s?.betThisStreet ?? 0));
        this.lastRaiseSize = this.bb();
        if (this.cfg.straddle && this.cfg.mode === "cash" && n >= 3) {
            const strSeat = this.nextSeat(bbSeat, 1, (s) => this.eligibleForHand(s) && s.straddleIntent && s.stack >= 2 * this.bb());
            if (strSeat !== null) {
                const s = this.seats[strSeat];
                const amt = Math.min(2 * this.bb(), s.stack);
                s.stack -= amt;
                s.committedThisHand += amt;
                s.betThisStreet += amt;
                s.lastAction = "straddle";
                s.lastActionAmount = amt;
                if (s.stack === 0)
                    s.allIn = true;
                this.currentBet = amt;
                this.lastRaiseSize = amt;
                this.ev({ t: "post", seat: strSeat, kind: "straddle", amount: amt });
            }
        }
        const cardsPer = this.cfg.variant === "plo4" ? 4 : 2;
        for (let round = 0; round < cardsPer; round++) {
            for (const s of seats) {
                s.cards.push(this.drawCard());
            }
        }
        this.ev({ t: "deal", kind: "hole", cardsPer }, true);
        const startFrom = this.straddlerSeat() ?? bbSeat;
        this.beginBettingRound(startFrom);
    }
    straddlerSeat() {
        for (const s of this.seats)
            if (s && s.lastAction === "straddle")
                return s.seatId;
        return null;
    }
    postBlind(seatId, amount, kind) {
        const s = this.seats[seatId];
        if (!s)
            return;
        const amt = Math.min(amount, s.stack);
        s.stack -= amt;
        s.committedThisHand += amt;
        s.betThisStreet += amt;
        s.lastAction = kind;
        s.lastActionAmount = amt;
        s.lastActionBy = null;
        if (s.stack === 0)
            s.allIn = true;
        this.ev({ t: "post", seat: seatId, kind, amount: amt });
    }

    drawCard() {
        const c = this.deck.pop();
        if (c !== undefined)
            return c;
        this.deck = deckFromSeed((this.seed ^ Math.imul(this.handNo + 1, 0x9e3779b9)) >>> 0);
        return this.deck.pop();
    }
    beginBettingRound(fromSeat) {
        const first = this.nextSeat(fromSeat, 1, (s) => !this.isDone(s) && this.canActNow(s));
        if (first === null) {
            this.onStreetClosed();
            return;
        }
        this.toAct = first;
        this.armActionTimer();
        this.dirty();
    }
    isDone(s) {
        if (s.folded || s.allIn || s.sittingOut || s.stack <= 0)
            return true;
        if (s.betThisStreet < this.currentBet)
            return false;
        return this.acted.has(s.seatId);
    }
    legalActionsFor(seatId) {
        const s = this.seats[seatId];
        const empty = {
            canFold: false, canCheck: false, canCall: false, callAmount: 0,
            canBet: false, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0,
            potAfterCall: this.potTotal(),
        };
        if (!s || this.toAct !== seatId || !this.handActive || this.paused || this.ritWaiting)
            return empty;
        const toCall = Math.max(0, this.currentBet - s.betThisStreet);
        const potNow = this.potTotal();
        const canCheck = toCall === 0;
        const callAmount = Math.min(toCall, s.stack);
        const maxRaiseTo = s.betThisStreet + s.stack;
        const openBetMin = this.bb();
        const minRaiseToRaw = this.currentBet === 0 ? openBetMin : this.currentBet + this.lastRaiseSize;
        const minRaiseTo = Math.min(minRaiseToRaw, maxRaiseTo);
        const canRaise = s.stack > toCall &&
            !this.restrictedRaise.has(seatId) &&
            maxRaiseTo > (this.currentBet === 0 ? openBetMin - 1 : this.currentBet);
        return {
            canFold: true,
            canCheck,
            canCall: toCall > 0 && s.stack > 0,
            callAmount,
            canBet: canCheck && canRaise && this.currentBet === 0,
            canRaise,
            minRaiseTo,
            maxRaiseTo,
            potAfterCall: potNow + callAmount,
        };
    }
    potTotal() {
        return this.seats.reduce((a, s) => a + (s?.committedThisHand ?? 0), 0);
    }
    act(playerId, type, to) {
        const seat = this.seatOf(playerId);
        if (!seat)
            return { ok: false, error: "not_seated" };
        if (this.closed)
            return { ok: false, error: "table_closed" };
        if (!this.handActive || this.paused || this.ritWaiting)
            return { ok: false, error: "not_your_turn" };
        if (this.toAct !== seat.seatId)
            return { ok: false, error: "not_your_turn" };
        const legal = this.legalActionsFor(seat.seatId);
        this.cancelActionTimer();
        switch (type) {
            case "fold": {
                this.doFold(seat);
                break;
            }
            case "check": {
                if (!legal.canCheck)
                    return { ok: false, error: "cannot_check" };
                seat.lastAction = "check";
                seat.lastActionBy = null;
                this.ev({ t: "action", seat: seat.seatId, kind: "check", amount: 0 });
                break;
            }
            case "call": {
                if (!legal.canCall)
                    return { ok: false, error: "cannot_call" };
                this.applyCall(seat, legal);
                break;
            }
            case "bet":
            case "raise": {
                const rawTarget = to ?? legal.minRaiseTo;
                if (typeof rawTarget !== "number" || !Number.isFinite(rawTarget)) {
                    return { ok: false, error: "bad_amount" };
                }
                if (seat.stack <= Math.max(0, this.currentBet - seat.betThisStreet)) {
                    if (legal.canCall) {
                        this.applyCall(seat, legal);
                        break;
                    }
                    return { ok: false, error: "cannot_raise" };
                }
                let target = Math.floor(rawTarget);
                if (target <= this.currentBet) {
                    return { ok: false, error: "raise_too_small" };
                }
                if (!legal.canRaise)
                    return { ok: false, error: "cannot_raise" };
                const isAllIn = target >= legal.maxRaiseTo;
                if (isAllIn)
                    target = legal.maxRaiseTo;
                const minTo = this.currentBet === 0 ? this.bb() : legal.minRaiseTo;
                if (!isAllIn && target < minTo)
                    return { ok: false, error: "raise_too_small" };
                const add = target - seat.betThisStreet;
                seat.stack -= add;
                seat.betThisStreet = target;
                seat.committedThisHand += add;
                if (seat.stack === 0)
                    seat.allIn = true;
                const raiseSize = this.currentBet === 0 ? target : target - this.currentBet;
                const fullRaise = this.currentBet === 0 || raiseSize >= this.lastRaiseSize;
                if (fullRaise) {
                    this.acted = new Set([seat.seatId]);
                    this.lastRaiseSize = raiseSize;
                    this.restrictedRaise.clear();
                }
                else {
                    for (const s of this.seats) {
                        if (s && s.seatId !== seat.seatId && this.acted.has(s.seatId) && !s.folded && !s.allIn) {
                            this.restrictedRaise.add(s.seatId);
                        }
                    }
                }
                this.currentBet = Math.max(this.currentBet, target);
                this.lastAggressor = seat.seatId;
                seat.lastAction = isAllIn ? "allin" : "raise";
                seat.lastActionAmount = target;
                seat.lastActionBy = null;
                this.ev({ t: "action", seat: seat.seatId, kind: seat.lastAction, amount: add, to: target });
                break;
            }
            default: {
                return { ok: false, error: "unknown_action" };
            }
        }
        this.timeOuts.delete(seat.seatId);         this.acted.add(seat.seatId);
        this.advanceAction();
        return { ok: true };
    }
    applyCall(seat, legal) {
        const amt = legal.callAmount;
        seat.stack -= amt;
        seat.betThisStreet += amt;
        seat.committedThisHand += amt;
        seat.lastActionBy = null;
        const allin = seat.stack === 0;
        if (allin)
            seat.allIn = true;
        seat.lastAction = allin ? "allin" : "call";
        seat.lastActionAmount = seat.betThisStreet;
        this.ev({
            t: "action", seat: seat.seatId, kind: allin ? "allin" : "call",
            amount: amt, to: seat.betThisStreet,
        });
    }
    doFold(s, silent = false) {
        s.folded = true;
        s.lastAction = "fold";
        s.lastActionAmount = 0;
        if (!silent)
            s.lastActionBy = null;         if (!silent)
            this.ev({ t: "action", seat: s.seatId, kind: "fold", amount: 0 });
    }
    advanceAction() {
        const live = this.seats.filter((s) => !!s && !s.folded && !s.sittingOut);
        if (live.length === 1 && this.handActive) {
            this.finishByFolds(live[0]);
            return;
        }
        const next = this.nextSeat(this.toAct, 1, (s) => !this.isDone(s) && this.canActNow(s));
        if (next === null) {
            this.onStreetClosed();
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
        const legal = this.legalActionsFor(seatId);
        s.timeBankMs = 0;
        s.lastActionBy = "time";         const misses = (this.timeOuts.get(seatId) ?? 0) + 1;
        this.timeOuts.set(seatId, misses);
        if (legal.canCheck) {
            this.ev({ t: "action", seat: seatId, kind: "check", amount: 0, by: "time" });
            s.lastAction = "check";
            this.acted.add(seatId);
            this.advanceAction();
        }
        else {
            this.ev({ t: "action", seat: seatId, kind: "fold", amount: 0, by: "time" });
            this.doFold(s, true);
            this.acted.add(seatId);
            if (this.cfg.mode === "cash" && misses >= 3 && !s.sittingOut) {
                s.sittingOut = true;
                this.ev({ t: "note", seat: seatId, text: "auto_sitout" });
            }
            this.advanceAction();
        }
    }
    onStreetClosed() {
        this.toAct = null;
        this.cancelActionTimer();
        for (const s of this.seats)
            if (s)
                s.betThisStreet = 0;
        this.currentBet = 0;
        this.lastRaiseSize = this.bb();
        this.acted.clear();
        this.restrictedRaise.clear();
        this.dirty();
        const live = this.seats.filter((s) => !!s && !s.folded && !s.sittingOut);
        if (live.length === 1) {
            this.finishByFolds(live[0]);
            return;
        }
        if (this.stage === "river") {
            this.showdown();
            return;
        }
        const nextStage = this.stage === "preflop" ? "flop" : this.stage === "flop" ? "turn" : "river";
        const canActPlayers = live.filter((s) => !s.allIn && s.stack > 0);
        if (canActPlayers.length <= 1) {
            if (this.cfg.revealAllIn)
                this.revealAll(live);
            if (this.cfg.runItTwice && live.length >= 2) {
                this.startRitVote(live);
                return;
            }
            this.startRunout(false);
            return;
        }
        this.stage = nextStage;
        this.dealStreet(nextStage);
        this.ev({ t: "street", stage: nextStage, cards: this.boardCardsFor(nextStage), pot: this.potTotal() });
        const first = this.nextSeat(this.button, 1, (s) => !this.isDone(s) && this.canActNow(s));
        if (first === null) {
            this.onStreetClosed();
            return;
        }
        this.toAct = first;
        this.armActionTimer();
        this.dirty();
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
    dealStreet(stage) {
        if (stage === "flop") {
            this.board.push(this.drawCard(), this.drawCard(), this.drawCard());
        }
        else if (stage === "turn") {
            this.board.push(this.drawCard());
        }
        else if (stage === "river") {
            this.board.push(this.drawCard());
        }
        this.stage = stage;
    }
    startRitVote(live) {
        this.ritWaiting = true;
        this.ritVotes.clear();
        this.ev({ t: "rit_vote", kind: "prompt", seats: live.map((s) => s.seatId) });
        this.hRit = this.deps.timers.schedule(() => this.resolveRitVote(), RIT_VOTE_MS);
        this.dirty();
    }
    voteRit(playerId, yes) {
        if (!this.ritWaiting)
            return false;
        const s = this.seatOf(playerId);
        if (!s || s.folded || s.sittingOut)
            return false;
        this.ritVotes.set(s.seatId, yes);
        this.ev({ t: "rit_vote", seat: s.seatId, amount: yes ? 1 : 0 });
        const live = this.seats.filter((x) => !!x && !x.folded && !x.sittingOut);
        if (live.every((x) => this.ritVotes.has(x.seatId))) {
            if (this.hRit) {
                this.deps.timers.cancel(this.hRit);
                this.hRit = null;
            }
            this.resolveRitVote();
        }
        return true;
    }
    resolveRitVote() {
        if (!this.ritWaiting)
            return;
        this.ritWaiting = false;
        if (this.hRit) {
            this.deps.timers.cancel(this.hRit);
            this.hRit = null;
        }
        const live = this.seats.filter((x) => !!x && !x.folded && !x.sittingOut);
        const allYes = live.length >= 2 && live.every((x) => this.ritVotes.get(x.seatId) === true);
        this.ritMode = allYes;
        this.ev({ t: "rit_vote", kind: "result", amount: allYes ? 1 : 0 });
        this.startRunout(allYes);
    }
    startRunout(twice) {
        this.ritMode = twice;
        const runNext = () => {
            if (this.stage === "river") {
                this.showdown();
                return;
            }
            const stage = this.stage === "preflop" ? "flop" : this.stage === "flop" ? "turn" : "river";
            this.dealStreet(stage);
            this.ev({ t: "all_in_runout", stage, cards: this.boardCardsFor(stage), pot: this.potTotal() });
            if (twice) {
                if (stage === "flop")
                    this.board2 = [...this.board.slice(0, 3)];
                else
                    this.board2.push(this.drawCard());
                this.ev({
                    t: "rit_deal",
                    stage,
                    cards: stage === "flop" ? [...this.board2] : [this.board2[this.board2.length - 1]],
                });
            }
            if (stage === "river") {
                this.showdown();
                return;
            }
            this.hRunout = this.deps.timers.schedule(runNext, RUNOUT_STEP_MS);
        };
        runNext();
    }
    revealAll(live) {
        const order = this.revealOrder(live);
        for (const s of order) {
            if (!s.revealed) {
                s.revealed = true;
                this.ev({ t: "reveal", seat: s.seatId, cards: [...s.cards] });
            }
        }
    }
    revealOrder(live) {
        const list = [...live];
        if (this.lastAggressor !== null) {
            const idx = list.findIndex((s) => s.seatId === this.lastAggressor);
            if (idx > 0) {
                const [agg] = list.splice(idx, 1);
                list.unshift(agg);
            }
        }
        return list;
    }
    scoreFor(s, board) {
        return this.cfg.variant === "plo4" ? evalOmaha(s.cards, board) : evalBest([...s.cards, ...board]);
    }
    refundAndBuild() {
        const commits = this.seats
            .filter((s) => !!s)
            .map((s) => ({ seat: s.seatId, amount: s.committedThisHand, folded: s.folded }));
        const { refunds, effective } = refundUncalled(commits);
        for (const r of refunds) {
            const s = this.seats[r.seat];
            if (s) {
                s.stack += r.amount;
                s.committedThisHand -= r.amount;
            }
        }
        return { refunds, pots: buildPots(effective) };
    }
    finishByFolds(winner) {
        const endedStage = this.stage;
        this.stage = "payout";
        const { refunds } = this.refundAndBuild();
        const pot = this.seats.reduce((a, s) => a + (s?.committedThisHand ?? 0), 0);
        winner.stack += pot;
        this.ev({ t: "payout", pot, winners: [{ seat: winner.seatId, amount: pot }] });
        this.prepareRabbit(endedStage);
        this.endHand([{ seat: winner.seatId, amount: pot }], refunds);
    }
    showdown() {
        this.stage = "showdown";
        const live = this.seats.filter((s) => !!s && !s.folded && !s.sittingOut);
        this.revealAll(live);
        const { refunds, pots } = this.refundAndBuild();
        const totalPot = pots.reduce((a, p) => a + p.amount, 0);
        const entries = [];
        const boards = [];
        if (this.ritMode && this.board2.length === 5) {
            boards.push({ board: this.board, idx: 1 });
            boards.push({ board: this.board2, idx: 2 });
        }
        else {
            boards.push({ board: this.board, idx: 1 });
        }
        const orderFromButton = this.ringFromButton();
        for (const b of boards) {
            for (const pot of pots) {
                if (pot.amount <= 0 || pot.eligible.length === 0)
                    continue;
                const contenders = pot.eligible
                    .map((seatId) => this.seats[seatId])
                    .filter((s) => !!s && !s.folded && !s.sittingOut);
                if (contenders.length === 0)
                    continue;
                let best = null;
                let bestSeats = [];
                for (const s of contenders) {
                    const score = this.scoreFor(s, b.board);
                    if (!best || score.score > best.score) {
                        best = score;
                        bestSeats = [s.seatId];
                    }
                    else if (score.score === best.score) {
                        bestSeats.push(s.seatId);
                    }
                }
                let awardTotal = pot.amount;
                if (this.ritMode) {
                    const half = Math.floor(pot.amount / 2);
                    awardTotal = b.idx === 1 ? half + (pot.amount % 2) : half;
                }
                const winners = splitPot(awardTotal, bestSeats, this.button, orderFromButton);
                for (const w of winners) {
                    const s = this.seats[w.seat];
                    if (s)
                        s.stack += w.amount;
                    entries.push({ seat: w.seat, amount: w.amount, board: b.idx, label: best.label });
                }
                this.ev({
                    t: "showdown",
                    pot: awardTotal,
                    board: b.idx,
                    winners: winners.map((w) => ({ seat: w.seat, amount: w.amount, label: best.label })),
                });
            }
        }
        const merged = new Map();
        for (const e of entries) {
            const k = `${e.seat}:${e.board ?? 1}`;
            const cur = merged.get(k);
            if (cur)
                cur.amount += e.amount;
            else
                merged.set(k, { ...e });
        }
        const finalEntries = [...merged.values()];
        this.ev({
            t: "payout",
            pot: totalPot,
            winners: finalEntries.map((e) => ({ seat: e.seat, amount: e.amount, label: e.label })),
        });
        this.endHand(finalEntries, refunds);
    }
    ringFromButton() {
        const seated = this.seats.filter((s) => !!s).map((s) => s.seatId);
        if (this.button === null || seated.length === 0)
            return seated;
        const start = seated.indexOf(this.button);
        const startIdx = start >= 0 ? start : seated.length - 1;         const ring = [];
        for (let i = 1; i <= seated.length; i++) {
            ring.push(seated[(startIdx + i) % seated.length]);
        }
        return ring;
    }
    prepareRabbit(endedStage) {
        if (!this.cfg.rabbitHunt)
            return;
        if (endedStage === "river" || endedStage === "showdown")
            return;
        const need = endedStage === "preflop" ? 5 : endedStage === "flop" ? 2 : endedStage === "turn" ? 1 : 0;
        if (need === 0)
            return;
        const remaining = [];
        for (let i = 0; i < need; i++)
            remaining.push(this.drawCard());
        this.rabbitDeck = remaining;
        this.rabbitStage = endedStage;
        this.ev({ t: "rabbit", kind: "available" });
    }
    rabbitRevealFor(playerId) {
        if (!this.rabbitDeck.length || this.rabbitStage === null)
            return null;
        if (this.rabbitRevealedBy.has(playerId))
            return null;
        const s = this.seatOf(playerId);
        if (!s || s.cards.length === 0)
            return null;
        this.rabbitRevealedBy.add(playerId);
        return { stage: this.rabbitStage, cards: [...this.rabbitDeck] };
    }
    rabbitAvailableFor(playerId) {
        return (this.cfg.rabbitHunt &&
            this.rabbitDeck.length > 0 &&
            !this.rabbitRevealedBy.has(playerId) &&
            !!this.seatOf(playerId));
    }
    endHand(entries, refunds) {
        this.stage = "payout";
        // PRIVACY (seed): a raw seed reconstructs the whole deck → every hole card
        // of the hand. Only the commitment hash is public; the seed itself goes to
        // the room layer via deps.onHandEnd (server-side persistence) below.
        this.ev({ t: "hand_end", seedHash: this.seedHash, handNo: this.handNo });
        const payoutEntries = entries
            .map((e) => ({
            seat: e.seat,
            playerId: this.seats[e.seat] ? realId(this.seats[e.seat]) ?? "" : "",
            delta: e.amount,
            label: e.label,
        }))
            .filter((e) => e.playerId && !e.playerId.startsWith("leaving:"));
        for (const r of refunds) {
            const s = this.seats[r.seat];
            const pid = s ? realId(s) : null;
            if (pid && !pid.startsWith("leaving:")) {
                payoutEntries.push({ seat: r.seat, playerId: pid, delta: r.amount });
            }
        }
        const wonBy = new Map();
        for (const e of entries)
            wonBy.set(e.seat, (wonBy.get(e.seat) ?? 0) + e.amount);
        const nets = [];
        for (const s of this.seats) {
            if (!s)
                continue;
            const pid = realId(s);
            if (!pid || pid.startsWith("leaving:"))
                continue;
            const won = wonBy.get(s.seatId) ?? 0;
            const contributed = s.committedThisHand;
            nets.push({ seat: s.seatId, playerId: pid, won, contributed, net: won - contributed });
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
                s.betThisStreet = 0;
                s.committedThisHand = 0;
                s.folded = false;
                s.allIn = false;
                s.revealed = false;
                s.lastAction = null;
                s.lastActionAmount = 0;
                s.cards = [];
            }
        }
        this.board = [];
        this.board2 = [];
        this.currentBet = 0;
        this.stage = "lobby";
        this.dirty();
        if (this.cfg.mode === "cash" && !this.closed) {
            this.scheduleNextHand(FOLD_WIN_DELAY_MS);
        }
    }

    abortHand() {
        if (!this.handActive)
            return;
        this.cancelActionTimer();
        if (this.hRunout) {
            this.deps.timers.cancel(this.hRunout);
            this.hRunout = null;
        }
        if (this.hRit) {
            this.deps.timers.cancel(this.hRit);
            this.hRit = null;
        }
        for (const s of this.seats) {
            if (!s)
                continue;
            s.stack += s.committedThisHand;             s.committedThisHand = 0;
            s.betThisStreet = 0;
            s.folded = false;
            s.allIn = false;
            s.revealed = false;
            s.cards = [];
            s.lastAction = null;
            s.lastActionAmount = 0;
        }
        this.handActive = false;
        this.toAct = null;
        this.stage = "lobby";
        this.board = [];
        this.board2 = [];
        this.currentBet = 0;
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
            this.hadActionTimer = !!this.hAction;
            this.pausedRemainingAction = this.hAction ? Math.max(0, this.turnDeadline - this.now()) : 0;
            this.cancelActionTimer();
            if (this.hRunout) {
                this.deps.timers.cancel(this.hRunout);
                this.hRunout = null;
            }
            if (this.hRit) {
                this.deps.timers.cancel(this.hRit);
                this.hRit = null;
            }
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
            else if (this.handActive && this.toAct === null && !this.ritWaiting) {
                this.startRunout(this.ritMode);
            }
            if (this.ritWaiting) {
                this.hRit = this.deps.timers.schedule(() => this.resolveRitVote(), RIT_VOTE_MS);
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
        if (this.hRunout)
            this.deps.timers.cancel(this.hRunout);
        if (this.hRit)
            this.deps.timers.cancel(this.hRit);
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
                stack: s.stack,
                bet: s.betThisStreet,
                committed: s.committedThisHand,
                folded: s.folded,
                allIn: s.allIn,
                sittingOut: s.sittingOut,
                lastAction: s.lastAction,
                lastActionAmount: s.lastActionAmount,
                lastActionBy: s.lastActionBy ?? null,
                cards: showCards ? [...s.cards] : s.cards.length > 0 ? null : [],
                revealed: s.revealed,
                timeBankMs: s.timeBankMs,
                connected: s.connected,
                isHost: pid === this.hostId,
            };
        });
        const mySeat = this.seatOf(viewer.playerId);
        let toCall = 0;
        let canCheck = false;
        let minRaiseTo = null;
        let maxRaiseTo = null;
        let canStraddleNow = false;
        if (mySeat && this.toAct === mySeat.seatId && this.handActive && !this.paused && !this.ritWaiting) {
            const legal = this.legalActionsFor(mySeat.seatId);
            toCall = legal.callAmount;
            canCheck = legal.canCheck;
            minRaiseTo = legal.canRaise ? legal.minRaiseTo : null;
            maxRaiseTo = legal.canRaise ? legal.maxRaiseTo : null;
        }
        if (mySeat &&
            this.cfg.straddle &&
            this.cfg.mode === "cash" &&
            !this.handActive &&
            mySeat.stack >= 2 * this.bb() &&
            this.handEligibleSeats().length >= 3) {
            canStraddleNow = true;
        }
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
            board2: [...this.board2],
            pot: this.potTotal(),
            potCommitted: this.potTotal() - this.seats.reduce((a, s) => a + (s?.betThisStreet ?? 0), 0),
            stage: this.stage,
            handNo: this.handNo,
            buttonSeat: this.button,
            toAct: this.toAct,
            toCall,
            minRaiseTo,
            maxRaiseTo,
            canCheck,
            canStraddleNow,
            msLeft,
            spectators: 0,
            levelIdx: this.levelIdx,
            levelEndsAt: this.levelEndsAt,
            tournamentId: this.tournamentId,
            ritPrompt: this.ritWaiting
                ? { seat: -1, votes: Object.fromEntries([...this.ritVotes.entries()].map(([k, v]) => [String(k), v])) }
                : null,
            rabbitAvailable: viewer.playerId ? this.rabbitAvailableFor(viewer.playerId) : false,
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
