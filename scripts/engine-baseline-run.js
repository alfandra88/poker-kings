import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PokerTable } from "../src/lib/poker-engine/table.js";
import { buildPots, refundUncalled, splitPot } from "../src/lib/poker-engine/pots.js";
import { deckFromSeed, eval5, evalBest, evalOmaha, mulberry32, shuffleDeck, freshDeck, seedToHex, cardText, } from "../src/lib/poker-engine/cards.js";

const lines = [];
function emit(s) {
    lines.push(s);
}

function canonical(v) {
    return JSON.stringify(v, (_k, val) => {
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            const o = val;
            return Object.keys(o)
                .sort()
                .reduce((acc, k) => {
                acc[k] = o[k];
                return acc;
            }, {});
        }
        return val;
    });
}

function makeDeps(seed) {
    const rng = mulberry32(seed);
    const events = [];
    const payouts = [];
    let clock = 1_700_000_000_000;
    const pending = [];
    let nextId = 1;
    const deps = {
        timers: {
            schedule(fn, ms) {
                const id = nextId++;
                pending.push({ id, fn, at: clock + ms });
                return id;
            },
            cancel(handle) {
                const i = pending.findIndex((p) => p.id === handle);
                if (i >= 0)
                    pending.splice(i, 1);
            },
            now() {
                return clock;
            },
        },
        random: rng,
        sha256: (hex) => {
            let h = 0x811c9dc5;
            for (let i = 0; i < hex.length; i++) {
                h ^= hex.charCodeAt(i);
                h = Math.imul(h, 0x01000193) >>> 0;
            }
            return h.toString(16).padStart(8, "0");
        },
        broadcast(ev) {
            events.push(ev);
        },
        onStateDirty() { },
        onPlayersLeft() { },
        onPayout(p) {
            payouts.push(p);
        },
        onHandEnd() { },
    };
    return {
        deps,
        events,
        payouts,
        advance: (ms) => {
            clock += ms;
        },
        drain() {
            while (pending.length && pending[0].at <= clock)
                pending.shift().fn();
        },
    };
}
function baseConfig(maxSeats, variant, mode) {
    return {
        name: "Baseline",
        variant,
        mode,
        maxSeats,
        smallBlind: 5,
        bigBlind: 10,
        ante: 0,
        minBuyIn: 20,
        maxBuyIn: 0,
        startingStack: 1000,
        actionTimerSec: 30,
        timeBankSec: 30,
        straddle: false,
        runItTwice: false,
        rabbitHunt: false,
        revealAllIn: false,
        showLosingHand: false,
        approveJoin: false,
        spectatorCards: false,
        entryFee: 0,
    };
}

function runTable(seed, seats, variant, mode) {
    const { deps, events, payouts, advance, drain } = makeDeps(seed);
    const table = new PokerTable("BASE01", baseConfig(seats, variant, mode), deps, { playerId: "p0", nickname: "Host", avatar: "A" });
    for (let i = 1; i < seats; i++) {
        const r = table.sitDown(i, { playerId: `p${i}`, nickname: `P${i}`, avatar: "B" }, 1000);
        emit(`sit ${i} ${canonical(r)}`);
    }
    let guard = 0;
    for (let h = 0; h < 12 && guard < 20000; h++) {
        advance(60_000);
        drain();
        table.tryStartHand();
        let inner = 0;
        while (guard < 20000 && inner < 250) {
            guard++;
            inner++;
            const snap = table.snapshotFor({ playerId: "p0", isSpectator: false });
            if (!snap)
                break;
            emit(`S${h} ${canonical(snap)}`);
            if (snap.status !== "running" || snap.toAct == null)
                break;
            const actSeat = snap.seats[snap.toAct];
            if (!actSeat)
                break;
            // NOTE: snapshots redact other humans' playerId into seatUid (privacy),
            const pid = `p${snap.toAct}`;
            const legal = table.legalActionsFor(snap.toAct);
            emit(`L${h} ${snap.handNo} ${snap.toAct} ${canonical(legal)}`);
            const seedish = (seed + h * 31 + snap.toAct * 7 + inner) % 100;
            let type;
            let to;
            if (seedish < 25)
                type = "fold";
            else if (seedish < 55)
                type = "call";
            else if (legal.canRaise) {
                type = "raise";
                to =
                    legal.minRaiseTo +
                        ((seedish * 13) % Math.max(1, legal.maxRaiseTo - legal.minRaiseTo));
            }
            else if (legal.canBet) {
                type = "bet";
                to = legal.minRaiseTo;
            }
            else if (legal.canCheck)
                type = "check";
            else if (legal.canCall)
                type = "call";
            else
                type = "fold";
            if ((type === "raise" || type === "bet") && (to == null || to < legal.minRaiseTo)) {
                type = legal.canCheck ? "check" : "call";
                to = undefined;
            }
            if (type === "call" && !legal.canCall) {
                type = legal.canCheck ? "check" : legal.canFold ? "fold" : "call";
                to = undefined;
            }
            const res = table.act(pid, type, to);
            emit(`A ${pid} ${type} ${to ?? "-"} ${canonical(res)}`);
            if (!res.ok)
                break;
            advance(1000);
            drain();
        }
    }
    emit(`EVENTS ${canonical(events)}`);
    emit(`PAYOUTS ${canonical(payouts)}`);
    emit(`FINAL ${canonical(table.snapshotFor({ playerId: "p0", isSpectator: false }))}`);
    emit(`EXPORTED ${canonical(table.exportEvents())}`);
}

function runPure() {
    const rng = mulberry32(42);
    for (let d = 0; d < 40; d++) {
        const deck = shuffleDeck(freshDeck(), rng);
        emit(`DECK ${d} ${canonical(deck)}`);
        emit(`SEED ${seedToHex(d * 7919)} ${canonical(deckFromSeed(d * 7919))}`);
        const hand = deck.slice(0, 5);
        emit(`EVAL5 ${d} ${canonical(eval5(hand[0], hand[1], hand[2], hand[3], hand[4]))}`);
        emit(`TEXT ${d} ${cardText(hand[0])} ${cardText(hand[4])}`);
    }
    for (let h = 0; h < 60; h++) {
        const hole = Array.from({ length: 2 }, () => Math.floor(rng() * 52));
        const board = Array.from({ length: 5 }, () => Math.floor(rng() * 52));
        emit(`EVALBEST ${h} ${canonical(evalBest([...hole, ...board]))}`);
        emit(`EVALOMAHA ${h} ${canonical(evalOmaha(hole, board))}`);
    }
    for (let c = 0; c < 80; c++) {
        const n = 2 + (c % 5);
        const commits = Array.from({ length: n }, (_, i) => ({
            seat: i,
            playerId: `p${i}`,
            amount: Math.floor(rng() * 500),
        }));
        emit(`REFUND ${c} ${canonical(refundUncalled(commits))}`);
        emit(`POTS ${c} ${canonical(buildPots(commits))}`);
        if (c % 10 === 0) {
            for (const p of buildPots(commits)) {
                emit(`SPLIT ${c} ${p.seat} ${canonical(splitPot(p, commits, () => false))}`);
                emit(`ODD ${c} ${p.seat} ${canonical(splitPot(p, commits, (s) => s % 3 === 0))}`);
            }
        }
    }
}
runPure();
for (const variant of ["nlhe", "plo4"]) {
    for (const mode of ["cash", "tournament"]) {
        for (let seats = 2; seats <= 9; seats++) {
            runTable(1000 + seats * 17 + (variant === "plo4" ? 5 : 0), seats, variant, mode);
        }
    }
}
const digest = lines.join("\n");
console.log(`LINES ${lines.length}`);
console.log(`SHA256 ${createHash("sha256").update(digest).digest("hex")}`);
if (process.env.BASELINE_OUT) {
    writeFileSync(process.env.BASELINE_OUT, digest, "utf8");
    console.log(`WROTE ${process.env.BASELINE_OUT}`);
}
