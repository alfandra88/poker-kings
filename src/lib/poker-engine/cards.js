export const RANK_CHARS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
export const SUIT_GLYPHS = ["♠", "♥", "♦", "♣"];
export const SUIT_KEYS = ["spade", "heart", "diamond", "club"];
export function rankOf(card) {
    return card >> 2;
}
export function suitOf(card) {
    return card & 3;
}
export function cardText(card) {
    return RANK_CHARS[rankOf(card)] + SUIT_GLYPHS[suitOf(card)];
}

export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function freshDeck() {
    const d = [];
    for (let i = 0; i < 52; i++)
        d.push(i);
    return d;
}

export function shuffleDeck(deck, prng) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(prng() * (i + 1));
        const tmp = deck[i];
        deck[i] = deck[j];
        deck[j] = tmp;
    }
    return deck;
}

export function deckFromSeed(seed) {
    return shuffleDeck(freshDeck(), mulberry32(seed));
}
export function seedToHex(seed) {
    return (seed >>> 0).toString(16).padStart(8, "0");
}
export function hexToSeed(hex) {
    return parseInt(hex, 16) >>> 0;
}
const RANK_KEY_BY_INDEX = [
    "rank.2", "rank.3", "rank.4", "rank.5", "rank.6", "rank.7", "rank.8",
    "rank.9", "rank.T", "rank.J", "rank.Q", "rank.K", "rank.A",
];
export function rankKey(rank) {
    return RANK_KEY_BY_INDEX[rank];
}
const CAT_KEYS = [
    "high_card", "pair", "two_pair", "trips", "straight", "flush", "full_house", "quads", "straight_flush",
];

export function eval5(c1, c2, c3, c4, c5) {
    const cards = [c1, c2, c3, c4, c5];
    const ranks = cards.map(rankOf).sort((a, b) => b - a);
    const suits = cards.map(suitOf);
    const isFlush = suits.every((s) => s === suits[0]);
    let straightHigh = -1;
    const uniq = Array.from(new Set(ranks));
    if (uniq.length === 5) {
        if (uniq[0] - uniq[4] === 4)
            straightHigh = uniq[0];
        else if (uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0)
            straightHigh = 3;     }
    const count = new Map();
    for (const r of ranks)
        count.set(r, (count.get(r) ?? 0) + 1);
    const groups = [...count.entries()].sort((x, y) => (y[1] - x[1]) || (y[0] - x[0]));
    const encode = (cat, tb) => {
        let s = cat;
        for (let i = 0; i < 5; i++)
            s = s * 15 + (tb[i] ?? 0) + 1;
        return s;
    };
    if (isFlush && straightHigh >= 0) {
        const key = straightHigh === 3 ? "rank.5" : rankKey(straightHigh);
        return { cat: 8, score: encode(8, [straightHigh]), label: { key: "straight_flush", a: key } };
    }
    if (groups[0][1] === 4) {
        return {
            cat: 7,
            score: encode(7, [groups[0][0], groups[1][0]]),
            label: { key: "quads", a: rankKey(groups[0][0]) },
        };
    }
    if (groups[0][1] === 3 && groups[1] && groups[1][1] === 2) {
        return {
            cat: 6,
            score: encode(6, [groups[0][0], groups[1][0]]),
            label: { key: "full_house", a: rankKey(groups[0][0]), b: rankKey(groups[1][0]) },
        };
    }
    if (isFlush) {
        return { cat: 5, score: encode(5, ranks), label: { key: "flush", a: rankKey(ranks[0]) } };
    }
    if (straightHigh >= 0) {
        const key = straightHigh === 3 ? "rank.5" : rankKey(straightHigh);
        return { cat: 4, score: encode(4, [straightHigh]), label: { key: "straight", a: key } };
    }
    if (groups[0][1] === 3) {
        const kickers = [groups[0][0], ...groups.slice(1).map((g) => g[0])];
        return {
            cat: 3,
            score: encode(3, kickers),
            label: { key: "trips", a: rankKey(groups[0][0]) },
        };
    }
    if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
        const kicker = groups[2] ? groups[2][0] : 0;
        return {
            cat: 2,
            score: encode(2, [groups[0][0], groups[1][0], kicker]),
            label: { key: "two_pair", a: rankKey(groups[0][0]), b: rankKey(groups[1][0]) },
        };
    }
    if (groups[0][1] === 2) {
        const kickers = [groups[0][0], ...groups.slice(1).map((g) => g[0])];
        return {
            cat: 1,
            score: encode(1, kickers),
            label: { key: "pair", a: rankKey(groups[0][0]) },
        };
    }
    return { cat: 0, score: encode(0, ranks), label: { key: "high_card", a: rankKey(ranks[0]) } };
}
function combos5(arr, out) {
    const n = arr.length;
    for (let a = 0; a < n - 4; a++)
        for (let b = a + 1; b < n - 3; b++)
            for (let c = b + 1; c < n - 2; c++)
                for (let d = c + 1; d < n - 1; d++)
                    for (let e = d + 1; e < n; e++)
                        out([arr[a], arr[b], arr[c], arr[d], arr[e]]);
}

export function evalBest(cards) {
    if (cards.length < 5) {
        return { cat: 0, score: 0, label: { key: "high_card", a: rankKey(rankOf(cards[0] ?? 0)) } };
    }
    let best = null;
    combos5(cards, (five) => {
        const s = eval5(five[0], five[1], five[2], five[3], five[4]);
        if (!best || s.score > best.score)
            best = s;
    });
    return (best ?? eval5(cards[0], cards[1], cards[2], cards[3], cards[4]));
}

export function evalOmaha(hole, board) {
    if (hole.length < 4 || board.length < 5) {
        return { cat: 0, score: 0, label: { key: "high_card", a: rankKey(rankOf(hole[0] ?? board[0] ?? 0)) } };
    }
    let best = null;
    for (let h1 = 0; h1 < 3; h1++)
        for (let h2 = h1 + 1; h2 < 4; h2++)
            for (let b1 = 0; b1 < 3; b1++)
                for (let b2 = b1 + 1; b2 < 4; b2++)
                    for (let b3 = b2 + 1; b3 < 5; b3++) {
                        const s = eval5(hole[h1], hole[h2], board[b1], board[b2], board[b3]);
                        if (!best || s.score > best.score)
                            best = s;
                    }
    return (best ?? eval5(hole[0], hole[1], board[0], board[1], board[2]));
}
