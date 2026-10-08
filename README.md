# Poker Kings: Hand Ranking

A poker hand-ranking game. There is no betting, no chips and no money of any kind.

- **Which hand wins?** Compare two five-card hands (10 points).
- **Order the hands** Rank four hands from strongest to weakest (25 points).
- A streak of correct answers adds up to 10 bonus points per answer.
- **Rooms:** create a room, share the 6-character code (or `/room/CODE` link). Everyone gets the same ten hands; the room standings rank by points.
- **Leaderboard:** total points across all answers.

## Run

```sh
npm install
DATABASE_URL=postgres://... npm start   # listens on 0.0.0.0:$PORT (default 3000)
npm test                                # unit tests; tests/api.test.js also needs DATABASE_URL
npm run lint
npm run build                           # syntax-checks the server and browser code
```

`GET /health` returns `{ ok, db }`. Auth follows the Homeroom platform conventions (iframe token
verified with `USERNODE_JWT_PUBLIC_KEY`; guests can read, writes need an account). Points and rooms
live in Postgres (`players`, `rooms`, `room_members`, `answers`). Hands are dealt and checked on the
server (`lib/hands.js`, `lib/game.js`).

`docker build .` uses the `Dockerfile` (non-root, `CMD ["node", "server.js"]`).
