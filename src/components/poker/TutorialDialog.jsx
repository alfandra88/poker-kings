"use client";
import { usePoker } from "@/lib/poker/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
export function TutorialDialog({ open, onOpenChange }) {
    const t = usePoker((s) => s.t);
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-2)] border-white/10 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">🎓 {t("tut.title")}</DialogTitle>
          <DialogDescription className="text-white/50"/>
        </DialogHeader>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (<div key={i} className="rounded-2xl bg-black/30 border border-white/10 p-4">
              <div className="font-bold text-[14px] mb-1">{t(`tut.s${i}.title`)}</div>
              <p className="text-[12.5px] text-white/60 leading-relaxed">{t(`tut.s${i}.desc`)}</p>
            </div>))}
        </div>
      </DialogContent>
    </Dialog>);
}