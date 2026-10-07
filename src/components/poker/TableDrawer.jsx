"use client";
import { useEffect, useRef, useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { fmt, formatHandLabel } from "@/lib/poker/i18n";
import { useKeyboardHeight } from "./useKeyboardHeight.js";
const EMOTES = ["🎉", "😂", "😱", "😭", "👏", "🤝", "🔥", "💀", "🤔", "💪", "✨", "🤠"];

function formatSystem(raw, t) {
    const [kind, a, b, c] = raw.split("|");
    switch (kind) {
        case "table_created":
            return `🪑 ${t("home.createTitle")} — ${a}`;
        case "sat_down":
            return `${a} ${t("table.sitHere")} — ${b}`;
        case "bot_joined":
            return `🤖 ${a} ${t("system.botJoined")}`;
        case "bot_left":
            return `🤖 ${a} ${t("system.botLeft")}`;
        case "blind_level":
            return `⬆ ${t("toast.level_up", { sb: b, bb: c })}`;
        case "reaction": {
            const icon = a === "nh" ? "👏" : a === "gg" ? "🤝" : a === "wp" ? "👍" : "✨";
            return `${icon} ${b} — ${a.toUpperCase()}`;
        }
        default:
            return raw;
    }
}
function cardText(c) {
    const R = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
    const S = ["♠", "♥", "♦", "♣"];
    return R[c >> 2] + S[c & 3];
}
export function TableDrawer({ forceOpen = false }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const tab = usePoker((s) => s.drawerTab);
    const open = usePoker((s) => s.drawerOpen);
    const chat = usePoker((s) => s.chat);
    const log = usePoker((s) => s.log);
    const ledger = usePoker((s) => s.ledger);
    const snap = usePoker((s) => s.snap);
    const emit = usePoker((s) => s.emit);
    const setStore = usePoker((s) => s.set);
    const toast = usePoker((s) => s.toast);
    const [text, setText] = useState("");
    const [expanded, setExpanded] = useState(null);
    const scrollRef = useRef(null);
    useKeyboardHeight();
    useEffect(() => {
        if (open && tab === "chat" && scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [chat, open, tab]);
    const send = async () => {
        const clean = text.trim();
        if (!clean)
            return;
        setText("");
        await emit("chat", { text: clean });
    };
    const exportCsv = () => {
        const rows = ["nickname,player_id,buy_in,buy_out,stack,net"];
        for (const r of ledger) {
            rows.push(`${r.nickname},${r.playerId},${r.buyIn},${r.buyOut},${r.stack},${r.net}`);
        }
        const blob = new Blob([rows.join("\n")], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `poker-kings-ledger-${snap?.code ?? "table"}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };
    const downloadLog = async () => {
        const res = (await emit("table:exportLog"));
        if (res?.ok && res.events) {
            const blob = new Blob([JSON.stringify(res.events, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `poker-kings-session-${snap?.code ?? "table"}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };
    if (!open && !forceOpen)
        return null;
    return (<>
      {/* backdrop (mobile) */}
      <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setStore({ drawerOpen: false })}/>
      <aside className={`${
        forceOpen ? "lg:z-20 lg:static lg:w-[340px] lg:max-w-none" : "lg:hidden"} fixed right-0 top-0 bottom-0 w-[88vw] max-w-[380px] z-50 glass-strong flex flex-col border-l border-white/10 anim-sheet`} data-testid="table-drawer">
        <div className="flex items-center gap-1 p-2 border-b border-white/10">
          {["chat", "log", "ledger"].map((k) => (<button key={k} className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${tab === k ? "seg-on" : "text-white/50 hover:text-white/85"}`} onClick={() => setStore({ drawerTab: k })}>
              {t(`table.${k}`)}
            </button>))}
          <button className="lg:hidden rounded-lg py-1.5 px-2.5 text-white/60 hover:text-white" onClick={() => setStore({ drawerOpen: false })} aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        {tab === "chat" && (<>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-1.5" data-testid="chat-messages">
              {chat.length === 0 && <p className="text-[12px] text-white/35 text-center pt-8">{t("chat.placeholder")}</p>}
              {chat.map((m) => m.kind === "system" ? (<div key={m.id} className="text-[11px] text-white/45 italic text-center">{formatSystem(m.text, t)}</div>) : (<div key={m.id} className={m.kind === "emote" ? "text-center py-1" : ""}>
                    {m.kind === "emote" ? (<span className="text-3xl" title={m.from ?? ""}>{m.text}</span>) : (<div className="text-[12.5px] leading-snug">
                        <span className="font-semibold text-[var(--brand)]">{m.from}: </span>
                        <span className={m.masked ? "text-white/50" : "text-white/85"}>{m.text}</span>
                      </div>)}
                  </div>))}
            </div>
            <div className="p-2 border-t border-white/10 space-y-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]" 

        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom, 0px), var(--kb, 0px))" }}>
              <div className="flex gap-1 overflow-x-auto pb-0.5">
                {EMOTES.map((e) => (<button key={e} className="rounded-lg hover:bg-white/10 px-1.5 py-1 text-lg leading-none transition-colors" onClick={() => emit("chat", { text: e, emote: true })}>
                    {e}
                  </button>))}
              </div>
              <div className="flex gap-1.5">
                {["nh", "gg", "gl", "om", "haha"].map((k) => (<button key={k} className="rounded-full bg-white/8 hover:bg-white/15 border border-white/10 px-2.5 py-1 text-[10.5px] text-white/80" onClick={() => emit("chat", { text: t(`chat.quick.${k}`) })}>
                    {t(`chat.quick.${k}`)}
                  </button>))}
              </div>
              <div className="flex gap-1.5">
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={t("chat.placeholder")} maxLength={280} className="flex-1 bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-base text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--brand)]" data-testid="chat-input"/>
                <button className="btn-brand rounded-xl px-4 text-[13px] font-bold" onClick={send} data-testid="chat-send">
                  {t("chat.send")}
                </button>
              </div>
            </div>
          </>)}

        {tab === "log" && (<div className="flex-1 overflow-y-auto p-3 space-y-1">
            <button className="mb-2 w-full rounded-lg bg-white/8 border border-white/10 py-1.5 text-[11px] font-semibold text-white/80 hover:bg-white/15" onClick={downloadLog}>
              {t("common.download")} session log (JSON)
            </button>
            {log.length === 0 && <p className="text-[12px] text-white/35 text-center pt-8">{t("ledger.empty")}</p>}
            {log.map((ev, i) => (<LogLine key={i} ev={ev} lang={lang} t={t}/>))}
          </div>)}

        {tab === "ledger" && (<div className="flex-1 overflow-y-auto p-3">
            <button className="mb-2 w-full btn-gold rounded-lg py-1.5 text-[11px] font-black" onClick={exportCsv} data-testid="ledger-export">
              {t("ledger.export")}
            </button>
            {ledger.length === 0 ? (<p className="text-[12px] text-white/35 text-center pt-8">{t("ledger.empty")}</p>) : (<div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_54px_54px_54px_54px] gap-1 text-[10px] uppercase tracking-wider text-white/40 px-1">
                  <span>{t("ledger.player")}</span>
                  <span className="text-right">{t("ledger.buyIn")}</span>
                  <span className="text-right">{t("ledger.buyOut")}</span>
                  <span className="text-right">{t("ledger.stack")}</span>
                  <span className="text-right">{t("ledger.net")}</span>
                </div>
                {ledger.map((r) => (<LedgerLine key={r.playerId} row={r} expanded={expanded === r.playerId} onToggle={() => setExpanded(expanded === r.playerId ? null : r.playerId)}/>))}
              </div>)}
          </div>)}
      </aside>
    </>);
}
function LedgerLine({ row, expanded, onToggle }) {
    const color = row.net > 0 ? "text-[var(--brand)]" : row.net < 0 ? "text-[var(--danger)]" : "text-white/70";
    return (<div className="rounded-xl bg-white/5 border border-white/8 overflow-hidden">
      <button className="w-full grid grid-cols-[1fr_54px_54px_54px_54px] gap-1 items-center px-1 py-1.5 text-[12px] hover:bg-white/5" onClick={onToggle}>
        <span className="font-semibold text-white/90 truncate text-left">{row.nickname}</span>
        <span className="text-right tabular-nums text-white/70">{fmt(row.buyIn, "en")}</span>
        <span className="text-right tabular-nums text-white/70">{fmt(row.buyOut, "en")}</span>
        <span className="text-right tabular-nums text-white/70">{fmt(row.stack, "en")}</span>
        <span className={`text-right tabular-nums font-bold ${color}`}>{row.net > 0 ? "+" : ""}{fmt(row.net, "en")}</span>
      </button>
      {expanded && row.movements.length > 0 && (<div className="px-3 py-2 border-t border-white/8 space-y-0.5">
          {row.movements.map((m, i) => (<div key={i} className="flex justify-between text-[11px] text-white/55">
              <span>{new Date(m.ts).toLocaleTimeString()} — {m.kind}{m.note ? ` (${m.note})` : ""}</span>
              <span className="tabular-nums">{fmt(m.amount, "en")}</span>
            </div>))}
        </div>)}
    </div>);
}
function LogLine({ ev, lang, t, }) {
    const e = ev;
    const snapSeat = usePoker.getState().snap?.seats;
    const nick = (seatId) => snapSeat?.find((s) => s?.seatId === seatId)?.nickname ?? `#${seatId}`;
    const label = (k) => ({ sb: "SB", bb: "BB", ante: "ante", straddle: "straddle", fold: "folds", check: "checks", call: "calls", bet: "bets", raise: "raises to", allin: "ALL-IN" }[k ?? ""] ?? k);
    switch (e.t) {
        case "hand_start":
            return <div className="text-[11px] text-[var(--gold)] font-semibold pt-2">{t("log.handStart", { n: e.handNo ?? 0, b: e.kind ?? "", s: e.seat ?? 0 })}</div>;
        case "post":
            return <div className="text-[11.5px] text-white/60">{t("log.post", { p: nick(e.seat), k: label(e.kind) ?? "", a: e.amount ?? 0 })}</div>;
        case "action":
            return <div className="text-[12px] text-white/85">{t("log.action", { p: nick(e.seat), k: label(e.kind) ?? "", a: e.to ?? e.amount ?? "" })}{e.by === "time" ? <span className="text-[var(--danger)] font-semibold"> · ⏱ {t("table.timeout")}</span> : null}</div>;
        case "street":
            return <div className="text-[11.5px] text-[var(--info)]">{t("log.street", { s: e.stage ?? "", c: (e.cards ?? []).map(cardText).join(" ") })}</div>;
        case "all_in_runout":
            return <div className="text-[11.5px] text-[var(--gold)]">ALL-IN runout — {e.stage}: {(e.cards ?? []).map(cardText).join(" ")}</div>;
        case "rit_deal":
            return <div className="text-[11.5px] text-white/60">{t("table.ritBoard")} — {(e.cards ?? []).map(cardText).join(" ")}</div>;
        case "showdown":
            return (<div className="text-[12px]">
          {(e.winners ?? []).map((w) => (<div key={w.seat} className="text-[var(--brand)]">
              {nick(w.seat)} — {formatHandLabel(lang, w.label)} — {fmt(w.amount, lang)}
            </div>))}
        </div>);
        case "payout":
            return (<div className="text-[12px] text-[var(--brand)] font-semibold">
          {(e.winners ?? []).map((w) => (<div key={w.seat}>{t("log.payout", { p: nick(w.seat), a: fmt(w.amount, lang) })}</div>))}
        </div>);
        case "hand_end":
            // PRIVACY: raw seed is server-side only — the log shows the public commitment hash
            return <div className="text-[10.5px] text-white/35 pb-1">{t("log.handEnd", { n: e.handNo ?? 0, seed: (e.seedHash ?? "").slice(0, 12) })}</div>;
        case "rabbit":
            if (e.kind === "reveal")
                return <div className="text-[11.5px] text-white/60">🐇 {(e.cards ?? []).map(cardText).join(" ")}</div>;
            return null;
        case "reveal":
            return <div className="text-[11.5px] text-white/70">{nick(e.seat)} shows {(e.cards ?? []).map(cardText).join(" ")}</div>;
        default:
            return null;
    }
}
