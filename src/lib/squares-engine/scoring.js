import { eval5, rankOf } from "../poker-engine/cards.js";

export const GRID_SIZE = 5;
export const CELLS = GRID_SIZE * GRID_SIZE;

// Points per line, American Poker Squares scoring.
export const HAND_POINTS = {
    royal_flush: 100,
    straight_flush: 75,
    quads: 50,
    full_house: 25,
    flush: 20,
    straight: 15,
    trips: 10,
    two_pair: 5,
    pair: 2,
    nothing: 0,
};

const CAT_TO_KEY = ["nothing", "pair", "two_pair", "trips", "straight", "flush", "full_house", "quads", "straight_flush"];

// Scores one full row or column. Returns null until the line holds 5 cards.
export function scoreLine(cards) {
    if (!Array.isArray(cards) || cards.length !== 5 || cards.some((c) => c === null || c === undefined))
        return null;
    const res = eval5(cards[0], cards[1], cards[2], cards[3], cards[4]);
    let key = CAT_TO_KEY[res.cat];
    if (key === "straight_flush") {
        const ranks = cards.map(rankOf);
        if (ranks.includes(12) && ranks.includes(11))
            key = "royal_flush";
    }
    return { key, points: HAND_POINTS[key] };
}

export function rowCells(r) {
    return [0, 1, 2, 3, 4].map((c) => r * GRID_SIZE + c);
}
export function colCells(c) {
    return [0, 1, 2, 3, 4].map((r) => r * GRID_SIZE + c);
}
export const LINES = [
    ...[0, 1, 2, 3, 4].map(rowCells),
    ...[0, 1, 2, 3, 4].map(colCells),
];

export function emptyGrid() {
    return new Array(CELLS).fill(null);
}

// Rows then columns. Each entry is { key, points } once full, otherwise null.
export function scoreGrid(grid) {
    const rows = [0, 1, 2, 3, 4].map((r) => scoreLine(rowCells(r).map((i) => grid[i])));
    const cols = [0, 1, 2, 3, 4].map((c) => scoreLine(colCells(c).map((i) => grid[i])));
    let total = 0;
    let best = null;
    for (const l of [...rows, ...cols]) {
        if (!l)
            continue;
        total += l.points;
        if (l.points > 0 && (!best || l.points > best.points))
            best = l;
    }
    return { rows, cols, total, bestLine: best ? best.key : null };
}

export function firstEmpty(grid) {
    return grid.findIndex((c) => c === null);
}
