"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoker } from "@/lib/poker/store";
import { fmt } from "@/lib/poker/i18n";
import { ThemeToggle } from "./ThemeToggle.jsx";

function formatRemaining(msLeft) {
    const s = Math.max(0, Math.floor(msLeft / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (d > 0)
        return `${d}d ${pad(h)}:${pad(m)}:${pad(sec)}`;
    return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
const STATUS_STYLE = {
    waiting: "bg-[var(--gold)]/20 text-[var(--gold)]",
    scheduled: "bg-sky-400/20 text-sky-300",
    starting: "bg-[var(--brand)]/25 text-[var(--brand)]",
    active: "bg-[var(--brand)]/20 text-[var(--brand)]",
    final_table: "bg-fuchsia-400/20 text-fuchsia-300",
    completed: "bg-white/10 text-white/70",
    cancelled: "bg-red-400/15 text-red-300",
};

function eventKey(type) {
    const map = {
        room_created: "room.ev.room_created",
        player_joined: "room.ev.player_joined",
        player_left: "room.ev.player_left",
        tournament_starting: "room.ev.tournament_starting",
        tournament_started: "room.ev.tournament_started",
        table_created: "room.ev.table_created",
        table_closed: "room.ev.table_closed",
        late_join_seated: "room.ev.late_join_seated",
        player_eliminated: "room.ev.player_eliminated",
        player_moved: "room.ev.player_moved",
        tables_balanced: "room.ev.tables_balanced",
        final_table: "room.ev.final_table",
        level_up: "room.ev.level_up",
        winner: "room.ev.winner",
        winner_promoted: "room.ev.winner_promoted",
        tournament_completed: "room.ev.tournament_completed",
        room_cancelled: "room.ev.room_cancelled",
        start_postponed: "room.ev.start_postponed",
        start_extended: "room.ev.start_extended",
        bots_added: "room.ev.bots_added",
        bot_removed: "room.ev.bot_removed",
        recovered_after_restart: "room.ev.recovered_after_restart",
    };
    return map[type] ?? null;
}
function EventRow({ ev }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const key = eventKey(ev.type);
    if (!key)
        return null;
    const time = new Date(ev.ts);
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    const ss = String(time.getSeconds()).padStart(2, "0");
    return (<div className="flex items-baseline gap-2 py-1 border-b border-white/5 last:border-0">
      <span className="text-[10px] tabular-nums text-white/35 shrink-0">{hh}:{mm}:{ss}</span>
      <span className="text-[12px] text-white/75 leading-snug">{t(key, ev.params)}</span>
      <span className="hidden" aria-hidden>{lang}</span>
    </div>);
}
export function RoomPanel({ roomId, standalone = false }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const emit = usePoker((s) => s.emit);
    const setStore = usePoker((s) => s.set);
    const me = usePoker((s) => s.me);
    const room = usePoker((s) => s.room);
    const openRoomTable = usePoker((s) => s.openRoomTable);
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [copied, setCopied] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        let alive = true;
        (async () => {
            await usePoker.getState().openRoom(roomId);
            void alive;
        })();
        return () => {
            alive = false;
        };
    }, [roomId]);
    useEffect(() => {
        if (!room?.startsAt || (room.status !== "scheduled"))
            return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [room?.startsAt, room?.status]);
    const roomUrl = typeof window !== "undefined" ? `${window.location.origin}/room/${roomId}` : `/room/${roomId}`;
    const copyShare = async () => {
        try {
            await navigator.clipboard.writeText(roomUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        }
        catch {
            try {
                await navigator.clipboard.writeText(roomId);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
            }
            catch {
                usePoker.getState().toast("warn", t("common.copy") + ": " + roomId);
            }
        }
    };
    const act = async (event, payload, onDone) => {
        if (busy)
            return;
        setBusy(true);
        try {
            await emit(event, payload);
            onDone?.();
        }
        finally {
            setBusy(false);
        }
    };

    const gotoMyTable = () => {
        const id = room?.roomId;
        if (!id)
            return;
        if (standalone) {
            router.push("/");
            setTimeout(() => {
                void usePoker.getState().openRoomTable(id);
            }, 60);
        }
        else {
            void openRoomTable(id);
        }
    };
    if (!room) {
        return (<div className="min-h-[70dvh] flex flex-col items-center justify-center gap-4 text-center px-4">
        <div className="w-10 h-10 rounded-full border-2 border-white/15 border-t-[var(--brand)] animate-spin"/>
        <p className="text-[13px] text-white/50">{t("home.connecting")}</p>
        {standalone && (<button className="btn-ghost rounded-xl px-4 py-2 text-[12px] font-bold" onClick={() => router.push("/")}>
            ← {t("common.close")}
          </button>)}
      </div>);
    }
    const isHost = room.myStatus === "host";
    const isEntrant = room.myStatus === "host" || room.myStatus === "registered" || room.myStatus === "active" || room.myStatus === "eliminated" || room.myStatus === "finished";
    const lobbyish = room.status === "waiting" || room.status === "scheduled" || room.status === "starting";
    const running = room.status === "active" || room.status === "final_table";
    const finished = room.status === "completed";
    const cancelled = room.status === "cancelled";
    const countdown = room.startsAt ? Math.max(0, room.startsAt - now) : null;
    const startModeLabel = t(`room.mode.${room.startMode}`);
    const startModeDesc = t(`room.mode.${room.startMode}.desc`);
    return (<div className="min-h-[100dvh] flex flex-col text-[var(--text-1)]">
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[color-mix(in_srgb,var(--bg-0)_78%,transparent)] backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center gap-2.5">
          {!standalone ? (<button className="btn-ghost rounded-xl px-2.5 py-1.5 text-[13px] font-bold shrink-0" onClick={() => setStore({ view: "home" })} data-testid="btn-room-back">
              ←
            </button>) : (<span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4bcfff] to-[var(--brand-deep)] text-[#02151c] flex items-center justify-center text-[13px] font-black shadow-[0_4px_14px_rgba(39, 190, 245, 0.4)] shrink-0">♠</span>)}
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-black truncate leading-tight">{room.name}</div>
            <div className="text-[10px] text-white/45 truncate">
              {t("common.tournaments")} · {t(`room.status.${room.status}`)}
            </div>
          </div>
          <span className={`text-[9.5px] font-black uppercase tracking-wide px-2.5 py-1 rounded-full shrink-0 ${STATUS_STYLE[room.status] ?? "bg-white/10 text-white/60"}`} data-testid="room-status">
            {t(`room.status.${room.status}`)}
          </span>
          <ThemeToggle testid="btn-theme-room"/>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-5 space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {/* room id + share */}
        <section className="modern-card p-4" data-testid="room-id-card">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{t("room.roomId")}</p>
              <p className="font-mono text-[12.5px] sm:text-[14px] text-[var(--brand)] break-all select-all leading-snug" data-testid="room-id-value">
                {room.roomId}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button className="btn-ghost rounded-xl px-3 py-2 text-[11.5px] font-bold" onClick={copyShare} data-testid="btn-share-room">
                {copied ? `✓ ${t("common.copied")}` : `🔗 ${t("common.copy")}`}
              </button>
              {standalone && (<button className="btn-ghost rounded-xl px-3 py-2 text-[11.5px] font-bold" onClick={() => router.push("/")}>
                  {t("common.join")}
                </button>)}
            </div>
          </div>
          <p className="mt-2 text-[10.5px] text-white/40 leading-relaxed">{startModeLabel} · {startModeDesc}</p>
          {room.status === "scheduled" && countdown !== null && (<div className="mt-3 rounded-xl bg-black/35 border border-white/10 px-4 py-3 text-center" data-testid="room-countdown">
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/45 font-bold">{t("room.countdown")}</p>
              <p className="text-2xl sm:text-3xl font-black tabular-nums text-gradient-gold">{formatRemaining(countdown)}</p>
              <p className="text-[10px] text-white/35 mt-0.5">{room.startsAt ? new Date(room.startsAt).toLocaleString(langMetaLocale(lang)) : ""}</p>
            </div>)}
        </section>

        {/* key facts */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" data-testid="room-facts">
          <Fact label={t("common.players")} value={`${room.counts.registered}/${room.unlimited ? "∞" : room.maxPlayers}`} testid="fact-players"/>
          <Fact label={t("room.tables")} value={room.status === "completed" || cancelled ? "—" : String(room.counts.tables)}/>
          <Fact label={t("create.variant")} value={(room.variant ?? "nlhe").toUpperCase()}/>
          <Fact label={t("create.timer")} value={`${room.turnSec}s`}/>
        </section>

        {/* ───────── CANCELLED ───────── */}
        {cancelled && (<section className="modern-card p-6 text-center space-y-2" data-testid="room-cancelled">
            <p className="text-3xl">🚫</p>
            <p className="font-black text-[15px]">{t("room.status.cancelled")}</p>
            <p className="text-[12px] text-white/50">{t("room.cancelledNote")}</p>
          </section>)}

        {/* ───────── COMPLETED → FINAL RESULTS ───────── */}
        {finished && (<section className="space-y-4" data-testid="room-results">
            {/* champion showcase — the final table stays viewable after the
                tournament; anyone may open it (engine-closed, read-only) */}
            {room.tables.length > 0 && (<button className="modern-card w-full p-4 flex items-center gap-3 text-left hover:brightness-110 transition" onClick={() => void gotoMyTable()} data-testid="btn-showcase-table">
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--gold-bright)] to-[var(--gold)] text-black flex items-center justify-center text-lg shrink-0 shadow-[0_4px_14px_rgba(13, 177, 236, 0.4)]" aria-hidden>
                  🏆
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-black">{t("room.viewFinalTable")}</span>
                  <span className="block text-[11px] text-white/45 font-mono truncate">{room.tables[0].code}</span>
                </span>
                <span className="text-[11px] font-bold text-[var(--gold)] shrink-0">{t("common.view")} →</span>
              </button>)}
            {room.winner && (<div className="modern-card p-6 text-center relative overflow-hidden" data-testid="room-winner">
                <div className="hero-orb hero-orb-1 opacity-40" aria-hidden/>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-gradient-gold">{t("room.winner")}</p>
                <div className="mt-3 mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--gold-bright)] to-[var(--gold-deep)] text-black text-2xl flex items-center justify-center font-black shadow-[0_6px_24px_rgba(13, 177, 236, 0.45)]">
                  🏆
                </div>
                <p className="mt-3 text-xl sm:text-2xl font-black" data-testid="winner-name">{room.winner.nickname}</p>
                <p className="text-[12px] text-white/50">{t("room.finalPosition", { rank: 1 })}</p>
              </div>)}
            <div className="modern-card overflow-hidden">
              <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                <p className="font-black text-[13px]">{t("room.results")}</p>
                {room.completedAt && (<p className="text-[10px] text-white/40">{t("room.completedAt")} {new Date(room.completedAt).toLocaleString(langMetaLocale(lang))}</p>)}
              </div>
              <div className="divide-y divide-white/5">
                {room.results.length === 0 && <p className="px-4 py-6 text-center text-[12px] text-white/40">—</p>}
                {room.results.map((r) => (<div key={r.rank} className="flex items-center gap-3 px-4 py-2.5" data-testid={`result-${r.rank}`}>
                    <span className={`w-9 text-center text-[13px] font-black tabular-nums shrink-0 ${r.rank === 1 ? "text-gradient-gold" : r.rank <= 3 ? "text-white/90" : "text-white/45"}`}>
                      #{r.rank}
                    </span>
                    <span className="text-[14px] shrink-0" aria-hidden>{r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : "•"}</span>
                    <span className={`flex-1 min-w-0 truncate text-[13.5px] font-bold ${r.rank === 1 ? "text-gradient-gold" : ""}`}>{r.nickname}{r.isBot ? " 🤖" : ""}</span>
                    <span className="text-[10.5px] text-white/45 shrink-0 hidden sm:block">{t(`room.title.${r.title}`)}</span>
                    {r.points > 0 && <span className="text-[12px] font-bold text-gradient-gold tabular-nums shrink-0">+{fmt(r.points, lang)} {t("common.points")}</span>}
                  </div>))}
              </div>
            </div>
          </section>)}

        {/* ───────── LOBBY ───────── */}
        {lobbyish && (<section className="space-y-4" data-testid="room-lobby">
            {/* start condition */}
            <div className="modern-card p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-black text-[13px]">{t("room.startCondition")}</p>
                <span className="text-[10.5px] font-bold text-white/55 bg-white/8 rounded-full px-2.5 py-1">{startModeLabel}</span>
              </div>
              {room.startMode === "when_full" && room.requiredPlayers !== null && (<p className="text-[12.5px] text-white/65" data-testid="start-condition">
                  {t("room.requiredInfo", { n: room.counts.registered, m: room.requiredPlayers })}
                </p>)}
              {room.startMode === "scheduled_min" && room.minPlayers !== null && (<p className="text-[12.5px] text-white/65">
                  {t("room.minInfo", { n: room.minPlayers })} · {t("room.fallbackInfo")}: {t(`room.fallback.${room.fallback}`)}
                </p>)}
              {room.startMode === "scheduled" && (<p className="text-[12.5px] text-white/65">{t("room.scheduledInfo")}</p>)}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                <MiniFact label={t("create.variant")} value={(room.variant ?? "nlhe").toUpperCase()}/>
                <MiniFact label={t("create2.seatsPerTable")} value={String(room.seatsPerTable)}/>
                <MiniFact label={t("create.timer")} value={`${room.turnSec}s`}/>
                <MiniFact label={t("create2.lateJoin")} value={room.lateJoin ? "✓" : "✕"}/>
              </div>
              <p className="text-[11px] text-white/45">{t("create.stayRule")}</p>
            </div>

            {/* registered players */}
            <div className="modern-card overflow-hidden">
              <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                <p className="font-black text-[13px]">{t("room.entrants")}</p>
                <p className="text-[11px] text-white/45 tabular-nums">{t("tour.registered", { n: room.counts.registered, m: room.unlimited ? "∞" : room.maxPlayers })}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                {room.players.length === 0 && <p className="px-4 py-5 text-[12px] text-white/40 text-center sm:col-span-2">—</p>}
                {room.players.map((p, i) => (<div key={`${p.nickname}-${p.joinedAt}-${i}`} className="flex items-center gap-2.5 px-4 py-2 border-b border-white/5 last:border-0">
                    <span className="w-5 text-[10px] text-white/35 tabular-nums shrink-0">{i + 1}</span>
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4bcfff] to-[var(--brand-deep)] text-[#02151c] text-[10px] font-black flex items-center justify-center shrink-0">
                      {p.nickname.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[13px] font-semibold">
                      {p.nickname}
                      {p.isBot ? " 🤖" : ""}
                      {me?.nickname === p.nickname ? ` (${t("common.you")})` : ""}
                    </span>
                    {i === 0 && <span className="text-[9px] font-black uppercase text-[var(--gold)] shrink-0">{t("room.host")}</span>}
                  </div>))}
              </div>
            </div>

            {/* host / player controls */}
            <div className="flex flex-wrap gap-2 justify-center">
              {!isEntrant && room.status !== "starting" && (<button className="btn-brand rounded-2xl font-black text-[14px] px-8 py-3 disabled:opacity-50" disabled={busy} onClick={() => act("room:join", { roomId })} data-testid="btn-room-join">
                  {t("room.join")}
                </button>)}
              {isEntrant && room.status !== "starting" && (room.status === "waiting" || room.status === "scheduled") && (<button className="btn-ghost rounded-2xl font-bold text-[13px] px-6 py-3" disabled={busy} onClick={() => act("room:leave", { roomId })} data-testid="btn-room-leave">
                  {t("tour.leave")}
                </button>)}
              {isHost && room.status === "waiting" && (<button className="btn-brand rounded-2xl font-black text-[14px] px-8 py-3 disabled:opacity-50" disabled={busy || room.counts.registered < 2} onClick={() => act("room:start", { roomId })} data-testid="btn-room-start">
                  ▶ {t("tour.start")}
                </button>)}
              {isHost && (room.status === "waiting" || room.status === "scheduled") && (<>
                  <button className="btn-ghost rounded-2xl font-bold text-[13px] px-5 py-3" disabled={busy} onClick={() => act("room:addBots", { roomId, count: 1, difficulty: "normal" })} data-testid="btn-room-addai">
                    🤖 +1 {t("room.ai")}
                  </button>
                  <button className="btn-ghost rounded-2xl font-bold text-[13px] px-5 py-3 !text-red-300 disabled:opacity-50" disabled={busy} onClick={() => act("room:cancel", { roomId })} data-testid="btn-room-cancel">
                    {t("room.cancelRoom")}
                  </button>
                </>)}
            </div>
            {isHost && room.counts.registered < 2 && room.status === "waiting" && (<p className="text-center text-[11.5px] text-white/45">{t("room.needTwoNote")}</p>)}
          </section>)}

        {/* ───────── RUNNING ───────── */}
        {running && (<section className="space-y-4" data-testid="room-running">
            {/* progress */}
            <div className="modern-card p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="font-black text-[13px]">{t("room.progress")}</p>
                <span className="text-[11px] text-white/50 tabular-nums">
                  {t("room.remaining", { n: room.counts.remaining })} · {t("room.eliminatedCount", { n: room.counts.eliminated })}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-black/40 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[var(--brand)] to-[var(--gold)] transition-all duration-500" style={{ width: `${Math.round(room.progress * 100)}%` }}/>
              </div>
              <div className="flex items-center gap-3 flex-wrap text-[11.5px] text-white/55">
                <span>{t("create.variant")}: {(room.variant ?? "nlhe").toUpperCase()}</span>
                <span className="font-bold text-white/80 tabular-nums">{t("create.timer")}: {room.turnSec}s</span>
              </div>
            </div>

            {/* my table CTA */}
            {room.myTableCode ? (<button className="w-full btn-brand rounded-2xl font-black text-[15px] py-4 disabled:opacity-50" disabled={busy} onClick={() => void gotoMyTable()} data-testid="btn-open-my-table">
                ♠ {t("room.openTable")} · {room.myTableCode}
              </button>) : (<div className="modern-card p-4 text-center text-[12.5px] text-white/55">
                {room.myStatus === "eliminated"
                    ? t("room.spectating")
                    : room.myStatus === "registered"
                        ? t("room.notSeatedYet")
                        : t("room.spectatorHint")}
              </div>)}

            {/* tables grid */}
            <div>
              <p className="font-black text-[13px] mb-2">{t("room.tables")}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5" data-testid="room-tables">
                {room.tables.length === 0 && <p className="text-[12px] text-white/40 col-span-full text-center py-4">—</p>}
                {room.tables.map((tb) => {
                const mine = room.myTableCode === tb.code;
                return (<button key={tb.code} onClick={() => {
                        if (mine)
                            void gotoMyTable();
                    }} className={`modern-card p-3.5 text-left transition ${mine ? "ring-1 ring-[var(--brand)]" : ""} ${mine ? "hover:brightness-110" : ""}`} data-testid={`table-card-${tb.code}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-black text-[12.5px]">{t("room.tableN")}</span>
                        {tb.playing && <span className="w-2 h-2 rounded-full bg-[var(--brand)] anim-pulse" aria-label="live"/>}
                      </div>
                      <p className="mt-1 text-[11px] text-white/45 font-mono">{tb.code}</p>
                      <p className="text-[11.5px] text-white/65 tabular-nums mt-0.5">
                        {tb.players}/{tb.seats} {t("common.players")}
                      </p>
                      {mine && <p className="mt-1 text-[10px] font-black text-[var(--brand)] uppercase">{t("room.yourTable")}</p>}
                    </button>);
            })}
              </div>
            </div>

            {/* live standings */}
            <div className="modern-card overflow-hidden">
              <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
                <p className="font-black text-[13px]">{t("tour.standings")}</p>
                <p className="text-[11px] text-white/45 tabular-nums">{t("common.points")}</p>
              </div>
              <div className="max-h-[46dvh] overflow-y-auto overscroll-contain divide-y divide-white/5">
                {room.standings.map((s) => (<div key={`${s.rank}-${s.nickname}`} className={`flex items-center gap-2.5 px-4 py-2 ${s.out ? "opacity-45" : ""}`}>
                    <span className="w-8 text-[12px] font-black tabular-nums text-white/60 shrink-0">#{s.rank}</span>
                    <span className="flex-1 min-w-0 truncate text-[13px] font-semibold">
                      {s.nickname}
                      {s.isBot ? " 🤖" : ""}
                      {me?.nickname === s.nickname ? ` (${t("common.you")})` : ""}
                    </span>
                    {s.tableCode && !s.out && <span className="text-[10px] font-mono text-white/35 shrink-0">{s.tableCode}</span>}
                    <span className={`text-[12px] font-bold tabular-nums shrink-0 ${s.out ? "text-white/35" : "text-gradient-gold"}`}>
                      {s.out ? "💀" : fmt(s.points, lang)}
                    </span>
                  </div>))}
              </div>
            </div>
          </section>)}

        {/* ───────── HISTORY (all states) ───────── */}
        <section className="modern-card overflow-hidden">
          <button className="w-full px-4 py-3 flex items-center justify-between" onClick={() => setShowHistory(!showHistory)} data-testid="btn-history">
            <p className="font-black text-[13px]">📜 {t("room.history")}</p>
            <span className="text-[11px] text-white/40">{showHistory ? "−" : "+"}</span>
          </button>
          {showHistory && (<div className="px-4 pb-4 max-h-[50dvh] overflow-y-auto overscroll-contain">
              {room.events.length === 0 && <p className="text-[12px] text-white/40 text-center py-4">—</p>}
              {room.events.map((ev, i) => <EventRow key={`${ev.ts}-${i}`} ev={ev}/>)}
            </div>)}
        </section>

        {/* timestamps */}
        <section className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10.5px] text-white/35 pb-2">
          <span>{t("room.created")}: {new Date(room.createdAt).toLocaleString(langMetaLocale(lang))}</span>
          {room.startedAt && <span>{t("room.started")}: {new Date(room.startedAt).toLocaleString(langMetaLocale(lang))}</span>}
          {room.completedAt && <span>{t("room.completed")}: {new Date(room.completedAt).toLocaleString(langMetaLocale(lang))}</span>}
        </section>
      </main>
    </div>);
}
function Fact({ label, value, testid }) {
    return (<div className="modern-card p-3 text-center">
      <p className="text-[9.5px] font-black uppercase tracking-[0.14em] text-white/40">{label}</p>
      <p className="mt-1 text-[16px] font-black tabular-nums text-gradient-gold" data-testid={testid}>{value}</p>
    </div>);
}
function MiniFact({ label, value }) {
    return (<div className="rounded-xl bg-black/30 border border-white/8 px-3 py-2 text-center">
      <p className="text-[9px] uppercase tracking-wide text-white/40 font-bold truncate">{label}</p>
      <p className="text-[12.5px] font-black tabular-nums">{value}</p>
    </div>);
}

function langMetaLocale(lang) {
    try {
        const locales = ["en-US", "id-ID", "zh-CN", "hi-IN", "es-ES", "fr-FR", "ar-EG", "bn-BD", "ru-RU", "pt-BR", "ur-PK", "de-DE", "ja-JP", "tr-TR", "ko-KR", "vi-VN", "it-IT", "th-TH", "fa-IR", "pl-PL", "nl-NL", "fil-PH", "ms-MY", "uk-UA", "sw-KE"];
        const idx = ["en", "id", "zh", "hi", "es", "fr", "ar", "bn", "ru", "pt", "ur", "de", "ja", "tr", "ko", "vi", "it", "th", "fa", "pl", "nl", "tl", "ms", "uk", "sw"].indexOf(lang);
        return locales[idx >= 0 ? idx : 0] ?? "en-US";
    }
    catch {
        return "en-US";
    }
}
