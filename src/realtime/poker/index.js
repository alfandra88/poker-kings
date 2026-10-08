import { Server } from "socket.io";
import { StateStore } from "./src/state.js";
import { TableRegistry, sanitizeConfig } from "./src/registry.js";
import { RateLimiter, SpamClamp } from "./src/chat.js";
import { RoomRunner } from "./src/room.js";
/**
 * Realtime poker service, attached to the platform's own HTTP server.
 *
 * Auth (Homeroom platform): the HTTP middleware in server.js already verified
 * the RS256 iframe token; sockets repeat the same verification against the
 * `x-usernode-token` header or handshake auth token. Signed-out visitors get
 * an ES256 guest token (read-only): they may watch tables and rooms but every
 * write answers `account_required`.
 */
export { StateStore, TableRegistry, RoomRunner };
export function createRealtime(httpServer, deps = {}) {
    const io = new Server(httpServer, {
        cors: { origin: false, methods: ["GET", "POST"] },
        pingTimeout: 60000,
        pingInterval: 25000,
    });
    const store = deps.store ?? new StateStore(null);
    const registry = new TableRegistry(io, store);
    const verifyUser = deps.verifyUser ?? null;
    const verifyGuest = deps.verifyGuest ?? null;
    const dataDir = deps.dataDir ?? "./.data/";
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
    }, store, dataDir);
    // ---- platform auth: RS256 user tokens, ES256 guest tokens ----
    io.use((sock, next) => {
        sock.data.profile = null;
        const hs = sock.handshake;
        const token = hs.auth?.token || hs.headers["x-usernode-token"] || null;
        if (typeof token === "string" && verifyUser) {
            const claims = verifyUser(token);
            if (claims) {
                const profile = store.getOrCreate(claims.id, {
                    nickname: claims.username,
                    language: claims.locale,
                });
                profile.token = claims.id;
                sock.data.profile = profile;
                sock.join(`user:${profile.token}`);
                return next();
            }
        }
        if (typeof token === "string" && verifyGuest) {
            const g = verifyGuest(token);
            if (g) {
                sock.data.profile = {
                    token: `guest:${sock.id}`,
                    nickname: "Guest",
                    avatar: "👁️",
                    guest: true,
                };
                return next();
            }
        }
        // No valid token: an anonymous spectator. Read-only, same as a guest.
        sock.data.profile = {
            token: `anon:${sock.id}`,
            nickname: "Guest",
            avatar: "👁️",
            guest: true,
        };
        next();
    });
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
        const profile = sock.data.profile;
        // The client's session starts from this push: guests get { guest: true }.
        sock.emit("me", profile.guest ? { guest: true } : store.me(profile));
        const me = () => store.me(profile);
        const emitMe = () => sock.emit("me", me());
        /** Guests (and anonymous sockets) may only read. Every write lands here. */
        const requireUser = (cb) => {
            if (profile.guest) {
                sock.emit("toast", { kind: "info", i18n: { key: "error.account_required" } });
                ackFn(cb, fail("account_required"));
                return null;
            }
            return profile;
        };
        sock.on("profile:get", (_d, cb) => {
            if (profile.guest)
                return ackFn(cb, fail("account_required"));
            sock.emit("profile", { me: store.me(profile), stats: store.statsView(profile) });
            ackFn(cb, ok());
        });
        sock.on("leaderboard:get", (_d, cb) => {
            sock.emit("leaderboard", { overall: store.leaderboard(), season: store.seasonLeaderboard() });
            ackFn(cb, ok());
        });
        sock.on("table:create", (data, cb) => {
            const p = requireUser(cb);
            if (!p)
                return;
            const d = (data ?? {});
            const raw = d.config ?? {};
            const botCount = Math.max(0, Math.min(9, Math.round(Number(raw.botCount ?? 0))));
            const { table } = registry.createTable(p, sanitizeConfig(raw, p), botCount);
            registry.systemChat(table.code, `table_created|${p.nickname}`);
            sock.join(`table:${table.code}`);
            sock.data.tableCode = table.code;
            registry.broadcastTableState(table.code);
            ackFn(cb, ok({ code: table.code, botsSeated: botCount > 0 ? registry.bots.botCount(table.code) : 0 }));
        });
        sock.on("table:join", (data, cb) => {
            const d = (data ?? {});
            const entry = registry.get((d.code || "").toUpperCase().trim());
            if (!entry)
                return ackFn(cb, fail("table_not_found"));
            // Guests watch only; a seat requires an account.
            if (profile.guest) {
                sock.join(`table:${entry.table.code}`);
                sock.data.tableCode = entry.table.code;
                sock.emit("chat:history", { messages: registry.chatHistory(entry.table.code) });
                registry.broadcastTableState(entry.table.code);
                sock.emit("log", { events: entry.table.lastEvents(60) });
                return ackFn(cb, ok({ code: entry.table.code, spectating: true }));
            }
            if (registry.banCheck(entry.table.code, profile.token))
                return ackFn(cb, fail("banned"));
            if (entry.extras.hostId !== profile.token && entry.table.cfg.password && entry.table.cfg.password !== d.password) {
                return ackFn(cb, fail("wrong_password"));
            }
            for (const [, s] of io.sockets.sockets) {
                if (s.id !== sock.id && s.data.profile && s.data.profile.token === profile.token && s.rooms.has(`table:${entry.table.code}`)) {
                    s.emit("superseded", {});
                    s.leave(`table:${entry.table.code}`);
                }
            }
            sock.join(`table:${entry.table.code}`);
            sock.data.tableCode = entry.table.code;
            entry.table.setConnected(profile.token, true);
            sock.emit("chat:history", { messages: registry.chatHistory(entry.table.code) });
            registry.broadcastTableState(entry.table.code);
            sock.emit("log", { events: entry.table.lastEvents(60) });
            ackFn(cb, ok({ code: entry.table.code }));
        });
        sock.on("table:refresh", (_d, cb) => {
            const code = currentTableCode(sock);
            if (!code || !registry.get(code))
                return ackFn(cb, fail("no_table"));
            registry.broadcastTableState(code);
            ackFn(cb, ok());
        });
        sock.on("table:leave", (_d, cb) => {
            const code = currentTableCode(sock);
            if (code) {
                const entry = registry.get(code);
                if (entry && !profile.guest) {
                    entry.table.standUp(profile.token);
                    entry.table.setConnected(profile.token, false);
                    registry.broadcastTableState(code);
                }
                sock.leave(`table:${code}`);
            }
            if (!profile.guest)
                emitMe();
            ackFn(cb, ok());
        });
        sock.on("table:list", (_d, cb) => {
            sock.emit("table:list", registry.listTables());
            ackFn(cb, ok());
        });
        sock.on("table:exportLog", (_d, cb) => {
            const p = requireUser(cb);
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
        const doSit = (p, seatId) => {
            const code = currentTableCode(sock);
            const entry = code ? registry.get(code) : null;
            if (!entry)
                return { ok: false, error: "no_table" };
            if (entry.table.closed)
                return { ok: false, error: "table_not_found" };
            const seatedNow = entry.table.seatOf(p.token);
            if (seatedNow)
                return { ok: true, seatId: seatedNow.seatId };
            if (entry.extras.hostId !== p.token && entry.table.cfg.approveJoin && !entry.extras.pending.has(p.token)) {
                entry.extras.pending.set(p.token, { nickname: p.nickname, avatar: p.avatar });
                const hostSock = findSocketByToken(entry.extras.hostId);
                if (hostSock) {
                    // PRIVACY — the host sees a one-time ticket, never the requester's token
                    const reqId = `jr${Math.random().toString(36).slice(2, 10)}`;
                    entry.extras.joinReq.set(reqId, p.token);
                    hostSock.emit("join:request", { requestId: reqId, nickname: p.nickname });
                }
                return { ok: false, error: "wait_approval" };
            }
            const seatIdx = Math.floor(seatId);
            const occ = entry.table.seats[seatIdx];
            if (occ && occ.playerId && registry.isBotAt(entry.table.code, occ.playerId) && entry.table.cfg.botsYieldSeats !== false) {
                const botId = occ.playerId;
                if (!entry.table.handActive) {
                    registry.removeBot(entry.table.code, botId);
                }
                else {
                    return { ok: false, error: "bot_making_room" };
                }
            }
            const res = entry.table.sitDown(seatId, { playerId: p.token, nickname: p.nickname, avatar: p.avatar }, 0);
            if (!res.ok)
                return { ok: false, error: res.error ?? "sit_failed" };
            registry.broadcastTableState(entry.table.code);
            emitMe();
            registry.systemChat(entry.table.code, `sat_down|${p.nickname}`);
            return { ok: true, seatId };
        };
        sock.on("seat:sit", (data, cb) => {
            const p = requireUser(cb);
            if (!p)
                return;
            if (!lim(sock).action.allow())
                return ackFn(cb, fail("rate_limited"));
            const d = (data ?? {});
            const res = doSit(p, d.seatId);
            ackFn(cb, res.ok ? ok({ seatId: res.seatId }) : fail(res.error ?? "sit_failed"));
        });
        sock.on("seat:auto", (_data, cb) => {
            const p = requireUser(cb);
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
                return ackFn(cb, ok({ seatId: existing.seatId }));
            const nSeats = entry.table.seats.length;
            const pref = [];
            const mid = Math.floor(nSeats / 2);
            for (let off = 0; off < nSeats; off++) {
                const step = Math.ceil(off / 2) * (off % 2 === 1 ? 1 : -1);
                pref.push((mid + step + nSeats) % nSeats);
            }
            const freeSeat = pref.find((i) => !entry.table.seats[i]);
            if (freeSeat !== undefined) {
                const res = doSit(p, freeSeat);
                return ackFn(cb, res.ok ? ok({ seatId: res.seatId }) : fail(res.error ?? "sit_failed"));
            }
            const botSeat = registry.yieldableBotSeat(entry.table.code);
            if (botSeat !== null) {
                const res = doSit(p, botSeat);
                return ackFn(cb, res.ok ? ok({ seatId: res.seatId }) : fail(res.error ?? "sit_failed"));
            }
            ackFn(cb, fail("table_full"));
        });
        sock.on("seat:stand", (_d, cb) => {
            const p = requireUser(cb);
            if (!p)
                return;
            const code = currentTableCode(sock);
            const entry = code ? registry.get(code) : null;
            if (!entry)
                return ackFn(cb, fail("no_table"));
            const res = entry.table.standUp(p.token);
            registry.broadcastTableState(code);
            emitMe();
            ackFn(cb, ok());
        });
        sock.on("seat:sitout", (data, cb) => {
            const p = requireUser(cb);
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
        sock.on("action", (data, cb) => {
            const p = requireUser(cb);
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
        sock.on("chat", (data, cb) => {
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
            if (!p)
                return;
            const code = currentTableCode(sock);
            const entry = code ? registry.get(code) : null;
            if (!entry || !registry.isHost(code, p.token))
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
            if (!p)
                return;
            const d = (data ?? {});
            const res = rooms.create(d, p);
            if (!res.ok)
                return ackFn(cb, fail(res.error));
            sock.join(`room:${res.room.roomId}`);
            sock.data.roomId = res.room.roomId;
            sock.emit("room:state", res.room.publicView(p.token));
            emitMe();
            ackFn(cb, ok({ roomId: res.room.roomId }));
        });
        sock.on("room:join", (data, cb) => {
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const p = requireUser(cb);
            if (!p)
                return;
            const d = (data ?? {});
            const room = rooms.get(String(d.roomId ?? ""));
            if (!room)
                return ackFn(cb, fail("room_not_found"));
            const res = room.cancelByHost(p.token);
            if (!res.ok)
                return ackFn(cb, fail(res.error ?? "cancel_failed"));
            emitMe();
            for (const tok of room.entrants.keys()) {
                for (const [, s2] of io.sockets.sockets) {
                    if (s2.data.profile && s2.data.profile.token === tok) {
                        s2.emit("me", store.me(s2.data.profile));
                    }
                }
            }
            ackFn(cb, ok());
        });
        sock.on("room:info", (data, cb) => {
            const d = (data ?? {});
            const room = rooms.get(String(d.roomId ?? "").toLowerCase().trim());
            if (!room)
                return ackFn(cb, fail("room_not_found"));
            sock.join(`room:${room.roomId}`);
            sock.data.roomId = room.roomId;
            sock.emit("room:state", room.publicView(profile.guest ? null : profile.token));
            ackFn(cb, ok({ roomId: room.roomId }));
        });
        sock.on("room:public", (data, cb) => {
            const d = (data ?? {});
            const room = rooms.get(String(d.roomId ?? "").toLowerCase().trim());
            if (!room)
                return ackFn(cb, fail("room_not_found"));
            const token = profile.guest ? null : profile.token;
            sock.join(`room:${room.roomId}`);
            sock.emit("room:state", room.publicView(token));
            ackFn(cb, ok({ roomId: room.roomId }));
        });
        sock.on("room:myRooms", (_d, cb) => {
            const p = requireUser(cb);
            if (!p)
                return;
            rooms.prune();
            const list = rooms.listFor(p.token).map((r) => r.publicView(p.token));
            sock.emit("room:list", list);
            ackFn(cb, ok());
        });
        sock.on("room:openTable", (data, cb) => {
            const p = requireUser(cb);
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
        sock.on("room:addBots", (data, cb) => {
            const p = requireUser(cb);
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
            const p = requireUser(cb);
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
            const code = currentTableCode(sock);
            if (!profile.guest && code) {
                const entry = registry.get(code);
                if (entry) {
                    entry.table.setConnected(profile.token, false);
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
    return {
        io,
        store,
        registry,
        rooms,
        dispose() {
            registry.dispose();
            rooms.dispose();
        },
    };
}