"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoker } from "@/lib/poker/store";
import { fmt } from "@/lib/poker/i18n";

const STATUS_STYLE = {
    waiting: "bg-[var(--gold)]/20 text-[var(--gold)]",
    active: "bg-[var(--brand)]/20 text-[var(--brand)]",
    completed: "bg-white/10 text-white/70",
    cancelled: "bg-white/10 text-white/50",
};
const EVENT_KEYS = {
    room_created: "room.ev.room_created",
    player_joined: "room.ev.player_joined",
    player_left: "room.ev.player_left",
    contest_started: "room.ev.contest_started",
    table_created: "room.ev.table_created",
    round_started: "room.ev.round_started",
    round_finished: "room.ev.round_finished",
    winner: "room.ev.winner",
    contest_completed: "room.ev.contest_completed",
    room_cancelled: "room.ev.room_cancelled",
    bots_added: "room.ev.bots_added",
    bot_removed: "room.ev.bot_removed",
};

function useCountdown(at, serverNow) {
    const [now, setNow] = useState(() => Date.now());
    const [skew] = useState(() => (serverNow ? serverNow - Date.now() : 0));
    useEffect(() => {
        if (!at)
            return;
        const iv = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(iv);
    }, [at]);
    return at ? Math.max(0, Math.ceil((at - now - skew) / 1000)) : null;
}

// The contest page: standings, the host's controls and the contest's history.
export function RoomPanel({ roomId }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const room = usePoker((s) => s.room);
    const me = usePoker((s) => s.me);
    const connected = usePoker((s) => s.connected);
    const emit = usePoker((s) => s.emit);
    const watchRoom = usePoker((s) => s.watchRoom);
    const joinRoom = usePoker((s) => s.joinRoom);
    const router = useRouter();
    const [missing, setMissing] = useState(false);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        let alive = true;
        // First view over plain HTTP so the page renders even before (or
        // without) a live connection; the socket keeps it current after.
        fetch(`/api/room/${roomId}`, { cache: "no-store" })
            .then((res) => res.json())
            .then((data) => {
            if (!alive)
                return;
            if (data?.ok && data.room) {
                const cur = usePoker.getState().room;
                if (!cur || cur.roomId !== roomId)
                    usePoker.setState({ room: data.room });
            }
            else if (data?.error === "room_not_found") {
                setMissing(true);
            }
        })
            .catch(() => { });
        void watchRoom(roomId).then((found) => {
            if (alive && !found && usePoker.getState().authed)
                setMissing(true);
        });
        return () => {
            alive = false;
        };
    }, [roomId, watchRoom, connected]);
    const r = room && room.roomId === roomId ? room : null;
    const left = useCountdown(r?.nextRoundAt, r?.serverNow);
    if (!r) {
        return (<div className="min-h-[60dvh] flex flex-col items-center justify-center text-center px-4 gap-2" data-testid="room-loading">
        <p className="font-black text-[15px]">{missing ? t("error.room_not_found") : t("home.connecting")}</p>
      </div>);
    }
    const run = async (event, data = {}) => {
        const res = await emit(event, { roomId, ...data });
        if (res && !res.ok && res.error !== "account_required")
            usePoker.getState().toast("error", t(`error.${res.error}`) === `error.${res.error}` ? t("error.generic") : t(`error.${res.error}`));
        return res;
    };
    const openTable = async () => {
        const res = await run("room:openTable");
        if (res?.ok && res.tableCode)
            router.push(`/?t=${res.tableCode}`);
    };
    const copyLink = () => {
        navigator.clipboard?.writeText(`${window.location.origin}/room/${roomId}`).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    let primary = null;
    if (r.registered && r.status === "active")
        primary = { label: t("room.openTable"), onClick: openTable, testid: "btn-open-table" };
    else if (r.isHost && r.status === "waiting")
        primary = { label: t("contest.start"), onClick: () => run("room:start"), testid: "btn-start-contest", disabled: r.standings.length < 2 };
    else if (!r.registered && r.lateJoinOpen)
        primary = { label: t("contest.join"), onClick: () => joinRoom(roomId), testid: "btn-join-contest", disabled: !me };
    const champion = r.status === "completed" ? r.standings[0] : null;
    return (<div className="mx-auto max-w-3xl px-4 py-5 space-y-4" data-testid="contest-page">
      <section className="space-y-2">
        <div className="flex items-start gap-2">
          <h1 className="flex-1 text-xl sm:text-2xl font-black leading-tight break-words" data-testid="contest-name">{r.name}</h1>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${STATUS_STYLE[r.status] ?? STATUS_STYLE.completed}`} data-testid="contest-status">
            {t(`room.status.${r.status}`)}
          </span>
        </div>
        <p className="text-[12px] text-white/55">
          {t("table.roundOf", { n: r.roundNo, m: r.rounds })} · {t("contest.playersCount", { n: r.standings.length, m: r.maxPlayers })} · {t("table.timerSec", { n: r.timerSec })}
          {r.hostName ? ` · ${t("room.host")}: ${r.hostName}` : ""}
        </p>
        {r.status === "active" && left !== null && (<p className="text-[13px] font-bold text-[var(--brand)]">{t("table.nextRoundIn", { n: left })}</p>)}
        {r.status === "waiting" && (<p className="text-[12px] text-white/55">{t(r.startMode === "manual" ? "room.mode.manual.desc" : "room.mode.immediate.desc")}</p>)}
        <p className="text-[11px] text-white/45">{t(r.lateJoinOpen ? "contest.lateJoinOpen" : "contest.lateJoinClosed")}</p>
      </section>

      {champion && (<section className="rounded-2xl glass-strong border border-[var(--gold)]/45 px-4 py-3 text-center" data-testid="contest-winner">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--gold)]">{t("room.winner")}</div>
          <div className="text-lg font-black text-gradient-gold truncate">🏆 {champion.username}</div>
          <div className="text-[12px] text-white/60">{t("table.pts", { n: fmt(champion.total, lang) })}</div>
        </section>)}

      <section className="flex flex-wrap gap-2">
        {primary && (<button className="btn-brand rounded-2xl font-black px-6 py-3 text-[14px] disabled:opacity-50" onClick={primary.onClick} disabled={primary.disabled} data-testid={primary.testid}>
            {primary.label}
          </button>)}
        {r.isHost && r.status === "waiting" && (<button className="btn-ghost rounded-2xl font-bold px-4 py-3 text-[13px]" onClick={() => run("room:addBots", { count: 1 })} data-testid="btn-contest-add-bot">
            🤖 {t("host.addBot")}
          </button>)}
        {r.registered && !r.isHost && r.status === "waiting" && (<button className="btn-ghost rounded-2xl font-bold px-4 py-3 text-[13px]" onClick={() => run("room:leave")}>
            {t("room.leave")}
          </button>)}
        {r.isHost && r.status === "waiting" && (<button className="btn-ghost rounded-2xl font-bold px-4 py-3 text-[13px]" onClick={() => run("room:cancel")}>
            {t("room.cancelRoom")}
          </button>)}
        <button className="btn-ghost rounded-2xl font-bold px-4 py-3 text-[13px]" onClick={copyLink} data-testid="btn-copy-contest">
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </section>
      {r.isHost && r.status === "waiting" && r.standings.length < 2 && (<p className="text-[11px] text-white/45">{t("room.needTwoNote")}</p>)}

      <section>
        <h2 className="text-[13px] font-black mb-2">{t("contest.standings")}</h2>
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <div className="grid grid-cols-[2rem_1fr_4rem_4rem_3rem] gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-white/45 bg-white/5">
            <span>#</span>
            <span>{t("ledger.player")}</span>
            <span className="text-right">{t("contest.total")}</span>
            <span className="text-right">{t("contest.best")}</span>
            <span className="text-right">{t("contest.played")}</span>
          </div>
          <ol data-testid="standings">
            {r.standings.map((e, i) => (<li key={e.id ?? e.botId ?? i} className={`grid grid-cols-[2rem_1fr_4rem_4rem_3rem] gap-2 px-3 py-2 text-[12.5px] border-t border-white/8 ${e.self ? "bg-[var(--brand)]/10" : ""}`}>
                <span className="font-black text-white/60 tabular-nums">{r.roundNo > 0 ? e.place : "·"}</span>
                <span className="font-semibold truncate">
                  {e.username}
                  {e.isBot && (<span className="ml-1.5 text-[8px] bg-[var(--brand)]/25 text-[var(--brand)] rounded px-1 py-px font-black uppercase align-middle">{t("table.aiBadge")}</span>)}
                  {e.seasonPoints ? <span className="ml-1.5 text-[10.5px] text-[var(--gold)]">{t("contest.seasonPlus", { n: e.seasonPoints })}</span> : null}
                </span>
                <span className="text-right font-black tabular-nums text-[var(--gold-bright)]">{fmt(e.total, lang)}</span>
                <span className="text-right tabular-nums text-white/70">{fmt(e.best, lang)}</span>
                <span className="text-right tabular-nums text-white/55">{e.rounds}</span>
              </li>))}
          </ol>
        </div>
      </section>

      {r.events.length > 0 && (<section>
          <h2 className="text-[13px] font-black mb-2">{t("room.history")}</h2>
          <ul className="space-y-1">
            {r.events.slice().reverse().map((ev, i) => {
                const key = EVENT_KEYS[ev.type];
                if (!key)
                    return null;
                return (<li key={i} className="flex gap-2 text-[12px] text-white/65">
                  <span className="text-white/35 tabular-nums shrink-0">{new Date(ev.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span>{t(key, ev.params)}</span>
                </li>);
            })}
          </ul>
        </section>)}

      <p className="text-[10.5px] text-white/35 break-all">{t("room.roomId")}: {r.roomId}</p>
    </div>);
}
