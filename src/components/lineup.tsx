"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DAYS, STATION_TZ, WEEK, clock, localWeek, showGenre, showName, stationClock, toLocal, type Block, type LocalBlock } from "@/lib/station";
import { usePlayer } from "./player-provider";
import styles from "./lineup.module.css";

/** The timetable as the station runs it, used until the listener's clock is known (server render). */
const STATION_WEEK: LocalBlock[][] = WEEK.map((blocks) => blocks.map((b) => ({ ...b, from: b.start, to: b.end })));
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

/** Time-of-day filters, in the listener's own hours. Late night runs over midnight. */
const PERIODS: { name: string; spans: [number, number][] }[] = [
  { name: "Morning", spans: [[5, 12]] },
  { name: "Afternoon", spans: [[12, 17]] },
  { name: "Evening", spans: [[17, 21]] },
  { name: "Late night", spans: [[21, 24], [0, 5]] },
];
/** A show belongs to every period it overlaps, so 18:00–24:00 is both Evening and Late night. */
const inPeriod = (b: Block, name: string) =>
  PERIODS.find((p) => p.name === name)!.spans.some(([s, e]) => b.start < e && b.end > s);
/** The period a show starts in, for its tag. */
const periodOf = (b: Block) => PERIODS.find((p) => p.spans.some(([s, e]) => b.start >= s && b.start < e))!.name;

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

/** Calendar text needs commas, semicolons and backslashes escaped. */
const icsText = (s: string) => s.replace(/([,;\\])/g, "\\$1");
/** Station wall-clock time as calendar text; the date parts are read in UTC so nothing shifts them. */
function icsDate(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}0000`;
}

/** Pacific time rules, so calendar apps place each show right on both sides of a clock change. */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${STATION_TZ}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0800",
  "TZOFFSETTO:-0700",
  "TZNAME:PDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0700",
  "TZOFFSETTO:-0800",
  "TZNAME:PST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** Downloads a calendar file with every weekly slot of the given shows, each repeating weekly with a
 *  10-minute reminder. Events are written on the station's clock with its time zone, and the
 *  listener's calendar shows them in their own time. Phones open it straight into their calendar app. */
function downloadCalendar(labels: string[], name: string) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const st = stationClock(now);
  const today = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: STATION_TZ, year: "numeric", month: "numeric", day: "numeric" })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)]),
  );
  const events = WEEK.flatMap((blocks, d) =>
    blocks
      .filter((b) => labels.includes(b.label))
      .map((b) => {
        const date = today.day + ((d - st.day + 7) % 7);
        const start = Date.UTC(today.year, today.month - 1, date, b.start);
        const end = Date.UTC(today.year, today.month - 1, date, b.end);
        return [
          "BEGIN:VEVENT",
          `UID:${b.label.toLowerCase().replace(/\W+/g, "-")}-${d}-${b.start}@musicsquareradio.com`,
          `DTSTAMP:${stamp}`,
          `DTSTART;TZID=${STATION_TZ}:${icsDate(start)}`,
          `DTEND;TZID=${STATION_TZ}:${icsDate(end)}`,
          "RRULE:FREQ=WEEKLY",
          `SUMMARY:${icsText(`${showName(b.label)} on Musicsquare Radio`)}`,
          "DESCRIPTION:Listen live at https://musicsquareradio.com",
          "URL:https://musicsquareradio.com",
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${icsText(`${showName(b.label)} starts in 10 minutes`)}`,
          "TRIGGER:-PT10M",
          "END:VALARM",
          "END:VEVENT",
        ].join("\r\n");
      }),
  );
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Musicsquare Radio//Schedule//EN", "CALSCALE:GREGORIAN", ...VTIMEZONE, ...events, "END:VCALENDAR", ""].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Star({ on, label, toggle }: { on: boolean; label: string; toggle: (l: string) => void }) {
  return (
    <button type="button" className={`${styles.star} ${on ? styles.starOn : ""}`} onClick={() => toggle(label)} aria-pressed={on} aria-label={on ? `Remove ${showName(label)} from saved` : `Save ${showName(label)}`}>
      {on ? "★" : "☆"}
    </button>
  );
}

/** Touch screens (no hover): read as an external store so the server render and the browser agree. */
const NO_HOVER = "(hover: none)";
function subscribeNoHover(cb: () => void) {
  const mq = matchMedia(NO_HOVER);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** The record in the hero, with today's drop artist as its label; faster while the radio plays. */
export function Record({ image }: { image: string | null }) {
  const { status } = usePlayer();
  // With a mouse the tonearm rests beside the record and swings on while hovered. On touch screens
  // (no hover) it rests on the record, and a tap lifts it off or sets it back. Down while the radio plays.
  const noHover = useSyncExternalStore(subscribeNoHover, () => matchMedia(NO_HOVER).matches, () => false);
  const [hovered, setHovered] = useState(false);
  const [tappedUp, setTappedUp] = useState(false);
  const armDown = status === "playing" || (noHover ? !tappedUp : hovered);
  return (
    <div
      className={`${styles.recordWrap} ${armDown ? styles.armDown : ""}`}
      aria-hidden="true"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
      // Finger-up, not click: iPhone Safari's clicks don't say whether a finger made them.
      onPointerUp={(e) => e.pointerType !== "mouse" && setTappedUp((v) => !v)}
    >
      <div className={`${styles.record} ${status === "playing" ? styles.spinning : ""}`}>
        <div className={styles.label}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image && <img src={image} alt="" />}
          <i className={styles.spindle} />
        </div>
      </div>
      <i className={styles.sheen} />
      {/* Drawn in the record's own units (100 = its width); the arm pivots at (96, 4), just off the edge. */}
      <svg className={styles.tonearm} viewBox="0 0 100 100">
        <circle cx="96" cy="4" r="6.2" className={styles.armBase} />
        <g className={styles.arm}>
          <rect x="93.4" y="-7.5" width="5.2" height="5.5" rx="1.2" className={styles.armWeight} />
          <path d="M96 4 L95.2 66 L90.6 77" className={styles.armTube} />
          <g transform="rotate(24 90.6 77)">
            <rect x="87.6" y="76" width="6" height="9.5" rx="1" className={styles.headshell} />
            <rect x="89.1" y="85" width="3" height="2.2" rx="0.4" className={styles.stylus} />
          </g>
        </g>
        <circle cx="96" cy="4" r="2.4" className={styles.armPivot} />
      </svg>
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
 * seven cards (Full week), with time-of-day filters, saved shows and what's on now.
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
  // The station's timetable moved onto the listener's clock, refreshed when their day turns over.
  const nowDay = now?.day;
  const week = useMemo(() => (nowDay === undefined ? STATION_WEEK : localWeek()), [nowDay]);
  const weekStart = now?.day ?? 0;
  const liveOn = source.kind === "live" && status === "playing";

  const keep = useMemo(
    () => (b: Block) => (mood === "saved" ? saved.has(b.label) : !mood || inPeriod(b, mood)),
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
        {[null, ...PERIODS.map((p) => p.name), "saved"].map((m) => (
          <button key={m ?? "all"} type="button" className={`${styles.mood} ${mood === m ? styles.moodOn : ""}`} onClick={() => setMood(m)} aria-pressed={mood === m}>
            {m === null ? "All day" : m === "saved" ? `★ Saved${saved.size ? ` · ${saved.size}` : ""}` : m}
          </button>
        ))}
        {saved.size > 0 && (
          <button type="button" className={`${styles.mood} ${styles.calAll}`} onClick={() => downloadCalendar([...saved], "musicsquare-radio-saved-shows")}>
            + Add saved to calendar
          </button>
        )}
      </div>

      <div className={styles.meta}>
        <span className="mono">{view === "day" ? `${DAYS[shown]} / the lineup` : "The whole week, in rotation"}</span>
        <span className="mono">24-hour clock · all times local to you</span>
      </div>

      {view === "day" ? (
        <ol key={`${shown}-${mood}`} className={styles.list}>
          {week[shown].map((b, i) => {
            const on = isNow(shown, b);
            if (!keep(b) && !on) return null;
            const pct = on && now ? Math.round(((now.hour - b.from) / (b.to - b.from)) * 100) : 0;
            return (
              <li key={`${b.start}-${b.label}`} className={`${styles.row} ${on ? styles.rowNow : ""}`}>
                <span className={styles.time}>
                  {clock(b.start)}
                  <span>until {clock(b.end)}</span>
                </span>
                <span className={styles.show}>
                  <span className="mono">
                    {String(i + 1).padStart(2, "0")} / {String(week[shown].length).padStart(2, "0")}
                    {on ? " · on air now" : ""}
                  </span>
                  <b>{showName(b.label)}</b>
                  {showGenre(b.label) && <span className={`mono ${styles.genre}`}>{showGenre(b.label)}</span>}
                  {saved.has(b.label) && (
                    <button type="button" className={`mono ${styles.cal}`} onClick={() => downloadCalendar([b.label], showName(b.label).toLowerCase().replace(/\W+/g, "-"))}>
                      + Add to calendar
                    </button>
                  )}
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
                  <span className={`mono ${styles.tag}`}>{periodOf(b)}</span>
                )}
                <Star on={saved.has(b.label)} label={b.label} toggle={toggle} />
              </li>
            );
          })}
          {week[shown].every((b) => !keep(b) && !isNow(shown, b)) && (
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
        {/* The week starts on the listener's today, which gets the big gold sleeve. */}
        <div key={`week-${weekStart}-${mood}`} className={styles.week}>
          {WEEK.map((_, i) => (weekStart + i) % 7).map((d, pos) => {
            const blocks = week[d];
            return (
            <article key={d} className={`${styles.card} ${pos === 0 ? styles.lead : ""} ${[2, 3, 5].includes(pos) ? styles.paper : ""}`}>
              <header>
                <span className="mono">
                  Side {String(pos + 1).padStart(2, "0")} · {blocks.length} programmes
                  {now?.day === d ? " · today" : ""}
                </span>
                <h3 className="display">{SHORT[d]}.</h3>
                <p>{MOODS[d]}</p>
              </header>
              <ul>
                {blocks.filter((b) => keep(b) || isNow(d, b)).map((b) => (
                  <li key={`${b.start}-${b.label}`} className={isNow(d, b) ? styles.cardNow : ""}>
                    <span className="mono">
                      {clock(b.start)}–{clock(b.end)}
                    </span>
                    <b>{showName(b.label)}</b>
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
            );
          })}
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

/** Sunday's programmes for the Sunday section, in the listener's own time; a show that lands on
 *  another local day says which. Station times until the listener's clock is known. */
export function SundayTimes({ className }: { className?: string }) {
  const now = useNow();
  return (
    <ol className={className}>
      {WEEK[0].map((b) => {
        const local = now ? toLocal(0, b) : { day: 0, from: b.start, to: b.end };
        return (
          <li key={b.label}>
            <b>{showName(b.label)}</b>
            <span className="mono">
              {local.day !== 0 ? `${SHORT[local.day]} ` : ""}
              {clock(local.from)}–{clock(local.to)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
