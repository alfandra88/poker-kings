// Poker Kings: one process serving the Next.js pages, Socket.IO and /health.
import http from "node:http";
import next from "next";
import jwt from "jsonwebtoken";
import pg from "pg";
import { Server as SocketServer } from "socket.io";
import { attachRealtime } from "./server/realtime/index.js";

const PORT = Number(process.env.PORT || 3000);
const DEV = process.env.NODE_ENV === "development";
const IS_STAGING = process.env.USERNODE_ENV === "staging";
const DRAIN_MS = 3000;

const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || "").replace(/\\n/g, "\n");
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || "").replace(/\\n/g, "\n");
const APP_AUDIENCE = process.env.USERNODE_APP_ID ? `usernode:app:${process.env.USERNODE_APP_ID}` : null;
const PUBLIC_API_PATHS = new Set(["/health"]);
// Read-only contest standings: the contest page is public, so anyone with the
// link can read it, signed in or not. GET only.
const PUBLIC_GET_PREFIXES = ["/api/room/"];
// The platform's edge answers these before the app sees them.
const PLATFORM_PREFIXES = ["/usernode-bridge/", "/usernode-native/", "/usernode-tailwind/"];

export function verifyToken(token) {
    if (!token || typeof token !== "string" || !APP_AUDIENCE)
        return null;
    if (JWT_PUBLIC_KEY) {
        try {
            const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
                algorithms: ["RS256"],
                issuer: "usernode",
                audience: APP_AUDIENCE,
            });
            if (claims && claims.pur === "iframe" && claims.id != null)
                return { user: { id: String(claims.id), username: claims.username, locale: claims.locale ?? null } };
        }
        catch { }
    }
    if (GUEST_PUBLIC_KEY) {
        try {
            const claims = jwt.verify(token, GUEST_PUBLIC_KEY, {
                algorithms: ["ES256"],
                issuer: "usernode",
                audience: `${APP_AUDIENCE}:guest`,
            });
            if (claims && claims.pur === "guest" && claims.guest === true)
                return { guest: true };
        }
        catch { }
    }
    return null;
}

function tokenFromRequest(req, url) {
    const header = req.headers["x-usernode-token"];
    return url.searchParams.get("token") || (Array.isArray(header) ? header[0] : header) || null;
}

function sendJson(res, status, body) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = next({ dev: DEV, dir: process.cwd() });
const handle = app.getRequestHandler();
let shuttingDown = false;

await app.prepare();

const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") {
        return sendJson(res, shuttingDown ? 503 : 200, { ok: !shuttingDown });
    }
    if (PLATFORM_PREFIXES.some((p) => url.pathname.startsWith(p))) {
        return sendJson(res, 404, { error: "served_by_platform" });
    }
    const who = verifyToken(tokenFromRequest(req, url));
    req.user = who?.user ?? null;
    req.guest = !!who?.guest;
    if ((req.method !== "GET" && req.method !== "HEAD") || url.pathname.startsWith("/api/")) {
        const publicRead = req.method === "GET" && PUBLIC_GET_PREFIXES.some((p) => url.pathname.startsWith(p));
        if (!PUBLIC_API_PATHS.has(url.pathname) && !publicRead && !req.user) {
            if (req.guest)
                return sendJson(res, 401, { error: "account_required" });
            return sendJson(res, 401, { error: "Not authenticated" });
        }
    }
    handle(req, res);
});

const io = new SocketServer(server, {
    path: "/socket.io/",
    serveClient: false,
    destroyUpgrade: false,
    pingTimeout: 60000,
    pingInterval: 25000,
});

const realtime = await attachRealtime(io, {
    pool,
    isStaging: IS_STAGING,
    authenticate: (socket) => {
        const hs = socket.handshake;
        const header = hs.headers["x-usernode-token"];
        const token = (hs.auth && hs.auth.token) || (Array.isArray(header) ? header[0] : header) || null;
        return verifyToken(token);
    },
});
// Lets the /api/room/[id] route read contests from this same process.
globalThis.__pokerSquares = realtime;

// Socket.IO handles its own upgrades; the rest (Next dev reload) go to Next.
const upgrade = typeof app.getUpgradeHandler === "function" ? app.getUpgradeHandler() : null;
server.on("upgrade", (req, socket, head) => {
    if ((req.url || "").startsWith("/socket.io/"))
        return;
    if (upgrade)
        upgrade(req, socket, head);
    else
        socket.destroy();
});

server.listen(PORT, () => {
    console.log(`[poker-kings] listening on ${PORT}${DEV ? " (dev)" : ""}`);
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
        io.close();
        await realtime.flush();
    }
    catch (e) {
        console.error("[shutdown] realtime flush failed", e.message);
    }
    try {
        await pool.end();
    }
    catch (e) {
        console.error("[shutdown] pool.end failed", e.message);
    }
    process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
