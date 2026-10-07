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
import { Slider } from "@/components/ui/slider";

const PROMPT_BASE_PX = 80;
export function TableView() {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const snap = usePoker((s) => s.snap);
    const me = usePoker((s) => s.me);
    const emit = usePoker((s) => s.emit);
    const leaveTable = usePoker((s) => s.leaveTable);
    const setStore = usePoker((s) => s.set);
    const log = usePoker((s) => s.log);
    const rabbit = usePoker((s) => s.rabbit);
    const joinRequest = usePoker((s) => s.joinRequest);
    const room = usePoker((s) => s.room);
    const router = useRouter();
    const [hostOpen, setHostOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);
    const [sitSeat, setSitSeat] = useState(null);
    const [buyIn, setBuyIn] = useState(0);
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
    const isCash = snap.mode === "cash";
    const minBuy = isCash ? snap.config.minBuyIn : 0;
    const maxBuy = isCash ? (snap.config.maxBuyIn > 0 ? Math.min(snap.config.maxBuyIn, me?.chips ?? 0) : me?.chips ?? 0) : 0;
    const lastPayout = [...log].reverse().find((e) => e.t === "payout");
    const championShowing = room?.status === "completed" && !!room.winner && room.tables.some((tc) => tc.code === snap.code);
    const showWinner = !championShowing && (snap.stage === "lobby" || snap.stage === "payout");
    const actionBarPx = barSize.h >= 40 ? Math.round(barSize.h) : PROMPT_BASE_PX;
    const promptBottomPx = actionBarPx + (mySeat ? holeRowH(metrics.holeSize) : 0) + 8;
    const ritVisible = !!snap.ritPrompt && !!mySeat &&
        snap.ritPrompt.votes[String(mySeat.seatId)] === undefined &&
        snap.stage !== "lobby";
    const joinVisible = !!(joinRequest && isHost);
    const rebuyVisible = !!room?.canRebuy;
    const copyLink = () => {
        const url = `${window.location.origin}/?t=${snap.code}`;
        navigator.clipboard?.writeText(url).catch(() => { });
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    const confirmSit = async () => {
        if (sitSeat === null)
            return;
        const res = await emit("seat:sit", { seatId: sitSeat, buyIn: isCash ? buyIn : undefined });
        void res;
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
            {snap.mode === "tournament" && snap.levelEndsAt ? (<LevelCountdown endsAt={snap.levelEndsAt} levelIdx={snap.levelIdx} blinds={`${snap.config.smallBlind}/${snap.config.bigBlind}`} t={t}/>) : (<>
                {t("table.blinds")} {snap.config.smallBlind}/{snap.config.bigBlind}
                {snap.config.ante > 0 ? ` · ${snap.config.ante}` : ""} · #{snap.handNo}
              </>)}
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

              {snap.pot > 0 && (<div className="absolute left-1/2 z-10" style={{ top: "43%", transform: `translate(-50%, 0) scale(${stackScale})`, transformOrigin: "top center" }}>
                  <div className="flex items-center gap-1.5 rounded-full bg-black/60 border border-[var(--gold)]/25 px-3 py-1 pot-glow backdrop-blur">
                    <span className="chip-dot chip-dot-lg"/>
                    <span className="text-[13px] font-black text-gradient-gold tabular-nums" data-testid="pot">
                      {fmt(snap.pot, lang)}
                    </span>
                  </div>
                </div>)}

              {/* dealer button */}
              {snap.buttonSeat !== null && dealerPos?.visible && (<div className="absolute -translate-x-1/2 -translate-y-1/2 z-20" style={{ left: `${dealerPos.x}%`, top: `${dealerPos.y}%` }} data-testid="dealer-button" title="Dealer">
                  <div className="dealer-puck">D</div>
                </div>)}

              <div className="absolute left-1/2 z-10" style={{ top: "51%", transform: `translate(-50%, 0) scale(${stackScale})`, transformOrigin: "top center" }}>
                <div className="flex flex-col items-center gap-1.5">
                  <div className="flex gap-1 min-h-[44px] items-center">
                    {snap.board.map((c, i) => (<PlayingCard key={`${snap.handNo}-b${i}-${c}`} card={c} size="sm" delay={i * 110}/>))}
                    {/* undealt board slots keep the felt layout stable and readable */}
                    {liveBoard(snap) &&
            Array.from({ length: 5 - snap.board.length }).map((_, i) => (<div key={`slot-${i}`} className="board-slot" aria-hidden/>))}
                  </div>
                  {snap.board2.length > 0 && (<div className="flex flex-col items-center gap-0.5">
                      <span className="text-[8px] uppercase tracking-widest text-white/40">{t("table.ritBoard")}</span>
                      <div className="flex gap-1">
                        {snap.board2.map((c, i) => (<PlayingCard key={`${snap.handNo}-b2${i}-${c}`} card={c} size="sm" delay={i * 110}/>))}
                      </div>
                    </div>)}
                  {rabbit && rabbit.cards.length > 0 && (<div className="flex flex-col items-center gap-0.5 opacity-75">
                      <span className="text-[8px] uppercase tracking-widest text-white/40">🐇 {t("table.wouldHave")}</span>
                      <div className="flex gap-1">
                        {rabbit.cards.map((c, i) => (<PlayingCard key={`r${i}`} card={c} size="sm" dim delay={i * 80}/>))}
                      </div>
                    </div>)}
                </div>
              </div>

              {showWinner && lastPayout?.winners && lastPayout.winners.length > 0 && (

        <div className="absolute left-1/2 top-[47%] z-30 w-max max-w-[92%]" style={{ transform: `translate(-50%, -50%) scale(${stackScale})`, transformOrigin: "center center" }} data-testid="winner-banner">
                  <div className="anim-pop rounded-2xl glass-strong border border-[var(--gold)]/45 px-4 py-2 text-center">
                    {lastPayout.winners.map((w) => (<div key={w.seat} className="text-[11px] sm:text-[12.5px] font-bold text-gradient-gold whitespace-nowrap overflow-hidden text-ellipsis">
                        🏆 {snap.seats.find((s) => s?.seatId === w.seat)?.nickname} {t("table.winner")} {fmt(w.amount, lang)}
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
            return seat ? (<SeatPod key={i} seat={seat} total={total} mySeatId={mySeat?.seatId ?? null} isToAct={snap.toAct === seat.seatId} msLeft={snap.toAct === seat.seatId ? snap.msLeft : null} windowMs={turnWindowMs(snap)} isSelf={!!seat.self} scale={podScale} rxPct={rxPct} ryPct={ryPct} cyPct={cyPct} xPct={ringPos.xPct} yPct={ringPos.yPct} lang={lang}/>) : (<EmptySeat key={i} seatId={i} total={total} mySeatId={mySeat?.seatId ?? null} canSit={!mySeat && snap.status !== "closed"} scale={podScale} rxPct={rxPct} ryPct={ryPct} cyPct={cyPct} xPct={ringPos.xPct} yPct={ringPos.yPct} onSit={(sid) => {
                    setSitSeat(sid);
                    setBuyIn(isCash ? Math.min(maxBuy, Math.max(minBuy, 0)) : 0);
                }}/>);
        })}
            </div>

            {/* R8+R19 — ONE stacked prompt slot (RIT / join-request / rebuy /
            rabbit) anchored to the MEASURED action bar (R7), centered over
            the MAIN COLUMN — not the viewport — so the lg split view keeps
            prompts on the felt. Children pop in; the container itself
            carries no animation (fill-mode would freeze its centering). */}
            {(ritVisible || joinVisible || rebuyVisible || snap.rabbitAvailable) && (<div className="absolute left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2 w-max max-w-[92vw]" style={{ bottom: `${promptBottomPx}px` }}>
                {ritVisible && (<div className="anim-pop glass rounded-2xl px-4 py-3 flex items-center justify-center flex-wrap gap-x-3 gap-y-2 border border-[var(--gold)]/30 w-max max-w-[92vw]" data-testid="rit-prompt">
                    <span className="text-[13px] font-bold">{t("table.ritTitle")}</span>
                    <button className="rounded-lg bg-[var(--brand)] text-black text-[12px] font-black px-4 py-1.5" onClick={() => emit("rit:vote", { yes: true })}>{t("common.yes")}</button>
                    <button className="rounded-lg bg-white/10 text-white text-[12px] font-bold px-4 py-1.5" onClick={() => emit("rit:vote", { yes: false })}>{t("common.no")}</button>
                  </div>)}

                {joinVisible && (<div className="anim-pop glass rounded-2xl px-4 py-3 border border-[var(--gold)]/40 w-max max-w-[92vw]" data-testid="join-request">
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
                  </div>)}

                {rebuyVisible && (<div className="anim-pop glass rounded-2xl px-4 py-3 border border-[var(--danger)]/50 w-max max-w-[92vw]">
                    <div className="text-[13px] font-semibold mb-2 text-[var(--danger)]">{t("toast.rebuy_offer", { fee: room?.rebuyFee ?? 0 })}</div>
                    <button className="w-full rounded-lg bg-[var(--gold)] text-black text-[12px] font-black px-4 py-1.5" onClick={() => emit("room:rebuy", { roomId: room?.roomId })} data-testid="btn-rebuy">
                      {t("tour.rebuyBtn", { fee: fmt(room?.rebuyFee ?? 0, lang) })}
                    </button>
                  </div>)}

                {snap.rabbitAvailable && (<button className="anim-pop rounded-full glass border border-[var(--gold)]/40 px-4 py-1.5 text-[12px] font-bold text-[var(--gold)] hover:bg-white/10" onClick={() => emit("rabbit:reveal")} data-testid="btn-rabbit">
                    🐇 {t("table.rabbit")}
                  </button>)}
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

      {/* sit / buy-in dialog */}
      <Dialog open={sitSeat !== null} onOpenChange={(v) => !v && setSitSeat(null)}>
        <DialogContent className="glass-strong max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-white">{t("table.sitHere")}</DialogTitle>
            <DialogDescription className="text-white/50">
              {isCash ? `${t("table.buyin")}: ${fmt(minBuy, lang)} – ${fmt(maxBuy, lang)}` : `${t("common.chips")}: ${fmt(snap.config.startingStack, lang)}`}
            </DialogDescription>
          </DialogHeader>
          {isCash && (<>
              <div className="text-center text-2xl font-black text-gradient-gold tabular-nums">{fmt(buyIn, lang)}</div>
              <Slider value={[Math.min(100, maxBuy > 0 ? ((buyIn - minBuy) / Math.max(1, maxBuy - minBuy)) * 100 : 0)]} onValueChange={(v) => {
                const pct = (v[0] ?? 0) / 100;
                setBuyIn(Math.round(minBuy + (maxBuy - minBuy) * pct));
            }} min={0} max={100} step={1}/>
              <div className="grid grid-cols-4 gap-1.5">
                {[minBuy, Math.round(minBuy * 2), Math.round(minBuy * 4), maxBuy].map((v, i) => (<button key={i} className="btn-ghost rounded-lg py-1 text-[10px] font-semibold text-white/85" onClick={() => setBuyIn(Math.min(maxBuy, v))}>
                    {fmt(Math.min(maxBuy, v), lang)}
                  </button>))}
              </div>
            </>)}
          <button className="w-full btn-brand rounded-xl font-black py-2.5 text-sm" onClick={confirmSit} data-testid="confirm-sit">
            {t("common.confirm")}
          </button>
          {me && me.chips < minBuy && isCash && (<button className="w-full btn-gold rounded-xl font-bold py-2 text-[12px]" onClick={() => emit("economy:topUp")}>
              {t("profile.topup")}
            </button>)}
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
function LevelCountdown({ endsAt, levelIdx, blinds, t, }) {
    const [left, setLeft] = useState("");
    useEffect(() => {
        const tick = () => {
            const s = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
            setLeft(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
        };
        tick();
        const iv = setInterval(tick, 1000);
        return () => clearInterval(iv);
    }, [endsAt]);
    return (<>
      {t("table.level")} {levelIdx + 1} · {blinds} · {left}
    </>);
}
