import type { Metadata } from "next";
import { ChannelDetail } from "@/components/channel-detail";
import { CATALOGUE, CHANNELS, OTHER_BLOCKS } from "@/lib/station";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Channels",
  description:
    "Four channels on one signal — Pop, R&B, Afrobeat and Country — plus the blocks that fill the rest of the day. What each room plays, and when it is on air.",
  /**
   * Canonical only. Declaring an `openGraph` block here would replace the
   * root one rather than merge into it, dropping `og:image` and putting this
   * page back to a blank share card — the canonical is what stops it
   * reporting itself as a duplicate of the home page.
   */
  alternates: { canonical: "/channels" },
};

export default function ChannelsPage() {
  return (
    <main>
      <header className={`on-ink ${styles.header}`}>
        <div className="wrap">
          <p className="mono eyebrow">Channels</p>
          <h1 className={`display ${styles.title}`}>
            Four rooms, <em>one signal</em>
          </h1>
          <p className={styles.lede}>
            The station never runs more than one stream. What changes through the
            day is which room it is coming from — each with its own catalogue, its
            own writers and its own machines.
          </p>

          <dl className={styles.summary}>
            <div>
              <dt className="mono">Channels</dt>
              <dd>{CHANNELS.length}</dd>
            </div>
            <div>
              <dt className="mono">Songs in the catalogue</dt>
              <dd>{CATALOGUE.songs}</dd>
            </div>
            <div>
              <dt className="mono">Other blocks</dt>
              <dd>{OTHER_BLOCKS.length}</dd>
            </div>
            <div>
              <dt className="mono">Hours a day</dt>
              <dd>24</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className={`wrap ${styles.list}`}>
        <ChannelDetail />
      </div>
    </main>
  );
}
