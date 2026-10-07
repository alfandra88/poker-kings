import { NextResponse } from "next/server";
const ROOM_ID_RE = /^[0-9a-fA-F]{40}$/;
export async function GET(_req, { params }) {
    const { id } = await params;
    const roomId = String(id ?? "").toLowerCase();
    if (!ROOM_ID_RE.test(roomId)) {
        return NextResponse.json({ ok: false, error: "bad_room_id" }, { status: 400 });
    }
    try {
        const port = process.env.POKER_REST_PORT ?? "44448";
        const res = await fetch(`http://127.0.0.1:${port}/room/${roomId}`, {
            cache: "no-store",
            signal: AbortSignal.timeout(4000),
        });
        const data = await res.json().catch(() => null);
        if (!data || data.ok !== true) {
            return NextResponse.json({ ok: false, error: data?.error ?? "room_not_found" }, { status: 404 });
        }
        return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    }
    catch {
        return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
    }
}
