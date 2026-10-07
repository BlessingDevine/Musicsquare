// Curated playlists from Robert's PLAYLISTS folder (next to IMPRINT/):
//
//   PLAYLISTS/Late Night Drive.rtf      one song per line: "Artist - Title"
//   PLAYLISTS/Late Night Drive.jpg      optional cover (same name)
//
// A first line starting "About:" becomes the description. Lines that are just
// a title work if the title is unique. .txt, .md, .rtf and .docx all work.
//
//   node scripts/catalog/playlists.mjs            report: what each line matched
//   node scripts/catalog/playlists.mjs --upload   load them (owner_type 'curator')
//
// Re-running replaces each playlist's songs with the file's current list; a
// playlist whose file is gone is archived. Covers get the same 1000/600/300px
// copies as album covers.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { DEFAULT_ROOT, slugify } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const UPLOAD = process.argv.includes("--upload");
const DIR = process.env.PLAYLISTS_DIR ?? join(DEFAULT_ROOT, "..", "PLAYLISTS");
const LISTS = new Set([".txt", ".md", ".rtf", ".docx", ".doc"]);
const IMAGES = [".jpg", ".jpeg", ".png", ".webp"];

const norm = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

if (!existsSync(DIR)) {
  console.log(`No PLAYLISTS folder yet (${DIR}). Create it and add one file per playlist.`);
  process.exit(0);
}

// Every released song with its artist (or imprint) name.
const songs = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("songs")
    .select("song_id, title, version_type, release_status, artists(artist_name), imprints(imprint_name)")
    .in("release_status", ["released_radio", "released_app", "released_public"])
    .order("song_code")
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  songs.push(...data);
  if (data.length < 1000) break;
}
const byArtistTitle = new Map();
const byTitle = new Map();
for (const s of songs) {
  const artist = s.artists?.artist_name ?? s.imprints?.imprint_name ?? "";
  byArtistTitle.set(`${norm(artist)}|${norm(s.title)}`, s);
  const list = byTitle.get(norm(s.title)) ?? [];
  list.push(s);
  byTitle.set(norm(s.title), list);
}

/** One line → a song, or a reason it didn't match. */
function match(line) {
  const parts = line.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    const hit = byArtistTitle.get(`${norm(parts[0])}|${norm(parts.slice(1).join(" - "))}`);
    if (hit) return { song: hit };
  }
  const titleOnly = byTitle.get(norm(parts.length >= 2 ? parts.slice(1).join(" - ") : line)) ?? byTitle.get(norm(line)) ?? [];
  // Prefer the original take when the title has an ALT/remix twin.
  const originals = titleOnly.filter((s) => s.version_type === "original");
  const pick = originals.length === 1 ? originals : titleOnly;
  if (pick.length === 1) return { song: pick[0] };
  return { reason: pick.length ? `${pick.length} songs have this title — add the artist ("Artist - Title")` : "no song with this title" };
}

function readList(path) {
  const ext = extname(path).toLowerCase();
  const text = ext === ".txt" || ext === ".md" ? readFileSync(path, "utf8")
    : execFileSync("textutil", ["-convert", "txt", "-stdout", path], { encoding: "utf8" });
  let description = null;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "").trim(); // tolerate bullets and numbering
    if (!line) continue;
    const about = line.match(/^about\s*:\s*(.+)$/i);
    if (about) description = about[1];
    else lines.push(line);
  }
  return { description, lines };
}

const files = readdirSync(DIR).filter((f) => LISTS.has(extname(f).toLowerCase()) && !f.startsWith("."));
const playlists = files.map((f) => {
  const name = basename(f, extname(f)).trim();
  const { description, lines } = readList(join(DIR, f));
  const cover = IMAGES.map((e) => readdirSync(DIR).find((x) => x.toLowerCase() === `${name.toLowerCase()}${e}`)).find(Boolean) ?? null;
  const matched = [];
  const misses = [];
  const seen = new Set();
  for (const line of lines) {
    const r = match(line);
    if (r.song && !seen.has(r.song.song_id)) (seen.add(r.song.song_id), matched.push(r.song));
    else if (!r.song) misses.push(`${line} — ${r.reason}`);
  }
  return { file: f, name, slug: `curated-${slugify(name)}`, description, cover, matched, misses };
});

for (const p of playlists) {
  console.log(`${p.name}: ${p.matched.length} songs${p.cover ? ", cover " + p.cover : ", no cover"}${p.description ? ` — "${p.description}"` : ""}`);
  for (const m of p.misses) console.log(`   ✗ ${m}`);
}
if (!playlists.length) console.log("The PLAYLISTS folder has no playlist files yet.");
if (!UPLOAD) {
  console.log("\nReport only. Run with --upload to load them.");
  process.exit(0);
}

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });
const put = (Key, Body) =>
  s3.send(new PutObjectCommand({ Bucket: process.env.AUDIO_BUCKET, Key, Body, ContentType: "image/jpeg", CacheControl: "public, max-age=31536000, immutable" }));

const { data: existing, error: ee } = await db.from("playlists").select("playlist_id, slug, cover_checksum").eq("owner_type", "curator");
if (ee) throw new Error(`${ee.message} (has the curated playlists migration been run?)`);
const bySlug = new Map(existing.map((r) => [r.slug, r]));

for (const p of playlists) {
  const row = {
    playlist_name: p.name, slug: p.slug, playlist_type: "mood", owner_type: "curator",
    description: p.description, is_public: true, status: "active", source_file: p.file,
  };
  if (p.cover) {
    const original = readFileSync(join(DIR, p.cover));
    const checksum = createHash("sha256").update(original).digest("hex");
    if (bySlug.get(p.slug)?.cover_checksum !== checksum) {
      const jpeg = await sharp(original).rotate().resize(1000, 1000, { fit: "cover", position: "attention" }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      const key = `audio/covers/${checksum.slice(0, 20)}.jpg`;
      await put(key, jpeg);
      for (const px of [300, 600]) await put(key.replace(/\.jpg$/, `-${px}.jpg`), await sharp(jpeg).resize(px, px).jpeg({ quality: 80, mozjpeg: true }).toBuffer());
      Object.assign(row, { cover_key: key, cover_checksum: checksum });
    }
  } else Object.assign(row, { cover_key: null, cover_checksum: null });
  const { data: saved, error } = await db.from("playlists").upsert(row, { onConflict: "slug" }).select("playlist_id").single();
  if (error) throw new Error(`${p.name}: ${error.message}`);
  const { error: de } = await db.from("playlist_songs").delete().eq("playlist_id", saved.playlist_id);
  if (de) throw new Error(de.message);
  if (p.matched.length) {
    const { error: ie } = await db.from("playlist_songs").insert(
      p.matched.map((s, i) => ({ playlist_id: saved.playlist_id, song_id: s.song_id, sort_order: i, added_by: "curator" })),
    );
    if (ie) throw new Error(ie.message);
  }
  console.log(`  ✓ ${p.name} (${p.matched.length} songs)`);
}
for (const r of existing) {
  if (!playlists.some((p) => p.slug === r.slug)) {
    await db.from("playlists").update({ status: "archived" }).eq("playlist_id", r.playlist_id);
    console.log(`  archived ${r.slug} (its file is gone)`);
  }
}
