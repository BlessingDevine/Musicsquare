import "server-only";
import { createClient } from "@supabase/supabase-js";
import { pacificDay } from "./drop";
import { seededShuffle } from "./seeded";
import { ROSTER } from "./station";

/**
 * The hero's artist wall: the roster's Canvas loops, seven a day.
 *
 * Every artist with a Canvas in the catalogue is in the pool (album Canvases
 * from song_covers plus song-specific ones from song_videos), so a new artist
 * joins on their first Canvas with no change here. Each Canvas has a still
 * of its first frame beside it on the CDN (<hash>.jpg next to <hash>.mp4),
 * which shows until that strip goes live.
 */

export type WallArtist = {
  /** squaredrum.com artist slug. */
  slug: string;
  name: string;
  lane: string;
  /** The album this Canvas belongs to. */
  album: string | null;
  video: string;
  still: string;
  /** squaredrum.com artist page, when it is built; else null. */
  page: string | null;
};

const WALL_SIZE = 7;
/** The strip that opens first: the middle one, so it never sits under the headline. */
export const WALL_LEAD = 3;
const TTL_MS = 5 * 60_000;
const PAGE = 1000; // PostgREST's default row cap per request

let cache: { at: number; pool: WallArtist[] } | null = null;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(new URL(url).origin, key, { auth: { persistSession: false } });
}

/**
 * Slugs whose artist page on squaredrum.com is built. That site shows an
 * artist page once photos.mjs has published the artist's photo index, so the
 * same file decides here; a page published later links on its own.
 */
export async function artistsWithPages(slugs: readonly string[]): Promise<Set<string>> {
  const audioBase = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.trim().replace(/\/$/, "");
  if (!audioBase) return new Set();
  const built = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const r = await fetch(`${audioBase}/audio/photos/${slug}/index.json`, { next: { revalidate: 300 } });
        return r.ok ? slug : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(built.filter((s): s is string => s !== null));
}

async function paged<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

type SongRow = { song_id: string; album_title: string | null; genre: string | null; primary_artist_id: string };
type ArtistRow = { artist_id: string; artist_name: string; slug: string };

async function load(): Promise<WallArtist[]> {
  const db = client();
  const audioBase = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.trim().replace(/\/$/, "");
  if (!db || !audioBase) return [];

  const [covers, videos] = await Promise.all([
    paged<{ song_id: string; canvas_key: string }>((a, b) =>
      db.from("song_covers").select("song_id, canvas_key").not("canvas_key", "is", null).order("song_id").range(a, b),
    ),
    paged<{ song_id: string; storage_key: string }>((a, b) =>
      db.from("song_videos").select("song_id, storage_key").eq("kind", "canvas").order("song_id").range(a, b),
    ),
  ]);
  const canvasBySong = new Map<string, string>();
  for (const c of covers) canvasBySong.set(c.song_id, c.canvas_key);
  for (const v of videos) canvasBySong.set(v.song_id, v.storage_key); // a song's own Canvas beats its album's
  if (canvasBySong.size === 0) return [];

  const ids = [...canvasBySong.keys()];
  const songs: SongRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db
      .from("songs")
      .select("song_id, album_title, genre, primary_artist_id")
      .in("song_id", ids.slice(i, i + 200))
      .returns<SongRow[]>();
    songs.push(...(data ?? []));
  }
  const artistIds = [...new Set(songs.map((s) => s.primary_artist_id))];
  const { data: artists } = await db
    .from("artists")
    .select("artist_id, artist_name, slug")
    .in("artist_id", artistIds)
    .returns<ArtistRow[]>();
  const artistById = new Map((artists ?? []).map((a) => [a.artist_id, a]));
  const laneBySlug = new Map(ROSTER.map((r) => [r.slug, r.lane]));

  // One entry per Canvas file; songs on the same album share one.
  const byKey = new Map<string, Omit<WallArtist, "page">>();
  for (const s of songs) {
    const key = canvasBySong.get(s.song_id);
    const artist = artistById.get(s.primary_artist_id);
    if (!key || !artist || byKey.has(key)) continue;
    byKey.set(key, {
      slug: artist.slug,
      name: artist.artist_name,
      lane: laneBySlug.get(artist.slug) ?? s.genre ?? "",
      album: s.album_title,
      video: `${audioBase}/${key}`,
      still: `${audioBase}/${key.replace(/\.mp4$/, ".jpg")}`,
    });
  }
  const pool = [...byKey.values()].sort((a, b) => a.video.localeCompare(b.video));
  const pages = await artistsWithPages([...new Set(pool.map((p) => p.slug))]);
  return pool.map((p) => ({ ...p, page: pages.has(p.slug) ? `https://www.squaredrum.com/artists/${p.slug}` : null }));
}

/** Every Canvas in the catalogue, one entry each. Held for five minutes. */
export async function getCanvasPool(): Promise<WallArtist[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.pool;
  try {
    const pool = await load();
    cache = { at: Date.now(), pool };
    return pool;
  } catch {
    return cache?.pool ?? [];
  }
}

/**
 * Today's seven, the same for everyone on a given Pacific day, one Canvas per
 * artist (a different one each day for artists with several). Today's drop
 * artist takes the middle strip when they have a Canvas.
 */
export function todaysWall(pool: readonly WallArtist[], featured?: string): WallArtist[] {
  const picks = onAirStandIns(pool);
  const lead = picks.findIndex((p) => p.slug === featured);
  const leader = lead >= 0 ? picks.splice(lead, 1)[0] : null;
  const wall = picks.slice(0, leader ? WALL_SIZE - 1 : WALL_SIZE);
  if (leader) wall.splice(Math.min(WALL_LEAD, wall.length), 0, leader);
  return wall;
}

/** "R&B / Soul" and "R&B / Pop" are one family; so are "Afro House / Jazz" and "Afro House". */
const family = (lane: string) => lane.split("/")[0].trim().toLowerCase();

/**
 * One Canvas per artist, today's pick for each, in today's order. The wall is
 * the first seven; the rest stand in when their artist comes on the stream.
 * The order deals one artist from each genre in turn, so the wall is a spread
 * of the station rather than whichever genre has the most Canvases (Rock).
 */
export function onAirStandIns(pool: readonly WallArtist[]): WallArtist[] {
  const seed = `wall:${pacificDay(Date.now()).day}`;
  const seen = new Set<string>();
  const artists = seededShuffle(pool, seed).filter((c) => !seen.has(c.slug) && seen.add(c.slug));
  const byFamily = new Map<string, WallArtist[]>();
  for (const a of artists) byFamily.set(family(a.lane), [...(byFamily.get(family(a.lane)) ?? []), a]);
  const queues = seededShuffle([...byFamily.values()], `${seed}:genres`);
  const dealt: WallArtist[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) dealt.push(q.shift()!);
  return dealt;
}
