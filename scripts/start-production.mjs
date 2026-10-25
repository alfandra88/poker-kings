#!/usr/bin/env node
//
// Poker Kings — production launcher (Node only; the container runtime has
// no Bun). Starts the same three processes run.sh orchestrates and serves
// the whole stack on the platform's public $PORT via scripts/proxy.mjs:
//
//   0.0.0.0:$PORT   proxy  --+-- /socket.io/* -> realtime (127.0.0.1:$SOCKET_PORT)
//                            +-- /rest/room/* -> realtime REST (127.0.0.1:$REST_PORT)
//                            +-- /*           -> Next standalone (127.0.0.1:$NEXT_PORT)
//
// On the platform PORT is injected (always 3000); locally it defaults to
// run.sh's 44444. Installs SIGTERM/SIGINT shutdown: stop accepting
// connections, drain ~3s, kill children, exit.

import { spawn } from "node:child_process";
import net from "node:net";

const PUBLIC_PORT = Number(process.env.PORT ?? process.env.PUBLIC_PORT ?? 44444);
const NEXT_PORT = Number(process.env.NEXT_PORT ?? 44446);
const SOCKET_PORT = Number(process.env.SOCKET_PORT ?? 44447);
const REST_PORT = Number(process.env.REST_PORT ?? 44448);

const children = new Map(); // name -> ChildProcess
let stopping = false;

function log(msg) {
    console.log(`[start-production] ${msg}`);
}

function start(name, command, args, env = {}) {
    const child = spawn(command, args, {
        stdio: "inherit",
        env: { ...process.env, ...env },
    });
    children.set(name, child);
    child.on("exit", (code, signal) => {
        children.delete(name);
        if (!stopping) {
            log(`${name} exited unexpectedly (code=${code} signal=${signal}) — shutting down`);
            shutdown(1);
        }
    });
    return child;
}

function isUp(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: "127.0.0.1" });
        const done = (ok) => {
            socket.destroy();
            resolve(ok);
        };
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
    });
}

async function waitFor(name, port, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    let i = 0;
    while (Date.now() < deadline) {
        if (await isUp(port)) {
            log(`ok   ${name} (port ${port})`);
            return true;
        }
        await new Promise((r) => setTimeout(r, 250));
        if (++i % 40 === 0) log(`waiting for ${name} (port ${port})…`);
    }
    log(`FAIL ${name} did not come up on port ${port} within ${timeoutMs / 1000}s`);
    return false;
}

function killAll(signal = "SIGTERM") {
    for (const [name, child] of children) {
        if (!child.killed && child.exitCode === null) {
            try {
                child.kill(signal);
            } catch {
                /* already gone */
            }
        }
    }
}

async function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    log(`shutting down (${children.size} process(es))…`);
    killAll("SIGTERM");
    // Drain ~3s for in-flight requests, then force-kill whatever is left.
    await new Promise((r) => setTimeout(r, 3000));
    killAll("SIGKILL");
    process.exit(exitCode);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("uncaughtException", (err) => {
    log(`uncaught exception: ${err?.stack ?? err}`);
    shutdown(1);
});
process.on("unhandledRejection", (err) => {
    log(`unhandled rejection: ${err?.stack ?? err}`);
    shutdown(1);
});

// ── 1. realtime service (Socket.IO + REST) ─────────────────────────────
log("starting realtime service…");
start("realtime", "node", ["mini-services/poker-service/index.js"], {
    POKER_SERVICE_PORT: String(SOCKET_PORT),
    POKER_REST_PORT: String(REST_PORT),
});
if (!(await waitFor("realtime", SOCKET_PORT)) || !(await waitFor("realtime-rest", REST_PORT))) {
    await shutdown(1);
}

// ── 2. Next.js standalone (internal) ───────────────────────────────────
log("starting web (standalone)…");
// The room proxy reaches REST over 127.0.0.1, so tell it the real REST port.
start("web", "node", [".next/standalone/server.js"], {
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(NEXT_PORT),
    POKER_REST_PORT: String(REST_PORT),
});
if (!(await waitFor("web", NEXT_PORT))) {
    await shutdown(1);
}

// ── 3. public single-port proxy ────────────────────────────────────────
log(`starting public proxy on 0.0.0.0:${PUBLIC_PORT}…`);
start("proxy", "node", ["scripts/proxy.mjs"], {
    PUBLIC_PORT: String(PUBLIC_PORT),
    NEXT_PORT: String(NEXT_PORT),
    SOCKET_PORT: String(SOCKET_PORT),
    REST_PORT: String(REST_PORT),
    BIND_HOST: "0.0.0.0",
});
if (!(await waitFor("proxy", PUBLIC_PORT))) {
    await shutdown(1);
}

log(`Poker Kings is live on 0.0.0.0:${PUBLIC_PORT}`);