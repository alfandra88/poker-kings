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
        {children}
        <Toaster />
      </body>
    </html>);
}
