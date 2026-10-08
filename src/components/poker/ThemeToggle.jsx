"use client";
import { useEffect } from "react";
import { usePoker, loadThemeFromStorage, hasSavedTheme, platformTheme } from "@/lib/poker/store";

export function ThemeToggle({ testid = "btn-theme" }) {
    const theme = usePoker((s) => s.theme);
    const setTheme = usePoker((s) => s.setTheme);
    const t = usePoker((s) => s.t);
    useEffect(() => {
        setTheme(loadThemeFromStorage(), false);
        // Follow Homeroom's light/dark setting until the player picks one here.
        const follow = () => {
            const th = platformTheme();
            if (th && !hasSavedTheme())
                setTheme(th, false);
        };
        window.addEventListener("usernode:theme-changed", follow);
        return () => window.removeEventListener("usernode:theme-changed", follow);
    }, [setTheme]);
    const next = theme === "dark" ? "light" : "dark";
    return (<button className="btn-ghost rounded-xl px-2.5 py-1.5 flex items-center justify-center gap-1.5 text-[11px] font-bold shrink-0 min-w-9 min-h-9" onClick={() => setTheme(next)} aria-label={`${t("theme.title")}: ${theme === "dark" ? t("theme.dark") : t("theme.light")}`} title={t("theme.title")} data-testid={testid}>
      <span aria-hidden>{theme === "dark" ? "🌙" : "☀️"}</span>
    </button>);
}
