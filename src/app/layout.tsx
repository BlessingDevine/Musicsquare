import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Instrument_Sans, Space_Mono } from "next/font/google";
import { PlayerProvider } from "@/components/player-provider";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { PlayerBar } from "@/components/player-bar";
import { MixerDebug } from "@/components/mixer-debug";
import "./globals.css";

const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  variable: "--font-bodoni",
  weight: ["500", "700", "800", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-space-mono",
  weight: ["400", "700"],
  display: "swap",
});

// Where shared-link previews fetch the card image from, and the canonical
// address. The domain moved to this project in Oct 2026 with the bare domain
// as primary (www redirects to it), so it is fixed here. Deriving it from
// Vercel's VERCEL_PROJECT_PRODUCTION_URL, as before the move, left previews
// pointing at a .vercel.app alias that was later removed — every card 404'd.
const SITE_URL = "https://musicsquareradio.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Musicsquare Radio — AI magic with human expertise. Always on air.",
    template: "%s — Musicsquare Radio",
  },
  description:
    "A 24/7 station for music made by people and machines together. Pop, R&B, Afrobeat and Country, streaming live from California.",
  openGraph: {
    title: "Musicsquare Radio",
    description:
      "AI magic with human expertise. One frequency, always on. Streaming 24/7 from California.",
    url: SITE_URL,
    siteName: "Musicsquare Radio",
    type: "website",
  },
  // The image itself is app/opengraph-image.jpg (built by scripts/og-image.mjs);
  // X falls back to it, but shows a small square unless asked for the large card.
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "light",
  // Lets the page reach under the notch and the home indicator; the fixed bars
  // then add the safe-area insets back as padding.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${bodoni.variable} ${instrument.variable} ${spaceMono.variable}`}
      >
        <PlayerProvider>
          <SiteNav />
          {children}
          <SiteFooter />
          <PlayerBar />
          <MixerDebug />
        </PlayerProvider>
      </body>
    </html>
  );
}
