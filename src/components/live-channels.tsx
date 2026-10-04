"use client";

import { useEffect, useState } from "react";
import type { ChannelSummary } from "@/lib/channel-summary";
import { usePlayer } from "./player-provider";
import { Reveal } from "./reveal";
import styles from "./live-channels.module.css";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Keeps channel summaries current. The next fetch is timed for just after
 * the soonest song change on any channel — so a card flips to its new song
 * when it actually changes, not on the next fixed tick.
 */
export function useChannelSummaries(initial: ChannelSummary[]) {
  const [channels, setChannels] = useState(initial);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = (list: ChannelSummary[]) => {
      const soonest = Math.min(...list.map((c) => c.now?.endsAt ?? Infinity));
      const wait = Number.isFinite(soonest) ? soonest - Date.now() + 1200 : 60_000;
      timer = setTimeout(pull, Math.min(60_000, Math.max(5_000, wait)));
    };

    const pull = async () => {
      try {
        const res = await fetch("/api/channels", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const list: ChannelSummary[] = await res.json();
        if (cancelled) return;
        setChannels(list);
        schedule(list);
      } catch {
        if (!cancelled) timer = setTimeout(pull, 30_000);
      }
    };

    // The server-rendered copy can be minutes old; refresh straight away.
    pull();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // A one-second clock for progress lines. Null until mounted, so the server
  // render and the first client render agree.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return { channels, now };
}

export function ChannelCard({
  channel,
  now,
  compact = false,
}: {
  channel: ChannelSummary;
  now: number | null;
  compact?: boolean;
}) {
  const { playChannel, isOnChannel, source, status } = usePlayer();
  const tuned = isOnChannel(channel.slug);
  // While tuned in, show the player's own track: it is the one actually heard.
  const playing =
    tuned && source.kind === "channel" && source.track
      ? { track: source.track, endsAt: source.endsAt }
      : channel.now;
  const air = playing && now !== null && now < playing.endsAt ? playing : null;
  const progress = air ? 1 - (air.endsAt - (now ?? 0)) / air.track.durationMs : 0;

  return (
    <article className={`${styles.card} ${tuned ? styles.tuned : ""}`}>
      <p className={`mono ${styles.meta}`}>
        <span>{channel.imprint}</span>
        <span>{channel.tracks} songs</span>
      </p>

      <h3 className={`display ${styles.name}`}>{channel.name}</h3>

      <div className={styles.now} aria-live={tuned ? "polite" : "off"}>
        <p className={`mono ${styles.onAir}`}>
          <span className="pip" aria-hidden="true" />
          {tuned ? (status === "loading" ? "Tuning in" : "You're listening") : "On air"}
          {air && (
            <span className={styles.time}>
              {mmss(air.track.durationMs - (air.endsAt - (now ?? 0)))} / {mmss(air.track.durationMs)}
            </span>
          )}
        </p>
        <span className={styles.bar} aria-hidden="true">
          <i style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} />
        </span>
        <p className={styles.title}>{playing?.track.title ?? " "}</p>
        <p className={`mono ${styles.artist}`}>{playing?.track.artist ?? " "}</p>
      </div>

      {!compact && channel.next && (
        <p className={`mono ${styles.next}`}>
          Next <span>{channel.next.title}</span> · {channel.next.artist}
        </p>
      )}

      <button
        type="button"
        className={`btn ${tuned ? "" : "btn-ghost"} ${styles.btn}`}
        onClick={() => playChannel(channel.slug, channel.name, channel.now)}
        aria-pressed={tuned}
      >
        <span aria-hidden="true">{tuned ? "■" : "▶"}</span>
        <span>{tuned ? "Stop" : "Tune in"}</span>
        <span className="sr-only">{tuned ? ` ${channel.name}` : ` to ${channel.name}`}</span>
      </button>
    </article>
  );
}

export function LiveChannels({ initial }: { initial: ChannelSummary[] }) {
  const { channels, now } = useChannelSummaries(initial);
  return (
    <ul className={styles.grid}>
      {channels.map((c) => (
        <Reveal as="li" key={c.slug} id={c.slug} className={styles.cell}>
          <ChannelCard channel={c} now={now} />
        </Reveal>
      ))}
    </ul>
  );
}
