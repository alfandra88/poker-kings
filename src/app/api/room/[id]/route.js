import { NextResponse } from "next/server";
const ROOM_ID_RE = /^[0-9a-fA-F]{40}$/;
export async function GET(_req, { params }) {
    const { id } = await params;
    const roomId = String(id ?? "").toLowerCase();
    if (!ROOM_ID_RE.test(roomId)) {
        return NextResponse.json({ ok: false, error: "bad_room_id" }, { status: 400 });
    }
    // The contest runner lives in server.js's process; see globalThis.__pokerSquares.
    const realtime = globalThis.__pokerSquares;
    if (!realtime) {
        return NextResponse.json({ ok: false, error: "service_unavailable" }, { status: 503 });
    }
    const room = realtime.publicContest(roomId);
    if (!room) {
        return NextResponse.json({ ok: false, error: "room_not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, room }, { headers: { "Cache-Control": "no-store" } });
}
