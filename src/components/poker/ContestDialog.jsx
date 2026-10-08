"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoker } from "@/lib/poker/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
const ROOM_ID_RE = /^[0-9a-f]{40}$/;

// The contests you created or joined, plus opening one by its ID.
export function ContestDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    const me = usePoker((s) => s.me);
    const emit = usePoker((s) => s.emit);
    const roomList = usePoker((s) => s.roomList);
    const router = useRouter();
    const [roomId, setRoomId] = useState("");
    useEffect(() => {
        if (open && me)
            void emit("room:myRooms");
    }, [open, me, emit]);
    const openRoom = (id) => {
        onOpenChange(false);
        router.push(`/room/${id.toLowerCase()}`);
    };
    const valid = ROOM_ID_RE.test(roomId.trim().toLowerCase());
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[88dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white/95">🏆 {t("contest.title")}</DialogTitle>
          <DialogDescription className="text-white/50">{t("contest.dialogSub")}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={roomId} onChange={(e) => setRoomId(e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && valid && openRoom(roomId.trim())} placeholder={t("room.enterId")} maxLength={40} className="bg-black/40 border-white/15 text-white/90 font-mono text-[12px]" data-testid="input-room-id"/>
          <button className="btn-ghost rounded-xl px-4 text-[12px] font-bold disabled:opacity-40" disabled={!valid} onClick={() => openRoom(roomId.trim())}>
            {t("room.open")}
          </button>
        </div>
        <div className="text-[10px] uppercase tracking-widest text-white/40 mt-1">{t("contest.mine")}</div>
        <ScrollArea className="flex-1 max-h-[50dvh] pr-2">
          {roomList.length === 0 ? (<p className="text-[12px] text-white/45 py-6 text-center">{t("contest.mineEmpty")}</p>) : (<ul className="space-y-1.5">
              {roomList.map((r) => (<li key={r.roomId}>
                  <button className="w-full flex items-center gap-2 rounded-xl bg-white/5 border border-white/8 px-3 py-2 text-left hover:bg-white/10" onClick={() => openRoom(r.roomId)}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-bold truncate">{r.name}</span>
                      <span className="block text-[11px] text-white/50">
                        {t(`room.status.${r.status}`)} · {t("table.roundOf", { n: r.roundNo, m: r.rounds })} · {t("contest.playersCount", { n: r.standings.length, m: r.maxPlayers })}
                      </span>
                    </span>
                    <span className="text-white/40">›</span>
                  </button>
                </li>))}
            </ul>)}
        </ScrollArea>
      </DialogContent>
    </Dialog>);
}
