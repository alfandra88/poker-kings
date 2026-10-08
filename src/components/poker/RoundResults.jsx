"use client";
import { useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MiniGrid } from "./SquaresGrid.jsx";

// Everyone's grid and points after card 25, ranked; equal points share a place.
export function RoundResults({ open, onOpenChange, snap, secondsLeft, meId }) {
    const t = usePoker((s) => s.t);
    const startNextRound = usePoker((s) => s.startNextRound);
    const [expanded, setExpanded] = useState(null);
    if (!snap?.results)
        return null;
    const rows = snap.results;
    const openId = expanded ?? rows[0]?.id ?? null;
    let footer = null;
    if (snap.contestId)
        footer = t("table.contestNext");
    else if (snap.status === "paused")
        footer = t("table.pausedNote");
    else if (snap.nextRoundAt && secondsLeft !== null)
        footer = t("table.nextRoundIn", { n: secondsLeft });
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[88dvh] overflow-hidden flex flex-col" data-testid="round-results">
        <DialogHeader>
          <DialogTitle className="text-white/95">{t("table.resultsTitle", { n: snap.roundNo })}</DialogTitle>
          <DialogDescription className="text-white/50">{footer}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 max-h-[60dvh] pr-2">
          <ol className="space-y-1.5">
            {rows.map((r) => (<li key={r.id} className={`rounded-xl border ${r.id === meId ? "border-[var(--brand)]/50 bg-[var(--brand)]/10" : "border-white/8 bg-white/5"}`}>
                <button type="button" className="w-full flex items-center gap-2.5 px-3 py-2 text-left" onClick={() => setExpanded(openId === r.id ? "" : r.id)} aria-expanded={openId === r.id} data-testid="result-row">
                  <span className="w-6 text-[13px] font-black text-white/60 tabular-nums">{r.place}</span>
                  <span className="flex-1 min-w-0 text-[13px] font-bold truncate">
                    {r.username}
                    {r.isBot && (<span className="ml-1.5 text-[8px] bg-[var(--brand)]/25 text-[var(--brand)] rounded px-1 py-px font-black uppercase align-middle">{t("table.aiBadge")}</span>)}
                  </span>
                  {r.bestLine && (<span className="text-[10.5px] text-white/50 truncate max-w-[110px]">{t(`line.${r.bestLine}`)}</span>)}
                  <span className="text-[14px] font-black text-[var(--gold-bright)] tabular-nums">{t("table.pts", { n: r.points })}</span>
                </button>
                {openId === r.id && (<div className="px-3 pb-3 flex justify-center">
                    <MiniGrid grid={r.grid}/>
                  </div>)}
              </li>))}
          </ol>
        </ScrollArea>
        {snap.isHost && !snap.contestId && (<button className="w-full btn-brand rounded-2xl font-black py-3 text-[14px]" onClick={() => startNextRound()} data-testid="btn-next-round">
            {t("table.startNext")}
          </button>)}
      </DialogContent>
    </Dialog>);
}
