"use client";

import { create } from "zustand";
import { io } from "socket.io-client";
import { translate, applyLangToDocument, detectLang, isLang } from "./i18n/index.js";
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

// The player's own choice wins; until they make one, follow Homeroom's theme.
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
    return platformTheme() ?? "dark";
}

export function hasSavedTheme() {
    try {
        return isTheme(localStorage.getItem(THEME_KEY));
    }
    catch {
        return false;
    }
}

export function platformTheme() {
    if (typeof window === "undefined")
        return null;
    const th = window.usernode && window.usernode.theme;
    return isTheme(th) ? th : null;
}
let socket = null;
let toastSeq = 1;
let pendingJoinCode = null;
let pendingRoomId = null;
let autoSitTimers = [];

// The iframe's sign-in token, read once: later URL changes drop it.
const PAGE_TOKEN = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") : null;

export function isRoomIdShape(x) {
    return typeof x === "string" && /^[0-9a-fA-F]{40}$/.test(x);
}

// Rewrites the table code in the address bar, keeping the platform's own
// parameters (token, theme) so a reload still signs in.
export function replaceTableParam(code) {
    if (typeof window === "undefined")
        return;
    try {
        const url = new URL(window.location.href);
        if (code)
            url.searchParams.set("t", code);
        else
            url.searchParams.delete("t");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    catch (err) {
        console.debug("[poker] history.replaceState unavailable:", err);
    }
}

function scheduleAutoSit(get, code) {
    autoSitTimers.forEach(clearTimeout);
    autoSitTimers = [];
    const fire = (delay, triesLeft) => {
        autoSitTimers.push(setTimeout(async () => {
            if (get().tableCode !== code || get().view !== "table")
                return;
            const snap = get().snap;
            if (!get().me || snap?.me?.seated || snap?.contestId)
                return;
            const res = await get().emit("seat:auto");
            if (res?.ok)
                return;
            const err = res?.error ?? "generic";
            if (err === "bot_making_room" && triesLeft > 0) {
                fire(4000, triesLeft - 1);
                return;
            }
            if (err !== "no_table" && err !== "already_seated" && err !== "contest_table" && err !== "table_full")
                handleFail(get, res);
        }, delay));
    };
    fire(250, 6);
}
export function setPendingJoinCode(code) {
    pendingJoinCode = code;
}
export function setPendingRoomId(id) {
    pendingRoomId = id;
}
function askForAccount(action) {
    try {
        window.usernode?.askForAccount?.({ action });
    }
    catch (err) {
        console.debug("[poker] askForAccount unavailable:", err);
    }
}
const EMPTY_TABLE = { snap: null, tableCode: null, chat: [], log: [], myLog: [], drawerOpen: false, joinRequest: null };
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
    myLog: [],
    room: null,
    roomList: [],
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
            // storage unavailable (private mode): keep in-memory language only
        }
        applyLangToDocument(l);
        set({ lang: l });
    },
    setSound: (on) => set({ soundOn: on }),
    // Only an explicit choice is saved; the platform theme is the default.
    setTheme: (t, persist = true) => {
        if (!isTheme(t))
            return;
        if (persist) {
            try {
                localStorage.setItem(THEME_KEY, t);
            }
            catch (err) {
                console.debug("[poker] localStorage.setItem(theme) unavailable:", err);
            }
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
            socket.emit(event, data ?? {}, (res) => {
                if (res?.error === "account_required")
                    askForAccount(res.action);
                resolve(res ?? null);
            });
        });
    },
    connect: () => {
        if (socket || typeof window === "undefined")
            return;
        socket = io({
            path: "/socket.io/",
            auth: PAGE_TOKEN ? { token: PAGE_TOKEN } : {},
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionAttempts: 20,
            reconnectionDelay: 1000,
            timeout: 10000,
        });
        const s = socket;
        s.on("connect", () => {
            set({ connected: true });
            const rejoin = get().tableCode;
            if (rejoin && get().view === "table")
                void get().emit("table:join", { code: rejoin });
        });
        s.on("disconnect", () => set({ connected: false }));
        s.on("me", (me) => {
            set({ me, guest: !me, authed: true });
            if (pendingRoomId && isRoomIdShape(pendingRoomId)) {
                const rid = pendingRoomId.toLowerCase();
                pendingRoomId = null;
                void get().watchRoom(rid);
            }
            if (pendingJoinCode) {
                const code = pendingJoinCode;
                pendingJoinCode = null;
                void get().joinTable(code);
            }
        });
        s.on("state", (snap) => {
            if (!snap) {
                set({ ...EMPTY_TABLE, view: "home" });
                replaceTableParam(null);
                return;
            }
            const prev = get().snap;
            if (prev && snap.phase === "placing" && snap.index !== prev.index && snap.me.inRound)
                playSound("tick", get().soundOn);
            set({ snap, view: "table", tableCode: snap.code });
        });
        s.on("event", (ev) => {
            if (ev?.t === "place") {
                set((st) => ({ myLog: [...st.myLog.slice(-60), ev] }));
                return;
            }
            set((st) => ({ log: [...st.log.slice(-250), ev] }));
            if (ev?.t === "round_start")
                set({ myLog: [] });
            if (ev?.t === "round_end") {
                const me = get().me;
                const mine = me && ev.results?.find((r) => r.id === me.id);
                if (mine && mine.place === 1)
                    playSound("win", get().soundOn);
            }
        });
        s.on("chat:history", ({ messages }) => set({ chat: messages }));
        s.on("chat:message", (msg) => set((st) => ({ chat: [...st.chat.slice(-200), msg] })));
        s.on("log", ({ events }) => set({ log: events }));
        s.on("toast", (toast) => {
            const kind = toast.kind ?? "info";
            const params = { ...(toast.i18n?.params ?? {}) };
            if (typeof params.key === "string")
                params.name = get().t(params.key);
            const text = toast.i18n ? get().t(toast.i18n.key, params) : toast.text ?? "";
            get().toast(kind, text);
        });
        s.on("join:request", (req) => set({ joinRequest: req }));
        s.on("room:state", (rp) => {
            if (!rp || typeof rp.roomId !== "string")
                return;
            set((st) => ({
                room: !st.room || st.room.roomId === rp.roomId ? rp : st.room,
                roomList: st.roomList.some((x) => x.roomId === rp.roomId)
                    ? st.roomList.map((x) => (x.roomId === rp.roomId ? rp : x))
                    : st.roomList,
            }));
        });
        s.on("room:list", (list) => {
            if (Array.isArray(list))
                set({ roomList: list });
        });
    },
    ensureAuthed: async () => {
        get().connect();
        if (get().authed)
            return;
        await new Promise((resolve) => {
            const started = Date.now();
            const check = () => (get().authed || Date.now() - started > 15000 ? resolve() : setTimeout(check, 120));
            check();
        });
    },
    createTable: async (config, botCount = 0) => {
        await get().ensureAuthed();
        const res = await get().emit("table:create", { config, botCount });
        if (res?.ok && res.code) {
            const code = res.code;
            set({ ...EMPTY_TABLE, view: "table", tableCode: code });
            replaceTableParam(code);
            scheduleAutoSit(get, code);
            return code;
        }
        handleFail(get, res);
        return null;
    },
    joinTable: async (code, password) => {
        const norm = String(code ?? "").toUpperCase().trim();
        await get().ensureAuthed();
        const res = await get().emit("table:join", { code: norm, password });
        if (res?.ok) {
            set({ ...EMPTY_TABLE, view: "table", tableCode: norm });
            replaceTableParam(norm);
            scheduleAutoSit(get, norm);
            return true;
        }
        handleFail(get, res);
        return false;
    },
    leaveTable: async () => {
        await get().emit("table:leave");
        set({ ...EMPTY_TABLE, view: "home" });
        replaceTableParam(null);
    },
    place: async (cell) => {
        const res = await get().emit("place", { cell });
        if (res && !res.ok && res.error !== "already_placed" && res.error !== "not_placing")
            handleFail(get, res);
        return res;
    },
    startNextRound: async () => {
        const res = await get().emit("host:startRound");
        if (res && !res.ok)
            handleFail(get, res);
    },
    watchRoom: async (roomId) => {
        const norm = String(roomId ?? "").toLowerCase().trim();
        if (!isRoomIdShape(norm))
            return false;
        await get().ensureAuthed();
        const pub = await get().emit("room:public", { roomId: norm });
        if (pub?.ok && pub.room)
            set({ room: pub.room });
        return !!pub?.ok;
    },
    joinRoom: async (roomId) => {
        const res = await get().emit("room:join", { roomId });
        if (res && !res.ok && res.error !== "already_registered")
            handleFail(get, res);
        return !!res?.ok;
    },
    openRoomTable: async (roomId) => {
        const res = await get().emit("room:openTable", { roomId });
        if (res?.ok && typeof res.tableCode === "string")
            return get().joinTable(res.tableCode);
        handleFail(get, res);
        return false;
    },
    quickPlay: async (opts) => {
        await get().ensureAuthed();
        const me = get().me;
        const code = await get().createTable({
            name: `${me?.username ?? "My"} vs AI`,
            timerSec: 15,
            maxPlayers: 8,
            botsYieldSeats: true,
            botDifficulty: opts?.difficulty ?? "normal",
        }, opts?.bots ?? 3);
        return !!code;
    },
}));
const ERROR_KEYS = {
    table_not_found: "error.table_not_found",
    wait_approval: "error.wait_approval",
    wrong_password: "error.wrong_password",
    banned: "error.banned",
    rate_limited: "error.rate_limited",
    muted: "error.muted",
    blocked: "error.blocked",
    already_seated: "error.already_seated",
    table_full: "error.table_full",
    bot_making_room: "toast.bot_making_room",
    cell_taken: "error.cell_taken",
    room_not_found: "error.room_not_found",
    contest_running: "error.contest_running",
    contest_full: "error.contest_full",
    already_registered: "error.already_registered",
    room_closed: "error.room_closed",
    cannot_leave: "error.cannot_leave",
    need_two_players: "error.need_two_players",
    not_host: "error.not_host",
    already_started: "error.already_started",
};
function handleFail(get, res) {
    const err = res?.error ?? "generic";
    if (err === "account_required")
        return;
    get().toast("error", get().t(ERROR_KEYS[err] ?? "error.generic"));
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
            return;         const now = ctx.currentTime;
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
