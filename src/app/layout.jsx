// Fonts are committed locally (latin variable subsets): next/font/google
// downloads from fonts.googleapis.com at build time, which fails in the
// offline container build.
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
const display = localFont({
    src: "./fonts/space-grotesk-latin.woff2",
    variable: "--font-display",
    weight: "300 700",
    display: "swap",
});
const body = localFont({
    src: "./fonts/inter-latin.woff2",
    variable: "--font-body",
    weight: "100 900",
    display: "swap",
});
export const metadata = {
    title: "Poker Kings — Free Poker with Friends",
    description: "Free online poker with friends. No ads, no deposits, no downloads. No-Limit Hold'em & Pot-Limit Omaha with chat, tournaments, daily bonuses and achievements. Play money only.",
    keywords: ["poker", "free poker", "poker with friends", "holdem", "omaha", "private poker game"],
    applicationName: "Poker Kings",
    manifest: "/manifest.json",
    openGraph: {
        title: "Poker Kings — Free Poker with Friends",
        description: "Create a table, share the link, play. 100% free — no ads, no deposits, play money only.",
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
export default function RootLayout({ children }) {
    return (<html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${display.variable} ${body.variable} antialiased`}>
        {/* Platform bridge — centrally hosted, relative path only. It is how
            the app answers the shell (offline launch included), so it loads
            before anything interactive. */}
        <Script src="/usernode-bridge/v1/bridge.js" strategy="beforeInteractive" />
        {children}
        <Toaster />
      </body>
    </html>);
}
