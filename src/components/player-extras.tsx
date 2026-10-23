"use client";

import { useEffect, useState } from "react";
import { usePlayer } from "./player-provider";
import styles from "./player-extras.module.css";

const SITE = "https://musicsquareradio.com";
// Each tap moves the sleep timer on to the next choice; after the last one it switches off.
const STEPS = [15, 30, 60, 90];

/**
 * Sleep timer and "share what's playing", shown beside the player while
 * something plays (hero console and the docked player bar).
 */
export function PlayerExtras({ tabbable = true }: { tabbable?: boolean }) {
  const { source, now, sleepAt, setSleepTimer } = usePlayer();
  const [left, setLeft] = useState<number | null>(null);
  const [shared, setShared] = useState(false);

  // Minutes left on the sleep timer, refreshed every 15 s.
  useEffect(() => {
    if (!sleepAt) return;
    const tick = () => setLeft(Math.max(1, Math.ceil((sleepAt - Date.now()) / 60_000)));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [sleepAt]);

  function cycleSleep() {
    if (!sleepAt) return setSleepTimer(STEPS[0]);
    const i = STEPS.findIndex((m) => m >= (left ?? 0));
    setSleepTimer(i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null);
  }

  async function share() {
    const title = source.kind === "channel" ? source.track?.title : source.kind === "track" ? source.title : now?.title;
    const artist = source.kind === "channel" ? source.track?.artist : source.kind === "track" ? source.artist : now?.artist;
    const where = source.kind === "channel" ? `the ${source.name} channel on Musicsquare Radio` : "Musicsquare Radio";
    const text = title ? `Listening to “${title}”${artist ? ` by ${artist}` : ""} on ${where}` : `Listening to ${where}`;
    const url = source.kind === "channel" ? `${SITE}/channels` : SITE;
    try {
      if (navigator.share) await navigator.share({ title: "Musicsquare Radio", text, url });
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
  return (
    <div className={styles.extras}>
      <button type="button" className={`mono ${styles.btn} ${sleepAt ? styles.on : ""}`} onClick={cycleSleep} tabIndex={tab} aria-label={sleepAt ? `Sleep timer: ${left} minutes left. Tap to change` : "Set a sleep timer"}>
        <span aria-hidden="true">☾</span> {sleepAt ? `${left} min` : "Sleep"}
      </button>
      <button type="button" className={`mono ${styles.btn}`} onClick={share} tabIndex={tab}>
        <span aria-hidden="true">↗</span> {shared ? "Link copied" : "Share"}
      </button>
    </div>
  );
}
