"use client";
import { useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { fmt } from "@/lib/poker/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
export function HostPanel({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    const snap = usePoker((s) => s.snap);
    const emit = usePoker((s) => s.emit);
    const leaveTable = usePoker((s) => s.leaveTable);
    const soundOn = usePoker((s) => s.soundOn);
    const setSound = usePoker((s) => s.setSound);
    const lang = usePoker((s) => s.lang);
    const setLang = usePoker((s) => s.setLang);
    const [timer, setTimer] = useState(0);
    const [password, setPassword] = useState("");
    if (!snap)
        return null;
    const isHost = snap.seats.some((s) => s?.isHost && s?.self);
    if (!open)
        return null;
    const players = snap.seats.filter((s) => !!s);
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[85dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white">{t("host.title")}</DialogTitle>
          <DialogDescription className="text-white/50">
            {snap.name} · #{snap.code}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 max-h-[60dvh] pr-2">
          <div className="space-y-4">
            {/* general */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-white/85 text-[13px]">🔊 Sound</Label>
                <Switch checked={soundOn} onCheckedChange={setSound}/>
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-white/85 text-[13px]">{t("common.language")}</Label>
                <div className="flex gap-1">
                  {["en", "id"].map((l) => (<button key={l} className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${lang === l ? "bg-[var(--brand)] text-black" : "bg-white/10 text-white/70"}`} onClick={() => setLang(l)}>
                      {l.toUpperCase()}
                    </button>))}
                </div>
              </div>
            </section>

            {/* host-only */}
            {isHost && (<section className="space-y-2.5 border-t border-white/10 pt-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">{t("host.settings")}</div>

                <div>
                  <Label className="text-white/60 text-[11px]">{t("create.timer")} (5–120s)</Label>
                  <Input type="number" defaultValue={snap.config.actionTimerSec} onBlur={(e) => setTimer(parseInt(e.target.value || "0", 10))} className="bg-black/40 border-white/15 text-white"/>
                </div>
                <div>
                  <Label className="text-white/60 text-[11px]">{t("create.password")}</Label>
                  <Input defaultValue={snap.config.password ?? ""} onBlur={(e) => setPassword(e.target.value)} className="bg-black/40 border-white/15 text-white"/>
                </div>
                <button className="w-full rounded-xl bg-[var(--brand)] text-black font-black py-2 text-[12px]" onClick={async () => {
                const patch = {};
                if (timer >= 5 && timer <= 120)
                    patch.actionTimerSec = timer;
                if (password !== (snap.config.password ?? ""))
                    patch.password = password || undefined;
                await emit("host:config", { patch });
            }}>
                  {t("common.confirm")}
                </button>

                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">{snap.status === "paused" ? t("host.resume") : t("host.pause")}</Label>
                  <Switch checked={snap.status === "paused"} onCheckedChange={(v) => emit("host:pause", { on: v })} data-testid="pause-switch"/>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[13px]">{t("create.approve")}</Label>
                  <Switch checked={snap.config.approveJoin} onCheckedChange={(v) => emit("host:config", { patch: { approveJoin: v } })}/>
                </div>
              </section>)}

            {/* AI players (host, cash only) */}
            {isHost && snap.mode === "cash" && (<section className="space-y-2.5 border-t border-white/10 pt-3">
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
                  <Label className="text-white/85 text-[13px]">{t("host.botsYield")}</Label>
                  <Switch checked={snap.config.botsYieldSeats !== false} onCheckedChange={(v) => emit("host:config", { patch: { botsYieldSeats: v } })}/>
                </div>
              </section>)}

            {/* players (host only) */}
            {isHost && (<section className="space-y-1.5 border-t border-white/10 pt-3">
                <div className="text-[10px] uppercase tracking-widest text-white/40">{t("host.players")}</div>
                {players.map((p) => (<div key={p.seatId} className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-1.5">
                    <span className="flex-1 text-[12px] font-semibold truncate flex items-center gap-1">
                      {p.isBot && (<span className="text-[8px] bg-[var(--brand)]/25 text-[var(--brand)] rounded px-1 py-px font-black uppercase shrink-0">AI</span>)}
                      {p.nickname}
                    </span>
                    <span className="text-[11px] text-[var(--gold)] tabular-nums">{fmt(p.points ?? 0, lang)}</span>
                    {p.isBot ? (<button className="text-[10px] rounded-lg bg-[var(--danger)]/70 hover:bg-[var(--danger)] text-white px-2 py-1" onClick={() => emit("host:removeBot", { playerId: p.playerId })} data-testid={`remove-bot-${p.seatId}`}>
                        {t("host.removeBot")}
                      </button>) : !p.self && (<>
                        <button className="text-[10px] rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1" onClick={() => emit("host:mute", { playerId: p.playerId, minutes: 10 })}>
                          {t("host.mute")}
                        </button>
                        <button className="text-[10px] rounded-lg bg-[var(--danger)]/80 hover:bg-[var(--danger)] px-2 py-1" onClick={() => emit("host:kick", { playerId: p.playerId })}>
                          {t("host.kick")}
                        </button>
                        <button className="text-[10px] rounded-lg bg-white/10 hover:bg-white/20 px-2 py-1" onClick={() => emit("host:transfer", { playerId: p.playerId })}>
                          👑
                        </button>
                      </>)}
                  </div>))}
              </section>)}

            <section className="border-t border-white/10 pt-3 space-y-2">
              <button className="w-full rounded-xl bg-white/10 hover:bg-white/20 text-[12px] font-bold py-2" onClick={async () => {
            await leaveTable();
            onOpenChange(false);
        }}>
                {t("table.leave")}
              </button>
              {isHost && (<button className="w-full rounded-xl bg-[var(--danger)]/80 hover:bg-[var(--danger)] text-white text-[12px] font-bold py-2" onClick={async () => {
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
