"use client";

import { LevelMeter } from "./level-meter";
import { PlayerExtras } from "./player-extras";
import { clock, usePlayer } from "./player-provider";
import type { ChannelSummary } from "@/lib/channel-summary";
import type { WallArtist } from "@/lib/canvas-wall";
import { useEffect, useMemo, useRef, useState } from "react";
import { CATALOGUE, STATION } from "@/lib/station";
import styles from "./hero.module.css";

const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=app.gosquare";

/** How long each artist holds the wall before the next cut, while nothing is on air. */
const HOLD_MS = 5500;
/** The first strip to open: the middle one, clear of the headline. */
const LEAD = 3;
/** Phones show five strips; these two drop out. */
const DESKTOP_ONLY = new Set([1, 5]);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Whether a credit ("Bantan feat. Lea Babi") names this artist as a whole word run. */
const credits = (credit: string, name: string) => ` ${norm(credit)} `.includes(` ${norm(name)} `);

/**
 * The wall of today's artists behind the hero (canvas-wall.ts picks them).
 *
 * Seven Canvas loops stand as tall strips; one is "live": it opens wide, plays
 * its loop in full colour and carries the caption, while the rest hold their
 * still, dimmed. While the stream (or a channel) plays a song by an artist
 * with a Canvas, that artist holds the live strip, swapped onto the wall if
 * they aren't on it today. Otherwise the wall cuts to the next artist every
 * few seconds. Desktop: pointing at a strip cuts to it. Every strip opens the
 * artist's squaredrum.com page; on touch, the first tap cuts to it instead.
 */
function ArtistWall({ wall, standIns }: { wall: WallArtist[]; standIns: WallArtist[] }) {
  const { status, source, now } = usePlayer();
  const [live, setLive] = useState(Math.min(LEAD, wall.length - 1));
  const [held, setHeld] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [phone, setPhone] = useState(false);
  const [visible, setVisible] = useState(true);
  // Strips that have been live keep their video element, so a second visit doesn't reload it.
  const [played, setPlayed] = useState<Set<number>>(() => new Set([Math.min(LEAD, wall.length - 1)]));
  const root = useRef<HTMLDivElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    const rm = matchMedia("(prefers-reduced-motion: reduce)");
    const ph = matchMedia("(max-width: 720px)");
    const sync = () => {
      setReduced(rm.matches);
      setPhone(ph.matches);
    };
    sync();
    rm.addEventListener("change", sync);
    ph.addEventListener("change", sync);
    return () => {
      rm.removeEventListener("change", sync);
      ph.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The song playing right now, whichever source it comes from.
  const playing = status === "playing" || status === "loading";
  const song = !playing
    ? null
    : source.kind === "channel"
      ? source.track && { title: source.track.title, artist: source.track.artist }
      : source.kind === "track"
        ? { title: source.title, artist: source.artist }
        : now && { title: now.title, artist: now.artist };
  const songArtist = song?.artist ?? null;
  const songTitle = song?.title ?? null;

  // Who is on air, if they have a Canvas. An artist not on today's wall stands
  // in on the middle strip for as long as their song plays.
  const onAir = useMemo(() => {
    if (!songArtist || !songTitle) return null;
    const at = wall.findIndex((s) => credits(songArtist, s.name));
    if (at >= 0) return { at, artist: wall[at], title: songTitle };
    const standIn = standIns.find((s) => credits(songArtist, s.name));
    return standIn ? { at: Math.min(LEAD, wall.length - 1), artist: standIn, title: songTitle } : null;
  }, [songArtist, songTitle, wall, standIns]);
  const strips = onAir ? wall.map((s, i) => (i === onAir.at ? onAir.artist : s)) : wall;
  // On air wins the live strip; otherwise it's wherever the cycle has got to.
  const current = onAir ? onAir.at : live;

  const cut = (to: number) => {
    setLive(to);
    setPlayed((p) => (p.has(to) ? p : new Set(p).add(to)));
  };

  // Cut along the wall, skipping strips hidden on phones, while nothing on air holds it.
  const holding = held || onAir !== null;
  useEffect(() => {
    if (reduced || !visible || holding) return;
    const t = setTimeout(() => {
      let i = live;
      do i = (i + 1) % wall.length;
      while (phone && DESKTOP_ONLY.has(i));
      cut(i);
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [live, reduced, visible, holding, phone, wall.length]);

  // Only the live strip plays; the rest pause on whatever frame they reached.
  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === current && visible && !reduced) v.play().catch(() => {});
      else v.pause();
    });
  }, [current, visible, reduced, played, onAir]);

  if (strips.length === 0) return null;

  return (
    <div
      ref={root}
      className={`${styles.wall} ${holding ? styles.held : ""}`}
      aria-hidden="true"
      onPointerLeave={(e) => e.pointerType === "mouse" && setHeld(false)}
    >
      {strips.map((s, i) => {
        const isLive = i === current;
        const onAirHere = onAir !== null && i === onAir.at;
        return (
          <a
            key={`${s.video}-${i}`}
            href={s.page ?? undefined}
            target="_blank"
            rel="noopener"
            tabIndex={-1}
            className={`${styles.strip} ${isLive ? styles.live : ""} ${DESKTOP_ONLY.has(i) ? styles.deskOnly : ""}`}
            style={{ "--i": i } as React.CSSProperties}
            onPointerEnter={(e) => {
              if (e.pointerType !== "mouse") return;
              setHeld(true);
              cut(i);
            }}
            onClick={(e) => {
              // Touch: the first tap brings the artist up; the next opens their page.
              if (!isLive || !s.page) {
                e.preventDefault();
                cut(i);
              }
            }}
          >
            <span className={styles.media}>
              {/* Remote CDN stills; not next/image, which would re-encode every Canvas frame. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.still} alt="" />
              {(played.has(i) || isLive) && !reduced && (
                <video
                  ref={(v) => {
                    videos.current[i] = v;
                  }}
                  src={s.video}
                  muted
                  loop
                  playsInline
                  preload="auto"
                  onLoadedData={(e) => e.currentTarget.classList.add(styles.ready)}
                />
              )}
            </span>
            <span className={styles.caption}>
              <span className={`mono ${styles.tagline}`}>
                {onAirHere ? (
                  <>
                    <span className="pip" />
                    On air · AI artist
                  </>
                ) : (
                  "AI artist"
                )}
              </span>
              <span className={styles.who}>{s.name}</span>
              <span className={`mono ${styles.lane}`}>
                {onAirHere ? onAir.title : [s.lane, s.album].filter(Boolean).join(" · ")}
              </span>
              {!onAirHere && (
                <span className={styles.timer}>
                  <i key={isLive ? `t${current}` : undefined} />
                </span>
              )}
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function Hero({
  channels,
  wall,
  standIns,
}: {
  channels: ChannelSummary[];
  wall: WallArtist[];
  standIns: WallArtist[];
}) {
  const { status, source, listening, toggleLive, playChannel, isOnChannel } = usePlayer();
  const liveOn = source.kind === "live" && status === "playing";
  const playing = status === "playing" || status === "loading";

  return (
    <section id="top" className={`on-ink ${styles.hero}`}>
      <ArtistWall wall={wall} standIns={standIns} />
      <div className={styles.scrimTop} aria-hidden="true" />
      <div className={styles.scrimBottom} aria-hidden="true" />
      <div className={styles.scrimLeft} aria-hidden="true" />

      <div className={`wrap ${styles.top}`}>
        <p className="mono">
          {STATION.frequency} · {STATION.city} · Est. {STATION.founded}
        </p>
        <p className={`mono ${styles.counter}`}>
          <span className="pip" aria-hidden="true" />
          {liveOn ? `On air ${clock(listening)}` : "On air now"}
        </p>
      </div>

      <div className={`wrap ${styles.copy}`}>
        <h1 className={`display ${styles.title}`}>
          <span className={styles.line}>
            <span>Radio for</span>
          </span>
          <span className={styles.line}>
            <span>
              the <em>AI era.</em>
            </span>
          </span>
        </h1>
        <p className={styles.sub}>
          Every song here is made by AI artists under human creative direction. {CATALOGUE.songs} songs across{" "}
          {channels.length || 16} channels, playing around the clock.
        </p>
      </div>

      {/* The logo's bars as a faint gold level meter along the bottom of the hero. */}
      <LevelMeter />

      <div className={styles.console}>
        <div className={`wrap ${styles.consoleInner}`}>
          {/* While something plays, Sleep and Share sit as two icons on the button's right end. */}
          <div className={styles.ctaWrap}>
            <button
              type="button"
              className={`btn ${styles.cta} ${playing ? styles.ctaWithIcons : ""}`}
              onClick={toggleLive}
              aria-pressed={liveOn}
            >
              <span aria-hidden="true">{liveOn ? "■" : "▶"}</span>
              <span>{liveOn ? "Stop the stream" : "Listen live"}</span>
            </button>
            {playing && <PlayerExtras icons />}
          </div>

          {/* Every channel, each one tunes straight in (scrolls sideways when they don't fit). */}
          <nav className={styles.channels} aria-label="Tune in to a channel">
            {channels.map((c) => {
              const on = isOnChannel(c.slug);
              return (
                <button
                  key={c.slug}
                  type="button"
                  className={`mono ${styles.chip} ${on ? styles.chipOn : ""}`}
                  onClick={() => playChannel(c.slug, c.name, c.now)}
                  aria-pressed={on}
                >
                  {c.name}
                </button>
              );
            })}
          </nav>

          {/* The app, for listeners who want it on their phone: tap on a phone, scan from a computer. */}
          <a className={styles.app} href={GOOGLE_PLAY_URL} target="_blank" rel="noopener">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/google-play-qr.svg" alt="" width={44} height={44} />
            <span className="mono">
              Take it with you
              <b>GoSquare · Google Play</b>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
