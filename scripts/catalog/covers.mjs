// Album covers: finds one cover per album folder in IMPRINT/, uploads it to
// S3 (served by CloudFront) and records it in album_covers, which GoSquare and
// the website read through the song_covers view.
//
//   node scripts/catalog/covers.mjs            report only: which albums have a cover
//   node scripts/catalog/covers.mjs --upload   upload new or changed covers
//
// Robert's rule for which image is the cover: a file named "cover"
// (cover.jpg / .png / .webp), or one named exactly like its album folder
// (TRAPSOUL III/Trapsoul III.jpg), ignoring capitals, spaces and accents. Every
// other image in the folders — artist photos, YouTube art, designs — is left
// alone. Loose songs in an artist's MUSIC folder share a cover placed there.
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

/** Every folder that directly holds audio, with the cover candidates in it. */
async function albums(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.some((f) => AUDIO.has(extname(f).toLowerCase()))) {
      const folder = basename(dir);
      const covers = files.filter((f) => {
        if (!IMAGE.has(extname(f).toLowerCase()) || f.startsWith("._")) return false;
        const stem = norm(f.slice(0, -extname(f).length));
        return stem === "cover" || stem === norm(folder);
      });
      out.push({ dir, folderPath: toPosix(relative(root, dir)), covers });
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

console.log(`${all.length} albums · ${ready.length} with a cover · ${missing.length} missing · ${unclear.length} with two possible covers`);
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
    const original = await withTimeout(readFile(join(a.dir, file)), READ_TIMEOUT_MS, file);
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
      source_file: file,
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
