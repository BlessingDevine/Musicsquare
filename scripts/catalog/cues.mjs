// Cue points for crossfading: where each song's sound starts, and the point
// a mix out should finish by. Measured from the audio, not guessed:
//
//   node scripts/catalog/cues.mjs          songs without cue points
//   node scripts/catalog/cues.mjs --all    recompute every song
//
// The importer calls analyse() for new songs, so this is only needed once
// for the existing catalogue, or after changing the thresholds below.
//
// Method: decode to mono 4kHz PCM with ffmpeg, measure loudness in 250ms
// windows, and take the song's body level as the 90th percentile window.
//   cue in  = first window within 30dB of the body (leading silence/hiss)
//   cue out = end of the last window within 45dB of the body — the song's
//             real end, natural fade and all; only the silence after it is
//             skipped, so the next song comes in over the last 3s of sound.
// Guards keep a mis-read song playable: at most 8s trimmed from the start,
// 20s from the end, and at least 30s of song left between the two.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 4000;
const WINDOW = RATE / 4; // 250ms of samples
const IN_DB = 30;
const OUT_DB = 45;
const MAX_IN_MS = 8000;
const MAX_TAIL_MS = 20000;
const MIN_BODY_MS = 30000;

function decode(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", file,
      "-ac", "1", "-ar", String(RATE), "-f", "s16le", "pipe:1"]);
    const chunks = [];
    let err = "";
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", (c) => (err += c));
    ff.on("error", (e) => reject(new Error(`ffmpeg not available: ${e.message}`)));
    ff.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim()))));
  });
}

/** { cueInMs, cueOutMs, durationMs } for one audio file. */
export async function analyse(file) {
  const pcm = await decode(file);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const levels = [];
  for (let i = 0; i + WINDOW <= samples.length; i += WINDOW) {
    let sum = 0;
    for (let j = i; j < i + WINDOW; j++) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / WINDOW) / 32768;
    levels.push(rms > 0 ? 20 * Math.log10(rms) : -120);
  }
  const durationMs = Math.round((samples.length / RATE) * 1000);
  if (levels.length < 8) return { cueInMs: 0, cueOutMs: durationMs, durationMs };

  const body = [...levels].sort((a, b) => a - b)[Math.floor(levels.length * 0.9)];
  const winMs = 250;
  let first = levels.findIndex((l) => l >= body - IN_DB);
  let last = levels.length - 1;
  while (last > 0 && levels[last] < body - OUT_DB) last--;

  let cueInMs = Math.min(Math.max(0, first) * winMs, MAX_IN_MS);
  let cueOutMs = Math.max(Math.min((last + 1) * winMs, durationMs), durationMs - MAX_TAIL_MS);
  if (cueOutMs - cueInMs < MIN_BODY_MS) {
    cueInMs = 0;
    cueOutMs = durationMs;
  }
  return { cueInMs, cueOutMs, durationMs };
}

// --- fill the catalogue ------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { createClient } = await import("@supabase/supabase-js");
  const { DEFAULT_ROOT } = await import("./scan.mjs");
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(join(here, "../../.env.local"));
  const db = createClient(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL.trim()).origin,
    process.env.SUPABASE_SECRET_KEY.trim(), { auth: { persistSession: false } });
  const audioBase = process.env.NEXT_PUBLIC_AUDIO_BASE_URL.trim().replace(/\/$/, "");
  const all = process.argv.includes("--all");

  const songs = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("songs").select("song_id, song_code, source_path, duration_ms, song_files(storage_key, file_type)")
      .order("song_code").range(from, from + 999);
    if (!all) q = q.is("cue_out_ms", null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    songs.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`${songs.length} songs to analyse`);

  const tally = { done: 0, failed: 0, trimmedIn: 0, trimmedOut: 0 };
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < songs.length) {
      const s = songs[next++];
      try {
        // The streaming copy — exactly what listeners hear, and it never
        // makes Google Drive download a cloud-only file. Else the local file.
        const local = join(DEFAULT_ROOT, s.source_path ?? "");
        const stream = s.song_files.find((f) => f.file_type === "mp3");
        const src = stream ? `${audioBase}/${stream.storage_key}` : s.source_path && existsSync(local) && local;
        if (!src) throw new Error("no audio");
        const { cueInMs, cueOutMs } = await analyse(src);
        // Clamp to the stored duration, which the channel clock uses.
        const out = Math.min(cueOutMs, s.duration_ms);
        const { error } = await db.from("songs").update({ cue_in_ms: cueInMs, cue_out_ms: out }).eq("song_id", s.song_id);
        if (error) throw new Error(error.message);
        tally.done++;
        if (cueInMs > 0) tally.trimmedIn++;
        if (out < s.duration_ms - 500) tally.trimmedOut++;
      } catch (err) {
        tally.failed++;
        console.log(`  ${s.song_code} failed: ${err.message}`);
      }
      const n = tally.done + tally.failed;
      if (n % 200 === 0 || n === songs.length) {
        console.log(`${n}/${songs.length}  ${JSON.stringify(tally)}  ${((Date.now() - started) / 60000).toFixed(1)} min`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}
