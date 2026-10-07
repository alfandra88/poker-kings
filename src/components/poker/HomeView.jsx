"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePoker, loadLangFromStorage } from "@/lib/poker/store";
import { fmt, langMeta } from "@/lib/poker/i18n";
import { ProfileDialog } from "./ProfileDialog.jsx";
import { TournamentDialog } from "./TournamentDialog.jsx";
import { LeaderboardDialog } from "./LeaderboardDialog.jsx";
import { TutorialDialog } from "./TutorialDialog.jsx";
import { LanguageDialog } from "./LanguageDialog.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from "@/components/ui/accordion";
const CONSENT_KEY = "pokerkings.consent.v1";
export function HomeView() {
    const t = usePoker((s) => s.t);
    const lang = usePoker((s) => s.lang);
    const setLang = usePoker((s) => s.setLang);
    const me = usePoker((s) => s.me);
    const connected = usePoker((s) => s.connected);
    const createTable = usePoker((s) => s.createTable);
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
                {me.nickname.slice(0, 2).toUpperCase()}
              </span>
              {/* R11 — chips truncate and the level tag hides ≤380px so the
                header can never overflow a 360px viewport */}
              <span className="text-[12px] font-bold text-gradient-gold tabular-nums max-w-[56px] sm:max-w-none truncate">{fmt(me.chips, lang)}</span>
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
                  <span className="ml-auto text-[10px] font-black uppercase tracking-wider text-black bg-gradient-to-b from-[var(--gold-bright)] to-[var(--gold)] rounded-full px-2 py-0.5 shadow-[0_2px_10px_rgba(13, 177, 236, 0.4)]">5 AI</span>
                </div>
                <p className="mt-0.5 text-[11px] text-white/50 leading-snug">{t("home.playNowSub")}</p>
              </button>
            </div>
            {!connected && <p className="mt-3 text-[12px] text-white/40">{t("home.connecting")}</p>}

            <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-[12px] font-semibold text-white/75">
              <button className="btn-ghost rounded-full px-4 py-2" onClick={() => setTourOpen(true)}>🏆 {t("common.tournaments")}</button>
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
                <div className="icon-badge mb-3" aria-hidden>{["🔗", "💬", "🃏", "🏆", "🛡️", "🎁"][i - 1]}</div>
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
          <p className="mt-2 text-[10px] text-white/25">Poker Kings · Free to play · Play responsibly · No real money, ever</p>
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

      <CreateDialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); }} onCreating={setCreating} defaultNick={me?.nickname ?? ""}/>
      <JoinDialog open={joinOpen} onOpenChange={setJoinOpen} onJoin={joinTable}/>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen}/>
      <TournamentDialog open={tourOpen} onOpenChange={setTourOpen}/>
      <LeaderboardDialog open={lbOpen} onOpenChange={setLbOpen}/>
      <TutorialDialog open={tutOpen} onOpenChange={setTutOpen}/>
      <LanguageDialog open={langOpen} onOpenChange={setLangOpen}/>
    </div>);
}
function CreateDialog({ open, onOpenChange, onCreating, defaultNick, }) {
    const t = usePoker((s) => s.t);
    const createTable = usePoker((s) => s.createTable);
    const setNickname = usePoker((s) => s.setNickname);
    const emit = usePoker((s) => s.emit);
    const router = useRouter();
    const [kind, setKind] = useState("room");
    const [nickInput, setNick] = useState(null);
    const nick = nickInput ?? defaultNick;
    const [name, setName] = useState("");
    const [variant, setVariant] = useState("nlhe");
    const [maxPlayers, setMaxPlayers] = useState(16);

    const [unlimited, setUnlimited] = useState(false);

    const [customMax, setCustomMax] = useState("");
    const [seatsPerTable, setSeatsPerTable] = useState(8);
    const [stack, setStack] = useState(10000);

    const [customStack, setCustomStack] = useState("");
    const [entryFee, setEntryFee] = useState(0);
    const [turnSec, setTurnSec] = useState(15);
    const [levelMin, setLevelMin] = useState(5);
    const [turbo, setTurbo] = useState(true);
    const [rebuys, setRebuys] = useState(0);
    const [lateJoin, setLateJoin] = useState(false);
    const [startMode, setStartMode] = useState("immediate");
    const [requiredPlayers, setRequiredPlayers] = useState(16);
    const [minPlayers, setMinPlayers] = useState(8);
    const [startAtLocal, setStartAtLocal] = useState("");
    const [fallback, setFallback] = useState("keep_waiting");
    const [bb, setBb] = useState(20);
    const [seats, setSeats] = useState(9);
    const [bots, setBots] = useState(3);
    const [botDiff, setBotDiff] = useState("normal");
    const [timer, setTimer] = useState(15);
    const [timeBank, setTimeBank] = useState(0);
    const [straddle, setStraddle] = useState(false);
    const [rit, setRit] = useState(true);
    const [rabbit, setRabbit] = useState(true);
    const [approve, setApprove] = useState(false);
    const [password, setPassword] = useState("");
    const [advanced, setAdvanced] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const cap = unlimited ? 500 : maxPlayers;
        if (requiredPlayers > cap)
            setRequiredPlayers(cap);
        if (minPlayers > cap)
            setMinPlayers(cap);
        if (requiredPlayers < 2)
            setRequiredPlayers(2);
        if (minPlayers < 2)
            setMinPlayers(2);
    }, [maxPlayers, requiredPlayers, minPlayers, unlimited]);

    const effectiveMaxPlayers = () => {
        if (unlimited)
            return 0;         const parsed = Number.parseInt(customMax, 10);
        if (!Number.isFinite(parsed))
            return maxPlayers;
        return Math.max(2, Math.min(200, parsed));
    };

    const effectiveStack = () => {
        const parsed = Number.parseInt(customStack, 10);
        if (!Number.isFinite(parsed))
            return stack;
        return Math.max(500, Math.min(10_000_000, parsed));
    };

    const computeStartsAt = () => {
        if (!startAtLocal)
            return null;
        const ms = new Date(startAtLocal).getTime();
        return Number.isFinite(ms) ? ms : null;
    };
    const createRoom = async () => {
        if (!nick.trim() || busy)
            return;
        setBusy(true);
        onCreating(true);
        try {
            await setNickname(nick.trim());
            const startsAt = computeStartsAt();
            const effMax = effectiveMaxPlayers();
            const res = await emit("room:create", {
                name: name.trim() || `${nick.trim()}'s Tournament`,
                variant,
                maxPlayers: effMax,
                unlimited,
                seatsPerTable,
                startingStack: effectiveStack(),
                entryFee,
                levelSec: levelMin * 60,
                turbo,
                rebuys,
                turnSec,
                lateJoin,
                startMode,
                requiredPlayers: startMode === "when_full" ? requiredPlayers : undefined,
                minPlayers: startMode === "scheduled_min" ? minPlayers : undefined,
                startsAt: startMode === "scheduled" || startMode === "scheduled_min" ? startsAt ?? undefined : undefined,
                fallback,
            });
            if (res?.ok && typeof res.roomId === "string") {
                onOpenChange(false);
                router.push(`/room/${res.roomId}`);
            }
            else {
                usePoker.getState().toast("error", t("error.generic"));
            }
        }
        finally {
            setBusy(false);
            onCreating(false);
        }
    };
    const createCash = async () => {
        if (!nick.trim() || busy)
            return;
        setBusy(true);
        onCreating(true);
        try {
            await setNickname(nick.trim());
            const code = await createTable({
                name: name.trim() || `${nick.trim()}'s Table`,
                variant,
                mode: "cash",
                maxSeats: seats,
                smallBlind: Math.max(1, Math.round(bb / 2)),
                bigBlind: bb,
                minBuyIn: bb * 50,
                maxBuyIn: bb * 250,
                actionTimerSec: timer,
                timeBankSec: timeBank,
                straddle,
                runItTwice: rit,
                rabbitHunt: rabbit,
                approveJoin: approve,
                password: password || undefined,
                spectatorCards: true,
                botCount: bots,
                botDifficulty: botDiff,
                botsYieldSeats: true,
            });
            if (code)
                onOpenChange(false);
        }
        finally {
            setBusy(false);
            onCreating(false);
        }
    };
    const START_MODES = [
        { id: "immediate", icon: "⚡" },
        { id: "when_full", icon: "🎯" },
        { id: "scheduled", icon: "📅" },
        { id: "scheduled_min", icon: "📅🎯" },
        { id: "manual", icon: "🖐️" },
    ];
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-md max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white tracking-[0.2em] text-center">{t("home.createTitle").toUpperCase()}</DialogTitle>
          <DialogDescription className="text-center text-white/50">{t("home.createSub")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div>
            <Label className="text-white/70 text-[12px]">{t("common.nickname")}</Label>
            <Input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={20} className="bg-black/40 border-white/15 text-white mt-1 focus-visible:ring-[var(--brand)]" data-testid="input-nickname"/>
          </div>

          {/* kind selector: tournament Room vs cash table */}
          <div className="flex gap-1.5">
            <button className={`flex-1 rounded-xl py-2.5 text-[12px] font-black transition-all ${kind === "room" ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setKind("room")} data-testid="kind-room">
              🏆 {t("create2.kindRoom")}
            </button>
            <button className={`flex-1 rounded-xl py-2.5 text-[12px] font-black transition-all ${kind === "cash" ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setKind("cash")} data-testid="kind-cash">
              ♠ {t("create2.kindCash")}
            </button>
          </div>

          {kind === "room" ? (<>
              <div>
                <Label className="text-white/70 text-[12px]">{t("tour.name")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={`${nick.trim() || "Poker Kings"}'s Tournament`} className="bg-black/40 border-white/15 text-white mt-1" data-testid="input-room-name"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-white/70 text-[12px]">{t("create.variant")}</Label>
                  <div className="flex gap-1.5 mt-1">
                    {["nlhe", "plo4"].map((v) => (<button key={v} className={`flex-1 rounded-xl py-2 text-[11px] font-bold transition-all ${variant === v ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setVariant(v)}>
                        {v === "nlhe" ? "Hold'em" : "Omaha PLO4"}
                      </button>))}
                  </div>
                </div>
                <div>
                  <Label className="text-white/70 text-[12px]">{t("create2.maxPlayers")}</Label>
                  <div className="flex gap-1 mt-1">
                    {[8, 16, 24, 32].map((v) => (<button key={v} className={`flex-1 rounded-xl py-2 text-[11px] font-bold transition-all ${!unlimited && maxPlayers === v && customMax === "" ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => { setUnlimited(false); setCustomMax(""); setMaxPlayers(v); setRequiredPlayers(v); }} data-testid={`maxp-${v}`}>
                        {v}
                      </button>))}
                    <button className={`flex-1 rounded-xl py-2 text-[11px] font-black transition-all ${unlimited ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => { setUnlimited(true); setCustomMax(""); }} title={t("create2.unlimited")} data-testid="maxp-inf">
                      ∞
                    </button>
                  </div>
                  {/* custom numeric input — anything 2..200 (server re-clamps) */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-white/40 shrink-0">{t("create2.custom")}</span>
                    <input type="number" inputMode="numeric" min={2} max={200} step={1} value={customMax} disabled={unlimited} placeholder={String(maxPlayers)} onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{0,4}$/.test(v))
                    return;                 setCustomMax(v);
                const parsed = Number.parseInt(v, 10);
                if (Number.isFinite(parsed) && parsed >= 2 && parsed <= 200) {
                    setUnlimited(false);
                    setMaxPlayers(parsed);
                }
            }} className="min-w-0 flex-1 rounded-xl bg-white/5 border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white/85 placeholder:text-white/25 disabled:opacity-40 outline-none focus:border-[var(--brand)]/50" data-testid="maxp-custom"/>
                  </div>
                  {unlimited && (<p className="text-[9.5px] text-white/40 mt-1" data-testid="unlimited-hint">{t("create2.unlimitedHint")}</p>)}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-white/70 text-[12px]">{t("tour.stack")}</Label>
                  <div className="flex gap-1 mt-1">
                    {[3000, 10000, 30000].map((v) => (<button key={v} className={`flex-1 rounded-lg py-2 text-[10.5px] font-bold transition-all ${stack === v && customStack === "" ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => { setCustomStack(""); setStack(v); }}>
                        {v >= 1000 ? `${v / 1000}k` : v}
                      </button>))}
                  </div>
                  {/* custom starting chips — the creator decides (500..10M, server re-clamps) */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[9.5px] text-white/40 shrink-0">{t("create2.custom")}</span>
                    <input type="number" inputMode="numeric" min={500} max={10000000} step={100} value={customStack} placeholder={String(stack)} onChange={(e) => {
                const v = e.target.value;
                if (!/^\d{0,8}$/.test(v))
                    return;                 setCustomStack(v);
                const parsed = Number.parseInt(v, 10);
                if (Number.isFinite(parsed) && parsed >= 500)
                    setStack(parsed);
            }} className="min-w-0 flex-1 rounded-lg bg-white/5 border border-white/10 px-2 py-1 text-[11px] font-bold text-white/85 placeholder:text-white/25 outline-none focus:border-[var(--brand)]/50" data-testid="stack-custom"/>
                  </div>
                </div>
                <div>
                  <Label className="text-white/70 text-[12px]">{t("tour.entry")}</Label>
                  <div className="flex gap-1 mt-1">
                    {[0, 1000, 5000].map((v) => (<button key={v} className={`flex-1 rounded-lg py-2 text-[10.5px] font-bold transition-all ${entryFee === v ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setEntryFee(v)}>
                        {v === 0 ? "FREE" : `${v / 1000}k`}
                      </button>))}
                  </div>
                </div>
                <div>
                  <Label className="text-white/70 text-[12px]">{t("create2.seatsPerTable")}</Label>
                  <div className="flex gap-1 mt-1">
                    {[2, 6, 8].map((v) => (<button key={v} className={`flex-1 rounded-lg py-2 text-[10.5px] font-bold transition-all ${seatsPerTable === v ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setSeatsPerTable(v)} data-testid={`spt-${v}`}>
                        {v === 2 ? "HU" : v}
                      </button>))}
                  </div>
                </div>
              </div>

              {/* turn timer (default 15s) + level pace */}
              <div className="rounded-2xl bg-black/30 border border-white/10 p-3 space-y-2.5" data-testid="room-timer-section">
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[12px] font-bold">⏱ {t("create.timer")}</Label>
                  <div className="flex gap-1">
                    {[10, 15, 30, 60].map((v) => (<button key={v} className={`rounded-lg px-2 py-1 text-[10.5px] font-bold transition-all ${turnSec === v ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setTurnSec(v)} data-testid={`room-timer-${v}`}>
                        {v}s
                      </button>))}
                  </div>
                </div>
                <p className="text-[10.5px] text-white/45 leading-relaxed">{t("create.timerHint")}</p>
                <div className="flex items-center justify-between pt-1">
                  <Label className="text-white/75 text-[12px]">{t("tour.levelSec")}: {levelMin}m ⚡</Label>
                  <Switch checked={turbo} onCheckedChange={setTurbo}/>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/75 text-[12px]">{t("tour.rebuys")}</Label>
                  <div className="flex gap-1">
                    {[0, 1, 2].map((v) => (<button key={v} className={`rounded-lg px-2.5 py-1 text-[10.5px] font-bold transition-all ${rebuys === v ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setRebuys(v)}>
                        {v === 0 ? t("common.off") : v}
                      </button>))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-white/75 text-[12px]">{t("create2.lateJoin")}</Label>
                  <Switch checked={lateJoin} onCheckedChange={setLateJoin} data-testid="switch-latejoin"/>
                </div>
              </div>

              {/* START MODE — how the room begins (spec §7) */}
              <div className="rounded-2xl bg-black/30 border border-[var(--brand)]/25 p-3 space-y-2.5" data-testid="startmode-section">
                <Label className="text-white/85 text-[12px] font-bold">🚀 {t("create2.startMode")}</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {START_MODES.map((m) => (<button key={m.id} className={`rounded-xl px-2 py-2 text-[10.5px] font-bold text-left transition-all ${startMode === m.id ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"} ${m.id === "scheduled_min" ? "col-span-2" : ""}`} onClick={() => setStartMode(m.id)} data-testid={`mode-${m.id}`}>
                      {m.icon} {t(`room.mode.${m.id}`)}
                    </button>))}
                </div>
                <p className="text-[10.5px] text-white/45 leading-relaxed">{t(`room.mode.${startMode}.desc`)}</p>

                {startMode === "when_full" && (<div className="pt-1">
                    <Label className="text-white/70 text-[12px]">{t("create2.requiredPlayers")}: {requiredPlayers}</Label>
                    <input type="range" min={2} max={unlimited ? 500 : maxPlayers} value={requiredPlayers} onChange={(e) => setRequiredPlayers(parseInt(e.target.value) || 2)} className="w-full accent-[var(--brand)]" data-testid="slider-required"/>
                  </div>)}
                {(startMode === "scheduled" || startMode === "scheduled_min") && (<div className="pt-1">
                    <Label className="text-white/70 text-[12px]">{t("create2.startAt")}</Label>
                    <Input type="datetime-local" value={startAtLocal} onChange={(e) => setStartAtLocal(e.target.value)} className="bg-black/40 border-white/15 text-white mt-1" data-testid="input-start-at"/>
                    <p className="text-[10px] text-white/40 mt-1">{t("create2.startAtHint")}</p>
                  </div>)}
                {startMode === "scheduled_min" && (<div className="pt-1">
                    <Label className="text-white/70 text-[12px]">{t("create2.minPlayers")}: {minPlayers}</Label>
                    <input type="range" min={2} max={unlimited ? 500 : maxPlayers} value={minPlayers} onChange={(e) => setMinPlayers(parseInt(e.target.value) || 2)} className="w-full accent-[var(--brand)]" data-testid="slider-min"/>
                    <Label className="text-white/70 text-[12px] block mt-2">{t("create2.fallback")}</Label>
                    <div className="grid grid-cols-2 gap-1.5 mt-1">
                      {["cancel", "extend", "start_anyway", "keep_waiting"].map((f) => (<button key={f} className={`rounded-lg px-2 py-1.5 text-[10px] font-bold transition-all ${fallback === f ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setFallback(f)} data-testid={`fallback-${f}`}>
                          {t(`room.fallback.${f}`)}
                        </button>))}
                    </div>
                  </div>)}
              </div>

              <button className="w-full btn-brand rounded-2xl font-black py-3.5 text-[15px] tracking-wide disabled:opacity-50" onClick={createRoom} disabled={!nick.trim() || busy || ((startMode === "scheduled" || startMode === "scheduled_min") && !startAtLocal)} data-testid="btn-create-room">
                {t("tour.create")}
              </button>
            </>) : (<>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-white/70 text-[12px]">{t("create.blinds")}</Label>
                  <div className="flex gap-1.5 mt-1">
                    {[10, 20, 50, 100].map((v) => (<button key={v} className={`flex-1 rounded-xl py-2 text-[11px] font-bold transition-all ${bb === v ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setBb(v)}>
                        {v / 2}/{v}
                      </button>))}
                  </div>
                </div>
                <div>
                  <Label className="text-white/70 text-[12px]">{t("create.seats")}</Label>
                  <div className="flex gap-1.5 mt-1">
                    {[2, 4, 6, 9, 10].map((v) => (<button key={v} className={`flex-1 rounded-xl py-2 text-[11px] font-bold transition-all ${seats === v ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => { setSeats(v); setBots((b) => Math.min(b, v - 1)); }}>
                        {v === 2 ? "HU" : v}
                      </button>))}
                  </div>
                </div>
              </div>

              {/* AI players — play instantly without waiting for humans */}
              <div className="rounded-2xl bg-black/30 border border-[var(--brand)]/25 p-3 space-y-2.5" data-testid="ai-section">
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[12px] font-bold">🤖 {t("create.bots")}</Label>
                  <span className="text-gradient-brand font-black text-[14px] tabular-nums" data-testid="bot-count">{bots}</span>
                </div>
                <input type="range" min={0} max={seats - 1} value={bots} onChange={(e) => setBots(parseInt(e.target.value))} className="w-full accent-[var(--brand)]" data-testid="bot-slider"/>
                <div className="flex gap-1.5">
                  {[0, 1, 3, 5, 8].map((n) => (<button key={n} className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition-all ${bots === n ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setBots(Math.min(n, seats - 1))} data-testid={`bot-preset-${n}`}>
                      {n}
                    </button>))}
                </div>
                {bots > 0 && (<div className="flex items-center justify-between">
                    <Label className="text-white/70 text-[12px]">{t("create.botDifficulty")}</Label>
                    <div className="flex gap-1">
                      {["easy", "normal", "hard"].map((d) => (<button key={d} className={`rounded-lg px-2 py-1 text-[10.5px] font-bold transition-all ${botDiff === d ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setBotDiff(d)} data-testid={`bot-diff-${d}`}>
                          {t(`bot.${d}`)}
                        </button>))}
                    </div>
                  </div>)}
                <p className="text-[10.5px] text-white/45 leading-relaxed">{t("create.botsNote")}</p>
              </div>

              {/* turn timer — how long each player gets to act before an auto-skip */}
              <div className="rounded-2xl bg-black/30 border border-white/10 p-3 space-y-2.5" data-testid="timer-section">
                <div className="flex items-center justify-between">
                  <Label className="text-white/85 text-[12px] font-bold">⏱ {t("create.timer")}</Label>
                  <span className="text-gradient-gold font-black text-[14px] tabular-nums" data-testid="timer-value">{timer}s</span>
                </div>
                <div className="flex gap-1.5">
                  {[10, 15, 30, 60].map((v) => (<button key={v} className={`flex-1 rounded-xl py-1.5 text-[11px] font-bold transition-all ${timer === v ? "seg-gold-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setTimer(v)} data-testid={`timer-preset-${v}`}>
                      {v === 15 ? "15s ✓" : `${v}s`}
                    </button>))}
                </div>
                <input type="range" min={5} max={120} value={timer} onChange={(e) => setTimer(parseInt(e.target.value))} className="w-full accent-[var(--gold)]" data-testid="timer-slider"/>
                <p className="text-[10.5px] text-white/45 leading-relaxed">{t("create.timerHint")}</p>
              </div>

              <button className="text-[11px] text-white/50 hover:text-white/80 underline underline-offset-2" onClick={() => setAdvanced(!advanced)}>
                {t("create.options")} {advanced ? "−" : "+"}
              </button>
              {advanced && (<div className="space-y-2.5 rounded-2xl bg-black/30 p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-white/75 text-[12px]">{t("create.rit")}</Label>
                    <Switch checked={rit} onCheckedChange={setRit}/>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-white/75 text-[12px]">{t("create.rabbit")}</Label>
                    <Switch checked={rabbit} onCheckedChange={setRabbit}/>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-white/75 text-[12px]">{t("create.straddle")}</Label>
                    <Switch checked={straddle} onCheckedChange={setStraddle}/>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-white/75 text-[12px]">{t("create.approve")}</Label>
                    <Switch checked={approve} onCheckedChange={setApprove}/>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-white/75 text-[12px]">{t("create.timebank")}: {timeBank}s</Label>
                    <div className="flex gap-1">
                      {[0, 15, 30, 60].map((v) => (<button key={v} className={`rounded-lg px-2 py-1 text-[10.5px] font-bold transition-all ${timeBank === v ? "seg-on" : "btn-ghost !bg-white/5 text-white/60"}`} onClick={() => setTimeBank(v)} data-testid={`timebank-${v}`}>
                          {v === 0 ? t("common.off") : `${v}s`}
                        </button>))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-white/75 text-[12px]">{t("create.password")}</Label>
                    <Input value={password} onChange={(e) => setPassword(e.target.value)} maxLength={12} className="bg-black/40 border-white/15 text-white mt-1"/>
                  </div>
                </div>)}

              <button className="w-full btn-brand rounded-2xl font-black py-3.5 text-[15px] tracking-wide" onClick={createCash} disabled={!nick.trim() || busy} data-testid="btn-create-table">
                {t("common.create")}
              </button>
            </>)}
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
          <DialogTitle className="text-white tracking-[0.2em] text-center">{t("home.joinTitle").toUpperCase()}</DialogTitle>
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
