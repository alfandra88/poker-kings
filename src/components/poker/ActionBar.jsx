"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePoker, playSound } from "@/lib/poker/store";
import { compactFmt } from "@/lib/poker/i18n";
import { Slider } from "@/components/ui/slider";

function useTurnCountdown(active, msLeft) {
    const deadlineRef = useRef(null);
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!active || msLeft === null || msLeft <= 0) {
            deadlineRef.current = null;
            return;
        }
        deadlineRef.current = Date.now() + msLeft;
        const iv = setInterval(() => setTick((x) => x + 1), 100);
        return () => clearInterval(iv);
    }, [active, msLeft]);
    if (!active || msLeft === null || deadlineRef.current === null)
        return null;
    return Math.max(0, deadlineRef.current - Date.now());
}
export function ActionBar() {
    const t = usePoker((s) => s.t);
    const snap = usePoker((s) => s.snap);
    const me = usePoker((s) => s.me);
    const lang = usePoker((s) => s.lang);
    const emit = usePoker((s) => s.emit);
    const raisePanelOpen = usePoker((s) => s.raisePanelOpen);
    const setStore = usePoker((s) => s.set);
    const soundOn = usePoker((s) => s.soundOn);
    const mySeat = useMemo(() => snap?.seats.find((s) => s?.self) ?? null, [snap, me]);
    const isMyTurn = !!snap && !!mySeat && snap.toAct === mySeat.seatId && snap.status === "running" && !snap.ritPrompt;
    useEffect(() => {
        if (isMyTurn)
            playSound("turn", soundOn);
    }, [isMyTurn, soundOn]);
    const msLeft = isMyTurn ? snap?.msLeft ?? null : null;
    const remaining = useTurnCountdown(isMyTurn, msLeft);
    const secs = remaining !== null ? Math.ceil(remaining / 1000) : null;
    const totalWin = ((snap?.config.actionTimerSec ?? 15) + (snap?.config.timeBankSec ?? 0)) * 1000 || 1;
    const frac = remaining !== null ? Math.max(0, Math.min(1, remaining / totalWin)) : 0;
    const barColor = frac > 0.5 ? "var(--brand)" : frac > 0.2 ? "var(--gold)" : "var(--danger)";
    useEffect(() => {
        if (!isMyTurn || secs === null || secs > 5 || remaining === 0)
            return;
        if (lastTickGlobal !== secs) {
            lastTickGlobal = secs;
            playSound("tick", soundOn);
        }
    }, [isMyTurn, secs, remaining, soundOn]);
    useEffect(() => {
        if (!isMyTurn && raisePanelOpen) {
            const id = setTimeout(() => setStore({ raisePanelOpen: false }), 0);
            return () => clearTimeout(id);
        }
    }, [isMyTurn, raisePanelOpen, setStore]);
    useEffect(() => {
        if (!raisePanelOpen)
            return;
        const onKey = (e) => {
            if (e.key === "Escape")
                setStore({ raisePanelOpen: false });
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [raisePanelOpen, setStore]);
    const toCall = snap?.toCall ?? 0;
    const minRaiseTo = snap?.minRaiseTo ?? 0;
    const maxRaiseTo = snap?.maxRaiseTo ?? 0;
    const pot = snap?.pot ?? 0;
    const [raiseToRaw, setRaiseTo] = useState(0);
    const raiseTo = raiseToRaw >= minRaiseTo && raiseToRaw <= maxRaiseTo && minRaiseTo > 0 ? raiseToRaw : minRaiseTo;
    const quickSizes = useMemo(() => {
        if (!isMyTurn)
            return [];
        const potAfterCall = pot + toCall;
        const mk = (mult) => {
            const target = toCall + Math.round(potAfterCall * mult);
            return Math.max(minRaiseTo, Math.min(maxRaiseTo, target));
        };
        return [
            { label: t("table.min"), to: minRaiseTo },
            { label: t("table.half"), to: mk(0.5) },
            { label: t("table.twoThirds"), to: mk(0.67) },
            { label: t("table.potBtn"), to: mk(1) },
            { label: t("table.allin"), to: maxRaiseTo },
        ].filter((x) => x.to > 0);
    }, [isMyTurn, toCall, pot, minRaiseTo, maxRaiseTo, t]);
    if (!snap || !mySeat) {
        return (<div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 z-30">
        <div className="mx-auto max-w-xl text-center text-[12px] font-semibold text-white/60 glass rounded-2xl py-2.5">
          <span className="text-[var(--brand)]">◎</span> {t("common.spectator")} — {t("table.sitHere")}
        </div>
      </div>);
    }
    const doAct = async (type, to) => {
        setStore({ raisePanelOpen: false });
        await emit("action", { type, to });
    };
    const pctOfPot = Math.max(0, Math.min(100, ((raiseTo - minRaiseTo) / Math.max(1, maxRaiseTo - minRaiseTo)) * 100));
    const canRaise = snap.minRaiseTo !== null && snap.maxRaiseTo !== null;
    return (<div className="px-2 sm:px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-1.5 z-30">
      {isMyTurn && (<div className="flex items-center justify-center gap-2.5 mb-1.5" data-testid="turn-countdown">
          <span className="inline-block text-[10px] font-black tracking-[0.25em] text-[var(--gold)] anim-pulse">
            {t("table.yourTurn")}
          </span>
          {secs !== null && remaining !== null && remaining > 0 && (<span className="text-[10px] font-black tabular-nums rounded-full px-1.5 py-px" style={{
                    color: barColor,
                    background: "rgba(0,0,0,0.5)",
                    border: `1px solid color-mix(in srgb, ${barColor} 55%, transparent)`,
                }} data-testid="my-countdown">
              {secs}s
            </span>)}
        </div>)}

      {/* decision-time progress bar */}
      {isMyTurn && remaining !== null && remaining > 0 && (<div className="mx-auto max-w-xl h-[3px] rounded-full bg-white/8 overflow-hidden mb-1.5" data-testid="turn-progress">
          <div className="h-full rounded-full" style={{
                width: `${frac * 100}%`,
                background: `linear-gradient(90deg, color-mix(in srgb, ${barColor} 65%, transparent), ${barColor})`,
                boxShadow: `0 0 8px color-mix(in srgb, ${barColor} 60%, transparent)`,
                transition: "width 0.12s linear, background 0.4s ease",
            }}/>
        </div>)}

      {raisePanelOpen && isMyTurn && canRaise && (<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 backdrop-blur-[3px] px-3" style={{
                paddingTop: "max(0.75rem, env(safe-area-inset-top))",
                paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
            }} onClick={() => setStore({ raisePanelOpen: false })} data-testid="raise-overlay">
          <div role="dialog" aria-modal="true" aria-label={t("table.raise")} className="glass-strong rounded-2xl p-3.5 sm:p-4 w-full max-w-sm max-h-full overflow-y-auto overscroll-contain space-y-3 anim-pop shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="raise-panel">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-white/60">{t("table.raiseTo")}</span>
              <div className="flex items-center gap-1.5">
                <input className="w-28 bg-black/40 border border-white/15 rounded-lg px-2 py-1 text-right text-base font-bold tabular-nums text-gradient-gold focus:outline-none focus:border-[var(--brand)]" value={raiseTo} onChange={(e) => {
                const v = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
                if (Number.isNaN(v))
                    return;
                setRaiseTo(Math.max(minRaiseTo, Math.min(maxRaiseTo, v)));
            }} inputMode="numeric" data-testid="raise-input"/>
                <button className="w-7 h-7 rounded-lg bg-white/8 hover:bg-white/15 text-white/70 text-[12px] flex items-center justify-center shrink-0" onClick={() => setStore({ raisePanelOpen: false })} aria-label={t("common.close")} data-testid="raise-close">
                  ✕
                </button>
              </div>
            </div>
            <Slider value={[pctOfPot]} onValueChange={(v) => {
                const pct = v[0] ?? 0;
                setRaiseTo(Math.round(minRaiseTo + ((maxRaiseTo - minRaiseTo) * pct) / 100));
            }} min={0} max={100} step={1}/>
            {/* 3+2 wrap under ~420px so labels never truncate; single row above */}
            <div className="grid grid-cols-3 min-[420px]:grid-cols-5 gap-1.5">
              {quickSizes.map((q) => (<button key={q.label} className="btn-ghost rounded-lg py-1.5 px-0.5 text-[10px] font-semibold text-white/85 truncate" onClick={() => setRaiseTo(q.to)}>
                  {q.label}
                </button>))}
            </div>
            <button className="w-full btn-gold rounded-xl font-black py-2.5 text-sm tracking-wide disabled:opacity-40" onClick={() => doAct("raise", raiseTo)} disabled={raiseTo < minRaiseTo || raiseTo > maxRaiseTo} data-testid="confirm-raise">
              {t("table.raiseTo")} {compactFmt(raiseTo, lang)}
            </button>
          </div>
        </div>)}

      <div className="mx-auto max-w-xl grid grid-cols-3 gap-2">
        <button className="action-btn action-fold" onClick={() => doAct("fold")} disabled={!isMyTurn} data-testid="btn-fold">
          {t("table.fold")}
        </button>
        <button className="action-btn action-check" onClick={() => doAct(toCall > 0 ? "call" : "check")} disabled={!isMyTurn} data-testid="btn-check-call">
          {toCall > 0 ? `${t("table.call")} ${compactFmt(Math.min(toCall, mySeat.stack), lang)}` : t("table.check")}
        </button>
        <button className="action-btn action-raise" onClick={() => raisePanelOpen && canRaise ? doAct("raise", raiseTo) : setStore({ raisePanelOpen: true })} disabled={!isMyTurn || !canRaise} data-testid="btn-raise">
          {toCall === 0 ? t("table.bet") : t("table.raise")}
        </button>
      </div>
    </div>);
}
let lastTickGlobal = null;
