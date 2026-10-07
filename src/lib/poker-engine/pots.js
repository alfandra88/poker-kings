export function refundUncalled(commits) {
    if (commits.length === 0)
        return { refunds: [], effective: [] };
    const max = Math.max(...commits.map((c) => c.amount));
    const atMax = commits.filter((c) => c.amount === max);
    const effective = commits.map((c) => ({ ...c }));
    if (atMax.length === 1 && max > 0) {
        const others = commits.filter((c) => c.seat !== atMax[0].seat).map((c) => c.amount);
        const secondMax = others.length ? Math.max(...others) : 0;
        const refund = max - secondMax;
        if (refund > 0) {
            atMax[0].amount -= 0;             const eff = effective.find((c) => c.seat === atMax[0].seat);
            eff.amount = secondMax;
            return { refunds: [{ seat: atMax[0].seat, amount: refund }], effective };
        }
    }
    return { refunds: [], effective };
}

export function buildPots(commits) {
    const positive = commits.filter((c) => c.amount > 0);
    if (positive.length === 0)
        return [];
    const levels = Array.from(new Set(positive.map((c) => c.amount))).sort((a, b) => a - b);
    const layers = [];
    let prev = 0;
    for (const lvl of levels) {
        const width = lvl - prev;
        if (width <= 0) {
            prev = lvl;
            continue;
        }
        let amount = 0;
        const eligible = new Set();
        for (const c of commits) {
            if (c.amount <= prev)
                continue;
            const contribution = Math.min(width, c.amount - prev);
            amount += contribution;
            if (!c.folded)
                eligible.add(c.seat);
        }
        layers.push({ amount, eligible: [...eligible] });
        prev = lvl;
    }
    const merged = [];
    for (const l of layers) {
        const last = merged[merged.length - 1];
        if (last &&
            last.eligible.length === l.eligible.length &&
            last.eligible.every((s) => l.eligible.includes(s))) {
            last.amount += l.amount;
        }
        else {
            merged.push({ ...l, eligible: [...l.eligible] });
        }
    }
    return merged;
}

export function splitPot(amount, bestSeats, buttonSeat, orderFromButton) {
    if (bestSeats.length === 0 || amount <= 0)
        return [];
    const share = Math.floor(amount / bestSeats.length);
    let remainder = amount - share * bestSeats.length;
    const result = bestSeats.map((seat) => ({ seat, amount: share }));
    if (remainder > 0 && bestSeats.length > 1) {
        const ordered = [...bestSeats];
        if (buttonSeat !== null) {
            const startIdx = Math.max(0, orderFromButton.indexOf(buttonSeat));
            const ring = [];
            for (let i = 1; i <= orderFromButton.length; i++) {
                ring.push(orderFromButton[(startIdx + i) % orderFromButton.length]);
            }
            ordered.sort((a, b) => ring.indexOf(a) - ring.indexOf(b));
        }
        let idx = 0;
        while (remainder > 0) {
            const target = result.findIndex((r) => r.seat === ordered[idx % ordered.length]);
            if (target >= 0) {
                result[target].amount += 1;
                remainder--;
            }
            idx++;
            if (idx > 100)
                break;
        }
    }
    return result.filter((r) => r.amount > 0);
}
