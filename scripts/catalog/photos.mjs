// Artist photo galleries for the artist pages on squaredrum.com (and later
// GoSquare): reads an artist's Photos/ folder in LABELS/, makes web-sized
// JPEGs and puts them on the CDN with a small index the sites read.
//
//   node scripts/catalog/photos.mjs lea-babi            report what would change
//   node scripts/catalog/photos.mjs lea-babi --upload   resize + upload
//
// In the Photos folder:
//   - Files whose name starts with "hero" open the page. A portrait one (taller
//     than wide) is used on phones, a wide one on computers.
//   - Every other photo is the gallery, in filename order ("Lea 01", "Lea 02"…).
//   - A "Bio" document in Press Kit/ (.txt, .md, .rtf, .docx or .pdf) is the
//     About text.
//   - Another document in Press Kit/ with an "Artist at a Glance" list
//     ("Genre: …" lines, "|" separating two on one line) gives the facts panel.
//   - A PDF in Press Kit/ (not the Bio) is offered as "Download press kit".
// Each photo is stored at 480, 960 and 1600 px wide under
// audio/photos/<slug>/<hash>-<width>.jpg (named by content, so replacing a file
// makes a new one and never shows a stale copy), and the list at
// audio/photos/<slug>/index.json. Unchanged photos aren't uploaded again.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { LABELS_ROOT } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const args = process.argv.slice(2);
const UPLOAD = args.includes("--upload");
const slugs = args.filter((a) => !a.startsWith("--"));
if (!slugs.length) throw new Error("Name an artist slug, e.g. node scripts/catalog/photos.mjs lea-babi");

const IMAGES = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);
const DOCS = new Set([".txt", ".md", ".rtf", ".docx", ".doc", ".pdf"]);
const WIDTHS = [480, 960, 1600];
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });
const Bucket = process.env.AUDIO_BUCKET;
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** LABELS/<Label>/Artists/<name> for an artist, whatever the label. */
function artistFolder(name) {
  for (const label of readdirSync(LABELS_ROOT)) {
    const dir = join(LABELS_ROOT, label, "Artists");
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).find((d) => d.toLowerCase() === name.toLowerCase());
    if (hit) return join(dir, hit);
  }
  return null;
}

function readDoc(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".txt" || ext === ".md") return readFileSync(path, "utf8");
  if (ext === ".pdf")
    return execFileSync(
      "osascript",
      ["-l", "JavaScript", "-e", "ObjC.import('PDFKit'); function run(a){ const d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0])); return d.isNil() ? '' : ObjC.unwrap(d.string) }", path],
      { encoding: "utf8", maxBuffer: 20e6 },
    );
  return execFileSync("textutil", ["-convert", "txt", "-stdout", path], { encoding: "utf8", maxBuffer: 20e6 });
}

const exists = (Key) =>
  s3.send(new HeadObjectCommand({ Bucket, Key })).then(
    () => true,
    () => false,
  );
const put = (Key, Body, ContentType, CacheControl = "public, max-age=31536000, immutable", ContentDisposition) =>
  s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType, CacheControl, ContentDisposition }));

/** "Artist at a Glance" lines from a press kit's text, as [label, value] pairs. */
function glanceOf(text) {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => /^artist at a glance$/i.test(l));
  if (at < 0) return [];
  const out = [];
  for (const line of lines.slice(at + 1)) {
    const parts = line.split(/\s+\|\s+/).map((p) => p.match(/^([^:]{2,30}):\s*(.+)$/));
    if (!parts.every(Boolean)) break;
    for (const m of parts) out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
}

for (const slug of slugs) {
  const { data: artist, error } = await db.from("artists").select("artist_name, slug").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!artist) throw new Error(`No artist with slug "${slug}"`);
  const folder = artistFolder(artist.artist_name);
  if (!folder) throw new Error(`No LABELS folder for ${artist.artist_name}`);
  const photoDir = join(folder, "Photos");
  const files = existsSync(photoDir)
    ? readdirSync(photoDir).filter((f) => IMAGES.has(extname(f).toLowerCase()) && !f.startsWith(".")).sort(byName)
    : [];

  const press = join(folder, "Press Kit");
  const bioFile = existsSync(press) ? readdirSync(press).find((f) => /^bio/i.test(f) && DOCS.has(extname(f).toLowerCase())) : null;
  const bio = bioFile ? readDoc(join(press, bioFile)).replace(/\r/g, "").trim() : null;
  const pressDocs = existsSync(press)
    ? readdirSync(press).filter((f) => !/^bio/i.test(f) && !f.startsWith(".") && DOCS.has(extname(f).toLowerCase()))
    : [];
  // The editable document first: a designed PDF's text doesn't keep "Label: value" lines.
  let glance = [];
  for (const f of [...pressDocs].sort((a, b) => (extname(a) === ".pdf") - (extname(b) === ".pdf"))) {
    glance = glanceOf(readDoc(join(press, f)));
    if (glance.length) break;
  }
  const kitFile = pressDocs.filter((f) => extname(f).toLowerCase() === ".pdf").sort((a, b) => statSync(join(press, b)).mtimeMs - statSync(join(press, a)).mtimeMs)[0];

  console.log(`${artist.artist_name}: ${files.length} photos${bio ? `, bio from "${bioFile}"` : ", no bio"}, ${glance.length} facts, ${kitFile ? `press kit "${kitFile}"` : "no press kit PDF"}`);
  const photos = [];
  for (const f of files) {
    const src = join(photoDir, f);
    const buf = readFileSync(src);
    const id = createHash("sha256").update(buf).digest("hex").slice(0, 16);
    // .rotate() applies the camera's orientation before measuring.
    const img = sharp(buf).rotate();
    const { width, height } = await img.metadata().then((m) => (m.orientation >= 5 ? { width: m.height, height: m.width } : m));
    const role = /^hero/i.test(f) ? "hero" : "gallery";
    const widths = WIDTHS.filter((w) => w < width).concat(width < WIDTHS.at(-1) ? [width] : []).slice(0, 3);
    const shape = width / height > 1.2 ? "wide" : width / height < 0.85 ? "tall" : "square";
    photos.push({ id, file: f, role, shape, width, height, widths });
    const done = await exists(`audio/photos/${slug}/${id}-${widths.at(-1)}.jpg`);
    console.log(`  ${done ? "✓" : UPLOAD ? "↑" : "new"}  ${role.padEnd(7)} ${shape.padEnd(6)} ${width}×${height}  ${f}  (${(statSync(src).size / 1e6).toFixed(1)} MB)`);
    if (done || !UPLOAD) continue;
    for (const w of widths) {
      const out = await sharp(buf).rotate().resize({ width: w }).flatten({ background: "#000" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      await put(`audio/photos/${slug}/${id}-${w}.jpg`, out, "image/jpeg");
    }
  }

  if (!UPLOAD) continue;
  let presskit = null;
  if (kitFile) {
    const buf = readFileSync(join(press, kitFile));
    const key = `audio/photos/${slug}/presskit-${createHash("sha256").update(buf).digest("hex").slice(0, 16)}.pdf`;
    const name = `${artist.artist_name} - Press Kit.pdf`;
    if (!(await exists(key))) await put(key, buf, "application/pdf", undefined, `attachment; filename="${name}"`);
    presskit = { key, name, bytes: buf.length };
  }
  const index = { artist: artist.artist_name, updated: new Date().toISOString(), bio, glance, presskit, photos: photos.map(({ file, ...p }) => ({ ...p, name: basename(file, extname(file)) })) };
  await put(`audio/photos/${slug}/index.json`, JSON.stringify(index), "application/json", "public, max-age=300");
  console.log(`  index.json written (${photos.length} photos). squaredrum.com shows it within 5 minutes.`);
}
if (!UPLOAD) console.log("\nNothing uploaded. Run with --upload to resize and upload.");
