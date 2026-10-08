#!/usr/bin/env node
//
// Poker Kings — single-platform-process entrypoint.
//
// Mirrors the prod path of run.sh (which orchestrates three processes for
// local/self-hosted runs), but as one `npm start` process so platform
// builders (kpack) get a single launch line with no bun dependency:
//
//   1. realtime poker-service  (socket.io + REST)   on 127.0.0.1
//   2. Next.js standalone web server                on 127.0.0.1
//   3. public proxy                                 on 0.0.0.0:$PORT
//
// The proxy MUST run on node (not bun): Bun's http.Server does not flush
// WebSocket upgrade sockets, which breaks Socket.IO through the proxy.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_PORT = Number(process.env.PORT ?? 3000);
const NEXT_PORT = Number(process.env.NEXT_PORT ?? 44446);
const SOCKET_PORT = Number(process.env.SOCKET_PORT ?? 44447);
const REST_PORT = Number(process.env.POKER_REST_PORT ?? 44448);
const DRAIN_MS = 3000;

let shuttingDown = false;
const children = [];

function start(name, scriptPath, env) {
  if (!existsSync(scriptPath)) {
    console.error(`[start-stack] missing ${name} entrypoint: ${scriptPath}`);
    console.error("[start-stack] did the build step run? (`npm run build`)");
    process.exit(1);
  }
  const child = spawn(process.execPath, [scriptPath], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[start-stack] ${name} exited (code=${code ?? 0} signal=${signal ?? "-"}); stopping stack`);
      shutdown("child-exit");
    }
  });
  children.push({ name, child });
  return child;
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[start-stack] ${signal} received, draining`);
  for (const { name, child } of children) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch (err) {
        console.error(`[start-stack] SIGTERM to ${name} failed: ${err.message}`);
      }
    }
  }
  const hardStop = setTimeout(() => {
    for (const { child } of children) {
      if (child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    }
  }, DRAIN_MS);
  hardStop.unref?.();
  const deadline = setTimeout(() => process.exit(0), DRAIN_MS);
  deadline.unref?.();
  await Promise.allSettled(
    children.map(
      ({ child }) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once("exit", resolve);
        }),
    ),
  );
  clearTimeout(hardStop);
  clearTimeout(deadline);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start("realtime", join(ROOT, "mini-services/poker-service/index.js"), {
  POKER_SERVICE_PORT: String(SOCKET_PORT),
  POKER_REST_PORT: String(REST_PORT),
});
start("web", join(ROOT, ".next/standalone/server.js"), {
  NODE_ENV: "production",
  HOSTNAME: "127.0.0.1",
  PORT: String(NEXT_PORT),
  // The room proxy inside Next reaches REST over 127.0.0.1.
  POKER_REST_PORT: String(REST_PORT),
});
start("proxy", join(ROOT, "scripts/proxy.mjs"), {
  PUBLIC_PORT: String(PUBLIC_PORT),
  NEXT_PORT: String(NEXT_PORT),
  SOCKET_PORT: String(SOCKET_PORT),
  REST_PORT: String(REST_PORT),
  BIND_HOST: "0.0.0.0",
});

console.log(`[start-stack] poker kings stack on 0.0.0.0:${PUBLIC_PORT} (next=${NEXT_PORT} socket=${SOCKET_PORT} rest=${REST_PORT})`);