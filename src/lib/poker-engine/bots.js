import { evalBest, evalOmaha } from "./cards.js";
export function pickBotStyle(rng) {
    const r = rng();
    if (r < 0.15)
        return "rock";
    if (r < 0.55)
        return "tag";
    if (r < 0.8)
        return "lag";
    return "station";
}
const TRIALS = {
    easy: { pre: 70, post: 110 },
    normal: { pre: 140, post: 220 },
    hard: { pre: 240, post: 380 },
};
function equity(hole, board, nOpp, variant, trials, rng) {
    if (nOpp <= 0)
        return 1;
    const used = new Set([...hole, ...board]);
    const deck = [];
    for (let c = 0; c < 52; c++)
        if (!used.has(c))
            deck.push(c);
    const oppCards = variant === "plo4" ? 4 : 2;
    const needBoard = 5 - board.length;
    const need = needBoard + oppCards * nOpp;
    if (need > deck.length)
        return 0.5;
    const fullBoard = board.slice();
    let win = 0;
    let tie = 0;
    for (let t = 0; t < trials; t++) {
        for (let i = 0; i < need; i++) {
            const j = i + Math.floor(rng() * (deck.length - i));
            const tmp = deck[i];
            deck[i] = deck[j];
            deck[j] = tmp;
        }
        const b = needBoard > 0 ? fullBoard.concat(deck.slice(0, needBoard)) : fullBoard;
        const hero = variant === "plo4" ? evalOmaha(hole, b).score : evalBest([hole[0], hole[1], ...b]).score;
        let best = -1;
        let cnt = 0;
        let idx = needBoard;
        for (let o = 0; o < nOpp; o++) {
            const s = variant === "plo4"
                ? evalOmaha([deck[idx], deck[idx + 1], deck[idx + 2], deck[idx + 3]], b).score
                : evalBest([deck[idx], deck[idx + 1], ...b]).score;
            idx += oppCards;
            if (s > best) {
                best = s;
                cnt = 1;
            }
            else if (s === best)
                cnt++;
        }
        if (hero > best)
            win += 1;
        else if (hero === best)
            tie += 1 / (1 + cnt);
    }
    return (win + tie) / trials;
}
const KNOBS = {
    rock: { openThresh: 0.54, threeBetThresh: 0.6, callFactor: 1.28, betEq: 0.68, raiseEq: 0.78, bluff: 0.03, noise: 0.04, trap: 0.05 },
    tag: { openThresh: 0.5, threeBetThresh: 0.56, callFactor: 1.02, betEq: 0.62, raiseEq: 0.73, bluff: 0.09, noise: 0.05, trap: 0.1 },
    lag: { openThresh: 0.46, threeBetThresh: 0.52, callFactor: 0.92, betEq: 0.57, raiseEq: 0.68, bluff: 0.16, noise: 0.06, trap: 0.07 },
    station: { openThresh: 0.44, threeBetThresh: 0.56, callFactor: 0.74, betEq: 0.6, raiseEq: 0.75, bluff: 0.05, noise: 0.06, trap: 0.03 },
};
function liveOpponents(snap, seatId) {
    let n = 0;
    for (const s of snap.seats) {
        if (s && s.seatId !== seatId && !s.folded && !s.sittingOut && s.cards !== null)
            n++;
    }
    return Math.max(1, n);
}
function currentBetOf(snap) {
    let max = 0;
    for (const s of snap.seats)
        if (s && s.bet > max)
            max = s.bet;
    return max;
}
function potOdds(toCall, pot) {
    if (toCall <= 0)
        return 0;
    return toCall / (pot + toCall);
}
function clampInt(v, lo, hi) {
    return Math.max(lo, Math.min(hi, Math.round(v)));
}

export function decideBotAction(snap, seatId, persona, rng) {
    const me = snap.seats.find((s) => s?.seatId === seatId);
    if (!me || !me.cards || me.cards.length === 0)
        return null;
    const knob = KNOBS[persona.style];
    const variant = snap.variant;
    const bb = Math.max(1, snap.config.bigBlind);
    const stack = me.stack;
    const pot = snap.pot;
    const toCall = Math.min(snap.toCall, stack);
    const cb = currentBetOf(snap);
    const opp = liveOpponents(snap, seatId);
    const isPre = snap.stage === "preflop";
    const tr = TRIALS[persona.difficulty];
    let eq = equity(me.cards, snap.board, opp, variant, isPre ? tr.pre : tr.post, rng);
    eq += (rng() * 2 - 1) * (persona.difficulty === "easy" ? 0.13 : persona.difficulty === "normal" ? 0.06 : 0.025);
    eq = Math.max(0.02, Math.min(0.99, eq));
    const canCheck = snap.canCheck;
    const canRaise = snap.minRaiseTo !== null && snap.maxRaiseTo !== null && snap.maxRaiseTo > toCall;
    const minTo = snap.minRaiseTo ?? bb;
    const maxTo = snap.maxRaiseTo ?? stack;
    const committedShare = stack + me.committed > 0 ? me.committed / (me.committed + stack) : 0;
    if (stack <= bb * 9) {
        if (toCall === 0) {
            if (eq > 0.5 && canRaise)
                return { type: "raise", to: maxTo };
            return canCheck ? { type: "check" } : null;
        }
        if (eq > 0.47 || (committedShare > 0.4 && eq > 0.4)) {
            if (canRaise && eq > 0.58 && toCall < stack * 0.35)
                return { type: "raise", to: maxTo };
            return { type: "call" };
        }
        if (toCall <= bb && eq > 0.34)
            return { type: "call" };
        return { type: "fold" };
    }
    if (isPre) {
        const limpers = snap.seats.filter((s) => s && !s.folded && s.bet >= bb && s.seatId !== seatId).length;
        const unopened = cb <= bb;
        if (canRaise && unopened && eq > knob.openThresh + Math.max(0, opp - 2) * 0.03) {
            const size = clampInt(bb * 2.4 + limpers * bb, minTo, maxTo);
            return { type: cb === 0 ? "bet" : "raise", to: size };
        }
        if (canRaise && !unopened && eq > knob.threeBetThresh) {
            const size = clampInt(cb * 2.8 + pot * 0.15, minTo, maxTo);
            return { type: "raise", to: size };
        }
        const req = potOdds(toCall, pot) * knob.callFactor;
        const defend = toCall <= bb && eq > 0.34 && persona.style === "station";
        if (toCall > 0 && (eq > Math.max(0.32, req) || defend)) {
            if (canRaise && eq > knob.threeBetThresh - 0.03 && rng() < 0.18) {
                return { type: "raise", to: clampInt(cb * 2.6, minTo, maxTo) };
            }
            return { type: "call" };
        }
        if (canCheck)
            return { type: "check" };
        return { type: "fold" };
    }
    const sticky = committedShare > 0.55 ? 0.08 : 0;     if (toCall === 0) {
        if (canRaise && eq > knob.betEq) {
            if (eq > 0.88 && rng() < knob.trap)
                return { type: "check" };
            const frac = 0.5 + rng() * 0.3;
            const amt = clampInt(pot * frac + (eq > 0.85 ? pot * 0.25 : 0), bb, Math.max(bb, stack));
            if (amt >= stack)
                return { type: "bet", to: stack };
            return { type: "bet", to: amt };
        }
        if (canRaise && opp <= 2 && eq < 0.42 && rng() < knob.bluff) {
            const amt = clampInt(pot * (0.5 + rng() * 0.25), bb, stack);
            return { type: "bet", to: amt };
        }
        return canCheck ? { type: "check" } : null;
    }
    const req = potOdds(toCall, pot) * (knob.callFactor - sticky);
    if (toCall >= stack * 0.55) {
        if (eq > 0.66 || (eq > req + 0.1 && rng() < 0.5))
            return { type: "call" };
        return { type: "fold" };
    }
    if (canRaise && eq > knob.raiseEq && rng() < 0.65) {
        const target = clampInt(pot * 0.9 + toCall + cb, minTo, maxTo);
        if (target >= maxTo && eq > 0.8)
            return { type: "raise", to: maxTo };
        if (target < maxTo)
            return { type: "raise", to: Math.max(minTo, target) };
        return { type: "raise", to: maxTo };
    }
    const stationBonus = persona.style === "station" ? 0.05 : 0;
    if (eq > Math.max(0.3, req) + stationBonus - (persona.difficulty === "easy" ? 0.04 : 0)) {
        return { type: "call" };
    }
    if (toCall <= bb && eq > 0.28 && rng() < 0.45)
        return { type: "call" };
    if (canRaise && rng() < knob.bluff * 0.4 && eq < 0.3 && opp === 1) {
        return { type: "raise", to: clampInt(cb + pot * 0.8, minTo, maxTo) };
    }
    return { type: "fold" };
}

export function botThinkMs(difficulty, rng) {
    const base = difficulty === "easy" ? 700 : difficulty === "hard" ? 600 : 800;
    return Math.round(base + rng() * (difficulty === "easy" ? 1800 : 1400));
}
