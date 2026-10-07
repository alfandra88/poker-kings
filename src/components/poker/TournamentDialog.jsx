"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoker } from "@/lib/poker/store";
import { fmt } from "@/lib/poker/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
const ROOM_ID_RE = /^[0-9a-f]{40}$/;
const STATUS_DOT = {
    waiting: "bg-[var(--gold)]",
    scheduled: "bg-sky-400",
    starting: "bg-[var(--brand)]",
    active: "bg-[var(--brand)]",
    final_table: "bg-fuchsia-400",
    completed: "bg-white/40",
    cancelled: "bg-red-400",
};
export function TournamentDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const me = usePoker((s) => s.me);
    const emit = usePoker((s) => s.emit);
    const roomList = usePoker((s) => s.roomList);
    const router = useRouter();
    const [roomId, setRoomId] = useState("");
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (open && me)
            void emit("room:myRooms");
    }, [open, me, emit]);
    const openRoom = (id) => {
        onOpenChange(false);
        router.push(`/room/${id.toLowerCase()}`);
    };
    const joinById = async () => {
        const id = roomId.trim().toLowerCase();
        if (!ROOM_ID_RE.test(id) || busy)
            return;
        setBusy(true);
        try {
            const res = await emit("room:join", { roomId: id });
            if (res?.ok || res?.error === "already_registered") {
                openRoom(id);
            }
            else {
                usePoker.getState().toast("error", t("error.room_not_found"));
            }
        }
        finally {
            setBusy(false);
        }
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md max-h-[88dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white">🏆 {t("tour.title")}</DialogTitle>
          <DialogDescription className="text-white/50">{t("room.dialogSub")}</DialogDescription>
        </DialogHeader>

        {/* join by Room ID */}
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input value={roomId} onChange={(e) => setRoomId(e.target.value.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 40))} onKeyDown={(e) => e.key === "Enter" && joinById()} placeholder={t("room.enterId")} maxLength={40} className="bg-black/40 border-white/15 text-white flex-1 font-mono text-[12.5px] tracking-wider" data-testid="input-room-id"/>
            <button className="rounded-xl bg-[var(--brand)] text-black text-[12px] font-black px-4 disabled:opacity-40 shrink-0" disabled={!ROOM_ID_RE.test(roomId.trim().toLowerCase()) || busy} onClick={joinById} data-testid="btn-room-go">
              {t("room.open")}
            </button>
          </div>
          <p className="text-[10px] text-white/35 px-1">{t("room.enterIdHint")}</p>
        </div>

        <ScrollArea className="max-h-[56dvh] pr-2">
          <div className="space-y-2 pb-2">
            {roomList.length === 0 && (<p className="text-[12px] text-white/35 text-center py-10">{t("room.myRoomsEmpty")}</p>)}
            {roomList.map((rp) => (<RoomCard key={rp.roomId} rp={rp} onOpen={() => openRoom(rp.roomId)}/>))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>);
    function RoomCard({ rp, onOpen }) {
        const runningish = rp.status === "active" || rp.status === "final_table" || rp.status === "starting";
        return (<button className="w-full text-left rounded-2xl bg-black/30 border border-white/10 p-3 space-y-1.5 hover:bg-black/40 transition" onClick={onOpen} data-testid={`room-card-${rp.roomId.slice(0, 8)}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[13px] font-bold truncate">{rp.name}</div>
            <div className="text-[10.5px] text-white/45 font-mono truncate">{rp.roomId.slice(0, 14)}…</div>
          </div>
          <span className="flex items-center gap-1.5 text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-white/8 text-white/65 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[rp.status] ?? "bg-white/40"}`}/>
            {t(`room.status.${rp.status}`)}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-white/50 tabular-nums">
          <span>{t("tour.registered", { n: rp.counts.registered, m: rp.maxPlayers })}</span>
          {runningish && <span>{t("room.remaining", { n: rp.counts.remaining })}</span>}
          <span>{t("tour.prizePool")} {fmt(rp.prizePool, lang)}</span>
          {rp.myStatus && rp.myStatus !== "spectator" && (<span className="text-[var(--brand)] font-bold">{t(`room.myStatus.${rp.myStatus}`, { defaultValue: rp.myStatus })}</span>)}
        </div>
      </button>);
    }
}
