"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { DROP } from "@/lib/station";
import { usePlayer } from "./player-provider";
import { Reveal } from "./reveal";
import styles from "./drop.module.css";

const DAY_MS = 86_400_000;

/** Which day of the rotation today is, counted from the listener's own date. */
function rotationDay() {
  const start = new Date(`${DROP.rotationStart}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const elapsed = Math.floor((today.getTime() - start.getTime()) / DAY_MS);
  if (elapsed < 0) return null;
  return (elapsed % DROP.rotationLength) + 1;
}

export function Drop() {
  const { playTrack, isPlaying, status, source } = usePlayer();
  const playing = isPlaying(DROP.audio);
  const loading = status === "loading" && source.kind === "track";

  // Computed after mount so the label follows the visitor's date, and so the
  // server and first client render agree.
  const [day, setDay] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setDay(rotationDay());
    tick();
    const id = setInterval(tick, 60 * 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="drop" className={styles.section}>
      <div className={`wrap ${styles.inner}`}>
        <Reveal className={styles.art}>
          <Image
            src={DROP.artwork}
            alt={`${DROP.title} by ${DROP.artist}`}
            fill
            sizes="(max-width: 900px) 100vw, 46vw"
            className={styles.img}
          />
        </Reveal>

        <Reveal className={styles.body}>
          <p className="mono eyebrow">
            Today&rsquo;s drop
            {day ? ` · Day ${day} of ${DROP.rotationLength}` : ""}
          </p>

          <h2 className={`display ${styles.title}`}>{DROP.title}</h2>
          <p className={styles.by}>
            <span>{DROP.artist}</span>
            <em>{DROP.lane}</em>
          </p>

          <p className={styles.note}>{DROP.note}</p>

          <div className={styles.actions}>
            <button
              type="button"
              className="btn"
              onClick={() =>
                playTrack({ url: DROP.audio, title: DROP.title, artist: DROP.artist })
              }
              aria-pressed={playing}
            >
              <span aria-hidden="true">{playing ? "■" : "▶"}</span>
              <span>
                {playing ? "Stop" : loading ? "Loading" : `Play the drop · ${DROP.duration}`}
              </span>
            </button>
            <p className={`mono ${styles.hint}`}>
              Playing the drop pauses the live stream
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
