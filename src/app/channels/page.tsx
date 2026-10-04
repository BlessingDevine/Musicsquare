import type { Metadata } from "next";
import Link from "next/link";
import { ListenButton } from "@/components/listen-button";
import { LiveChannels } from "@/components/live-channels";
import { getChannelSummaries } from "@/lib/catalog";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Channels",
  description:
    "Live channels from the Musicsquare catalogue — Pop, R&B, Afrobeat, Country, Reggaeton, EDM and more, each playing around the clock. Tune in and join mid-song, at the same moment as everyone else.",
};

// Rotations change only when the catalogue is imported; what's on air is
// refreshed in the browser, so the page itself can be rebuilt once a minute.
export const revalidate = 60;

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen", "Twenty"];

export default async function ChannelsPage() {
  const summaries = await getChannelSummaries();
  const songs = summaries.reduce((n, c) => n + c.tracks, 0);
  const hours = Math.round(summaries.reduce((n, c) => n + c.totalMs, 0) / 3_600_000);
  const count = WORDS[summaries.length] ?? String(summaries.length);

  return (
    <main>
      <header className={`on-ink ${styles.header}`}>
        <div className="wrap">
          <p className="mono eyebrow">Channels</p>
          <h1 className={`display ${styles.title}`}>
            {count} rooms, <em>all live</em>
          </h1>
          <p className={styles.lede}>
            Each channel is its own station, playing around the clock from the
            catalogue. Tune in and you join it mid-song, wherever it has got to —
            the same moment as everyone else listening.
          </p>

          <dl className={styles.summary}>
            <div>
              <dt className="mono">Channels</dt>
              <dd>{summaries.length}</dd>
            </div>
            <div>
              <dt className="mono">Songs in rotation</dt>
              <dd>{songs.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt className="mono">Hours of music</dt>
              <dd>{hours}</dd>
            </div>
            <div>
              <dt className="mono">On air</dt>
              <dd>24/7</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className={`wrap ${styles.list}`}>
        {summaries.length ? (
          <LiveChannels initial={summaries} />
        ) : (
          <p className={styles.empty}>
            The channels are being tuned. In the meantime, the main station is on
            the air.
          </p>
        )}

        {/* The main signal is a separate, programmed stream; say so plainly
            rather than leave it implied. */}
        <section className={styles.main}>
          <p className="mono eyebrow">And the main signal</p>
          <h2 className={`display ${styles.mainTitle}`}>
            Musicsquare Radio, <em>programmed</em>
          </h2>
          <p className={styles.mainLede}>
            The station itself runs one stream with a weekly schedule, moving
            between genres through the day.
          </p>
          <div className={styles.mainActions}>
            <ListenButton />
            <Link href="/schedule" className={`mono ${styles.toSchedule}`}>
              See the week &rarr;
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
