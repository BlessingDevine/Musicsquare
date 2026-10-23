"use client";

import { Wall } from "./wall";
import { LevelMeter } from "./level-meter";
import { PlayerExtras } from "./player-extras";
import { clock, usePlayer } from "./player-provider";
import type { ChannelSummary } from "@/lib/channel-summary";
import { CATALOGUE, STATION } from "@/lib/station";
import styles from "./hero.module.css";

const WORD = "MUSICSQUARE".split("");
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=app.gosquare";

export function Hero({ channels }: { channels: ChannelSummary[] }) {
  const { status, source, now, listening, toggleLive, playChannel, isOnChannel } = usePlayer();
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
            {now?.page ? (
              <a className={`${styles.trackTitle} ${styles.trackLink}`} href={now.page} target="_blank" rel="noopener" title="Open on squaredrum.com">
                {now.title} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className={styles.trackTitle}>{now?.title ?? "Musicsquare Radio"}</span>
            )}
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

      {/* The logo's bars as a faint gold level meter along the bottom of the hero. */}
      <LevelMeter />

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

          {(status === "playing" || status === "loading") && <PlayerExtras />}

          {/* Every channel, each one tunes straight in (scrolls sideways when they don't fit). */}
          <nav className={styles.channels} aria-label="Tune in to a channel">
            {channels.map((c) => {
              const on = isOnChannel(c.slug);
              return (
                <button
                  key={c.slug}
                  type="button"
                  className={`mono ${styles.chip} ${on ? styles.chipOn : ""}`}
                  onClick={() => playChannel(c.slug, c.name, c.now)}
                  aria-pressed={on}
                >
                  {c.name}
                </button>
              );
            })}
          </nav>

          {/* The app, for listeners who want it on their phone: tap on a phone, scan from a computer. */}
          <a className={styles.app} href={GOOGLE_PLAY_URL} target="_blank" rel="noopener">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/google-play-qr.svg" alt="" width={44} height={44} />
            <span className="mono">
              Take it with you
              <b>GoSquare · Google Play</b>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
