// Album covers: finds one cover per album folder in IMPRINT/, uploads it to
// S3 (served by CloudFront) and records it in album_covers, which GoSquare and
// the website read through the song_covers view.
//
//   node scripts/catalog/covers.mjs            report only: which albums have a cover
//   node scripts/catalog/covers.mjs --upload   upload new or changed covers
//
// Which image is the cover, in order:
//   1. Robert's rule: a file named "cover" (cover.jpg / .png / .webp), or one
//      named exactly like its album folder (TRAPSOUL III/Trapsoul III.jpg),
//      ignoring capitals, spaces and accents. Always wins.
//   2. Otherwise a best guess from the folder's other images: never a YouTube
//      image (" YT" in the name — those are wide thumbnails), only square
//      images, preferring "cover" in the name, then .jpg over .png, then the
//      plain version over a variant ("Cover 2" before "Cover 2b"). Guesses are
//      listed in the report; naming a file "cover" overrides one.
//   3. Otherwise the artist's (or collection's) IMAGES folder — where Robert
//      often keeps covers. These folders are full of numbered artist photos,
//      so only cover-like names count, and the image must be square and not
//      YouTube art: the album's own name (IMAGES/Dry River.png → Dry River);
//      "Cover" + number (Cover 2 → VOL 2 / ALBUM 2 / ASH 2); or the artist or
//      collection name + number (Apex II → VOL 2, Lumi III → LUMI ASTRA III,
//      Kizomba → KIZOMBA I). No number means 1. Bare numbers (01.jpg) never
//      count. Matches are listed in the report as "from IMAGES".
// Loose songs in an artist's MUSIC folder share a cover placed there.
//
// Each cover is cropped to a square, resized to 1000×1000 and saved as JPEG
// under audio/covers/ (the only prefix CloudFront serves and the uploader may
// write). Keys are content-addressed, so a replaced cover gets a new URL and
// no cache ever shows the old one. Unchanged covers are skipped, so this can
// be run as often as you like. Nothing in the folders is changed.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { DEFAULT_ROOT } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));

const UPLOAD = process.argv.includes("--upload");
const AUDIO = new Set([".mp3", ".wav", ".m4a"]);
const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const SIZE = 1000;
const READ_TIMEOUT_MS = 2 * 60_000; // cloud-only Drive files download on read

const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const toPosix = (p) => p.split(sep).join("/");

const isYouTube = (f) => /(^|[^a-z])yt([^a-z]|$)/i.test(f.slice(0, -extname(f).length));

/** Best guess when no file follows the naming rule (see the top of the file). */
async function guess(dir, images) {
  const square = [];
  for (const f of images.filter((f) => !isYouTube(f))) {
    try {
      const { width, height } = await withTimeout(sharp(join(dir, f)).metadata(), READ_TIMEOUT_MS, f);
      if (width && width === height) square.push(f);
    } catch {
      // unreadable image: not a candidate
    }
  }
  const rank = (f) => [
    /cover/i.test(f) ? 0 : 1,
    /\.jpe?g$/i.test(f) ? 0 : 1,
    f.slice(0, -extname(f).length).length, // "Cover 2" before "Cover 2b"
    f.toLowerCase(),
  ];
  square.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  });
  return square[0] ?? null;
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

/** "Apex II" → { base: "apex", n: 2 }; "Dance Square Vol 1" → { base: "dancesquare", n: 1 }. */
function splitNumber(name) {
  const words = name.trim().split(/[\s_-]+/);
  let n = null;
  const last = words.at(-1)?.toLowerCase() ?? "";
  if (/^\d+$/.test(last)) n = Number(last);
  else if (ROMAN[last]) n = ROMAN[last];
  if (n !== null) {
    words.pop();
    if (/^vol\.?$/i.test(words.at(-1) ?? "")) words.pop();
  }
  return { base: norm(words.join(" ")), n };
}

/** The IMAGES folder that belongs with an album, and the artist/collection name. */
function imagesFor(dir) {
  const parts = dir.split(sep);
  const m = parts.lastIndexOf("MUSIC");
  if (m < 0) return null;
  const owner = join(...parts.slice(0, m));
  // MUSIC/<collection>/<album>: the collection names the covers (Kizomba II).
  const collection = parts.length - m >= 3 ? parts[m + 1] : parts[m - 1];
  return { imagesDir: join(sep, owner, "IMAGES"), collection };
}

/** Rule 3: a cover-like image for this album in the IMAGES folder, if any. */
async function fromImages(dir) {
  const where = imagesFor(dir);
  if (!where) return null;
  let files;
  try {
    files = (await readdir(where.imagesDir)).filter((f) => IMAGE.has(extname(f).toLowerCase()) && !f.startsWith("._") && !isYouTube(f));
  } catch {
    return null; // no IMAGES folder
  }
  const folder = basename(dir);
  const album = folder === "MUSIC" ? { base: "", n: 1 } : splitNumber(folder);
  const names = [album.base, norm(where.collection)].filter((c) => c.length >= 3 && !["vol", "album", "music"].includes(c));
  const matches = [];
  for (const f of files) {
    const stem = f.slice(0, -extname(f).length);
    let ok = norm(stem) === norm(folder);
    if (!ok && album.n !== null) {
      const img = splitNumber(stem);
      const sameNumber = (img.n ?? 1) === album.n;
      const coverWord = ["cover", "maincover", "albumcover"].includes(img.base);
      const namesIt = img.base.length >= 4 && names.some((c) => c.startsWith(img.base) || img.base.startsWith(c));
      ok = sameNumber && (coverWord || namesIt);
    }
    if (!ok) continue;
    try {
      const { width, height } = await withTimeout(sharp(join(where.imagesDir, f)).metadata(), READ_TIMEOUT_MS, f);
      if (width && width === height) matches.push(f);
    } catch {
      // unreadable: not a candidate
    }
  }
  matches.sort((a, b) => Number(!/\.jpe?g$/i.test(a)) - Number(!/\.jpe?g$/i.test(b)) || a.length - b.length || a.localeCompare(b));
  return matches.length ? { dir: where.imagesDir, file: matches[0] } : null;
}

/** Every folder that directly holds audio, with its cover (named, guessed, or from IMAGES). */
async function albums(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.some((f) => AUDIO.has(extname(f).toLowerCase()))) {
      const folder = basename(dir);
      const images = files.filter((f) => IMAGE.has(extname(f).toLowerCase()) && !f.startsWith("._"));
      const covers = images.filter((f) => {
        const stem = norm(f.slice(0, -extname(f).length));
        return stem === "cover" || stem === norm(folder);
      });
      let guessed = false;
      let coverDir = dir;
      if (!covers.length && images.length) {
        const g = await guess(dir, images);
        if (g) (covers.push(g), (guessed = true));
      }
      let fromImagesFolder = false;
      if (!covers.length) {
        const hit = await fromImages(dir);
        if (hit) (covers.push(hit.file), (coverDir = hit.dir), (fromImagesFolder = true));
      }
      out.push({ dir, coverDir, folderPath: toPosix(relative(root, dir)), covers, guessed, fromImagesFolder });
    }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) await walk(join(dir, e.name));
  }
  await walk(root);
  return out.sort((a, b) => a.folderPath.localeCompare(b.folderPath));
}

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => (t = setTimeout(() => reject(new Error(`timed out reading ${what}`)), ms))),
  ]);
}

const all = await albums(DEFAULT_ROOT);
const ready = all.filter((a) => a.covers.length === 1);
const missing = all.filter((a) => a.covers.length === 0);
const unclear = all.filter((a) => a.covers.length > 1);

const guessedCount = ready.filter((a) => a.guessed).length;
console.log(`${all.length} albums · ${ready.length} with a cover (${guessedCount} guessed) · ${missing.length} missing · ${unclear.length} with two possible covers`);
if (guessedCount) {
  console.log("\nGuessed (name one \"cover\" to choose differently):");
  for (const a of ready.filter((a) => a.guessed)) console.log(`  ${a.folderPath}  →  ${a.covers[0]}`);
}
const fromImg = ready.filter((a) => a.fromImagesFolder);
if (fromImg.length) {
  console.log("\nFrom the IMAGES folder (put a cover in the album folder to choose differently):");
  for (const a of fromImg) console.log(`  ${a.folderPath}  →  IMAGES/${a.covers[0]}`);
}
if (unclear.length) {
  console.log("\nTwo possible covers (rename or remove one; skipped until then):");
  for (const a of unclear) console.log(`  ${a.folderPath}  →  ${a.covers.join(", ")}`);
}
if (!UPLOAD) {
  console.log("\nMissing a cover:");
  for (const a of missing) console.log(`  ${a.folderPath}`);
  console.log("\nReport only. Run with --upload to upload the covers found.");
  process.exit(0);
}

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "AUDIO_BUCKET"]) {
  if (!process.env[key]) throw new Error(`${key} is missing from .env.local`);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });

const { data: existing, error } = await db.from("album_covers").select("folder_path, checksum");
if (error) throw new Error(`album_covers: ${error.message} (has the migration been run?)`);
const known = new Map(existing.map((r) => [r.folder_path, r.checksum]));

let uploaded = 0;
let unchanged = 0;
let failed = 0;
for (const a of ready) {
  const file = a.covers[0];
  try {
    const original = await withTimeout(readFile(join(a.coverDir, file)), READ_TIMEOUT_MS, file);
    const checksum = createHash("sha256").update(original).digest("hex");
    if (known.get(a.folderPath) === checksum) {
      unchanged++;
      continue;
    }
    const image = sharp(original).rotate(); // respect phone-camera orientation
    const meta = await image.metadata();
    const jpeg = await image
      .resize(SIZE, SIZE, { fit: "cover", position: "attention" })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    const key = `audio/covers/${checksum.slice(0, 20)}.jpg`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AUDIO_BUCKET,
      Key: key,
      Body: jpeg,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }));
    const { error: e } = await db.from("album_covers").upsert({
      folder_path: a.folderPath,
      storage_key: key,
      source_file: a.fromImagesFolder ? `IMAGES/${file}` : file,
      checksum,
      width: meta.width ?? null,
      height: meta.height ?? null,
      updated_at: new Date().toISOString(),
    });
    if (e) throw new Error(e.message);
    uploaded++;
    const square = meta.width === meta.height ? "" : `  (was ${meta.width}×${meta.height}, cropped to square)`;
    console.log(`  ✓ ${a.folderPath}  ←  ${file}${square}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${a.folderPath}  ←  ${file}: ${err.message}`);
  }
}

console.log(`\n${uploaded} uploaded · ${unchanged} unchanged · ${failed} failed · ${missing.length} albums still need a cover`);
