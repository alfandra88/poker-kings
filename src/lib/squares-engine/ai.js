import { rankOf, suitOf } from "../poker-engine/cards.js";
import { CELLS, HAND_POINTS, LINES, scoreLine } from "./scoring.js";

// Rough worth of a partly filled line: what it scores already plus what it
// can still become. Full lines score exactly.
export function lineValue(cards) {
    const n = cards.length;
    if (n === 0)
        return 0;
    if (n === 5)
        return scoreLine(cards).points;
    const counts = new Map();
    for (const c of cards)
        counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
    const groups = [...counts.values()].sort((a, b) => b - a);
    let v = 0;
    if (groups[0] === 4)
        v = HAND_POINTS.quads;
    else if (groups[0] === 3 && groups[1] === 2)
        v = HAND_POINTS.full_house;
    else if (groups[0] === 3)
        v = HAND_POINTS.trips + 4;
    else if (groups[0] === 2 && groups[1] === 2)
        v = HAND_POINTS.two_pair + 3;
    else if (groups[0] === 2)
        v = HAND_POINTS.pair + 1;
    const free = 5 - n;
    const suits = new Set(cards.map(suitOf));
    if (suits.size === 1 && n >= 2)
        v = Math.max(v, HAND_POINTS.flush * (0.25 + 0.15 * (n - free)));
    if (groups[0] === 1 && n >= 2) {
        const ranks = [...counts.keys()].sort((a, b) => a - b);
        const span = ranks[ranks.length - 1] - ranks[0];
        const lowAce = ranks.includes(12) ? ranks.map((r) => (r === 12 ? -1 : r)).sort((a, b) => a - b) : null;
        const lowSpan = lowAce ? lowAce[lowAce.length - 1] - lowAce[0] : 99;
        if (Math.min(span, lowSpan) <= 4)
            v = Math.max(v, HAND_POINTS.straight * (0.2 + 0.12 * (n - free)) * (suits.size === 1 ? 2 : 1));
    }
    return v;
}

export function gridValue(grid) {
    let v = 0;
    for (const line of LINES) {
        const cards = [];
        for (const i of line)
            if (grid[i] !== null)
                cards.push(grid[i]);
        v += lineValue(cards);
    }
    return v;
}

function emptyCells(grid) {
    const out = [];
    for (let i = 0; i < CELLS; i++)
        if (grid[i] === null)
            out.push(i);
    return out;
}

function bestPlacement(grid, card) {
    let best = -1;
    let bestV = -Infinity;
    for (const i of emptyCells(grid)) {
        grid[i] = card;
        const v = gridValue(grid);
        grid[i] = null;
        if (v > bestV) {
            bestV = v;
            best = i;
        }
    }
    return { cell: best, value: bestV };
}

// Skill decides how many sampled future cards each choice looks ahead over,
// and how much noise keeps two AI players with the same cards from building
// identical grids.
export const LOOKAHEAD = { easy: 0, normal: 0, hard: 10 };
const NOISE = { easy: 0, normal: 3, hard: 1.5 };

// unseen: cards not yet dealt this round (the AI does not know their order).
export function chooseCell(grid, card, { skill = "normal", unseen = [], random = Math.random } = {}) {
    const cells = emptyCells(grid);
    if (cells.length === 0)
        return -1;
    if (cells.length === 1)
        return cells[0];
    const scored = [];
    for (const i of cells) {
        grid[i] = card;
        let v = gridValue(grid);
        const samples = LOOKAHEAD[skill] ?? 0;
        if (samples > 0 && unseen.length > 0 && cells.length > 2) {
            let sum = 0;
            for (let s = 0; s < samples; s++) {
                const next = unseen[Math.floor(random() * unseen.length)];
                sum += bestPlacement(grid, next).value;
            }
            v = v * 0.4 + (sum / samples) * 0.6;
        }
        grid[i] = null;
        scored.push({ i, v: v + random() * (NOISE[skill] ?? 0) });
    }
    scored.sort((a, b) => b.v - a.v);
    if (skill === "easy") {
        const pool = scored.slice(0, Math.min(4, scored.length));
        return pool[Math.floor(random() * pool.length)].i;
    }
    return scored[0].i;
}
