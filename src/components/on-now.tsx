"use client";

import { useEffect, useState } from "react";
import { DAYS, blockAt, familyOf, nextBlock } from "@/lib/station";
import { usePlayer } from "./player-provider";
import styles from "./on-now.module.css";

const hhmm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** Local clock time a track started or is due, e.g. "21:04". */
function at(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The seam between the dark station and the light archive — and the most
 * useful thing on the page: the three tracks either side of now, with the
 * programming block underneath for context.
 */
export function OnNow() {
  const { live } = usePlayer();
  const [now, setNow] = useState<{ day: number; hour: number } | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow({ day: d.getDay(), hour: d.getHours() });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const block = now ? blockAt(now.day, now.hour) : null;
  const upcoming = now ? nextBlock(now.day, now.hour) : null;

  return (
    <div className={`on-ink ${styles.strip}`}>
      <div className={`wrap ${styles.inner}`}>
        <section className={styles.col}>
          <p className={`mono ${styles.tag} ${styles.tagQuiet}`}>Just played</p>
          {live.history.length ? (
            <ol className={styles.history}>
              {live.history.map((track) => (
                <li key={`${track.title}-${track.startedAt}`}>
                  <span className={styles.pastTitle}>{track.title}</span>
                  <span className={`mono ${styles.pastMeta}`}>
                    {at(track.startedAt) ?? track.artist}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={`mono ${styles.detail}`}>Building the log</p>
          )}
        </section>

        <section className={`${styles.col} ${styles.colNow}`}>
          <p className={`mono ${styles.tag}`}>
            <span className="pip" aria-hidden="true" />
            On air
          </p>
          <p className={styles.show}>{live.current?.title ?? "Musicsquare Radio"}</p>
          <p className={`mono ${styles.detail}`}>
            {live.current?.artist ?? "Live stream"}
          </p>
          <p className={`mono ${styles.block}`}>
            {block
              ? `${block.label} · ${hhmm(block.start)}–${hhmm(block.end)} · ${familyOf(block.label) ?? ""}`
              : "Streaming 24/7"}
          </p>
        </section>

        <section className={styles.col}>
          <p className={`mono ${styles.tag} ${styles.tagQuiet}`}>Up next</p>
          {live.next ? (
            <>
              <p className={styles.showNext}>{live.next.title}</p>
              <p className={`mono ${styles.detail}`}>
                {live.next.artist}
                {at(live.next.startedAt) ? ` · ${at(live.next.startedAt)}` : ""}
              </p>
            </>
          ) : (
            <p className={`mono ${styles.detail}`}>Queued by the station</p>
          )}
          {upcoming && (
            <p className={`mono ${styles.block}`}>
              Then {upcoming.block.label}
              {upcoming.tomorrow ? `, ${DAYS[upcoming.day]}` : ""} from{" "}
              {hhmm(upcoming.block.start)}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
