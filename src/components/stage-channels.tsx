"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChannelSummary } from "@/lib/channel-summary";
import { useChannelSummaries } from "./live-channels";
import { usePlayer } from "./player-provider";
import styles from "./stage-channels.module.css";

// How far an element's centre is from the middle of its scrolling row, in pixels.
const offCentre = (row: HTMLElement, el: Element) => {
  const r = row.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  return e.left + e.width / 2 - (r.left + r.width / 2);
};

// The copy of item i (of n, repeated) that is nearest the middle of the row.
const nearest = (row: HTMLElement, n: number, i: number) => {
  let best: Element | undefined;
  let dist = Infinity;
  for (let k = i; k < row.children.length; k += n) {
    const d = Math.abs(offCentre(row, row.children[k]));
    if (d < dist) {
      dist = d;
      best = row.children[k];
    }
  }
  return best;
};

// Which item sits in the middle of the row, as a position in the repeated list.
const centred = (row: HTMLElement) => {
  let best = 0;
  let dist = Infinity;
  Array.from(row.children).forEach((el, k) => {
    const d = Math.abs(offCentre(row, el));
    if (d < dist) {
      dist = d;
      best = k;
    }
  });
  return best;
};

// Once a row has stopped, quietly swap an outer copy for the same item in the
// middle copy, so there are always channels either side and the loop never ends.
const recentre = (row: HTMLElement | null, n: number) => {
  if (!row || n < 2) return;
  const k = centred(row);
  const copy = Math.floor(k / n);
  if (copy === 1) return;
  const twin = row.children[(k % n) + n];
  row.scrollTo({ left: row.scrollLeft + offCentre(row, twin) - offCentre(row, row.children[k]), behavior: "instant" });
};

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Design C — the stage. One channel at a time, as a big panel with the cover
 * of the song on air filling it; swipe (or use the arrows) to the next
 * station, or jump with the strip of covers underneath. Both rows loop (the
 * list is drawn three times and kept on the middle copy), so there are always
 * channels on both sides — after the last channel comes the first again.
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
  const n = channels.length;
  const copies = grid || n < 2 ? 1 : 3;
  const loop = Array.from({ length: copies }, (_, copy) => channels.map((c, i) => ({ c, i, copy }))).flat();
  const settle = useRef<{ track?: ReturnType<typeof setTimeout>; strip?: ReturnType<typeof setTimeout> }>({});

  // Open on the middle copy, first channel centred, with the others either side.
  useLayoutEffect(() => {
    if (copies === 1) return;
    for (const row of [track.current, strip.current]) {
      const first = row?.children[n];
      if (row && first) row.scrollTo({ left: row.scrollLeft + offCentre(row, first), behavior: "instant" });
    }
    track.current?.setAttribute("data-ready", "");
  }, [copies, n]);

  // The strip keeps the playing channel's small cover in the middle, so it's
  // always there to tap back to while you browse; with nothing playing, it
  // follows the card in front.
  const playing = channels.findIndex((c) => isOnChannel(c.slug));
  const chipAt = playing >= 0 ? playing : index;

  // Where the strip has been sent ahead of time (arrows, a strip cover, Tune in),
  // so it heads straight there instead of chasing each card the track passes.
  const heading = useRef<number | null>(null);

  // Line the small cover of channel i up in the middle of the strip, under the card in front.
  const centreChip = (i: number) => {
    const row = strip.current;
    const chip = row && nearest(row, n, i);
    if (!row || !chip) return;
    row.scrollTo({ left: row.scrollLeft + offCentre(row, chip), behavior: "smooth" });
  };

  useEffect(() => {
    if (heading.current !== null) {
      if (chipAt === heading.current) heading.current = null;
      return;
    }
    centreChip(chipAt);
    // Only when the cover to show changes; centreChip reads the rows directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipAt]);

  const go = (i: number, chipTo?: number) => {
    const list = track.current;
    if (!list || !n) return;
    // The arrows wrap round: before the first channel is the last.
    const to = ((i % n) + n) % n;
    const target = nearest(list, n, to);
    if (!target) return;
    list.scrollTo({ left: list.scrollLeft + offCentre(list, target), behavior: "smooth" });
    const chip = chipTo ?? (playing >= 0 ? playing : to);
    heading.current = chip === chipAt ? null : chip;
    centreChip(chip);
  };

  // Which panel is centred, so the strip and arrows follow a swipe; once the
  // row comes to rest, move back onto the middle copy.
  const onScroll = () => {
    const list = track.current;
    if (!list || !n) return;
    const best = centred(list) % n;
    if (best !== index) setIndex(best);
    clearTimeout(settle.current.track);
    settle.current.track = setTimeout(() => recentre(track.current, n), 180);
  };

  const onStripScroll = () => {
    clearTimeout(settle.current.strip);
    settle.current.strip = setTimeout(() => recentre(strip.current, n), 180);
  };

  const airOf = (c: ChannelSummary) => {
    const tuned = isOnChannel(c.slug);
    const playing =
      tuned && source.kind === "channel" && source.track
        ? { track: source.track, startedAt: source.startedAt, endsAt: source.endsAt }
        : c.now;
    return playing && now !== null && now < playing.endsAt ? playing : null;
  };

  const [peek, setPeek] = useState<string | null>(null);

  // Phones, home grid: tuning in from a card grows it to fill the screen; Stop (or "↓") shrinks it
  // back into its place. A placeholder keeps its slot in the grid while it's out.
  const [open, setOpen] = useState<{ slug: string; height: number } | null>(null);
  const cards = useRef<Record<string, HTMLLIElement | null>>({});
  const slot = useRef<HTMLLIElement>(null);
  const from = useRef<DOMRect | null>(null);
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const squeeze = (r: DOMRect) =>
    `translate(${r.left}px, ${r.top}px) scale(${r.width / innerWidth}, ${r.height / innerHeight})`;

  const grow = (slug: string) => {
    const el = cards.current[slug];
    if (!el) return;
    from.current = el.getBoundingClientRect();
    setPeek(null);
    setOpen({ slug, height: from.current.height });
  };

  const shrink = () => {
    const el = open && cards.current[open.slug];
    // Content above can change height while it's open (the hero's player controls come and go), so
    // first line the page up to put the card's slot back where it was tapped, then shrink into it.
    if (slot.current && from.current) window.scrollBy(0, slot.current.getBoundingClientRect().top - from.current.top);
    const to = slot.current?.getBoundingClientRect();
    const done = () => setOpen(null);
    if (!el || !to || still()) return done();
    el.animate([{ transform: "none", borderRadius: "0px" }, { transform: squeeze(to), borderRadius: "14px" }], {
      duration: 420,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    }).onfinish = done;
  };

  // Grow from the card's own spot to the full screen, and hold the page still behind it.
  useLayoutEffect(() => {
    if (!open) return;
    const el = cards.current[open.slug];
    if (el && from.current && !still()) {
      el.animate([{ transform: squeeze(from.current), borderRadius: "14px" }, { transform: "none", borderRadius: "0px" }], {
        duration: 460,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    }
    document.documentElement.setAttribute("data-channel-open", "");
    return () => document.documentElement.removeAttribute("data-channel-open");
  }, [open]);

  // Stopped from anywhere (this card, the player bar, another channel): shrink it back.
  const openSlug = open?.slug;
  const openPlaying = openSlug ? isOnChannel(openSlug) : false;
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (!openSlug) {
      wasPlaying.current = false;
      return;
    }
    if (openPlaying) wasPlaying.current = true;
    else if (wasPlaying.current) shrink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSlug, openPlaying]);

  return (
    <div className={`${styles.stage} ${grid ? styles.grid : ""}`}>
      {!grid && (
        <div className={styles.controls}>
          <p className={`mono ${styles.count}`}>
            <span>{String(index + 1).padStart(2, "0")}</span> / {String(channels.length).padStart(2, "0")}
          </p>
          <div className={styles.arrows}>
            <button type="button" onClick={() => go(index - 1)} aria-label="Previous channel">
              ←
            </button>
            <button type="button" onClick={() => go(index + 1)} aria-label="Next channel">
              →
            </button>
          </div>
        </div>
      )}

      <ol className={`${styles.track} ${copies > 1 ? styles.loop : ""}`} ref={track} onScroll={grid ? undefined : onScroll}>
        {loop.map(({ c, i, copy }) => {
          const air = airOf(c);
          const tuned = isOnChannel(c.slug);
          const elapsed = air ? Math.max(0, (now ?? 0) - air.startedAt) : 0;
          const progress = air ? Math.min(1, elapsed / air.track.durationMs) : 0;
          const cover = c.cover ?? c.art;
          return (
            // The outer copies are there to look at and tap; screen readers and the
            // keyboard get the middle one only.
            <Fragment key={`${c.slug}:${copy}`}>
            {open?.slug === c.slug && <li ref={slot} className={styles.slot} style={{ height: open.height }} aria-hidden="true" />}
            <li
              ref={(el) => {
                cards.current[c.slug] = el;
              }}
              className={`${styles.panel} ${tuned ? styles.tuned : ""} ${i === index ? styles.current : ""} ${grid && peek === c.slug ? styles.peek : ""} ${open?.slug === c.slug ? styles.open : ""}`}
              aria-hidden={copy !== 1 && copies > 1 ? true : undefined}
              // Touch screens have no hover: a tap lifts the card (and drops the one lifted before).
              // Read on finger-up: iPhone Safari's click events don't say whether a finger made them,
              // and a swipe that scrolls the page ends in pointercancel, so it doesn't count.
              onPointerUp={grid && open?.slug !== c.slug ? (e) => e.pointerType !== "mouse" && setPeek((p) => (p === c.slug ? null : c.slug)) : undefined}
            >
              {cover && (
                <span
                  className={styles.bg}
                  // Cards use the 600px cover. Filling a phone screen, the full 1000px one is layered on
                  // top: the 600 shows at once and the sharp one takes over as soon as it has loaded.
                  style={{
                    backgroundImage:
                      open?.slug === c.slug && /-600\.jpg$/.test(cover)
                        ? `url(${cover.replace(/-600\.jpg$/, ".jpg")}), url(${cover})`
                        : `url(${cover})`,
                  }}
                  aria-hidden="true"
                />
              )}
              <div className={styles.content}>
                {open?.slug === c.slug && (
                  <button type="button" className={styles.shrink} onClick={shrink} aria-label="Back to the channels (keeps playing)">
                    ↓
                  </button>
                )}
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
                    onClick={() => {
                      // Phones, home grid: tuning in grows the card to fill the screen.
                      if (grid && !tuned && matchMedia("(max-width: 620px)").matches) grow(c.slug);
                      playChannel(c.slug, c.name, c.now);
                      // Bring the card you've just tuned in to into the middle.
                      if (!grid && !tuned) go(i, i);
                    }}
                    aria-pressed={tuned}
                    tabIndex={copy !== 1 && copies > 1 ? -1 : undefined}
                  >
                    <span aria-hidden="true">{tuned ? "■" : "▶"}</span>
                    <span>{tuned ? "Stop" : "Tune in"}</span>
                    <span className="sr-only">{` ${c.name}`}</span>
                  </button>
                  <span className={`mono ${styles.songs}`}>{c.tracks} songs</span>
                </div>
                {open?.slug === c.slug && !!c.upcoming?.length && (
                  <div className={styles.upNext}>
                    <p className="mono">Up next</p>
                    <ol>
                      {c.upcoming.map((u, k) => (
                        <li key={`${k}-${u.title}`}>
                          <span className={styles.upCover} style={u.cover ? { backgroundImage: `url(${u.cover})` } : undefined} aria-hidden="true" />
                          <b>{u.title}</b>
                          <span className="mono">{u.artist}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </li>
            </Fragment>
          );
        })}
      </ol>

      {!grid && (
        <div className={styles.strip} ref={strip} onScroll={onStripScroll} role="tablist" aria-label="Channels">
          {loop.map(({ c, i, copy }) => (
            <button
              key={`${c.slug}:${copy}`}
              type="button"
              role={copy === 1 ? "tab" : undefined}
              aria-selected={copy === 1 ? i === index : undefined}
              aria-hidden={copy !== 1 ? true : undefined}
              tabIndex={copy !== 1 ? -1 : undefined}
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
