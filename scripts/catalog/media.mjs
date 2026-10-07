// Lyrics and videos: reads each artist's DOCUMENTS/ and VIDEOS/ folders in
// IMPRINT/, matches files to that artist's songs, and loads them into
// song_lyrics / song_videos (migration 20261007030000_lyrics_videos.sql).
//
//   node scripts/catalog/media.mjs            report: what matches which song
//   node scripts/catalog/media.mjs --upload   load lyrics, convert + upload videos
//
// Matching, per artist (the folder holding MUSIC/):
//   - A file named after the song: "Deja Vu.rtf", "Deja Vu Lyrics.docx", "Song - Album.rtf",
//     "Deja Vu (Official Video).mp4" — capitals, accents and words like
//     lyrics / video / official / visualizer are ignored.
//   - A lyrics document holding several songs, each under a header like
//     SONG 7: "DÉJÀ VU" (how Robert's lyric sheets are written), is split.
//   - Anything else: list it in media-links.json (path → song title).
// Videos: "lyric" in the name makes a lyric video, "canvas"/"loop" a canvas,
// anything else a music video. Each is converted to 1080p H.264 (phones can't
// all play 4K/HEVC, and it is a third of the size), given a poster frame, and
// stored on the CDN under audio/videos/. Unchanged files are skipped.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_ROOT } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const UPLOAD = process.argv.includes("--upload");
const LINKS = JSON.parse(readFileSync(join(here, "media-links.json"), "utf8"));
const DOCS = new Set([".rtf", ".docx", ".doc", ".txt", ".md"]);
const VIDEOS = new Set([".mp4", ".mov", ".m4v"]);

const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const NOISE = /\b(official|music|lyrics?|video|visuali[sz]er|canvas|loop|final|hd|4k|1080p?)\b|\(.*?\)|\[.*?\]/gi;
const stemKey = (file) => norm(basename(file, extname(file)).replace(NOISE, " "));
const toPosix = (p) => p.split(sep).join("/");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });

// Every song, grouped by artist folder (the part of source_path before /MUSIC/).
const songs = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("songs").select("song_id, title, source_path").order("song_code").range(from, from + 999);
  if (error) throw new Error(error.message);
  songs.push(...data);
  if (data.length < 1000) break;
}
const byArtist = new Map();
for (const s of songs) {
  const i = s.source_path.indexOf("/MUSIC/");
  if (i < 0) continue;
  const owner = s.source_path.slice(0, i);
  if (!byArtist.has(owner)) byArtist.set(owner, new Map());
  byArtist.get(owner).set(norm(s.title), s);
}

/** Plain text of a lyrics document. */
function readDoc(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".txt" || ext === ".md") return readFileSync(path, "utf8");
  return execFileSync("textutil", ["-convert", "txt", "-stdout", path], { encoding: "utf8", maxBuffer: 20e6 });
}

/** Split a document into { title, text } songs (one, unless it has SONG n: headers). */
function songsInDoc(path) {
  const text = readDoc(path).replace(/\r/g, "");
  // Song headers seen in Robert's sheets: SONG 7: "DÉJÀ VU" · 1. The Undisputed
  // Algorithm · Title 1: Snow Day Signal. A sheet needs at least two to be split.
  const header = /^\s*(?:SONG|TITLE|TRACK)?\s*\d{1,3}\s*[:.)\-–]\s*["“”']?([^\n]{2,80}?)["“”']?\s*$/gim;
  let marks = [...text.matchAll(header)];
  if (marks.length < 2) marks = [];
  // Drop separator rules and table/genre scaffolding ("Section", "Lyrical Content", "(Genre: …)").
  const clean = (t) =>
    t
      .replace(/^\s*[=\-_]{3,}\s*$/gm, "")
      .replace(/^\s*(section|lyrical content)\s*$/gim, "")
      .replace(/^\s*\(genre:[^)]*\)\s*$/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+|\s+$/g, "");
  if (!marks.length) return [{ title: null, text: clean(text) }];
  return marks.map((m, i) => ({
    title: m[1],
    text: clean(text.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined)),
  }));
}

const sha = (path) =>
  new Promise((resolve, reject) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });

// Gather what's in the folders.
const lyrics = []; // { song, text, source }
const videos = []; // { song, kind, path, source }
const unmatched = [];
for (const owner of byArtist.keys()) {
  const titles = byArtist.get(owner);
  const find = (rel, key) => {
    const linked = LINKS[rel];
    if (linked) return titles.get(norm(linked));
    // "Silence On Speakerphone- SOS.rtf": also try the part before a dash.
    const before = basename(rel, extname(rel)).split(/\s*[-–]\s+|\s+[-–]\s*/)[0];
    return titles.get(key) ?? titles.get(stemKey(before + ".x"));
  };
  const docsDir = join(DEFAULT_ROOT, owner, "DOCUMENTS");
  if (existsSync(docsDir)) {
    for (const f of readdirSync(docsDir).filter((f) => DOCS.has(extname(f).toLowerCase()) && !f.startsWith("."))) {
      const rel = toPosix(join(owner, "DOCUMENTS", f));
      let parts;
      try {
        parts = songsInDoc(join(docsDir, f));
      } catch (e) {
        unmatched.push(`${rel} (unreadable: ${e.message.split("\n")[0]})`);
        continue;
      }
      for (const p of parts) {
        const song = p.title ? titles.get(norm(p.title)) : find(rel, stemKey(f));
        if (song && p.text) lyrics.push({ song, text: p.text, source: rel });
        else unmatched.push(p.title ? `${rel} → "${p.title}"` : rel);
      }
    }
  }
  const vidDir = join(DEFAULT_ROOT, owner, "VIDEOS");
  if (existsSync(vidDir)) {
    for (const f of readdirSync(vidDir).filter((f) => VIDEOS.has(extname(f).toLowerCase()) && !f.startsWith("."))) {
      const rel = toPosix(join(owner, "VIDEOS", f));
      const song = find(rel, stemKey(f));
      const kind = /lyric/i.test(f) ? "lyric_video" : /canvas|loop/i.test(f) ? "canvas" : "music_video";
      if (song) videos.push({ song, kind, path: join(vidDir, f), source: rel });
      else unmatched.push(rel);
    }
  }
}

console.log(`Lyrics for ${lyrics.length} songs · ${videos.length} videos · ${unmatched.length} files not matched to a song`);
for (const l of lyrics) console.log(`  lyrics  ${l.song.title}  ←  ${l.source.split("/").slice(-1)[0]}`);
for (const v of videos) console.log(`  ${v.kind.padEnd(11)} ${v.song.title}  ←  ${v.source.split("/").slice(-1)[0]}`);
if (unmatched.length) {
  console.log("\nNot matched (name the file after the song, or add it to media-links.json):");
  for (const u of unmatched) console.log(`  ${u}`);
}
if (!UPLOAD) {
  console.log("\nReport only. Run with --upload to load them.");
  process.exit(0);
}

// --- lyrics --------------------------------------------------------------------
const { data: priorL, error: le } = await db.from("song_lyrics").select("song_id, checksum");
if (le) throw new Error(`song_lyrics: ${le.message} (has the migration been run?)`);
const lyricSums = new Map(priorL.map((r) => [r.song_id, r.checksum]));
let lyricsLoaded = 0;
for (const l of lyrics) {
  const checksum = createHash("sha256").update(l.text).digest("hex");
  if (lyricSums.get(l.song.song_id) === checksum) continue;
  const { error } = await db.from("song_lyrics").upsert({
    song_id: l.song.song_id, lyrics: l.text, source_file: l.source, checksum, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  lyricsLoaded++;
}
console.log(`\n${lyricsLoaded} lyrics loaded`);

// --- videos --------------------------------------------------------------------
const { data: priorV, error: ve } = await db.from("song_videos").select("song_id, kind, checksum");
if (ve) throw new Error(`song_videos: ${ve.message} (has the migration been run?)`);
const videoSums = new Map(priorV.map((r) => [`${r.song_id}:${r.kind}`, r.checksum]));
const work = join(tmpdir(), "gosquare-video");
mkdirSync(work, { recursive: true });
let videosLoaded = 0;
for (const v of videos) {
  const checksum = await sha(v.path);
  if (videoSums.get(`${v.song.song_id}:${v.kind}`) === checksum) continue;
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", v.path], { encoding: "utf8" }));
  const stream = probe.streams.find((s) => s.codec_type === "video");
  const durationMs = Math.round(Number(probe.format.duration) * 1000);
  const out = join(work, `${checksum.slice(0, 20)}.mp4`);
  const poster = join(work, `${checksum.slice(0, 20)}.jpg`);
  console.log(`  converting ${basename(v.path)} (${stream.width}×${stream.height} ${stream.codec_name}) …`);
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-i", v.path,
    "-vf", "scale=-2:'min(1080,ih)'", "-c:v", "libx264", "-preset", "slow", "-crf", "22",
    "-profile:v", "high", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
  ]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(5, durationMs / 2000)), "-i", v.path, "-frames:v", "1", "-vf", "scale=-2:720", poster]);
  const outProbe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", out], { encoding: "utf8" }));
  const outStream = outProbe.streams.find((s) => s.codec_type === "video");
  const key = `audio/videos/${checksum.slice(0, 20)}.mp4`;
  const posterKey = `audio/videos/${checksum.slice(0, 20)}.jpg`;
  const send = (Key, Body, ContentType) =>
    s3.send(new PutObjectCommand({ Bucket: process.env.AUDIO_BUCKET, Key, Body, ContentType, CacheControl: "public, max-age=31536000, immutable" }));
  await send(key, readFileSync(out), "video/mp4");
  await send(posterKey, readFileSync(poster), "image/jpeg");
  const { error } = await db.from("song_videos").upsert({
    song_id: v.song.song_id, kind: v.kind, storage_key: key, poster_key: posterKey, duration_ms: durationMs,
    width: outStream.width, height: outStream.height, source_file: v.source, checksum, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  videosLoaded++;
  console.log(`  ✓ ${v.kind} for ${v.song.title}: ${Math.round(statSync(v.path).size / 1e6)} MB → ${Math.round(statSync(out).size / 1e6)} MB`);
}
console.log(`${videosLoaded} videos uploaded`);
