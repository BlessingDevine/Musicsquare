/**
 * Live channels without a streaming server.
 *
 * Every channel is a rotation of songs with exact lengths and a fixed start
 * time (its epoch). Anyone who knows those can work out, from the clock alone,
 * which song is playing and how far into it — so every listener's browser
 * independently lands on the same song at the same second, and the audio is
 * plain files from the CDN.
 *
 * Each pass through the rotation is reshuffled, so a 70-song channel doesn't
 * repeat in the same order every three and a half hours. The shuffle is
 * seeded by the channel and the pass number, so it is identical everywhere.
 *
 * Pure functions only: this runs on the server (for "on now" lines) and in
 * the player.
 */

export type ChannelTrack = {
  code: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  src: string;
};

export type Rotation = {
  slug: string;
  epoch: number;
  tracks: ChannelTrack[];
};

export type OnAir = {
  track: ChannelTrack;
  next: ChannelTrack;
  /** How far into `track` the channel is right now. */
  offsetMs: number;
  startedAt: number;
  endsAt: number;
};

// mulberry32: tiny, fast, and the same in every JavaScript engine.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The rotation's order for one pass. Same inputs, same order, everywhere. */
function passOrder(rotation: Rotation, pass: number) {
  const order = rotation.tracks.slice();
  const rand = random(hash(`${rotation.slug}:${pass}`));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function onAirAt(rotation: Rotation, now: number): OnAir | null {
  const { tracks, epoch } = rotation;
  if (!tracks.length) return null;
  const total = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  if (total <= 0) return null;

  const elapsed = now - epoch;
  const pass = Math.floor(elapsed / total);
  let into = elapsed - pass * total;
  const order = passOrder(rotation, pass);

  for (let i = 0; i < order.length; i++) {
    const track = order[i];
    if (into < track.durationMs) {
      const startedAt = now - into;
      // The song after the last of a pass is the first of the next pass.
      const next = i + 1 < order.length ? order[i + 1] : passOrder(rotation, pass + 1)[0];
      return { track, next, offsetMs: into, startedAt, endsAt: startedAt + track.durationMs };
    }
    into -= track.durationMs;
  }
  return null; // unreachable: `into` is always less than `total`
}
