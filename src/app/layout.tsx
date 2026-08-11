import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Instrument_Sans, Space_Mono } from "next/font/google";
import { PlayerProvider } from "@/components/player-provider";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { PlayerBar } from "@/components/player-bar";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://www.musicsquareradio.com"),
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
    url: "https://www.musicsquareradio.com",
    siteName: "Musicsquare Radio",
    type: "website",
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
        </PlayerProvider>
      </body>
    </html>
  );
}
