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
};

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
    };
  });
}
