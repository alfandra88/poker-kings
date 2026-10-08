import { createHash, randomBytes } from "node:crypto";
import { ShowdownTable } from "../../../lib/poker-engine/showdown.js";
import { ACHIEVEMENTS } from "./state.js";
import { filterMessage } from "./chat.js";
import { BotHost } from "./bots.js";
const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode() {
    let c = "";
    for (let i = 0; i < 6; i++)
        c += A[Math.floor(Math.random() * A.length)];
    return c;
}
function rid() {
    return Math.random().toString(36).slice(2, 11);
}
export class TableRegistry {
    io;
    store;
    tables = new Map();
    bots;
    dirtyTables = new Set();
    stateTimer = null;
    constructor(io, store) {
        this.io = io;
        this.store = store;
        this.bots = new BotHost((code) => this.tables.get(code), (code, text) => this.systemChat(code, text));
        this.stateTimer = setInterval(() => this.flushDirty(), 60);
        if (this.stateTimer.unref)
            this.stateTimer.unref();
    }
    dispose() {
        if (this.stateTimer)
            clearInterval(this.stateTimer);
        for (const code of this.tables.keys())
            this.bots.disposeTable(code);
    }
    createTable(profile, patch, botCount = 0, fixedCode = null) {
        const code = fixedCode && /^[A-Z0-9]{4,10}$/.test(fixedCode) ? fixedCode : genCode();
        const cfg = sanitizeConfig(patch, profile);
        const deps = this.makeDeps(code);
        const table = new ShowdownTable(code, cfg, deps, sit(profile));
        const extras = {
            createdAt: Date.now(),
            chat: [],
            muted: new Map(),
            banned: new Set(),
            pending: new Map(),
            joinReq: new Map(),
            hostId: profile.token,
            eventLog: [],
        };
        this.tables.set(code, { table, extras });
        this.store.counter(profile, "gamesHosted", 1);
        this.store.checkAchievements(profile);
        if (botCount > 0) {
            this.bots.addBots(code, Math.min(botCount, cfg.maxSeats - 1), cfg.botDifficulty ?? "normal");
        }
        this.markDirty(code);
        return { table, extras };
    }
    get(code) {
        return this.tables.get(code);
    }

    registerExternal(table, hostId) {
        const extras = {
            createdAt: Date.now(),
            chat: [],
            muted: new Map(),
            banned: new Set(),
            pending: new Map(),
            joinReq: new Map(),
            hostId,
            eventLog: [],
        };
        this.tables.set(table.code, { table, extras });
        this.markDirty(table.code);
    }
    unregister(code) {
        this.bots.disposeTable(code);
        this.tables.delete(code);
    }
    closeTable(code) {
        const entry = this.tables.get(code);
        if (!entry)
            return;
        entry.table.close();
        entry.table.abortHand();
        this.io.to(`table:${code}`).emit("toast", { kind: "info", i18n: { key: "toast.table_closed" } });
        for (const [, s] of this.io.sockets.sockets) {
            if (s.rooms.has(`table:${code}`))
                s.leave(`table:${code}`);
        }
        this.bots.disposeTable(code);
        this.tables.delete(code);
    }
    listTables() {
        return [...this.tables.values()].map(({ table }) => {
            const seated = table.seatedPlayers().length;
            return {
                code: table.code,
                name: table.cfg.name,
                variant: table.cfg.variant,
                seats: table.seats.length,
                seated,
                mode: table.cfg.mode,
                playing: table.handActive,
            };
        });
    }
    makeDeps(code) {
        return {
            timers: {
                schedule: (fn, ms) => setTimeout(fn, ms),
                cancel: (h) => clearTimeout(h),
                now: () => Date.now(),
            },
            random: () => randomBytes(4).readUInt32BE(0) / 4294967296,
            sha256: (hex) => `sha256:${createHash("sha256").update(hex).digest("hex")}`,
            broadcast: (ev) => {
                const entry = this.tables.get(code);
                if (!entry)
                    return;
                entry.extras.eventLog.push(ev);
                if (entry.extras.eventLog.length > 800)
                    entry.extras.eventLog.splice(0, 200);
                this.io.to(`table:${code}`).emit("event", ev);
                this.recordStats(code, ev);
                this.bots.notifyEvent(code, ev);
            },
            onStateDirty: () => this.markDirty(code),
            onPlayersLeft: () => {
                this.pushMeToRoom(code);
                this.markDirty(code);
            },
            onPayout: (info) => {
                const entry = this.tables.get(code);
                if (!entry)
                    return;
                if (info.nets) {
                    for (const n of info.nets) {
                        if (isBotId(n.playerId) || this.bots.isBot(code, n.playerId))
                            continue;
                        const prof = this.store.getOrCreate(n.playerId);
                        this.store.recordHandResult(prof, { won: n.won });
                    }
                }
            },
            onHandEnd: () => {
                const entry = this.tables.get(code);
                if (!entry)
                    return;
                for (const p of entry.table.seatedPlayers()) {
                    if (isBotId(p.playerId) || this.bots.isBot(code, p.playerId))
                        continue;
                    const prof = this.store.getOrCreate(p.playerId);
                    this.store.addXp(prof, 10);
                }
            },
            // Tournament elimination (3 strikes): the room layer removes the
            // player, assigns the final rank and rebalances tables.
            onStrike: (info) => {
                const entry = this.tables.get(code);
                if (!entry)
                    return;
                entry.extras.onStrike?.(info);
            },
        };
    }

    recordStats(code, ev) {
        const entry = this.tables.get(code);
        if (!entry)
            return;
        const humanAt = (seatId) => {
            const seat = entry.table.seats[seatId ?? -1];
            const pid = seat?.playerId;
            if (!pid || pid.startsWith("leaving:") || isBotId(pid) || this.bots.isBot(code, pid))
                return null;
            return this.store.getOrCreate(pid);
        };
        if (ev.t === "reveal") {
            const prof = humanAt(ev.seat);
            if (prof)
                prof.showdowns += 1, this.store.markDirty(prof);
        }
        if (ev.t === "showdown" && Array.isArray(ev.winners)) {
            for (const w of ev.winners) {
                const prof = humanAt(w.seat);
                if (!prof)
                    continue;
                this.store.counter(prof, "hand_win", 1);
                const key = w.label?.key;
                if (key === "flush" || key === "full_house" || key === "quads" || key === "straight_flush") {
                    this.store.counter(prof, `hand_${key}`, 1);
                }
                this.store.addXp(prof, 50);
                this.store.checkAchievements(prof);
            }
        }
    }
    markDirty(code) {
        this.dirtyTables.add(code);
    }
    flushDirty() {
        if (this.dirtyTables.size === 0)
            return;
        const codes = [...this.dirtyTables];
        this.dirtyTables.clear();
        for (const code of codes)
            this.broadcastTableState(code);
    }
    broadcastTableState(code) {
        const entry = this.tables.get(code);
        if (!entry)
            return;
        const room = this.io.sockets.adapter.rooms.get(`table:${code}`);
        if (!room)
            return;
        for (const sid of room) {
            const sock = this.io.sockets.sockets.get(sid);
            if (!sock?.data.profile)
                continue;
            const profile = sock.data.profile;
            const seated = !!entry.table.seatOf(profile.token);
            const snap = entry.table.snapshotFor({ playerId: profile.token, isSpectator: !seated });
            snap.spectators = Math.max(0, room.size - seatedCount(entry));
            sock.emit("state", snap);
        }
    }
    pushMeToRoom(code) {
        const room = this.io.sockets.adapter.rooms.get(`table:${code}`);
        if (!room)
            return;
        for (const sid of room) {
            const sock = this.io.sockets.sockets.get(sid);
            if (sock?.data.profile)
                sock.emit("me", this.store.me(sock.data.profile));
        }
    }
    pushMe(sock) {
        if (sock.data.profile)
            sock.emit("me", this.store.me(sock.data.profile));
    }
    chatMessage(code, profile, text, emote) {
        const entry = this.tables.get(code);
        if (!entry)
            return { error: "no_table" };
        const until = entry.extras.muted.get(profile.token) ?? 0;
        if (until > Date.now())
            return { error: "muted" };
        const res = filterMessage(text);
        if (res.blocked)
            return { error: "blocked" };
        const msg = {
            id: rid(),
            from: profile.nickname,
            avatar: profile.avatar,
            text: res.text,
            kind: emote ? "emote" : "user",
            ts: Date.now(),
            masked: res.masked,
        };
        entry.extras.chat.push(msg);
        if (entry.extras.chat.length > 200)
            entry.extras.chat.splice(0, 50);
        this.store.counter(profile, "chatMessages", 1);
        this.store.checkAchievements(profile);
        this.io.to(`table:${code}`).emit("chat:message", msg);
        return msg;
    }
    chatHistory(code) {
        return this.tables.get(code)?.extras.chat.slice(-40) ?? [];
    }
    systemChat(code, text) {
        const entry = this.tables.get(code);
        if (!entry)
            return;
        const msg = { id: rid(), from: null, text, kind: "system", ts: Date.now() };
        entry.extras.chat.push(msg);
        this.io.to(`table:${code}`).emit("chat:message", msg);
    }
    addBots(code, count, difficulty) {
        const seated = this.bots.addBots(code, Math.max(1, Math.min(9, Math.round(count))), difficulty);
        if (seated.length > 0)
            this.markDirty(code);
        return seated;
    }
    removeBot(code, botId) {
        const ok = this.bots.removeBot(code, botId);
        if (ok)
            this.markDirty(code);
        return ok;
    }
    isBotAt(code, playerId) {
        return this.bots.isBot(code, playerId);
    }

    yieldableBotSeat(code) {
        return this.bots.yieldableBotSeatId(code);
    }

    removeBotAtSeat(code, seatId) {
        const entry = this.tables.get(code);
        if (!entry)
            return null;
        const seat = entry.table.seats[seatId];
        const pid = seat?.playerId;
        if (!pid || !this.bots.isBot(code, pid))
            return null;
        this.bots.removeBot(code, pid);
        this.markDirty(code);
        return pid;
    }
    isHost(code, token) {
        return this.tables.get(code)?.extras.hostId === token;
    }
    /**
     * PRIVACY — resolve a client-supplied target id (host kick/mute/ban/transfer)
     * to the server-side player id. Snapshots expose only opaque seatUid values
     * for other humans, so handlers MUST translate them back here; raw ids
     * (self / bot ids / legacy tests) are still accepted. null → unknown target.
     */
    resolveSeatId(code, id) {
        if (typeof id !== "string" || id.length === 0)
            return null;
        const entry = this.tables.get(code);
        if (!entry)
            return null;
        for (const s of entry.table.seats) {
            if (s && s.seatUid === id) {
                const pid = s.playerId;
                if (!pid)
                    return null;
                return pid.startsWith("leaving:") ? pid.slice(8) : pid;
            }
        }
        return entry.table.seatOf(id) ? id : null;
    }
    kick(code, byToken, targetId) {
        if (!this.isHost(code, byToken))
            return false;
        const entry = this.tables.get(code);
        if (!entry || targetId === byToken)
            return false;
        if (this.bots.isBot(code, targetId)) {
            this.bots.removeBot(code, targetId);
            this.markDirty(code);
            return true;
        }
        entry.table.removePlayer(targetId);
        const prof2 = this.store.getOrCreate(targetId);
        this.io.to(`table:${code}`).emit("toast", {
            kind: "warn",
            i18n: { key: "toast.kicked", params: { name: prof2.nickname } },
        });
        for (const [, s] of this.io.sockets.sockets) {
            if (s.data.profile && s.data.profile.token === targetId) {
                s.emit("toast", { kind: "warn", i18n: { key: "toast.you_kicked" } });
                s.leave(`table:${code}`);
                s.emit("state", null);
            }
        }
        this.markDirty(code);
        return true;
    }
    mute(code, byToken, targetId, minutes) {
        if (!this.isHost(code, byToken))
            return false;
        const entry = this.tables.get(code);
        if (!entry)
            return false;
        entry.extras.muted.set(targetId, Date.now() + minutes * 60000);
        return true;
    }
    transferHost(code, byToken, targetId) {
        const entry = this.tables.get(code);
        if (!entry || !this.isHost(code, byToken))
            return false;
        entry.extras.hostId = targetId;
        this.markDirty(code);
        return true;
    }
    banCheck(code, token) {
        return this.tables.get(code)?.extras.banned.has(token) ?? false;
    }
    ban(code, byToken, targetId, minutes) {
        if (!this.isHost(code, byToken))
            return false;
        const entry = this.tables.get(code);
        if (!entry)
            return false;
        entry.extras.banned.add(targetId);
        this.kick(code, byToken, targetId);
        if (minutes > 0) {
            const timer = setTimeout(() => {
                const cur = this.tables.get(code);
                if (cur)
                    cur.extras.banned.delete(targetId);
            }, minutes * 60000);
            if (typeof timer === "object" && timer && "unref" in timer) {
                timer.unref();
            }
        }
        return true;
    }
}
function isBotId(pid) {
    return typeof pid === "string" && pid.startsWith("bot:");
}
function sit(profile) {
    return { playerId: profile.token, nickname: profile.nickname, avatar: profile.avatar };
}
function seatedCount(entry) {
    return entry.table.seatedPlayers().length;
}
export function sanitizeConfig(patch, profile) {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v || 0)));
    const cfg = {
        name: (patch.name || `${profile.nickname}'s Table`).slice(0, 40),
        variant: patch.variant === "plo4" ? "plo4" : "nlhe",
        mode: patch.mode === "tournament" ? "tournament" : "cash",
        maxSeats: clamp(patch.maxSeats ?? 9, 2, 10),
        actionTimerSec: clamp(patch.actionTimerSec ?? 15, 5, 120),
        timeBankSec: clamp(patch.timeBankSec ?? 0, 0, 300),
        approveJoin: !!patch.approveJoin,
        // PRIVACY (hard rule): hole cards are private — spectators must NEVER see
        // them. Any client-supplied value is ignored; the only reveal paths are
        // self and showdown `reveal` events (game rules).
        spectatorCards: false,
        botDifficulty: patch.botDifficulty === "hard" ? "hard" : patch.botDifficulty === "easy" ? "easy" : "normal",
        botsYieldSeats: patch.botsYieldSeats !== false,
        noPass: false,
    };
    const pw = typeof patch.password === "string" ? patch.password.trim().slice(0, 12) : "";
    if (pw)
        cfg.password = pw;
    return cfg;
}
export { ACHIEVEMENTS };