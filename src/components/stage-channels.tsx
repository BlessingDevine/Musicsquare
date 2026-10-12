"use client";

import { useEffect, useRef, useState } from "react";
import type { ChannelSummary } from "@/lib/channel-summary";
import { useChannelSummaries } from "./live-channels";
import { usePlayer } from "./player-provider";
import styles from "./stage-channels.module.css";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Design C — the stage. One channel at a time, as a big panel with the cover
 * of the song on air filling it; swipe (or use the arrows) to the next
 * station, or jump with the strip of covers underneath.
 */
export function StageChannels({
  initial,
  only,
  grid = false,
}: {
  initial: ChannelSummary[];
  only?: string[];
  /** All the cards at once, two to a row, with no arrows or strip (the home page). */
  grid?: boolean;
}) {
  const live = useChannelSummaries(initial);
  const now = live.now;
  // The home page shows a few channels; the Channels page shows them all.
  const channels = only ? live.channels.filter((c) => only.includes(c.slug)) : live.channels;
  const { playChannel, isOnChannel, source, status } = usePlayer();
  const track = useRef<HTMLOListElement>(null);
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);

  // Keep the small cover of the channel in front lined up in the strip below it.
  useEffect(() => {
    const row = strip.current;
    const chip = row?.children[index] as HTMLElement | undefined;
    if (!row || !chip) return;
    const r = row.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    row.scrollBy({ left: c.left + c.width / 2 - (r.left + r.width / 2), behavior: "smooth" });
  }, [index]);

  const go = (i: number) => {
    const list = track.current;
    const target = list?.children[Math.max(0, Math.min(channels.length - 1, i))] as HTMLElement | undefined;
    if (!list || !target) return;
    list.scrollTo({ left: target.offsetLeft - list.offsetLeft - (list.clientWidth - target.clientWidth) / 2, behavior: "smooth" });
  };

  // Which panel is centred, so the strip and arrows follow a swipe.
  const onScroll = () => {
    const list = track.current;
    if (!list) return;
    const mid = list.scrollLeft + list.clientWidth / 2;
    let best = 0;
    let dist = Infinity;
    Array.from(list.children).forEach((el, i) => {
      const e = el as HTMLElement;
      const d = Math.abs(e.offsetLeft - list.offsetLeft + e.clientWidth / 2 - mid);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best !== index) setIndex(best);
  };

  const airOf = (c: ChannelSummary) => {
    const tuned = isOnChannel(c.slug);
    const playing =
      tuned && source.kind === "channel" && source.track
        ? { track: source.track, startedAt: source.startedAt, endsAt: source.endsAt }
        : c.now;
    return playing && now !== null && now < playing.endsAt ? playing : null;
  };

  return (
    <div className={`${styles.stage} ${grid ? styles.grid : ""}`}>
      {!grid && (
        <div className={styles.controls}>
          <p className={`mono ${styles.count}`}>
            <span>{String(index + 1).padStart(2, "0")}</span> / {String(channels.length).padStart(2, "0")}
          </p>
          <div className={styles.arrows}>
            <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous channel">
              ←
            </button>
            <button type="button" onClick={() => go(index + 1)} disabled={index === channels.length - 1} aria-label="Next channel">
              →
            </button>
          </div>
        </div>
      )}

      <ol className={styles.track} ref={track} onScroll={grid ? undefined : onScroll}>
        {channels.map((c, i) => {
          const air = airOf(c);
          const tuned = isOnChannel(c.slug);
          const elapsed = air ? Math.max(0, (now ?? 0) - air.startedAt) : 0;
          const progress = air ? Math.min(1, elapsed / air.track.durationMs) : 0;
          const cover = c.cover ?? c.art;
          return (
            <li key={c.slug} className={`${styles.panel} ${tuned ? styles.tuned : ""} ${i === index ? styles.current : ""}`}>
              {cover && <span className={styles.bg} style={{ backgroundImage: `url(${cover})` }} aria-hidden="true" />}
              <div className={styles.content}>
                <p className={`mono ${styles.kicker}`}>
                  <span className="pip" aria-hidden="true" />
                  <span className={styles.kickText}>
                    {tuned ? (status === "loading" ? "Tuning in" : "You're listening") : "On air"} · {c.imprint}
                  </span>
                  <span className={`${styles.eq} ${air ? styles.eqLive : ""}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </p>
                <h3 className={`display ${styles.name}`}>{c.name}</h3>
                <p className={styles.song}>{(air ?? c.now)?.track.title}</p>
                <p className={`mono ${styles.artist}`}>{(air ?? c.now)?.track.artist}</p>
                <div className={styles.progress}>
                  <span className={styles.bar} aria-hidden="true">
                    <i style={{ transform: `scaleX(${progress})` }} />
                  </span>
                  <span className={`mono ${styles.time}`}>{air ? `-${mmss(air.endsAt - (now ?? 0))}` : ""}</span>
                </div>
                <div className={styles.row}>
                  <button
                    type="button"
                    className={`btn ${tuned ? "btn-ghost" : ""}`}
                    onClick={() => playChannel(c.slug, c.name, c.now)}
                    aria-pressed={tuned}
                  >
                    <span aria-hidden="true">{tuned ? "■" : "▶"}</span>
                    <span>{tuned ? "Stop" : "Tune in"}</span>
                    <span className="sr-only">{` ${c.name}`}</span>
                  </button>
                  <span className={`mono ${styles.songs}`}>{c.tracks} songs</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {!grid && (
        <div className={styles.strip} ref={strip} role="tablist" aria-label="Channels">
          {channels.map((c, i) => (
            <button
              key={c.slug}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`${styles.chip} ${i === index ? styles.chipOn : ""} ${isOnChannel(c.slug) ? styles.chipTuned : ""}`}
              onClick={() => go(i)}
              title={c.name}
            >
              {c.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.cover.replace("-600.jpg", "-300.jpg")} alt="" loading="lazy" />
              ) : (
                <span />
              )}
              <span className={`mono ${styles.chipName}`}>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
