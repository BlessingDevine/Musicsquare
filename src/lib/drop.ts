import "server-only";
import { createClient } from "@supabase/supabase-js";
import { hashString, seededShuffle } from "./seeded";
import { ROSTER } from "./station";

/**
 * Today's drop: one song, from one roster artist, changing every day at
 * midnight Pacific (the station is in California).
 *
 * Every roster artist with released music takes a turn before anyone
 * repeats, in a fixed shuffled order (so each artist recurs exactly every N
 * days), and each turn picks a different song from that artist's catalogue. It is all derived from the date, so there is nothing to
 * schedule: an artist whose music is imported joins the rotation at the next
 * cycle on their own.
 */

export type Drop = {
  /** The artist's ROSTER slug. */
  slug: string;
  title: string;
  artist: string;
  lane: string;
  /** Square where the artist has one (see ROSTER), else the 4:5 portrait. */
  portrait: string;
  album: string | null;
  imprint: string | null;
  durationMs: number;
  src: string;
  /** The Pacific date this drop is for, e.g. "2026-10-06". */
  date: string;
};

type Song = {
  code: string;
  title: string;
  album: string | null;
  imprint: string | null;
  durationMs: number;
  src: string;
};

const TZ = "America/Los_Angeles";
const TTL_MS = 60 * 60_000;
let cache: { at: number; byArtist: Map<string, Song[]> } | null = null;

type Row = {
  song_code: string;
  title: string;
  album_title: string | null;
  duration_ms: number | null;
  artists: { slug: string } | null;
  imprints: { imprint_name: string } | null;
  song_files: { storage_key: string }[];
};

async function loadSongs(): Promise<Map<string, Song[]>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const audioBase = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.trim().replace(/\/$/, "");
  if (!url || !key || !audioBase) return new Map();
  const db = createClient(new URL(url).origin, key, { auth: { persistSession: false } });

  // RLS limits this to released songs with public files. Originals only:
  // ALT takes, remixes and instrumentals don't make the drop.
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("songs")
      .select("song_code, title, album_title, duration_ms, artists!inner(slug), imprints(imprint_name), song_files!inner(storage_key)")
      .in("artists.slug", ROSTER.map((a) => a.slug))
      .eq("version_type", "original")
      .eq("song_files.file_type", "mp3")
      .not("duration_ms", "is", null)
      .order("song_code")
      .range(from, from + 999)
      .returns<Row[]>();
    if (error) throw new Error(`drop songs: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }

  const byArtist = new Map<string, Song[]>();
  for (const r of rows) {
    const slug = r.artists?.slug;
    const file = r.song_files[0];
    if (!slug || !file || !r.duration_ms) continue;
    const list = byArtist.get(slug) ?? [];
    list.push({
      code: r.song_code,
      title: r.title,
      album: r.album_title,
      imprint: r.imprints?.imprint_name ?? null,
      durationMs: r.duration_ms,
      src: `${audioBase}/${file.storage_key}`,
    });
    byArtist.set(slug, list);
  }
  return byArtist;
}

/** The Pacific calendar date, and a day number that ticks at its midnight. */
export function pacificDay(now: number) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  return { date, day: Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000) };
}

/**
 * Which artist and song a given day gets. Pure, so it can be tested.
 *
 * One fixed shuffled order, walked a day at a time: every artist comes round
 * exactly once every N days, evenly spaced. (Reshuffling each cycle let an
 * artist recur within days across a cycle boundary.) Each time round they
 * get a different song. Adding an artist reshuffles the order once.
 */
export function pickDrop(byArtist: Map<string, Song[]>, day: number) {
  const artists = ROSTER.filter((a) => byArtist.get(a.slug)?.length).map((a) => a.slug).sort();
  if (!artists.length) return null;
  const n = artists.length;
  const order = seededShuffle(artists, "drop");
  const cycle = Math.floor(day / n);
  const slug = order[day - cycle * n];
  const songs = byArtist.get(slug)!;
  return { slug, song: songs[hashString(`${slug}:${cycle}`) % songs.length] };
}

export async function getTodaysDrop(now = Date.now()): Promise<Drop | null> {
  try {
    if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), byArtist: await loadSongs() };
  } catch (err) {
    console.error("[drop]", err);
    if (!cache) return null;
  }
  const { date, day } = pacificDay(now);
  const pick = pickDrop(cache.byArtist, day);
  if (!pick) return null;
  const artist = ROSTER.find((a) => a.slug === pick.slug)!;
  return {
    slug: artist.slug,
    title: pick.song.title,
    artist: artist.name,
    lane: artist.lane,
    portrait: artist.square ?? artist.portrait,
    album: pick.song.album,
    imprint: pick.song.imprint,
    durationMs: pick.song.durationMs,
    src: pick.song.src,
    date,
  };
}
