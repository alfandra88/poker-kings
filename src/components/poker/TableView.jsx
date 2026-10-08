"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoker, isRoomIdShape } from "@/lib/poker/store";
import { PlayingCard } from "./PlayingCard.jsx";
import { SquaresGrid } from "./SquaresGrid.jsx";
import { RoundResults } from "./RoundResults.jsx";
import { TableDrawer } from "./TableDrawer.jsx";
import { HostPanel } from "./HostPanel.jsx";
import { LanguageDialog } from "./LanguageDialog.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";

// Seconds left until a server timestamp, corrected for clock skew.
function useSecondsLeft(at, serverNow) {
    const [now, setNow] = useState(() => Date.now());
    const [skew] = useState(() => (serverNow ? serverNow - Date.now() : 0));
    useEffect(() => {
        if (!at)
            return;
        const iv = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(iv);
    }, [at]);
    if (!at)
        return null;
    return Math.max(0, Math.ceil((at - (now + skew)) / 1000));
}

function initials(name) {
    return String(name ?? "?").slice(0, 2).toUpperCase();
}

export function TableView() {
    const t = usePoker((s) => s.t);
    const snap = usePoker((s) => s.snap);
    const me = usePoker((s) => s.me);
    const emit = usePoker((s) => s.emit);
    const place = usePoker((s) => s.place);
    const leaveTable = usePoker((s) => s.leaveTable);
    const setStore = usePoker((s) => s.set);
    const joinRequest = usePoker((s) => s.joinRequest);
    const room = usePoker((s) => s.room);
    const router = useRouter();
    const [hostOpen, setHostOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [watchId, setWatchId] = useState(null);
    const [hiddenResults, setHiddenResults] = useState(0);
    // The cell just tapped, shown until the server confirms; it belongs to one card.
    const [tapped, setTapped] = useState(null);
    const contestRoom = snap?.contestId && room?.roomId === snap.contestId ? room : null;
    // Contest tables wait for the contest to deal the next round.
    const nextAt = snap?.nextRoundAt || (contestRoom?.status === "active" ? contestRoom.nextRoundAt : 0);
    const left = useSecondsLeft(snap?.phase === "placing" ? snap?.deadline : nextAt, snap?.serverNow);
    useEffect(() => {
        const rid = snap?.contestId;
        if (rid && isRoomIdShape(rid) && usePoker.getState().room?.roomId !== rid)
            void emit("room:info", { roomId: rid });
    }, [snap?.contestId, emit]);
    if (!snap)
        return null;
    const placing = snap.phase === "placing";
    const pending = tapped && tapped.round === snap.roundNo && tapped.index === snap.index ? tapped.cell : null;
    const inRound = snap.me.inRound && placing;
    const canPlace = inRound && !snap.me.placedCurrent && pending === null;
    const others = snap.players.filter((p) => !p.self);
    const watched = !snap.me.inRound || !placing
        ? snap.players.find((p) => p.id === watchId && p.grid) ?? snap.players.find((p) => p.grid) ?? null
        : null;
    const shownGrid = snap.me.inRound ? snap.me.grid : watched?.grid ?? null;
    const shownTotal = snap.me.inRound ? snap.me.total : watched?.linePoints ?? 0;
    const showResults = snap.phase === "results" && !!snap.results && hiddenResults !== snap.roundNo;
    const isHost = snap.isHost;
    const joinVisible = !!(joinRequest && isHost);
    const copyLink = () => {
        const url = `${window.location.origin}/?t=${snap.code}`;
        navigator.clipboard?.writeText(url).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    const onPlace = async (cell) => {
        if (!canPlace)
            return;
        setTapped({ round: snap.roundNo, index: snap.index, cell });
        const res = await place(cell);
        if (!res?.ok)
            setTapped(null);
    };
    let status;
    if (placing)
        status = contestRoom
            ? `${t("table.roundOf", { n: snap.roundNo, m: contestRoom.rounds })} · ${t("table.cardOf", { n: snap.index + 1 })}`
            : `${t("table.round", { n: snap.roundNo })} · ${t("table.cardOf", { n: snap.index + 1 })}`;
    else if (snap.status === "paused")
        status = t("table.pausedNote");
    else if (contestRoom?.status === "completed")
        status = t("room.status.completed");
    else if (nextAt && left !== null)
        status = t(snap.roundNo === 0 ? "table.firstRoundIn" : "table.nextRoundIn", { n: left });
    else
        status = t("table.waiting");
    return (<div className="h-[100dvh] flex flex-col bg-transparent text-[var(--text-1)] overflow-hidden">
      <header className="flex items-center gap-0.5 sm:gap-2 px-safe px-safe-tight pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] border-b border-white/8 bg-[color-mix(in_srgb,var(--bg-0)_70%,transparent)] backdrop-blur-xl z-30">
        <button className="text-[12px] sm:text-[13px] font-black tracking-tight text-gradient-brand shrink-0 flex items-center gap-1.5 min-h-9" onClick={() => leaveTable()} aria-label={t("table.leave")} data-testid="btn-leave">
          <span className="w-6 h-6 rounded-md bg-white/8 border border-white/10 flex items-center justify-center text-[11px] text-white/80">←</span>
          <span className="hidden min-[420px]:inline">POKER KINGS</span>
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[11px] sm:text-[12px] font-semibold truncate">
            <span className="tracking-[0.12em] tabular-nums">{snap.code}</span> · {snap.name}
          </div>
          <div className="text-[9.5px] sm:text-[10px] text-white/45 tabular-nums truncate" data-testid="table-status">
            {status} · {t("table.playersWatching", { p: snap.players.filter((p) => !p.gone).length, w: snap.watching })}
          </div>
        </div>
        {snap.status === "paused" && (<span className="text-[9px] font-black tracking-widest bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] text-black px-1.5 py-0.5 rounded shrink-0">{t("table.paused")}</span>)}
        {isRoomIdShape(snap.contestId) && (<button className="shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={() => router.push(`/room/${snap.contestId}`)} aria-label={t("room.backToRoom")} title={t("room.backToRoom")} data-testid="btn-back-to-room">
            🏆
          </button>)}
        <button className="shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={copyLink} aria-label={t("common.copy")} data-testid="btn-share">
          {copied ? `✓` : `🔗`}
        </button>
        <button className="lg:hidden shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={() => setStore({ drawerOpen: true })} aria-label={t("table.chat")} data-testid="btn-drawer">
          💬
        </button>
        <button className="shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={() => setLangOpen(true)} aria-label={t("common.language")} data-testid="btn-language-table">
          🌐
        </button>
        <ThemeToggle testid="btn-theme-table"/>
        <button className="shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={() => setHostOpen(true)} aria-label={t("table.menu")} data-testid="btn-menu">
          ☰
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {/* opponents: name, a tick once they placed this card, points so far */}
          <div className="flex gap-2 px-safe py-2.5 overflow-x-auto shrink-0 w-full max-w-lg mx-auto" data-testid="opponents">
            {others.length === 0 && (<span className="text-[11px] text-white/45 py-1">{t("table.noOpponents")}</span>)}
            {others.map((p) => (<button key={p.id} type="button" disabled={!p.grid || inRound} onClick={() => setWatchId(p.id)} className={`shrink-0 flex items-center gap-1.5 rounded-full bg-white/5 border px-1 pr-2.5 py-1 text-[11px] font-bold ${watched?.id === p.id ? "border-[var(--brand)]" : "border-white/10"} ${p.gone ? "opacity-50" : ""}`} data-testid="opponent">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-[#4bcfff] to-[var(--brand-deep)] text-[#02151c] text-[10px] font-black flex items-center justify-center">{initials(p.username)}</span>
                {p.isBot && (<span className="text-[8px] bg-[var(--brand)]/25 text-[var(--brand)] rounded px-1 py-px font-black uppercase">{t("table.aiBadge")}</span>)}
                <span className="max-w-[90px] truncate">{p.username}</span>
                {placing && p.placedCurrent && (<span className="text-[var(--brand)]" aria-label={t("table.placedBadge")}>✓</span>)}
                <span className="text-white/50 tabular-nums">{t("table.pts", { n: p.linePoints })}</span>
              </button>))}
          </div>

          {/* the card to place next */}
          <div className="flex items-center gap-3.5 px-safe pb-3 shrink-0 min-h-[96px] w-full max-w-lg mx-auto" data-testid="next-card-row">
            {placing && snap.card !== null ? (<>
                <PlayingCard key={`${snap.roundNo}-${snap.index}`} card={snap.card} size="lg"/>
                <div className="min-w-0">
                  <p className="text-[13px] font-extrabold">{t("table.cardOf", { n: snap.index + 1 })}</p>
                  <p className="text-[11px] text-white/50 font-semibold mt-0.5">
                    {inRound
                ? (snap.me.placedCurrent || pending !== null ? t("table.placed") : t("table.tapToPlace"))
                : t("table.watchingNote")}
                  </p>
                </div>
                <span className={`ml-auto text-[22px] font-black tabular-nums ${left !== null && left <= 3 ? "text-[var(--danger)]" : "text-[var(--brand)]"}`} data-testid="card-timer">
                  0:{String(left ?? 0).padStart(2, "0")}
                </span>
              </>) : (<div className="min-w-0">
                <p className="text-[13px] font-extrabold">{status}</p>
                {!snap.me.seated && !snap.contestId && (<p className="text-[11px] text-white/50 font-semibold mt-0.5">{t("table.watchingNote")}</p>)}
                {snap.me.waiting && (<p className="text-[11px] text-white/50 font-semibold mt-0.5">{t("table.nextRoundSeat")}</p>)}
              </div>)}
          </div>

          {/* the grid: yours while you play, otherwise the one you are watching */}
          <div className="px-safe flex justify-center shrink-0">
            <SquaresGrid grid={pending !== null && shownGrid ? shownGrid.map((c, i) => (i === pending ? snap.card : c)) : shownGrid} t={t} onPlace={canPlace ? onPlace : null}/>
          </div>

          <div className="flex items-center justify-between gap-3 px-safe py-3.5 shrink-0 w-full max-w-lg mx-auto">
            <span className="text-[13px] font-extrabold">
              {snap.me.inRound || !watched ? t("table.yourPoints") : t("table.theirPoints", { name: watched.username })}{" "}
              <span className="text-[var(--gold-bright)] tabular-nums" data-testid="my-points">{shownTotal}</span>
            </span>
            {snap.phase === "results" && snap.results && !showResults && (<button className="btn-ghost rounded-xl px-3 py-2 text-[12px] font-bold" onClick={() => setHiddenResults(0)}>
                {t("table.showResults")}
              </button>)}
            {!snap.me.seated && !snap.contestId && (<button className="btn-ghost rounded-xl px-3 py-2 text-[12px] font-bold" onClick={() => emit("seat:sit")} data-testid="btn-sit">
                {t("table.sitHere")}
              </button>)}
          </div>

          {joinVisible && (<div className="mx-3 mb-4 glass rounded-2xl px-4 py-3 border border-[var(--gold)]/40" data-testid="join-request">
              <div className="text-[13px] font-semibold mb-2 break-words">{t("join.wants", { name: joinRequest?.username ?? "" })}</div>
              <div className="flex gap-2">
                <button className="rounded-lg bg-[var(--brand)] text-black text-[12px] font-black px-4 py-1.5" onClick={async () => {
                await emit("host:approve", { requestId: joinRequest?.requestId, ok: true });
                setStore({ joinRequest: null });
            }}>
                  {t("common.accept")}
                </button>
                <button className="rounded-lg bg-white/10 text-white/85 text-[12px] font-bold px-4 py-1.5" onClick={async () => {
                await emit("host:approve", { requestId: joinRequest?.requestId, ok: false });
                setStore({ joinRequest: null });
            }}>
                  {t("common.deny")}
                </button>
              </div>
            </div>)}
        </main>

        <div className="hidden lg:flex">
          <TableDrawer forceOpen/>
        </div>
      </div>

      <TableDrawer />
      <HostPanel open={hostOpen} onOpenChange={setHostOpen}/>
      <LanguageDialog open={langOpen} onOpenChange={setLangOpen}/>
      <RoundResults open={showResults} onOpenChange={(v) => !v && setHiddenResults(snap.roundNo)} snap={snap} secondsLeft={left} meId={me?.id ?? null}/>
    </div>);
}
