import { createServer } from "node:http";
import { Server } from "socket.io";
import { randomBytes } from "node:crypto";
import { StateStore } from "./src/state.js";
import { TableRegistry, sanitizeConfig } from "./src/registry.js";
import { RateLimiter, SpamClamp } from "./src/chat.js";
import { RoomRunner } from "./src/room.js";
const PORT = Number(process.env.POKER_SERVICE_PORT ?? 44447);
const httpServer = createServer();
const io = new Server(httpServer, {
    path: "/",
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000,
});
const store = new StateStore();
const registry = new TableRegistry(io, store);

const rooms = new RoomRunner({
    broadcastRoom: (roomId) => {
        const room = rooms.get(roomId);
        if (!room)
            return;
        const sockets = io.sockets.adapter.rooms.get(`room:${roomId}`);
        if (!sockets)
            return;
        for (const sid of sockets) {
            const s = io.sockets.sockets.get(sid);
            const token = s?.data.profile ? s.data.profile.token : null;
            s?.emit("room:state", room.publicView(token));
        }
    },
    broadcastRoomToTables: (roomId, tableCodes) => {
        const room = rooms.get(roomId);
        if (!room)
            return;
        for (const code of tableCodes) {
            const sockets = io.sockets.adapter.rooms.get(`table:${code}`);
            if (!sockets)
                continue;
            for (const sid of sockets) {
                const s = io.sockets.sockets.get(sid);
                if (!s?.data.profile)
                    continue;
                const token = s.data.profile.token;
                s.emit("room:state", room.publicView(token));
            }
        }
    },
    broadcast: (tableCode, ev) => {
        io.to(`table:${tableCode}`).emit("event", ev);
    },
    toastProfile: (token, toast) => {
        for (const [, s] of io.sockets.sockets) {
            if (s.data.profile && s.data.profile.token === token) {
                s.emit("toast", toast);
            }
        }
    },
    registerTable: (table, hostId) => registry.registerExternal(table, hostId),
    unregisterTable: (code) => registry.unregister(code),
    broadcastTableState: (code) => registry.markDirty(code),
    chatSystem: (code, text) => registry.systemChat(code, text),
    bots: registry.bots,
}, store, new URL("../data/", import.meta.url).pathname);
const limiters = new WeakMap();
function lim(sock) {
    let l = limiters.get(sock);
    if (!l) {
        l = {
            action: new RateLimiter(12, 5000),
            chat: new RateLimiter(6, 10000),
            emote: new RateLimiter(10, 10000),
            chatSpam: new SpamClamp(),
        };
        limiters.set(sock, l);
    }
    return l;
}
function currentTableCode(sock) {
    for (const room of sock.rooms) {
        if (room.startsWith("table:"))
            return room.slice(6);
    }
    return null;
}
function ackFn(fn, payload) {
    if (typeof fn === "function")
        fn(payload);
}
const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error, params) => ({ ok: false, error, params });
io.on("connection", (sock) => {
    sock.data.profile = null;
    const me = () => store.me(sock.data.profile);
    const requireAuth = () => {
        if (!sock.data.profile) {
            sock.emit("toast", { kind: "error", i18n: { key: "error.auth_first" } });
            return null;
        }
        return sock.data.profile;
    };
    const emitMe = () => sock.emit("me", me());
    sock.on("auth", (data, cb) => {
        const d = (data ?? {});
        const token = d.token && /^[a-f0-9]{32}$/.test(d.token) ? d.token : randomBytes(16).toString("hex");
        const profile = store.getOrCreate(token, d.nickname, d.language);
        sock.data.profile = profile;
        sock.join(`user:${profile.token}`);
        ackFn(cb, ok({ token, me: store.me(profile) }));
    });
    sock.on("economy:claimDaily", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const res = store.claimDaily(p);
        if (!res)
            return ackFn(cb, fail("already_claimed"));
        store.checkAchievements(p);
        emitMe();
        sock.emit("toast", {
            kind: "success",
            i18n: { key: "toast.daily_claimed", params: { amount: res.amount, streak: res.streak } },
        });
        ackFn(cb, ok({ amount: res.amount }));
    });
    sock.on("economy:topUp", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const amount = store.topUp(p);
        if (!amount)
            return ackFn(cb, fail("topup_cooldown"));
        emitMe();
        sock.emit("toast", { kind: "success", i18n: { key: "toast.topup_ok", params: { amount } } });
        ackFn(cb, ok({ amount }));
    });
    sock.on("profile:get", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        sock.emit("profile", { me: store.me(p), stats: store.statsView(p) });
        ackFn(cb, ok());
    });
    sock.on("leaderboard:get", (_d, cb) => {
        sock.emit("leaderboard", store.leaderboardData());
        ackFn(cb, ok());
    });
    sock.on("table:create", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const raw = d.config ?? {};
        const cfg = sanitizeConfig(raw, p);
        const botCount = Math.max(0, Math.min(9, Math.round(Number(raw.botCount ?? 0))));
        const { table } = registry.createTable(p, cfg, botCount);
        registry.systemChat(table.code, `table_created|${p.nickname}`);
        sock.join(`table:${table.code}`);
        sock.data.tableCode = table.code;
        registry.broadcastTableState(table.code);
        ackFn(cb, ok({ code: table.code, botsSeated: botCount > 0 ? registry.bots.botCount(table.code) : 0 }));
    });
    sock.on("table:join", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const entry = registry.get((d.code || "").toUpperCase().trim());
        console.log(`[join] ${p.nickname} -> ${d.code} found=${!!entry}`);
        if (!entry)
            return ackFn(cb, fail("table_not_found"));
        if (registry.banCheck(entry.table.code, p.token))
            return ackFn(cb, fail("banned"));
        if (entry.extras.hostId !== p.token && entry.table.cfg.password && entry.table.cfg.password !== d.password) {
            return ackFn(cb, fail("wrong_password"));
        }
        for (const [, s] of io.sockets.sockets) {
            if (s.id !== sock.id && s.data.profile && s.data.profile.token === p.token && s.rooms.has(`table:${entry.table.code}`)) {
                s.emit("superseded", {});
                s.leave(`table:${entry.table.code}`);
            }
        }
        sock.join(`table:${entry.table.code}`);
        sock.data.tableCode = entry.table.code;
        entry.table.setConnected(p.token, true);
        sock.emit("chat:history", { messages: registry.chatHistory(entry.table.code) });
        registry.broadcastTableState(entry.table.code);
        sock.emit("log", { events: entry.table.lastEvents(60) });
        ackFn(cb, ok({ code: entry.table.code }));
    });
    sock.on("table:refresh", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        if (!code || !registry.get(code))
            return ackFn(cb, fail("no_table"));
        registry.broadcastTableState(code);
        ackFn(cb, ok());
    });
    sock.on("table:leave", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        if (code) {
            const entry = registry.get(code);
            if (entry) {
                const res = entry.table.standUp(p.token);
                if (res.ok && res.stack && res.stack > 0 && entry.table.cfg.mode === "cash") {
                    p.chips += res.stack;
                    registry.ledgerAdd(entry, p.token, "buy_out", res.stack);
                    store.markDirty();
                }
                entry.table.setConnected(p.token, false);
                registry.broadcastTableState(code);
            }
            sock.leave(`table:${code}`);
        }
        emitMe();
        ackFn(cb, ok());
    });
    sock.on("table:list", (_d, cb) => {
        sock.emit("table:list", registry.listTables());
        ackFn(cb, ok());
    });
    sock.on("table:exportLog", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return ackFn(cb, fail("no_table"));
        // PRIVACY: the table password must never leave the server (same rule as
        // snapshotFor). Clone the config and strip secrets before export.
        const cfgView = structuredClone(entry.table.cfg);
        delete cfgView.password;
        ackFn(cb, ok({ events: entry.table.exportEvents(), config: cfgView }));
    });

    const doSit = (p, seatId, buyInRaw) => {
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return { ok: false, error: "no_table" };
        if (entry.table.closed)
            return { ok: false, error: "table_not_found" };
        const seatedNow = entry.table.seatOf(p.token);
        if (seatedNow)
            return { ok: true, seatId: seatedNow.seatId, buyIn: seatedNow.stack };
        if (entry.extras.hostId !== p.token && entry.table.cfg.approveJoin && !entry.extras.pending.has(p.token)) {
            entry.extras.pending.set(p.token, { nickname: p.nickname, avatar: p.avatar });
            const hostSock = findSocketByToken(entry.extras.hostId);
            if (hostSock) {
                // PRIVACY — the host sees a one-time ticket, never the requester's token
                const reqId = `jr${randomBytes(6).toString("hex")}`;
                entry.extras.joinReq.set(reqId, p.token);
                hostSock.emit("join:request", { requestId: reqId, nickname: p.nickname });
            }
            return { ok: false, error: "wait_approval" };
        }
        const buyIn = Math.min(buyInRaw ?? entry.table.cfg.minBuyIn, p.chips);
        console.log(`[sit] ${p.nickname} seat=${seatId} buyIn=${buyIn} chips=${p.chips} mode=${entry.table.cfg.mode}`);
        const seatIdx = Math.floor(seatId);
        const occ = entry.table.seats[seatIdx];
        if (occ && occ.playerId && registry.isBotAt(entry.table.code, occ.playerId) && entry.table.cfg.botsYieldSeats !== false) {
            const botId = occ.playerId;
            if (!entry.table.handActive) {
                registry.removeBot(entry.table.code, botId);
            }
            else {
                registry.removeBot(entry.table.code, botId);
                return { ok: false, error: "bot_making_room" };
            }
        }
        if (entry.table.cfg.mode === "cash") {
            if (p.chips < entry.table.cfg.minBuyIn) {
                return { ok: false, error: "not_enough_chips" };
            }
            if (buyIn > p.chips)
                return { ok: false, error: "not_enough_chips" };
            p.chips -= buyIn;
            registry.ledgerAdd(entry, p.token, "buy_in", buyIn);
            store.markDirty();
        }
        const res = entry.table.sitDown(seatId, { playerId: p.token, nickname: p.nickname, avatar: p.avatar }, buyIn);
        if (!res.ok && entry.table.cfg.mode === "cash") {
            p.chips += buyIn;
            store.markDirty();
            return { ok: false, error: res.error ?? "sit_failed" };
        }
        registry.broadcastTableState(entry.table.code);
        emitMe();
        registry.systemChat(entry.table.code, `sat_down|${p.nickname}|${buyIn}`);
        return { ok: true, seatId, buyIn };
    };
    sock.on("seat:sit", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        if (!lim(sock).action.allow())
            return ackFn(cb, fail("rate_limited"));
        const d = (data ?? {});
        const res = doSit(p, d.seatId, d.buyIn);
        ackFn(cb, res.ok ? ok({ seatId: res.seatId, buyIn: res.buyIn }) : fail(res.error ?? "sit_failed"));
    });

    sock.on("seat:auto", (_data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        if (!lim(sock).action.allow())
            return ackFn(cb, fail("rate_limited"));
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return ackFn(cb, fail("no_table"));
        if (entry.table.closed)
            return ackFn(cb, fail("table_not_found"));
        const existing = entry.table.seatOf(p.token);
        if (existing)
            return ackFn(cb, ok({ seatId: existing.seatId, buyIn: existing.stack }));
        const cfg = entry.table.cfg;
        const nSeats = entry.table.seats.length;
        if (cfg.mode === "cash" && p.chips < cfg.minBuyIn) {
            return ackFn(cb, fail("not_enough_chips"));
        }
        let buyIn;
        if (cfg.mode === "cash") {
            const target = cfg.bigBlind * 100;
            const max = cfg.maxBuyIn > 0 ? Math.min(cfg.maxBuyIn, p.chips) : p.chips;
            buyIn = Math.max(cfg.minBuyIn, Math.min(target, max));
        }
        const pref = [];
        const mid = Math.floor(nSeats / 2);
        for (let off = 0; off < nSeats; off++) {
            const step = Math.ceil(off / 2) * (off % 2 === 1 ? 1 : -1);
            pref.push((mid + step + nSeats) % nSeats);
        }
        const freeSeat = pref.find((i) => !entry.table.seats[i]);
        if (freeSeat !== undefined) {
            const res = doSit(p, freeSeat, buyIn);
            return ackFn(cb, res.ok ? ok({ seatId: res.seatId, buyIn: res.buyIn }) : fail(res.error ?? "sit_failed"));
        }
        const botSeat = registry.yieldableBotSeat(entry.table.code);
        if (botSeat !== null) {
            const res = doSit(p, botSeat, buyIn);
            return ackFn(cb, res.ok ? ok({ seatId: res.seatId, buyIn: res.buyIn }) : fail(res.error ?? "sit_failed"));
        }
        ackFn(cb, fail("table_full"));
    });
    sock.on("seat:stand", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return ackFn(cb, fail("no_table"));
        const res = entry.table.standUp(p.token);
        if (res.ok && res.stack && res.stack > 0 && entry.table.cfg.mode === "cash") {
            p.chips += res.stack;
            registry.ledgerAdd(entry, p.token, "buy_out", res.stack);
            store.markDirty();
        }
        registry.broadcastTableState(code);
        emitMe();
        ackFn(cb, ok({ stack: res.stack ?? 0 }));
    });
    sock.on("seat:sitout", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        entry.table.sitOutToggle(p.token, !!d.on);
        ackFn(cb, ok());
    });
    sock.on("seat:straddle", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        entry.table.straddleToggle(p.token, !!d.on);
        ackFn(cb, ok());
    });
    sock.on("seat:addChips", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry || entry.table.cfg.mode !== "cash")
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        const seat = entry.table.seatOf(p.token);
        if (!seat)
            return ackFn(cb, fail("not_seated"));
        const amount = Math.max(0, Math.min(Math.round(d.amount ?? 0), p.chips));
        if (amount <= 0)
            return ackFn(cb, fail("bad_amount"));
        p.chips -= amount;
        seat.stack += amount;
        registry.ledgerAdd(entry, p.token, "add_chips", amount);
        store.markDirty();
        registry.broadcastTableState(entry.table.code);
        emitMe();
        ackFn(cb, ok());
    });
    sock.on("action", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        if (!lim(sock).action.allow())
            return ackFn(cb, fail("rate_limited"));
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        const res = entry.table.act(p.token, d.type, d.to);
        if (!res.ok)
            return ackFn(cb, fail(res.error ?? "action_failed"));
        ackFn(cb, ok());
    });
    sock.on("rabbit:reveal", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return ackFn(cb, fail("no_table"));
        const res = entry.table.rabbitRevealFor(p.token);
        if (res) {
            sock.emit("event", { t: "rabbit", kind: "reveal", stage: res.stage, cards: res.cards });
        }
        ackFn(cb, ok());
    });
    sock.on("rit:vote", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        entry.table.voteRit(p.token, !!d.yes);
        ackFn(cb, ok());
    });
    sock.on("chat", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        if (!lim(sock).chat.allow())
            return ackFn(cb, fail("rate_limited"));
        const code = currentTableCode(sock);
        if (!code)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        const res = registry.chatMessage(code, p, String(d.text ?? ""), !!d.emote);
        if ("error" in res)
            return ackFn(cb, fail(res.error));
        ackFn(cb, ok());
    });
    sock.on("react", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        if (!lim(sock).emote.allow())
            return ackFn(cb, fail("rate_limited"));
        const code = currentTableCode(sock);
        if (!code)
            return ackFn(cb, fail("no_table"));
        const entry = registry.get(code);
        if (!entry)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        const kind = ["nh", "gg", "wp", "nice"].includes(d.kind) ? d.kind : "gg";
        registry.systemChat(code, `reaction|${p.nickname}|${kind}|${d.seatId ?? ""}`);
        if (d.seatId !== undefined && d.seatId !== null) {
            const targetSeat = entry.table.seats[d.seatId];
            const targetId = targetSeat?.playerId;
            if (targetId && !targetId.startsWith("leaving:")) {
                const prof = store.getOrCreate(targetId);
                store.counter(prof, "ggReceived", 1);
                store.checkAchievements(prof);
            }
        }
        ackFn(cb, ok());
    });
    sock.on("host:kick", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        if (!code)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        const target = registry.resolveSeatId(code, d.playerId);
        if (!target)
            return ackFn(cb, fail("not_allowed"));
        const res = registry.kick(code, p.token, target);
        if (res)
            registry.broadcastTableState(code);
        ackFn(cb, res ? ok() : fail("not_allowed"));
    });
    sock.on("host:addBots", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry || !registry.isHost(code, p.token))
            return ackFn(cb, fail("not_allowed"));
        if (entry.table.cfg.mode !== "cash")
            return ackFn(cb, fail("not_allowed"));
        const d = (data ?? {});
        const free = entry.table.seats.filter((s) => s === null).length;
        const seated = registry.addBots(code, Math.min(Math.max(1, d.count ?? 1), free), entry.table.cfg.botDifficulty ?? "normal");
        if (seated.length === 0)
            return ackFn(cb, fail("table_full"));
        registry.broadcastTableState(entry.table.code);
        ackFn(cb, ok({ seated: seated.length }));
    });
    sock.on("host:removeBot", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry || !registry.isHost(code, p.token))
            return ackFn(cb, fail("not_allowed"));
        const d = (data ?? {});
        const res = registry.removeBot(code, d.playerId);
        if (!res)
            return ackFn(cb, fail("not_allowed"));
        registry.broadcastTableState(entry.table.code);
        ackFn(cb, ok());
    });
    sock.on("host:mute", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        if (!code)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        const target = registry.resolveSeatId(code, d.playerId);
        if (!target)
            return ackFn(cb, fail("not_allowed"));
        const res = registry.mute(code, p.token, target, Math.max(1, Math.min(1440, d.minutes ?? 10)));
        ackFn(cb, res ? ok() : fail("not_allowed"));
    });
    sock.on("host:ban", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        if (!code)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        const target = registry.resolveSeatId(code, d.playerId);
        if (!target)
            return ackFn(cb, fail("not_allowed"));
        const res = registry.ban(code, p.token, target, d.minutes ?? 60);
        ackFn(cb, res ? ok() : fail("not_allowed"));
    });
    sock.on("host:pause", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry || !registry.isHost(code, p.token))
            return ackFn(cb, fail("not_allowed"));
        const d = (data ?? {});
        entry.table.pause(!!d.on);
        if (!d.on)
            registry.bots.notifyEvent(entry.table.code, { t: "note" });
        ackFn(cb, ok());
    });
    sock.on("host:config", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry || !registry.isHost(code, p.token))
            return ackFn(cb, fail("not_allowed"));
        const d = (data ?? {});
        entry.table.updateConfig(sanitizeConfig({ ...entry.table.cfg, ...d.patch }, p));
        registry.broadcastTableState(entry.table.code);
        ackFn(cb, ok());
    });
    sock.on("host:approve", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        const entry = code ? registry.get(code) : null;
        if (!entry || !registry.isHost(code, p.token))
            return ackFn(cb, fail("not_allowed"));
        const d = (data ?? {});
        // PRIVACY — approve by one-time ticket (requestId). The legacy playerId
        // path stays for server-side tests; both resolve to the requester token.
        let targetToken = null;
        if (typeof d.requestId === "string" && entry.extras.joinReq.has(d.requestId)) {
            targetToken = entry.extras.joinReq.get(d.requestId) ?? null;
            entry.extras.joinReq.delete(d.requestId);
        }
        else if (typeof d.playerId === "string" && d.playerId) {
            targetToken = d.playerId;
        }
        if (!targetToken)
            return ackFn(cb, fail("not_allowed"));
        const pending = entry.extras.pending.get(targetToken);
        entry.extras.pending.delete(targetToken);
        const targetSock = findSocketByToken(targetToken);
        if (pending && targetSock) {
            if (d.ok) {
                targetSock.emit("toast", { kind: "success", i18n: { key: "toast.join_approved" } });
            }
            else {
                targetSock.emit("toast", { kind: "warn", i18n: { key: "toast.join_denied" } });
                targetSock.leave(`table:${code}`);
                targetSock.emit("state", null);
            }
        }
        ackFn(cb, ok());
    });
    sock.on("host:transfer", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        if (!code)
            return ackFn(cb, fail("no_table"));
        const d = (data ?? {});
        const target = registry.resolveSeatId(code, d.playerId);
        if (!target)
            return ackFn(cb, fail("not_allowed"));
        const res = registry.transferHost(code, p.token, target);
        ackFn(cb, res ? ok() : fail("not_allowed"));
    });
    sock.on("host:close", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const code = currentTableCode(sock);
        if (!code)
            return ackFn(cb, fail("no_table"));
        const res = registry.isHost(code, p.token);
        if (!res)
            return ackFn(cb, fail("not_allowed"));
        registry.closeTable(code);
        ackFn(cb, ok());
    });
    sock.on("room:create", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const res = rooms.create(d, p);
        if (!res.ok)
            return ackFn(cb, fail(res.error));
        sock.join(`room:${res.room.roomId}`);
        sock.data.roomId = res.room.roomId;
        sock.emit("room:state", res.room.publicView(p.token));
        emitMe();         ackFn(cb, ok({ roomId: res.room.roomId }));
    });
    sock.on("room:join", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const roomId = String(d.roomId ?? "").toLowerCase().trim();
        const room = rooms.get(roomId);
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        for (const [, s] of io.sockets.sockets) {
            if (s.id !== sock.id && s.data.profile && s.data.profile.token === p.token && s.rooms.has(`room:${roomId}`)) {
                s.emit("superseded", {});
                s.leave(`room:${roomId}`);
            }
        }
        const res = room.join(p);
        sock.join(`room:${roomId}`);
        sock.data.roomId = roomId;
        sock.emit("room:state", room.publicView(p.token));
        if (!res.ok) {
            return ackFn(cb, fail(res.error ?? "join_failed"));
        }
        emitMe();
        ackFn(cb, ok({ roomId }));
    });
    sock.on("room:leave", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? ""));
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        const res = room.leave(p);
        if (!res.ok)
            return ackFn(cb, fail(res.error ?? "leave_failed"));
        emitMe();
        ackFn(cb, ok());
    });
    sock.on("room:start", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? ""));
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        const res = room.startByHost(p.token);
        if (!res.ok)
            return ackFn(cb, fail(res.error ?? "start_failed"));
        ackFn(cb, ok({ roomId: room.roomId }));
    });
    sock.on("room:cancel", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? ""));
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        const res = room.cancelByHost(p.token);
        if (!res.ok)
            return ackFn(cb, fail(res.error ?? "cancel_failed"));
        emitMe();         for (const tok of room.entrants.keys()) {
            for (const [, s2] of io.sockets.sockets) {
                if (s2.data.profile && s2.data.profile.token === tok) {
                    s2.emit("me", store.me(s2.data.profile));
                }
            }
        }
        ackFn(cb, ok());
    });
    sock.on("room:info", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? "").toLowerCase().trim());
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        sock.join(`room:${room.roomId}`);
        sock.data.roomId = room.roomId;
        sock.emit("room:state", room.publicView(p.token));
        ackFn(cb, ok({ roomId: room.roomId }));
    });

    sock.on("room:public", (data, cb) => {
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? "").toLowerCase().trim());
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        const token = sock.data.profile ? sock.data.profile.token : null;
        sock.join(`room:${room.roomId}`);
        sock.emit("room:state", room.publicView(token));
        ackFn(cb, ok({ roomId: room.roomId }));
    });
    sock.on("room:myRooms", (_d, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        rooms.prune();
        const list = rooms.listFor(p.token).map((r) => r.publicView(p.token));
        sock.emit("room:list", list);
        ackFn(cb, ok());
    });
    sock.on("room:openTable", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? ""));
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        const e = room.entrants.get(p.token);
        let code = null;
        if (room.status === "completed") {
            code = room.showcaseCode();
        }
        else {
            code = e && e.status === "active" ? e.tableCode : null;
        }
        if (!code)
            return ackFn(cb, fail("no_table"));
        if (!registry.get(code))
            return ackFn(cb, fail("no_table"));
        sock.join(`table:${code}`);
        sock.data.tableCode = code;
        registry.broadcastTableState(code);
        sock.emit("log", { events: registry.get(code)?.table.lastEvents(60) ?? [] });
        sock.emit("chat:history", { messages: registry.chatHistory(code) });
        ackFn(cb, ok({ tableCode: code }));
    });
    sock.on("room:rebuy", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? ""));
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        const res = room.rebuy(p.token);
        if (!res.ok)
            return ackFn(cb, fail(res.error ?? "rebuy_failed"));
        emitMe();
        ackFn(cb, ok());
    });
    sock.on("room:addBots", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? ""));
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        if (room.hostId !== p.token)
            return ackFn(cb, fail("not_host"));
        const difficulty = d.difficulty === "hard" ? "hard" : d.difficulty === "easy" ? "easy" : "normal";
        const res = room.addBots(Number(d.count ?? 1), difficulty);
        if (!res.ok)
            return ackFn(cb, fail(res.error ?? "add_failed"));
        ackFn(cb, ok({ added: res.added ?? 0 }));
    });
    sock.on("room:removeBot", (data, cb) => {
        const p = requireAuth();
        if (!p)
            return;
        const d = (data ?? {});
        const room = rooms.get(String(d.roomId ?? ""));
        if (!room)
            return ackFn(cb, fail("room_not_found"));
        const res = room.removeBot(p.token, String(d.playerId ?? ""));
        if (!res.ok)
            return ackFn(cb, fail(res.error ?? "not_allowed"));
        ackFn(cb, ok());
    });
    sock.on("ping", (d, cb) => {
        ackFn(cb, { ok: true, t: d?.t ?? 0 });
    });
    sock.on("disconnect", () => {
        const p = sock.data.profile;
        const code = currentTableCode(sock);
        if (p && code) {
            const entry = registry.get(code);
            if (entry) {
                entry.table.setConnected(p.token, false);
                registry.broadcastTableState(code);
            }
        }
    });
});
function findSocketByToken(token) {
    for (const [, s] of io.sockets.sockets) {
        if (s.data.profile && s.data.profile.token === token)
            return s;
    }
    return null;
}
httpServer.listen(PORT, () => {
    console.log(`[poker-kings] realtime service ready on port ${PORT}`);
});

const REST_PORT = Number(process.env.POKER_REST_PORT ?? 44448);
const restServer = createServer((req, res) => {
    try {
        const url = (req.url ?? "").split("?")[0];
        const match = /^\/room\/([0-9a-fA-F]{40})$/.exec(url);
        const methodOk = req.method === "GET" || req.method === "HEAD";
        if (match && !methodOk) {
            res.writeHead(405, {
                "Content-Type": "application/json; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
                Allow: "GET",
            });
            res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
            return;
        }
        res.writeHead(match ? 200 : 404, {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
        });
        if (!match) {
            res.end(JSON.stringify({ ok: false, error: "not_found" }));
            return;
        }
        const room = rooms.get(match[1].toLowerCase());
        if (!room) {
            res.end(JSON.stringify({ ok: false, error: "room_not_found" }));
            return;
        }
        res.end(JSON.stringify({ ok: true, room: room.publicView(null) }));
    }
    catch (e) {
        console.error("[rest] room endpoint failed", e);
        try {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "internal" }));
        }
        catch {
            // socket already destroyed — nothing else to do
        }
    }
});
restServer.listen(REST_PORT, () => {
    console.log(`[poker-kings] public room REST ready on port ${REST_PORT}`);
});
process.on("SIGTERM", () => {
    registry.dispose();
    rooms.dispose();
    store.dispose();
    restServer.close();
    httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
    registry.dispose();
    rooms.dispose();
    store.dispose();
    restServer.close();
    httpServer.close(() => process.exit(0));
});
