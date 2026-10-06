/**
 * Plays a live channel with radio-style crossfades.
 *
 * One audio element plays every song. Safari (macOS and iOS) only lets an
 * element start from a user's tap, and iOS plays one element at a time — a
 * second element starting the next song from a timer was blocked, so the
 * outgoing song faded into silence. The single element is the one the tap
 * started, so it may always move on to the next song.
 *
 * The overlap comes from Web Audio instead. Before each song change the
 * mixer fetches and decodes the opening of the next song (the "head", about
 * 1.2MB). At the change it plays the head through Web Audio, fading in, while
 * the element's song fades out; at the end of the fade the element jumps to
 * the next song at the same moment and takes over from the head. Web Audio
 * needs the files readable cross-origin (CloudFront's CORS policy) and is
 * only used once probeAudioCors has confirmed that.
 *
 * Without Web Audio — no CORS, or the head failed to load or decode — the
 * mixer segues instead: the song fades out over its last CROSSFADE_MS (by
 * element volume; iOS ignores volume, so there it is a cut) and the next song
 * starts on time. Never silence.
 *
 * Timing comes from the channel clock (onAirAt): the change happens when the
 * clock says, so everyone tuned in mixes at the same moment. If the element
 * reaches the end of a song before the timer fires (a throttled background
 * tab), the change happens then.
 */

import { type OnAir, type Rotation, onAirAt } from "./live-channel";

/** What the mixer needs to know about the song it is playing. */
export type Playing = Pick<OnAir, "track" | "startedAt" | "endsAt" | "fadeMs">;
export type MixerStatus = "loading" | "playing" | "error";
export type MixMode = "overlap" | "segue";

/** How long before a song change the next song's head is fetched. */
const PREFETCH_MS = 12_000;
/** Bytes of the next song to fetch for the overlap: ~25s at 320kbps + art. */
const HEAD_BYTES = 1_200_000;
/** Hand-over from the head to the element, once the element is playing. */
const HANDOVER_MS = 250;

/**
 * Whether audio files can be read cross-origin (so Web Audio may use them).
 * Checked once per page, before anyone taps: a CORS GET aborted as soon as
 * the headers arrive.
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
export const audioCorsStatus = () => corsOk;

/** The page's mixer, for the ?debug panel. */
export const currentMixer = () => ChannelMixer.current;

/** The next song's head, playing through Web Audio: where it started and from what point. */
type Bridge = { source: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number };

export class ChannelMixer {
  private el: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private elGain: GainNode | null = null;
  private webAudio = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private air: Playing | null = null;
  private running = false;
  private switching = false;
  private head: { src: string; buffer: AudioBuffer } | null = null;
  private bridge: Bridge | null = null;
  /** For the ?debug panel. */
  lastMix: { mode: MixMode; at: number; reason?: string } | null = null;

  constructor(
    private readonly hooks: {
      getRotation: () => Promise<Rotation | null>;
      onStatus: (s: MixerStatus) => void;
      onTrack: (air: Playing) => void;
    },
  ) {
    ChannelMixer.current = this;
  }

  static current: ChannelMixer | null = null;

  get contextState() {
    return this.ctx?.state ?? "none";
  }

  get mode() {
    if (!this.el) return "not started";
    return this.webAudio ? "web-audio (crossfade)" : "volume (segue)";
  }

  get headReady() {
    return !!this.head;
  }

  /** Must run inside the user's tap: builds the element and audio context. */
  private prepare() {
    if (this.el) {
      this.ctx?.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.webAudio = corsOk === true && !!Ctx;

    const el = new Audio();
    el.preload = "auto";
    if (this.webAudio && Ctx) {
      el.crossOrigin = "anonymous";
      this.ctx = new Ctx();
      this.elGain = this.ctx.createGain();
      this.ctx.createMediaElementSource(el).connect(this.elGain).connect(this.ctx.destination);
      this.ctx.resume().catch(() => {});
    }
    el.addEventListener("playing", () => !this.switching && this.hooks.onStatus("playing"));
    el.addEventListener("waiting", () => !this.switching && !this.bridge && this.hooks.onStatus("loading"));
    el.addEventListener("error", () => this.onElementError());
    // Safety net: the song ran out before the change timer fired.
    el.addEventListener("ended", () => this.running && !this.switching && this.mixNow("ended"));
    this.el = el;
  }

  // --- levels ------------------------------------------------------------------

  private setElLevel(level: number) {
    if (this.elGain && this.ctx) {
      const g = this.elGain.gain;
      g.cancelScheduledValues(this.ctx.currentTime);
      g.setValueAtTime(level, this.ctx.currentTime);
    } else if (this.el) {
      this.el.volume = level;
    }
  }

  private static curve(from: number, to: number) {
    const steps = 32;
    const c = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const p = i / (steps - 1);
      // Equal power: sin up, cos down.
      c[i] = to > from
        ? from + (to - from) * Math.sin((p * Math.PI) / 2)
        : to + (from - to) * Math.cos((p * Math.PI) / 2);
    }
    return c;
  }

  private rampParam(param: AudioParam, from: number, to: number, ms: number) {
    const t = this.ctx!.currentTime;
    param.cancelScheduledValues(t);
    param.setValueCurveAtTime(ChannelMixer.curve(from, to), t, Math.max(0.05, ms / 1000));
  }

  private fadeEl(from: number, to: number, ms: number) {
    if (this.elGain && this.ctx) return this.rampParam(this.elGain.gain, from, to, ms);
    const el = this.el;
    if (!el) return;
    const curve = ChannelMixer.curve(from, to);
    let i = 0;
    const id = setInterval(() => {
      el.volume = Math.min(1, Math.max(0, curve[Math.min(i++, curve.length - 1)]));
      if (i >= curve.length) clearInterval(id);
    }, ms / curve.length);
  }

  // --- playing -------------------------------------------------------------------

  private loadInto(air: Playing) {
    const el = this.el!;
    const offset = Math.max(0, (Date.now() - air.startedAt) / 1000);
    el.src = offset > 1 ? `${air.track.src}#t=${offset.toFixed(2)}` : air.track.src;
    el.addEventListener(
      "loadedmetadata",
      () => {
        // Correct for however long loading took.
        const target = (Date.now() - air.startedAt) / 1000;
        if (Math.abs(el.currentTime - target) > 1.5) el.currentTime = target;
      },
      { once: true },
    );
  }

  /** Start playing `air` now. Call from the tap itself. */
  start(air: Playing) {
    this.stopTimers();
    this.stopBridge();
    this.running = true;
    this.switching = false;
    this.prepare();
    this.setElLevel(1);
    this.loadInto(air);
    this.hooks.onStatus("loading");
    this.el!.play().catch(() => this.hooks.onStatus("error"));
    this.nowPlaying(air);
  }

  /** Start from the clock when no song is known yet. */
  async startFromClock() {
    const rotation = await this.hooks.getRotation();
    const air = rotation && onAirAt(rotation, Date.now());
    if (!air) return this.hooks.onStatus("error");
    this.start(air);
  }

  stop() {
    this.running = false;
    this.stopTimers();
    this.stopBridge();
    this.el?.pause();
  }

  private stopTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private stopBridge() {
    if (!this.bridge) return;
    try {
      this.bridge.source.stop();
    } catch {
      // already stopped
    }
    this.bridge.source.disconnect();
    this.bridge.gain.disconnect();
    this.bridge = null;
  }

  private nowPlaying(air: Playing) {
    this.air = air;
    this.head = null;
    this.hooks.onTrack(air);
    const until = air.endsAt - Date.now();
    this.timers.push(setTimeout(
      () => (this.webAudio ? this.prefetchHead(air) : this.warmNext(air)),
      Math.max(0, until - PREFETCH_MS),
    ));
    // An overlap starts at the change; a segue starts fading before it, so the
    // next song still starts on time.
    this.timers.push(setTimeout(() => this.mixNow("clock"), Math.max(0, until - (this.webAudio ? 0 : air.fadeMs))));
  }

  private async nextAfter(current: Playing) {
    const rotation = await this.hooks.getRotation();
    return rotation ? onAirAt(rotation, current.endsAt + 1) : null;
  }

  /**
   * Segue mode: download the next song into the browser's cache before the
   * change, so the element starts it at once instead of after seconds of
   * silence. (The files are cached for a year; a no-cors fetch needs no CORS.)
   */
  private async warmNext(current: Playing) {
    const next = await this.nextAfter(current).catch(() => null);
    if (!next || this.air !== current) return;
    fetch(next.track.src, { mode: "no-cors" })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }

  /** Fetch and decode the opening of the song after `current`. */
  private async prefetchHead(current: Playing) {
    try {
      const next = await this.nextAfter(current);
      if (!next || !this.ctx || this.air !== current) return;
      const res = await fetch(next.track.src, { mode: "cors" });
      if (!res.ok || !res.body) throw new Error(`head ${res.status}`);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < HEAD_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
      reader.cancel().catch(() => {});
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      const buffer = await this.ctx.decodeAudioData(bytes.buffer);
      if (this.air === current) this.head = { src: next.track.src, buffer };
    } catch (err) {
      this.lastMix = { mode: "segue", at: Date.now(), reason: `head failed: ${(err as Error)?.message ?? err}` };
    }
  }

  private async mixNow(reason: "clock" | "ended") {
    const current = this.air;
    if (!this.running || !current || this.switching) return;
    const next = await this.nextAfter(current);
    if (!next || !this.running || this.air !== current) return;
    const head = this.head?.src === next.track.src ? this.head : null;

    if (head && this.ctx && this.elGain && reason === "clock") this.overlap(current, next, head.buffer);
    else this.segue(current, next, reason === "ended");
  }

  /** True crossfade: the next song's head over the current song's tail. */
  private overlap(current: Playing, next: Playing, buffer: AudioBuffer) {
    const ctx = this.ctx!;
    const fadeMs = current.fadeMs;
    // Where the next song should be right now, by the clock.
    const offset = Math.max(next.track.cueInMs / 1000, (Date.now() - next.startedAt) / 1000);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    this.stopBridge();
    const from = Math.min(offset, Math.max(0, buffer.duration - 0.05));
    this.bridge = { source, gain, startedAt: ctx.currentTime, offset: from };
    // The element is still on the outgoing song: ignore its events (and its
    // "ended") until switchElement has moved it on.
    this.switching = true;
    source.start(0, from);
    this.rampParam(gain.gain, 0, 1, fadeMs);
    this.fadeEl(1, 0, fadeMs);
    this.lastMix = { mode: "overlap", at: Date.now() };
    // The head is now the sound of the channel: report the new song.
    this.stopTimers();
    this.nowPlaying(next);
    this.timers.push(setTimeout(() => this.switchElement(next, true), fadeMs));
  }

  /** No overlap: fade the current song out, then start the next on time. */
  private segue(current: Playing, next: Playing, immediate: boolean) {
    const wait = immediate ? 0 : Math.max(0, current.endsAt - Date.now());
    if (!immediate && wait > 0) this.fadeEl(1, 0, wait);
    this.lastMix = { mode: "segue", at: Date.now(), reason: this.lastMix?.reason };
    this.stopTimers();
    this.timers.push(setTimeout(() => {
      this.nowPlaying(next);
      this.switchElement(next, false);
    }, wait));
  }

  /** Point the element at `next`, at the clock's position, and hand over. */
  private switchElement(next: Playing, fromBridge: boolean) {
    const el = this.el;
    if (!el || !this.running) return;
    this.switching = true;
    el.pause();
    this.setElLevel(0);
    this.loadInto(next);
    el.addEventListener(
      "playing",
      () => {
        this.switching = false;
        this.hooks.onStatus("playing");
        const bridge = this.bridge;
        const ctx = this.ctx;
        if (fromBridge && bridge && ctx) {
          const handover = () => {
            this.rampParam(bridge.gain.gain, 1, 0, HANDOVER_MS);
            this.fadeEl(0, 1, HANDOVER_MS);
            setTimeout(() => this.bridge === bridge && this.stopBridge(), HANDOVER_MS + 50);
          };
          // Loading took a moment, so the element is a little behind the
          // head. Line it up before swapping, or the swap smears (an echo of
          // a few hundred ms). One seek; the data is already buffered.
          const headPos = bridge.offset + (ctx.currentTime - bridge.startedAt);
          if (Math.abs(headPos - el.currentTime) > 0.06) {
            el.addEventListener("seeked", handover, { once: true });
            el.currentTime = headPos + 0.05;
          } else {
            handover();
          }
        } else {
          this.fadeEl(0, 1, 200);
        }
      },
      { once: true },
    );
    el.play().catch(() => {
      this.switching = false;
      this.hooks.onStatus("error");
    });
  }

  private onElementError() {
    this.switching = false;
    this.hooks.onStatus("error");
  }
}
