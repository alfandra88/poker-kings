/**
 * Poker Kings — platform entrypoint (kpack node-start looks for this file).
 *
 * Serves the Next.js frontend and the realtime poker service on ONE port,
 * behind Homeroom's iframe token auth:
 *  - RS256 user JWTs (?token= / x-usernode-token) identify Homeroom users.
 *  - ES256 guest tokens let signed-out visitors look around (read-only).
 *  - /api/* is deny-by-default; /health is public.
 */
import { createServer } from "node:http";
import next from "next";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { createRealtime } from "./src/realtime/poker/index.js";
import { StateStore } from "./src/realtime/poker/src/state.js";

const PORT = Number(process.env.PORT || 3000);
const IS_STAGING = process.env.USERNODE_ENV === "staging";
const DRAIN_MS = 3000; // drain deadline (literal constant, per platform contract)

const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || "").replace(/\\n/g, "\n");
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || "").replace(/\\n/g, "\n");
const APP_AUDIENCE = process.env.USERNODE_APP_ID
    ? `usernode:app:${process.env.USERNODE_APP_ID}`
    : null;
const GUEST_AUDIENCE = process.env.USERNODE_APP_ID
    ? `usernode:app:${process.env.USERNODE_APP_ID}:guest`
    : null;

// Chromeless deep links: share links pasted into a browser carry no token, so
// they are redirected to the platform's chromeless view of this app.
const PLATFORM_BASE_URL =
    process.env.USERNODE_PLATFORM_ORIGIN ||
    (process.env.USERNODE_DOMAIN ? `https://${process.env.USERNODE_DOMAIN}` : null);
const APP_SLUG = process.env.USERNODE_APP_SLUG || "poker-kings";
const PATH_RE = /^\/[^\s\\`'";<>{}]*$/; // relative, no scheme/host/whitespace/backticks

function verifyUserToken(token) {
    if (!JWT_PUBLIC_KEY || !APP_AUDIENCE)
        return null;
    try {
        const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
            algorithms: ["RS256"],
            issuer: "usernode",
            audience: APP_AUDIENCE,
        });
        if (!claims || claims.pur !== "iframe" || typeof claims.id !== "string")
            return null;
        return { id: claims.id, username: claims.username, locale: claims.locale ?? null };
    }
    catch {
        return null;
    }
}
function verifyGuestToken(token) {
    if (!GUEST_PUBLIC_KEY || !GUEST_AUDIENCE)
        return null;
    try {
        const g = jwt.verify(token, GUEST_PUBLIC_KEY, {
            algorithms: ["ES256"],
            issuer: "usernode",
            audience: GUEST_AUDIENCE,
        });
        if (!g || g.pur !== "guest" || g.guest !== true)
            return null;
        return { guest: true };
    }
    catch {
        return null;
    }
}

// Preview-time "now" (staging only): the platform can pin a preview to a moment.
const PREVIEW_NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
    const raw = IS_STAGING ? (req.headers["x-usernode-now"] || new URL(req.url, "http://x").searchParams.get("un-now")) : null;
    return typeof raw === "string" && PREVIEW_NOW_RE.test(raw) ? new Date(raw) : new Date();
}

// ---- database ----
const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
    : null;
const store = new StateStore(pool);

async function migrate() {
    if (!pool)
        return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS profiles (
            id           TEXT PRIMARY KEY,
            nickname     TEXT NOT NULL DEFAULT 'Player',
            avatar       TEXT,
            language     TEXT,
            xp           INTEGER NOT NULL DEFAULT 0,
            rounds_won   INTEGER NOT NULL DEFAULT 0,
            hands_played INTEGER NOT NULL DEFAULT 0,
            showdowns    INTEGER NOT NULL DEFAULT 0,
            achievements JSONB NOT NULL DEFAULT '{}'::jsonb,
            counters     JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
    // Public table: nicknames/avatars/xp and season standings are in-app public
    // profile data; nothing sensitive is stored here.
    await pool.query(`
        CREATE TABLE IF NOT EXISTS season_points (
            season  TEXT NOT NULL,
            user_id TEXT NOT NULL,
            points  INTEGER NOT NULL DEFAULT 0,
            played  INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (season, user_id)
        )`);
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT");
}

// Staging starts from an empty copy: seed a handful of obviously-fake demo
// profiles so leaderboards are reviewable. Fake identities only, idempotent.
async function seedStaging() {
    if (!pool || !IS_STAGING)
        return;
    for (let i = 1; i <= 5; i++) {
        const id = `staging-demo-user-${i}`;
        await pool.query(
            `INSERT INTO profiles (id, nickname, avatar, xp, rounds_won, hands_played, showdowns)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO NOTHING`,
            [id, `Staging demo player ${i}`, "🂡", i * 120, i * 3, i * 40, i * 30]);
        await pool.query(
            `INSERT INTO season_points (season, user_id, points, played)
             VALUES (to_char(NOW(), 'YYYY-MM'), $1, $2, $3)
             ON CONFLICT (season, user_id) DO NOTHING`,
            [id, 600 - i * 50, i * 7]);
    }
}

// ---- HTTP app ----
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
await app.prepare();
const handle = app.getRequestHandler();

const PUBLIC_API_PATHS = new Set(["/health"]);
const ROOM_API_RE = /^\/api\/room\/([0-9a-f]{40})$/;

let shuttingDown = false;

function sendJson(res, status, body) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
    try {
        req.now = requestNow(req);

        // --- auth (also serves guests) ---
        const url = new URL(req.url, "http://x");
        const bearer = typeof req.headers["x-usernode-token"] === "string"
            ? req.headers["x-usernode-token"]
            : url.searchParams.get("token");
        req.user = null;
        req.guest = false;
        if (bearer) {
            const claims = verifyUserToken(bearer);
            if (claims)
                req.user = claims;
            else if (verifyGuestToken(bearer))
                req.guest = true;
        }

        const path = url.pathname;

        if (path === "/health") {
            if (shuttingDown) {
                return sendJson(res, 503, { ok: false, status: "shutting_down" });
            }
            return sendJson(res, 200, { ok: true, status: "ready", env: process.env.USERNODE_ENV ?? "unknown" });
        }

        const isApi = path.startsWith("/api/");
        if (isApi) {
            const isPublicGet = req.method === "GET" && (PUBLIC_API_PATHS.has(path) || ROOM_API_RE.test(path));
            if (!isPublicGet && !req.user) {
                return sendJson(res, 401, req.guest ? { error: "account_required" } : { error: "not_authenticated" });
            }
            if (path === "/api/me" && req.method === "GET") {
                const prof = store.getOrCreate(req.user.id, { nickname: req.user.username, language: req.user.locale });
                return sendJson(res, 200, { ok: true, me: store.me(prof) });
            }
            const roomMatch = ROOM_API_RE.exec(path);
            if (roomMatch && req.method === "GET") {
                const room = realtime.rooms.get(roomMatch[1]);
                if (!room)
                    return sendJson(res, 404, { ok: false, error: "room_not_found" });
                return sendJson(res, 200, { ok: true, room: room.publicView(req.user ? req.user.id : null) });
            }
            return sendJson(res, 404, { ok: false, error: "not_found" });
        }

        // Chromeless redirect: a top-level document visit with no token goes to
        // the platform's chromeless view, which re-embeds us with a real token.
        const isDocument = req.headers["sec-fetch-dest"] === "document";
        if (!req.user && !req.guest && isDocument && req.method === "GET" && PLATFORM_BASE_URL && PATH_RE.test(req.originalUrl || req.url)) {
            const dest = `${PLATFORM_BASE_URL}/app/${APP_SLUG}/full?path=${encodeURIComponent(req.originalUrl || req.url)}`;
            res.writeHead(302, { Location: dest, "Cache-Control": "no-store" });
            return res.end();
        }

        return handle(req, res);
    }
    catch (e) {
        console.error("[http] request failed", e);
        try {
            sendJson(res, 500, { ok: false, error: "internal" });
        }
        catch {
            // socket already destroyed
        }
    }
});

// ---- realtime service on the same server ----
const realtime = createRealtime(server, {
    store,
    verifyUser: verifyUserToken,
    verifyGuest: verifyGuestToken,
    dataDir: "./.data/",
});

await migrate();
await store.load();
store.startFlushTimer();
await seedStaging();

// Staging demo fixture (boot-time seed, IS_STAGING-gated, fake identities
// only): a live table with AI players so reviewers and the check runner can
// watch a real hand at a stable URL (/ ?t=DEMO01) without an account.
// Idempotent: memory store, so it is rebuilt on every staging boot.
function ensureDemoTable() {
    if (!IS_STAGING || realtime.registry.get("DEMO01"))
        return;
    const host = store.getOrCreate("staging-demo-user-1", { nickname: "Staging demo host" });
    host.token = host.id;
    const { table } = realtime.registry.createTable(
        host,
        { name: "Staging demo table", mode: "cash", variant: "nlhe", maxSeats: 6, actionTimerSec: 10, timeBankSec: 0, spectatorCards: false },
        3,
        "DEMO01",
    );
    console.log(`[poker-kings] staging demo table ready (${table.code})`);
}
ensureDemoTable();

server.listen(PORT, () => {
    console.log(`[poker-kings] listening on ${PORT} (env: ${process.env.USERNODE_ENV ?? "local"}, db: ${pool ? "postgres" : "memory"})`);
});

async function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining`);
    server.close(() => { });
    server.closeIdleConnections?.();
    const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
    try {
        realtime.dispose();
    }
    catch (e) {
        console.error("[shutdown] realtime dispose failed", e.message);
    }
    try {
        await store.close();
    }
    catch (e) {
        console.error("[shutdown] store close failed", e.message);
    }
    try {
        await pool?.end();
    }
    catch (e) {
        console.error("[shutdown] pool.end failed", e.message);
    }
    process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));