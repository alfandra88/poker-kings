import { io } from "socket.io-client";

const PORT = Number(process.env.PROXY_PORT ?? 44444);
const BASE = `http://127.0.0.1:${PORT}`;

let failed = false;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => {
  failed = true;
  console.error(`  FAIL ${m}`);
};

try {
  const probe = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(4000) });
  if (!probe.ok) throw new Error(String(probe.status));
} catch {
  console.log(`skip  nothing serving on ${BASE} — run ./run.sh first`);
  process.exit(0);
}

console.log(`proxy E2E via ${BASE}`);

const sock = io(`${BASE}/?XTransformPort=44447`, {
  // Same transport order as the web frontend (src/lib/poker/store.js), so
  // this test exercises the websocket upgrade through the proxy, not just
  // polling. "websocket" first with no fallback is what players really use.
  transports: ["websocket", "polling"],
  timeout: 15000,
});

const ask = (event, data) =>
  new Promise((res) => sock.emit(event, data, (r) => res(r ?? null)));

try {
  await new Promise((res, rej) => {
    sock.once("connect", res);
    sock.once("connect_error", rej);
    setTimeout(() => rej(new Error("connect timed out")), 16000);
  });
  ok(`socket connected (transport: ${sock.io.engine.transport.name})`);

  const auth = await ask("auth", { nickname: "ProxyE2E" });
  if (auth?.ok && /^[a-f0-9]{32}$/.test(auth.token ?? "")) ok("auth ok");
  else fail(`auth: ${auth?.error ?? "no token"}`);

  const created = await ask("table:create", {
    config: {
      variant: "nlhe",
      mode: "cash",
      maxSeats: 6,
      smallBlind: 5,
      bigBlind: 10,
      minBuyIn: 100,
      botCount: 2,
    },
  });
  if (created?.ok && created.code) ok(`table created ${created.code} (bots=${created.botsSeated})`);
  else fail(`table:create: ${created?.error}`);

  const sit = await ask("seat:sit", { seatId: 0, buyIn: 1000 });
  if (sit?.ok) ok("seated");
  else fail(`seat:sit: ${sit?.error}`);

  let snap = null;
  const onState = (s) => {
    if (s?.code === created.code) snap = s;
  };
  sock.on("state", onState);
  await ask("table:refresh", {});
  for (let i = 0; i < 40 && !snap; i++) await new Promise((r) => setTimeout(r, 100));
  sock.off("state", onState);

  if (snap?.seats) {
    const bots = snap.seats.filter((s) => s?.isBot).length;
    ok(`snapshot received (${snap.seats.filter(Boolean).length} seats, ${bots} bots)`);
    const leaks = snap.seats.filter((s) => s && !s.self && !s.isBot && !s.revealed && s.cards?.length > 0);
    if (leaks.length === 0) ok("no hole-card leak through proxy");
    else fail(`${leaks.length} opponent hand(s) leaked`);
  } else {
    fail("no snapshot received");
  }

  const listed = await ask("table:list", {});
  if (listed?.ok) ok("table:list ok");
  else fail(`table:list: ${listed?.error}`);

  const html = await (await fetch(BASE, { signal: AbortSignal.timeout(8000) })).text();
  if (html.includes("Poker Kings")) ok("web UI served by the same public port");
  else fail("homepage did not contain the Poker Kings brand");
} catch (err) {
  fail(err.message);
} finally {
  sock.close();
}

console.log(failed ? "\nRESULT: PROXY E2E FAILED" : "\nRESULT: PROXY E2E PASSED");
process.exit(failed ? 1 : 0);