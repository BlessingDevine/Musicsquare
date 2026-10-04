import "server-only";
import { createClient } from "@supabase/supabase-js";
import { summarise } from "./channel-summary";
import type { ChannelTrack, Rotation } from "./live-channel";

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
  imprints: { imprint_name: string } | null;
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
};

async function load(): Promise<Channel[]> {
  const db = client();
  const audioBase = process.env.NEXT_PUBLIC_AUDIO_BASE_URL?.trim().replace(/\/$/, "");
  if (!db || !audioBase) return [];

  const { data: stations, error } = await db
    .from("radio_stations")
    .select("slug, station_name, description, epoch, imprints(imprint_name)")
    .order("sort_order")
    .returns<StationRow[]>();
  if (error) throw new Error(`radio_stations: ${error.message}`);

  const rows: TrackRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: e } = await db
      .from("channel_tracks")
      .select("station_slug, song_code, title, artist_name, album_title, duration_ms, storage_key, sort_order")
      .order("station_slug")
      .order("sort_order")
      .range(from, from + PAGE - 1)
      .returns<TrackRow[]>();
    if (e) throw new Error(`channel_tracks: ${e.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  const bySlug = new Map<string, ChannelTrack[]>();
  for (const r of rows) {
    const list = bySlug.get(r.station_slug) ?? [];
    list.push({
      code: r.song_code,
      title: r.title,
      artist: r.artist_name ?? "Musicsquare Radio",
      album: r.album_title,
      durationMs: r.duration_ms,
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
        totalMs: tracks.reduce((sum, t) => sum + t.durationMs, 0),
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
