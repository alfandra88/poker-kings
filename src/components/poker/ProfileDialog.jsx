"use client";
import { useEffect, useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { fmt } from "@/lib/poker/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
const ACHIEVEMENT_META = {
    first_win: { icon: "🥇", name: "First Blood" },
    flush_win: { icon: "💫", name: "Flush Fancy" },
    boat_plus: { icon: "🚤", name: "Boat Racer" },
    quads_plus: { icon: "💎", name: "Four of a Kind" },
    big_pot_100bb: { icon: "🌊", name: "Monster Pot" },
    win_72o: { icon: "🔨", name: "The Hammer" },
    showdown_100: { icon: "🎭", name: "Showdown Regular" },
    hands_500: { icon: "⚙️", name: "Grinder" },
    streak_7: { icon: "📅", name: "Loyal Player" },
    host_10: { icon: "🪑", name: "The Host" },
    gg_50: { icon: "🤝", name: "Good Game" },
    chat_100: { icon: "💬", name: "Chatty" },
    hu_win: { icon: "🤺", name: "Duelist" },
    mtt_ko3: { icon: "🎯", name: "Bounty Hunter" },
    level_10: { icon: "⭐", name: "Rising Star" },
};
export function ProfileDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const me = usePoker((s) => s.me);
    const emit = usePoker((s) => s.emit);
    const setNickname = usePoker((s) => s.setNickname);
    const profile = usePoker((s) => s.profile);
    const [nick, setNick] = useState("");
    useEffect(() => {
        if (open)
            void emit("profile:get");
    }, [open, emit]);
    const stats = (profile?.stats ?? null);
    if (!me)
        return null;
    const winRate = stats && stats.showdowns > 0 ? Math.round((stats.showdownWins / stats.showdowns) * 100) : 0;
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[88dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white">{t("profile.title")}</DialogTitle>
          <DialogDescription className="text-white/50">{me.token.slice(0, 8)}…</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[64dvh] pr-2">
          <div className="space-y-4">
            {/* wallet card */}
            <div className="rounded-2xl bg-gradient-to-br from-[var(--brand)]/15 to-transparent border border-white/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/45">{t("common.chips")}</div>
                  <div className="text-2xl font-black text-[var(--gold)] tabular-nums">{fmt(me.chips, lang)}</div>
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

            {/* daily bonus */}
            <div className="rounded-2xl bg-black/30 border border-white/10 p-4 space-y-2" data-testid="daily-bonus">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-bold">🎁 {t("profile.daily")}</div>
                  <div className="text-[11px] text-white/45">{t("profile.streak", { n: me.bonusStreak })}</div>
                </div>
                {me.canClaimDaily ? (<button className="rounded-xl bg-[var(--gold)] text-black text-[12px] font-black px-4 py-2 hover:brightness-110" onClick={() => emit("economy:claimDaily")} data-testid="btn-claim-daily">
                    {t("profile.claim", { amount: fmt(me.dailyAmount, lang) })}
                  </button>) : (<span className="text-[11px] text-white/40">{t("profile.claimed")}</span>)}
              </div>
              {me.canTopUp && (<button className="w-full rounded-xl border border-[var(--brand)]/50 text-[var(--brand)] text-[12px] font-bold py-2 hover:bg-[var(--brand)]/10" onClick={() => emit("economy:topUp")} data-testid="btn-topup">
                  💚 {t("profile.topup")} (+{fmt(me.topUpAmount, lang)})
                </button>)}
            </div>

            {/* rename */}
            <div className="flex gap-2">
              <Input value={nick} onChange={(e) => setNick(e.target.value)} placeholder={me.nickname} maxLength={20} className="bg-black/40 border-white/15 text-white"/>
              <button className="rounded-xl bg-white/10 hover:bg-white/20 px-4 text-[12px] font-bold" onClick={async () => {
            if (nick.trim())
                await setNickname(nick.trim());
            setNick("");
        }}>
                {t("profile.rename")}
              </button>
            </div>

            {/* stats */}
            <div className="rounded-2xl bg-black/30 border border-white/10 p-4">
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("profile.stats")}</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label={t("profile.hands")} value={stats ? fmt(stats.hands, lang) : "—"}/>
                <Stat label={t("profile.showdowns")} value={stats ? fmt(stats.showdowns, lang) : "—"}/>
                <Stat label={t("profile.winRate")} value={stats ? `${winRate}%` : "—"}/>
                <Stat label={t("profile.vpip")} value={stats ? `${stats.vpip}%` : "—"}/>
                <Stat label={t("profile.pfr")} value={stats ? `${stats.pfr}%` : "—"}/>
                <Stat label={t("profile.biggestPot")} value={stats ? fmt(stats.biggestPot, lang) : "—"}/>
              </div>
            </div>

            {/* achievements */}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("profile.achievements")}</div>
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(ACHIEVEMENT_META).map(([key, meta]) => {
            const unlocked = stats?.achievements?.includes(key);
            const name = t(`ach.${key}`) || meta.name;             return (<div key={key} title={name} className={`aspect-square rounded-xl flex flex-col items-center justify-center border text-lg ${unlocked ? "bg-[var(--gold)]/15 border-[var(--gold)]/50" : "bg-white/4 border-white/8 opacity-30 grayscale"}`}>
                      <span>{meta.icon}</span>
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
      <div className="text-[14px] font-black tabular-nums text-white/90">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-white/40 mt-0.5">{label}</div>
    </div>);
}
const PERIOD_TABS = [
    { key: "daily", labelKey: "lb.daily", icon: "☀️" },
    { key: "weekly", labelKey: "lb.weekly", icon: "📅" },
    { key: "monthly", labelKey: "lb.monthly", icon: "🗓️" },
    { key: "yearly", labelKey: "lb.yearly", icon: "🎆" },
    { key: "forever", labelKey: "lb.forever", icon: "♾️" },
];
function ChipsLeaderboard() {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const leaderboard = usePoker((s) => s.leaderboard);
    const [period, setPeriod] = useState("daily");
    const rows = leaderboard?.periods?.[period] ?? [];
    const periodKey = leaderboard?.periodKeys?.[period] ?? "";
    return (<div data-testid="lb-chips">
      {/* period tabs — exactly 5: Daily / Weekly / Monthly / Yearly / Forever */}
      <div className="grid grid-cols-5 gap-1 mb-2">
        {PERIOD_TABS.map((p) => (<button key={p.key} onClick={() => setPeriod(p.key)} data-testid={`lb-tab-${p.key}`} className={`rounded-lg py-1.5 px-0.5 text-[9.5px] font-bold leading-tight transition-colors ${period === p.key
                ? "bg-[var(--brand)] text-black"
                : "bg-white/5 text-white/55 hover:bg-white/10"}`}>
            <span className="block text-[11px]">{p.icon}</span>
            {t(p.labelKey)}
          </button>))}
      </div>

      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-white/40 mb-2">
        <span>{t("lb.chipsTitle")}</span>
        <span className="normal-case tracking-normal text-white/30">{periodKey}</span>
      </div>

      <div className="space-y-1 max-h-[40dvh] overflow-y-auto" data-testid="lb-chips-rows">
        {rows.map((p, i) => (<div key={`${p.nickname}-${i}`} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
            <span className={`w-5 text-[11px] font-black ${i < 3 ? "text-[var(--gold)]" : "text-white/40"}`}>
              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
            </span>
            <span className="flex-1 text-[12.5px] font-semibold truncate">{p.nickname}</span>
            <span className="text-[9.5px] text-white/35 tabular-nums">
              {t("lb.hands")} {fmt(p.hands, lang)}
            </span>
            <span className={`text-[12.5px] font-black tabular-nums ${p.net >= 0 ? "text-[var(--brand)]" : "text-[var(--danger)]"}`}>
              {p.net >= 0 ? "+" : "−"}
              {fmt(Math.abs(p.net), lang)}
            </span>
          </div>))}
        {rows.length === 0 && (<p className="text-[12px] text-white/35 text-center py-8" data-testid="lb-chips-empty">
            {t("lb.noData")}
          </p>)}
      </div>

      <p className="text-[9.5px] text-white/30 mt-2 leading-relaxed">{t("lb.chipsNote")}</p>
    </div>);
}
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
        <Tabs defaultValue="chips">
          <TabsList className="bg-black/40 w-full">
            <TabsTrigger value="chips" className="flex-1 text-[11px]">💰</TabsTrigger>
            <TabsTrigger value="xp" className="flex-1 text-[11px]">XP</TabsTrigger>
            <TabsTrigger value="points" className="flex-1 text-[11px]">🏆</TabsTrigger>
          </TabsList>
          <TabsContent value="chips" className="mt-3">
            <ChipsLeaderboard />
          </TabsContent>
          <TabsContent value="xp" className="mt-3">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("lb.xpTitle")}</div>
            <div className="space-y-1 max-h-[46dvh] overflow-y-auto">
              {(leaderboard?.xp ?? []).map((p, i) => (<div key={i} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <span className="w-5 text-[11px] font-black text-white/40">{i + 1}</span>
                  <span className="flex-1 text-[12.5px] font-semibold truncate">{p.nickname}</span>
                  <span className="text-[10px] text-white/40">Lv{p.level}</span>
                  <span className="text-[12px] font-bold text-[var(--gold)] tabular-nums">{fmt(p.xp, lang)}</span>
                </div>))}
              {(leaderboard?.xp ?? []).length === 0 && <p className="text-[12px] text-white/35 text-center py-8">—</p>}
            </div>
          </TabsContent>
          <TabsContent value="points" className="mt-3">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-2">{t("lb.pointsTitle")}</div>
            <div className="space-y-1 max-h-[46dvh] overflow-y-auto">
              {(leaderboard?.points ?? []).map((p, i) => (<div key={i} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
                  <span className="w-5 text-[11px] font-black text-white/40">{i + 1}</span>
                  <span className="flex-1 text-[12.5px] font-semibold truncate">{p.nickname}</span>
                  <span className="text-[10px] text-white/40">{t("lb.played")} {p.played}</span>
                  <span className="text-[12px] font-bold text-[var(--brand)] tabular-nums">{fmt(p.points, lang)}</span>
                </div>))}
              {(leaderboard?.points ?? []).length === 0 && <p className="text-[12px] text-white/35 text-center py-8">—</p>}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>);
}
export function TutorialDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">🎓 {t("tut.title")}</DialogTitle>
          <DialogDescription className="text-white/50"/>
        </DialogHeader>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (<div key={i} className="rounded-2xl bg-black/30 border border-white/10 p-4">
              <div className="font-bold text-[14px] mb-1">{t(`tut.s${i}.title`)}</div>
              <p className="text-[12.5px] text-white/60 leading-relaxed">{t(`tut.s${i}.desc`)}</p>
            </div>))}
        </div>
      </DialogContent>
    </Dialog>);
}
