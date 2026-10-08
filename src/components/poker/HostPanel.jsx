"use client";
import { useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

const TIMERS = [10, 15, 30];

export function HostPanel({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    const snap = usePoker((s) => s.snap);
    const emit = usePoker((s) => s.emit);
    const leaveTable = usePoker((s) => s.leaveTable);
    const startNextRound = usePoker((s) => s.startNextRound);
    const soundOn = usePoker((s) => s.soundOn);
    const setSound = usePoker((s) => s.setSound);
    const [password, setPassword] = useState(null);
    if (!snap || !open)
        return null;
    const isHost = snap.isHost;
    const contest = !!snap.contestId;
    const players = snap.players.filter((p) => !p.gone);
    const cfg = snap.config;
    const patch = (p) => emit("host:config", { patch: p });
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[85dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white/95">{isHost ? t("host.title") : t("table.menu")}</DialogTitle>
          <DialogDescription className="text-white/50">
            {snap.name} · {snap.code}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[60dvh] pr-2">
          <div className="space-y-4">
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-white/85 text-[13px]">🔊 {t("host.sound")}</Label>
                <Switch checked={soundOn} onCheckedChange={setSound}/>
              </div>
            </section>

            {isHost && !contest && (<section className="space-y-2.5 border-t border-white/10 pt-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">{t("host.settings")}</div>
                {snap.phase !== "placing" && (<button className="w-full btn-brand rounded-xl font-black py-2.5 text-[13px]" onClick={() => startNextRound()} data-testid="host-start-round">
                    {t("table.startNext")}
                  </button>)}
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">⏱ {t("create.timer")}</Label>
                  <div className="flex gap-1">
                    {TIMERS.map((v) => (<button key={v} className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${cfg.timerSec === v ? "seg-on" : "btn-ghost text-white/60"}`} onClick={() => patch({ timerSec: v })}>
                        {t("table.timerSec", { n: v })}
                      </button>))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">{t("create.maxPlayers")}</Label>
                  <div className="flex gap-1">
                    {[2, 4, 6, 8].map((v) => (<button key={v} className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${cfg.maxPlayers === v ? "seg-on" : "btn-ghost text-white/60"}`} onClick={() => patch({ maxPlayers: v })}>
                        {v}
                      </button>))}
                  </div>
                </div>
                <div>
                  <Label className="text-white/60 text-[11px]">{t("create.password")}</Label>
                  <div className="flex gap-2 mt-1">
                    <Input value={password ?? ""} placeholder={cfg.hasPassword ? "••••" : ""} onChange={(e) => setPassword(e.target.value)} maxLength={12} className="bg-black/40 border-white/15 text-white/90"/>
                    <button className="rounded-xl bg-white/10 hover:bg-white/20 px-3 text-[12px] font-bold" onClick={() => {
                    patch({ password: password ?? "" });
                    setPassword(null);
                }}>
                      {t("host.save")}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">{t("host.pause")}</Label>
                  <Switch checked={snap.status === "paused"} onCheckedChange={(v) => emit("host:pause", { on: v })} data-testid="pause-switch"/>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">{t("create.approve")}</Label>
                  <Switch checked={cfg.approveJoin} onCheckedChange={(v) => patch({ approveJoin: v })}/>
                </div>
              </section>)}

            {isHost && !contest && (<section className="space-y-2.5 border-t border-white/10 pt-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">🤖 {t("host.ai")}</div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">{t("host.addBot")}</Label>
                  <div className="flex gap-1">
                    {[1, 2, 3].map((n) => (<button key={n} className="rounded-lg bg-[var(--brand)]/20 hover:bg-[var(--brand)]/40 text-[var(--brand)] text-[11px] font-black px-2.5 py-1 transition-colors" onClick={() => emit("host:addBots", { count: n })} data-testid={`add-bots-${n}`}>
                        +{n}
                      </button>))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">{t("create.botDifficulty")}</Label>
                  <div className="flex gap-1">
                    {["easy", "normal", "hard"].map((d) => (<button key={d} className={`rounded-lg px-2 py-1 text-[10.5px] font-bold ${cfg.botDifficulty === d ? "seg-on" : "btn-ghost text-white/60"}`} onClick={() => patch({ botDifficulty: d })}>
                        {t(`bot.${d}`)}
                      </button>))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">{t("host.botsYield")}</Label>
                  <Switch checked={cfg.botsYieldSeats !== false} onCheckedChange={(v) => patch({ botsYieldSeats: v })}/>
                </div>
              </section>)}

            {isHost && (<section className="space-y-1.5 border-t border-white/10 pt-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">{t("host.players")}</div>
                {players.map((p) => (<div key={p.id} className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-1.5">
                    <span className="flex-1 text-[12px] font-semibold truncate flex items-center gap-1">
                      {p.isBot && (<span className="text-[8px] bg-[var(--brand)]/25 text-[var(--brand)] rounded px-1 py-px font-black uppercase shrink-0">{t("table.aiBadge")}</span>)}
                      {p.username}
                    </span>
                    {p.isBot ? (!contest && (<button className="text-[10px] rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1" onClick={() => emit("host:removeBot", { playerId: p.id })} data-testid="remove-bot">
                        {t("host.removeBot")}
                      </button>)) : !p.self && (<>
                        <button className="text-[10px] rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1" onClick={() => emit("host:mute", { playerId: p.id, minutes: 10 })}>
                          {t("host.mute")}
                        </button>
                        <button className="text-[10px] rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1" onClick={() => emit("host:kick", { playerId: p.id })}>
                          {t("host.kick")}
                        </button>
                        <button className="text-[10px] rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1" onClick={() => emit("host:ban", { playerId: p.id })}>
                          {t("host.ban")}
                        </button>
                        <button className="text-[10px] rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1" onClick={() => emit("host:transfer", { playerId: p.id })} aria-label={t("host.transfer")} title={t("host.transfer")}>
                          👑
                        </button>
                      </>)}
                  </div>))}
              </section>)}

            <section className="border-t border-white/10 pt-3 space-y-2">
              {snap.me.seated && !contest && (<button className="w-full rounded-xl bg-white/10 hover:bg-white/20 text-[12px] font-bold py-2" onClick={() => emit("seat:stand")}>
                  {t("table.standUp")}
                </button>)}
              <button className="w-full rounded-xl bg-white/10 hover:bg-white/20 text-[12px] font-bold py-2" onClick={async () => {
            await leaveTable();
            onOpenChange(false);
        }}>
                {t("table.leave")}
              </button>
              {isHost && !contest && (<button className="w-full rounded-xl bg-[var(--danger)]/80 hover:bg-[var(--danger)] text-white text-[12px] font-bold py-2" onClick={async () => {
                await emit("host:close");
                await leaveTable();
                onOpenChange(false);
            }}>
                  {t("host.closeTable")}
                </button>)}
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>);
}
