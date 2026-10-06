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
import { ChannelMixer, type Playing, probeAudioCors } from "@/lib/channel-mixer";
import type { ChannelTrack } from "@/lib/live-channel";
import type { Live, Track } from "@/app/api/live/route";
import type { ChannelRotation } from "@/app/api/channels/[slug]/route";

type Source =
  | { kind: "live" }
  | { kind: "track"; url: string; title: string; artist: string }
  | { kind: "channel"; slug: string; name: string; track: ChannelTrack | null; startedAt: number; endsAt: number };

/** The song a channel is airing, as the channels page already knows it. */
export type ChannelHint = Playing | null;

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

  // Find out early whether the CDN allows cross-origin reads, which decides
  // how smooth the channel crossfades can be (see probeAudioCors).
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.replace(/\/$/, "");
    if (base) probeAudioCors(`${base}/audio/SONG-000001.mp3`);
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
  const mixerRef = useRef<ChannelMixer | null>(null);

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
      // This element plays the main stream and single tracks; channels have
      // their own decks. Pausing it to tune in to a channel must not report
      // "idle" over the channel's own status.
      el.addEventListener("pause", () => sourceRef.current.kind !== "channel" && setStatus("idle"));
      el.addEventListener("error", () => sourceRef.current.kind !== "channel" && setStatus("error"));
      el.addEventListener("ended", () => sourceRef.current.kind !== "channel" && setStatus("idle"));
      audioRef.current = el;
      if (process.env.NODE_ENV === "development") {
        (window as unknown as { __audio?: HTMLAudioElement }).__audio = el;
      }
    }
    return audioRef.current;
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    mixerRef.current?.stop();
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

  /** Channels play through a two-deck mixer that crossfades between songs. */
  const ensureMixer = useCallback(() => {
    if (!mixerRef.current) {
      mixerRef.current = new ChannelMixer({
        getRotation: () => {
          const current = sourceRef.current;
          return current.kind === "channel" ? rotationFor(current.slug) : Promise.resolve(null);
        },
        onStatus: (s) => sourceRef.current.kind === "channel" && setStatus(s),
        onTrack: (air) => {
          const current = sourceRef.current;
          if (current.kind !== "channel") return;
          changeSource({ ...current, track: air.track, startedAt: air.startedAt, endsAt: air.endsAt });
        },
      });
      if (process.env.NODE_ENV === "development") {
        (window as unknown as { __mixer?: ChannelMixer }).__mixer = mixerRef.current;
      }
    }
    return mixerRef.current;
  }, [rotationFor, changeSource]);

  const playChannel = useCallback<PlayerValue["playChannel"]>(
    (slug, name, hint) => {
      if (source.kind === "channel" && source.slug === slug && status !== "idle") {
        stop();
        return;
      }
      changeSource({
        kind: "channel", slug, name,
        track: hint?.track ?? null, startedAt: hint?.startedAt ?? 0, endsAt: hint?.endsAt ?? 0,
      });
      audioRef.current?.pause();
      // Fetch the rotation now: the mixer needs it before this song ends.
      rotationFor(slug);
      const mixer = ensureMixer();
      setStatus("loading");
      if (hint && Date.now() < hint.endsAt - 1000) {
        // Start inside the tap — iOS Safari blocks play() after an await.
        mixer.start(hint);
      } else {
        mixer.startFromClock();
      }
    },
    [source, status, stop, rotationFor, ensureMixer, changeSource],
  );

  const isOnChannel = useCallback(
    (slug: string) => source.kind === "channel" && source.slug === slug && status !== "idle",
    [source, status],
  );

  // --- the main stream and single tracks ------------------------------------------

  const toggleLive = useCallback(() => {
    mixerRef.current?.stop();
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
      mixerRef.current?.stop();
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

  useEffect(() => () => {
    audioRef.current?.pause();
    mixerRef.current?.stop();
  }, []);

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
