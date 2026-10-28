"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "./player-provider";
import styles from "./player-extras.module.css";

const SITE = "https://musicsquareradio.com";
// Each tap moves the sleep timer on to the next choice; after the last one it switches off.
const STEPS = [15, 30, 60, 90];

/** How long the pills stay out on phones before folding to the side. */
const FOLD_AFTER = 3000;

/**
 * Sleep timer and "share what's playing", shown beside the player while
 * something plays (hero console and the docked player bar).
 *
 * With `icons` (the hero's Listen live button) they're just the two icons,
 * sitting on the right end of the gold button.
 *
 * With `fold` on (the docked bar while it shows), phones fold the two pills
 * into a small tab at the side 3 s after play starts, so the song title has
 * room; tapping the tab brings them back for another 3 s. Wider screens
 * always show them.
 */
export function PlayerExtras({
  tabbable = true,
  fold = false,
  icons = false,
}: {
  tabbable?: boolean;
  fold?: boolean;
  icons?: boolean;
}) {
  const { source, now, sleepAt, setSleepTimer } = usePlayer();
  const [left, setLeft] = useState<number | null>(null);
  const [shared, setShared] = useState(false);
  const [folded, setFolded] = useState(false);
  // Bumped on each tap so the 3 s count starts again.
  const [wake, setWake] = useState(0);

  useEffect(() => {
    if (!fold) return;
    const id = setTimeout(
      () => setFolded(matchMedia("(max-width: 640px)").matches),
      FOLD_AFTER,
    );
    return () => {
      clearTimeout(id);
      setFolded(false);
    };
  }, [fold, wake]);
  const keepOpen = () => setWake((n) => n + 1);

  // Minutes left on the sleep timer, refreshed every 15 s.
  useEffect(() => {
    if (!sleepAt) return;
    const tick = () =>
      setLeft(Math.max(1, Math.ceil((sleepAt - Date.now()) / 60_000)));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [sleepAt]);

  function cycleSleep() {
    keepOpen();
    if (!sleepAt) return setSleepTimer(STEPS[0]);
    const i = STEPS.findIndex((m) => m >= (left ?? 0));
    setSleepTimer(i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null);
  }

  async function share() {
    keepOpen();
    const title =
      source.kind === "channel"
        ? source.track?.title
        : source.kind === "track"
          ? source.title
          : now?.title;
    const artist =
      source.kind === "channel"
        ? source.track?.artist
        : source.kind === "track"
          ? source.artist
          : now?.artist;
    const where =
      source.kind === "channel"
        ? `the ${source.name} channel on Musicsquare Radio`
        : "Musicsquare Radio";
    const text = title
      ? `Listening to “${title}”${artist ? ` by ${artist}` : ""} on ${where}`
      : `Listening to ${where}`;
    const url = source.kind === "channel" ? `${SITE}/channels` : SITE;
    try {
      if (navigator.share)
        await navigator.share({ title: "Musicsquare Radio", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      // The share sheet was closed: nothing to do.
    }
  }

  const tab = tabbable ? 0 : -1;
  const sleepLabel = sleepAt
    ? `Sleep timer: ${left} minutes left. Tap to change`
    : "Set a sleep timer";
  if (icons) {
    return (
      <div className={styles.icons}>
        <button
          type="button"
          className={`${styles.icon} ${sleepAt ? styles.iconOn : ""}`}
          onClick={cycleSleep}
          tabIndex={tab}
          aria-label={sleepLabel}
          title={sleepAt ? `${left} min` : "Sleep timer"}
        >
          <span aria-hidden="true">☾</span>
          {sleepAt && <small aria-hidden="true">{left}</small>}
        </button>
        <button
          type="button"
          className={styles.icon}
          onClick={share}
          tabIndex={tab}
          aria-label={shared ? "Link copied" : "Share what's playing"}
          title={shared ? "Link copied" : "Share"}
        >
          <span aria-hidden="true">{shared ? "✓" : "↗"}</span>
        </button>
      </div>
    );
  }
  const pill = folded ? -1 : tab;
  return (
    <div className={`${styles.extras} ${folded ? styles.folded : ""}`}>
      <button
        type="button"
        className={`mono ${styles.btn} ${sleepAt ? styles.on : ""}`}
        onClick={cycleSleep}
        tabIndex={pill}
        aria-label={
          sleepAt
            ? `Sleep timer: ${left} minutes left. Tap to change`
            : "Set a sleep timer"
        }
      >
        <span aria-hidden="true">☾</span> {sleepAt ? `${left} min` : "Sleep"}
      </button>
      <button
        type="button"
        className={`mono ${styles.btn}`}
        onClick={share}
        tabIndex={pill}
      >
        <span aria-hidden="true">↗</span> {shared ? "Link copied" : "Share"}
      </button>
      {fold && (
        <button
          type="button"
          className={`${styles.tab} ${sleepAt ? styles.tabOn : ""}`}
          onClick={keepOpen}
          tabIndex={folded ? tab : -1}
          aria-label={
            sleepAt
              ? `Show sleep timer (${left} minutes left) and share`
              : "Show sleep timer and share"
          }
        >
          <span aria-hidden="true">‹</span>
        </button>
      )}
    </div>
  );
}
