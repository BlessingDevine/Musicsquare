// Cleans voiceovers: takes away room noise, hum and background so only the voice is left
// (Inworld Voice Isolator, running on this Mac's GPU), then evens out the level.
//
//   Default folder:   SQUARE BUSINESS/VOICEOVERS/To clean   (uploads from Admin land here)
//   Clean copies:     VOICEOVERS/Cleaned as "<name> (clean).wav/.mp3", or next to the originals (--dest beside)
//   Originals:        from To clean they move to VOICEOVERS/Originals, so nothing is done twice;
//                     anywhere else they stay put, and files that already have a clean copy are skipped.
//
//   node scripts/admin/jobs/voiceover.mjs [--src <folder>] [--dest cleaned|beside] [--format wav|mp3|both]
//        [--level level|keep] [--strength 0-100] [--apply]
//   node scripts/admin/jobs/voiceover.mjs --src <folder> --audition <file name> --out <folder>
//        (writes orig.wav and voice.wav, the first 30 seconds, for listening in Admin)
//
// Strength 100 keeps only the voice; 60 leaves 40% of the original background in.
// Needs the voice-isolate command (uv tool install --python 3.12 inworld-voice-isolation) and ffmpeg.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, join, parse, resolve } from "node:path";
import { LABELS_ROOT } from "../../catalog/scan.mjs";

export const VO_ROOT = join(LABELS_ROOT, "..", "VOICEOVERS");
export const VO_INBOX = join(VO_ROOT, "To clean");
export const KINDS = new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".aif", ".aiff", ".caf", ".ogg", ".opus", ".mp4", ".mov", ".m4v"]);
const OUT = join(VO_ROOT, "Cleaned");
const DONE = join(VO_ROOT, "Originals");
const ISOLATE = join(homedir(), ".local/bin/voice-isolate");
const TARGET = -16; // LUFS: the usual level for spoken word on social and podcasts
const AUDITION_SECONDS = 30;

/** Audio and video files directly in a folder (not its subfolders), skipping our own "(clean)" copies. */
export function voiceFiles(dir) {
  return readdirSync(dir)
    .filter((n) => !n.startsWith(".") && KINDS.has(extname(n).toLowerCase()) && !/\(clean( \d+)?\)$/.test(parse(n).name) && statSync(join(dir, n)).isFile())
    .sort((a, b) => a.localeCompare(b));
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
function opt(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
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
/** Any file to 48 kHz mono float WAV (handles phone memos and video). */
const toWav = (from, to, extra = []) =>
  run("ffmpeg", ["-v", "error", "-y", "-i", from, ...extra, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_f32le", to], `Reading ${parse(from).base}`);

async function main() {
  const src = resolve(opt("src", VO_INBOX));
  const inbox = src === resolve(VO_INBOX);
  for (const d of [VO_ROOT, VO_INBOX, OUT, DONE]) mkdirSync(d, { recursive: true });
  if (!existsSync(src) || !statSync(src).isDirectory()) fail(`Folder not found: ${src}`);
  if (!existsSync(ISOLATE)) fail(`The voice isolator isn't installed (${ISOLATE}). Ask Claude to reinstall it.`);

  // --- audition: the first 30 seconds of one file, before and after ---
  const audition = opt("audition");
  if (audition !== undefined) {
    const out = resolve(opt("out", ""));
    const file = join(src, parse(audition).base);
    if (!existsSync(file)) fail(`Not found: ${audition}`);
    const tmp = mkdtempSync(join(tmpdir(), "vo-audition-"));
    try {
      mkdirSync(join(tmp, "in"));
      mkdirSync(join(tmp, "out"));
      toWav(file, join(tmp, "in", "a.wav"), ["-t", String(AUDITION_SECONDS)]);
      run(ISOLATE, [join(tmp, "in"), join(tmp, "out"), "--no-background"], "The voice isolator");
      mkdirSync(out, { recursive: true });
      run("ffmpeg", ["-v", "error", "-y", "-i", join(tmp, "in", "a.wav"), "-c:a", "pcm_s16le", join(out, "orig.wav")], "Saving the audition");
      run("ffmpeg", ["-v", "error", "-y", "-i", join(tmp, "out", "a.wav"), "-c:a", "pcm_s16le", join(out, "voice.wav")], "Saving the audition");
      console.log(`Audition ready: ${parse(file).base}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }

  // --- the real job (preview without --apply) ---
  const APPLY = process.argv.includes("--apply");
  const format = opt("format", "wav");
  const level = opt("level", "level");
  const dest = opt("dest", "cleaned");
  const strength = Number(opt("strength", "100"));
  if (!["wav", "mp3", "both"].includes(format) || !["level", "keep"].includes(level) || !["cleaned", "beside"].includes(dest)) fail("Something in the form isn't allowed.");
  if (!Number.isInteger(strength) || strength < 0 || strength > 100) fail("Strength must be 0 to 100.");
  const exts = format === "both" ? [".wav", ".mp3"] : [`.${format}`];
  const outDir = dest === "beside" ? src : OUT;

  const all = voiceFiles(src);
  const done = all.filter((n) => exts.some((e) => existsSync(join(outDir, `${parse(n).name} (clean)${e}`))));
  const files = inbox ? all : all.filter((n) => !done.includes(n));
  const others = readdirSync(src).filter((n) => !n.startsWith(".") && !all.includes(n) && statSync(join(src, n)).isFile() && !/\(clean( \d+)?\)$/.test(parse(n).name));

  console.log(`Folder: ${src}`);
  if (!inbox && done.length) console.log(`Already cleaned, skipped: ${done.join(", ")}`);
  if (!files.length) {
    console.log(inbox ? "Nothing to clean yet. Upload files or drop them in this folder." : "Nothing new to clean in this folder.");
    if (others.length) console.log(`Skipped (not audio or video): ${others.join(", ")}`);
    return;
  }
  const lengths = files.map((n) => seconds(join(src, n)));
  const total = lengths.reduce((a, b) => a + b, 0);
  console.log(`${files.length} voiceover${files.length > 1 ? "s" : ""} to clean (${clock(total)} in all):`);
  files.forEach((n, i) => console.log(`  ${n}  ·  ${clock(lengths[i])}`));
  if (others.length) console.log(`Skipped (not audio or video): ${others.join(", ")}`);
  const saveAs = { wav: "WAV (48 kHz, 24-bit)", mp3: "MP3 (320 kbps)", both: "WAV and MP3" }[format];
  console.log(`\nStrength: ${strength}%${strength < 100 ? ` (${100 - strength}% of the background kept)` : " (voice only)"}`);
  console.log(`Saves: ${saveAs}${level === "level" ? `, level evened out to ${TARGET} LUFS` : ", original level kept"}`);
  console.log(`Into: ${dest === "beside" ? "the same folder, next to each original" : OUT}`);
  console.log(inbox ? `Originals then move to: ${DONE}` : "Originals stay where they are.");
  console.log(`About ${Math.max(15, Math.round(total / 2 + 15))} seconds.`);
  if (!APPLY) return;

  const tmp = mkdtempSync(join(tmpdir(), "voiceover-"));
  try {
    const tin = join(tmp, "in");
    const tout = join(tmp, "out");
    mkdirSync(tin);
    mkdirSync(tout);
    // 1. Every file to 48 kHz mono WAV, numbered so odd names can't trip anything.
    console.log("\nReading the recordings…");
    files.forEach((n, i) => toWav(join(src, n), join(tin, `${i}.wav`)));

    // 2. Isolate the voice, all files in one go so the model loads once.
    console.log("Taking away the background (Metal GPU)…");
    run(ISOLATE, [tin, tout, "--no-background"], "The voice isolator");

    // 3. Blend back some background if asked, level, and save each one.
    const lines = [];
    for (const [i, n] of files.entries()) {
      let voice = join(tout, `${i}.wav`);
      if (!existsSync(voice)) fail(`No cleaned voice came back for ${n}.`);
      if (strength < 100) {
        const s = strength / 100;
        const mixed = join(tmp, `${i}-mix.wav`);
        run("ffmpeg", ["-v", "error", "-y", "-i", voice, "-i", join(tin, `${i}.wav`), "-filter_complex", `[0][1]amix=inputs=2:weights=${s} ${1 - s}:normalize=0:duration=first`, "-c:a", "pcm_f32le", mixed], `Blending ${n}`);
        voice = mixed;
      }
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
        const p = freeName(outDir, stem, ".wav");
        run("ffmpeg", ["-v", "error", "-y", "-i", voice, ...filter, "-ar", "48000", "-c:a", "pcm_s24le", p], `Saving ${n}`);
        outs.push(parse(p).base);
      }
      if (format !== "wav") {
        const p = freeName(outDir, stem, ".mp3");
        run("ffmpeg", ["-v", "error", "-y", "-i", voice, ...filter, "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "320k", p], `Saving ${n}`);
        outs.push(parse(p).base);
      }
      if (inbox) freeMove(join(src, n), DONE);
      lines.push(`  ${n}  →  ${outs.join(" + ")}`);
    }
    console.log(`\nDone. Cleaned ${files.length}:`);
    console.log(lines.join("\n"));
    console.log(`\nThey're in ${outDir}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Run only when started as a script (Admin's server imports voiceFiles from here).
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main();
