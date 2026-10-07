# Poker Kings 🃏

**Free poker with friends. No ads. No deposits. Just the game.**

Poker Kings is a free-to-play, browser-based, multiplayer poker platform — a modern take on the
private-home-game experience popularized by PokerNow. 100% play-chips: nothing of value can
ever be bought, won, or cashed out.

![stack](https://img.shields.io/badge/Next.js-16-black) ![js](https://img.shields.io/badge/JavaScript-ES2022-yellow) ![socket](https://img.shields.io/badge/Socket.IO-realtime-green)

## Features

- **No-Limit Hold'em + Pot-Limit Omaha (PLO4)** — full betting rules: min-raise, short all-in
  no-reopen, side pots, uncalled-bet refunds, split pots with odd-chip rule, straddle,
  run-it-twice, rabbit hunting, reveal-on-all-in.
- **Private tables in seconds** — create a table, share the 6-char code (or `/?t=CODE` link),
  friends join from any browser. No download, no signup.
- **AI players (play without waiting)** — choose the number of AI opponents (0–8) and their
  skill (Casual / Solid / Shark) right inside "Start a new game", or tap **Play now vs AI**
  for a one-tap full-bot table. Bots: Monte-Carlo equity decisions with four play styles
  (rock/tag/lag/station), human-like timing, auto top-up, live add/remove from the host
  panel — and they **step aside automatically** whenever a real player needs the seat.
- **Realtime multiplayer** — authoritative server engine (seeded, hash-committed shuffles),
  Socket.IO transport, reconnect + multi-device takeover, spectator mode.
- **Built-in chat** — emotes, quick phrases, system feed, host
  moderation (mute/kick/ban), anti-solicitation filter.
- **Tournaments** — Sit & Go + multi-table MTT: blind schedules with level countdown,
  rebuys, auto seating & rebalancing, bust ranks, payouts (play-chips), season points.
- **Free-to-play meta** — daily bonus streaks, free chip top-up (anti-abuse cooldown),
  XP & levels with cosmetic unlocks, 15 achievements, leaderboards.
- **Session Ledger** — buy-in/buy-out/stack/net per player with CSV export; full session
  log download; last-hand replay.
- **Mobile-first** — responsive table with rotated seat view, PWA manifest, safe-area
  support, thumb-zone action bar. Works on PC, Android, iOS.

## Architecture

```
┌──────────────────────────── single repo ────────────────────────────┐
│  Next.js 16 (App Router, port 3000)      mini-services/poker-service│
│  ├─ src/app/page.jsx  (SPA: home+table)  ├─ index.js (Socket.IO:44447)│
│  ├─ src/components/poker/* (UI)          ├─ src/registry.js         │
│  ├─ src/lib/poker/* (store, i18n)        ├─ src/tournament.js       │
│  │                                        ├─ src/bots.js (AI host)   │
│  └─ src/lib/poker-engine/* ← shared pure TS poker engine (no I/O)   │
│      deck/shuffle (seeded Fisher-Yates) · evaluator · table FSM     │
│      bots.js (Monte-Carlo AI decisions — pure, testable)            │
└──────────────────────────────────────────────────────────────────────┘
```

- The **engine is pure JavaScript** with injected timers/RNG — fully deterministic and
  covered by a simulation suite (`scripts/engine-baseline-run.js`): chip conservation
  at every step, hand termination, redaction (hidden-info) leak checks, betting-rule and
  pot-math assertions across 2–10 seats for both variants.
- **The server is the only source of truth.** Hole cards never leave the engine except to
  their owner (redacted snapshots per viewer); `deal` events are never broadcast.
- Wallets/profiles persist to `mini-services/data/state.json` (debounced). Live tables are
  in-memory (v1 simplification — a restart clears running tables; wallets survive).

## Run it

### One command (public port 44444)

```bash
./run.sh                 # build + start everything on http://<ip>:44444
./run.sh --status        # what's running
./run.sh --stop          # stop it
./run.sh --dev           # development mode (no proxy, port 3000)
PORT=8080 ./run.sh       # different public port
```

`run.sh` starts three things and puts a small zero-dependency reverse proxy
(`scripts/proxy.mjs`) in front so the **whole app is reachable on one port**:

| Public | Route | Upstream |
|---|---|---|
| `:44444` | `/socket.io/*` | realtime service `127.0.0.1:44447` |
| `:44444` | `/rest/room/*` | realtime REST `127.0.0.1:44448` |
| `:44444` | everything else | Next.js standalone `127.0.0.1:44446` |

Only the proxy listens publicly; the app, realtime service and REST stay bound
to localhost. Logs land in `logs/`.

> **Why a proxy?** The browser client bootstraps its socket with
> `io("/?XTransformPort=44447")` — a rewrite convention meant for a hosting
> platform that proxies that port automatically. On a plain server nothing
> answers, so the proxy performs the same rewrite itself.
>
> The proxy runs on **node**, not bun: Bun's `http.Server` fires the `upgrade`
> event but never flushes the socket, so WebSocket clients hang. Socket.IO
> falls back to long-polling automatically, so the app stays fully playable.

### Manual (two terminals)

```bash
# 1. Realtime service (port 44447)
cd mini-services/poker-service
bun install
bun run dev          # or: bun start

# 2. Web app (port 3000) — from the repo root
bun install
bun run dev
```

Open `http://localhost:3000/`.

### Tests

```bash
# from the repo root
bun test              # all four suites below, in order
bun run test:engine   # deterministic engine sim → SHA256 digest + line count
bun run test:i18n     # 25 languages × 413 keys parity + brand check
bun run test:color    # palette guard: no gold/yellow hue may return, and the
                      # brand/CTA text pairs must stay WCAG AA (≥4.5:1)
bun run test:service  # live E2E: boots the service, creates a table with 3 bots,
                      # sits, and asserts redaction + chip conservation
bun run test:proxy    # E2E through the public proxy (skips if not running):
                      # auth, table+bots, snapshot, redaction, web UI
```

`test:engine` prints a stable `SHA256` of a canonical digest (every hand event,
snapshot, legal-action set and payout across NLHE + PLO4 × cash/tournament ×
2–9 seats). It is the regression guard for the poker engine — if a change moves
that digest, game behaviour changed. `test:service` boots the realtime service on
a scratch port, so it needs no manually started server.

## Product invariants (non-negotiable)

1. Free forever — no ads, no IAP, no deposits, no crypto.
2. Chips are play money with zero monetary value; no cash-out path exists.
3. Server-authoritative dealing; provable shuffle (seed hash published per hand, revealed
   at hand end — see the Log tab).
4. Mobile is first-class; guests play with just a nickname.

## Project layout

```
mini-services/poker-service/   realtime service (Bun + Socket.IO)
  ├─ index.js                  socket handlers (auth/tables/chat/economy/tournaments)
  ├─ src/registry.js           table registry, ledger, moderation, AI seat ops
  ├─ src/bots.js               AI player host: seating, turn driving, top-ups, seat yielding
  ├─ src/tournament.js         SNG + MTT runner
  ├─ src/state.js              profiles, economy, achievements, persistence
  ├─ src/chat.js               EN/ID filters + rate limits
src/lib/poker-engine/          PURE poker engine (shared, no I/O) — incl. bots.js AI decisions
src/lib/poker-protocol/        client↔server event contract
src/lib/poker/                 client store + i18n (25 languages)
scripts/                         engine-baseline-run.js · i18n-parity-check.js
                                color-guard.js · smoke-service.js · proxy-e2e.js
src/components/poker/          UI: table, seats, cards, action bar, drawers, dialogs
src/app/page.jsx               the single-page app (home ⇄ table)
```

## Migrating from Poker X

Poker Kings is the renamed, JavaScript build of Poker X. Two breaking changes:

- **Local storage keys renamed** `pokerx.*` → `pokerkings.*` (`token`, `nick`,
  `lang`, `theme`, `consent.v1`). There is intentionally **no migration shim**:
  existing players return as guests and pick a new nickname. Clearing the old
  `pokerx.*` keys is safe.
- **TypeScript → JavaScript.** All 116 `.ts`/`.tsx` files are now `.js`/`.jsx`.
  `tsconfig.json` became `jsconfig.json` (path aliases `@/*` are unchanged), and
  `typescript` plus the `@types/react*` packages were dropped from
  `devDependencies`. Type contracts were erased, not dropped silently: the
  client↔server event contract is documented in `src/lib/poker-protocol/protocol.js`.

  Note: the `typescript` package still appears in `bun.lock` as a transitive
  dependency of `eslint-config-next` → `@typescript-eslint/typescript-estree`,
  which requires it as a non-optional peer. Removing it breaks `bun run lint`.
  No project source is TypeScript, and no build step type-checks.

## Disclaimer

Poker Kings is a free entertainment product. Chips are play money with no monetary value and
no cash-out. No real-money gambling is offered or permitted. Play responsibly.
