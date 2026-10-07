"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePoker, loadLangFromStorage } from "@/lib/poker/store";
import { RoomPanel } from "@/components/poker/RoomView";
import { PokerToaster } from "@/components/poker/PokerToaster";
const ROOM_ID_RE = /^[0-9a-f]{40}$/;
export default function PublicRoomPage() {
    const params = useParams();
    const raw = Array.isArray(params?.id) ? params?.id?.[0] : params?.id;
    const roomId = String(raw ?? "").toLowerCase();
    const valid = ROOM_ID_RE.test(roomId);
    const setLang = usePoker((s) => s.setLang);
    const lang = usePoker((s) => s.lang);
    const t = usePoker((s) => s.t);
    const [hydrated, setHydrated] = useState(false);
    const tag = hydrated ? t("room.publicPage") : "Tournament Room";
    void lang;     useEffect(() => {
        const id = setTimeout(() => {
            const saved = loadLangFromStorage();
            if (saved)
                setLang(saved);
            setHydrated(true);
        }, 0);
        return () => clearTimeout(id);
    }, [setLang]);
    return (<div className="min-h-[100dvh]">
      <div className="sticky top-0 z-50 border-b border-white/8 bg-[color-mix(in_srgb,var(--bg-0)_72%,transparent)] backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-5xl px-4 h-12 flex items-center gap-3">
          <Link href="/" className="text-[15px] font-black tracking-tight flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-gradient-to-br from-[#4bcfff] to-[var(--brand-deep)] text-[#02151c] flex items-center justify-center text-[11px] shadow-[0_4px_14px_rgba(39, 190, 245, 0.4)]">♠</span>
            POKER&nbsp;<span className="text-gradient-brand">KINGS</span>
          </Link>
          <span className="ml-auto text-[10px] font-bold uppercase tracking-[0.14em] text-white/45" data-testid="room-page-tag">
            {tag}
          </span>
        </div>
      </div>

      {valid ? (<RoomPanel roomId={roomId} standalone/>) : (<div className="min-h-[70dvh] flex flex-col items-center justify-center text-center px-4 gap-3">
          <p className="text-4xl" aria-hidden>🃏</p>
          <p className="font-black text-[15px]">Invalid Room ID</p>
          <p className="text-[12px] text-white/50 max-w-sm">
            A Room ID is a 40-character hexadecimal identifier (the same length as an EVM address without the 0x prefix).
          </p>
          <Link href="/" className="btn-brand rounded-xl px-5 py-2.5 text-[12.5px] font-black mt-2">
            ← Poker Kings
          </Link>
        </div>)}

      <PokerToaster />
    </div>);
}
