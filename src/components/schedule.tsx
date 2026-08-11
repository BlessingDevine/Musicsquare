"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DAYS, WEEK } from "@/lib/station";
import { Reveal } from "./reveal";
import styles from "./schedule.module.css";

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

export function Schedule() {
  const [now, setNow] = useState<{ day: number; minutes: number } | null>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow({ day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Before mount there is no listener clock, so fall back to Monday rather
  // than guessing — the full week is one click away either way.
  const day = now?.day ?? 1;
  const hour = now ? Math.floor(now.minutes / 60) : null;
  const blocks = WEEK[day];

  return (
    <section id="schedule" className={styles.section}>
      <div className="wrap">
        <Reveal className={styles.head}>
          <p className="mono eyebrow">
            {now ? DAYS[day] : "Today"} on air · all times local to you
          </p>
          <h2 className={`display ${styles.title}`}>
            The day, in <em>blocks</em>
          </h2>
        </Reveal>

        {/* Twenty-four hours, drawn to scale. */}
        <Reveal className={styles.bar}>
          <div className={styles.track} aria-hidden="true">
            {blocks.map((block) => (
              <span
                key={block.start}
                className={`${styles.seg} ${
                  hour !== null && hour >= block.start && hour < block.end
                    ? styles.segLive
                    : ""
                }`}
                style={{ flexGrow: block.end - block.start }}
              />
            ))}
            {now && (
              <span
                className={styles.now}
                style={{ left: `${(now.minutes / 1440) * 100}%` }}
              />
            )}
          </div>
          <p className={`mono ${styles.ticks}`} aria-hidden="true">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </p>
        </Reveal>

        <table className={styles.table}>
          <caption className="mono">
            {now ? `${DAYS[day]}'s programming` : "Programming"}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="mono">
                Time
              </th>
              <th scope="col" className="mono">
                Block
              </th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => {
              const live = hour !== null && hour >= block.start && hour < block.end;
              return (
                <tr key={block.start} className={live ? styles.rowLive : ""}>
                  <td className="mono">
                    {hh(block.start)} — {hh(block.end)}
                  </td>
                  <th scope="row" className={`display ${styles.block}`}>
                    {block.label}
                    {live && (
                      <span className={`mono ${styles.badge}`}>
                        <span className="pip" aria-hidden="true" />
                        On air
                      </span>
                    )}
                  </th>
                </tr>
              );
            })}
          </tbody>
        </table>

        <Link href="/schedule" className={`mono ${styles.more}`}>
          The whole week, hour by hour &rarr;
        </Link>
      </div>
    </section>
  );
}
