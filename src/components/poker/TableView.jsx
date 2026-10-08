"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoker, isRoomIdShape } from "@/lib/poker/store";
import { fmt, formatHandLabel } from "@/lib/poker/i18n";
import { PlayingCard } from "./PlayingCard.jsx";
import { SeatPod, EmptySeat } from "./SeatPod.jsx";
import { computeTableMetrics, dealerPuckPos, holeRowH, makeSeatRing, useElementSize, } from "./tableLayout.js";
import { ActionBar } from "./ActionBar.jsx";
import { TableDrawer } from "./TableDrawer.jsx";
import { HostPanel } from "./HostPanel.jsx";
import { LanguageDialog } from "./LanguageDialog.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";

const PROMPT_BASE_PX = 80;
export function TableView() {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const snap = usePoker((s) => s.snap);
    const emit = usePoker((s) => s.emit);
    const leaveTable = usePoker((s) => s.leaveTable);
    const setStore = usePoker((s) => s.set);
    const log = usePoker((s) => s.log);
    const joinRequest = usePoker((s) => s.joinRequest);
    const room = usePoker((s) => s.room);
    const guest = usePoker((s) => s.guest);
    const router = useRouter();
    const [hostOpen, setHostOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);
    const [sitSeat, setSitSeat] = useState(null);
    const [copied, setCopied] = useState(false);
    const [feltRef, feltSize] = useElementSize();
    const [barRef, barSize] = useElementSize();
    useEffect(() => {
        const rid = snap?.tournamentId;
        if (!rid || !isRoomIdShape(rid))
            return;
        if (usePoker.getState().room?.roomId === rid)
            return;
        void emit("room:info", { roomId: rid });
    }, [snap?.tournamentId, emit]);
    const seatCount = snap?.seats.length ?? 0;
    const ringAnchorSeat = snap?.seats.find((s) => s?.self)?.seatId ?? null;
    const metrics = computeTableMetrics(feltSize.w, feltSize.h, seatCount);
    const ring = useMemo(() => makeSeatRing(feltSize.w, feltSize.h, metrics.rxPx, metrics.ryPx, seatCount, ringAnchorSeat), [feltSize.w, feltSize.h, metrics.rxPx, metrics.ryPx, seatCount, ringAnchorSeat]);
    if (!snap)
        return null;
    const mySeat = snap.seats.find((s) => s?.self) ?? null;
    const total = snap.seats.length;
    const { rxPct, ryPct, cyPct, scale: podScale, stackScale } = metrics;
    const dealerPos = snap.buttonSeat !== null
        ? dealerPuckPos(ring(snap.buttonSeat).theta, feltSize.w, feltSize.h, metrics.rxPx, metrics.ryPx, cyPct, podScale)
        : null;
    const isHost = snap.seats.some((s) => s?.isHost && s?.self);
    const lastPayout = [...log].reverse().find((e) => e.t === "payout");
    const championShowing = room?.status === "completed" && !!room.winner && room.tables.some((tc) => tc.code === snap.code);
    const showWinner = !championShowing && (snap.stage === "lobby" || snap.stage === "river");
    const actionBarPx = barSize.h >= 40 ? Math.round(barSize.h) : PROMPT_BASE_PX;
    const promptBottomPx = actionBarPx + (mySeat ? holeRowH(metrics.holeSize) : 0) + 8;
    const joinVisible = !!(joinRequest && isHost);
    const copyLink = () => {
        const url = `${window.location.origin}/?t=${snap.code}`;
        navigator.clipboard?.writeText(url).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    const confirmSit = async () => {
        if (sitSeat === null)
            return;
        await emit("seat:sit", { seatId: sitSeat });
        setSitSeat(null);
    };
    return (<div className="h-[100dvh] flex flex-col bg-transparent text-[var(--text-1)] overflow-hidden">
      {/* header */}
      {/* R5 — px-safe keeps header content clear of notch insets in landscape
            (px-safe-tight = the old 6px base / 12px ≥sm padding floors) */}
      <header className="flex items-center gap-0.5 sm:gap-2 px-safe px-safe-tight pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] border-b border-white/8 bg-[color-mix(in_srgb,var(--bg-0)_70%,transparent)] backdrop-blur-xl z-30">
        <button className="text-[12px] sm:text-[13px] font-black tracking-tight text-gradient-brand shrink-0 flex items-center gap-1.5 min-h-9" onClick={() => leaveTable()} data-testid="btn-leave">
          <span className="w-6 h-6 rounded-md bg-white/8 border border-white/10 flex items-center justify-center text-[11px] text-white/80">←</span>
          <span className="hidden min-[420px]:inline">POKER KINGS</span>
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[11px] sm:text-[12px] font-semibold truncate">{snap.name}</div>
          <div className="text-[9.5px] sm:text-[10px] text-white/45 tabular-nums">
            {snap.mode === "tournament" ? `${t("common.tournament")} · ` : ""}
            {snap.variant.toUpperCase()} · {t("table.hand")} #{snap.handNo}
          </div>
        </div>
        {snap.status === "paused" && (<span className="text-[9px] font-black tracking-widest bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] text-black px-1.5 py-0.5 rounded shrink-0">{t("table.paused")}</span>)}
        {isRoomIdShape(snap.tournamentId) && (<button className="shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={() => router.push(`/room/${snap.tournamentId}`)} aria-label={t("room.backToRoom")} title={t("room.backToRoom")} data-testid="btn-back-to-room">
            🏆
          </button>)}
        <button className="shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={copyLink} data-testid="btn-share">
          {copied ? `✓` : `🔗`}
        </button>
        <button className="lg:hidden shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={() => setStore({ drawerOpen: true })} data-testid="btn-drawer">
          💬
        </button>
        <button className="shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={() => setLangOpen(true)} aria-label={t("common.language")} data-testid="btn-language-table">
          🌐
        </button>
        <ThemeToggle testid="btn-theme-table"/>
        <button className="shrink-0 text-[10.5px] sm:text-[11px] font-semibold btn-ghost rounded-lg px-1.5 sm:px-2 py-1.5 min-w-9 min-h-9 inline-flex items-center justify-center" onClick={() => setHostOpen(true)} data-testid="btn-menu">
          ☰
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 flex flex-col min-w-0 relative">
          <div className="flex-1 relative min-h-0 px-safe pt-2 pb-1">
            {/* R5 — the felt is absolutely positioned (padding does not apply to
            absolute children), so its left/right insets carry the safe-area
            max() directly and the rail can never hide under the notch */}
            <div ref={feltRef} className="absolute top-2 bottom-2 felt-table" style={{
            left: "max(0.75rem, env(safe-area-inset-left, 0px))",
            right: "max(0.75rem, env(safe-area-inset-right, 0px))",
        }} data-testid="felt">
              <div className="felt-rail" aria-hidden/>
              <div className="felt-weave" aria-hidden/>
              <div className="felt-spot" aria-hidden/>
              <div className="felt-line" aria-hidden/>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[6vw] font-black tracking-[0.34em] text-white/[0.05] select-none">POKER KINGS</span>
              </div>

              {/* dealer button */}
              {snap.buttonSeat !== null && dealerPos?.visible && (<div className="absolute -translate-x-1/2 -translate-y-1/2 z-20" style={{ left: `${dealerPos.x}%`, top: `${dealerPos.y}%` }} data-testid="dealer-button" title="Dealer">
                  <div className="dealer-puck">D</div>
                </div>)}

              <div className="absolute left-1/2 z-10" style={{ top: "47%", transform: `translate(-50%, 0) scale(${stackScale})`, transformOrigin: "top center" }}>
                <div className="flex gap-1 min-h-[44px] items-center">
                  {snap.board.map((c, i) => (<PlayingCard key={`${snap.handNo}-b${i}-${c}`} card={c} size="sm" delay={i * 110}/>))}
                  {/* undealt board slots keep the felt layout stable and readable */}
                  {liveBoard(snap) &&
            Array.from({ length: 5 - snap.board.length }).map((_, i) => (<div key={`slot-${i}`} className="board-slot" aria-hidden/>))}
                </div>
              </div>

              {showWinner && lastPayout?.winners && lastPayout.winners.length > 0 && (

        <div className="absolute left-1/2 top-[38%] z-30 w-max max-w-[92%]" style={{ transform: `translate(-50%, -50%) scale(${stackScale})`, transformOrigin: "center center" }} data-testid="winner-banner">
                  <div className="anim-pop rounded-2xl glass-strong border border-[var(--gold)]/45 px-4 py-2 text-center">
                    {lastPayout.winners.map((w) => (<div key={w.seat} className="text-[11px] sm:text-[12.5px] font-bold text-gradient-gold whitespace-nowrap overflow-hidden text-ellipsis">
                        🏆 {snap.seats.find((s) => s?.seatId === w.seat)?.nickname} +{fmt(w.amount ?? 0, lang)} {t("common.points")}
                        {w.label ? ` · ${formatHandLabel(lang, w.label)}` : ""}
                      </div>))}
                  </div>
                </div>)}

              {/* tournament champion showcase — dead center of the felt.
            Visible whenever the owning Room is completed and this table
            is the kept showcase (final) table. Pure presentation: it
            reads only server-pushed room state, no actions exist. */}
              {championShowing && (<div className="absolute z-30 pointer-events-none" style={{
                left: "50%",
                top: "44%",
                transform: `translate(-50%, -50%) scale(${stackScale})`,
                transformOrigin: "center center",
            }} data-testid="champion-center">
                  {/* animation is Y-only (champ-in): chip-float bakes a
                translateX(-50%) for left-1/2 elements which would
                double-shift a wrapper-centered card */}
                  <div className="rounded-3xl glass-strong border border-[var(--gold)]/50 px-5 sm:px-7 py-3 sm:py-4 text-center champion-glow champ-in">
                    <div className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.32em] text-[var(--gold)]">
                      {t("room.championTag")}
                    </div>
                    <div className="text-lg sm:text-2xl font-black text-gradient-gold mt-0.5 max-w-[52vw] sm:max-w-[340px] truncate">
                      🏆 {room.winner?.nickname ?? ""}
                    </div>
                  </div>
                </div>)}

              {snap.status === "lobby" && seatedZero(snap.seats) && (<div className="absolute left-1/2 -translate-x-1/2 top-[26%] text-[12px] font-semibold on-felt whitespace-nowrap">
                  {t("table.waiting")}
                </div>)}

              {snap.seats.map((seat, i) => {
            const ringPos = ring(i);
            return seat ? (<SeatPod key={i} seat={seat} total={total} mySeatId={mySeat?.seatId ?? null} isToAct={snap.toAct === seat.seatId} msLeft={snap.toAct === seat.seatId ? snap.msLeft : null} windowMs={turnWindowMs(snap)} isSelf={!!seat.self} scale={podScale} rxPct={rxPct} ryPct={ryPct} cyPct={cyPct} xPct={ringPos.xPct} yPct={ringPos.yPct} lang={lang}/>) : (<EmptySeat key={i} seatId={i} total={total} mySeatId={mySeat?.seatId ?? null} canSit={!mySeat && !guest && snap.status !== "closed"} scale={podScale} rxPct={rxPct} ryPct={ryPct} cyPct={cyPct} xPct={ringPos.xPct} yPct={ringPos.yPct} onSit={(sid) => setSitSeat(sid)}/>);
        })}
            </div>

            {/* R8+R19 — ONE stacked prompt slot (join-request) anchored to the
            MEASURED action bar (R7), centered over the MAIN COLUMN — not the
            viewport — so the lg split view keeps prompts on the felt. */}
            {joinVisible && (<div className="absolute left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 w-max max-w-[92vw]" style={{ bottom: `${promptBottomPx}px` }}>
                <div className="anim-pop glass rounded-2xl px-4 py-3 border border-[var(--gold)]/40 w-max max-w-[92vw]" data-testid="join-request">
                    <div className="text-[13px] font-semibold mb-2 break-words">{t("join.wants", { name: joinRequest?.nickname ?? "" })}</div>
                    <div className="flex gap-2">
                      <button className="rounded-lg bg-[var(--brand)] text-black text-[12px] font-black px-4 py-1.5" onClick={async () => {
                    await emit("host:approve", { requestId: joinRequest?.requestId, ok: true });
                    setStore({ joinRequest: null });
                }}>
                        {t("common.accept")}
                      </button>
                      <button className="rounded-lg bg-white/10 text-white text-[12px] font-bold px-4 py-1.5" onClick={async () => {
                    await emit("host:approve", { requestId: joinRequest?.requestId, ok: false });
                    setStore({ joinRequest: null });
                }}>
                        {t("common.deny")}
                      </button>
                    </div>
                  </div>
              </div>)}
          </div>

          {/* hole cards — MY cards only (server redacts everyone else's).
            The row keeps a stable height while seated so the felt ring and
            the fixed prompts never jump when cards are dealt or mucked. */}
          {mySeat ? (<div className="flex justify-center items-center py-1 z-20 shrink-0" style={{ minHeight: holeRowH(metrics.holeSize) }} data-testid="hole-cards-row">
              {mySeat.cards && mySeat.cards.length > 0 && (<div className="flex gap-1.5">
                  {mySeat.cards.map((c, i) => (<PlayingCard key={`${snap.handNo}-h${i}-${c}`} card={c} size={metrics.holeSize} delay={i * 90}/>))}
                </div>)}
            </div>) : null}
          {/* R7 — the measured wrapper feeds the real ActionBar height into the
            prompt-slot bottom offset (fallback: PROMPT_BASE_PX pre-measure) */}
          <div ref={barRef}>
            <ActionBar />
          </div>
        </main>

        <div className="hidden lg:flex">
          <TableDrawer forceOpen/>
        </div>
      </div>

      <TableDrawer />

      <HostPanel open={hostOpen} onOpenChange={setHostOpen}/>

      <LanguageDialog open={langOpen} onOpenChange={setLangOpen}/>

      {/* take-a-seat dialog */}
      <Dialog open={sitSeat !== null} onOpenChange={(v) => !v && setSitSeat(null)}>
        <DialogContent className="glass-strong max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-white">{t("table.sitHere")}</DialogTitle>
            <DialogDescription className="text-white/50">
              {t("create.stayRule")}
            </DialogDescription>
          </DialogHeader>
          <button className="w-full btn-brand rounded-xl font-black py-2.5 text-sm" onClick={confirmSit} data-testid="confirm-sit">
            {t("common.confirm")}
          </button>
        </DialogContent>
      </Dialog>

    </div>);
}
function seatedZero(seats) {
    return seats.filter(Boolean).length === 0;
}

function liveBoard(snap) {
    return (["preflop", "flop", "turn", "river"].includes(snap.stage) &&
        snap.board.length < 5);
}

function turnWindowMs(snap) {
    return Math.max(1, (snap.config.actionTimerSec + snap.config.timeBankSec) * 1000);
}