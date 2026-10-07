// Replace a song's audio after Robert swaps the file under the same name (the
// importer recognises files by path, so it skips a replaced file).
//
//   node scripts/catalog/replace.mjs "<path under IMPRINT/>"   e.g.
//   node scripts/catalog/replace.mjs "VELVET NOIR RECORDS - R&B:SOUL/ARISTS/LEA BABI/MUSIC/ALBUM 2/Silence On Speakerphone.mp3"
//
// Uploads the new MP3 under a new key (audio/SONG-001251-<hash>.mp3): the old
// key is cached as immutable by CloudFront and phones, so reusing it would keep
// serving the old version. Then re-points song_files, and re-measures length
// and crossfade cues. The song keeps its id, likes, playlists and lyrics.
// Its channel's clock shifts by the length difference from the next reload.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { parseBuffer } from "music-metadata";
import { analyse } from "./cues.mjs";
import { DEFAULT_ROOT } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const arg = process.argv[2];
if (!arg) throw new Error('usage: node scripts/catalog/replace.mjs "<path under IMPRINT/>"');
const file = isAbsolute(arg) ? arg : join(DEFAULT_ROOT, arg);
const sourcePath = relative(DEFAULT_ROOT, file).split("\\").join("/");
if (!file.toLowerCase().endsWith(".mp3")) throw new Error("only MP3s are streamed; export an MP3 first");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });

const { data: song, error } = await db
  .from("songs")
  .select("song_id, song_code, title, duration_ms, song_files(song_file_id, file_type, storage_key, checksum)")
  .eq("source_path", sourcePath)
  .single();
if (error) throw new Error(`no song at ${sourcePath} (${error.message})`);
const current = song.song_files.find((f) => f.file_type === "mp3");

const bytes = await readFile(file);
const checksum = createHash("sha256").update(bytes).digest("hex");
if (current?.checksum === checksum) {
  console.log(`${song.title}: the catalogue already has this exact file — nothing to do.`);
  process.exit(0);
}
const meta = (await parseBuffer(bytes, { mimeType: "audio/mpeg" }, { duration: true })).format;
const durationMs = Math.round(meta.duration * 1000);
const cues = await analyse(file).catch(() => null);

const key = `audio/${song.song_code}-${checksum.slice(0, 8)}.mp3`;
await s3.send(new PutObjectCommand({
  Bucket: process.env.AUDIO_BUCKET, Key: key, Body: bytes, ContentType: "audio/mpeg",
  CacheControl: "public, max-age=31536000, immutable",
}));
const fileRow = {
  storage_key: key, checksum, byte_size: bytes.length,
  bitrate: meta.bitrate ? Math.round(meta.bitrate / 1000) : null,
};
const { error: fe } = current
  ? await db.from("song_files").update(fileRow).eq("song_file_id", current.song_file_id)
  : await db.from("song_files").insert({ ...fileRow, song_id: song.song_id, file_type: "mp3", is_public: true });
if (fe) throw new Error(fe.message);
const { error: se } = await db.from("songs").update({
  duration_ms: durationMs,
  cue_in_ms: cues?.cueInMs ?? null,
  cue_out_ms: cues ? Math.min(cues.cueOutMs, durationMs) : null,
}).eq("song_id", song.song_id);
if (se) throw new Error(se.message);

const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`;
console.log(`✓ ${song.title} (${song.song_code}) replaced: ${fmt(song.duration_ms)} → ${fmt(durationMs)}, now ${key}`);
