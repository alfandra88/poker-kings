"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoker, loadLangFromStorage } from "@/lib/poker/store";
import { fmt, langMeta } from "@/lib/poker/i18n";
import { ProfileDialog } from "./ProfileDialog.jsx";
import { ContestDialog } from "./ContestDialog.jsx";
import { LeaderboardDialog } from "./LeaderboardDialog.jsx";
import { TutorialDialog } from "./TutorialDialog.jsx";
import { LanguageDialog } from "./LanguageDialog.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from "@/components/ui/accordion";
const CONSENT_KEY = "pokerkings.consent.v2";
export function HomeView() {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const setLang = usePoker((s) => s.setLang);
    const me = usePoker((s) => s.me);
    const connected = usePoker((s) => s.connected);
    const joinTable = usePoker((s) => s.joinTable);
    const ensureAuthed = usePoker((s) => s.ensureAuthed);
    const quickPlay = usePoker((s) => s.quickPlay);
    const [consent, setConsent] = useState(true);
    const [createOpen, setCreateOpen] = useState(false);
    const [joinOpen, setJoinOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [tourOpen, setTourOpen] = useState(false);
    const [lbOpen, setLbOpen] = useState(false);
    const [tutOpen, setTutOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    useEffect(() => {
        const id = setTimeout(() => {
            const saved = loadLangFromStorage();
            if (saved)
                setLang(saved);
            setConsent(localStorage.getItem(CONSENT_KEY) === "1");
        }, 0);
        return () => clearTimeout(id);
    }, [setLang]);
    useEffect(() => {
        void ensureAuthed();
    }, [ensureAuthed]);
    const acceptConsent = () => {
        localStorage.setItem(CONSENT_KEY, "1");
        setConsent(true);
    };
    return (<div className="min-h-[100dvh] flex flex-col bg-transparent text-[var(--text-1)]">
      {/* header */}
      {/* R6 — safe-area top padding (notched phones); inner row keeps h-14 */}
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[color-mix(in_srgb,var(--bg-0)_72%,transparent)] backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-5xl px-3 sm:px-4 h-14 flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-base sm:text-lg font-black tracking-tight flex items-center gap-2 shrink-0">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4bcfff] to-[var(--brand-deep)] text-[#02151c] flex items-center justify-center text-[13px] shadow-[0_4px_14px_rgba(39, 190, 245, 0.4)]">♠</span>
            POKER&nbsp;<span className="text-gradient-brand">KINGS</span>
          </span>
          <div className="flex-1"/>
          {me && (<button className="btn-ghost rounded-full pl-1.5 pr-3 py-1 flex items-center gap-2 min-w-0 min-h-9" onClick={() => setProfileOpen(true)} data-testid="btn-profile">
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4bcfff] to-[var(--brand-deep)] text-[#02151c] text-[11px] font-black flex items-center justify-center shadow-[0_2px_8px_rgba(39, 190, 245, 0.35)] shrink-0">
                {me.username.slice(0, 2).toUpperCase()}
              </span>
              {/* points truncate and the level tag hides at 380px and below so
                the header never overflows a 360px viewport */}
              <span className="text-[12px] font-bold text-gradient-gold tabular-nums max-w-[72px] sm:max-w-none truncate" data-testid="header-points">{t("table.pts", { n: fmt(me.stats?.total ?? 0, lang) })}</span>
              <span className="text-[10px] text-white/50 hidden min-[380px]:inline">Lv{me.level}</span>
            </button>)}
          <button className="btn-ghost rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] font-bold shrink-0 min-h-9" onClick={() => setLangOpen(true)} aria-label={t("common.language")} data-testid="btn-language">
            <span aria-hidden>🌐</span>
            <span className="max-w-[44px] sm:max-w-[72px] truncate">{langMeta(lang).native}</span>
          </button>
          <ThemeToggle testid="btn-theme"/>
        </div>
      </header>

      <main className="flex-1">
        {/* hero */}
        <section className="relative overflow-hidden">
          <div className="hero-orb hero-orb-1" aria-hidden/>
          <div className="hero-orb hero-orb-2" aria-hidden/>
          <div className="hero-orb hero-orb-3" aria-hidden/>
          <span className="suit-float" style={{ left: "8%", top: "22%", animationDelay: "-1s" }} aria-hidden>♠</span>
          <span className="suit-float" style={{ left: "15%", top: "64%", animationDelay: "-3s" }} aria-hidden>♥</span>
          <span className="suit-float" style={{ right: "11%", top: "30%", animationDelay: "-2s" }} aria-hidden>♦</span>
          <span className="suit-float" style={{ right: "19%", top: "70%", animationDelay: "-4.5s" }} aria-hidden>♣</span>
          <span className="suit-float" style={{ left: "47%", top: "10%", animationDelay: "-6s" }} aria-hidden>★</span>
          <div className="mx-auto max-w-5xl px-4 py-16 sm:py-24 text-center relative">
            <div className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5 mb-6 anim-pop">
              <span className="w-2 h-2 rounded-full bg-[var(--brand)] anim-pulse"/>
              <span className="text-[10.5px] font-bold tracking-[0.18em] uppercase text-white/70">{t("app.tagline")}</span>
            </div>
            <h1 className="text-4xl sm:text-6xl font-black leading-[1.08] tracking-tight anim-pop">
              {t("app.hero.title")}
            </h1>
            <p className="mt-4 text-[15px] sm:text-lg text-white/60 max-w-xl mx-auto">
              {t("app.hero.sub")}
            </p>

            <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button className="w-full sm:w-auto btn-brand rounded-2xl font-black text-base px-9 py-4 disabled:opacity-50" onClick={() => setCreateOpen(true)} disabled={!connected || creating} data-testid="btn-open-create">
                {t("home.createTitle")}
              </button>
              <button className="w-full sm:w-auto btn-ghost rounded-2xl font-bold text-base px-9 py-4" onClick={() => setJoinOpen(true)} disabled={!connected} data-testid="btn-open-join">
                {t("home.joinTitle")}
              </button>
            </div>

            {/* one-tap AI table — play without waiting for real players */}
            <div className="mt-5 max-w-md mx-auto">
              <button className="w-full shimmer-border rounded-2xl bg-[rgba(13, 177, 236, 0.07)] hover:bg-[rgba(13, 177, 236, 0.14)] px-5 py-3.5 transition disabled:opacity-50 text-left" onClick={() => {
            setCreating(true);
            void quickPlay().finally(() => setCreating(false));
        }} disabled={!connected || creating} data-testid="btn-quick-play">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-black text-gradient-gold">⚡ {t("home.playNow")}</span>
                  <span className="ml-auto text-[10px] font-black uppercase tracking-wider text-black bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] rounded-full px-2 py-0.5 shadow-[0_2px_10px_rgba(13, 177, 236, 0.4)]">{t("home.playNowBadge")}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-white/50 leading-snug">{t("home.playNowSub")}</p>
              </button>
            </div>
            {!connected && <p className="mt-3 text-[12px] text-white/40">{t("home.connecting")}</p>}

            <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-[12px] font-semibold text-white/75">
              <button className="btn-ghost rounded-full px-4 py-2" onClick={() => setTourOpen(true)}>🏆 {t("common.contests")}</button>
              <button className="btn-ghost rounded-full px-4 py-2" onClick={() => setLbOpen(true)}>🏅 {t("common.leaderboard")}</button>
              <button className="btn-ghost rounded-full px-4 py-2" onClick={() => setTutOpen(true)}>🎓 {t("common.tutorial")}</button>
            </div>
          </div>
        </section>

        {/* features */}
        <section className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-9">{t("home.features")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (<div key={i} className="modern-card p-5">
                <div className="icon-badge mb-3" aria-hidden>{["🔗", "💬", "🃏", "🏆", "🛡️", "⭐"][i - 1]}</div>
                <h3 className="font-bold text-[15px] mb-1">{t(`home.f${i}.title`)}</h3>
                <p className="text-[12.5px] text-white/55 leading-relaxed">{t(`home.f${i}.desc`)}</p>
              </div>))}
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-10">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-6">{t("faq.title")}</h2>
          <Accordion type="single" collapsible className="glass rounded-2xl px-4">
            {[1, 2, 3, 4].map((i) => (<AccordionItem key={i} value={`q${i}`}>
                <AccordionTrigger className="text-[14px] font-semibold text-white/90">
                  {t(`faq.q${i}`)}
                </AccordionTrigger>
                <AccordionContent className="text-[13px] text-white/60 leading-relaxed">
                  {t(`faq.a${i}`)}
                </AccordionContent>
              </AccordionItem>))}
          </Accordion>
        </section>
      </main>

      {/* footer */}
      <footer className="border-t border-white/8 mt-auto">
        <div className="mx-auto max-w-5xl px-4 py-6 text-center">
          <p className="text-[11px] text-white/40 leading-relaxed max-w-2xl mx-auto">{t("app.disclaimer")}</p>
          <p className="mt-2 text-[10px] text-white/25">{t("app.footer")}</p>
        </div>
      </footer>

      {/* consent banner */}
      {!consent && (<div className="fixed bottom-0 inset-x-0 z-50 glass-strong border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" data-testid="consent-banner">
          <div className="mx-auto max-w-3xl flex flex-col sm:flex-row items-center gap-3">
            <p className="text-[11.5px] text-white/60 flex-1 text-center sm:text-left">{t("app.consent")}</p>
            <button className="btn-brand rounded-xl text-[12px] font-black px-5 py-2 shrink-0" onClick={acceptConsent}>
              {t("common.gotIt")}
            </button>
          </div>
        </div>)}

      <CreateDialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); }} onCreating={setCreating} defaultName={me?.username ?? ""}/>
      <JoinDialog open={joinOpen} onOpenChange={setJoinOpen} onJoin={joinTable}/>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen}/>
      <ContestDialog open={tourOpen} onOpenChange={setTourOpen}/>
      <LeaderboardDialog open={lbOpen} onOpenChange={setLbOpen}/>
      <TutorialDialog open={tutOpen} onOpenChange={setTutOpen}/>
      <LanguageDialog open={langOpen} onOpenChange={setLangOpen}/>
    </div>);
}
function Choice({ value, options, onChange, render, testid }) {
    return (<div className="flex gap-1 mt-1">
      {options.map((v) => (<button key={String(v)} type="button" className={`flex-1 rounded-lg py-2 text-[11px] font-bold transition-all ${value === v ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => onChange(v)} data-testid={testid ? `${testid}-${v}` : undefined}>
          {render ? render(v) : v}
        </button>))}
    </div>);
}
function CreateDialog({ open, onOpenChange, onCreating, defaultName, }) {
    const t = usePoker((s) => s.t);
    const createTable = usePoker((s) => s.createTable);
    const emit = usePoker((s) => s.emit);
    const router = useRouter();
    const [kind, setKind] = useState("table");
    const [name, setName] = useState("");
    const [timer, setTimer] = useState(15);
    const [maxPlayers, setMaxPlayers] = useState(8);
    const [bots, setBots] = useState(3);
    const [botDiff, setBotDiff] = useState("normal");
    const [approve, setApprove] = useState(false);
    const [password, setPassword] = useState("");
    const [rounds, setRounds] = useState(5);
    const [limit, setLimit] = useState(16);
    const [startMode, setStartMode] = useState("immediate");
    const [advanced, setAdvanced] = useState(false);
    const [busy, setBusy] = useState(false);
    const owner = defaultName.trim() || "Poker Kings";
    const run = async (fn) => {
        if (busy)
            return;
        setBusy(true);
        onCreating(true);
        try {
            await fn();
        }
        finally {
            setBusy(false);
            onCreating(false);
        }
    };
    const createPlainTable = () => run(async () => {
        const code = await createTable({
            name: name.trim() || t("create.defaultTableName", { name: owner }),
            timerSec: timer,
            maxPlayers,
            approveJoin: approve,
            password: password || null,
            botsYieldSeats: true,
            botDifficulty: botDiff,
        }, Math.min(bots, maxPlayers - 1));
        if (code)
            onOpenChange(false);
    });
    const createContest = () => run(async () => {
        const res = await emit("room:create", {
            name: name.trim() || t("create.defaultContestName", { name: owner }),
            rounds,
            maxPlayers: limit,
            startMode,
            timerSec: timer,
            botCount: bots,
            botDifficulty: botDiff,
        });
        if (res?.ok && typeof res.roomId === "string") {
            onOpenChange(false);
            router.push(`/room/${res.roomId}`);
        }
        else if (res && res.error !== "account_required") {
            usePoker.getState().toast("error", t("error.generic"));
        }
    });
    const botMax = kind === "table" ? maxPlayers - 1 : 7;
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-md max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white/95 text-center">{t("home.createTitle")}</DialogTitle>
          <DialogDescription className="text-center text-white/50">{t("home.createSub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="flex gap-1.5">
            <button className={`flex-1 rounded-xl py-2.5 text-[12px] font-black transition-all ${kind === "table" ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setKind("table")} data-testid="kind-table">
              🃏 {t("create.kindTable")}
            </button>
            <button className={`flex-1 rounded-xl py-2.5 text-[12px] font-black transition-all ${kind === "contest" ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setKind("contest")} data-testid="kind-contest">
              🏆 {t("create.kindContest")}
            </button>
          </div>
          <p className="text-[11px] text-white/50 leading-relaxed">{t(kind === "table" ? "create.kindTableDesc" : "create.kindContestDesc")}</p>

          <div>
            <Label className="text-white/70 text-[12px]">{t(kind === "table" ? "create.name" : "contest.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t(kind === "table" ? "create.defaultTableName" : "create.defaultContestName", { name: owner })} className="bg-black/40 border-white/15 text-white/90 mt-1" data-testid="input-name"/>
          </div>

          {kind === "contest" && (<div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-[12px]">{t("contest.rounds")}</Label>
                <Choice value={rounds} options={[3, 5, 10]} onChange={setRounds} testid="rounds"/>
              </div>
              <div>
                <Label className="text-white/70 text-[12px]">{t("create.maxPlayers")}</Label>
                <Choice value={limit} options={[8, 16, 32, 64]} onChange={setLimit}/>
              </div>
            </div>)}

          {kind === "contest" && (<div className="rounded-2xl bg-black/30 border border-white/10 p-3 space-y-2" data-testid="startmode-section">
              <Label className="text-white/85 text-[12px] font-bold">{t("contest.startMode")}</Label>
              <Choice value={startMode} options={["immediate", "manual"]} onChange={setStartMode} render={(m) => t(`room.mode.${m}`)}/>
              <p className="text-[10.5px] text-white/45 leading-relaxed">{t(`room.mode.${startMode}.desc`)}</p>
            </div>)}

          {kind === "table" && (<div>
              <Label className="text-white/70 text-[12px]">{t("create.maxPlayers")}</Label>
              <Choice value={maxPlayers} options={[2, 4, 6, 8]} onChange={(v) => {
                setMaxPlayers(v);
                setBots((b) => Math.min(b, v - 1));
            }}/>
            </div>)}

          <div className="rounded-2xl bg-black/30 border border-[var(--brand)]/25 p-3 space-y-2.5" data-testid="ai-section">
            <div className="flex items-center justify-between">
              <Label className="text-white/85 text-[12px] font-bold">🤖 {t("create.bots")}</Label>
              <span className="text-gradient-brand font-black text-[14px] tabular-nums" data-testid="bot-count">{bots}</span>
            </div>
            <input type="range" min={0} max={botMax} value={Math.min(bots, botMax)} onChange={(e) => setBots(parseInt(e.target.value, 10))} className="w-full accent-[var(--brand)]" aria-label={t("create.bots")} data-testid="bot-slider"/>
            {bots > 0 && (<div className="flex items-center justify-between gap-2">
                <Label className="text-white/70 text-[12px]">{t("create.botDifficulty")}</Label>
                <div className="flex gap-1">
                  {["easy", "normal", "hard"].map((d) => (<button key={d} className={`rounded-lg px-2 py-1 text-[10.5px] font-bold transition-all ${botDiff === d ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setBotDiff(d)}>
                      {t(`bot.${d}`)}
                    </button>))}
                </div>
              </div>)}
            <p className="text-[10.5px] text-white/45 leading-relaxed">{t("create.botsNote")}</p>
          </div>

          <div className="rounded-2xl bg-black/30 border border-white/10 p-3 space-y-2" data-testid="timer-section">
            <div className="flex items-center justify-between">
              <Label className="text-white/85 text-[12px] font-bold">⏱ {t("create.timer")}</Label>
              <span className="text-gradient-brand font-black text-[14px] tabular-nums" data-testid="timer-value">{t("table.timerSec", { n: timer })}</span>
            </div>
            <Choice value={timer} options={[10, 15, 30]} onChange={setTimer} render={(v) => t("table.timerSec", { n: v })} testid="timer"/>
            <p className="text-[10.5px] text-white/45 leading-relaxed">{t("create.timerHint")}</p>
          </div>

          {kind === "table" && (<>
              <button className="text-[11px] text-white/50 hover:text-white/80 underline underline-offset-2" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
                {t("create.options")} {advanced ? "−" : "+"}
              </button>
              {advanced && (<div className="space-y-2.5 rounded-2xl bg-black/30 p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-white/75 text-[12px]">{t("create.approve")}</Label>
                    <Switch checked={approve} onCheckedChange={setApprove}/>
                  </div>
                  <div>
                    <Label className="text-white/75 text-[12px]">{t("create.password")}</Label>
                    <Input value={password} onChange={(e) => setPassword(e.target.value)} maxLength={12} className="bg-black/40 border-white/15 text-white/90 mt-1"/>
                  </div>
                </div>)}
            </>)}

          <button className="w-full btn-brand rounded-2xl font-black py-3.5 text-[15px] tracking-wide disabled:opacity-50" onClick={kind === "table" ? createPlainTable : createContest} disabled={busy} data-testid={kind === "table" ? "btn-create-table" : "btn-create-contest"}>
            {t(kind === "table" ? "common.create" : "contest.create")}
          </button>
        </div>
      </DialogContent>
    </Dialog>);
}
function JoinDialog({ open, onOpenChange, onJoin, }) {
    const t = usePoker((s) => s.t);
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const join = async () => {
        if (!code.trim())
            return;
        setBusy(true);
        const ok = await onJoin(code, password.trim() || undefined);
        setBusy(false);
        if (ok)
            onOpenChange(false);
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-white/95 text-center">{t("home.joinTitle")}</DialogTitle>
          <DialogDescription className="text-center text-white/50">{t("home.joinSub")}</DialogDescription>
        </DialogHeader>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && join()} placeholder="7FXK2Q" maxLength={6} className="bg-black/40 border-white/15 text-white text-center text-2xl font-black tracking-[0.4em] uppercase focus-visible:ring-[var(--brand)]" data-testid="input-code"/>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && join()} placeholder={t("create.password")} maxLength={12} autoComplete="off" className="bg-black/40 border-white/15 text-white text-center text-[13px] focus-visible:ring-[var(--brand)]" data-testid="input-join-password"/>
        <button className="w-full btn-brand rounded-2xl font-black py-3 text-[15px]" onClick={join} disabled={code.trim().length < 4 || busy} data-testid="btn-join-table">
          {t("common.join")}
        </button>
      </DialogContent>
    </Dialog>);
}
