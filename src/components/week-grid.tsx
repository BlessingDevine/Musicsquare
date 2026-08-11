"use client";

import { useEffect, useRef, useState } from "react";
import {
  DAYS,
  FAMILY_NAMES,
  WEEK,
  familyOf,
} from "@/lib/station";
import styles from "./week-grid.module.css";

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const RAIL = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** Tone index for a block, so the grid reads without any colour. */
function tone(label: string) {
  const family = familyOf(label);
  return family ? FAMILY_NAMES.indexOf(family) : FAMILY_NAMES.length;
}

type Clock = { day: number; minutes: number };

export function WeekGrid() {
  const [now, setNow] = useState<Clock | null>(null);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const dayStrip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow({ day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Derived rather than synced: today once the listener's clock is known,
  // Monday before that so the server and first client paint agree, and
  // whatever they tapped the moment they tap it.
  const day = openDay ?? now?.day ?? 1;

  /** Arrow keys move between days, as the tab pattern expects. */
  const onTabKey = (e: React.KeyboardEvent) => {
    const step =
      e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "Home" ? -day : e.key === "End" ? 6 - day : 0;
    if (!step && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const target = (day + step + 7) % 7;
    setOpenDay(target);
    dayStrip.current
      ?.querySelector<HTMLButtonElement>(`#daytab-${target}`)
      ?.focus();
  };
  const hour = now ? Math.floor(now.minutes / 60) : null;
  const isLive = (d: number, b: { start: number; end: number }) =>
    now !== null && d === now.day && hour !== null && hour >= b.start && hour < b.end;

  return (
    <>
      {/* ---------- desktop: the whole week at once ----------
          Real sections and lists rather than `role="table"` — the blocks are
          absolutely positioned, so a table role would announce a grid that has
          no rows or cells inside it. */}
      <div className={styles.grid}>
        <div className={styles.rail} aria-hidden="true">
          {RAIL.map((h) => (
            <span key={h} className="mono" style={{ top: `${(h / 24) * 100}%` }}>
              {hh(h)}
            </span>
          ))}
        </div>

        {WEEK.map((blocks, d) => (
          <section key={d} className={styles.column} aria-labelledby={`day-${d}`}>
            <h3
              id={`day-${d}`}
              className={`mono ${styles.dayHead} ${d === now?.day ? styles.today : ""}`}
            >
              <span aria-hidden="true">{DAYS[d].slice(0, 3)}</span>
              <span className={styles.srOnly}>
                {DAYS[d]}
                {d === now?.day ? " (today)" : ""}
              </span>
              {d === now?.day && <span className="pip" aria-hidden="true" />}
            </h3>

            <ol className={styles.day}>
              {blocks.map((block) => (
                <li
                  key={block.start}
                  className={`${styles.block} ${
                    isLive(d, block) ? styles.blockLive : ""
                  }`}
                  data-tone={tone(block.label)}
                  style={{
                    top: `${(block.start / 24) * 100}%`,
                    height: `${((block.end - block.start) / 24) * 100}%`,
                  }}
                >
                  <span className={styles.blockName}>{block.label}</span>
                  <span className={`mono ${styles.blockTime}`}>
                    {hh(block.start)}–{hh(block.end)}
                  </span>
                  {isLive(d, block) && <span className={styles.srOnly}>On air now</span>}
                </li>
              ))}

              {now && d === now.day && (
                <li
                  className={styles.nowLine}
                  style={{ top: `${(now.minutes / 1440) * 100}%` }}
                  aria-hidden="true"
                />
              )}
            </ol>
          </section>
        ))}
      </div>

      {/* ---------- phones: one day at a time ---------- */}
      <div className={styles.mobile}>
        <div
          className={styles.dayStrip}
          ref={dayStrip}
          role="tablist"
          aria-label="Day"
          onKeyDown={onTabKey}
        >
          {DAYS.map((name, d) => (
            <button
              key={name}
              id={`daytab-${d}`}
              type="button"
              role="tab"
              aria-selected={d === day}
              aria-controls="day-panel"
              // Roving tabindex: one stop for the whole strip, arrows move within.
              tabIndex={d === day ? 0 : -1}
              className={`mono ${styles.dayTab} ${d === day ? styles.dayTabOn : ""}`}
              onClick={() => setOpenDay(d)}
            >
              <span aria-hidden="true">{name.slice(0, 3)}</span>
              <span className={styles.srOnly}>
                {name}
                {d === now?.day ? " (today)" : ""}
              </span>
              {d === now?.day && <span className={styles.dot} aria-hidden="true" />}
            </button>
          ))}
        </div>

        <ol
          className={styles.list}
          id="day-panel"
          role="tabpanel"
          aria-labelledby={`daytab-${day}`}
          tabIndex={0}
        >
          {WEEK[day].map((block) => (
            <li
              key={block.start}
              className={isLive(day, block) ? styles.listLive : ""}
              data-tone={tone(block.label)}
            >
              <span className={`mono ${styles.listTime}`}>
                {hh(block.start)}
                <em>{hh(block.end)}</em>
              </span>
              <span className={styles.listName}>
                {block.label}
                {isLive(day, block) && (
                  <span className={`mono ${styles.listBadge}`}>
                    <span className="pip" aria-hidden="true" />
                    On air
                  </span>
                )}
              </span>
              <span className={`mono ${styles.listFamily}`}>
                {familyOf(block.label) ?? "—"}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* The tonal scale means nothing unless it is spelled out. */}
      <ul className={`mono ${styles.key}`}>
        {FAMILY_NAMES.map((name, i) => (
          <li key={name}>
            <span data-tone={i} aria-hidden="true" />
            {name}
          </li>
        ))}
      </ul>
    </>
  );
}
