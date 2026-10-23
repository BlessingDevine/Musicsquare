import "server-only";
import { createClient } from "@supabase/supabase-js";
import { summarise } from "./channel-summary";
import { type ChannelTrack, type Rotation, rotationMs } from "./live-channel";

/**
 * Reads the live channels from Supabase with the publishable key, so Row
 * Level Security applies: only released songs with public files can appear.
 *
 * Rotations change only when the importer runs, so they are held in memory
 * for five minutes rather than fetched per request. Everything time-based
 * ("on now", "next") is computed from them, not stored.
 */

export type Channel = {
  slug: string;
  name: string;
  imprint: string | null;
  description: string | null;
  rotation: Rotation;
  /** Length of one full pass through the rotation. */
  totalMs: number;
  /** The label's artwork for this channel (imprint_art), if uploaded. */
  art: string | null;
  /** Album cover per song code (song_covers), for the cards' artwork. */
  covers: Record<string, string>;
};

const TTL_MS = 5 * 60_000;
const PAGE = 1000; // PostgREST's default row cap per request

let cache: { at: number; channels: Channel[] } | null = null;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  // Accept the REST URL too — the Data API page shows it with /rest/v1/.
  return createClient(new URL(url).origin, key, { auth: { persistSession: false } });
}

type StationRow = {
  slug: string;
  station_name: string;
  description: string | null;
  epoch: string;
  imprints: { imprint_name: string; slug: string } | null;
};

type TrackRow = {
  station_slug: string;
  song_code: string;
  title: string;
  artist_name: string | null;
  album_title: string | null;
  duration_ms: number;
  storage_key: string;
  sort_order: number;
  cue_in_ms: number | null;
  cue_out_ms: number | null;
};

async function load(): Promise<Channel[]> {
  const db = client();
  const audioBase = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.trim().replace(/\/$/, "");
  if (!db || !audioBase) return [];

  const { data: stations, error } = await db
    .from("radio_stations")
    .select("slug, station_name, description, epoch, imprints(imprint_name, slug)")
    .order("sort_order")
    .returns<StationRow[]>();
  if (error) throw new Error(`radio_stations: ${error.message}`);

  const rows: TrackRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: e } = await db
      .from("channel_tracks")
      .select("station_slug, song_code, title, artist_name, album_title, duration_ms, storage_key, sort_order, cue_in_ms, cue_out_ms")
      .order("station_slug")
      .order("sort_order")
      .range(from, from + PAGE - 1)
      .returns<TrackRow[]>();
    if (e) throw new Error(`channel_tracks: ${e.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  // Artwork: album covers by song code, and each label's own art. Optional —
  // the cards fall back to type alone if either lookup fails.
  const coverRows: { song_code: string; cover_key: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: ce } = await db.from("song_covers").select("song_code, cover_key").order("song_code").range(from, from + PAGE - 1);
    if (ce || !data) break;
    coverRows.push(...data);
    if (data.length < PAGE) break;
  }
  const coverByCode = new Map(coverRows.map((c) => [c.song_code, `${audioBase}/${c.cover_key.replace(/\.jpg$/, "-600.jpg")}`]));
  const { data: artRows } = await db.from("imprint_art").select("slug, cover_key, logo_key");
  const artBySlug = new Map((artRows ?? []).map((a: { slug: string; cover_key: string | null; logo_key: string | null }) => {
    const key = a.cover_key ?? a.logo_key;
    return [a.slug, key ? `${audioBase}/${key.replace(/\.jpg$/, "-600.jpg")}` : null];
  }));

  const bySlug = new Map<string, ChannelTrack[]>();
  for (const r of rows) {
    const list = bySlug.get(r.station_slug) ?? [];
    list.push({
      code: r.song_code,
      title: r.title,
      artist: r.artist_name ?? "Musicsquare Radio",
      album: r.album_title,
      durationMs: r.duration_ms,
      // Unmeasured songs play whole; a cue out can never pass the end.
      cueInMs: r.cue_in_ms ?? 0,
      cueOutMs: Math.min(r.cue_out_ms ?? r.duration_ms, r.duration_ms),
      src: `${audioBase}/${r.storage_key}`,
    });
    bySlug.set(r.station_slug, list);
  }

  return stations
    .map((s) => {
      const tracks = bySlug.get(s.slug) ?? [];
      return {
        slug: s.slug,
        name: s.station_name,
        imprint: s.imprints?.imprint_name ?? null,
        description: s.description,
        rotation: { slug: s.slug, epoch: Date.parse(s.epoch), tracks },
        totalMs: rotationMs({ slug: s.slug, epoch: 0, tracks }),
        art: (s.imprints?.slug && artBySlug.get(s.imprints.slug)) || null,
        covers: Object.fromEntries(tracks.flatMap((t) => (coverByCode.has(t.code) ? [[t.code, coverByCode.get(t.code)!]] : []))),
      };
    })
    .filter((c) => c.rotation.tracks.length > 0);
}

export async function getChannels(): Promise<Channel[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.channels;
  try {
    const channels = await load();
    cache = { at: Date.now(), channels };
    return channels;
  } catch (err) {
    // Serve the last good copy rather than an empty page if Supabase blips.
    console.error("[catalog]", err);
    return cache?.channels ?? [];
  }
}

export async function getChannel(slug: string) {
  return (await getChannels()).find((c) => c.slug === slug) ?? null;
}

/** Every channel with what it is airing at this moment. */
export async function getChannelSummaries() {
  return summarise(await getChannels(), Date.now());
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Where a live-stream song has a page on squaredrum.com, or null. The main
 * stream (RadioKing) carries some songs that were never imported, so only a
 * title the catalogue knows gets a link; squaredrum.com/find resolves it to
 * the album page (keeping the album-slug rules in one place).
 */
export async function songPage(title: string, artist: string): Promise<string | null> {
  const known = new Set((await getChannels()).flatMap((c) => c.rotation.tracks.map((t) => norm(t.title))));
  if (!known.has(norm(title))) return null;
  const q = new URLSearchParams({ title, artist });
  return `https://www.squaredrum.com/find?${q}`;
}
