// Canvas: the short silent loop GoSquare plays behind the Now Playing screen.
// One per cover (album cover or a single's own cover), made with AI video
// (Higgsfield · Kling, image-to-video from the cover, 5s, no sound).
//
//   node scripts/catalog/canvas.mjs            report: which covers have a Canvas
//   node scripts/catalog/canvas.mjs --todo     JSON list of covers still without one (with CDN cover URL)
//   node scripts/catalog/canvas.mjs --upload   finish and upload the clips in ~/Sites/canvas/raw/
//   node scripts/catalog/canvas.mjs --upload --redo <checksum20>   replace a cover's Canvas with a new raw clip
//   node scripts/catalog/canvas.mjs --sources  Robert's Canvas images/footage and what each one is for
//
// Two kinds of Canvas:
//   album  — on the cover, so every song showing that cover gets it. Source: a
//            vertical image named "<Album> vertical.jpg|png" (album folder or
//            the artist's IMAGES/). Raw clip: <cover checksum20>.mp4.
//   song   — one song only (picked or promoted songs); beats the album's. Source:
//            "<Song> canvas.jpg|png" in IMAGES/, or footage "<Song> Vertical.mp4"
//            in VIDEOS/. Raw clip: song-<SONG-CODE>.mp4 → song_videos kind 'canvas'.
//
// Clips are named after the cover's checksum (first 20 characters, the same
// as its key under audio/covers/): ~/Sites/canvas/raw/<checksum20>.mp4. A
// replaced cover has a new checksum, so its old Canvas simply stops matching.
// A clip that already loops seamlessly (cut from Robert's own vertical video)
// is named <checksum20>.loop.mp4 and is used as is, not played back and forth.
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
const songs = await all("songs", "song_id, song_code, title, album_title, source_path");
const songByCode = new Map(songs.map((x) => [x.song_code, x]));
const songCanvas = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("song_videos").select("song_id, storage_key").eq("kind", "canvas").range(from, from + 999);
  if (error) throw new Error(error.message);
  for (const v of data) songCanvas.set(v.song_id, v.storage_key);
  if (data.length < 1000) break;
}

if (process.argv.includes("--sources")) {
  const { ownerOf } = await import("./scan.mjs");
  const { abs, assetDir, relOf } = await import("./scan.mjs");
  const norm = (x) => x.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\bft\.?(?=\s)/g, "feat").replace(/[^a-z0-9]/g, "");
  const byOwner = new Map();
  for (const x of songs) {
    const owner = x.source_path && ownerOf(x.source_path);
    if (!owner) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(x);
  }
  const coverByFolder = new Map(albums.map((c) => [c.folder_path, c]));
  const lines = [];
  for (const [owner, list] of byOwner) {
    const artist = owner.split("/").at(-1);
    const files = [];
    const imagesSub = basename(assetDir(owner, "images"));
    const videosSub = basename(assetDir(owner, "videos"));
    for (const sub of [imagesSub, videosSub, ...new Set(list.map((x) => dirname(x.source_path).slice(owner.length + 1)))]) {
      const dir = join(abs(owner), sub);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (/^\./.test(f)) continue;
        const image = /\.(jpe?g|png|webp)$/i.test(f) && /\b(vertical|canvas)\b/i.test(f);
        const footage = /\.(mp4|mov|m4v)$/i.test(f) && /\bvertical\b/i.test(f) && !/\bclip\b/i.test(f);
        if (image || footage) files.push({ f, path: join(dir, f), footage, albumFolder: sub === imagesSub || sub === videosSub ? null : `${owner}/${sub}` });
      }
    }
    // A song's Canvas may also sit on its own cover (song_art), like Pressure's.
    const songArt = new Map(singles.filter((c) => c.canvas_key).map((c) => [c.song_id, c.canvas_key]));
    const hasSong = (x) => songCanvas.has(x.song_id) || songArt.has(x.song_id);
    for (const { f, path, footage, albumFolder } of files) {
      const words = basename(f).replace(/\.[^.]+$/, "").replace(/\b(vertical|canvas|cover|art)\b/gi, " ");
      const key = norm(words.replace(new RegExp(`^\\s*${artist.replace(/[^A-Za-z0-9 ]/g, ".")}\\s*[-–]\\s*`, "i"), ""));
      const asSong = /\bcanvas\b/i.test(f) || footage;
      // Exact title, or a unique title it starts ("Pressure" → "Pressure Feat. Lea Babi").
      const starts = list.filter((x) => key.length >= 4 && norm(x.title).startsWith(key));
      const song = list.find((x) => norm(x.title) === key) ?? (new Set(starts.map((x) => norm(x.title))).size === 1 ? starts[0] : undefined);
      const album = list.find((x) => x.album_title && norm(x.album_title) === key);
      let target;
      // A vertical image inside an album folder is that album's.
      const folderCover = albumFolder && !asSong ? coverByFolder.get(albumFolder) : null;
      if (folderCover) {
        const t = list.find((x) => dirname(x.source_path) === albumFolder)?.album_title ?? albumFolder.split("/").at(-1);
        target = `album "${t}" → raw clip ${folderCover.checksum.slice(0, 20)}.mp4${folderCover.canvas_key && folderCover.canvas_checksum === folderCover.checksum ? " (has a Canvas)" : ""}`;
      } else if (asSong && song) target = `song "${song.title}" → raw clip song-${song.song_code}.mp4${hasSong(song) ? " (has a Canvas)" : ""}`;
      else if (album) {
        const cover = coverByFolder.get(dirname(album.source_path));
        target = cover
          ? `album "${album.album_title}" → raw clip ${cover.checksum.slice(0, 20)}.mp4${cover.canvas_key && cover.canvas_checksum === cover.checksum ? " (has a Canvas)" : ""}`
          : `album "${album.album_title}" has no cover yet`;
      } else if (song) target = `song "${song.title}" → raw clip song-${song.song_code}.mp4${hasSong(song) ? " (has a Canvas)" : ""}`;
      else if (new Set(starts.map((x) => x.title)).size > 1)
        target = `✗ could be several songs: ${[...new Set(starts.map((x) => x.title))].join(", ")} — use the full song title`;
      else target = "✗ matches no album or song of this artist";
      lines.push(`${relOf(path)}\n    ${target}`);
    }
  }
  console.log(lines.join("\n") || "No Canvas images or footage found.");
  process.exit(0);
}
const id = (c) => c.checksum.slice(0, 20);
const has = (c) => c.canvas_key && c.canvas_checksum === c.checksum && id(c) !== REDO;

if (TODO) {
  console.log(JSON.stringify(covers.filter((c) => !has(c)).map((c) => ({ id: id(c), name: c.name, cover: `${CDN}/${c.storage_key}` })), null, 1));
  process.exit(0);
}

const raws = existsSync(RAW) ? new Set(readdirSync(RAW).filter((f) => f.endsWith(".mp4")).map((f) => basename(f, ".mp4").replace(/\.loop$/, ""))) : new Set();
const done = covers.filter(has);
// Song Canvases: raw clips named song-<SONG-CODE>.mp4, saved to song_videos (kind 'canvas').
const songTargets = [...raws].filter((r) => r.startsWith("song-")).map((r) => {
  const x = songByCode.get(r.slice(5));
  return x && { raw: r, name: `song Canvas: ${x.title}`, song_id: x.song_id, done: songCanvas.has(x.song_id) && r !== REDO };
});
const ready = [
  ...covers.filter((c) => !has(c) && raws.has(id(c))).map((c) => ({ raw: id(c), name: c.name, cover: c })),
  ...songTargets.filter((t) => t && !t.done),
];
console.log(`${covers.length} covers · ${done.length} with a Canvas · ${songCanvas.size} songs with their own · ${ready.length} clips ready to upload`);
for (const c of ready) console.log(`  ready  ${c.name}`);
const orphans = [...raws].filter((r) => (r.startsWith("song-") ? !songByCode.has(r.slice(5)) : !covers.some((c) => id(c) === r)));
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
  const looped = existsSync(join(RAW, `${c.raw}.loop.mp4`));
  const src = join(RAW, looped ? `${c.raw}.loop.mp4` : `${c.raw}.mp4`);
  const out = join(work, `${c.raw}.mp4`);
  const poster = join(work, `${c.raw}.jpg`);
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", src], { encoding: "utf8" })
    .trim().split(",").map(Number);
  const loop = looped ? "[0:v]null" : "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1";
  const frame = h / w > 1.5
    ? `${loop},scale=720:1280:force_original_aspect_ratio=increase:flags=lanczos,crop=720:1280,format=yuv420p`
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
  const { error } = c.cover
    ? await db.from(c.cover.table).update({ canvas_key: key, canvas_checksum: c.cover.checksum }).match(c.cover.match)
    : await db.from("song_videos").upsert({
        song_id: c.song_id, kind: "canvas", storage_key: key, poster_key: key.replace(/\.mp4$/, ".jpg"),
        width: 720, height: 1280, source_file: `${c.raw}.mp4`, checksum: key, updated_at: new Date().toISOString(),
      });
  if (error) throw new Error(`${c.name}: ${error.message}`);
  console.log(`  ✓ ${c.name} → ${key}`);
}
