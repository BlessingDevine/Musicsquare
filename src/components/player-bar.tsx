"use client";

import { useEffect, useState } from "react";
import { clock, usePlayer } from "./player-provider";
import styles from "./player-bar.module.css";

/**
 * Docks at the bottom once playback starts and the hero's own console has
 * scrolled away — the two never show at the same time.
 */
export function PlayerBar() {
  const { status, source, now, listening, stop, toggleLive } = usePlayer();
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    const onScroll = () => setPastHero(window.scrollY > window.innerHeight * 0.82);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const active = status === "playing" || status === "loading" || status === "error";
  const open = active && pastHero;

  // The bar is fixed; the page needs room underneath so it can't cover the
  // footer. Driven off `active` rather than `open` so nothing jumps mid-scroll.
  useEffect(() => {
    if (active) document.body.dataset.playing = "true";
    else delete document.body.dataset.playing;
    return () => {
      delete document.body.dataset.playing;
    };
  }, [active]);

  const title =
    source.kind === "track" ? source.title : (now?.title ?? "Musicsquare Radio");
  const artist =
    source.kind === "track" ? source.artist : (now?.artist ?? "Live stream");

  return (
    <div className={`${styles.bar} ${open ? styles.open : ""}`} aria-hidden={!open}>
      <div className={`wrap ${styles.inner}`}>
        <button
          type="button"
          className={styles.stop}
          onClick={stop}
          tabIndex={open ? 0 : -1}
          aria-label="Stop playback"
        >
          <span aria-hidden="true">■</span>
        </button>

        <span className={styles.meter} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>

        <p className={styles.track}>
          <span className={styles.title}>{title}</span>
          <span className={`mono ${styles.artist}`}>{artist}</span>
        </p>

        <p className={`mono ${styles.right}`}>
          {status === "error" ? (
            <button
              type="button"
              className={styles.retry}
              onClick={toggleLive}
              tabIndex={open ? 0 : -1}
            >
              Stream dropped — reconnect
            </button>
          ) : source.kind === "live" ? (
            <>Live · {clock(listening)}</>
          ) : (
            "Single track"
          )}
        </p>
      </div>
    </div>
  );
}
