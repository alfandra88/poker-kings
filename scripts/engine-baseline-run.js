// Engine baseline checks for the Stay/Pass showdown format (pure Node, no DB,
// no sockets). Exercises ShowdownTable directly with deterministic RNG and
// fake timers, asserting the invariants the realtime layer depends on:
//   - every hand terminates (2..10 seats, both variants, cash + tournament)
//   - points are minted only by showdown wins / walkovers, and conserve
//   - strikes / benching behave; tournament mode eliminates via deps.onStrike
//   - hidden info never leaks through snapshotFor (hole cards, seed, password)
//   - same RNG seed => same shuffled deck / seed hash (dealing determinism)
import { ShowdownTable } from "../src/lib/poker-engine/showdown.js";
import { mulberry32, deckFromSeed, seedToHex } from "../src/lib/poker-engine/cards.js";

let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
function check(cond, msg) {
    if (cond) ok(msg);
    else {
        failures++;
        console.error(`  FAIL ${msg}`);
    }
}

function makeDeps(seed) {
    const rng = mulberry32(seed);
    const events = [];
    return {
        table: null,
        payouts: [],
        handEnds: [],
        strikes: [],
        deps: {
            timers: {
                schedule: (_fn, _ms) => null,
                cancel: (_h) => {},
                now: () => 1_000_000,
            },
            random: () => rng(),
            sha256: (hex) => `sha256:${hex}`,
            broadcast: (e) => events.push(e),
            onStateDirty: () => {},
            onPayout: (p) => {},
            onHandEnd: (h) => {},
            onPlayersLeft: () => {},
            onStrike: (s) => {},
        },
        events,
        rng,
    };
}

function makeTable(seed, { variant = "nlhe", mode = "cash", maxSeats = 6, actionTimerSec = 10 } = {}) {
    const ctx = makeDeps(seed);
    const table = new ShowdownTable(
        "t".repeat(20),
        { name: "Baseline", mode, variant, maxSeats, actionTimerSec, timeBankSec: 0, noPass: false, spectatorCards: false },
        ctx.deps,
        { playerId: "host-player", nickname: "Host", avatar: "A" },
    );
    ctx.table = table;
    return ctx;
}

function seatPlayers(ctx, n) {
    const ids = [];
    for (let i = 0; i < n; i++) {
        const pid = `player-${i}`;
        ids.push(pid);
        const r = ctx.table.sitDownFirstFree({ playerId: pid, nickname: `P${i}`, avatar: `A${i}` });
        if (!r) throw new Error(`seat ${i} failed`);
    }
    return ids;
}

// Drive the hand to completion with a deterministic stay/pass policy.
// Returns { actions, passed }. Bounded so a non-terminating loop fails the run.
function playHand(ctx, policy) {
    const table = ctx.table;
    const actions = [];
    let guard = 0;
    while (table.handActive) {
        if (++guard > 5000) throw new Error("hand did not terminate within 5000 actions");
        if (table.toAct === null) throw new Error("hand active but nobody to act and no timer progression");
        const s = table.seats[table.toAct];
        const move = policy(s, table);
        const r = table.act(realIdOf(s), move);
        if (!r.ok) throw new Error(`act(${move}) rejected: ${r.error}`);
        actions.push(move);
    }
    return actions;
}
function realIdOf(s) {
    return s.playerId.startsWith("leaving:") ? s.playerId.slice(8) : s.playerId;
}
const lastEvent = (ctx, t) => [...ctx.events].reverse().find((e) => e.t === t) ?? null;
const eventsOf = (ctx, t) => ctx.events.filter((e) => e.t === t);

// ---------------------------------------------------------------------------
console.log("engine baseline: hand termination + accounting across seats/variants");
for (const variant of ["nlhe", "plo4"]) {
    for (const n of [2, 3, 5, 8, 10]) {
        const ctx = makeTable(1234 + n, { variant, maxSeats: n });
        seatPlayers(ctx, n);
        ctx.table.tryStartHand();
        // redaction is checked mid-hand (preflop): after endHand cards are cleared
        const midSnap = ctx.table.snapshotFor({ playerId: "player-0", isSpectator: false });
        check(Array.isArray(midSnap.seats.find((s) => s?.self)?.cards) && midSnap.seats.find((s) => s?.self).cards.length > 0, `${variant} n=${n}: self sees own hole cards`);
        check(midSnap.seats.filter((s) => s && !s.self).every((s) => s.cards === null), `${variant} n=${n}: others' hole cards are redacted in snapshot`);
        check(midSnap.config.password === undefined, `${variant} n=${n}: table password never leaves the server`);
        const midSpec = ctx.table.snapshotFor({ playerId: "nobody", isSpectator: true });
        check(midSpec.seats.every((s) => s === null || s.cards === null), `${variant} n=${n}: spectator sees no hole cards`);
        // everyone stays to the showdown (cash mode, noPass off but nobody passes)
        playHand(ctx, () => "stay");
        const showdown = lastEvent(ctx, "showdown");
        const payout = lastEvent(ctx, "payout");
        const strikes = eventsOf(ctx, "strike");
        check(!!showdown && !!payout, `${variant} n=${n}: hand reaches showdown + payout`);
        const losers = strikes.length;
        const expected = 50 + 25 * losers;
        const won = payout.winners.reduce((a, w) => a + w.amount, 0);
        check(won === expected, `${variant} n=${n}: payout conserves points (${won} == ${expected})`);
        check(payout.winners.every((w) => w.amount > 0), `${variant} n=${n}: winners earn points`);
        check(eventsOf(ctx, "deal").length === 0, `${variant} n=${n}: hidden 'deal' event is never broadcast`);
    }
}

// ---------------------------------------------------------------------------
console.log("engine baseline: pass rules, walkover, strikes, benching, elimination");
{
    // everyone passes => round skipped, no points minted
    const ctx = makeTable(77);
    seatPlayers(ctx, 4);
    ctx.table.tryStartHand();
    playHand(ctx, () => "pass");
    const note = lastEvent(ctx, "note");
    const payout = lastEvent(ctx, "payout");
    check(note?.text === "round_skipped", "all-pass round is skipped without penalty");
    check(!payout, "all-pass round mints no points");
    const seats = ctx.table.snapshotFor({ playerId: "player-0" }).seats;
    check(seats.every((s) => !s || (s.points === 0 && s.strikes === 0)), "no points or strikes after a skipped round");

    // exactly one stayer => walkover worth 25
    const ctx2 = makeTable(78);
    seatPlayers(ctx2, 4);
    ctx2.table.tryStartHand();
    playHand(ctx2, (s) => (realIdOf(s) === "player-0" ? "stay" : "pass"));
    const payout2 = lastEvent(ctx2, "payout");
    check(payout2?.winners?.length === 1 && payout2.winners[0].amount === 25 && payout2.winners[0].walkover, "single stayer earns a 25-point walkover");
    check(ctx2.table.seats[0].points === 25, "walkover points land on the seat");

    // three showdown losses bench the loser for 3 rounds (cash mode).
    // Two seats stay so a real showdown (not a walkover) decides each hand.
    const ctx3 = makeTable(79, { maxSeats: 3 });
    seatPlayers(ctx3, 3);
    for (let hand = 0; hand < 12; hand++) {
        if (ctx3.table.seats.some((x) => x?.benched)) break;
        ctx3.table.tryStartHand();
        if (!ctx3.table.handActive) break;
        playHand(ctx3, (s) => (realIdOf(s) === "player-0" ? "pass" : "stay"));
    }
    const benched = ctx3.table.seats.find((x) => x?.benched);
    check(!!benched && benched.strikes === 0 && benched.benchRounds > 0, "three strikes bench the loser and reset the counter");

    // tournament mode: noPass, pass rejected, elimination reported through deps
    const ctx4 = makeTable(80, { mode: "tournament", maxSeats: 2 });
    ctx4.deps.onStrike = (s) => ctx4.strikes.push(s);
    seatPlayers(ctx4, 2);
    ctx4.table.tryStartHand();
    const toActId = realIdOf(ctx4.table.seats[ctx4.table.toAct]);
    const bad = ctx4.table.act(toActId, "pass");
    check(bad.error === "pass_not_allowed", "tournament rejects Pass (noPass)");
    const snap4 = ctx4.table.snapshotFor({ playerId: toActId });
    check(snap4.canStay === true && snap4.canPass === false, "tournament snapshot allows Stay only");
    // drive until someone accumulates 3 strikes and is eliminated
    let guard = 0;
    while (ctx4.strikes.filter((s) => s.eliminated).length === 0 && guard++ < 50) {
        if (!ctx4.table.handActive) ctx4.table.tryStartHand();
        if (!ctx4.table.handActive) break;
        playHand(ctx4, () => "stay");
    }
    check(ctx4.strikes.some((s) => s.eliminated), "tournament eliminates after 3 strikes via deps.onStrike");

    // timeout path: autoAct stays/passes on behalf of the seat, marked by:"time"
    const ctx5 = makeTable(81, { maxSeats: 3 });
    seatPlayers(ctx5, 3);
    ctx5.table.tryStartHand();
    const seatId = ctx5.table.toAct;
    const seat = ctx5.table.seats[seatId];
    ctx5.table.autoAct(seatId);
    const action = lastEvent(ctx5, "action");
    check(action?.by === "time" && action?.seat === seatId, "timeout auto-action is broadcast with by:'time'");
    check(seat.decided, "timed-out seat is marked decided");
    // three consecutive timeouts in cash mode auto-sit the player
    ctx5.table.sitOutToggle(realIdOf(seat), false);
    let sitout = false;
    for (let i = 0; i < 3 && !sitout; i++) {
        if (!ctx5.table.handActive) ctx5.table.tryStartHand();
        if (!ctx5.table.handActive) break;
        let g = 0;
        while (ctx5.table.handActive && g++ < 100) {
            if (ctx5.table.toAct === null) break;
            const sid = ctx5.table.toAct;
            ctx5.table.autoAct(sid);
        }
        sitout = ctx5.table.seatOf("player-2")?.sittingOut === true;
        ctx5.table.scheduleNextHand(0);
    }
    check(sitout, "repeated timeouts auto-sit the player in cash mode");
}

// ---------------------------------------------------------------------------
console.log("engine baseline: dealing determinism");
{
    const a = deckFromSeed(0xdeadbeef);
    const b = deckFromSeed(0xdeadbeef);
    check(JSON.stringify(a) === JSON.stringify(b) && a.length === 52, "same seed produces the same full deck");
    check(seedToHex(0xdeadbeef).length === 8, "seed hex encoding is 8 chars");
    const ctxA = makeTable(4242, { maxSeats: 2 });
    const ctxB = makeTable(4242, { maxSeats: 2 });
    seatPlayers(ctxA, 2);
    seatPlayers(ctxB, 2);
    ctxA.table.tryStartHand();
    ctxB.table.tryStartHand();
    check(ctxA.table.seedHash === ctxB.table.seedHash, "same RNG state deals the same seed hash");
    check(JSON.stringify(ctxA.table.seats[0].cards) === JSON.stringify(ctxB.table.seats[0].cards), "same RNG state deals the same hole cards");
}

console.log(failures ? `\nRESULT: ${failures} engine check(s) failed` : "\nRESULT: ALL ENGINE CHECKS PASSED");
process.exit(failures ? 1 : 0);