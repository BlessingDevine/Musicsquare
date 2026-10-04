"use client";

import Image from "next/image";
import Link from "next/link";
import type { ChannelSummary } from "@/lib/channel-summary";
import { CHANNELS } from "@/lib/station";
import { useChannelSummaries } from "./live-channels";
import { usePlayer } from "./player-provider";
import { Reveal } from "./reveal";
import styles from "./channels.module.css";

// The four channels with portraits on the site, matched to their live
// channel in the catalogue by slug.
const FEATURED: Record<string, (typeof CHANNELS)[number] | undefined> = {
  pop: CHANNELS.find((c) => c.slug === "pop"),
  "r-and-b-soul": CHANNELS.find((c) => c.slug === "rnb"),
  afrobeat: CHANNELS.find((c) => c.slug === "afrobeat"),
  country: CHANNELS.find((c) => c.slug === "country"),
};

const hoursOf = (ms: number) => `${Math.round(ms / 3_600_000)}h of music`;

export function Channels({ initial }: { initial: ChannelSummary[] }) {
  const { channels } = useChannelSummaries(initial);
  const { playChannel, isOnChannel, source } = usePlayer();
  const featured = channels.filter((c) => FEATURED[c.slug]);
  if (!featured.length) return null;

  return (
    <section id="channels" className={styles.section}>
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
      </div>

      <div className="wrap">
        <ul className={styles.grid}>
          {featured.map((channel) => {
            const art = FEATURED[channel.slug]!;
            const tuned = isOnChannel(channel.slug);
            const track =
              tuned && source.kind === "channel" && source.track ? source.track : channel.now?.track;
            return (
              <Reveal as="li" key={channel.slug} className={styles.card}>
                <div className={styles.art}>
                  <Image
                    src={art.cover}
                    alt=""
                    fill
                    sizes="(max-width: 760px) 100vw, 25vw"
                    className={styles.img}
                  />
                  <span className={`mono ${styles.air} ${styles.airLive}`}>
                    <span className="pip" aria-hidden="true" />
                    {tuned ? "Listening" : "On air"}
                  </span>
                </div>

                <h3 className={`display ${styles.name}`}>{channel.name}</h3>
                <p className={styles.strap}>
                  {track ? (
                    <>
                      <span className={styles.nowTitle}>{track.title}</span>
                      <span className={`mono ${styles.nowArtist}`}>{track.artist}</span>
                    </>
                  ) : (
                    art.strapline
                  )}
                </p>

                <p className={`mono ${styles.stats}`}>
                  <span>{channel.tracks} songs</span>
                  <span>{hoursOf(channel.totalMs)}</span>
                </p>

                <button
                  type="button"
                  className={`btn ${tuned ? "" : "btn-ghost"} ${styles.cardBtn}`}
                  onClick={() => playChannel(channel.slug, channel.name, channel.now)}
                  aria-pressed={tuned}
                >
                  <span aria-hidden="true">{tuned ? "■" : "▶"}</span>
                  <span>{tuned ? "Stop" : "Tune in"}</span>
                  <span className="sr-only">{tuned ? ` ${channel.name}` : ` to ${channel.name}`}</span>
                </button>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
