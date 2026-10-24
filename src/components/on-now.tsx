"use client";

import { useEffect, useState } from "react";
import { DAYS, clock, familyOf, localWeek } from "@/lib/station";
import { usePlayer } from "./player-provider";
import styles from "./on-now.module.css";

/** Local clock time a track started or is due, e.g. "21:04". */
function at(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A song title that opens its squaredrum.com page when it has one. */
function SongTitle({ title, page, className }: { title: string; page?: string | null; className?: string }) {
  if (!page) return <span className={className}>{title}</span>;
  return (
    <a className={`${className ?? ""} ${styles.songLink}`} href={page} target="_blank" rel="noopener" title="Open on squaredrum.com">
      {title} <span aria-hidden="true">↗</span>
    </a>
  );
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
      setNow({ day: d.getDay(), hour: d.getHours() + d.getMinutes() / 60 });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // The station's timetable on the listener's clock. A block split at local midnight continues
  // into the next day with \`from\` < 0, so only pieces with \`from\` >= 0 count as a show starting.
  const week = now ? localWeek() : null;
  const today = now && week ? week[now.day] : [];
  const block = now ? today.find((b) => now.hour >= b.start && now.hour < b.end) ?? null : null;
  const laterToday = now ? today.find((b) => b.start > now.hour && b.from >= 0) : undefined;
  const nextDay = now ? (now.day + 1) % 7 : 0;
  const upcoming = !now || !week
    ? null
    : laterToday
      ? { block: laterToday, day: now.day, tomorrow: false }
      : { block: week[nextDay].find((b) => b.from >= 0)!, day: nextDay, tomorrow: true };

  return (
    <div className={`on-ink ${styles.strip}`}>
      <div className={`wrap ${styles.inner}`}>
        <section className={styles.col}>
          <p className={`mono ${styles.tag} ${styles.tagQuiet}`}>Just played</p>
          {live.history.length ? (
            <ol className={styles.history}>
              {live.history.map((track) => (
                <li key={`${track.title}-${track.startedAt}`}>
                  <SongTitle className={styles.pastTitle} title={track.title} page={track.page} />
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
          <p className={styles.show}>
            <SongTitle title={live.current?.title ?? "Musicsquare Radio"} page={live.current?.page} />
          </p>
          <p className={`mono ${styles.detail}`}>
            {live.current?.artist ?? "Live stream"}
          </p>
          <p className={`mono ${styles.block}`}>
            {block
              ? `${block.label} · ${clock(block.from)}–${clock(block.to)} · ${familyOf(block.label) ?? ""}`
              : "Streaming 24/7"}
          </p>
        </section>

        <section className={styles.col}>
          <p className={`mono ${styles.tag} ${styles.tagQuiet}`}>Up next</p>
          {live.next ? (
            <>
              <p className={styles.showNext}>
                <SongTitle title={live.next.title} page={live.next.page} />
              </p>
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
              {clock(upcoming.block.from)}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
