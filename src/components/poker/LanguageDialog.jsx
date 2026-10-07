"use client";
import { useMemo, useState } from "react";
import { usePoker } from "@/lib/poker/store";
import { LANGS, isLang } from "@/lib/poker/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function LanguageDialog({ open, onOpenChange, }) {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const setLang = usePoker((s) => s.setLang);
    const [q, setQ] = useState("");
    const list = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle)
            return LANGS;
        return LANGS.filter((m) => m.native.toLowerCase().includes(needle) ||
            m.en.toLowerCase().includes(needle) ||
            m.code.startsWith(needle));
    }, [q]);
    const pick = (code) => {
        if (!isLang(code))
            return;         setLang(code);
        onOpenChange(false);
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-sm max-h-[85dvh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-white tracking-wide">🌐 {t("lang.pick")}</DialogTitle>
          <DialogDescription className="text-white/50"/>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("lang.search")} maxLength={24} className="bg-black/40 border-white/15 text-white shrink-0" data-testid="lang-search"/>
        <div className="overflow-y-auto min-h-0 -mx-1 px-1 space-y-1" data-testid="lang-list">
          {list.map((m) => (<button key={m.code} onClick={() => pick(m.code)} data-testid={`lang-${m.code}`} className={`w-full flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition border ${m.code === lang
                ? "bg-[var(--brand)]/15 border-[var(--brand)]/45"
                : "bg-white/4 border-white/8 hover:bg-white/10"}`}>
              <span className="text-[13.5px] font-bold flex-1 truncate">{m.native}</span>
              <span className="text-[10px] text-white/40 shrink-0">{m.en}</span>
              {m.code === lang && <span className="text-[var(--brand)] text-[13px] shrink-0">✓</span>}
            </button>))}
          {list.length === 0 && (<div className="text-white/40 text-[12px] text-center py-8">{t("lang.none")}</div>)}
        </div>
      </DialogContent>
    </Dialog>);
}
