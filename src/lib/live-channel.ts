/**
 * Live channels without a streaming server.
 *
 * Every channel is a rotation of songs with exact lengths and a fixed start
 * time (its epoch). Anyone who knows those can work out, from the clock alone,
 * which song is playing and how far into it — so every listener's browser
 * independently lands on the same song at the same second, and the audio is
 * plain files from the CDN.
 *
 * Songs crossfade like radio: each one plays from its cue in to its cue out
 * (measured from the audio, skipping silent heads and quiet tails), and the
 * next starts CROSSFADE_MS before the current one's cue out. The overlap is
 * part of the clock — a song's slot is its playing time minus the overlap —
 * so the mix doesn't push listeners out of step with each other.
 *
 * Each pass through the rotation is reshuffled, so a 70-song channel doesn't
 * repeat in the same order every three and a half hours. The shuffle is
 * seeded by the channel and the pass number, so it is identical everywhere.
 *
 * Pure functions only: this runs on the server (for "on now" lines) and in
 * the player.
 */

import { seededShuffle } from "./seeded";

export type ChannelTrack = {
  code: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  /** Where the sound starts, ms into the file (0 if unmeasured). */
  cueInMs: number;
  /** Where the mix out finishes, ms into the file (durationMs if unmeasured). */
  cueOutMs: number;
  src: string;
};

/** Length of the mix between songs. */
export const CROSSFADE_MS = 3000;

const playMs = (t: ChannelTrack) => Math.max(1, t.cueOutMs - t.cueInMs);
/** This song's fade out; never more than a third of a (very short) song. */
export const fadeOutMs = (t: ChannelTrack) => Math.min(CROSSFADE_MS, Math.floor(playMs(t) / 3));
/** Time from this song's start to the next song's start. */
const slotMs = (t: ChannelTrack) => playMs(t) - fadeOutMs(t);

export type Rotation = {
  slug: string;
  epoch: number;
  tracks: ChannelTrack[];
};

export type OnAir = {
  track: ChannelTrack;
  next: ChannelTrack;
  /** Position in `track`'s file right now (includes its cue in). */
  offsetMs: number;
  /** Wall time at which position 0 of the file would have played. */
  startedAt: number;
  /** When the next song starts and the crossfade begins. */
  endsAt: number;
  /** How long this song fades out for, from endsAt. */
  fadeMs: number;
};

/** The rotation's order for one pass. Same inputs, same order, everywhere. */
function passOrder(rotation: Rotation, pass: number) {
  return seededShuffle(rotation.tracks, `${rotation.slug}:${pass}`);
}

/** Length of one full pass through the rotation, crossfades included. */
export function rotationMs(rotation: Rotation) {
  return rotation.tracks.reduce((sum, t) => sum + slotMs(t), 0);
}

export function onAirAt(rotation: Rotation, now: number): OnAir | null {
  const { tracks, epoch } = rotation;
  if (!tracks.length) return null;
  const total = rotationMs(rotation);
  if (total <= 0) return null;

  const elapsed = now - epoch;
  const pass = Math.floor(elapsed / total);
  let into = elapsed - pass * total;
  const order = passOrder(rotation, pass);

  for (let i = 0; i < order.length; i++) {
    const track = order[i];
    const slot = slotMs(track);
    if (into < slot) {
      const slotStart = now - into;
      const offsetMs = track.cueInMs + into;
      // The song after the last of a pass is the first of the next pass.
      const next = i + 1 < order.length ? order[i + 1] : passOrder(rotation, pass + 1)[0];
      return {
        track,
        next,
        offsetMs,
        startedAt: now - offsetMs,
        endsAt: slotStart + slot,
        fadeMs: fadeOutMs(track),
      };
    }
    into -= slot;
  }
  return null; // unreachable: `into` is always less than `total`
}
