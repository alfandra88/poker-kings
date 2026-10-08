"use client";
import { useEffect } from "react";
import { usePoker } from "@/lib/poker/store";
import { fmt } from "@/lib/poker/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export function LeaderboardDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const emit = usePoker((s) => s.emit);
    const leaderboard = usePoker((s) => s.leaderboard);
    useEffect(() => {
        if (open)
            void emit("leaderboard:get");
    }, [open, emit]);
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-white">🏅 {t("common.leaderboard")}</DialogTitle>
          <DialogDescription className="text-white/50">{t("lb.subtitle")}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="season">
          <TabsList className="bg-black/40 w-full">
            <TabsTrigger value="season" className="flex-1 text-[11px]">🏆</TabsTrigger>
            <TabsTrigger value="xp" className="flex-1 text-[11px]">XP</TabsTrigger>
          </TabsList>
          <TabsContent value="season" className="mt-3">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("lb.seasonTitle")}</div>
            <div className="space-y-1 max-h-[46dvh] overflow-y-auto" data-testid="lb-season-rows">
              {(leaderboard?.season ?? []).map((p, i) => (<div key={`${p.id}-${i}`} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <span className={`w-5 text-[11px] font-black ${i < 3 ? "text-[var(--gold)]" : "text-white/40"}`}>
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </span>
                  <span className="flex-1 text-[12.5px] font-semibold truncate">{p.nickname}</span>
                  <span className="text-[10px] text-white/40">{t("lb.played")} {p.played}</span>
                  <span className="text-[12px] font-bold text-[var(--brand)] tabular-nums">{fmt(p.points, lang)}</span>
                </div>))}
              {(leaderboard?.season ?? []).length === 0 && (<p className="text-[12px] text-white/35 text-center py-8" data-testid="lb-empty">
                  {t("lb.noData")}
                </p>)}
            </div>
          </TabsContent>
          <TabsContent value="xp" className="mt-3">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("lb.xpTitle")}</div>
            <div className="space-y-1 max-h-[46dvh] overflow-y-auto">
              {(leaderboard?.overall ?? []).map((p, i) => (<div key={`${p.id}-${i}`} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <span className="w-5 text-[11px] font-black text-white/40">{i + 1}</span>
                  <span className="flex-1 text-[12.5px] font-semibold truncate">{p.nickname}</span>
                  <span className="text-[10px] text-white/40">Lv{p.level}</span>
                  <span className="text-[12px] font-bold text-[var(--gold)] tabular-nums">{fmt(p.xp, lang)}</span>
                </div>))}
              {(leaderboard?.overall ?? []).length === 0 && (<p className="text-[12px] text-white/35 text-center py-8">{t("lb.noData")}</p>)}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>);
}