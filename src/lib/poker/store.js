"use client";

import { create } from "zustand";
import { io } from "socket.io-client";
import { translate, applyLangToDocument, detectLang, isLang } from "./i18n/index.js";
const TOKEN_KEY = "pokerkings.token";
const LANG_KEY = "pokerkings.lang";
const THEME_KEY = "pokerkings.theme";

export function isTheme(x) {
    return x === "dark" || x === "light";
}

export function applyThemeToDocument(theme) {
    if (typeof document === "undefined")
        return;
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta)
        meta.setAttribute("content", theme === "dark" ? "#07090d" : "#eef2f7");
}

export function loadThemeFromStorage() {
    if (typeof window === "undefined")
        return "dark";
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (isTheme(saved))
            return saved;
    }
    catch (err) {
        console.debug("[poker] localStorage.getItem(theme) unavailable:", err);
    }
    return "dark";
}
let socket = null;
let toastSeq = 1;
let pendingJoinCode = null;
let pendingRoomId = null;
let autoSitTimers = [];

export function isRoomIdShape(x) {
    return typeof x === "string" && /^[0-9a-fA-F]{40}$/.test(x);
}

function scheduleAutoSit(get, code) {
    autoSitTimers.forEach(clearTimeout);
    autoSitTimers = [];
    const fire = (delay, triesLeft) => {
        autoSitTimers.push(setTimeout(async () => {
            if (get().tableCode !== code || get().view !== "table")
                return;
            const snap = get().snap;
            if (snap?.seats.some((s) => s?.self))
                return;
            const res = await get().emit("seat:auto");
            if (res?.ok)
                return;
            const err = res?.error ?? "generic";
            if (err === "account_required") {
                get().toast("error", get().t("error.account_required"));
                return;
            }
            if ((err === "bot_making_room" || err === "seat_taken" || err === "table_full") && triesLeft > 0) {
                fire(2200 + (4 - triesLeft) * 1600, triesLeft - 1);
                return;
            }
            if (err !== "no_table")
                handleFail(get, res);
        }, delay));
    };
    fire(250, 3);
}
export function setPendingJoinCode(code) {
    pendingJoinCode = code;
}
export function setPendingRoomId(id) {
    pendingRoomId = id;
}
/**
 * The Homeroom shell injects the RS256 iframe token as ?token= on load. It is
 * kept in sessionStorage (per tab, cleared when the shell reloads the frame)
 * and forwarded on the socket handshake. Offline loads carry no token, which
 * is fine: the socket falls back to a read-only guest session.
 */
export function captureIframeToken() {
    if (typeof window === "undefined")
        return null;
    try {
        const url = new URL(window.location.href);
        const tok = url.searchParams.get("token");
        if (tok) {
            sessionStorage.setItem(TOKEN_KEY, tok);
            url.searchParams.delete("token");
            window.history.replaceState(null, "", url.pathname + url.search + url.hash);
            return tok;
        }
        return sessionStorage.getItem(TOKEN_KEY);
    }
    catch (err) {
        console.debug("[poker] token storage unavailable:", err);
        return null;
    }
}
export const usePoker = create((set, get) => ({
    connected: false,
    authed: false,
    guest: false,
    me: null,
    lang: "en",
    soundOn: true,
    theme: "dark",
    view: "home",
    tableCode: null,
    snap: null,
    chat: [],
    log: [],
    room: null,
    roomList: [],
    profile: null,
    leaderboard: null,
    toasts: [],
    drawerTab: "chat",
    drawerOpen: false,
    joinRequest: null,
    set: (partial) => set(partial),
    setLang: (l) => {
        if (!isLang(l))
            return;
        try {
            localStorage.setItem(LANG_KEY, l);
        }
        catch {
            // storage unavailable (private mode) — keep in-memory language only
        }
        applyLangToDocument(l);
        set({ lang: l });
    },
    setSound: (on) => set({ soundOn: on }),
    setTheme: (t) => {
        if (!isTheme(t))
            return;
        try {
            localStorage.setItem(THEME_KEY, t);
        }
        catch (err) {
            console.debug("[poker] localStorage.setItem(theme) unavailable:", err);
        }
        applyThemeToDocument(t);
        set({ theme: t });
    },
    t: (key, params) => translate(get().lang, key, params),
    toast: (kind, text) => {
        const id = toastSeq++;
        set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }));
        setTimeout(() => get().dismissToast(id), 4500);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
    emit: (event, data) => {
        return new Promise((resolve) => {
            if (!socket?.connected)
                return resolve(null);
            socket.emit(event, data ?? {}, (res) => resolve(res ?? null));
        });
    },
    connect: () => {
        if (socket)
            return;
        const token = captureIframeToken();
        socket = io("/", {
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: 20,
            reconnectionDelay: 1000,
            timeout: 10000,
            auth: token ? { token } : {},
        });
        const s = socket;
        s.on("connect", () => {
            set({ connected: true });
            if (pendingRoomId && isRoomIdShape(pendingRoomId)) {
                const rid = pendingRoomId.toLowerCase();
                pendingRoomId = null;
                void get().openRoom(rid);
            }
            if (pendingJoinCode) {
                const code = pendingJoinCode;
                pendingJoinCode = null;
                void get().joinTable(code);
            }
        });
        s.on("disconnect", () => set({ connected: false }));
        s.on("me", (me) => {
            if (!me || me.guest) {
                // Signed-out visitor: read-only guest session.
                set({ guest: true, authed: false, me: null });
                return;
            }
            const prev = get().me;
            set({ guest: false, authed: true, me });
            if (prev && me.level > prev.level) {
                get().toast("success", get().t("toast.levelup", { level: me.level }));
            }
        });
        s.on("state", (snap) => {
            if (!snap) {
                set({ snap: null, view: "home", tableCode: null });
                return;
            }
            set({ snap, view: "table", tableCode: snap.code });
        });
        s.on("event", (ev) => {
            set((st) => ({ log: [...st.log.slice(-250), ev] }));
            if (ev?.t === "showdown" && Array.isArray(ev.winners)) {
                const snap = get().snap;
                const mySeat = snap?.seats.find((x) => x?.self);
                if (mySeat && ev.winners.some((w) => w.seat === mySeat.seatId)) {
                    playSound("win", get().soundOn);
                }
            }
        });
        s.on("chat:history", ({ messages }) => set({ chat: messages }));
        s.on("chat:message", (msg) => set((st) => ({ chat: [...st.chat.slice(-200), msg] })));
        s.on("log", ({ events }) => set({ log: events }));
        s.on("leaderboard", (data) => set({ leaderboard: data }));
        s.on("toast", (toast) => {
            const kind = toast.kind ?? "info";
            const text = toast.i18n ? get().t(toast.i18n.key, toast.i18n.params) : toast.text ?? "";
            get().toast(kind, text);
        });
        s.on("join:request", (req) => set({ joinRequest: req }));
        s.on("superseded", () => {
            get().toast("warn", get().t("toast.superseded"));
            set({ snap: null, view: "home", tableCode: null });
        });
        s.on("room:state", (rp) => {
            if (!rp || typeof rp.roomId !== "string")
                return;
            set((st) => ({
                room: !st.room || st.room.roomId === rp.roomId ? rp : st.room,
                roomList: st.roomList.some((x) => x.roomId === rp.roomId)
                    ? st.roomList.map((x) => (x.roomId === rp.roomId ? rp : x))
                    : [rp, ...st.roomList].slice(0, 30),
            }));
        });
        s.on("room:list", (list) => {
            if (!Array.isArray(list))
                return;
            set({ roomList: list });
        });
        s.on("room:closed", ({ roomId, reason }) => {
            const cur = get().room;
            if (cur?.roomId === roomId)
                set({ room: null, view: "home" });
            get().toast("warn", get().t(reason === "cancelled" ? "toast.room_cancelled" : "error.generic"));
        });
    },
    ensureAuthed: async () => {
        get().connect();
        if (get().connected && (get().authed || get().guest))
            return;
        await new Promise((resolve) => {
            const check = () => (get().connected && (get().authed || get().guest) ? resolve() : setTimeout(check, 120));
            check();
        });
    },
    createTable: async (cfg) => {
        await get().ensureAuthed();
        const res = await get().emit("table:create", { config: cfg });
        if (res?.ok && res.code) {
            const code = res.code;
            set({ view: "table", tableCode: code, snap: null, chat: [], log: [] });
            try {
                window.history.replaceState(null, "", `/?t=${code}`);
            }
            catch (err) {
                console.debug("[poker] history.replaceState unavailable after createTable:", err);
            }
            scheduleAutoSit(get, code);
            return code;
        }
        handleFail(get, res);
        return null;
    },
    joinTable: async (code, password) => {
        const norm = code.toUpperCase().trim();
        await get().ensureAuthed();
        const res = await get().emit("table:join", { code: norm, password });
        if (res?.ok) {
            set({ view: "table", tableCode: norm, snap: null, chat: [], log: [], drawerOpen: false });
            try {
                window.history.replaceState(null, "", `/?t=${norm}`);
            }
            catch (err) {
                console.debug("[poker] history.replaceState unavailable after joinTable:", err);
            }
            // Guests watch from the rail; only accounts auto-take a seat.
            if (!get().guest)
                scheduleAutoSit(get, norm);
            for (const delay of [1200, 3000, 6000, 10000]) {
                setTimeout(() => {
                    if (get().view === "table" && get().tableCode === norm && !get().snap) {
                        void get().emit("table:refresh");
                    }
                }, delay);
            }
            setTimeout(() => {
                if (get().view === "table" && !get().snap) {
                    set({ view: "home", tableCode: null });
                    get().toast("error", get().t("error.table_not_found"));
                }
            }, 15000);
            return true;
        }
        handleFail(get, res);
        return false;
    },
    leaveTable: async () => {
        await get().emit("table:leave");
        set({ view: "home", snap: null, tableCode: null, chat: [], log: [], drawerOpen: false });
        try {
            window.history.replaceState(null, "", "/");
        }
        catch (err) {
            console.debug("[poker] history.replaceState unavailable after leaveTable:", err);
        }
    },

    openRoom: async (roomId) => {
        const norm = String(roomId ?? "").toLowerCase().trim();
        if (!isRoomIdShape(norm)) {
            get().toast("error", get().t("error.room_not_found"));
            return false;
        }
        await get().ensureAuthed();
        const res = await get().emit("room:join", { roomId: norm });
        if (res?.ok || res?.error === "already_registered") {
            set({ view: "room", tableCode: null, snap: null });
            return true;
        }
        const err = res?.error ?? "generic";
        if (err === "room_not_found") {
            get().toast("error", get().t("error.room_not_found"));
            return false;
        }
        if (err === "account_required") {
            handleFail(get, res);
            return false;
        }
        const pub = await get().emit("room:public", { roomId: norm });
        if (pub?.ok) {
            set({ view: "room", tableCode: null, snap: null });
            handleFail(get, res);
            return true;
        }
        handleFail(get, res);
        return false;
    },

    watchRoom: async (roomId) => {
        const norm = String(roomId ?? "").toLowerCase().trim();
        if (!isRoomIdShape(norm))
            return false;
        await get().ensureAuthed();
        const pub = await get().emit("room:public", { roomId: norm });
        if (pub?.ok)
            set({ view: "room" });
        return !!pub?.ok;
    },

    openRoomTable: async (roomId) => {
        const res = await get().emit("room:openTable", { roomId });
        if (res?.ok && typeof res.tableCode === "string") {
            set({ view: "home" });
            return get().joinTable(res.tableCode);
        }
        handleFail(get, res);
        return false;
    },

    quickPlay: async (opts) => {
        await get().ensureAuthed();
        if (get().guest) {
            get().toast("error", get().t("error.account_required"));
            return false;
        }
        const me = get().me;
        const bots = Math.max(1, Math.min(8, opts?.bots ?? 5));
        const difficulty = opts?.difficulty ?? "normal";
        const code = await get().createTable({
            name: `${me?.nickname ?? "Me"} vs AI`,
            variant: "nlhe",
            mode: "cash",
            maxSeats: 9,
            actionTimerSec: 15,
            timeBankSec: 0,
            spectatorCards: false, // PRIVACY: spectators never see hole cards
            botCount: bots,
            botDifficulty: difficulty,
        });
        return !!code;
    },
}));
function handleFail(get, res) {
    const err = res?.error ?? "generic";
    const map = {
        table_not_found: "error.table_not_found",
        account_required: "error.account_required",
        pass_not_allowed: "error.pass_not_allowed",
        wait_approval: "error.wait_approval",
        wrong_password: "error.wrong_password",
        banned: "error.banned",
        not_your_turn: "error.not_your_turn",
        rate_limited: "error.rate_limited",
        muted: "error.muted",
        blocked: "error.blocked",
        already_seated: "error.already_seated",
        seat_taken: "error.seat_taken",
        table_full: "error.seat_taken",
        bot_making_room: "toast.bot_making_room",
        room_not_found: "error.room_not_found",
        tournament_running: "error.tournament_running",
        tournament_full: "error.tournament_full",
        already_registered: "error.already_registered",
        room_closed: "error.room_closed",
        cannot_leave: "error.cannot_leave",
        need_two_players: "error.need_two_players",
        not_host: "error.not_host",
        already_started: "error.already_started",
    };
    get().toast("error", get().t(map[err] ?? "error.generic"));
}
let audioCtx = null;
export function playSound(kind, on) {
    if (!on)
        return;
    try {
        if (typeof window === "undefined")
            return;
        audioCtx = audioCtx ?? new (window.AudioContext ?? window.webkitAudioContext)();
        const ctx = audioCtx;
        if (ctx.state === "suspended")
            return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        if (kind === "turn") {
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        }
        else if (kind === "win") {
            osc.frequency.setValueAtTime(660, now);
            osc.frequency.setValueAtTime(990, now + 0.12);
            gain.gain.setValueAtTime(0.09, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        }
        else if (kind === "tick") {
            osc.type = "square";
            osc.frequency.value = 1200;
            gain.gain.setValueAtTime(0.035, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
            osc.start(now);
            osc.stop(now + 0.09);
            return;
        }
        else {
            osc.frequency.value = 440;
            gain.gain.setValueAtTime(0.03, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        }
        osc.start(now);
        osc.stop(now + 0.55);
    }
    catch {
        // audio unavailable — fine
    }
}
export function loadLangFromStorage() {
    if (typeof window === "undefined")
        return null;
    try {
        const saved = localStorage.getItem(LANG_KEY);
        if (isLang(saved))
            return saved;
    }
    catch {
        // storage unavailable — continue to detection
    }
    return detectLang();
}
// e2e/debug hook — lets tests read app state without polluting components.
// PRIVACY: gated to non-production builds so a prod DevTools console cannot
// reach the whole store (including my token) from window.
if (typeof window !== "undefined" &&
    process.env.NODE_ENV !== "production") {
    window.__poker = usePoker;
}