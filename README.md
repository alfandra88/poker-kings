# Poker Kings 🃏

**Poker Squares with friends. Same cards, your grid.**

Poker Kings is a free multiplayer points game for Homeroom. Each round deals 25 cards, one at a
time, and every player at the table gets the same card at the same moment. You place each card in
any empty cell of your own 5×5 grid. When the grid is full, each of the 5 rows and 5 columns scores
points for the poker hand it makes. Most points wins the round.

There is nothing to buy and nothing to bet: points only count toward the leaderboard.

## Scoring

| Line (row or column) | Points |
|---|---|
| Royal flush | 100 |
| Straight flush | 75 |
| Four of a kind | 50 |
| Full house | 25 |
| Flush | 20 |
| Straight (ace high or low) | 15 |
| Three of a kind | 10 |
| Two pair | 5 |
| One pair | 2 |

## Features

- **Private tables** with a 6-character code and a `/?t=CODE` link, up to 8 players.
- **Card timer** of 10, 15 or 30 seconds. The next card comes when everyone has placed or time
  runs out; a late or disconnected player's card goes in their first empty cell.
- **AI players** (Casual, Solid, Shark). "Play now vs AI" starts a table with you and 3 of them;
  they step aside when a real player needs the seat and are left out of every leaderboard.
- **Watching**: anyone who joins mid-round, or has no account, watches every grid live.
- **Chat** with emotes, quick phrases and host moderation (mute, remove, ban).
- **Contests**: free, 3, 5 or 10 rounds, up to 64 players across tables of 8. Every table gets the
  same cards each round. Standings rank total points, then best single round; finishing places
  earn season points.
- **Leaderboard**: Best round (daily, weekly, monthly, yearly, forever) and Contest season.
- **Profile**: XP, levels, achievements and Poker Squares stats.
- **Fair shuffles**: each round publishes a seed hash and reveals the seed when it ends (Log tab).
- 25 languages; light and dark looks that follow Homeroom's theme until you pick one.

## Architecture

One Node process (`server.js`) on port 3000:

```
server.js            HTTP server: Homeroom sign-in, /health, Next.js pages, Socket.IO
server/realtime/     index.js (socket events) · table.js · contests.js · bots.js
                     store.js (Postgres) · chat.js (filters, rate limits)
src/lib/squares-engine/   pure Poker Squares engine: scoring, round flow, AI
src/lib/poker-engine/cards.js   deck, seeded shuffle and 5-card evaluator
src/lib/poker/       client store + i18n
src/components/poker/  UI: table, grid, results, drawers, dialogs, contest page
```

- **Sign-in** is Homeroom's iframe token (RS256, pinned issuer and audience). Visitors without an
  account carry a guest token and can look around; every write asks them to make an account.
- **Data** lives in the app's Postgres (`DATABASE_URL`): `players`, `round_results`,
  `contest_results`. Schema is applied on boot. Live tables and contests are in memory, so a deploy
  ends the rounds in progress; finished results are already saved.
- **Staging** previews seed a few obviously fake players, results and a "Staging demo contest".
- **Shutdown**: SIGTERM/SIGINT stop new connections, drain for 3 seconds, flush writes and close
  the pool.

## Run it

```bash
npm install
npm run build
DATABASE_URL=postgres://… npm start        # http://localhost:3000
npm run dev                                # development mode (hot reload)
```

Without `USERNODE_JWT_PUBLIC_KEY` and `USERNODE_APP_ID` nobody can sign in, so the pages render
but the realtime connection is refused. Homeroom injects both.

## Tests

```bash
npm test               # all suites below
npm run test:engine    # scoring table, seeded rounds, rule checks, stable SHA256 digest
npm run test:i18n      # 25 languages, same keys as English
npm run test:color     # palette guard
npm run test:service   # boots server.js against Postgres (SMOKE_DATABASE_URL or DATABASE_URL)
```

## Disclaimer

Poker Kings is a free points game. There is nothing to buy, bet or win except points on the
leaderboard.
