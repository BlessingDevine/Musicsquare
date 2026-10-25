// Loudness levelling for the streaming MP3s (Oct 2026): every song plays at the
// same perceived loudness on the channels, GoSquare and squaredrum.com.
//
// Gain only, never compression: the song is measured (EBU R 128 integrated
// loudness, like RadioKing's "advanced normalization") and turned DOWN to
// TARGET_LUFS with mp3gain, which rewrites each frame's global gain instead of
// re-encoding, so nothing is lost. Steps are 1.5 dB, so a song lands within
// ±0.75 dB of the target. Songs already at or below the target are left alone:
// raising them would need a limiter, because the masters peak at 0 dB.
//
// Masters in LABELS are never touched; only the copy that is streamed.
// Needs ffmpeg and mp3gain (`brew install ffmpeg mp3gain`).

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** RadioKing is set to the same target, so the live stream and the channels match. */
export const TARGET_LUFS = -14;
const STEP_DB = 1.5;

/** Integrated loudness (LUFS) and true peak (dBTP) of an audio file. */
export async function measure(file) {
  const { stderr } = await run("ffmpeg", ["-nostdin", "-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
  const peak = Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
  if (!Number.isFinite(lufs)) throw new Error("could not measure loudness");
  return { lufs, peak };
}

/** mp3gain steps (1.5 dB each) that bring `lufs` down to the target; 0 when it is already there or quieter. */
export const stepsFor = (lufs) => Math.min(0, Math.round((TARGET_LUFS - lufs) / STEP_DB));

/**
 * Levels an MP3 held in memory. Returns the bytes to stream (the same buffer
 * when no change is needed) with what was measured and applied.
 */
export async function levelMp3(bytes) {
  const dir = await mkdtemp(join(tmpdir(), "level-"));
  const file = join(dir, "song.mp3");
  try {
    await writeFile(file, bytes);
    const { lufs, peak } = await measure(file);
    const steps = stepsFor(lufs);
    if (steps === 0) return { bytes, lufs, peak, steps, gainDb: 0 };
    // -s s: write no ReplayGain tags; -q: quiet. Only lowering, so it can't clip.
    await run("mp3gain", ["-g", String(steps), "-s", "s", "-q", file]);
    return { bytes: await readFile(file), lufs, peak, steps, gainDb: steps * STEP_DB };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
