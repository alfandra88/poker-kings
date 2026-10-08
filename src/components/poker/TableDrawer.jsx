"use client";
import { useEffect, useRef, useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { useKeyboardHeight } from "./useKeyboardHeight.js";
const EMOTES = ["🎉", "😂", "😱", "😭", "👏", "🤝", "🔥", "💀", "🤔", "💪", "✨", "🤠"];

function formatSystem(raw, t) {
    const [kind, a] = raw.split("|");
    switch (kind) {
        case "table_created":
            return `🪑 ${t("system.tableCreated", { name: a })}`;
        case "sat_down":
            return t("system.satDown", { name: a });
        case "bot_joined":
            return `🤖 ${a} ${t("system.botJoined")}`;
        case "bot_left":
            return `🤖 ${a} ${t("system.botLeft")}`;
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
    const tab = usePoker((s) => s.drawerTab);
    const open = usePoker((s) => s.drawerOpen);
    const chat = usePoker((s) => s.chat);
    const log = usePoker((s) => s.log);
    const myLog = usePoker((s) => s.myLog);
    const snap = usePoker((s) => s.snap);
    const emit = usePoker((s) => s.emit);
    const setStore = usePoker((s) => s.set);
    const [text, setText] = useState("");
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
          {["chat", "log"].map((k) => (<button key={k} className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all ${tab === k ? "seg-on" : "text-white/50 hover:text-white/85"}`} onClick={() => setStore({ drawerTab: k })}>
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
              {t("log.download")}
            </button>
            {log.length === 0 && <p className="text-[12px] text-white/35 text-center pt-8">{t("log.empty")}</p>}
            {[...log, ...myLog].sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0)).map((ev, i) => (<LogLine key={i} ev={ev} t={t}/>))}
          </div>)}

      </aside>
    </>);
}
function LogLine({ ev, t }) {
    const snap = usePoker.getState().snap;
    const name = (id) => snap?.players.find((p) => p.id === id)?.username ?? "?";
    switch (ev.t) {
        case "round_start":
            return <div className="text-[11px] text-[var(--gold)] font-semibold pt-2">{t("log.roundStart", { n: ev.round ?? 0, hash: (ev.seedHash ?? "").slice(0, 12) })}</div>;
        case "deal":
            return <div className="text-[11.5px] text-white/60">{t("log.deal", { n: (ev.index ?? 0) + 1, card: cardText(ev.card) })}</div>;
        case "place":
            return (<div className="text-[11.5px] text-white/85">
          {t("log.place", { card: cardText(ev.card), row: Math.floor(ev.cell / 5) + 1, col: (ev.cell % 5) + 1 })}
          {ev.by === "time" ? <span className="text-[var(--danger)] font-semibold"> · ⏱ {t("log.timeUp")}</span> : null}
        </div>);
        case "round_end":
            return (<div className="text-[12px] text-[var(--brand)] font-semibold">
          {(ev.results ?? []).map((r) => (<div key={r.id}>{t("log.result", { place: r.place, name: name(r.id), n: r.points })}</div>))}
        </div>);
        case "seed_reveal":
            return <div className="text-[10.5px] text-white/35 pb-1">{t("log.seed", { n: ev.round ?? 0, seed: ev.seed ?? "" })}</div>;
        default:
            return null;
    }
}
