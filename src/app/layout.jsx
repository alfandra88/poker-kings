import Script from "next/script";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
const display = Space_Grotesk({
    variable: "--font-display",
    subsets: ["latin"],
    weight: ["400", "500", "700"],
});
const body = Inter({
    variable: "--font-body",
    subsets: ["latin"],
    weight: ["400", "500", "700", "900"],
});
export const metadata = {
    title: "Poker Kings: Free Stay or Pass Showdowns",
    description: "Free online card game with friends. No ads, no downloads. Hold'em & Omaha hand rankings, stay-or-pass showdowns, chat, tournaments, achievements. Points only, never money.",
    applicationName: "Poker Kings",
    manifest: "/manifest.json",
    icons: { icon: "/icon.svg" },
    openGraph: {
        title: "Poker Kings: Free Stay or Pass Showdowns",
        description: "Create a table, share the link, play. 100% free, points only, never money.",
        siteName: "Poker Kings",
        type: "website",
    },
};
export const viewport = {
    themeColor: "#0b0d10",
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
};
// Platform theme bootstrap: the viewer's Homeroom theme (usernode.theme, set by
// the hosted bridge) is the default; an in-app picker choice wins once made.
const THEME_BOOTSTRAP = `
(function () {
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    var saved = null;
    try { saved = localStorage.getItem("pokerkings.theme"); } catch (e) {}
    var theme = saved || (window.usernode && window.usernode.theme) || (media.matches ? "dark" : "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
  }
  apply();
  window.addEventListener("usernode:theme-changed", function (ev) {
    var saved = null;
    try { saved = localStorage.getItem("pokerkings.theme"); } catch (e) {}
    if (saved) return;
    var t = ev && ev.detail && ev.detail.theme;
    if (t === "light" || t === "dark") {
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.dataset.theme = t;
    }
  });
  media.addEventListener("change", apply);
})();
`;
export default function RootLayout({ children }) {
    return (<html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${display.variable} ${body.variable} antialiased`}>
        {/* Centrally hosted platform files, loaded by relative path — never vendored.
            The bridge is how the app ANSWERS the platform shell, so it loads unconditionally. */}
        <Script src="/usernode-bridge/v1/bridge.js" strategy="beforeInteractive"/>
        <link rel="stylesheet" href="/usernode-native/v1/native.css"/>
        <Script src="/usernode-native/v1/native.js" strategy="beforeInteractive"/>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}/>
        {children}
        <Toaster />
      </body>
    </html>);
}