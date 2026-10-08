"use client";
import { useEffect, useRef, useState } from "react";
import { compactFmt, translate } from "@/lib/poker/i18n";
import { PlayingCard } from "./PlayingCard.jsx";
const AVATAR_COLORS = [
    "#38bdf8", "#0db1ec", "#e5484d", "#4c8dff", "#9b59b6",
    "#fb7185", "#158cb7", "#34495e", "#0686b5", "#0077a3",
];

export function seatXY(seatId, total, mySeatId, rxPct = 43, ryPct = 40, cyPct = 47) {
    const base = 90;
    const offset = mySeatId !== null ? mySeatId : Math.floor(total / 2);
    const angleDeg = base + (seatId - offset) * (360 / Math.max(total, 2));
    const rad = (angleDeg * Math.PI) / 180;
    return {
        x: 50 + rxPct * Math.cos(rad),
        y: cyPct + ryPct * Math.sin(rad),
    };
}

function resolvePos(xPct, yPct, fallback) {
    const okX = typeof xPct === "number" && Number.isFinite(xPct) && xPct > 0 && xPct < 100;
    const okY = typeof yPct === "number" && Number.isFinite(yPct) && yPct > 0 && yPct < 100;
    return okX && okY ? { x: xPct, y: yPct } : fallback;
}

function windowMs(configuredSec, timeBankSec) {
    return Math.max(1, (configuredSec + timeBankSec) * 1000);
}
export function SeatPod({ seat, total, mySeatId, isToAct, msLeft, windowMs: winMs, isSelf, onSit, scale = 1, cyPct = 47, rxPct = 43, ryPct = 40, xPct, yPct, lang = "en", }) {
    const pos = seat
        ? resolvePos(xPct, yPct, seatXY(seat.seatId, total, mySeatId, rxPct, ryPct, cyPct))
        : null;
    const deadlineRef = useRef(null);
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!isToAct || msLeft === null || msLeft <= 0) {
            deadlineRef.current = null;
            return;
        }
        deadlineRef.current = Date.now() + msLeft;
        const iv = setInterval(() => setTick((x) => x + 1), 100);
        return () => clearInterval(iv);
    }, [isToAct, msLeft]);
    if (!seat || !pos) {
        return null;
    }
    const ms = isToAct && msLeft !== null && deadlineRef.current !== null
        ? Math.max(0, deadlineRef.current - Date.now())
        : 0;
    const secs = Math.ceil(ms / 1000);
    const totalWin = winMs ?? windowMs(20, 0);
    const frac = isToAct && ms > 0 ? Math.max(0, Math.min(1, ms / totalWin)) : 0;
    const timerColor = frac > 0.5 ? "var(--brand)" : frac > 0.2 ? "var(--gold)" : "var(--danger)";
    const urgent = isToAct && secs <= 5 && ms > 0;
    const pointsLabel = compactFmt(seat.points ?? 0, lang);
    const strikeMarks = Math.min(3, seat.strikes ?? 0);
    const avatarBg = AVATAR_COLORS[(seat.seatId + (seat.nickname.length || 1)) % AVATAR_COLORS.length];
    const podScale = Math.max(0.35, Math.min(1.15, scale || 1));
    const R = 21;     const CIRC = 2 * Math.PI * R;
    const pillBelow = pos.y < cyPct;
    return (<div className="absolute z-10" style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: `translate(-50%,-50%) scale(${podScale})` }} data-seat={seat.seatId} data-testid={`seat-${seat.seatId}`}>
      {seat.benched && !seat.sittingOut && (<div className="absolute inset-0 rounded-2xl bg-black/60 z-10 flex flex-col items-center justify-center px-1">
          <span className="text-[9px] font-bold tracking-wider text-[var(--gold)] text-center">{translate(lang, "seat.benched", { n: seat.benchRounds ?? 0 })}</span>
        </div>)}
      {seat.sittingOut && !seat.benched && (<div className="absolute inset-0 rounded-2xl bg-black/60 z-10 flex items-center justify-center px-1">
          <span className="text-[9px] font-bold tracking-wider text-white/70 text-center">SIT OUT</span>
        </div>)}
      {seat.passed && !seat.sittingOut && !seat.benched && (<div className="absolute inset-0 rounded-2xl bg-black/55 z-10 flex items-center justify-center">
          <span className="text-[10px] font-bold tracking-widest text-white/70">PASS</span>
        </div>)}

      <div className={`glass-strong rounded-2xl px-2 py-1.5 flex flex-col items-center gap-1 w-[118px] overflow-hidden transition-all duration-200 ${isToAct ? "seat-active" : ""} ${seat.revealed ? "seat-revealed" : ""}`} style={isToAct ? { "--timer-color": timerColor } : undefined}>
        <div className="flex items-center gap-1.5 w-full">
          <div className="relative shrink-0" data-testid={isToAct ? "turn-ring" : undefined}>
            {/* countdown ring */}
            {isToAct && (<svg className="absolute -inset-[4px] pointer-events-none z-10" width="54" height="54" viewBox="0 0 54 54" aria-hidden>
                <circle cx="27" cy="27" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3"/>
                <circle cx="27" cy="27" r={R} fill="none" stroke={timerColor} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - frac)} transform="rotate(-90 27 27)" style={{
                transition: "stroke-dashoffset 0.12s linear, stroke 0.4s ease",
                filter: `drop-shadow(0 0 4px ${timerColor})`,
            }}/>
              </svg>)}
            <div className={`w-[46px] h-[46px] rounded-full flex items-center justify-center text-[14px] font-black text-black/80 ring-2 ring-white/20 ${urgent ? "anim-pulse" : ""}`} style={{ background: `linear-gradient(140deg, ${avatarBg}, color-mix(in srgb, ${avatarBg} 62%, black))` }}>
              {seat.nickname.slice(0, 2).toUpperCase()}
            </div>
            {/* live seconds */}
            {isToAct && ms > 0 && (<span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 z-20 rounded-full px-1.5 py-px text-[9.5px] font-black tabular-nums border border-black/40" style={{
                background: "rgba(0,0,0,0.78)",
                color: timerColor,
                boxShadow: `0 0 8px color-mix(in srgb, ${timerColor} 55%, transparent)`,
            }} data-testid="seat-countdown">
                {secs}s
              </span>)}
            {seat.isHost && (<span className="absolute -top-2 -right-1 text-[10px] drop-shadow z-20" title="Host">👑</span>)}
            {!seat.connected && (<span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--danger)] border border-black/50 z-20" title="disconnected"/>)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-white/95 truncate leading-tight flex items-center gap-1">
              {seat.isBot && (<span className="text-[8px] bg-gradient-to-b from-[#4bcfff] to-[var(--brand-deep)] text-[#02151c] rounded px-1 py-px font-black uppercase shrink-0 shadow-[0_1px_4px_rgba(39, 190, 245, 0.4)]">AI</span>)}
              {isSelf && <span className="text-[8px] bg-white/15 rounded px-1 py-px uppercase">You</span>}
              {seat.nickname}
            </div>
            <div className="flex items-center gap-1 leading-tight">
              <span className="text-[12px] font-bold text-gradient-gold tabular-nums">
                {pointsLabel}
              </span>
              {strikeMarks > 0 && (<span className="text-[9px] font-bold text-[var(--danger)] tabular-nums" title={translate(lang, "table.strikes", { n: strikeMarks })} data-testid={`strikes-${seat.seatId}`}>
                  {"●".repeat(strikeMarks)}
                </span>)}
            </div>
          </div>
        </div>

        {seat.cards && seat.cards.length > 0 && (<div className="flex gap-0.5 mt-0.5">
            {seat.revealed || isSelf ? (seat.cards.map((c, i) => (<PlayingCard key={i} card={c} size="sm" delay={i * 60} highlight={seat.revealed}/>))) : (seat.cards.map((_, i) => <PlayingCard key={i} faceDown size="sm" delay={i * 60}/>))}
          </div>)}

        {seat.lastAction && !seat.passed && (<div className="-mt-0.5 text-[9px] uppercase tracking-wider rounded-full px-1.5 py-px font-bold text-white/50">
            {seat.lastAction}
          </div>)}
      </div>
    </div>);
}
export function EmptySeat({ seatId, total, mySeatId, canSit, onSit, scale = 1, cyPct = 47, rxPct = 43, ryPct = 40, xPct, yPct, }) {
    const pos = resolvePos(xPct, yPct, seatXY(seatId, total, mySeatId, rxPct, ryPct, cyPct));
    const podScale = Math.max(0.35, Math.min(1.15, scale || 1));
    return (<button className="absolute z-10 group flex items-center justify-center min-w-[44px] min-h-[44px]" style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)" }} onClick={() => canSit && onSit(seatId)} disabled={!canSit} data-testid={`empty-seat-${seatId}`} aria-label="Take a seat">
      <div className={`glass rounded-2xl w-[72px] h-[52px] flex flex-col items-center justify-center transition-all duration-200 ${canSit ? "opacity-75 group-hover:opacity-100 group-hover:scale-110 group-hover:border-[var(--brand)]/50 cursor-pointer border-dashed" : "opacity-30"}`} style={{ transform: `scale(${podScale})` }}>
        {canSit ? (<>
            <span className="text-lg font-light leading-none text-white/80 group-hover:text-[var(--brand)] transition-colors">+</span>
            <span className="text-[8px] uppercase tracking-wider text-white/45 group-hover:text-white/75 mt-0.5">sit</span>
          </>) : (<span className="text-[10px] text-white/40">·</span>)}
      </div>
    </button>);
}