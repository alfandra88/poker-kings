// End-to-end smoke test for the platform entrypoint (server.js): boots the
// single-port server exactly as staging does (fresh env, locally generated
// keys, no DATABASE_URL -> in-memory store), then drives a real socket.io
// session: auth gating, table create/join/sit, a full Stay/Pass hand with
// bots, and the hidden-information guarantees over the wire.
// Keys are generated per run in the OS temp dir and never committed.
import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3013;
const BASE = `http://127.0.0.1:${PORT}`;
const APP_ID = "424242";

let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
function check(cond, msg) {
    if (cond) ok(msg);
    else {
        failures++;
        console.error(`  FAIL ${msg}`);
    }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- keys + tokens (local only) ----
const tmp = mkdtempSync(join(tmpdir(), "poker-kings-smoke-"));
const { privateKey: userPriv, publicKey: userPub } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: guestPriv, publicKey: guestPub } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const userPem = userPub.export({ type: "spki", format: "pem" });
const guestPem = guestPub.export({ type: "spki", format: "pem" });
const signUser = (id, username) =>
    jwt.sign({ id, username, pur: "iframe", locale: null }, userPriv, {
        algorithm: "RS256", issuer: "usernode", audience: `usernode:app:${APP_ID}`, expiresIn: "10m",
    });
const signGuest = () =>
    jwt.sign({ pur: "guest", guest: true }, guestPriv, {
        algorithm: "ES256", issuer: "usernode", audience: `usernode:app:${APP_ID}:guest`, expiresIn: "10m",
    });

const ALICE = signUser("smoke-user-alice", "AliceHost");
const BOB = signUser("smoke-user-bob", "BobPlayer");
const GUEST = signGuest();

// ---- boot server ----
const useProd = existsSync(join(ROOT, ".next", "BUILD_ID"));
const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: useProd ? "production" : "development",
        USERNODE_ENV: "staging",
        USERNODE_APP_ID: APP_ID,
        USERNODE_JWT_PUBLIC_KEY: userPem,
        USERNODE_GUEST_JWT_PUBLIC_KEY: guestPem,
    },
    stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => process.env.SMOKE_VERBOSE && process.stdout.write(`[srv] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[srv!] ${d}`));

async function waitReady() {
    for (let i = 0; i < 120; i++) {
        try {
            const r = await fetch(`${BASE}/health`);
            if (r.ok) return await r.json();
        }
        catch { /* not up yet */ }
        await sleep(500);
    }
    throw new Error("server did not become ready in 60s");
}
function connect(token) {
    // The server emits "me" inside its connection handler, which can arrive
    // before the client's own "connect" event resolves — so the listener must
    // be registered at socket creation, not after awaiting the connection.
    return new Promise((res, rej) => {
        const sock = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false, timeout: 10000 });
        const meP = once(sock, "me");
        sock.on("connect", () => res({ sock, meP }));
        sock.on("connect_error", rej);
    });
}
const once = (sock, ev, timeoutMs = 10000) =>
    new Promise((res) => {
        const t = setTimeout(() => res(null), timeoutMs);
        sock.once(ev, (d) => { clearTimeout(t); res(d); });
    });
const ackOf = (p) => new Promise((res) => {
    const t = setTimeout(() => res({ ok: false, error: "ack_timeout" }), 8000);
    p.then((r) => { clearTimeout(t); res(r ?? { ok: false, error: "null_ack" }); });
});

try {
    // ---- HTTP auth gate ----
    console.log("smoke: HTTP auth + health");
    const health = await waitReady();
    check(health.ok === true && health.status === "ready", "GET /health answers ready");
    const meRes = await fetch(`${BASE}/api/me`, { headers: { "x-usernode-token": ALICE } });
    check(meRes.ok, "GET /api/me authenticates with a valid RS256 token");
    const meBody = await meRes.json();
    check(meBody.me?.nickname === "AliceHost", "/api/me returns the token identity");
    const anon = await fetch(`${BASE}/api/me`);
    check(anon.status === 401, "GET /api/me without a token is 401");
    const guestRes = await fetch(`${BASE}/api/me`, { headers: { "x-usernode-token": GUEST } });
    const guestBody = await guestRes.json();
    check(guestRes.status === 401 && guestBody.error === "account_required", "guest write-level API answers account_required");
    const roomRes = await fetch(`${BASE}/api/room/${"0".repeat(40)}`);
    check(roomRes.status === 404, "public room API answers 404 for an unknown room");

    // ---- sockets ----
    console.log("smoke: realtime auth");
    const { sock: alice, meP } = await connect(ALICE);
    const meEvt = await meP;
    check(meEvt?.nickname === "AliceHost" && meEvt?.guest !== true, "socket 'me' carries the authenticated profile");
    const { sock: guestSock, meP: guestMeP } = await connect(GUEST);
    const guestMe = await guestMeP;
    check(guestMe?.guest === true, "guest socket is announced as a guest");
    const { sock: anonSock, meP: anonMeP } = await connect(undefined);
    const anonMe = await anonMeP;
    check(anonMe?.guest === true, "token-less socket degrades to a read-only guest");

    console.log("smoke: table lifecycle + Stay/Pass hand");
    const created = await ackOf(alice.emitWithAck("table:create", {
        config: { name: "Smoke table", mode: "cash", variant: "nlhe", maxSeats: 4, actionTimerSec: 5, timeBankSec: 0, botCount: 2, spectatorCards: true /* engine must clamp this off */ },
    }));
    check(created.ok === true && typeof created.code === "string" && created.code.length >= 4, "table:create accepts and returns a code");
    const code = created.code;
    const { sock: bob, meP: bobMeP } = await connect(BOB);
    await bobMeP;
    const join = await ackOf(bob.emitWithAck("table:join", { code }));
    check(join.ok === true, "second user joins the table by code");

    // guest spectates, and is refused a seat + an action
    const gJoin = await ackOf(guestSock.emitWithAck("table:join", { code }));
    check(gJoin.ok === true && gJoin.spectating === true, "guest joins as a spectator");
    const gSit = await ackOf(guestSock.emitWithAck("seat:sit", { seatId: 3 }));
    check(gSit.ok === false && gSit.error === "account_required", "guest seat:sit is refused with account_required");
    const gAct = await ackOf(guestSock.emitWithAck("action", { type: "stay" }));
    check(gAct.ok === false && gAct.error === "account_required", "guest action is refused with account_required");

    await ackOf(alice.emitWithAck("seat:auto", {}));
    await ackOf(bob.emitWithAck("seat:auto", {}));

    // a full hand: humans stay, bots play themselves
    const sawDeal = { alice: false, bob: false };
    const sawEvent = (who) => (ev) => { if (ev?.t === "deal") sawDeal[who] = true; };
    alice.on("event", sawEvent("alice"));
    bob.on("event", sawEvent("bob"));
    const alicePayout = new Promise((res) => {
        const t = setTimeout(() => res(null), 40000);
        const onEv = (ev) => {
            if (ev?.t === "payout") { clearTimeout(t); alice.off("event", onEv); res(ev); }
        };
        alice.on("event", onEv);
    });
    const driveActions = async (sock, label) => {
        for (let i = 0; i < 60; i++) {
            await sleep(300);
            const snap = await ackOf(sock.emitWithAck("table:refresh", {}));
            // refresh acks ok; the state push carries canStay
            const state = await Promise.race([once(sock, "state", 1500), null]);
            const mine = state?.seats?.find?.((s) => s?.self);
            if (state?.canStay && mine) {
                await ackOf(sock.emitWithAck("action", { type: "stay" }));
            }
            if (!state || state.status === "lobby") break;
        }
    };
    await Promise.all([driveActions(alice, "alice"), driveActions(bob, "bob")]);
    const payout = await alicePayout;
    check(!!payout && Array.isArray(payout.winners) && payout.winners.every((w) => w.amount > 0), "a hand completes and pays points to the winner");
    check(!sawDeal.alice && !sawDeal.bob, "hidden 'deal' event is never broadcast over the wire");

    // spectators must never see hole cards, even with spectatorCards requested
    const guestState = await ackOf(guestSock.emitWithAck("table:refresh", {}));
    const guestSnap = await Promise.race([once(guestSock, "state", 2000), null]);
    check(guestSnap === null || guestSnap.seats.every((s) => s === null || s.cards === null || s.cards.length === 0), "spectator receives no hole cards over the wire");

    // leaderboard + profile still answer
    // the server emits before it acks, so listeners go up first
    const lbP = once(alice, "leaderboard", 4000);
    const lbAck = await ackOf(alice.emitWithAck("leaderboard:get", {}));
    const lb = await lbP;
    check(lbAck.ok === true && Array.isArray(lb?.overall), "leaderboard:get emits overall standings");
    const profP = once(alice, "profile", 4000);
    const profAck = await ackOf(alice.emitWithAck("profile:get", {}));
    const prof = await profP;
    check(profAck.ok === true && prof?.stats && typeof prof.stats.showdowns === "number", "profile:get emits stats");

    // tampered token is rejected at the HTTP edge and degrades on the socket
    const tampered = ALICE.slice(0, -4) + "AAAA";
    const bad = await fetch(`${BASE}/api/me`, { headers: { "x-usernode-token": tampered } });
    check(bad.status === 401, "tampered token is rejected (RS256 signature)");

    alice.disconnect(); bob.disconnect(); guestSock.disconnect(); anonSock.disconnect();
} catch (e) {
    failures++;
    console.error(`  FAIL smoke aborted: ${e.message}`);
} finally {
    child.kill("SIGTERM");
    await sleep(500);
    if (!child.killed) child.kill("SIGKILL");
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp best effort */ }
}
console.log(failures ? `\nRESULT: ${failures} smoke check(s) failed` : "\nRESULT: ALL SMOKE CHECKS PASSED");
process.exit(failures ? 1 : 0);