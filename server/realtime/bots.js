import { randomBytes } from "node:crypto";
import { chooseCell } from "../../src/lib/squares-engine/ai.js";

export const BOT_NAMES = [
    "Ava", "Kai", "Mo", "Lena", "Ravi", "Sol", "Nina", "Theo", "Yuki", "Omar",
    "Iris", "Bea", "Jun", "Pia", "Rex", "Tess", "Ugo", "Vera", "Wes", "Zara",
];

export function botId() {
    return `bot:${randomBytes(4).toString("hex")}`;
}

// Places cards for AI players with human-like delays.
export class BotHost {
    constructor(timers, random = Math.random) {
        this.timers = timers;
        this.random = random;
        this.pending = new Map();
    }
    pickName(taken) {
        const used = new Set(taken);
        const free = BOT_NAMES.filter((n) => !used.has(n));
        if (free.length)
            return free[Math.floor(this.random() * free.length)];
        return `AI ${Math.floor(this.random() * 900 + 100)}`;
    }
    addBots(table, count, skill = table.cfg.botDifficulty) {
        const added = [];
        for (let i = 0; i < count; i++) {
            if (table.isFull())
                break;
            const name = this.pickName([...table.names.values()].map((n) => n.username));
            const res = table.addPlayer({ id: botId(), username: name, isBot: true, skill });
            if (res.ok)
                added.push(name);
        }
        return added;
    }
    // Called whenever a new card is dealt at a table.
    onDeal(table) {
        const round = table.round;
        if (!round || round.phase !== "placing")
            return;
        const index = round.index;
        const handles = this.pending.get(table.code) ?? new Set();
        this.pending.set(table.code, handles);
        const timerMs = table.cfg.timerSec * 1000;
        for (const p of table.players.values()) {
            if (!p.isBot || !round.has(p.id))
                continue;
            const delay = Math.min(timerMs - 700, 600 + Math.floor(this.random() * 1900));
            const h = this.timers.schedule(() => {
                handles.delete(h);
                if (table.round !== round || round.phase !== "placing" || round.index !== index || round.placed.has(p.id))
                    return;
                const grid = round.grid(p.id).slice();
                const dealt = new Set(round.deck.slice(0, index + 1));
                const unseen = [];
                for (let c = 0; c < 52; c++)
                    if (!dealt.has(c))
                        unseen.push(c);
                const cell = chooseCell(grid, round.card, { skill: p.skill, unseen, random: this.random });
                table.place(p.id, cell);
            }, Math.max(300, delay));
            handles.add(h);
        }
    }
    disposeTable(code) {
        const handles = this.pending.get(code);
        if (handles)
            for (const h of handles)
                this.timers.cancel(h);
        this.pending.delete(code);
    }
    dispose() {
        for (const code of [...this.pending.keys()])
            this.disposeTable(code);
    }
}
