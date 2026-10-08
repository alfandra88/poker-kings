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
    title: "Poker Kings: Poker Squares with friends",
    description: "Everyone gets the same 25 cards. Place each one in your 5x5 grid, then every row and column scores points for its poker hand.",
    keywords: ["poker squares", "card puzzle", "points game", "play with friends"],
    applicationName: "Poker Kings",
    manifest: "/manifest.json",
    icons: { icon: "/icon.svg" },
    openGraph: {
        title: "Poker Kings: Poker Squares with friends",
        description: "Create a table, share the code, and build the best poker hands in a 5x5 grid. Points only.",
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
      <head>
        {/* Homeroom bridge: hosted by the platform, never vendored. It loads
            before the app so usernode.theme is ready on first render. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/usernode-bridge/v1/bridge.js"></script>
      </head>
      <body className={`${display.variable} ${body.variable} antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>);
}
