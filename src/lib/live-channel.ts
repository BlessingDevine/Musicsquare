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
 * seeded by the channel and the pass number, so it is identical everywhere,
 * then each artist's songs are spread out through the pass (see spread and spaced).
 *
 * Pure functions only: this runs on the server (for "on now" lines) and in
 * the player.
 */

import { hashString, seededRandom, seededShuffle } from "./seeded";

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

/**
 * Artist spacing, like a real station. spread() puts every artist as far apart as the channel allows;
 * this is the gap kept across the join between two passes: after a song, the same artist doesn't come
 * back for this many songs. Smaller when a channel can't hold it (few artists, or one with most songs).
 */
const ARTIST_GAP = 4;

function gapFor(tracks: readonly ChannelTrack[]) {
  const counts = new Map<string, number>();
  for (const t of tracks) counts.set(t.artist, (counts.get(t.artist) ?? 0) + 1);
  const most = Math.max(0, ...counts.values());
  // The widest gap the biggest artist can keep all the way through: m songs need (m - 1) * (gap + 1) + 1
  // slots. Asking for more than that bunches their songs together instead (Pop Square is most of Pop).
  const fits = most > 1 ? Math.floor((tracks.length - 1) / (most - 1)) - 1 : ARTIST_GAP;
  return Math.max(0, Math.min(ARTIST_GAP, counts.size - 1, fits));
}

/**
 * Spreads each artist's songs evenly through the pass, so every artist is as far apart as the
 * channel allows (Spotify's shuffle does the same). Each artist's songs keep their shuffled order;
 * song i of an artist with n songs sits at (i + offset) / n, with the artist's offset random from the
 * seed, and the pass is read off in that order. Deterministic.
 */
function spread(shuffled: readonly ChannelTrack[], seed: string): ChannelTrack[] {
  const byArtist = new Map<string, ChannelTrack[]>();
  for (const t of shuffled) (byArtist.get(t.artist) ?? byArtist.set(t.artist, []).get(t.artist)!).push(t);
  const rand = seededRandom(hashString(`${seed}:spread`));
  const placed: { t: ChannelTrack; at: number; tie: number }[] = [];
  let tie = 0;
  for (const songs of byArtist.values()) {
    const offset = rand();
    songs.forEach((t, i) => placed.push({ t, at: (i + offset) / songs.length, tie: tie++ }));
  }
  placed.sort((x, y) => x.at - y.at || x.tie - y.tie);
  return placed.map((p) => p.t);
}

/**
 * Then enforces the gap where the channel can hold one: a song whose artist played in the last `gap`
 * songs waits for a later slot. An artist with so many songs left that they could no longer be spaced
 * goes first, so nothing piles up at the end. Keeps spread()'s order wherever it can. Deterministic.
 */
function spaced(order: readonly ChannelTrack[], gap: number): ChannelTrack[] {
  if (gap <= 0) return order.slice();
  const pool = order.slice();
  const out: ChannelTrack[] = [];
  const left = new Map<string, number>();
  for (const t of pool) left.set(t.artist, (left.get(t.artist) ?? 0) + 1);
  while (pool.length) {
    const recent = new Set(out.slice(-gap).map((t) => t.artist));
    let urgent: string | null = null;
    for (const [artist, n] of left) {
      if (n > 0 && !recent.has(artist) && (n - 1) * (gap + 1) + 1 >= pool.length) {
        urgent = artist;
        break;
      }
    }
    let i = urgent ? pool.findIndex((t) => t.artist === urgent) : pool.findIndex((t) => !recent.has(t.artist));
    if (i < 0) i = 0; // nothing fits: take the next song anyway
    const [t] = pool.splice(i, 1);
    out.push(t);
    left.set(t.artist, (left.get(t.artist) ?? 1) - 1);
  }
  return out;
}

/**
 * Keeps the spacing across the join between passes: the first songs of this pass are swapped, if
 * needed, with songs from further in, so they don't repeat an artist from the end of the previous
 * pass. Only the start of a pass changes, never its last `gap` songs, so each pass's ending (which
 * the next pass checks against) is the same however it began.
 */
function fixStart(order: ChannelTrack[], prevTail: string[], gap: number) {
  if (gap <= 0 || order.length <= gap * 3) return order;
  const artistsBefore = (i: number) => [...prevTail, ...order.slice(0, i).map((t) => t.artist)].slice(-gap);
  const clashesNear = (j: number, artist: string, skip: number) =>
    order.slice(Math.max(0, j - gap), j + gap + 1).some((t, k) => Math.max(0, j - gap) + k !== j && Math.max(0, j - gap) + k !== skip && t.artist === artist);
  for (let i = 0; i < gap; i++) {
    const before = artistsBefore(i);
    if (!before.includes(order[i].artist)) continue;
    for (let j = gap; j < order.length - gap; j++) {
      if (before.includes(order[j].artist) || clashesNear(i, order[j].artist, j) || clashesNear(j, order[i].artist, i)) continue;
      [order[i], order[j]] = [order[j], order[i]];
      break;
    }
  }
  return order;
}

// A pass is worked out from scratch each time, so remember the recent ones (the player asks every second).
const passCache = new Map<string, ChannelTrack[]>();

function spreadPass(rotation: Rotation, pass: number, gap: number) {
  const seed = `${rotation.slug}:${pass}`;
  return spaced(spread(seededShuffle(rotation.tracks, seed), seed), gap);
}

/** The rotation's order for one pass. Same inputs, same order, everywhere. */
function passOrder(rotation: Rotation, pass: number) {
  const key = `${rotation.slug}:${rotation.epoch}:${rotation.tracks.length}:${pass}`;
  const hit = passCache.get(key);
  if (hit) return hit;
  const gap = gapFor(rotation.tracks);
  const prevTail = spreadPass(rotation, pass - 1, gap).slice(-gap).map((t) => t.artist);
  const order = fixStart(spreadPass(rotation, pass, gap), gap ? prevTail : [], gap);
  if (passCache.size > 64) passCache.delete(passCache.keys().next().value as string);
  passCache.set(key, order);
  return order;
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
