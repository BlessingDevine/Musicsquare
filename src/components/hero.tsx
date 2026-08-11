"use client";

import { Wall } from "./wall";
import { clock, usePlayer } from "./player-provider";
import { CATALOGUE, STATION } from "@/lib/station";
import styles from "./hero.module.css";

const WORD = "MUSICSQUARE".split("");

export function Hero() {
  const { status, source, now, listening, toggleLive } = usePlayer();
  const liveOn = source.kind === "live" && status === "playing";

  return (
    <section id="top" className={`on-ink ${styles.hero}`}>
      <div className={`wrap ${styles.top}`}>
        <p className="mono">
          {STATION.frequency} · {STATION.city} · Est. {STATION.founded}
        </p>
        <p className={`mono ${styles.counter}`}>
          <span className="pip" aria-hidden="true" />
          {liveOn ? `On air ${clock(listening)}` : "On air now"}
        </p>
      </div>

      <div className={styles.stage}>
        <Wall />

        {/* The one record that is playing, pulled out of the wall. */}
        <figure className={styles.record}>
          <div className={styles.sleeve}>
            {now?.artwork ? (
              // Remote artwork straight off the station feed, so it is never
              // stale. Deliberately not next/image — the host changes per track.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={now.artwork} alt="" className={styles.cover} />
            ) : (
              <div className={styles.coverFallback} />
            )}
            <span className={`mono ${styles.badge}`}>
              <span className="pip" aria-hidden="true" />
              {status === "loading" ? "Connecting" : "On air"}
            </span>
          </div>

          <figcaption className={styles.caption}>
            <span className={styles.trackTitle}>
              {now?.title ?? "Musicsquare Radio"}
            </span>
            <span className={`mono ${styles.trackArtist}`}>
              {now?.artist ?? "Live stream"}
            </span>
          </figcaption>
        </figure>
      </div>

      <h1 className={`display ${styles.word}`} aria-label="Musicsquare Radio">
        {WORD.map((letter, i) => (
          <span
            key={`${letter}-${i}`}
            style={{ animationDelay: `${180 + i * 42}ms` }}
            aria-hidden="true"
          >
            {letter}
          </span>
        ))}
      </h1>

      <div className={`wrap ${styles.thesis}`}>
        <p className={styles.thesisLine}>
          <em>AI magic</em> with human expertise. One frequency, always on.
        </p>
        <p className={`mono ${styles.proof}`}>
          {CATALOGUE.songs} songs · {CATALOGUE.artists} artists · every one made
          by a person and a machine
        </p>
      </div>

      <div className={styles.console}>
        <div className={`wrap ${styles.consoleInner}`}>
          <button
            type="button"
            className={`btn ${styles.cta}`}
            onClick={toggleLive}
            aria-pressed={liveOn}
          >
            <span aria-hidden="true">{liveOn ? "■" : "▶"}</span>
            <span>{liveOn ? "Stop the stream" : "Listen live"}</span>
          </button>

          <p className={`mono ${styles.channels}`}>
            Pop · R&amp;B · Afrobeat · Country · Dancehall · Reggaeton · Amapiano ·
            Kizomba · Lo-fi
          </p>

          <p className={`mono ${styles.scroll}`} aria-hidden="true">
            Scroll
          </p>
        </div>
      </div>
    </section>
  );
}
