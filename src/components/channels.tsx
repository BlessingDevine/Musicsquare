"use client";

import Link from "next/link";
import type { ChannelSummary } from "@/lib/channel-summary";
import { useChannelSummaries } from "./live-channels";
import { Reveal } from "./reveal";
import { StageChannels } from "./stage-channels";
import styles from "./channels.module.css";

// Four channels on the home page, on the same stage as the Channels page (which
// has them all): one big square card each with the cover of the song on air.
const FEATURED = ["pop", "r-and-b-soul", "afrobeat", "country"];

export function Channels({ initial }: { initial: ChannelSummary[] }) {
  const { channels } = useChannelSummaries(initial);
  if (!channels.length) return null;

  return (
    <section id="channels" className={`on-ink ${styles.section}`}>
      <div className="wrap">
        <Reveal className={styles.head}>
          <p className="mono eyebrow">{channels.length} live channels</p>
          <h2 className={`display ${styles.title}`}>
            What we <em>play</em>
          </h2>
          <p className={styles.lede}>
            Every channel is its own station, live around the clock. Tune in and
            you join mid-song, at the same moment as everyone else.
          </p>
          <Link href="/channels" className={`mono ${styles.more}`}>
            All {channels.length} channels &rarr;
          </Link>
        </Reveal>
        <StageChannels initial={initial} only={FEATURED} grid />
      </div>
    </section>
  );
}
