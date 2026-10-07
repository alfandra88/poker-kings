import { botThinkMs, decideBotAction, pickBotStyle, } from "../../../src/lib/poker-engine/bots.js";
const BOT_NAMES = [
    "AceHunter", "RiverRat", "SlowrollSam", "Bluffy", "ChipLdrStealer", "AllInAnnie",
    "TightTed", "ManiacMo", "SneakyPete", "LuckyLucy", "GunDan", "OmahaOtto",
    "TheRock", "FloatyFlo", "C-BetCarl", "TrapTina", "SuitedSari", "CheckRaihan",
    "FoldEko", "JamalJam", "BetBudi", "CitraCall", "DewiDraw", "EkaEq",
    "FajarFold", "GitaGG", "HendraHU", "IndraIso", "JokoJam", "KikiKb",
    "LukiLimp", "MayaMix", "NandaNut", "OmTilton", "PutriPot", "RizkyRaise",
];
function rid() {
    return Math.random().toString(36).slice(2, 9);
}
export class BotHost {
    resolve;
    systemChat;

    meta = new Map();

    timers = new Map();

    pumps = new Map();
    constructor(resolve, systemChat) {
        this.resolve = resolve;
        this.systemChat = systemChat;
    }
    botIds(code) {
        return [...(this.meta.get(code)?.keys() ?? [])];
    }
    botCount(code) {
        return this.meta.get(code)?.size ?? 0;
    }
    isBot(code, playerId) {
        return this.meta.get(code)?.has(playerId) ?? false;
    }

    addBots(code, count, difficulty) {
        const entry = this.resolve(code);
        if (!entry || entry.table.cfg.mode !== "cash")
            return [];
        const table = entry.table;
        const metas = this.meta.get(code) ?? new Map();
        this.meta.set(code, metas);
        this.timers.set(code, this.timers.get(code) ?? new Map());
        const usedNames = new Set([...metas.values()].map((m) => m.nickname));
        const seated = [];
        for (let i = 0; i < count; i++) {
            if (metas.size >= table.seats.length - 1)
                break;             const free = table.seats.findIndex((s) => s === null);
            if (free < 0)
                break;
            const name = BOT_NAMES.find((n) => !usedNames.has(n)) ?? `Bot-${rid()}`;
            usedNames.add(name);
            const handle = {
                playerId: `bot:${rid()}`,
                nickname: name,
                difficulty,
                style: pickBotStyle(Math.random),
                joinedHandNo: table.handNo,
            };
            const bb = Math.max(1, table.cfg.bigBlind);
            const max = table.cfg.maxBuyIn > 0 ? table.cfg.maxBuyIn : Infinity;
            const buyIn = Math.max(table.cfg.minBuyIn, Math.min(bb * 100, max));
            const res = table.sitDown(free, { playerId: handle.playerId, nickname: name, avatar: `av${Math.floor(Math.random() * 8)}` }, buyIn);
            if (!res.ok)
                continue;
            const seat = table.seatOf(handle.playerId);
            if (seat)
                seat.connected = true;
            metas.set(handle.playerId, handle);
            seated.push(handle);
        }
        if (seated.length > 0) {
            this.systemChat(code, `bot_joined|${seated.map((s) => s.nickname).join(", ")}`);
            this.pump(code);
        }
        return seated;
    }
    removeBot(code, playerId) {
        const entry = this.resolve(code);
        const metas = this.meta.get(code);
        if (!entry || !metas || !metas.has(playerId))
            return false;
        const handle = metas.get(playerId);
        const timers = this.timers.get(code);
        if (timers?.has(playerId)) {
            clearTimeout(timers.get(playerId));
            timers.delete(playerId);
        }
        entry.table.removePlayer(playerId);
        metas.delete(playerId);
        this.systemChat(code, `bot_left|${handle.nickname}`);
        return true;
    }

    attachBot(code, playerId, difficulty) {
        const entry = this.resolve(code);
        if (!entry)
            return null;
        const seat = entry.table.seatOf(playerId);
        if (!seat)
            return null;
        if (seat.playerId?.startsWith("leaving:"))
            return null;
        const metas = this.meta.get(code) ?? new Map();
        this.meta.set(code, metas);
        this.timers.set(code, this.timers.get(code) ?? new Map());
        if (metas.has(playerId))
            return metas.get(playerId);         const handle = {
            playerId,
            nickname: seat.nickname,
            difficulty,
            style: pickBotStyle(Math.random),
            joinedHandNo: entry.table.handNo,
        };
        metas.set(playerId, handle);
        seat.connected = true;
        this.pump(code);
        return handle;
    }

    oldestBot(code) {
        const metas = this.meta.get(code);
        if (!metas || metas.size === 0)
            return null;
        let oldest = null;
        for (const m of metas.values()) {
            if (!oldest || m.joinedHandNo < oldest.joinedHandNo)
                oldest = m;
        }
        return oldest;
    }

    yieldableBotSeatId(code) {
        const entry = this.resolve(code);
        const metas = this.meta.get(code);
        if (!entry || !metas)
            return null;
        let pick = null;
        let pickRank = -1;
        for (const [pid, m] of metas) {
            const seat = entry.table.seatOf(pid);
            if (!seat)
                continue;
            const rank = seat.cards.length === 0 || seat.sittingOut ? 4 : seat.folded ? 3 : seat.allIn ? 2 : 1;
            const score = rank * 10000 - m.joinedHandNo;
            if (score > pickRank) {
                pickRank = score;
                pick = seat.seatId;
            }
        }
        return pick;
    }

    notifyEvent(code, ev) {
        if (!this.meta.has(code))
            return;
        if (ev.t === "hand_end" || ev.t === "payout") {
            setTimeout(() => this.topUpBots(code), 120);
        }
        this.schedulePump(code, 50);
    }
    schedulePump(code, ms) {
        const existing = this.pumps.get(code);
        if (existing)
            return;         this.pumps.set(code, setTimeout(() => {
            this.pumps.delete(code);
            this.pump(code);
        }, ms));
    }
    pump(code) {
        const entry = this.resolve(code);
        if (!entry || entry.table.closed) {
            this.clearTableTimers(code);
            return;
        }
        if (entry.table.paused || !entry.table.handActive)
            return;
        const metas = this.meta.get(code);
        if (!metas || metas.size === 0)
            return;
        const snap = entry.table.snapshotFor({ playerId: "__driver__", isSpectator: true });
        const timers = this.timers.get(code) ?? new Map();
        this.timers.set(code, timers);
        if (snap.ritPrompt) {
            for (const pid of metas.keys()) {
                const seat = entry.table.seatOf(pid);
                if (seat && !seat.folded && !seat.allIn && !(seat.seatId in snap.ritPrompt.votes)) {
                    entry.table.voteRit(pid, true);
                }
            }
        }
        const toAct = snap.toAct !== null ? snap.seats[snap.toAct] : null;
        if (!toAct?.playerId)
            return;
        const pid = toAct.playerId;
        if (!pid.startsWith("bot:") || !metas.has(pid) || timers.has(pid))
            return;
        const handle = metas.get(pid);
        const ms = botThinkMs(handle.difficulty, Math.random);
        timers.set(pid, setTimeout(() => {
            timers.delete(pid);
            this.botAct(code, pid);
        }, ms));
    }
    botAct(code, pid) {
        const entry = this.resolve(code);
        const metas = this.meta.get(code);
        if (!entry || !metas)
            return;
        const table = entry.table;
        if (table.closed || table.paused || !table.handActive)
            return;
        const handle = metas.get(pid);
        if (!handle)
            return;
        const seat = table.seatOf(pid);
        if (!seat)
            return;
        const snap = table.snapshotFor({ playerId: pid, isSpectator: false });
        if (snap.ritPrompt) {
            table.voteRit(pid, true);
            this.schedulePump(code, 200);
            return;
        }
        if (snap.toAct !== seat.seatId)
            return;
        const persona = { difficulty: handle.difficulty, style: handle.style };
        let decision = decideBotAction(snap, seat.seatId, persona, Math.random);
        if (!decision) {
            decision = snap.canCheck ? { type: "check" } : { type: "fold" };
        }
        const fallback = () => {
            if (snap.canCheck)
                table.act(pid, "check");
            else if (snap.toCall > 0 && seat.stack > 0)
                table.act(pid, "call");
            else if (snap.canCheck)
                table.act(pid, "check");
            else
                table.act(pid, "fold");
        };
        try {
            if (decision.type === "bet" || decision.type === "raise") {
                const minTo = snap.minRaiseTo;
                const maxTo = snap.maxRaiseTo;
                if (minTo == null || maxTo == null) {
                    fallback();
                    return;
                }
                let to = Math.round(decision.to ?? minTo);
                to = Math.max(minTo, Math.min(maxTo, to));
                const res = table.act(pid, "raise", to);
                if (!res.ok)
                    fallback();
            }
            else {
                const res = table.act(pid, decision.type);
                if (!res.ok)
                    fallback();
            }
        }
        catch {
            try {
                fallback();
            }
            catch {
                // engine invariant: never crashes the service
            }
        }
    }

    topUpBots(code) {
        const entry = this.resolve(code);
        const metas = this.meta.get(code);
        if (!entry || !metas)
            return;
        const table = entry.table;
        if (table.handActive || table.cfg.mode !== "cash")
            return;
        const bb = Math.max(1, table.cfg.bigBlind);
        for (const pid of metas.keys()) {
            const seat = table.seatOf(pid);
            if (!seat)
                continue;
            const floor = bb * 45;
            if (seat.stack >= floor)
                continue;
            const max = table.cfg.maxBuyIn > 0 ? table.cfg.maxBuyIn : Infinity;
            const target = Math.max(table.cfg.minBuyIn, Math.min(bb * 100, max));
            const add = target - seat.stack;
            if (add > 0)
                table.addChips(pid, add);
        }
    }
    clearTableTimers(code) {
        const timers = this.timers.get(code);
        if (timers) {
            for (const h of timers.values())
                clearTimeout(h);
            timers.clear();
        }
        const pump = this.pumps.get(code);
        if (pump) {
            clearTimeout(pump);
            this.pumps.delete(code);
        }
    }
    disposeTable(code) {
        this.clearTableTimers(code);
        this.meta.delete(code);
    }
}
