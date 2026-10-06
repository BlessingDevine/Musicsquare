/**
 * Plays a live channel with radio-style crossfades: two decks, and at each
 * song change the next song starts while the current one fades out, over the
 * channel's CROSSFADE_MS.
 *
 * Volume goes through Web Audio gain nodes where possible — iOS ignores
 * HTMLMediaElement.volume, so a plain volume fade would be a hard cut on
 * iPhones. Routing audio through Web Audio needs CORS on the files
 * (CloudFront's SimpleCORS policy). If the browser has no Web Audio, or a
 * file fails to load in CORS mode, the mixer rebuilds its decks as plain
 * elements and carries on with volume fades (a clean cut on iOS) — the
 * music never stops for want of a fade.
 *
 * Timing comes from the channel clock (onAirAt): the crossfade starts exactly
 * when the clock says the next song begins, so everyone tuned in mixes at
 * the same moment. If a song reaches its end before the timer fires (a
 * throttled background tab), the change happens then instead.
 */

import { type OnAir, type Rotation, onAirAt } from "./live-channel";

/** What the mixer needs to know about the song it is playing. */
export type Playing = Pick<OnAir, "track" | "startedAt" | "endsAt" | "fadeMs">;

type Deck = { el: HTMLAudioElement; gain: GainNode | null };
export type MixerStatus = "loading" | "playing" | "error";

/** How long before a song change the next song starts loading. */
const PRELOAD_MS = 3000;

/**
 * Whether audio files can be read cross-origin (so Web Audio may route them).
 * Checked once per page, before anyone taps: a CORS GET that is aborted as
 * soon as the headers arrive. Some browsers have been seen to get no CORS
 * header from the CDN while curl and others do; in Web Audio mode that
 * would fail the first song, so the mixer only uses Web Audio once this has
 * come back true. Until then (or if false) it fades by element volume.
 */
let corsOk: boolean | null = null;
export function probeAudioCors(url: string) {
  if (corsOk !== null || typeof window === "undefined") return;
  const ac = new AbortController();
  fetch(url, { mode: "cors", cache: "no-store", signal: ac.signal })
    .then((r) => {
      corsOk = r.ok || r.status === 206;
      ac.abort();
    })
    .catch(() => {
      if (corsOk === null) corsOk = false;
    });
}

export class ChannelMixer {
  private ctx: AudioContext | null = null;
  private decks: [Deck, Deck] | null = null;
  private active = 0;
  private webAudio = true;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private air: Playing | null = null;
  private running = false;

  constructor(
    private readonly hooks: {
      getRotation: () => Promise<Rotation | null>;
      onStatus: (s: MixerStatus) => void;
      onTrack: (air: Playing) => void;
    },
  ) {}

  /**
   * Must run inside a user gesture (a tap or click): creates and resumes the
   * audio context and unlocks both decks, which iOS requires before either
   * may play later from a timer.
   */
  private prepare(firstSrc: string) {
    // Decide once, at the first tune-in: Web Audio only with CORS confirmed.
    if (!this.ctx && !this.decks) this.webAudio = corsOk === true;
    if (this.webAudio && !this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
      else this.webAudio = false;
    }
    this.ctx?.resume().catch(() => {});
    if (!this.decks) this.decks = [this.makeDeck(), this.makeDeck()];
    // Unlock the idle deck by starting and immediately pausing it, silently.
    const idle = this.decks[1 - this.active];
    this.setLevel(idle, 0);
    if (!idle.el.src) idle.el.src = firstSrc;
    idle.el.play().then(() => idle.el.pause()).catch(() => {});
  }

  private makeDeck(): Deck {
    const el = new Audio();
    el.preload = "auto";
    let gain: GainNode | null = null;
    if (this.webAudio && this.ctx) {
      el.crossOrigin = "anonymous";
      gain = this.ctx.createGain();
      this.ctx.createMediaElementSource(el).connect(gain).connect(this.ctx.destination);
    }
    el.addEventListener("playing", () => this.isActive(el) && this.hooks.onStatus("playing"));
    el.addEventListener("waiting", () => this.isActive(el) && this.hooks.onStatus("loading"));
    el.addEventListener("error", () => this.onDeckError(el));
    // Safety net: the song ran out before the crossfade timer fired.
    el.addEventListener("ended", () => this.isActive(el) && this.running && this.mixToNext());
    return { el, gain };
  }

  private isActive(el: HTMLAudioElement) {
    return this.decks?.[this.active].el === el;
  }

  private setLevel(deck: Deck, level: number) {
    if (deck.gain && this.ctx) deck.gain.gain.setValueAtTime(level, this.ctx.currentTime);
    else deck.el.volume = level;
  }

  /** Equal-power fade from `from` to `to` over `ms`. */
  private fade(deck: Deck, from: number, to: number, ms: number) {
    const steps = 32;
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const p = i / (steps - 1);
      const f = to > from ? Math.sin((p * Math.PI) / 2) : Math.cos((p * Math.PI) / 2);
      curve[i] = to > from ? from + (to - from) * f : to + (from - to) * f;
    }
    if (deck.gain && this.ctx) {
      const g = deck.gain.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setValueCurveAtTime(curve, this.ctx.currentTime, Math.max(0.05, ms / 1000));
    } else {
      // Plain elements: step the volume (has no effect on iOS — a clean cut there).
      let i = 0;
      const id = setInterval(() => {
        deck.el.volume = Math.min(1, Math.max(0, curve[Math.min(i++, steps - 1)]));
        if (i >= steps) clearInterval(id);
      }, ms / steps);
    }
  }

  private load(deck: Deck, air: Playing) {
    const offset = Math.max(0, (Date.now() - air.startedAt) / 1000);
    deck.el.src = offset > 1 ? `${air.track.src}#t=${offset.toFixed(1)}` : air.track.src;
    deck.el.addEventListener(
      "loadedmetadata",
      () => {
        // Correct for however long loading took.
        const target = (Date.now() - air.startedAt) / 1000;
        if (Math.abs(deck.el.currentTime - target) > 1.5) deck.el.currentTime = target;
      },
      { once: true },
    );
  }

  /** Start playing `air` now, on the active deck. Call from the tap itself. */
  start(air: Playing) {
    this.stopTimers();
    this.running = true;
    this.prepare(air.track.src);
    const decks = this.decks!;
    decks[1 - this.active].el.pause();
    const deck = decks[this.active];
    this.setLevel(deck, 1);
    this.load(deck, air);
    this.hooks.onStatus("loading");
    deck.el.play().catch(() => this.hooks.onStatus("error"));
    this.nowPlaying(air);
  }

  /** Start from the clock when no song is known yet (no hint, or a retry). */
  async startFromClock() {
    const rotation = await this.hooks.getRotation();
    const air = rotation && onAirAt(rotation, Date.now());
    if (!air) return this.hooks.onStatus("error");
    this.start(air);
  }

  stop() {
    this.running = false;
    this.stopTimers();
    this.decks?.forEach((d) => d.el.pause());
  }

  private stopTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private nowPlaying(air: Playing) {
    this.air = air;
    this.hooks.onTrack(air);
    const until = air.endsAt - Date.now();
    this.timers.push(setTimeout(() => this.preloadNext(), Math.max(0, until - PRELOAD_MS)));
    this.timers.push(setTimeout(() => this.mixToNext(), Math.max(0, until)));
  }

  private nextAir: Playing | null = null;

  private async preloadNext() {
    const current = this.air;
    const rotation = await this.hooks.getRotation();
    if (!this.running || !current || this.air !== current || !rotation) return;
    const next = onAirAt(rotation, current.endsAt + 1);
    if (!next) return;
    this.nextAir = next;
    const deck = this.decks![1 - this.active];
    this.setLevel(deck, 0);
    deck.el.src = next.track.cueInMs > 500
      ? `${next.track.src}#t=${(next.track.cueInMs / 1000).toFixed(2)}`
      : next.track.src;
    deck.el.load();
  }

  private mixing = false;

  private async mixToNext() {
    const current = this.air;
    if (!this.running || !current || this.mixing) return;
    this.mixing = true;
    try {
      let next: Playing | null = this.nextAir && this.nextAir.startedAt > current.startedAt ? this.nextAir : null;
      if (!next) {
        const rotation = await this.hooks.getRotation();
        next = rotation && onAirAt(rotation, current.endsAt + 1);
      }
      if (!next || !this.running || this.air !== current) return;
      this.nextAir = null;

      const decks = this.decks!;
      const out = decks[this.active];
      const into = decks[1 - this.active];
      // Already loaded by preloadNext? Otherwise load it now.
      if (!into.el.src.startsWith(next.track.src)) this.load(into, next);
      const late = Math.max(0, Date.now() - current.endsAt);
      const target = next.track.cueInMs / 1000 + late / 1000;
      if (into.el.readyState >= 1 && Math.abs(into.el.currentTime - target) > 0.75) into.el.currentTime = target;

      this.active = 1 - this.active;
      this.setLevel(into, 0);
      into.el.play().catch(() => this.hooks.onStatus("error"));
      const fadeMs = Math.max(200, current.fadeMs - late);
      this.fade(into, 0, 1, fadeMs);
      this.fade(out, 1, 0, fadeMs);
      this.timers.push(setTimeout(() => out.el.pause(), fadeMs + 100));
      this.nowPlaying(next);
    } finally {
      this.mixing = false;
    }
  }

  /** A file failed to load. In Web Audio mode this may be CORS: fall back. */
  private onDeckError(el: HTMLAudioElement) {
    if (!this.isActive(el)) return; // the idle deck's preload can retry later
    if (this.webAudio && this.ctx) {
      // Rebuild as plain elements (no CORS needed) and replay where we are.
      this.webAudio = false;
      this.decks?.forEach((d) => d.el.pause());
      this.decks = null;
      this.ctx.close().catch(() => {});
      this.ctx = null;
      if (this.running && this.air) {
        this.active = 0;
        this.start(this.air); // prepare() builds the plain decks
      }
      return;
    }
    this.hooks.onStatus("error");
  }
}
