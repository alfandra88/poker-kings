"use client";
import { useEffect, useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { fmt } from "@/lib/poker/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
const ACHIEVEMENT_META = {
    first_win: { icon: "🥇", name: "First Blood" },
    flush_win: { icon: "💫", name: "Flush Fancy" },
    boat_plus: { icon: "🚤", name: "Boat Racer" },
    quads_plus: { icon: "💎", name: "Four of a Kind" },
    big_pot_100bb: { icon: "🌊", name: "Monster Hand" },
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
    const pMe = (profile?.me ?? null);
    if (!me)
        return null;
    const levelProgress = pMe && pMe.nextLevelXp > 0 ? Math.min(1, pMe.xp / pMe.nextLevelXp) : 0;
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[88dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white">{t("profile.title")}</DialogTitle>
          <DialogDescription className="text-white/50">{me.nickname}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[64dvh] pr-2">
          <div className="space-y-4">
            {/* season card */}
            <div className="rounded-2xl bg-gradient-to-br from-[var(--brand)]/15 to-transparent border border-white/10 p-4" data-testid="season-card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/45">{t("profile.seasonPoints")}</div>
                  <div className="text-2xl font-black text-[var(--gold)] tabular-nums">{fmt(me.seasonPoints ?? 0, lang)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wider text-white/45">{t("common.level")}</div>
                  <div className="text-2xl font-black">{me.level}</div>
                </div>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-[var(--brand)] rounded-full transition-all" style={{ width: `${levelProgress * 100}%` }}/>
              </div>
              <div className="mt-1 text-[10px] text-white/40 text-right">{fmt(pMe?.xp ?? 0, lang)} XP</div>
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
                <Stat label={t("profile.roundsWon")} value={stats ? fmt(stats.roundsWon, lang) : "—"}/>
                <Stat label={t("profile.hands")} value={stats ? fmt(stats.handsPlayed, lang) : "—"}/>
                <Stat label={t("profile.showdowns")} value={stats ? fmt(stats.showdowns, lang) : "—"}/>
                <Stat label={t("profile.winRate")} value={stats ? `${stats.winRate}%` : "—"}/>
                <Stat label={t("profile.seasonPoints")} value={pMe ? fmt(pMe.seasonPoints ?? me.seasonPoints ?? 0, lang) : "—"}/>
                <Stat label={t("profile.played")} value={pMe ? fmt(pMe.seasonPlayed ?? 0, lang) : "—"}/>
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