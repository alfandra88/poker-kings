import { SquaresTable, sanitizeTableConfig, MAX_PLAYERS } from "./table.js";
import { BotHost } from "./bots.js";
import { ContestRunner, DEMO_CONTEST_ID, isContestId } from "./contests.js";
import { PlayerStore, seedStaging } from "./store.js";
import { filterMessage, RateLimiter, SpamClamp } from "./chat.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const IDLE_TABLE_MS = 5 * 60 * 1000;

function genCode(taken) {
    for (;;) {
        let c = "";
        for (let i = 0; i < 6; i++)
            c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
        if (!taken.has(c))
            return c;
    }
}
const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
function ack(cb, payload) {
    if (typeof cb === "function")
        cb(payload);
}
let seq = 1;
const rid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export const realTimers = {
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h),
    now: () => Date.now(),
};

// Wires Poker Squares tables, contests and chat onto a Socket.IO server.
// `authenticate(socket)` returns { user } for a signed-in person, { guest: true }
// for a visitor without an account, or null to refuse the connection.
export async function attachRealtime(io, { pool, isStaging = false, authenticate, timers = realTimers }) {
    const store = new PlayerStore(pool);
    await store.migrate();
    if (isStaging)
        await seedStaging(pool);
    const bots = new BotHost(timers);
    const entries = new Map();
    const dirty = new Set();
    let flushTimer = null;

    function markDirty(code) {
        dirty.add(code);
        if (!flushTimer)
            flushTimer = setTimeout(flushDirty, 60);
    }
    function flushDirty() {
        flushTimer = null;
        for (const code of dirty)
            broadcastState(code);
        dirty.clear();
    }
    function socketsIn(room) {
        const ids = io.sockets.adapter.rooms.get(room);
        return ids ? [...ids].map((id) => io.sockets.sockets.get(id)).filter(Boolean) : [];
    }
    function viewerId(s) {
        return s.data.user ? s.data.user.id : null;
    }
    function broadcastState(code) {
        const entry = entries.get(code);
        if (!entry)
            return;
        const sockets = socketsIn(`table:${code}`);
        entry.table.watchers = new Set(sockets.map((s) => viewerId(s) ?? s.id)).size;
        for (const s of sockets)
            s.emit("state", entry.table.snapshotFor(viewerId(s)));
    }
    function toUser(userId, event, payload) {
        io.to(`user:${userId}`).emit(event, payload);
    }
    function toast(userId, kind, key, params) {
        toUser(userId, "toast", { kind, i18n: { key, params } });
    }
    function systemChat(code, text) {
        const entry = entries.get(code);
        if (!entry)
            return;
        const msg = { id: rid(), kind: "system", text, ts: Date.now() };
        entry.chat.push(msg);
        if (entry.chat.length > 200)
            entry.chat.splice(0, 50);
        io.to(`table:${code}`).emit("chat:message", msg);
    }
    function logEvent(code, ev) {
        const entry = entries.get(code);
        if (!entry)
            return;
        const stamped = { ...ev, ts: Date.now() };
        // A placement shows where a player put a card; only they may see it
        // while the round is on.
        if (ev.t === "place") {
            if (!String(ev.id).startsWith("bot:"))
                toUser(ev.id, "event", { ...stamped, code });
            return;
        }
        entry.eventLog.push(stamped);
        if (entry.eventLog.length > 600)
            entry.eventLog.splice(0, 150);
        io.to(`table:${code}`).emit("event", stamped);
        if (ev.t === "deal")
            bots.onDeal(entry.table);
    }

    function roundDone(table, results) {
        const contest = table.contestId ? contests.get(table.contestId) : null;
        for (const r of results) {
            if (r.isBot)
                continue;
            const p = store.get(r.id);
            if (!p)
                continue;
            const { unlocked, levelUp } = store.recordRound(p, { points: r.points, bestLine: r.bestLine, tableCode: table.code, contestId: table.contestId });
            toUser(p.id, "me", store.me(p));
            for (const key of unlocked)
                toast(p.id, "success", "toast.achievement", { key: `ach.${key}` });
            if (levelUp)
                toast(p.id, "success", "toast.levelup", { level: levelUp });
        }
        if (contest)
            contests.tableRoundDone(contest, table, results);
    }

    function makeTable(code, cfg, hostId, contestId = null) {
        const table = new SquaresTable(code, cfg, hostId, {
            timers,
            onChange: () => markDirty(code),
            onEvent: (ev) => logEvent(code, ev),
            onRoundDone: (t, results) => roundDone(t, results),
        }, { contestId });
        const entry = {
            table,
            chat: [],
            muted: new Map(),
            banned: new Set(),
            approved: new Set(),
            joinReq: new Map(),
            eventLog: [],
            idleTimer: null,
        };
        entries.set(code, entry);
        systemChat(code, `table_created|${cfg.name}`);
        return entry;
    }
    const tableApi = {
        get: (code) => entries.get(code)?.table ?? null,
        createContestTable: (c, name) => {
            const code = genCode(entries);
            const cfg = sanitizeTableConfig({ name, timerSec: c.timerSec, maxPlayers: MAX_PLAYERS, botsYieldSeats: false });
            return makeTable(code, cfg, c.hostId, c.id).table;
        },
    };
    const contests = new ContestRunner({
        timers,
        tables: tableApi,
        store,
        bots,
        notify: (c) => {
            const view = (s) => contests.publicView(c, viewerId(s));
            for (const s of socketsIn(`room:${c.id}`))
                s.emit("room:state", view(s));
            for (const code of c.tables)
                for (const s of socketsIn(`table:${code}`))
                    s.emit("room:state", view(s));
        },
    });
    if (isStaging && !contests.get(DEMO_CONTEST_ID)) {
        contests.create(null, { name: "Staging demo contest", rounds: 3, startMode: "manual", botCount: 2 }, { id: DEMO_CONTEST_ID });
    }

    function closeTable(code, reason = "toast.table_closed") {
        const entry = entries.get(code);
        if (!entry)
            return;
        entry.table.close();
        bots.disposeTable(code);
        if (entry.idleTimer)
            timers.cancel(entry.idleTimer);
        for (const s of socketsIn(`table:${code}`)) {
            s.emit("toast", { kind: "info", i18n: { key: reason } });
            s.emit("state", null);
            s.leave(`table:${code}`);
        }
        entries.delete(code);
    }
    function checkIdle(code) {
        const entry = entries.get(code);
        if (!entry || entry.table.contestId)
            return;
        if (entry.idleTimer) {
            timers.cancel(entry.idleTimer);
            entry.idleTimer = null;
        }
        if (socketsIn(`table:${code}`).length > 0)
            return;
        entry.idleTimer = timers.schedule(() => {
            if (socketsIn(`table:${code}`).length === 0)
                closeTable(code);
        }, IDLE_TABLE_MS);
    }
    function currentTable(s) {
        for (const room of s.rooms)
            if (room.startsWith("table:"))
                return room.slice(6);
        return null;
    }
    function leaveTables(s) {
        for (const room of [...s.rooms]) {
            if (!room.startsWith("table:"))
                continue;
            const code = room.slice(6);
            s.leave(room);
            const entry = entries.get(code);
            const uid = viewerId(s);
            if (entry && uid && !socketsIn(room).some((o) => viewerId(o) === uid))
                entry.table.setConnected(uid, false);
            markDirty(code);
            checkIdle(code);
        }
    }

    const limiters = new WeakMap();
    function lim(s) {
        let l = limiters.get(s);
        if (!l) {
            l = { action: new RateLimiter(20, 5000), chat: new RateLimiter(6, 10000), spam: new SpamClamp() };
            limiters.set(s, l);
        }
        return l;
    }

    io.use(async (socket, next) => {
        try {
            const who = authenticate(socket);
            if (!who)
                return next(new Error("not_authenticated"));
            if (who.user) {
                socket.data.user = { id: String(who.user.id), username: String(who.user.username ?? "player"), locale: who.user.locale ?? null };
                await store.ensure(socket.data.user);
            }
            else {
                socket.data.guest = true;
            }
            next();
        }
        catch (err) {
            console.error("[realtime] auth failed", err.message);
            next(new Error("not_authenticated"));
        }
    });

    io.on("connection", (s) => {
        const user = s.data.user ?? null;
        if (user) {
            s.join(`user:${user.id}`);
            s.emit("me", store.me(store.get(user.id)));
        }
        else {
            s.emit("me", null);
        }
        // Writes need an account; visitors without one may only look around.
        const on = (event, action, handler, { limited = true } = {}) => {
            s.on(event, async (data, cb) => {
                if (typeof data === "function") {
                    cb = data;
                    data = {};
                }
                data = data && typeof data === "object" ? data : {};
                try {
                    if (action) {
                        if (!user)
                            return ack(cb, fail("account_required", { action }));
                        if (limited && !lim(s).action.allow())
                            return ack(cb, fail("rate_limited"));
                    }
                    const res = await handler(data);
                    ack(cb, res ?? ok());
                }
                catch (err) {
                    console.error(`[realtime] ${event} failed`, err);
                    ack(cb, fail("generic"));
                }
            });
        };
        const hostEntry = () => {
            const code = currentTable(s);
            const entry = code ? entries.get(code) : null;
            if (!entry)
                return { error: fail("table_not_found") };
            if (entry.table.hostId !== user.id)
                return { error: fail("not_host") };
            return { entry, code };
        };

        on("ping", null, () => ok({ now: Date.now() }));
        on("profile:get", null, () => ok({ me: user ? store.me(store.get(user.id)) : null }));
        on("leaderboard:get", null, async () => ok({ data: await store.leaderboard() }));

        on("table:create", "create a table", (d) => {
            const cfg = sanitizeTableConfig(d.config ?? {}, { name: `${user.username}'s table` });
            const code = genCode(entries);
            const entry = makeTable(code, cfg, user.id);
            const unlocked = store.countHosted(store.get(user.id));
            for (const key of unlocked)
                toast(user.id, "success", "toast.achievement", { key: `ach.${key}` });
            const botCount = Math.max(0, Math.min(MAX_PLAYERS - 1, Number.parseInt(d.botCount, 10) || 0));
            const added = bots.addBots(entry.table, Math.min(botCount, cfg.maxPlayers - 1));
            if (added.length)
                systemChat(code, `bot_joined|${added.join(", ")}`);
            leaveTables(s);
            s.join(`table:${code}`);
            markDirty(code);
            return ok({ code });
        });
        on("table:join", null, (d) => {
            const code = String(d.code ?? "").toUpperCase().trim();
            const entry = entries.get(code);
            if (!entry)
                return fail("table_not_found");
            if (user && entry.banned.has(user.id))
                return fail("banned");
            const isHost = user && entry.table.hostId === user.id;
            const known = user && entry.table.players.has(user.id);
            if (entry.table.cfg.password && !isHost && !known && d.password !== entry.table.cfg.password)
                return fail("wrong_password");
            leaveTables(s);
            s.join(`table:${code}`);
            if (entry.idleTimer) {
                timers.cancel(entry.idleTimer);
                entry.idleTimer = null;
            }
            if (user && entry.table.players.has(user.id))
                entry.table.setConnected(user.id, true);
            s.emit("chat:history", { messages: entry.chat.slice(-100) });
            s.emit("log", { events: entry.eventLog.slice(-200) });
            s.emit("state", entry.table.snapshotFor(viewerId(s)));
            if (entry.table.contestId) {
                const c = contests.get(entry.table.contestId);
                if (c)
                    s.emit("room:state", contests.publicView(c, viewerId(s)));
            }
            markDirty(code);
            return ok({ code });
        });
        on("table:refresh", null, () => {
            const code = currentTable(s);
            const entry = code ? entries.get(code) : null;
            if (!entry)
                return fail("table_not_found");
            s.emit("state", entry.table.snapshotFor(viewerId(s)));
            return ok();
        });
        on("table:leave", null, () => {
            const code = currentTable(s);
            const entry = code ? entries.get(code) : null;
            if (entry && user && !entry.table.contestId && entry.table.removePlayer(user.id)) {
                if (entry.table.hostId === user.id) {
                    const next = entry.table.humans()[0];
                    if (next)
                        entry.table.hostId = next.id;
                }
            }
            leaveTables(s);
            return ok();
        });
        on("table:exportLog", null, () => {
            const code = currentTable(s);
            const entry = code ? entries.get(code) : null;
            if (!entry)
                return fail("table_not_found");
            return ok({ events: entry.eventLog });
        });

        const sit = () => {
            const code = currentTable(s);
            const entry = code ? entries.get(code) : null;
            if (!entry)
                return fail("no_table");
            const table = entry.table;
            if (table.contestId)
                return fail("contest_table");
            if (table.players.has(user.id))
                return fail("already_seated");
            if (entry.banned.has(user.id))
                return fail("banned");
            if (table.cfg.approveJoin && table.hostId !== user.id && !entry.approved.has(user.id)) {
                const requestId = rid();
                entry.joinReq.set(requestId, { userId: user.id, username: user.username });
                toUser(table.hostId, "join:request", { requestId, username: user.username });
                return fail("wait_approval");
            }
            if (table.isFull()) {
                const bot = table.cfg.botsYieldSeats ? table.bots().find((b) => !b.leaving) ?? table.bots()[0] : null;
                if (!bot)
                    return fail("table_full");
                if (table.playing) {
                    bot.leaving = true;
                    return fail("bot_making_room");
                }
                table.removePlayer(bot.id);
                systemChat(code, `bot_left|${bot.username}`);
            }
            const res = table.addPlayer({ id: user.id, username: user.username });
            if (!res.ok)
                return fail(res.error);
            systemChat(code, `sat_down|${user.username}`);
            return ok({ waiting: res.waiting });
        };
        on("seat:sit", "take a seat", sit);
        on("seat:auto", "take a seat", sit);
        on("seat:stand", "leave your seat", () => {
            const code = currentTable(s);
            const entry = code ? entries.get(code) : null;
            if (!entry || entry.table.contestId)
                return fail("table_not_found");
            entry.table.removePlayer(user.id);
            return ok();
        });
        on("place", "place a card", (d) => {
            const code = currentTable(s);
            const entry = code ? entries.get(code) : null;
            if (!entry)
                return fail("table_not_found");
            const res = entry.table.place(user.id, Number(d.cell));
            return res.ok ? ok() : fail(res.error);
        }, { limited: false }); // one placement per card is already the limit
        on("chat", "chat", (d) => {
            const code = currentTable(s);
            const entry = code ? entries.get(code) : null;
            if (!entry)
                return fail("table_not_found");
            if (!lim(s).chat.allow())
                return fail("rate_limited");
            const until = entry.muted.get(user.id);
            if (until && until > Date.now())
                return fail("muted");
            const raw = String(d.text ?? "");
            if (d.emote) {
                const msg = { id: rid(), kind: "emote", from: user.username, text: raw.slice(0, 8), ts: Date.now() };
                entry.chat.push(msg);
                io.to(`table:${code}`).emit("chat:message", msg);
                return ok();
            }
            const f = filterMessage(raw);
            if (f.blocked)
                return fail("blocked");
            if (lim(s).spam.check(f.text))
                return fail("rate_limited");
            const msg = { id: rid(), kind: "chat", from: user.username, text: f.text, masked: f.masked, ts: Date.now() };
            entry.chat.push(msg);
            if (entry.chat.length > 200)
                entry.chat.splice(0, 50);
            io.to(`table:${code}`).emit("chat:message", msg);
            return ok();
        });

        on("host:config", "change table settings", (d) => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            const t = h.entry.table;
            t.cfg = sanitizeTableConfig(d.patch ?? {}, t.cfg);
            if (t.cfg.maxPlayers < t.players.size)
                t.cfg.maxPlayers = Math.max(2, t.players.size);
            markDirty(h.code);
            return ok();
        });
        on("host:pause", "pause the table", (d) => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            if (h.entry.table.contestId)
                return fail("contest_table");
            h.entry.table.pause(!!d.on);
            io.to(`table:${h.code}`).emit("toast", { kind: "info", i18n: { key: d.on ? "toast.paused" : "toast.resumed" } });
            return ok();
        });
        on("host:startRound", "start the next round", () => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            const t = h.entry.table;
            if (t.contestId)
                return fail("contest_table");
            if (t.playing)
                return fail("already_started");
            if (t.status === "paused")
                t.pause(false);
            return t.startRound() ? ok() : fail("generic");
        });
        on("host:addBots", "add AI players", (d) => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            if (h.entry.table.contestId)
                return fail("contest_table");
            const added = bots.addBots(h.entry.table, Math.max(1, Math.min(7, Number(d.count) || 1)));
            if (added.length)
                systemChat(h.code, `bot_joined|${added.join(", ")}`);
            return added.length ? ok() : fail("table_full");
        });
        on("host:removeBot", "remove an AI player", (d) => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            const p = h.entry.table.players.get(String(d.playerId));
            if (!p || !p.isBot)
                return fail("generic");
            h.entry.table.removePlayer(p.id);
            systemChat(h.code, `bot_left|${p.username}`);
            return ok();
        });
        const removeHuman = (h, playerId, ban) => {
            const t = h.entry.table;
            const p = t.players.get(playerId);
            if (!p || p.isBot || playerId === user.id)
                return fail("generic");
            if (!t.contestId)
                t.removePlayer(playerId);
            if (ban)
                h.entry.banned.add(playerId);
            for (const o of socketsIn(`table:${h.code}`)) {
                if (viewerId(o) !== playerId)
                    continue;
                o.emit("toast", { kind: "warn", i18n: { key: "toast.you_kicked" } });
                o.emit("state", null);
                o.leave(`table:${h.code}`);
            }
            io.to(`table:${h.code}`).emit("toast", { kind: "info", i18n: { key: "toast.kicked", params: { name: p.username } } });
            markDirty(h.code);
            return ok();
        };
        on("host:kick", "remove a player", (d) => {
            const h = hostEntry();
            return h.error ?? removeHuman(h, String(d.playerId), false);
        });
        on("host:ban", "ban a player", (d) => {
            const h = hostEntry();
            return h.error ?? removeHuman(h, String(d.playerId), true);
        });
        on("host:mute", "mute a player", (d) => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            const minutes = Math.max(1, Math.min(60, Number(d.minutes) || 10));
            h.entry.muted.set(String(d.playerId), Date.now() + minutes * 60000);
            return ok();
        });
        on("host:transfer", "make someone host", (d) => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            const p = h.entry.table.players.get(String(d.playerId));
            if (!p || p.isBot)
                return fail("generic");
            h.entry.table.hostId = p.id;
            markDirty(h.code);
            return ok();
        });
        on("host:approve", "answer a join request", (d) => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            const req = h.entry.joinReq.get(String(d.requestId));
            if (!req)
                return fail("generic");
            h.entry.joinReq.delete(String(d.requestId));
            if (d.ok) {
                h.entry.approved.add(req.userId);
                toast(req.userId, "success", "toast.join_approved");
            }
            else {
                toast(req.userId, "warn", "toast.join_denied");
            }
            return ok();
        });
        on("host:close", "close the table", () => {
            const h = hostEntry();
            if (h.error)
                return h.error;
            if (h.entry.table.contestId)
                return fail("contest_table");
            closeTable(h.code);
            return ok();
        });

        const contestOf = (d) => {
            const id = String(d.roomId ?? "").toLowerCase();
            return isContestId(id) ? contests.get(id) : null;
        };
        const watchContest = (c) => {
            s.join(`room:${c.id}`);
            s.emit("room:state", contests.publicView(c, viewerId(s)));
        };
        on("room:create", "create a contest", (d) => {
            const c = contests.create(user, d);
            watchContest(c);
            return ok({ roomId: c.id });
        });
        on("room:join", "join a contest", (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            watchContest(c);
            return contests.join(c, user);
        });
        on("room:leave", "leave a contest", (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            return contests.leave(c, user.id);
        });
        on("room:start", "start a contest", (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            if (c.hostId !== user.id)
                return fail("not_host");
            return contests.start(c);
        });
        on("room:cancel", "cancel a contest", (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            if (c.hostId !== user.id)
                return fail("not_host");
            return contests.cancel(c);
        });
        on("room:addBots", "add AI players", (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            if (c.hostId !== user.id)
                return fail("not_host");
            if (c.status !== "waiting")
                return fail("already_started");
            const n = contests.addBots(c, Math.max(1, Math.min(7, Number(d.count) || 1)));
            contests.changed(c);
            return n ? ok() : fail("contest_full");
        });
        on("room:removeBot", "remove an AI player", (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            if (c.hostId !== user.id)
                return fail("not_host");
            return contests.removeBot(c, String(d.botId)) ? ok() : fail("generic");
        });
        on("room:info", null, (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            watchContest(c);
            return ok({ room: contests.publicView(c, viewerId(s)) });
        });
        on("room:public", null, (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            watchContest(c);
            return ok({ room: contests.publicView(c, viewerId(s)) });
        });
        on("room:myRooms", null, () => {
            const list = user ? contests.listFor(user.id) : [];
            s.emit("room:list", list);
            return ok({ rooms: list });
        });
        on("room:openTable", "open your contest table", (d) => {
            const c = contestOf(d);
            if (!c)
                return fail("room_not_found");
            const e = c.entrants.get(user.id);
            const code = e?.tableCode ?? c.tables[0] ?? null;
            if (!code)
                return fail("no_table");
            return ok({ tableCode: code });
        });

        // Rooms are still known while disconnecting, not after.
        s.on("disconnecting", () => {
            leaveTables(s);
        });
    });

    return {
        store,
        contests,
        publicContest: (id) => {
            const c = isContestId(id) ? contests.get(id) : null;
            return c ? contests.publicView(c, null) : null;
        },
        dispose() {
            if (flushTimer)
                clearTimeout(flushTimer);
            contests.dispose();
            for (const code of [...entries.keys()]) {
                const e = entries.get(code);
                e.table.close();
                if (e.idleTimer)
                    timers.cancel(e.idleTimer);
            }
            bots.dispose();
        },
        flush: () => store.flush(),
    };
}
