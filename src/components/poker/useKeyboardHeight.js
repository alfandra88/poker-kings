"use client";
import { useEffect } from "react";

export function useKeyboardHeight() {
    useEffect(() => {
        if (typeof window === "undefined")
            return;
        let vv = null;
        try {
            vv = "visualViewport" in window ? window.visualViewport : null;
        }
        catch (e) {
            console.debug("useKeyboardHeight: visualViewport unavailable", e);
            vv = null;
        }
        if (!vv || typeof window.innerHeight !== "number")
            return;
        let lastKb = -1;
        let raf = 0;
        const apply = () => {
            raf = 0;
            let kb = 0;
            try {
                const ih = window.innerHeight;
                const raw = ih - vv.height - vv.offsetTop;
                kb = Number.isFinite(raw) && ih > 1 ? Math.max(0, Math.round(raw)) : 0;
                if (kb > ih)
                    kb = 0;
            }
            catch (e) {
                console.debug("useKeyboardHeight: measure failed", e);
                kb = 0;
            }
            if (Math.abs(kb - lastKb) < 8 && !(kb === 0 && lastKb > 0))
                return;
            lastKb = kb;
            try {
                document.documentElement.style.setProperty("--kb", `${kb}px`);
            }
            catch (e) {
                console.debug("useKeyboardHeight: setProperty failed", e);
            }
        };
        const schedule = () => {
            if (!raf) {
                try {
                    raf = window.requestAnimationFrame(apply);
                }
                catch (e) {
                    console.debug("useKeyboardHeight: rAF unavailable", e);
                    apply();
                }
            }
        };
        try {
            vv.addEventListener("resize", schedule);
            vv.addEventListener("scroll", schedule);
            window.addEventListener("orientationchange", schedule);
        }
        catch (e) {
            console.debug("useKeyboardHeight: addEventListener failed", e);
        }
        apply();         return () => {
            try {
                if (raf)
                    window.cancelAnimationFrame(raf);
                vv?.removeEventListener("resize", schedule);
                vv?.removeEventListener("scroll", schedule);
                window.removeEventListener("orientationchange", schedule);
            }
            catch (e) {
                console.debug("useKeyboardHeight: cleanup failed", e);
            }
            try {
                document.documentElement.style.removeProperty("--kb");
            }
            catch (e) {
                console.debug("useKeyboardHeight: removeProperty failed", e);
            }
        };
    }, []);
}
