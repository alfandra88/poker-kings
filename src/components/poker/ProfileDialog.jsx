"use client";
import { useEffect, useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { fmt } from "@/lib/poker/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

const ACHIEVEMENT_ICONS = {
    first_round: "🃏",
    score_50: "⭐",
    score_100: "💯",
    score_150: "🌟",
    flush_line: "🌊",
    full_house_line: "🏠",
    quads_line: "🎯",
    royal_line: "👑",
    rounds_10: "🔟",
    rounds_100: "💪",
    contest_win: "🏆",
    host_5: "🪑",
    level_10: "🚀",
};

export function ProfileDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const me = usePoker((s) => s.me);
    const emit = usePoker((s) => s.emit);
    const setStore = usePoker((s) => s.set);
    useEffect(() => {
        if (!open)
            return;
        void emit("profile:get").then((res) => {
            if (res?.ok && res.me)
                setStore({ me: res.me });
        });
    }, [open, emit, setStore]);
    if (!me)
        return null;
    const stats = me.stats ?? {};
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[88dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white/95">{t("profile.title")}</DialogTitle>
          <DialogDescription className="text-white/50">@{me.username}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[64dvh] pr-2">
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-[var(--brand)]/15 to-transparent border border-white/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/45">{t("profile.totalPoints")}</div>
                  <div className="text-2xl font-black text-[var(--gold)] tabular-nums" data-testid="profile-points">{fmt(stats.total ?? 0, lang)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wider text-white/45">{t("common.level")}</div>
                  <div className="text-2xl font-black">{me.level}</div>
                </div>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-[var(--brand)] rounded-full transition-all" style={{ width: `${me.levelProgress * 100}%` }}/>
              </div>
              <div className="mt-1 text-[10px] text-white/40 text-right">{fmt(me.xp, lang)} XP</div>
            </div>

            <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("profile.stats")}</div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <Stat label={t("profile.rounds")} value={fmt(stats.rounds ?? 0, lang)}/>
                <Stat label={t("profile.bestRound")} value={fmt(stats.best ?? 0, lang)}/>
                <Stat label={t("profile.averageRound")} value={fmt(stats.average ?? 0, lang)}/>
                <Stat label={t("profile.bestLine")} value={stats.bestLine ? t(`line.${stats.bestLine}`) : t("profile.none")}/>
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("profile.achievements")}</div>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {Object.entries(ACHIEVEMENT_ICONS).map(([key, icon]) => {
            const unlocked = me.achievements?.includes(key);
            const name = t(`ach.${key}`);
            return (<div key={key} title={`${name}: ${t(`achDesc.${key}`)}`} className={`aspect-square rounded-xl flex flex-col items-center justify-center border text-lg ${unlocked ? "bg-[var(--gold)]/15 border-[var(--gold)]/50" : "bg-white/4 border-white/8 opacity-30 grayscale"}`} data-testid={`ach-${key}`}>
                      <span aria-hidden>{icon}</span>
                      <span className="text-[7px] font-bold text-center leading-tight px-0.5 mt-0.5">{name}</span>
                    </div>);
        })}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>);
}
function Stat({ label, value }) {
    return (<div className="rounded-xl bg-white/5 py-2.5">
      <div className="text-[14px] font-black tabular-nums text-white/90 truncate px-1">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-white/40 mt-0.5">{label}</div>
    </div>);
}
const PERIODS = ["daily", "weekly", "monthly", "yearly", "forever"];

function Rows({ rows, value, sub, empty, testid }) {
    return (<div className="space-y-1 max-h-[40dvh] overflow-y-auto" data-testid={testid}>
      {rows.map((p, i) => (<div key={`${p.username}-${i}`} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
          <span className={`w-5 text-[11px] font-black ${i < 3 ? "text-[var(--gold)]" : "text-white/40"}`}>
            {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
          </span>
          <span className="flex-1 text-[12.5px] font-semibold truncate">{p.username}</span>
          <span className="text-[9.5px] text-white/40 tabular-nums">{sub(p)}</span>
          <span className="text-[12.5px] font-black tabular-nums text-[var(--brand)]">{value(p)}</span>
        </div>))}
      {rows.length === 0 && (<p className="text-[12px] text-white/45 text-center py-8">{empty}</p>)}
    </div>);
}

export function LeaderboardDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const emit = usePoker((s) => s.emit);
    const leaderboard = usePoker((s) => s.leaderboard);
    const setStore = usePoker((s) => s.set);
    const [board, setBoard] = useState("best");
    const [period, setPeriod] = useState("daily");
    useEffect(() => {
        if (!open)
            return;
        void emit("leaderboard:get").then((res) => {
            if (res?.ok)
                setStore({ leaderboard: res.data });
        });
    }, [open, emit, setStore]);
    const rows = leaderboard?.periods?.[period] ?? [];
    const season = leaderboard?.season ?? [];
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[88dvh] overflow-hidden flex flex-col" data-testid="leaderboard">
        <DialogHeader>
          <DialogTitle className="text-white/95">🏅 {t("common.leaderboard")}</DialogTitle>
          <DialogDescription className="text-white/50">{t("lb.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1">
          {["best", "season"].map((b) => (<button key={b} className={`flex-1 rounded-lg py-1.5 text-[11.5px] font-bold ${board === b ? "seg-on" : "btn-ghost text-white/60"}`} onClick={() => setBoard(b)} data-testid={`lb-board-${b}`}>
              {t(b === "best" ? "lb.bestTitle" : "lb.seasonTitle")}
            </button>))}
        </div>
        {board === "best" ? (<>
            <div className="grid grid-cols-5 gap-1">
              {PERIODS.map((p) => (<button key={p} onClick={() => setPeriod(p)} data-testid={`lb-tab-${p}`} className={`rounded-lg py-1.5 px-0.5 text-[10px] font-bold ${period === p ? "seg-on" : "bg-white/5 text-white/55 hover:bg-white/10"}`}>
                  {t(`lb.${p}`)}
                </button>))}
            </div>
            <Rows rows={rows} value={(p) => t("table.pts", { n: fmt(p.best, lang) })} sub={(p) => t("lb.roundsPlayed", { n: fmt(p.rounds, lang) })} empty={t("lb.noData")} testid="lb-best-rows"/>
            <p className="text-[9.5px] text-white/40 leading-relaxed">{t("lb.bestNote")}</p>
          </>) : (<>
            <Rows rows={season} value={(p) => t("lb.seasonPoints", { n: fmt(p.points, lang) })} sub={(p) => t("lb.contestsPlayed", { n: fmt(p.played, lang) })} empty={t("lb.noSeason")} testid="lb-season-rows"/>
            <p className="text-[9.5px] text-white/40 leading-relaxed">{t("lb.seasonNote")}</p>
          </>)}
      </DialogContent>
    </Dialog>);
}

export function TutorialDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white/95">🎓 {t("tut.title")}</DialogTitle>
          <DialogDescription className="text-white/50">{t("tut.sub")}</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {[1, 2, 3].map((i) => (<li key={i} className="rounded-2xl bg-white/5 border border-white/8 p-3.5">
              <div className="text-[13.5px] font-black mb-1">{t(`tut.s${i}.title`)}</div>
              <p className="text-[12.5px] text-white/65 leading-relaxed">{t(`tut.s${i}.desc`)}</p>
            </li>))}
        </ol>
        <div className="rounded-2xl bg-black/30 border border-white/10 p-3.5">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("tut.points")}</div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            {[["royal_flush", 100], ["straight_flush", 75], ["quads", 50], ["full_house", 25], ["flush", 20], ["straight", 15], ["trips", 10], ["two_pair", 5], ["pair", 2]].map(([k, n]) => (<li key={k} className="flex justify-between gap-2">
                <span className="text-white/75">{t(`line.${k}`)}</span>
                <span className="font-black tabular-nums text-[var(--gold-bright)]">{n}</span>
              </li>))}
          </ul>
        </div>
        <button className="w-full btn-brand rounded-2xl font-black py-3 text-[14px]" onClick={() => onOpenChange(false)}>
          {t("common.gotIt")}
        </button>
      </DialogContent>
    </Dialog>);
}
