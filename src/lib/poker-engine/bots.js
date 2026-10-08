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
        const hero = variant === "plo4" ? evalOmaha(hole, b).score : evalBest([...hole, ...b]).score;
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
// How likely each persona is to contest the showdown. Rock only stays with
// real hands; a lag gambles. Staying means risking a strike if you lose.
const STAY_THRESHOLDS = {
    rock: { easy: 0.5, normal: 0.55, hard: 0.58 },
    tag: { easy: 0.42, normal: 0.5, hard: 0.55 },
    lag: { easy: 0.36, normal: 0.44, hard: 0.5 },
    station: { easy: 0.38, normal: 0.46, hard: 0.53 },
};
function inHand(s) {
    if (!s || s.passed || s.sittingOut)
        return false;
    return s.cards === null || (Array.isArray(s.cards) && s.cards.length > 0);
}
function liveOpponents(snap, seatId) {
    let n = 0;
    for (const s of snap.seats) {
        if (s && s.seatId !== seatId && inHand(s))
            n++;
    }
    return Math.max(1, n);
}
export function decideBotStay(snap, seatId, persona, rng) {
    const me = snap.seats.find((s) => s?.seatId === seatId);
    if (!me || !me.cards || me.cards.length === 0)
        return null;
    // Tournament tables have no Pass at all — timeouts auto-Stay, so must we.
    if (snap.config.noPass)
        return { type: "stay" };
    const opp = liveOpponents(snap, seatId);
    const isPre = snap.stage === "preflop";
    const tr = TRIALS[persona.difficulty] ?? TRIALS.normal;
    let eq = equity(me.cards, snap.board, opp, snap.variant, isPre ? tr.pre : tr.post, rng);
    eq += (rng() * 2 - 1) * (persona.difficulty === "easy" ? 0.13 : persona.difficulty === "normal" ? 0.06 : 0.025);
    eq = Math.max(0.02, Math.min(0.99, eq));
    // Strikes already on the table make the bot pickier: one loss from a bench
    // (or elimination) should not be risked with a marginal hand.
    const strikeFear = me.strikes > 0 ? 0.06 * me.strikes : 0;
    const thresh = (STAY_THRESHOLDS[persona.style] ?? STAY_THRESHOLDS.tag)[persona.difficulty] ?? 0.5;
    const lastChance = snap.stage === "river" ? 0.04 : 0;
    if (eq >= thresh + lastChance - strikeFear + (opp <= 2 ? 0.03 : 0)) {
        return { type: "stay" };
    }
    return { type: "pass" };
}

export function botThinkMs(difficulty, rng) {
    const base = difficulty === "easy" ? 700 : difficulty === "hard" ? 600 : 800;
    return Math.round(base + rng() * (difficulty === "easy" ? 1800 : 1400));
}