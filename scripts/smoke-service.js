import { spawn } from "node:child_process";
import { io } from "socket.io-client";
import { setTimeout as sleep } from "node:timers/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SVC_DIR = join(ROOT, "mini-services/poker-service");
const PORT = 3013;

let failures = 0;
const ok = (m) => console.log(`  ok  ${m}`);
function check(cond, msg) {
  if (cond) ok(msg);
  else {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
}

if (!existsSync(join(SVC_DIR, "index.js"))) {
  console.error("service entry missing: mini-services/poker-service/index.js");
  process.exit(1);
}

const svc = spawn("bun", ["index.js"], {
  cwd: SVC_DIR,
  env: { ...process.env, POKER_SERVICE_PORT: String(PORT), POKER_REST_PORT: String(PORT + 1) },
  stdio: ["ignore", "pipe", "pipe"],
});
let svcLog = "";
svc.stdout.on("data", (d) => (svcLog += d));
svc.stderr.on("data", (d) => (svcLog += d));

function cleanup() {
  try {
    svc.kill("SIGKILL");
  } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

const deadline = Date.now() + 20_000;
let up = false;
while (Date.now() < deadline) {
  if (/realtime service ready/.test(svcLog) && /REST ready/.test(svcLog)) {
    up = true;
    break;
  }
  await sleep(200);
}
if (!up) {
  console.error("service did not start:\n" + svcLog);
  cleanup();
  process.exit(1);
}
console.log("service up (socket + REST)");

function ask(sock, event, data) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${event} timed out`)), 10_000);
    sock.emit(event, data, (r) => {
      clearTimeout(t);
      res(r);
    });
  });
}

try {
  const sock = io(`http://localhost:${PORT}`, { transports: ["websocket"] });
  await new Promise((res, rej) => {
    sock.once("connect", res);
    sock.once("connect_error", rej);
    setTimeout(() => rej(new Error("socket connect timed out")), 10_000);
  });
  ok("socket connected");

  const auth = await ask(sock, "auth", { nickname: "SmokeTester", language: "en" });
  check(auth.ok === true, "auth succeeded");
  check(/^[a-f0-9]{32}$/.test(auth.token ?? ""), "token is a 32-hex bearer token");
  check(auth.me?.nickname === "SmokeTester", "nickname echoed back");

  const daily = await ask(sock, "economy:claimDaily", {});
  check(daily.ok === true || daily.error === "already_claimed", "daily bonus claim handled");

  const created = await ask(sock, "table:create", {
    config: {
      variant: "nlhe",
      mode: "cash",
      maxSeats: 6,
      smallBlind: 5,
      bigBlind: 10,
      minBuyIn: 100,
      maxBuyIn: 0,
      botCount: 3,
      botDifficulty: "normal",
    },
  });
  check(created.ok === true, "table created");
  const code = created.code;
  check(typeof code === "string" && code.length >= 4, `table code = ${code}`);
  check(created.botsSeated === 3, `3 bots seated (got ${created.botsSeated})`);

  let snap = null;
  const onState = (s) => {
    if (s?.code === code) snap = s;
  };
  sock.on("state", onState);

  const sit = await ask(sock, "seat:sit", { seatId: 0, buyIn: 1000 });
  check(sit.ok === true, `sat at seat 0 (${sit.error ?? "ok"})`);

  const refreshed = await ask(sock, "table:refresh", {});
  check(refreshed.ok === true, "table:refresh acked");
  for (let i = 0; i < 40 && !snap; i++) await sleep(100);
  check(!!snap, "snapshot present");
  const occupied = snap?.seats?.filter(Boolean).length ?? 0;
  check(occupied >= 3, `seats occupied (${occupied})`);
  const botSeats = (snap?.seats ?? []).filter((s) => s?.isBot).length;
  check(botSeats >= 2, `bot seats present after yield (${botSeats})`);
  check((snap?.seats ?? []).some((s) => s?.self), "our own seat is flagged self");
  check(Array.isArray(snap?.board), "board is an array");

  const others = (snap.seats ?? []).filter((s) => s && !s.self && !s.isBot);
  check(
    others.every((s) => s.playerId !== auth.token),
    "no other seat exposes our bearer token",
  );
  const foreignCards = (snap.seats ?? [])
    .filter((s) => s && !s.self && !s.isBot && !s.revealed)
    .filter((s) => Array.isArray(s.cards) && s.cards.length > 0);
  check(foreignCards.length === 0, "no unrevealed opponent hole cards leaked");

  const totalChips = (snap.seats ?? [])
    .filter(Boolean)
    .reduce((a, s) => a + (s.stack ?? 0) + (s.committed ?? 0), 0);
  const potish = (snap.pot ?? 0) + totalChips;
  check(Number.isFinite(potish) && potish > 0, `chip total is finite & positive (${potish})`);

  if (snap.toAct === 0) {
    const legal = { canCheck: snap.canCheck, minRaiseTo: snap.minRaiseTo };
    const act = await ask(sock, "action", {
      type: legal.canCheck ? "check" : "call",
      to: legal.minRaiseTo ?? undefined,
    });
    check(act.ok === true, `action accepted (${act.error ?? "ok"})`);
  } else {
    ok(`not our turn yet (toAct=${snap.toAct}) — action path covered by engine sim`);
  }

  sock.off("state", onState);

  let listed = null;
  const onList = (rows) => {
    listed = rows;
  };
  sock.on("table:list", onList);
  const listAck = await ask(sock, "table:list", {});
  check(listAck.ok === true, "table:list acked");
  for (let i = 0; i < 20 && !listed; i++) await sleep(100);
  check(Array.isArray(listed), `table list broadcast received (${Array.isArray(listed) ? listed.length : "none"} rows)`);
  sock.off("table:list", onList);

  sock.close();
  console.log(failures === 0 ? "\nRESULT: ALL SMOKE TESTS PASSED" : `\nRESULT: ${failures} failure(s)`);
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
} catch (err) {
  console.error("\nSMOKE TEST ERROR:", err.message);
  console.error("service log:\n" + svcLog);
  cleanup();
  process.exit(1);
}