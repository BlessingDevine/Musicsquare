import { NextResponse } from "next/server";
import { songPage } from "@/lib/catalog";

const BASE = "https://api.radioking.io/widget/radio/music-square-radio/track";

export const revalidate = 0;

export type Track = {
  title: string;
  artist: string;
  album: string | null;
  artwork: string | null;
  startedAt: string | null;
  endsAt: string | null;
  /** The song's page on squaredrum.com, when the catalogue has it (see songPage). */
  page?: string | null;
};

export type Live = {
  current: Track | null;
  next: Track | null;
  /** Newest first, and never repeating whatever is playing now. */
  history: Track[];
};

const EMPTY: Live = { current: null, next: null, history: [] };

/** RadioKing calls the artwork `cover` on one endpoint and `cover_url` on the others. */
type Raw = {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  cover?: string | null;
  cover_url?: string | null;
  started_at?: string | null;
  end_at?: string | null;
  default_cover?: boolean;
  type?: string;
};

function normalise(raw: Raw | null | undefined): Track | null {
  if (!raw?.title) return null;
  return {
    title: raw.title,
    artist: raw.artist || "Musicsquare Radio",
    album: raw.album ?? null,
    // A default cover is RadioKing's generic placeholder — better to fall
    // through to our own than to show theirs.
    artwork: raw.default_cover ? null : (raw.cover ?? raw.cover_url ?? null),
    startedAt: raw.started_at ?? null,
    endsAt: raw.end_at ?? null,
  };
}

async function pull(path: string) {
  const res = await fetch(`${BASE}/${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/**
 * One call for everything the page shows about the live stream: what is
 * playing, what follows it, and the last few tracks.
 *
 * The upstream widget API has no CORS headers, so the browser can't read it
 * directly. Each endpoint is settled independently — a failure on the history
 * feed shouldn't take out the now-playing line.
 */
export async function GET() {
  const [current, next, history] = await Promise.allSettled([
    pull("current"),
    pull("next?limit=1"),
    pull("ckoi?limit=4"),
  ]);

  const nowPlaying =
    current.status === "fulfilled" ? normalise(current.value as Raw) : null;

  const upNext =
    next.status === "fulfilled" && Array.isArray(next.value)
      ? normalise((next.value as Raw[])[0])
      : null;

  const played =
    history.status === "fulfilled" && Array.isArray(history.value)
      ? (history.value as Raw[])
          .map(normalise)
          .filter((t): t is Track => t !== null)
          // The history feed often still lists the track that is on air.
          .filter((t) => t.title !== nowPlaying?.title)
          .slice(0, 3)
      : [];

  // Link each title to its squaredrum.com page when the catalogue knows the song.
  const linked = async (t: Track): Promise<Track> => ({ ...t, page: await songPage(t.title, t.artist).catch(() => null) });
  const [cur, nxt, past] = await Promise.all([
    nowPlaying && linked(nowPlaying),
    upNext && linked(upNext),
    Promise.all(played.map(linked)),
  ]);
  const payload: Live = { current: cur, next: nxt, history: past };

  return NextResponse.json(nowPlaying || upNext || played.length ? payload : EMPTY, {
    // Public now-playing data; the GoSquare app (incl. its web build) reads it too.
    headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}
