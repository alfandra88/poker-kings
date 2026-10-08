"use client";
import { RANK_CHARS, SUIT_GLYPHS } from "@/lib/poker-engine/cards";
const SIZES = {
    sm: { w: 30, h: 42, rank: "text-[13px]", suit: "text-[11px]" },
    md: { w: 44, h: 62, rank: "text-[18px]", suit: "text-[14px]" },
    lg: { w: 58, h: 82, rank: "text-[24px]", suit: "text-[18px]" },
    // Fills a Poker Squares grid cell; the cell sets the size.
    grid: { w: "100%", h: "100%", rank: "sq-rank", suit: "sq-suit" },
};
export function PlayingCard({ card, faceDown = false, size = "md", highlight = false, dim = false, delay = 0, animate = true, }) {
    const s = SIZES[size];
    const red = card !== null && card !== undefined && (card & 3) === 1 || (card !== null && card !== undefined && (card & 3) === 2);
    const isRed = red;
    const style = { width: s.w, height: s.h, animationDelay: `${delay}ms` };
    if (faceDown || card === null || card === undefined) {
        return (<div className={`rounded-[6px] border border-white/20 shrink-0 ${animate ? "anim-deal" : ""} ${dim ? "opacity-50" : ""}`} style={{
                ...style,
                background: "linear-gradient(150deg, #a02330 0%, #7c1622 55%, #901b28 100%)",
                boxShadow: "0 2px 6px rgba(0,0,0,.5), inset 0 0 0 2px rgba(255,255,255,.14)",
            }} aria-hidden>
        <div className="w-full h-full rounded-[4px] opacity-60" style={{
                background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 2px, transparent 2px 6px), radial-gradient(circle at 50% 50%, rgba(255,255,255,0.22) 0 14%, transparent 15%)",
                margin: 3,
            }}/>
      </div>);
    }
    const rank = RANK_CHARS[card >> 2];
    const suit = SUIT_GLYPHS[card & 3];
    return (<div className={`relative rounded-[6px] shrink-0 select-none anim-deal ${dim ? "opacity-45" : ""} ${highlight ? "card-winner" : ""}`} style={{
            ...style,
            background: "linear-gradient(155deg, #ffffff 0%, #f2f3ee 88%, #e6e8e0 100%)",
            boxShadow: highlight
                ? "0 0 0 2px var(--gold), 0 4px 14px rgba(13, 177, 236, 0.4)"
                : "0 2px 7px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,0.08)",
        }} aria-label={`${rank}${suit}`}>
      <div className="absolute inset-0 rounded-[6px] overflow-hidden pointer-events-none">
        <div className="absolute -right-2 -top-2 w-6 h-6 rounded-full bg-black/[0.045]"/>
        <div className="absolute -left-2.5 -bottom-2.5 w-7 h-7 rounded-full bg-black/[0.04]"/>
      </div>
      <span className={`absolute left-[3.5px] top-[1px] font-bold leading-none ${s.rank} ${isRed ? "text-[#c62f3b]" : "text-[#1a2129]"}`} style={{ fontFamily: "var(--font-card)" }}>
        {rank}
      </span>
      <span className={`absolute right-[3px] bottom-[0px] leading-none ${s.suit} ${isRed ? "text-[#c62f3b]" : "text-[#1a2129]"}`}>
        {suit}
      </span>
    </div>);
}
export function HandCards({ cards, size = "lg", }) {
    return (<div className="flex gap-1.5 justify-center">
      {cards.map((c, i) => (<PlayingCard key={`${c}-${i}`} card={c} size={size} delay={i * 90}/>))}
    </div>);
}
