// Synced lyrics: when each lyric line is sung, so GoSquare can light lines up
// as the song plays. Worked out on this Mac: whisper.cpp listens to the song
// (word by word, with times) and the written lyrics are lined up against
// what it heard.
//
//   node scripts/catalog/sync-lyrics.mjs                 time every song with lyrics, write the review list
//   node scripts/catalog/sync-lyrics.mjs --upload        ...and save the timings (song_lyrics.synced)
//   node scripts/catalog/sync-lyrics.mjs --only "Lea Babi"   just one artist (or a song title)
//   node scripts/catalog/sync-lyrics.mjs --hold "Lea Babi"   time them but don't upload (lyrics being checked)
//   add --show to print every line with its time
//
// Needs: brew install whisper-cpp, and the model at ~/Sites/models/ggml-large-v3-turbo.bin.
// Takes ~40s a song; results are cached in ~/Sites/canvas/../lyrics-sync/ by
// audio + lyrics checksum, so re-runs only redo changed songs.
//
// Stored per song: synced = {"v":1,"at":[[row, seconds, part], ...]} where row
// is the line's number in the lyrics text (0-based, blank lines counted) and
// part its piece when one text line holds several sung lines split by " / "
// (the Apex sheets) — the app shows those as separate lines. And
// synced_checksum = the lyrics checksum it was made from. When the lyrics
// are edited the checksums differ and the app shows plain lyrics again.
//
// Review list: "SQUARE BUSINESS/Lyrics check.md" — per song, how much of the
// sheet was heard and which lines weren't (changed, cut, or swapped between
// versions). Songs below 50% heard aren't uploaded.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_ROOT } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const UPLOAD = process.argv.includes("--upload");
const ONLY = arg("--only");
const HOLD = arg("--hold");
const SHOW = process.argv.includes("--show"); // print each line with its time
const MODEL = process.env.WHISPER_MODEL ?? join(homedir(), "Sites/models/ggml-large-v3-turbo.bin");
const CACHE = join(homedir(), "Sites/lyrics-sync");
const REPORT = join(DEFAULT_ROOT, "..", "Lyrics check.md");
const MIN_HEARD = 0.5;
mkdirSync(CACHE, { recursive: true });
const work = join(tmpdir(), "gosquare-sync");
mkdirSync(work, { recursive: true });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9']/g, "").replace(/'/g, "");
const words = (s) => s.split(/\s+/).map(norm).filter(Boolean);
const matches = (q) => (s) => norm(s).includes(norm(q));

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("song_lyrics")
    .select("song_id, lyrics, checksum, synced_checksum, songs(title, source_path, artists(artist_name))")
    .range(from, from + 999);
  if (error) throw new Error(`${error.message} (has migration 20261009000000 been run?)`);
  rows.push(...data);
  if (data.length < 1000) break;
}
const songs = rows
  .map((r) => ({ ...r, title: r.songs?.title, artist: r.songs?.artists?.artist_name ?? "", path: r.songs?.source_path }))
  .filter((r) => r.path && (!ONLY || matches(ONLY)(r.artist) || matches(ONLY)(r.title)))
  .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));

const SECTION = /^(intro|verse(?:\s*\d+)?|pre-?chorus|chorus|post-?chorus|bridge|hook|outro|interlude|refrain|breakdown|drop|break|final chorus)\b/i;

/** The sung lines of a sheet: [row, part, text] — headings, production notes and the title header left out. */
function sungLines(text, title, artist) {
  const skip = new Set([norm(title), norm(artist)]);
  const out = [];
  text.split("\n").forEach((raw, row) => {
    const line = raw.trim();
    if (!line || (!out.length && skip.has(norm(line)))) return;
    if (/^(song|title|track)?\s*\d{1,3}\s*[:.)]\s*["“].*["”]\s*$/i.test(line) && !out.length) return;
    if (/^(\[[^\]]*\]\s*,?\s*)+$/.test(line)) return; // [Chorus], [87 BPM]
    const tag = line.match(/^\(\s*([^)]+?)\s*\)$/);
    if (tag && SECTION.test(tag[1])) return; // (Chorus)
    if (SECTION.test(line) && line.length < 28) return; // Verse 1:
    const inline = line.match(/^(?:intro|verse(?:\s*\d+)?|pre-?chorus|chorus|bridge|hook|outro)\s*[:-]?\s+([A-Z].*)$/i);
    (inline ? inline[1] : line).split(/\s+\/\s+/).forEach((sung, part) => {
      if (words(sung).length) out.push([row, part, sung]);
    });
  });
  return out;
}

/** Whisper's words with start times (seconds), cached by audio checksum. */
function listen(file) {
  const audio = readFileSync(file);
  const sum = createHash("sha256").update(audio).digest("hex").slice(0, 20);
  const cached = join(CACHE, `${sum}.json`);
  if (!existsSync(cached)) {
    const wav = join(work, `${sum}.wav`);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-ar", "16000", "-ac", "1", wav]);
    execFileSync("whisper-cli", ["-m", MODEL, "-f", wav, "-l", "en", "-ml", "1", "-sow", "-oj", "-of", join(work, sum), "-np"], { stdio: "ignore" });
    const heard = JSON.parse(readFileSync(join(work, `${sum}.json`), "utf8")).transcription
      .map((t) => ({ w: norm(t.text), t: t.offsets.from / 1000 }))
      .filter((x) => x.w);
    writeFileSync(cached, JSON.stringify(heard));
  }
  return JSON.parse(readFileSync(cached, "utf8"));
}

/** Longest common subsequence of lyric words and heard words → heard index per lyric word (or -1). */
function align(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hit = new Array(n).fill(-1);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) (hit[i] = j), i++, j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return hit;
}

function time(lines, heard, durationS) {
  const flat = [];
  lines.forEach(([, , text], li) => words(text).forEach((w, wi) => flat.push({ w, li, wi })));
  const hit = align(flat.map((x) => x.w), heard.map((x) => x.w));
  const start = lines.map(() => null);
  const heardWords = lines.map(() => 0);
  const totalWords = lines.map((_, i) => flat.filter((x) => x.li === i).length);
  flat.forEach((x, k) => {
    if (hit[k] < 0) return;
    heardWords[x.li]++;
    // A line starts at its first heard word, nudged back for unheard words before it.
    if (start[x.li] === null) start[x.li] = Math.max(0, heard[hit[k]].t - 0.3 * x.wi);
  });
  // A line counts as placed only if enough of it was heard (one stray word can land anywhere).
  lines.forEach((_, i) => { if (heardWords[i] / totalWords[i] < 0.34 && totalWords[i] > 2) start[i] = null; });
  // Keep order: drop anchors that go backwards.
  let last = -1;
  for (let i = 0; i < start.length; i++) {
    if (start[i] === null) continue;
    if (start[i] <= last) start[i] = null;
    else last = start[i];
  }
  // Fill unplaced lines evenly between their neighbours.
  const n = start.length;
  for (let i = 0; i < n; i++) {
    if (start[i] !== null) continue;
    let j = i;
    while (j < n && start[j] === null) j++;
    const a = i > 0 ? start[i - 1] : Math.max(0, (start[j] ?? 3) - 3 * (j - i));
    const b = j < n ? start[j] : Math.min(durationS - 2, a + 3.5 * (j - i + 1));
    for (let k = i; k < j; k++) start[k] = a + ((b - a) * (k - i + (i > 0 ? 1 : 0))) / (j - i + (i > 0 ? 1 : 0));
    i = j;
  }
  const heardShare = heardWords.reduce((x, y) => x + y, 0) / Math.max(1, flat.length);
  const missing = lines.filter((_, i) => heardWords[i] === 0 && totalWords[i] > 1).map(([, , t]) => t);
  return { start: start.map((s) => Math.round(s * 100) / 100), heardShare, missing };
}

const report = [];
let uploaded = 0;
for (const [i, s] of songs.entries()) {
  const file = join(DEFAULT_ROOT, s.path);
  process.stdout.write(`[${i + 1}/${songs.length}] ${s.artist} — ${s.title} … `);
  if (!existsSync(file)) { console.log("audio file not found"); report.push({ s, error: "audio file not found" }); continue; }
  const lines = sungLines(s.lyrics, s.title, s.artist);
  const heard = listen(file);
  const durationS = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }));
  const r = time(lines, heard, durationS);
  const held = HOLD && (matches(HOLD)(s.artist) || matches(HOLD)(s.title));
  const ok = r.heardShare >= MIN_HEARD;
  console.log(`${Math.round(r.heardShare * 100)}% heard${ok ? "" : " — not used"}${held ? " (held)" : ""}`);
  report.push({ s, ...r, ok, held });
  if (SHOW) lines.forEach(([, , t], k) => console.log(`   ${Math.floor(r.start[k] / 60)}:${(r.start[k] % 60).toFixed(1).padStart(4, "0")}  ${t}`));
  if (UPLOAD && ok && !held) {
    const synced = { v: 1, at: lines.map(([row, part], k) => (part ? [row, r.start[k], part] : [row, r.start[k]])) };
    const { error } = await db.from("song_lyrics")
      .update({ synced, synced_checksum: s.checksum, synced_at: new Date().toISOString() })
      .eq("song_id", s.song_id);
    if (error) throw new Error(`${s.title}: ${error.message}`);
    uploaded++;
  }
}

const md = [
  "# Lyrics check",
  "",
  `Made ${new Date().toISOString().slice(0, 10)} by sync-lyrics.mjs. For each song: how much of the written lyrics the Mac heard in the recording, and the lines it didn't hear at all.`,
  "Lines listed here were most likely changed, cut, or sung from another version. Fix the lyric sheet to match the recording, then say \"sync lyrics\" again.",
  `Songs under ${MIN_HEARD * 100}% heard don't get timed lyrics in the app (they still show plain lyrics).`,
  "",
];
const byArtist = Map.groupBy(report, (x) => x.s.artist);
for (const [artist, list] of byArtist) {
  md.push(`## ${artist}`, "");
  for (const x of list) {
    if (x.error) { md.push(`### ${x.s.title} — ${x.error}`, ""); continue; }
    const flag = !x.ok ? " ⚠ not timed" : x.held ? " · on hold until you confirm" : "";
    md.push(`### ${x.s.title} — ${Math.round(x.heardShare * 100)}% heard${flag}`);
    if (x.missing.length) md.push("", "Not heard:", ...x.missing.map((l) => `- ${l}`));
    md.push("");
  }
}
writeFileSync(REPORT, md.join("\n"));
console.log(`\n${report.length} songs · ${report.filter((x) => x.ok).length} timed well · ${uploaded} uploaded`);
console.log(`Review list: ${REPORT}`);
