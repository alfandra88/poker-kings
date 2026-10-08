const PROFANITY_EN = [
    "fuck", "shit", "bitch", "asshole", "bastard", "dick", "cunt", "motherfucker",
    "faggot", "retard", "whore", "slut", "nigg", "wanker", "prick", "douche",
];
const PROFANITY_ID = [
    "anjing", "bangsat", "bajingan", "tolol", "goblok", "bego", "kontol", "memek",
    "ngentot", "jablay", "babi", "asu", "tai", "sialan", "brengsek", "setan",
];
const SOLICITATION = [
    "deposit", "withdraw", "cash out", "cashout", "buy chips", "sell chips",
    "jual chip", "beli chip", "tarik dana", "transfer dana", "dp dulu", "wd ",
    "http://", "https://", "www.", ".com/", "telegram.me", "t.me/", "wa.me",
    "casino", "slot online", "judi online", "situs judi", "bandar",
];
function normalize(text) {
    return text
        .toLowerCase()
        .replace(/[0]/g, "o")
        .replace(/[1|!]/g, "i")
        .replace(/[3]/g, "e")
        .replace(/[4@]/g, "a")
        .replace(/[5$]/g, "s")
        .replace(/7/g, "t")
        .replace(/\s+/g, " ");
}
export function filterMessage(raw) {
    let text = raw.replace(/[\u200B-\u200D\uFEFF]/g, "").trim().slice(0, 280);
    if (!text)
        return { text: "", masked: false, blocked: true, reason: "empty" };
    const norm = normalize(text);
    for (const s of SOLICITATION) {
        if (norm.includes(s)) {
            return { text, masked: false, blocked: true, reason: "solicitation" };
        }
    }
    const words = [...PROFANITY_EN, ...PROFANITY_ID];
    let masked = false;
    text = text
        .split(/(\s+)/)         .map((tok) => {
        if (!tok || /^\s+$/.test(tok))
            return tok;
        const core = tok.replace(/[^\p{L}\p{N}]+/gu, "");         const tokNorm = normalize(core);
        const hit = words.some((w) => tokNorm.includes(w));
        if (hit) {
            masked = true;
            return "█".repeat(Math.max(core.length, 2));
        }
        return tok;
    })
        .join("");
    return { text, masked, blocked: false };
}

export class RateLimiter {
    max;
    windowMs;
    hits = [];
    constructor(max, windowMs) {
        this.max = max;
        this.windowMs = windowMs;
    }
    allow() {
        const now = Date.now();
        this.hits = this.hits.filter((t) => now - t < this.windowMs);
        if (this.hits.length >= this.max)
            return false;
        this.hits.push(now);
        return true;
    }
}

export class SpamClamp {
    last = null;
    check(text) {
        const now = Date.now();
        if (this.last && this.last.text === text && now - this.last.ts < 30000) {
            this.last.count++;
            this.last.ts = now;
            return this.last.count >= 3;
        }
        this.last = { text, count: 1, ts: now };
        return false;
    }
}
