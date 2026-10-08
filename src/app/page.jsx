"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePoker, setPendingJoinCode, isRoomIdShape } from "@/lib/poker/store";
import { HomeView } from "@/components/poker/HomeView";
import { TableView } from "@/components/poker/TableView";
import { PokerToaster } from "@/components/poker/PokerToaster";
function PokerKingsInner() {
    const view = usePoker((s) => s.view);
    const searchParams = useSearchParams();
    const router = useRouter();
    useEffect(() => {
        const t = searchParams.get("t");
        if (t && t.length >= 4) {
            const code = t.toUpperCase();
            const st = usePoker.getState();
            if (!st.authed)
                setPendingJoinCode(code);
            else if (st.tableCode !== code)
                void st.joinTable(code);
        }
        const r = (searchParams.get("r") ?? "").toLowerCase();
        if (isRoomIdShape(r)) {
            router.replace(`/room/${r}`);
        }
    }, [searchParams, router]);
    return (<>
      {view === "table" ? <TableView /> : <HomeView />}
      <PokerToaster />
    </>);
}
export default function PokerKingsPage() {
    return (<Suspense fallback={<div className="min-h-[100dvh] bg-[var(--bg-0)]"/>}>
      <PokerKingsInner />
    </Suspense>);
}
