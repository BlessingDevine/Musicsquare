"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { STREAM_URL } from "@/lib/station";
import { type ChannelTrack, onAirAt } from "@/lib/live-channel";
import type { Live, Track } from "@/app/api/live/route";
import type { ChannelRotation } from "@/app/api/channels/[slug]/route";

type Source =
  | { kind: "live" }
  | { kind: "track"; url: string; title: string; artist: string }
  | { kind: "channel"; slug: string; name: string; track: ChannelTrack | null; endsAt: number };

/** The song a channel is airing, as the channels page already knows it. */
export type ChannelHint = { track: ChannelTrack; startedAt: number; endsAt: number } | null;

type PlayerValue = {
  status: "idle" | "loading" | "playing" | "error";
  source: Source;
  /** What is on air, what follows it, and the last few tracks. */
  live: Live;
  now: Track | null;
  /** Seconds since the listener tuned in. */
  listening: number;
  toggleLive: () => void;
  playTrack: (t: { url: string; title: string; artist: string }) => void;
  /** Tune in to a live channel, joining it wherever it is right now. */
  playChannel: (slug: string, name: string, hint?: ChannelHint) => void;
  stop: () => void;
  isPlaying: (url?: string) => boolean;
  isOnChannel: (slug: string) => boolean;
};

/** How far off schedule a song change may be and still start from the top. */
const HANDOVER_TOLERANCE_MS = 8000;
const ROTATION_TTL_MS = 5 * 60_000;

const PlayerContext = createContext<PlayerValue | null>(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<PlayerValue["status"]>("idle");
  const [source, setSource] = useState<Source>({ kind: "live" });
  const [live, setLive] = useState<Live>({ current: null, next: null, history: [] });
  const [listening, setListening] = useState(0);

  /**
   * Polls the live feed, timed off the current track's own end time rather
   * than on a fixed interval — so the line changes the moment the track does,
   * and a five-minute track costs one request instead of ten.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = (data: Live | null) => {
      const ends = data?.current?.endsAt ? Date.parse(data.current.endsAt) : NaN;
      const untilNext = Number.isFinite(ends) ? ends - Date.now() + 1500 : 30_000;
      timer = setTimeout(pull, Math.min(60_000, Math.max(8_000, untilNext)));
    };

    const pull = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        const data: Live = res.ok ? await res.json() : { current: null, next: null, history: [] };
        if (cancelled) return;
        if (res.ok) setLive(data);
        schedule(data);
      } catch {
        // The stream keeps playing whether or not this feed answers.
        if (!cancelled) schedule(null);
      }
    };

    pull();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Session timer, shown in the hero as a broadcast counter.
  useEffect(() => {
    if (status !== "playing") return;
    const id = setInterval(() => setListening((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // The audio element's listeners are attached once, so anything they need
  // to know about the current source goes through refs.
  const sourceRef = useRef<Source>(source);
  const rotations = useRef(new Map<string, { at: number; pending: Promise<ChannelRotation | null> }>());
  const onEnded = useRef<() => void>(() => setStatus("idle"));

  const changeSource = useCallback((next: Source) => {
    sourceRef.current = next;
    setSource(next);
  }, []);

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "none";
      // No crossOrigin: plain playback doesn't need CORS, and requesting it
      // makes every song fail outright if any CDN edge omits the header.
      // Only a Web Audio visualiser would need it — add it back with one.
      el.addEventListener("playing", () => setStatus("playing"));
      el.addEventListener("waiting", () => setStatus("loading"));
      el.addEventListener("pause", () => {
        // A channel moving to its next song pauses on the way; don't flash idle.
        if (!el.ended) setStatus("idle");
      });
      el.addEventListener("error", () => setStatus("error"));
      el.addEventListener("ended", () => onEnded.current());
      audioRef.current = el;
      if (process.env.NODE_ENV === "development") {
        (window as unknown as { __audio?: HTMLAudioElement }).__audio = el;
      }
    }
    return audioRef.current;
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setStatus("idle");
  }, []);

  // --- live channels ----------------------------------------------------------

  // Rotations are re-fetched after five minutes, so a listener tuned in
  // across an import picks up the new songs at the next song change instead
  // of drifting away from what the channel cards show.
  const rotationFor = useCallback((slug: string) => {
    const cached = rotations.current.get(slug);
    if (cached && Date.now() - cached.at < ROTATION_TTL_MS) return cached.pending;
    const pending = fetch(`/api/channels/${slug}`)
      .then((r) => (r.ok ? (r.json() as Promise<ChannelRotation>) : null))
      .catch(() => null);
    rotations.current.set(slug, { at: Date.now(), pending });
    // Don't keep a failure; the next song change or tune-in tries again.
    pending.then((r) => r ?? rotations.current.delete(slug));
    // Until the fresh copy arrives, an older one is better than nothing.
    return cached ? pending.then((r) => r ?? cached.pending) : pending;
  }, []);

  /**
   * Plays one song of a channel from wherever the channel has got to. The
   * #t fragment starts it at the right point; once the file's metadata is in,
   * the position is corrected for however long loading took.
   */
  const startChannelTrack = useCallback(
    (slug: string, name: string, air: { track: ChannelTrack; startedAt: number; endsAt: number }) => {
      const el = ensureAudio();
      changeSource({ kind: "channel", slug, name, track: air.track, endsAt: air.endsAt });
      setStatus("loading");
      const offset = Math.max(0, (Date.now() - air.startedAt) / 1000);
      el.src = offset > 1 ? `${air.track.src}#t=${offset.toFixed(1)}` : air.track.src;
      el.addEventListener(
        "loadedmetadata",
        () => {
          const target = (Date.now() - air.startedAt) / 1000;
          if (Math.abs(el.currentTime - target) > 1.5) el.currentTime = target;
        },
        { once: true },
      );
      el.play().catch(() => setStatus("error"));
    },
    [ensureAudio, changeSource],
  );

  /** Re-reads the clock and plays whatever the channel is on now. */
  const resyncChannel = useCallback(
    async (slug: string, name: string, endedCode?: string) => {
      const rotation = await rotationFor(slug);
      const current = sourceRef.current;
      if (current.kind !== "channel" || current.slug !== slug) return; // tuned away meanwhile
      const now = Date.now();
      let air = rotation && onAirAt(rotation, now);
      if (!rotation || !air) {
        setStatus("error");
        return;
      }
      if (endedCode) {
        // A song has just finished. The clock may still say it's playing:
        // browsers trim ~40ms of MP3 padding, and the start-up correction
        // allows the audio to run up to 1.5s ahead. Re-reading the clock
        // then restarted the same song at its tail, so its ending played
        // twice. A song that has ended always hands on to the next.
        if (air.track.code === endedCode) air = onAirAt(rotation, air.endsAt + 1) ?? air;
        // Only a little off schedule: start the next song from the top
        // rather than clip its intro to stay to-the-second. Further out
        // (a stalled connection, a laptop waking up), rejoin the clock.
        if (Math.abs(now - air.startedAt) < HANDOVER_TOLERANCE_MS) {
          air = { ...air, startedAt: now, endsAt: now + air.track.durationMs };
        }
      }
      startChannelTrack(slug, name, air);
    },
    [rotationFor, startChannelTrack],
  );

  useEffect(() => {
    onEnded.current = () => {
      const current = sourceRef.current;
      if (current.kind === "channel") resyncChannel(current.slug, current.name, current.track?.code);
      else setStatus("idle");
    };
  }, [resyncChannel]);

  const playChannel = useCallback<PlayerValue["playChannel"]>(
    (slug, name, hint) => {
      if (source.kind === "channel" && source.slug === slug && status !== "idle") {
        stop();
        return;
      }
      // Fetch the rotation now: it's needed when this song ends.
      rotationFor(slug);
      if (hint && Date.now() < hint.endsAt - 1000) {
        // Start inside the tap — iOS Safari blocks play() after an await.
        startChannelTrack(slug, name, hint);
      } else {
        ensureAudio();
        changeSource({ kind: "channel", slug, name, track: null, endsAt: 0 });
        setStatus("loading");
        resyncChannel(slug, name);
      }
    },
    [source, status, stop, rotationFor, startChannelTrack, ensureAudio, changeSource, resyncChannel],
  );

  const isOnChannel = useCallback(
    (slug: string) => source.kind === "channel" && source.slug === slug && status !== "idle",
    [source, status],
  );

  // --- the main stream and single tracks ------------------------------------------

  const toggleLive = useCallback(() => {
    const el = ensureAudio();
    if (source.kind === "live" && status === "playing") {
      stop();
      return;
    }
    changeSource({ kind: "live" });
    setStatus("loading");
    // Cache-bust so a resumed stream starts at the live edge, not a stale buffer.
    el.src = `${STREAM_URL}?t=${Date.now()}`;
    el.play().catch(() => setStatus("error"));
  }, [ensureAudio, source.kind, status, stop, changeSource]);

  const playTrack = useCallback<PlayerValue["playTrack"]>(
    (track) => {
      const el = ensureAudio();
      if (source.kind === "track" && source.url === track.url && status === "playing") {
        stop();
        return;
      }
      changeSource({ kind: "track", ...track });
      setStatus("loading");
      el.src = track.url;
      el.play().catch(() => setStatus("error"));
    },
    [ensureAudio, source, status, stop, changeSource],
  );

  const isPlaying = useCallback<PlayerValue["isPlaying"]>(
    (url) => {
      if (status !== "playing") return false;
      if (!url) return source.kind === "live";
      return source.kind === "track" && source.url === url;
    },
    [source, status],
  );

  useEffect(() => () => audioRef.current?.pause(), []);

  const value = useMemo(
    () => ({
      status,
      source,
      live,
      now: live.current,
      listening,
      toggleLive,
      playTrack,
      playChannel,
      stop,
      isPlaying,
      isOnChannel,
    }),
    [status, source, live, listening, toggleLive, playTrack, playChannel, stop, isPlaying, isOnChannel],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

/** hh:mm:ss for the broadcast counter. */
export function clock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}
