"use client";
import { usePoker } from "@/lib/poker/store";
const KIND_STYLE = {
    info: "border-white/20 bg-[var(--bg-2)]",
    success: "border-[var(--brand)]/50 bg-[var(--bg-2)]",
    warn: "border-[var(--gold)]/60 bg-[var(--bg-2)]",
    error: "border-[var(--danger)]/60 bg-[var(--bg-2)]",
};
export function PokerToaster() {
    const toasts = usePoker((s) => s.toasts);
    const dismiss = usePoker((s) => s.dismissToast);
    if (toasts.length === 0)
        return null;
    return (<div className="fixed left-1/2 -translate-x-1/2 z-[80] space-y-2 w-[92vw] max-w-sm pointer-events-none" style={{ top: "calc(env(safe-area-inset-top, 0px) + 3.75rem)" }} data-testid="toaster">
      {toasts.map((t) => (<button key={t.id} className={`pointer-events-auto w-full text-left rounded-2xl border px-4 py-2.5 text-[12.5px] font-medium text-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur anim-sheet ${KIND_STYLE[t.kind]}`} onClick={() => dismiss(t.id)}>
          {t.kind === "success" ? "✓ " : t.kind === "error" ? "⚠ " : t.kind === "warn" ? "! " : ""}
          {t.text}
        </button>))}
    </div>);
}
