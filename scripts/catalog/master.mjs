// The master chain (Robert's The Smoother settings → −14 LUFS → −1 dB ceiling,
// run by ~/Sites/master-eq, Oct 2026) applied to the streaming files.
//
//   node scripts/catalog/master.mjs --list     write ~/Sites/master-eq/todo.json: songs not mastered yet
//   (then: cd ~/Sites/master-eq && .venv/bin/python process.py --batch todo.json out --workers 6)
//   node scripts/catalog/master.mjs --upload   upload ~/Sites/master-eq/out/*.mp3 and switch the songs to them
//   node scripts/catalog/master.mjs --undo     switch every song back to its original file
//
// Each song's streaming row (song_files, file_type mp3) is pointed at
// audio/mastered/<SONG-CODE>.<hash>.mp3. Its checksum is left as the ORIGINAL
// file's: the importer recognises songs (and moved files) by that checksum, so
// it must keep matching what is in the folders. The original stays on the CDN
// at its old key, and master-log.tsv records old → new for --undo.
// Sources: a WAV beside the MP3 (same name) when there is one, else the MP3.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { abs } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const WORK = join(homedir(), "Sites/master-eq");
const LOG = join(WORK, "master-log.tsv");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });
const args = process.argv.slice(2);
const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

async function streamRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const data = must(await db.from("song_files")
      .select("song_file_id, song_id, storage_key, songs(song_code, source_path, release_status)")
      .eq("file_type", "mp3").order("song_file_id").range(from, from + 999));
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

if (args.includes("--list")) {
  const rows = await streamRows();
  const todo = [];
  let missing = 0;
  for (const r of rows) {
    if (r.storage_key.startsWith("audio/mastered/")) continue;
    const mp3 = abs(r.songs.source_path);
    const wav = mp3.replace(/\.mp3$/i, ".wav");
    const src = existsSync(wav) ? wav : existsSync(mp3) ? mp3 : null;
    if (!src) {
      missing++;
      continue;
    }
    // Live songs first, held drafts last.
    todo.push({ code: r.songs.song_code, src, live: r.songs.release_status !== "draft" });
  }
  todo.sort((a, b) => Number(b.live) - Number(a.live) || a.code.localeCompare(b.code));
  writeFileSync(join(WORK, "todo.json"), JSON.stringify(todo, null, 1));
  console.log(`${todo.length} songs to master (${todo.filter((t) => t.live).length} live first), ${missing} without a local file, ${rows.length - todo.length - missing} already mastered`);
  console.log(`From WAV: ${todo.filter((t) => t.src.endsWith(".wav")).length}`);
} else if (args.includes("--upload")) {
  const rows = await streamRows();
  const byCode = new Map(rows.map((r) => [r.songs.song_code, r]));
  const outDir = join(WORK, "out");
  const files = existsSync(outDir) ? readdirSync(outDir).filter((f) => /^SONG-\d+\.mp3$/.test(f)) : [];
  let done = 0;
  for (const f of files) {
    const code = f.replace(/\.mp3$/, "");
    const row = byCode.get(code);
    if (!row || row.storage_key.startsWith("audio/mastered/")) continue;
    const bytes = readFileSync(join(outDir, f));
    const key = `audio/mastered/${code}.${createHash("sha256").update(bytes).digest("hex").slice(0, 10)}.mp3`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AUDIO_BUCKET, Key: key, Body: bytes, ContentType: "audio/mpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }));
    must(await db.from("song_files").update({ storage_key: key, byte_size: bytes.length, bitrate: 320 }).eq("song_file_id", row.song_file_id));
    appendFileSync(LOG, `${code}\t${row.storage_key}\t${key}\n`);
    if (++done % 50 === 0) console.log(`  ${done} switched`);
  }
  console.log(`${done} songs now play their mastered file. Undo log: ${LOG}`);
} else if (args.includes("--undo")) {
  const lines = existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n") : [];
  const latest = new Map(lines.map((l) => l.split("\t")).map(([code, from, to]) => [code, { from, to }]));
  let n = 0;
  for (const { from, to } of latest.values()) {
    const { data } = await db.from("song_files").update({ storage_key: from }).eq("storage_key", to).select("song_file_id");
    n += data?.length ?? 0;
  }
  console.log(`${n} songs switched back to their original files.`);
} else {
  console.log("Use --list, --upload or --undo (see the top of this file).");
}
