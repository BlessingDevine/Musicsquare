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
import type { Live, Track } from "@/app/api/live/route";

type Source =
  | { kind: "live" }
  | { kind: "track"; url: string; title: string; artist: string };

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
  stop: () => void;
  isPlaying: (url?: string) => boolean;
};

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

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "none";
      el.crossOrigin = "anonymous";
      el.addEventListener("playing", () => setStatus("playing"));
      el.addEventListener("waiting", () => setStatus("loading"));
      el.addEventListener("pause", () => setStatus("idle"));
      el.addEventListener("error", () => setStatus("error"));
      el.addEventListener("ended", () => setStatus("idle"));
      audioRef.current = el;
    }
    return audioRef.current;
  }, []);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    setStatus("idle");
  }, []);

  const toggleLive = useCallback(() => {
    const el = ensureAudio();
    if (source.kind === "live" && status === "playing") {
      stop();
      return;
    }
    setSource({ kind: "live" });
    setStatus("loading");
    // Cache-bust so a resumed stream starts at the live edge, not a stale buffer.
    el.src = `${STREAM_URL}?t=${Date.now()}`;
    el.play().catch(() => setStatus("error"));
  }, [ensureAudio, source.kind, status, stop]);

  const playTrack = useCallback<PlayerValue["playTrack"]>(
    (track) => {
      const el = ensureAudio();
      if (source.kind === "track" && source.url === track.url && status === "playing") {
        stop();
        return;
      }
      setSource({ kind: "track", ...track });
      setStatus("loading");
      el.src = track.url;
      el.play().catch(() => setStatus("error"));
    },
    [ensureAudio, source, status, stop],
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
      stop,
      isPlaying,
    }),
    [status, source, live, listening, toggleLive, playTrack, stop, isPlaying],
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
