/**
 * Plays a live channel with radio-style crossfades.
 *
 * One audio element plays every song. Safari (macOS and iOS) only lets an
 * element start from a user's tap, and iOS plays one element at a time — a
 * second element starting the next song from a timer was blocked, so the
 * outgoing song faded into silence. The single element is the one the tap
 * started, so it may always move on to the next song.
 *
 * The element is never routed through Web Audio. Routing it
 * (createMediaElementSource) worked in Chrome, but in Safari its output
 * dropped out when it switched to the next file — the crossfade played,
 * then the music cut. The element is faded by plain volume; iOS ignores
 * volume but honours `muted`, which is enough to hide it while it lines up.
 *
 * The overlap comes from Web Audio playing a separate copy of the next
 * song's opening (the "head", ~1.2MB, fetched and decoded 12s ahead). At the
 * change the head fades in while the element's song fades out; then the
 * element, muted, jumps to the next song, lines itself up with the head, is
 * unmuted, and the head fades away. Fetching the head needs CORS on the
 * files (probeAudioCors), so without it, or if a head fails, the mixer
 * segues: the song fades out over its last CROSSFADE_MS and the next starts
 * on the clock, already downloaded so it starts at once. Never silence.
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

/** How long before a song change the next song is fetched. */
const PREFETCH_MS = 12_000;
/** Bytes of the next song's opening to fetch: ~25s at 320kbps, plus artwork. */
const HEAD_BYTES = 1_200_000;
/** Hand-over from the head to the element, desktop; iOS can't fade the element. */
const HANDOVER_MS = 250;
const HANDOVER_IOS_MS = 120;
/** iOS: how long after unmuting before the head is faded away. */
const IOS_UNMUTE_SETTLE_MS = 300;
/** -60dB: inaudible, but keeps the browser's audio output running. */
const SILENT = 0.001;
/** Let the element settle after starting or seeking before measuring it. */
const SETTLE_MS = 150;
/** Alignment: median of this many gap readings, this far apart. */
const ALIGN_SAMPLES = 8;
const ALIGN_INTERVAL_MS = 50;
const ALIGN_TOLERANCE_S = 0.04;
/** If the element hasn't lined up by then, hand over anyway. */
const HANDOVER_TIMEOUT_MS = 2500;

/**
 * Whether audio files can be read cross-origin, which fetching heads needs.
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

/** The next song's head, playing through Web Audio: started when, from where. */
type Bridge = { source: AudioBufferSourceNode; gain: GainNode; startedAt: number; offset: number };

export class ChannelMixer {
  static current: ChannelMixer | null = null;

  private el: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  /** iOS: element volume is read-only. */
  private volumeWorks = true;
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

  get mode() {
    if (!this.el) return "not started";
    const kind = this.ctx ? "crossfade (Web Audio heads)" : "segue (no CORS)";
    return this.volumeWorks ? kind : `${kind}, iOS volume`;
  }

  get contextState() {
    return this.ctx?.state ?? "none";
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
    const el = new Audio();
    el.preload = "auto";
    el.volume = 0.5;
    this.volumeWorks = Math.abs(el.volume - 0.5) < 0.01;
    el.volume = 1;

    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (corsOk === true && Ctx) {
      this.ctx = new Ctx();
      this.ctx.resume().catch(() => {});
      // iOS unlocks Web Audio on the first sound started inside a tap.
      const blip = this.ctx.createBufferSource();
      blip.buffer = this.ctx.createBuffer(1, 1, 22050);
      blip.connect(this.ctx.destination);
      blip.start(0);
    }

    el.addEventListener("playing", () => !this.switching && this.hooks.onStatus("playing"));
    el.addEventListener("waiting", () => !this.switching && !this.bridge && this.hooks.onStatus("loading"));
    el.addEventListener("error", () => {
      this.switching = false;
      this.hooks.onStatus("error");
    });
    // Safety net: the song ran out before the change timer fired.
    el.addEventListener("ended", () => this.running && !this.switching && this.mixNow("ended"));
    this.el = el;
  }

  // --- levels ------------------------------------------------------------------

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
    param.setValueCurveAtTime(ChannelMixer.curve(from, to), t, Math.max(0.03, ms / 1000));
  }

  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  /** Element volume fade. A no-op on iOS, which ignores volume. */
  private fadeEl(from: number, to: number, ms: number) {
    const el = this.el;
    if (!el) return;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    if (ms <= 0) {
      el.volume = to;
      return;
    }
    const curve = ChannelMixer.curve(from, to);
    let i = 0;
    this.fadeTimer = setInterval(() => {
      el.volume = Math.min(1, Math.max(0, curve[Math.min(i++, curve.length - 1)]));
      if (i >= curve.length && this.fadeTimer) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
      }
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
    const el = this.el!;
    el.muted = false;
    this.fadeEl(1, 1, 0);
    this.loadInto(air);
    this.hooks.onStatus("loading");
    el.play().catch(() => this.hooks.onStatus("error"));
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
      () => (this.ctx ? this.prefetchHead(air) : this.warmNext(air)),
      Math.max(0, until - PREFETCH_MS),
    ));
    // Decide how to change songs one fade-length before the change: a segue
    // needs that long to fade out; an overlap then waits for the change.
    this.timers.push(setTimeout(() => this.mixNow("clock"), Math.max(0, until - air.fadeMs)));
  }

  private async nextAfter(current: Playing) {
    const rotation = await this.hooks.getRotation();
    return rotation ? onAirAt(rotation, current.endsAt + 1) : null;
  }

  /** Segue mode: download the next song into the browser cache ahead of time. */
  private async warmNext(current: Playing) {
    const next = await this.nextAfter(current).catch(() => null);
    if (!next || this.air !== current) return;
    fetch(next.track.src, { mode: "no-cors" }).then((r) => r.arrayBuffer()).catch(() => {});
  }

  /** Fetch and decode the opening of the song after `current`. */
  private async prefetchHead(current: Playing) {
    try {
      const next = await this.nextAfter(current);
      if (!next || !this.ctx || this.air !== current) return;
      // no-store: a copy the element cached earlier (a no-cors request) has
      // no CORS header, and reusing it would fail this read.
      const res = await fetch(next.track.src, { mode: "cors", cache: "no-store" });
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

    if (reason === "ended") return this.segue(next, 0);

    // The head must cover from where the next song starts, through the fade,
    // with a few seconds to spare for the element to load and line up.
    const head = this.head?.src === next.track.src ? this.head : null;
    const startsAt = Math.max(next.track.cueInMs / 1000, (current.endsAt - next.startedAt) / 1000);
    const enough = head && head.buffer.duration >= startsAt + current.fadeMs / 1000 + 3;
    const wait = Math.max(0, current.endsAt - Date.now());

    if (head && enough && this.ctx) {
      this.stopTimers();
      this.timers.push(setTimeout(() => this.overlap(current, next, head.buffer), wait));
    } else {
      if (head && !enough) this.lastMix = { mode: "segue", at: Date.now(), reason: "head too short" };
      this.segue(next, wait);
    }
  }

  /** True crossfade: the next song's head over the current song's tail. */
  private overlap(current: Playing, next: Playing, buffer: AudioBuffer) {
    if (!this.running || this.air !== current) return;
    const ctx = this.ctx!;
    const fadeMs = current.fadeMs;
    // Where the next song should be right now, by the clock.
    const offset = Math.max(next.track.cueInMs / 1000, (Date.now() - next.startedAt) / 1000);
    const from = Math.min(offset, Math.max(0, buffer.duration - 0.05));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain).connect(ctx.destination);
    this.stopBridge();
    this.bridge = { source, gain, startedAt: ctx.currentTime, offset: from };
    // The element is still on the outgoing song: ignore its events (and its
    // "ended") until switchElement has moved it on.
    this.switching = true;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    source.start(0, from);
    this.rampParam(gain.gain, 0, 1, fadeMs);
    this.fadeEl(1, SILENT, fadeMs);
    this.lastMix = { mode: "overlap", at: Date.now() };
    // The head is now the sound of the channel: report the new song.
    this.stopTimers();
    this.nowPlaying(next);
    this.timers.push(setTimeout(() => this.switchElement(next, true), fadeMs));
  }

  /** No overlap: fade the current song out over `wait`, then start the next. */
  private segue(next: Playing, wait: number) {
    if (wait > 0) this.fadeEl(1, SILENT, wait);
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
    // Silent until it is in place. Desktop: a near-zero volume — muting, or
    // volume exactly 0, lets Chrome park its audio output, and restarting it
    // stalls the element ~150ms right at the hand-over. iOS ignores volume,
    // so there it has to be muted.
    this.fadeEl(SILENT, SILENT, 0);
    if (!this.volumeWorks) el.muted = true;
    this.loadInto(next);

    let done = false;
    const handover = () => {
      if (done) return;
      done = true;
      this.switching = false;
      this.hooks.onStatus("playing");
      const bridge = this.bridge;
      if (!fromBridge || !bridge || !this.ctx) {
        el.muted = false;
        this.fadeEl(0, 1, 200);
        return;
      }
      const fadeOutHead = (ms: number) => {
        this.rampParam(bridge.gain.gain, 1, 0, ms);
        setTimeout(() => this.bridge === bridge && this.stopBridge(), ms + 60);
      };
      if (this.volumeWorks) {
        this.fadeEl(SILENT, 1, HANDOVER_MS);
        fadeOutHead(HANDOVER_MS);
      } else {
        // iOS: unmute (full volume — it can't be faded), let any unmute
        // hiccup pass while the head still plays in step, then drop the head.
        el.muted = false;
        setTimeout(() => fadeOutHead(HANDOVER_IOS_MS), IOS_UNMUTE_SETTLE_MS);
      }
    };

    // With a head playing, the element stays silent until it runs in step
    // with it. Browsers report currentTime coarsely while an element is near
    // silent (steps of ~150ms in Chrome), so one reading can't be trusted:
    // take the median of several over ~0.4s, correct once if needed, then
    // hand over. The head is at full volume meanwhile, so waiting is free.
    const measureGap = () =>
      new Promise<number>((resolve) => {
        const gaps: number[] = [];
        const id = setInterval(() => {
          const bridge = this.bridge;
          const ctx = this.ctx;
          if (!bridge || !ctx) {
            clearInterval(id);
            return resolve(0);
          }
          gaps.push(bridge.offset + (ctx.currentTime - bridge.startedAt) - el.currentTime);
          if (gaps.length >= ALIGN_SAMPLES) {
            clearInterval(id);
            gaps.sort((a, b) => a - b);
            resolve(gaps[gaps.length >> 1]);
          }
        }, ALIGN_INTERVAL_MS);
      });
    const align = async (attempt: number) => {
      if (done) return;
      const gap = await measureGap();
      if (Math.abs(gap) <= ALIGN_TOLERANCE_S || attempt >= 2 || !this.bridge) return handover();
      el.addEventListener("seeked", () => setTimeout(() => align(attempt + 1), SETTLE_MS), { once: true });
      el.currentTime = el.currentTime + gap;
    };

    el.addEventListener(
      "playing",
      () => {
        if (fromBridge && this.bridge && this.ctx) {
          setTimeout(() => void align(0), SETTLE_MS);
          setTimeout(handover, HANDOVER_TIMEOUT_MS); // if alignment never settles
        } else {
          handover();
        }
      },
      { once: true },
    );
    el.play().catch(() => {
      this.switching = false;
      el.muted = false;
      this.hooks.onStatus("error");
    });
  }
}
