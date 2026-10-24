import type { Channel } from "./catalog";
import { type ChannelTrack, onAirAt } from "./live-channel";

export type ChannelSummary = {
  slug: string;
  name: string;
  imprint: string | null;
  tracks: number;
  totalMs: number;
  /**
   * The song on air, with its audio URL, so "Tune in" can start playback
   * inside the tap itself — iOS Safari refuses play() after an await.
   */
  now: { track: ChannelTrack; startedAt: number; endsAt: number; fadeMs: number } | null;
  next: ChannelTrack | null;
  /** Artwork: the label's art, and the covers of the songs on now and next. */
  art: string | null;
  cover: string | null;
  nextCover: string | null;
  /** The three songs after the one on air, in play order (the enlarged card's "Up next"). */
  upcoming?: { title: string; artist: string; cover: string | null }[];
};

/** The `count` songs after the one ending at `endsAt`, read off the same rotation the channel plays. */
function upcomingAfter(c: Channel, endsAt: number, count: number) {
  const out: NonNullable<ChannelSummary["upcoming"]> = [];
  let t = endsAt;
  for (let k = 0; k < count; k++) {
    const air = onAirAt(c.rotation, t + 1);
    if (!air) break;
    out.push({ title: air.track.title, artist: air.track.artist, cover: c.covers[air.track.code] ?? null });
    t = air.endsAt;
  }
  return out;
}

/** What every channel is playing at `at`. */
export function summarise(channels: Channel[], at: number): ChannelSummary[] {
  return channels.map((c) => {
    const air = onAirAt(c.rotation, at);
    return {
      slug: c.slug,
      name: c.name,
      imprint: c.imprint,
      tracks: c.rotation.tracks.length,
      totalMs: c.totalMs,
      now: air && { track: air.track, startedAt: air.startedAt, endsAt: air.endsAt, fadeMs: air.fadeMs },
      next: air?.next ?? null,
      art: c.art,
      cover: (air && c.covers[air.track.code]) || null,
      nextCover: (air?.next && c.covers[air.next.code]) || null,
      upcoming: air ? upcomingAfter(c, air.endsAt, 3) : [],
    };
  });
}
