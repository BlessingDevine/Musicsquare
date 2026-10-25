// Levels every song's streaming MP3 to TARGET_LUFS (see loudness.mjs), once.
// New songs are levelled on import (ingest.mjs) and on replace (replace.mjs).
//
//   node scripts/catalog/level.mjs                 all songs not levelled yet
//   node scripts/catalog/level.mjs --limit 10      a test batch
//   node scripts/catalog/level.mjs --only SONG-000477
//
// Each levelled file is uploaded under a new key (audio/SONG-000477-L<hash>.mp3):
// the old key is cached as immutable by CloudFront and phones. song_files then
// points at it. The row's checksum is left alone: it identifies the source file
// in LABELS, which is how the importer recognises a song that was moved.
// Old files stay in the bucket, so an app holding an old catalogue still plays.
//
// Resumable: loudness.json records each song's measurement and levelled key;
// a song whose current file is the recorded one is skipped.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { levelMp3, TARGET_LUFS } from "./loudness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const WORKERS = 6;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });
const AUDIO = process.env.NEXT_PUBLIC_AUDIO_BASE_URL.replace(/\/$/, "");
const STATE = join(here, "loudness.json");
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(Object.fromEntries(Object.entries(state).sort()), null, 2) + "\n");

const files = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("song_files")
    .select("song_file_id, storage_key, songs!inner(song_code, title)")
    .eq("file_type", "mp3").order("song_file_id").range(from, from + 999);
  if (error) throw new Error(error.message);
  files.push(...data);
  if (data.length < 1000) break;
}
const todo = files
  .filter((f) => !ONLY || f.songs.song_code === ONLY)
  .filter((f) => state[f.songs.song_code]?.key !== f.storage_key)
  .slice(0, LIMIT);
console.log(`${files.length} streaming files, ${todo.length} to level to ${TARGET_LUFS} LUFS`);

const tally = { levelled: 0, unchanged: 0, failed: 0 };
let next = 0, sinceSave = 0;
const started = Date.now();
async function worker() {
  while (next < todo.length) {
    const f = todo[next++];
    const code = f.songs.song_code;
    try {
      const res = await fetch(`${AUDIO}/${f.storage_key}`);
      if (!res.ok) throw new Error(`download ${res.status}`);
      const r = await levelMp3(Buffer.from(await res.arrayBuffer()));
      let key = f.storage_key;
      if (r.steps !== 0) {
        key = `audio/${code}-L${createHash("sha256").update(r.bytes).digest("hex").slice(0, 8)}.mp3`;
        await s3.send(new PutObjectCommand({
          Bucket: process.env.AUDIO_BUCKET, Key: key, Body: r.bytes, ContentType: "audio/mpeg",
          CacheControl: "public, max-age=31536000, immutable",
        }));
        const { error } = await db.from("song_files").update({ storage_key: key, byte_size: r.bytes.length }).eq("song_file_id", f.song_file_id);
        if (error) throw new Error(error.message);
        tally.levelled++;
      } else tally.unchanged++;
      state[code] = { lufs: r.lufs, peak: r.peak, steps: r.steps, gainDb: r.gainDb, key, from: f.storage_key, at: new Date().toISOString().slice(0, 10) };
      if (++sinceSave >= 25) { save(); sinceSave = 0; }
    } catch (err) {
      tally.failed++;
      console.log(`  ✗ ${code} ${f.songs.title}: ${err.message}`);
    }
    const done = tally.levelled + tally.unchanged + tally.failed;
    if (done % 50 === 0 || done === todo.length) {
      console.log(`${done}/${todo.length}  ${JSON.stringify(tally)}  ${((Date.now() - started) / 60000).toFixed(1)} min`);
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
save();
console.log(`Done: ${JSON.stringify(tally)}. Channels pick the new files up on their next reload.`);
