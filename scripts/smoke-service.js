#!/usr/bin/env node
// Boots server.js against a real Postgres with a throwaway signing key pair
// and plays through the realtime protocol: sign-in, guests, a full round,
// grid privacy, AI players, saved results and a clean SIGTERM shutdown.
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import pg from "pg";
import { io } from "socket.io-client";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.SMOKE_DATABASE_URL || process.env.INLOOP_DATABASE_URL || process.env.DATABASE_URL;
if (!DB) {
    console.log("smoke: skipped (set SMOKE_DATABASE_URL, INLOOP_DATABASE_URL or DATABASE_URL to a Postgres database)");
    process.exit(0);
}
const PORT = 3000 + randomInt(1000, 1900);
const APP_ID = "4242";
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = (k) => k.export({ type: "spki", format: "pem" });
const userToken = (id, username) => jwt.sign({ id, username, usernode_pubkey: null, locale: null, pur: "iframe" }, rsa.privateKey, { algorithm: "RS256", issuer: "usernode", audience: `usernode:app:${APP_ID}`, expiresIn: "10m" });
const guestToken = () => jwt.sign({ pur: "guest", guest: true }, ec.privateKey, { algorithm: "ES256", issuer: "usernode", audience: `usernode:app:${APP_ID}:guest`, expiresIn: "10m" });

let failures = 0;
function check(cond, msg) {
    if (cond)
        console.log(`  ok  ${msg}`);
    else {
        failures++;
        console.error(`  FAIL ${msg}`);
    }
}

const built = existsSync(join(ROOT, ".next", "BUILD_ID"));
const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
        ...process.env,
        NODE_ENV: built ? "production" : "development",
        PORT: String(PORT),
        DATABASE_URL: DB,
        USERNODE_ENV: "staging",
        USERNODE_APP_ID: APP_ID,
        USERNODE_JWT_PUBLIC_KEY: pem(rsa.publicKey),
        USERNODE_GUEST_JWT_PUBLIC_KEY: pem(ec.publicKey),
    },
    stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const exited = new Promise((res) => server.on("exit", (code, signal) => res({ code, signal })));

const base = `http://127.0.0.1:${PORT}`;
async function waitHealthy() {
    for (let i = 0; i < 240; i++) {
        try {
            const r = await fetch(`${base}/health`);
            if (r.ok)
                return true;
        }
        catch { }
        await sleep(500);
    }
    return false;
}
function connect(token) {
    return new Promise((res) => {
        const s = io(base, { path: "/socket.io/", auth: token ? { token } : {}, transports: ["websocket"], reconnection: false, forceNew: true });
        s.state = null;
        s.on("state", (st) => (s.state = st));
        s.on("connect", () => res({ s, error: null }));
        s.on("connect_error", (e) => res({ s, error: e.message }));
    });
}
const emit = (s, ev, data = {}) => new Promise((res) => s.emit(ev, data, res));
async function until(fn, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const v = fn();
        if (v)
            return v;
        await sleep(50);
    }
    return null;
}

const sockets = [];
try {
    check(await waitHealthy(), "/health answers 200");

    const anon = await connect(null);
    sockets.push(anon.s);
    check(anon.error === "not_authenticated", "a socket with no token is refused");

    const guest = await connect(guestToken());
    sockets.push(guest.s);
    check(!guest.error, "a guest token connects");
    const gres = await emit(guest.s, "table:create", { config: {} });
    check(gres?.error === "account_required", "a guest cannot create a table (account_required)");

    const idA = String(randomInt(1e6, 9e6));
    const idB = String(Number(idA) + 1);
    const A = (await connect(userToken(idA, `smoke-a-${idA}`))).s;
    const B = (await connect(userToken(idB, `smoke-b-${idB}`))).s;
    sockets.push(A, B);
    const created = await emit(A, "table:create", { config: { timerSec: 10 }, botCount: 0 });
    check(created?.ok && /^[A-Z2-9]{6}$/.test(created.code), "a signed-in player creates a table with a 6-character code");
    const code = created.code;
    check((await emit(A, "seat:auto"))?.ok, "the host takes a seat");
    check((await emit(B, "table:join", { code }))?.ok, "a second player joins by code");
    check((await emit(B, "seat:sit"))?.ok, "the second player takes a seat");
    check((await emit(guest.s, "table:join", { code }))?.ok, "a guest can watch the table");
    check((await emit(guest.s, "seat:sit"))?.error === "account_required", "a guest cannot take a seat");

    const placing = await until(() => A.state?.phase === "placing" && A.state, 8000);
    check(!!placing, "the first round starts on its own");
    if (placing) {
        const other = placing.players.find((p) => p.id === idB);
        check(other && other.grid === null, "a player cannot see another player's grid during the round");
        check(Array.isArray(placing.me.grid), "a player sees their own grid");
        const watched = await until(() => guest.s.state?.phase === "placing" && guest.s.state);
        check(watched && watched.players.every((p) => Array.isArray(p.grid)), "people watching see every grid");
        const firstCard = placing.card;
        const bCard = await until(() => B.state?.phase === "placing" && B.state.card);
        check(bCard === firstCard, "both players get the same card");
        const bad = await emit(A, "place", { cell: 99 });
        check(bad?.ok === false, "a cell outside the grid is refused");
        // Both place every card in the first empty cell.
        for (let i = 0; i < 25; i++) {
            await until(() => A.state?.phase !== "placing" || A.state.index === i, 5000);
            await until(() => B.state?.phase !== "placing" || B.state.index === i, 5000);
            if (A.state?.phase !== "placing")
                break;
            const cellA = A.state.me.grid.indexOf(null);
            const cellB = B.state.me.grid.indexOf(null);
            const ra = await emit(A, "place", { cell: cellA });
            if (i === 0) {
                const again = await emit(A, "place", { cell: cellA + 1 });
                check(again?.error === "already_placed", "a player places only once per card");
            }
            const rb = await emit(B, "place", { cell: cellB });
            if (!ra?.ok || !rb?.ok) {
                check(false, `placement ${i} accepted (${ra?.error} / ${rb?.error})`);
                break;
            }
        }
        const results = await until(() => A.state?.phase === "results" && A.state.results, 8000);
        check(results && results.length === 2, "the round ends with both players ranked");
        if (results) {
            check(results.every((r) => r.grid.every((c) => c !== null)), "every result shows a full grid");
            check(results[0].points >= results[1].points, "results are ordered by points");
        }
        const pool = new pg.Pool({ connectionString: DB });
        await sleep(300);
        const saved = (await pool.query("SELECT user_id::text, points FROM round_results WHERE user_id = ANY($1::bigint[])", [[idA, idB]])).rows;
        check(saved.length === 2, "each human's round is saved to round_results");
        const prof = (await pool.query("SELECT stats FROM players WHERE user_id = $1", [idA])).rows[0];
        check(prof && prof.stats.rounds === 1, "the player's profile counts the round");
        const lb = await emit(A, "leaderboard:get");
        check(lb?.ok && lb.data.periods.daily.some((r) => r.username === `smoke-a-${idA}`), "the daily Best round board lists the player");
        await pool.end();

        check((await emit(A, "host:addBots", { count: 1 }))?.ok, "the host adds an AI player");
        check((await emit(B, "host:startRound"))?.error === "not_host", "only the host can start a round");
        check((await emit(A, "host:startRound"))?.ok, "the host starts the next round");
        const botPlaced = await until(() => A.state?.phase === "placing" && A.state.players.find((p) => p.isBot && p.placedCurrent), 6000);
        check(!!botPlaced, "the AI player places its card");
    }

    const contest = await emit(A, "room:create", { name: "Smoke contest", rounds: 3, startMode: "manual", botCount: 1 });
    check(contest?.ok && /^[0-9a-f]{40}$/.test(contest.roomId), "a contest is created");
    const info = await emit(guest.s, "room:public", { roomId: contest.roomId });
    check(info?.ok && info.room.standings.length === 2 && info.room.status === "waiting", "anyone can read a contest's standings");
    check((await emit(B, "room:start", { roomId: contest.roomId }))?.error === "not_host", "only the host starts a contest");
    check((await emit(A, "room:start", { roomId: contest.roomId }))?.ok, "the host starts the contest");
    const demo = await emit(guest.s, "room:public", { roomId: "5a".repeat(20) });
    check(demo?.ok && demo.room.name === "Staging demo contest", "staging has the demo contest");
}
catch (err) {
    failures++;
    console.error("  FAIL unexpected error", err);
}
for (const s of sockets)
    s.close();
const t0 = Date.now();
server.kill("SIGTERM");
const res = await Promise.race([exited, sleep(4000).then(() => null)]);
check(res && res.code === 0, `SIGTERM shuts the server down cleanly within 4s (${res ? `${Date.now() - t0}ms` : "timed out"})`);
if (!res)
    server.kill("SIGKILL");
if (failures) {
    console.error(serverLog.split("\n").slice(-30).join("\n"));
    console.error(`\nRESULT: ${failures} smoke failure(s)`);
    process.exit(1);
}
console.log("RESULT: smoke ok");
