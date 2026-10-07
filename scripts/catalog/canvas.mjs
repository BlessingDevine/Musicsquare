// Canvas: the short silent loop GoSquare plays behind the Now Playing screen.
// One per cover (album cover or a single's own cover), made with AI video
// (Higgsfield · Kling, image-to-video from the cover, 5s, no sound).
//
//   node scripts/catalog/canvas.mjs            report: which covers have a Canvas
//   node scripts/catalog/canvas.mjs --todo     JSON list of covers still without one (with CDN cover URL)
//   node scripts/catalog/canvas.mjs --upload   finish and upload the clips in ~/Sites/canvas/raw/
//   node scripts/catalog/canvas.mjs --upload --redo <checksum20>   replace a cover's Canvas with a new raw clip
//
// Clips are named after the cover's checksum (first 20 characters, the same
// as its key under audio/covers/): ~/Sites/canvas/raw/<checksum20>.mp4. A
// replaced cover has a new checksum, so its old Canvas simply stops matching.
//
// Each raw clip is played forward then backward (a seamless loop) and encoded
// as H.264 720×1280 for phones. A tall clip (made from a vertical version of
// the cover) fills the screen; a square one is set on the 9:16 frame over a
// blurred copy of itself so the title on the cover stays whole. Uploaded to
// audio/canvas/<sha>.mp4 with a poster image. Nothing in Robert's folders changes.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const UPLOAD = process.argv.includes("--upload");
const TODO = process.argv.includes("--todo");
const REDO = process.argv.includes("--redo") ? process.argv[process.argv.indexOf("--redo") + 1] : null;
const RAW = process.env.CANVAS_DIR ?? join(homedir(), "Sites/canvas/raw");
const CDN = process.env.NEXT_PUBLIC_AUDIO_BASE_URL;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

async function all(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message} (has migration 20261009000000 been run?)`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// Every cover that can carry a Canvas: album covers by folder, song covers by song.
const albums = (await all("album_covers", "folder_path, storage_key, checksum, canvas_key, canvas_checksum"))
  .map((r) => ({ table: "album_covers", match: { folder_path: r.folder_path }, name: r.folder_path, ...r }));
const singles = (await all("song_art", "song_id, storage_key, checksum, canvas_key, canvas_checksum, songs(title)"))
  .map((r) => ({ table: "song_art", match: { song_id: r.song_id }, name: `song: ${r.songs?.title ?? r.song_id}`, ...r }));
const covers = [...albums, ...singles];
const id = (c) => c.checksum.slice(0, 20);
const has = (c) => c.canvas_key && c.canvas_checksum === c.checksum && id(c) !== REDO;

if (TODO) {
  console.log(JSON.stringify(covers.filter((c) => !has(c)).map((c) => ({ id: id(c), name: c.name, cover: `${CDN}/${c.storage_key}` })), null, 1));
  process.exit(0);
}

const raws = existsSync(RAW) ? new Set(readdirSync(RAW).filter((f) => f.endsWith(".mp4")).map((f) => basename(f, ".mp4"))) : new Set();
const done = covers.filter(has);
const ready = covers.filter((c) => !has(c) && raws.has(id(c)));
console.log(`${covers.length} covers · ${done.length} with a Canvas · ${ready.length} clips ready to upload · ${covers.length - done.length - ready.length} still to make`);
for (const c of ready) console.log(`  ready  ${c.name}`);
const orphans = [...raws].filter((r) => !covers.some((c) => id(c) === r));
for (const o of orphans) console.log(`  ✗ ${o}.mp4 matches no current cover (was the cover replaced?)`);
if (!UPLOAD) {
  if (ready.length) console.log("\nRun with --upload to finish and upload them.");
  process.exit(0);
}

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });
const put = (Key, Body, ContentType) =>
  s3.send(new PutObjectCommand({ Bucket: process.env.AUDIO_BUCKET, Key, Body, ContentType, CacheControl: "public, max-age=31536000, immutable" }));
const work = join(tmpdir(), "gosquare-canvas");
mkdirSync(work, { recursive: true });

for (const c of ready) {
  const src = join(RAW, `${id(c)}.mp4`);
  const out = join(work, `${id(c)}.mp4`);
  const poster = join(work, `${id(c)}.jpg`);
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src], { encoding: "utf8" })
    .trim().split(",").map(Number);
  const loop = "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1";
  const frame = h / w > 1.5
    ? `${loop},scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p`
    : `${loop},split[x][y];` +
      "[x]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=30:2,eq=brightness=-0.2[bg];" +
      "[y]scale=720:-2[fg];[bg][fg]overlay=0:(H-h)/2-80,fps=30,format=yuv420p";
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-filter_complex", frame,
    "-c:v", "libx264", "-profile:v", "main", "-crf", "24", "-preset", "slow", "-movflags", "+faststart", "-an", out]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", out, "-frames:v", "1", "-q:v", "4", poster]);
  const video = readFileSync(out);
  const key = `audio/canvas/${createHash("sha256").update(video).digest("hex").slice(0, 20)}.mp4`;
  await put(key, video, "video/mp4");
  await put(key.replace(/\.mp4$/, ".jpg"), readFileSync(poster), "image/jpeg");
  const { error } = await db.from(c.table).update({ canvas_key: key, canvas_checksum: c.checksum }).match(c.match);
  if (error) throw new Error(`${c.name}: ${error.message}`);
  console.log(`  ✓ ${c.name} → ${key}`);
}
