// Cleans voiceovers: takes away room noise, hum and background so only the voice is left
// (Inworld Voice Isolator, running on this Mac's GPU), then evens out the level.
//
//   Drop recordings in   SQUARE BUSINESS/VOICEOVERS/To clean
//   Clean copies land in SQUARE BUSINESS/VOICEOVERS/Cleaned     as "<name> (clean).wav/.mp3"
//   Originals move to    SQUARE BUSINESS/VOICEOVERS/Originals   once cleaned, so nothing is done twice.
//
//   node scripts/admin/jobs/voiceover.mjs [wav|mp3|both] [level|keep] [--apply]
//
// Needs the voice-isolate command (uv tool install --python 3.12 inworld-voice-isolation) and ffmpeg.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, join, parse } from "node:path";
import { LABELS_ROOT } from "../../catalog/scan.mjs";

const APPLY = process.argv.includes("--apply");
const [format = "wav", level = "level"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!["wav", "mp3", "both"].includes(format) || !["level", "keep"].includes(level)) fail("Choose WAV, MP3 or both, and whether to even out the level.");

const ROOT = join(LABELS_ROOT, "..", "VOICEOVERS");
const IN = join(ROOT, "To clean");
const OUT = join(ROOT, "Cleaned");
const DONE = join(ROOT, "Originals");
const ISOLATE = join(homedir(), ".local/bin/voice-isolate");
const TARGET = -16; // LUFS: the usual level for spoken word on social and podcasts
const KINDS = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".aif", ".aiff", ".caf", ".ogg", ".opus", ".mp4", ".mov", ".m4v"]);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
function run(cmd, argv, what) {
  const r = spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`${what} failed:\n${(r.stderr || r.stdout || "").trim().split("\n").slice(-6).join("\n")}`);
  return r;
}
function seconds(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(r.stdout.trim()) || 0;
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
/** "name (clean).wav", or "name (clean 2).wav" if that is taken. */
function freeName(dir, stem, ext) {
  for (let n = 1; ; n++) {
    const p = join(dir, `${stem} (clean${n > 1 ? ` ${n}` : ""})${ext}`);
    if (!existsSync(p)) return p;
  }
}
function freeMove(from, dir) {
  const { name, ext } = parse(from);
  let to = join(dir, `${name}${ext}`);
  for (let n = 2; existsSync(to); n++) to = join(dir, `${name} ${n}${ext}`);
  renameSync(from, to);
}

for (const d of [ROOT, IN, OUT, DONE]) mkdirSync(d, { recursive: true });
if (!existsSync(ISOLATE)) fail(`The voice isolator isn't installed (${ISOLATE}). Ask Claude to reinstall it.`);

const files = readdirSync(IN)
  .filter((n) => !n.startsWith(".") && KINDS.has(extname(n).toLowerCase()) && statSync(join(IN, n)).isFile())
  .sort((a, b) => a.localeCompare(b));
const others = readdirSync(IN).filter((n) => !n.startsWith(".") && !files.includes(n));

if (!files.length) {
  console.log(`Nothing to clean yet. Drop voiceovers in:\n  ${IN}`);
  if (others.length) console.log(`\nSkipped (not audio or video): ${others.join(", ")}`);
  process.exit(0);
}

const lengths = files.map((n) => seconds(join(IN, n)));
const total = lengths.reduce((a, b) => a + b, 0);
console.log(`${files.length} voiceover${files.length > 1 ? "s" : ""} to clean (${clock(total)} in all):`);
files.forEach((n, i) => console.log(`  ${n}  ·  ${clock(lengths[i])}`));
if (others.length) console.log(`Skipped (not audio or video): ${others.join(", ")}`);
const saveAs = { wav: "WAV (48 kHz, 24-bit)", mp3: "MP3 (320 kbps)", both: "WAV and MP3" }[format];
console.log(`\nSaves: ${saveAs}${level === "level" ? `, level evened out to ${TARGET} LUFS` : ", original level kept"}`);
console.log(`Into: ${OUT}`);
console.log(`Originals then move to: ${DONE}`);
console.log(`About ${Math.max(15, Math.round(total / 2 + 15))} seconds.`);
if (!APPLY) process.exit(0);

// 1. Every file to 48 kHz mono WAV (handles phone memos and video), numbered so odd names can't trip anything.
const tmp = mkdtempSync(join(tmpdir(), "voiceover-"));
try {
  const tin = join(tmp, "in");
  const tout = join(tmp, "out");
  mkdirSync(tin);
  mkdirSync(tout);
  console.log("\nReading the recordings…");
  files.forEach((n, i) =>
    run("ffmpeg", ["-v", "error", "-y", "-i", join(IN, n), "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", join(tin, `${i}.wav`)], `Reading ${n}`),
  );

  // 2. Isolate the voice, all files in one go so the model loads once.
  console.log("Taking away the background (Metal GPU)…");
  run(ISOLATE, [tin, tout, "--no-background"], "The voice isolator");

  // 3. Level and save each one.
  const doneNames = [];
  for (const [i, n] of files.entries()) {
    const voice = join(tout, `${i}.wav`);
    if (!existsSync(voice)) fail(`No cleaned voice came back for ${n}.`);
    let filter = [];
    if (level === "level") {
      const m = run("ffmpeg", ["-hide_banner", "-i", voice, "-af", `loudnorm=I=${TARGET}:TP=-1.5:LRA=11:print_format=json`, "-f", "null", "-"], `Measuring ${n}`);
      const from = m.stderr.lastIndexOf("{");
      const j = JSON.parse(m.stderr.slice(from, m.stderr.indexOf("}", from) + 1));
      filter = ["-af", `loudnorm=I=${TARGET}:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`];
    }
    const stem = parse(n).name;
    const outs = [];
    if (format !== "mp3") {
      const p = freeName(OUT, stem, ".wav");
      run("ffmpeg", ["-v", "error", "-y", "-i", voice, ...filter, "-ar", "48000", "-c:a", "pcm_s24le", p], `Saving ${n}`);
      outs.push(parse(p).base);
    }
    if (format !== "wav") {
      const p = freeName(OUT, stem, ".mp3");
      run("ffmpeg", ["-v", "error", "-y", "-i", voice, ...filter, "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "320k", p], `Saving ${n}`);
      outs.push(parse(p).base);
    }
    freeMove(join(IN, n), DONE);
    doneNames.push(`  ${n}  →  ${outs.join(" + ")}`);
  }
  console.log(`\nDone. Cleaned ${files.length}:`);
  console.log(doneNames.join("\n"));
  console.log(`\nThey're in ${OUT}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
