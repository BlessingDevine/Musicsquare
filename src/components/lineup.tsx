"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DAYS, FAMILY_NAMES, WEEK, familyOf, type Block } from "@/lib/station";
import { usePlayer } from "./player-provider";
import styles from "./lineup.module.css";

const hhmm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
const SHORT = DAYS.map((d) => d.slice(0, 3));
/** One line per day, shown on the day's card. */
const MOODS = [
  "The Sunday reset.",
  "Start with a little rhythm.",
  "Take the scenic route.",
  "Your midweek mood lift.",
  "One step closer to the weekend.",
  "Clock out. Turn up.",
  "Stay out. Stay in. Press play.",
];
const SAVED_KEY = "msr-saved-shows";

/** The listener's own clock: the schedule runs in local time, like the rest of the site. */
function useNow() {
  const [now, setNow] = useState<{ day: number; hour: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow({ day: d.getDay(), hour: d.getHours() + d.getMinutes() / 60 });
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Starred shows (by name), kept in this browser only. Read as an external store so the server
 *  render (nothing saved) and the browser agree, then the stars appear. */
const savedListeners = new Set<() => void>();
function readSaved() {
  try {
    return localStorage.getItem(SAVED_KEY) ?? "[]";
  } catch {
    return "[]"; // Private window or blocked storage: stars just don't persist.
  }
}
function subscribeSaved(cb: () => void) {
  savedListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    savedListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function useSaved() {
  const raw = useSyncExternalStore(subscribeSaved, readSaved, () => "[]");
  const saved = useMemo(() => new Set<string>(JSON.parse(raw)), [raw]);
  const toggle = (label: string) => {
    const next = new Set(saved);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify([...next]));
    } catch {}
    savedListeners.forEach((l) => l());
  };
  return { saved, toggle };
}

function Star({ on, label, toggle }: { on: boolean; label: string; toggle: (l: string) => void }) {
  return (
    <button type="button" className={`${styles.star} ${on ? styles.starOn : ""}`} onClick={() => toggle(label)} aria-pressed={on} aria-label={on ? `Remove ${label} from saved` : `Save ${label}`}>
      {on ? "★" : "☆"}
    </button>
  );
}

/** The record in the hero, with today's drop artist as its label; faster while the radio plays. */
export function Record({ image }: { image: string | null }) {
  const { status } = usePlayer();
  return (
    <div className={styles.recordWrap} aria-hidden="true">
      <div className={`${styles.record} ${status === "playing" ? styles.spinning : ""}`}>
        <div className={styles.label}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image && <img src={image} alt="" />}
          <i className={styles.spindle} />
        </div>
      </div>
      <span className={`mono ${styles.sticker}`}>
        No skips.
        <br />
        Just discovery.
      </span>
    </div>
  );
}

/**
 * "What's your day sounding like?": the week as a running order (By day) or as
 * seven cards (Full week), with mood filters, saved shows and what's on now.
 */
export function Lineup() {
  const now = useNow();
  const { saved, toggle } = useSaved();
  const { status, source, toggleLive } = usePlayer();
  const [view, setView] = useState<"day" | "week">("day");
  const [day, setDay] = useState<number | null>(null);
  const [mood, setMood] = useState<string | null>(null);

  // Open on today, or on the day a link asked for (#sunday from "Explore Sunday").
  useEffect(() => {
    const pick = () => {
      const i = DAYS.findIndex((d) => `#${d.toLowerCase()}` === location.hash);
      if (i >= 0) {
        setDay(i);
        setView("day");
        document.getElementById("lineup")?.scrollIntoView({ behavior: "smooth" });
      }
    };
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
  }, []);
  const shown = day ?? now?.day ?? 0;
  const liveOn = source.kind === "live" && status === "playing";

  const keep = useMemo(
    () => (b: Block) => (mood === "saved" ? saved.has(b.label) : !mood || familyOf(b.label) === mood),
    [mood, saved],
  );
  const isNow = (d: number, b: Block) => !!now && now.day === d && now.hour >= b.start && now.hour < b.end;

  return (
    <section id="lineup" className={`wrap ${styles.section}`}>
      <div className={styles.head}>
        <div>
          <p className="mono eyebrow">Find your next favourite</p>
          <h2 className={`display ${styles.title}`}>
            What&rsquo;s your day <em>sounding like?</em>
          </h2>
          <p className={styles.lede}>Pick a day. Find a mood. Make yourself at home.</p>
        </div>
        <div className={styles.toggle} role="group" aria-label="View">
          <button type="button" className={view === "day" ? styles.toggleOn : ""} onClick={() => setView("day")} aria-pressed={view === "day"}>
            By day
          </button>
          <button type="button" className={view === "week" ? styles.toggleOn : ""} onClick={() => setView("week")} aria-pressed={view === "week"}>
            Full week
          </button>
        </div>
      </div>

      {view === "day" && (
        <div className={styles.days} role="tablist" aria-label="Day">
          {SHORT.map((d, i) => (
            <button key={d} type="button" role="tab" aria-selected={shown === i} className={`mono ${shown === i ? styles.dayOn : ""}`} onClick={() => setDay(i)}>
              {d}
              {now?.day === i && <span className="pip" aria-label="today" />}
            </button>
          ))}
        </div>
      )}

      <div className={styles.moods}>
        {[null, ...FAMILY_NAMES, "saved"].map((m) => (
          <button key={m ?? "all"} type="button" className={`${styles.mood} ${mood === m ? styles.moodOn : ""}`} onClick={() => setMood(m)} aria-pressed={mood === m}>
            {m === null ? "All sounds" : m === "saved" ? `★ Saved${saved.size ? ` · ${saved.size}` : ""}` : m}
          </button>
        ))}
      </div>

      <div className={styles.meta}>
        <span className="mono">{view === "day" ? `${DAYS[shown]} / the lineup` : "The whole week, in rotation"}</span>
        <span className="mono">24-hour clock · all times local to you</span>
      </div>

      {view === "day" ? (
        <ol key={`${shown}-${mood}`} className={styles.list}>
          {WEEK[shown].map((b, i) => {
            const on = isNow(shown, b);
            if (!keep(b) && !on) return null;
            const pct = on && now ? Math.round(((now.hour - b.start) / (b.end - b.start)) * 100) : 0;
            return (
              <li key={`${b.start}-${b.label}`} className={`${styles.row} ${on ? styles.rowNow : ""}`}>
                <span className={styles.time}>
                  {hhmm(b.start)}
                  <span>until {hhmm(b.end)}</span>
                </span>
                <span className={styles.show}>
                  <span className="mono">
                    {String(i + 1).padStart(2, "0")} / {String(WEEK[shown].length).padStart(2, "0")}
                    {on ? " · on air now" : ""}
                  </span>
                  <b>{b.label}</b>
                  {on && (
                    <span className={styles.progress} aria-label={`${pct}% through`}>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </span>
                {on ? (
                  <button type="button" className={`btn ${styles.listen}`} onClick={toggleLive} aria-pressed={liveOn}>
                    <span aria-hidden="true">{liveOn ? "■" : "▶"}</span> {liveOn ? "Stop" : "Listen live"}
                  </button>
                ) : (
                  <span className={`mono ${styles.tag}`}>{familyOf(b.label)}</span>
                )}
                <Star on={saved.has(b.label)} label={b.label} toggle={toggle} />
              </li>
            );
          })}
          {WEEK[shown].every((b) => !keep(b) && !isNow(shown, b)) && (
            <li className={styles.empty}>{mood === "saved" ? "Nothing saved on this day yet. Tap ☆ on any show to keep it here." : "Nothing in this mood on this day. Try another day."}</li>
          )}
        </ol>
      ) : (
        <div className={styles.festival}>
        <div className={styles.festHead}>
          <div>
            <p className="mono">The Musicsquare Weekender · all week</p>
            <h3 className="display">
              Seven days.
              <br />
              <em>So many good moods.</em>
            </h3>
          </div>
          <span className={`mono ${styles.stamp}`}>
            <b>24/7</b>
            In good rotation
          </span>
        </div>
        <div key={`week-${mood}`} className={styles.week}>
          {WEEK.map((blocks, d) => (
            <article key={d} className={`${styles.card} ${styles[`card${d}`]} ${now?.day === d ? styles.cardToday : ""}`}>
              <header>
                <span className="mono">
                  Side {String(d + 1).padStart(2, "0")} · {blocks.length} programmes
                  {now?.day === d ? " · today" : ""}
                </span>
                <h3 className="display">{SHORT[d]}.</h3>
                <p>{MOODS[d]}</p>
              </header>
              <ul>
                {blocks.filter((b) => keep(b) || isNow(d, b)).map((b) => (
                  <li key={`${b.start}-${b.label}`} className={isNow(d, b) ? styles.cardNow : ""}>
                    <span className="mono">
                      {hhmm(b.start)}–{hhmm(b.end)}
                    </span>
                    <b>{b.label}</b>
                    <Star on={saved.has(b.label)} label={b.label} toggle={toggle} />
                  </li>
                ))}
              </ul>
              {d === 0 && (
                <p className={styles.slogan}>
                  Take your time.
                  <br />
                  We&rsquo;ve got the music.
                </p>
              )}
              <button
                type="button"
                className={`mono ${styles.dayView}`}
                onClick={() => {
                  setDay(d);
                  setView("day");
                  document.getElementById("lineup")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                {DAYS[d]} · day view ↗
              </button>
            </article>
          ))}
        </div>
        <p className={`mono ${styles.festFoot}`}>
          <span>✱ A whole week of &ldquo;where did you find this?&rdquo;</span>
          <span>All times local to you · tap ☆ to keep your favourites</span>
        </p>
        </div>
      )}
    </section>
  );
}
