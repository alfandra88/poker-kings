"use client";
import * as React from "react";

export const POD_W = 118;

export const POD_H = 134;

export const BET_PILL = 24;

export const MIN_SCALE = 0.42;
const isFinitePos = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function ellipsePerimeter(a, b) {
    if (!isFinitePos(a) || !isFinitePos(b))
        return 0;
    const { PI, sqrt } = Math;
    return PI * (3 * (a + b) - sqrt((3 * a + b) * (a + 3 * b)));
}

export function computeTableMetrics(feltW, feltH, total) {
    const W = isFinitePos(feltW) ? feltW : 820;
    const H = isFinitePos(feltH) ? feltH : 470;
    const n = clamp(Math.round(isFinitePos(total) ? total : 6), 2, 10);
    const scaleFloor = H > W ? 0.5 : MIN_SCALE;
    const sizeScale = clamp(Math.min(W / 860, H / 500), scaleFloor, 1);
    const rx0 = Math.max(20, W / 2 - (POD_W * sizeScale) / 2 - 8);
    const ry0 = Math.max(16, H / 2 - (POD_H * sizeScale) / 2 - 6);
    const per = ellipsePerimeter(rx0, ry0);
    const podDiag = Math.sqrt(POD_W * POD_W + POD_H * POD_H);
    const need = sizeScale * podDiag + 12;
    const arcRatio = per > 0 && n > 0 ? clamp(per / n / need, 0, 1) : 1;
    const scale = clamp(sizeScale * arcRatio, scaleFloor, 1);
    const rxPx = Math.max(18, W / 2 - (POD_W * scale) / 2 - 8);
    const ryPx = Math.max(14, H / 2 - (POD_H * scale) / 2 - 6);
    const shortViewport = H < 430;
    return {
        scale,
        stackScale: clamp(H / 420, 0.55, 1),
        rxPct: clamp((rxPx / W) * 100, 10, 49),
        ryPct: clamp((ryPx / H) * 100, 8, 49),
        rxPx,
        ryPx,
        cyPct: 47,
        holeSize: H < 330 ? "sm" : H < 460 ? "md" : "lg",
        shortViewport,
    };
}

export function dealerPuckPos(theta, feltW, feltH, rxPx, ryPx, cyPct, scale) {
    const W = isFinitePos(feltW) ? feltW : 820;
    const H = isFinitePos(feltH) ? feltH : 470;
    const rx = isFinitePos(rxPx) ? rxPx : W * 0.43;
    const ry = isFinitePos(ryPx) ? ryPx : H * 0.4;
    const cy = clamp(typeof cyPct === "number" && Number.isFinite(cyPct) ? cyPct : 47, 20, 80);
    const s = clamp(typeof scale === "number" && Number.isFinite(scale) && scale > 0 ? scale : 1, 0.35, 1.15);
    const th = typeof theta === "number" && Number.isFinite(theta) ? theta : Math.PI / 2;
    if (Math.min(W, H) < 240)
        return { x: 50, y: cy, visible: false };
    const halfW = (POD_W * s) / 2;
    const halfH = (POD_H * s) / 2;
    const fx = clamp((rx - halfW - 16) / Math.max(1, rx), 0.4, 0.78);
    const fy = clamp((ry - halfH - 16) / Math.max(1, ry), 0.4, 0.72);
    return {
        x: clamp(50 + ((rx * fx) / W) * 100 * Math.cos(th), 1, 99),
        y: clamp(cy + ((ry * fy) / H) * 100 * Math.sin(th), 1, 99),
        visible: true,
    };
}

export function holeRowH(size) {
    switch (size) {
        case "sm": return 50;
        case "md": return 70;
        case "lg":
        default: return 90;
    }
}

export function makeSeatRing(feltW, feltH, rxPx, ryPx, total, offsetSeatId) {
    const W = isFinitePos(feltW) ? feltW : 820;
    const H = isFinitePos(feltH) ? feltH : 470;
    const rx = isFinitePos(rxPx) ? rxPx : W * 0.43;
    const ry = isFinitePos(ryPx) ? ryPx : H * 0.4;
    const n = clamp(Math.round(isFinitePos(total) ? total : 6), 2, 10);
    const offset = clamp(Math.round(offsetSeatId !== null && isFinitePos(offsetSeatId) ? offsetSeatId : Math.floor(n / 2)), 0, n - 1);
    const K = 2048;
    const cum = new Float64Array(K + 1);
    let ok = true;
    try {
        let acc = 0;
        let px = rx;         let py = 0;
        cum[0] = 0;
        for (let i = 1; i <= K; i++) {
            const th = (i / K) * 2 * Math.PI;
            const x = rx * Math.cos(th);
            const y = ry * Math.sin(th);
            acc += Math.hypot(x - px, y - py);
            cum[i] = acc;
            px = x;
            py = y;
        }
    }
    catch {
        ok = false;
    }
    const P = ok && cum[K] > 0 ? cum[K] : Math.max(1, 2 * Math.PI * Math.max(rx, ry)); 
    const thetaForArc = (s) => {
        const target = ((s % P) + P) % P;
        let lo = 0;
        let hi = K;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] < target)
                lo = mid;
            else
                hi = mid;
        }
        return ((lo + (target - cum[lo]) / Math.max(1e-9, cum[lo + 1] - cum[lo])) / K) * 2 * Math.PI;
    };
    const sBottom = ok ? cum[Math.floor(K / 4)] : (P * 1) / 4;
    return (seatId) => {
        const i = clamp(Math.round(isFinitePos(seatId) ? seatId : 0), 0, n - 1);
        const step = (i - offset) / n;         const theta = thetaForArc(sBottom + step * P);
        return {
            xPct: 50 + (rx / W) * 100 * Math.cos(theta),
            yPct: 47 + (ry / H) * 100 * Math.sin(theta),
            theta,
        };
    };
}

export function useElementSize() {
    const [el, setEl] = React.useState(null);
    const [size, setSize] = React.useState({ w: 0, h: 0 });
    React.useEffect(() => {
        if (!el)
            return;
        const read = () => {
            const r = el.getBoundingClientRect();
            if (Number.isFinite(r.width) && Number.isFinite(r.height)) {
                setSize((prev) => Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
                    ? prev
                    : { w: r.width, h: r.height });
            }
        };
        read();
        let ro = null;
        try {
            if (typeof ResizeObserver !== "undefined") {
                ro = new ResizeObserver(read);
                ro.observe(el);
            }
            else {
                window.addEventListener("resize", read);
                window.addEventListener("orientationchange", read);
            }
        }
        catch {
            window.addEventListener("resize", read);
            window.addEventListener("orientationchange", read);
        }
        return () => {
            try {
                ro?.disconnect();
            }
            catch {
                // observer already dead — nothing to clean up
            }
            window.removeEventListener("resize", read);
            window.removeEventListener("orientationchange", read);
        };
    }, [el]);
    const ref = React.useCallback((node) => setEl(node), []);
    return [ref, size];
}
