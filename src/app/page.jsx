"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePoker, setPendingJoinCode, isRoomIdShape } from "@/lib/poker/store";
import { HomeView } from "@/components/poker/HomeView";
import { TableView } from "@/components/poker/TableView";
import { RoomPanel } from "@/components/poker/RoomView";
import { PokerToaster } from "@/components/poker/PokerToaster";
function PokerKingsInner() {
    const view = usePoker((s) => s.view);
    const room = usePoker((s) => s.room);
    const searchParams = useSearchParams();
    const router = useRouter();
    useEffect(() => {
        const t = searchParams.get("t");
        if (t && t.length >= 4) {
            setPendingJoinCode(t.toUpperCase());
        }
        const r = (searchParams.get("r") ?? "").toLowerCase();
        if (isRoomIdShape(r)) {
            router.replace(`/room/${r}`);
        }
    }, [searchParams, router]);
    const roomOpen = view === "room";
    const roomId = room?.roomId ?? "";
    return (<>
      {view === "table" ? <TableView /> : roomOpen && roomId ? <RoomPanel roomId={roomId}/> : <HomeView />}
      <PokerToaster />
    </>);
}
export default function PokerKingsPage() {
    return (<Suspense fallback={<div className="min-h-[100dvh] bg-[var(--bg-0)]"/>}>
      <PokerKingsInner />
    </Suspense>);
}
