"use client";

import Image from "next/image";
import type { Drop as DropData } from "@/lib/drop";
import { usePlayer } from "./player-provider";
import { Reveal } from "./reveal";
import styles from "./drop.module.css";

const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "2026-10-06" -> "Tue 6 Oct", read as a calendar date, not a moment. */
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`))
    .replace(",", "");

/**
 * Today's drop: picked on the server from the catalogue (src/lib/drop.ts) —
 * a different roster artist every day at midnight Pacific.
 */
export function Drop({ drop }: { drop: DropData | null }) {
  const { playTrack, isPlaying, status, source } = usePlayer();
  if (!drop) return null;
  const playing = isPlaying(drop.src);
  const loading = status === "loading" && source.kind === "track" && source.url === drop.src;

  return (
    <section id="drop" className={styles.section}>
      <div className={`wrap ${styles.inner}`}>
        <Reveal className={styles.art}>
          <Image
            src={drop.portrait}
            alt={drop.artist}
            fill
            sizes="(max-width: 900px) 100vw, 46vw"
            className={styles.img}
          />
        </Reveal>

        <Reveal className={styles.body}>
          <p className="mono eyebrow">Today&rsquo;s drop · {dayLabel(drop.date)}</p>

          <h2 className={`display ${styles.title}`}>{drop.title}</h2>
          <p className={styles.by}>
            <span>{drop.artist}</span>
            <em>{drop.lane}</em>
          </p>

          <p className={styles.note}>
            {[drop.album && `From ${drop.album}`, drop.imprint].filter(Boolean).join(" · ")}
            {drop.album || drop.imprint ? ". " : ""}A new drop, from a different artist,
            every day at midnight Pacific.
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className="btn"
              onClick={() => playTrack({ url: drop.src, title: drop.title, artist: drop.artist })}
              aria-pressed={playing}
            >
              <span aria-hidden="true">{playing ? "■" : "▶"}</span>
              <span>
                {playing ? "Stop" : loading ? "Loading" : `Play the drop · ${mmss(drop.durationMs)}`}
              </span>
            </button>
            <p className={`mono ${styles.hint}`}>Playing the drop pauses the live stream</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
