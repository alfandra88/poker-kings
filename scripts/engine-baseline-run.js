#!/usr/bin/env node
// Poker Squares engine baseline: scoring table, seeded round simulation,
// rule checks, and a stable digest of every round event.
import { createHash } from "node:crypto";
import { deckFromSeed } from "../src/lib/poker-engine/cards.js";
import { scoreLine, scoreGrid, HAND_POINTS, emptyGrid, CELLS } from "../src/lib/squares-engine/scoring.js";
import { SquaresRound, rankResults } from "../src/lib/squares-engine/round.js";
import { chooseCell } from "../src/lib/squares-engine/ai.js";
import { mulberry32 } from "../src/lib/poker-engine/cards.js";

let failures = 0;
function check(cond, msg) {
    if (!cond) {
        failures++;
        console.error("FAIL:", msg);
    }
}
// card = rank * 4 + suit; ranks 0..12 = 2..A; suits 0..3 = spade, heart, diamond, club
const C = (s) => {
    const R = "23456789TJQKA";
    const S = "shdc";
    return R.indexOf(s[0]) * 4 + S.indexOf(s[1]);
};
const L = (str) => str.split(" ").map(C);

const CASES = [
    ["Ts Js Qs Ks As", "royal_flush"],
    ["9h Th Jh Qh Kh", "straight_flush"],
    ["Ad 2d 3d 4d 5d", "straight_flush"],
    ["7s 7h 7d 7c 2s", "quads"],
    ["Ks Kh Kd 4c 4s", "full_house"],
    ["2c 7c 9c Jc Kc", "flush"],
    ["As 2h 3d 4c 5s", "straight"],
    ["Ts Jh Qd Kc As", "straight"],
    ["9s 9h 9d 2c 5s", "trips"],
    ["9s 9h 4d 4c 5s", "two_pair"],
    ["9s 9h 4d 3c 5s", "pair"],
    ["2s 7h 9d Jc Ks", "nothing"],
    ["Qs Kh Ad 2c 3s", "nothing"],
];
for (const [cards, key] of CASES) {
    const res = scoreLine(L(cards));
    check(res && res.key === key, `scoreLine(${cards}) = ${res?.key}, expected ${key}`);
    check(res && res.points === HAND_POINTS[key], `points for ${cards}`);
}
check(scoreLine(L("2s 3s 4s 5s")) === null, "a 4-card line does not score");

// A grid whose rows are the first five cases and whose columns are known.
const grid = [];
for (const [cards] of CASES.slice(0, 5)) grid.push(...L(cards));
const g = scoreGrid(grid);
check(g.rows.map((r) => r.key).join(",") === "royal_flush,straight_flush,straight_flush,quads,full_house", "row keys");
check(g.total === g.rows.reduce((s, r) => s + r.points, 0) + g.cols.reduce((s, c) => s + c.points, 0), "scoreGrid sums 10 lines");
check(g.bestLine === "royal_flush", "best line");

check(JSON.stringify(rankResults([{ id: "a", points: 10 }, { id: "b", points: 30 }, { id: "c", points: 10 }]).map((r) => r.place)) === "[1,2,2]", "ties share a place");

// Seeded rounds on a fake clock.
function fakeTimers() {
    let now = 0;
    const q = [];
    return {
        timers: {
            schedule: (fn, ms) => {
                const h = { at: now + ms, fn };
                q.push(h);
                return h;
            },
            cancel: (h) => {
                const i = q.indexOf(h);
                if (i >= 0) q.splice(i, 1);
            },
            now: () => now,
        },
        runNext() {
            q.sort((a, b) => a.at - b.at);
            const h = q.shift();
            if (!h) return false;
            now = h.at;
            h.fn();
            return true;
        },
    };
}

const digest = createHash("sha256");
let lines = 0;
for (let players = 1; players <= 8; players++) {
    for (const seed of [1, 7, 42, 9001]) {
        const deck = deckFromSeed(seed);
        const ids = Array.from({ length: players }, (_, i) => `p${i}`);
        const clock = fakeTimers();
        let done = null;
        const dealt = [];
        const round = new SquaresRound({
            deck, playerIds: ids, timerMs: 15000,
            deps: {
                timers: clock.timers,
                onEvent: (ev) => {
                    digest.update(JSON.stringify(ev));
                    lines++;
                    if (ev.t === "deal") dealt.push(ev.card);
                },
                onDone: (r) => { done = r; },
            },
        });
        round.start();
        const rng = mulberry32(seed + players);
        // Player 0 always times out; the rest place with the AI.
        let guard = 0;
        while (round.phase === "placing" && guard++ < 200) {
            for (const id of ids.slice(1)) {
                const gr = round.grid(id).slice();
                const cell = chooseCell(gr, round.card, { skill: ["easy", "normal", "hard"][players % 3], unseen: deck.slice(round.index + 1), random: rng });
                const res = round.place(id, cell);
                check(res.ok, `AI placement accepted (${res.error})`);
            }
            if (round.phase === "placing") {
                if (ids.length > 1) {
                    const taken = round.grid("p1").findIndex((c) => c !== null);
                    if (taken >= 0) check(!round.place("p1", taken).ok, "placing twice in one card is rejected");
                }
                clock.runNext();
            }
        }
        check(done !== null, `round finished (${players} players, seed ${seed})`);
        check(dealt.length === CELLS, "25 cards dealt");
        check(JSON.stringify(dealt) === JSON.stringify(deck.slice(0, 25)), "every player gets the same deck order");
        for (const id of ids) {
            const gr = round.grid(id);
            check(gr.every((c) => c !== null), "grid full");
            check(new Set(gr).size === 25, "25 distinct cards");
            check(JSON.stringify([...gr].sort((a, b) => a - b)) === JSON.stringify(deck.slice(0, 25).sort((a, b) => a - b)), "grid holds exactly the dealt cards");
        }
        const p0 = round.grid("p0");
        check(JSON.stringify(p0) === JSON.stringify(deck.slice(0, 25)), "timed-out player fills cells left to right");
        digest.update(JSON.stringify(done.map((r) => [r.id, r.points, r.place])));
    }
}

// Filled cells and off-grid cells are refused.
{
    const clock = fakeTimers();
    const r = new SquaresRound({ deck: deckFromSeed(3), playerIds: ["a"], timerMs: 1000, deps: { timers: clock.timers } });
    check(!r.place("a", 0).ok, "no placement before the round starts");
    r.start();
    check(r.place("a", 0).ok, "first placement");
    check(!r.place("a", 0).ok, "cell already filled");
    check(!r.place("a", 25).ok, "cell out of range");
    check(!r.place("b", 1).ok, "only players in the round may place");
    r.setAuto("a", true);
    check(r.phase === "results", "an away player is placed automatically to the end");
}

const hex = digest.digest("hex");
console.log(`engine: ${lines} events`);
console.log(`SHA256 ${hex}`);
if (failures) {
    console.error(`\nRESULT: ${failures} engine failure(s)`);
    process.exit(1);
}
console.log("RESULT: engine baseline ok");
