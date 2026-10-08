"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePoker, playSound } from "@/lib/poker/store";

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
    const emit = usePoker((s) => s.emit);
    const soundOn = usePoker((s) => s.soundOn);
    const guest = usePoker((s) => s.guest);
    const mySeat = useMemo(() => snap?.seats.find((s) => s?.self) ?? null, [snap]);
    const isMyTurn = !!snap && !!mySeat && snap.toAct === mySeat.seatId && snap.status === "running";
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
    const canStay = !!snap?.canStay;
    const canPass = !!snap?.canPass;
    if (!snap || !mySeat) {
        return (<div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 z-30">
        <div className="mx-auto max-w-xl text-center text-[12px] font-semibold text-white/60 glass rounded-2xl py-2.5">
          <span className="text-[var(--brand)]">◎</span> {t("common.spectator")}. {guest ? t("error.account_required") : t("table.sitHere")}
        </div>
      </div>);
    }
    const doAct = async (type) => {
        await emit("action", { type });
    };
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

      <div className="mx-auto max-w-xl grid grid-cols-2 gap-2">
        <button className="action-btn action-raise" onClick={() => doAct("stay")} disabled={!isMyTurn || !canStay} data-testid="btn-stay">
          {t("table.stay")}
        </button>
        <button className="action-btn action-fold" onClick={() => doAct("pass")} disabled={!isMyTurn || !canPass} data-testid="btn-pass">
          {t("table.pass")}
        </button>
      </div>
      {isMyTurn && canPass && (<div className="mx-auto max-w-xl mt-1.5 text-center text-[11px] text-white/55">
        {t("table.stayHint")}
      </div>)}
    </div>);
}
let lastTickGlobal = null;