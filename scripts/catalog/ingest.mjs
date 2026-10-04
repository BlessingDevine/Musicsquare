// Imports the catalogue: uploads each song to S3 and records it in Supabase,
// then builds one live channel per imprint.
//
//   node scripts/catalog/ingest.mjs            everything
//   node scripts/catalog/ingest.mjs --limit 20 a test batch
//   node scripts/catalog/ingest.mjs --channels rebuild channels only
//
// Reads .env.local (see .env.local.example). AWS access comes from the
// `aws login` session, never from a file.
//
// Resumable: a file already imported (matched by source path, or by checksum
// if it has been moved or renamed) is skipped, so a run can be stopped with
// Ctrl-C and started again. Cloud-only Drive files are downloaded as they are
// read; one that hangs is logged and skipped rather than stalling the run.

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { parseBuffer } from "music-metadata";
import { scan, slugify } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const CHANNELS_ONLY = args.includes("--channels");
const CONCURRENCY = 4;
const READ_TIMEOUT_MS = 5 * 60_000;

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "AUDIO_BUCKET"]) {
  if (!process.env[key]) throw new Error(`${key} is missing from .env.local`);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });
const BUCKET = process.env.AUDIO_BUCKET;

const outDir = join(here, "out");
await mkdir(outDir, { recursive: true });
const logFile = join(outDir, "ingest-log.jsonl");
const log = (entry) => appendFile(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");

const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

// --- imprints and artists ----------------------------------------------------

async function upsertImprints(entries) {
  const rows = new Map();
  for (const { imprint } of entries) {
    rows.set(imprint.slug, {
      imprint_name: imprint.name,
      slug: imprint.slug,
      primary_genre: imprint.genres[0] ?? "Various",
      secondary_genres: imprint.genres.slice(1),
    });
  }
  const data = must(await db.from("imprints").upsert([...rows.values()], { onConflict: "slug" }).select());
  return new Map(data.map((r) => [r.slug, r]));
}

async function upsertArtists(entries, imprints) {
  const rows = new Map();
  for (const { artist, imprint } of entries) {
    if (!artist || rows.has(artist.slug)) continue; // first imprint seen is primary
    rows.set(artist.slug, {
      artist_name: artist.name,
      slug: artist.slug,
      primary_imprint_id: imprints.get(imprint.slug).imprint_id,
      genre: imprint.genres[0] ?? null,
    });
  }
  if (!rows.size) return new Map();
  const data = must(await db.from("artists").upsert([...rows.values()], { onConflict: "slug" }).select());
  return new Map(data.map((r) => [r.slug, r]));
}

// --- songs -------------------------------------------------------------------

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
    }),
  ]);
}

async function importOne(entry, ctx) {
  const { imprints, artists, done, checksums } = ctx;
  if (done.has(entry.sourcePath)) return "skipped";

  // Reading a cloud-only file makes Google Drive download it.
  const bytes = await withTimeout(readFile(entry.file), READ_TIMEOUT_MS, "reading from Drive");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksums.has(checksum)) {
    await log({ status: "duplicate", path: entry.sourcePath, of: checksums.get(checksum) });
    return "duplicate";
  }

  const mime = entry.format === "wav" ? "audio/wav" : entry.format === "m4a" ? "audio/mp4" : "audio/mpeg";
  const { format, common } = await parseBuffer(bytes, { mimeType: mime }, { duration: true });
  const imprint = imprints.get(entry.imprint.slug);

  // A WAV with a matching MP3 is that song's master: private, never streamed.
  if (entry.format === "wav") {
    const twin = ctx.songsByKey.get(songKey(entry));
    if (!twin) {
      await log({ status: "wav-without-mp3", path: entry.sourcePath });
      return "skipped";
    }
    const key = `masters/${twin.song_code}.wav`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: mime }));
    must(await db.from("song_files").insert({
      song_id: twin.song_id, file_type: "master_wav", storage_key: key,
      checksum, byte_size: bytes.length, is_public: false,
    }));
    checksums.set(checksum, entry.sourcePath);
    return "master";
  }

  const song = must(await db.from("songs").insert({
    title: entry.title,
    primary_artist_id: entry.artist ? artists.get(entry.artist.slug).artist_id : null,
    primary_imprint_id: imprint.imprint_id,
    album_title: entry.album,
    track_number: common.track?.no ?? null,
    genre: imprint.primary_genre,
    subgenre: imprint.secondary_genres.join(", ") || null,
    duration_ms: format.duration ? Math.round(format.duration * 1000) : null,
    version_type: entry.version,
    // Already on air via RadioKing, so released to radio; ALT takes stay drafts.
    release_status: entry.version === "alt" ? "draft" : "released_radio",
    source_path: entry.sourcePath,
  }).select("song_id, song_code").single());

  const key = `audio/${song.song_code}.${entry.format}`;
  try {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: bytes, ContentType: mime,
      CacheControl: "public, max-age=31536000, immutable",
    }));
    must(await db.from("song_files").insert({
      song_id: song.song_id, file_type: "mp3", storage_key: key, checksum,
      byte_size: bytes.length,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
      is_public: true,
    }));
  } catch (err) {
    // Don't leave a song row with no audio behind; the next run retries it.
    await db.from("songs").delete().eq("song_id", song.song_id);
    throw err;
  }

  checksums.set(checksum, entry.sourcePath);
  ctx.songsByKey.set(songKey(entry), song);
  return "imported";
}

const songKey = (e) => `${e.artist?.slug ?? e.imprint.slug}|${e.album ?? ""}|${e.title.toLowerCase()}`;

// --- channels ----------------------------------------------------------------
// One live channel per imprint, named for its genre. The rotation is every
// released song on the imprint, minus ALT takes, keeping one recording per
// artist + title (the catalogue holds 146 titles recorded twice).

async function buildChannels(imprints) {
  const built = [];
  for (const imprint of imprints.values()) {
    const songs = must(await db.from("songs")
      .select("song_id, title, primary_artist_id, source_path")
      .eq("primary_imprint_id", imprint.imprint_id)
      .in("release_status", ["released_radio", "released_app", "released_public"])
      .neq("version_type", "alt")
      .not("duration_ms", "is", null)
      .order("source_path"));
    const seen = new Set();
    const rotation = songs.filter((s) => {
      const k = `${s.primary_artist_id}|${s.title.toLowerCase()}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    if (!rotation.length) continue;

    const genres = [imprint.primary_genre, ...imprint.secondary_genres];
    const name = genres.join(" / ");
    const slug = slugify(genres.join(" "));

    const playlist = must(await db.from("playlists").upsert({
      playlist_name: `${name} rotation`, slug: `${slug}-rotation`, playlist_type: "imprint",
      description: `Live rotation for the ${name} channel, from ${imprint.imprint_name}.`,
    }, { onConflict: "slug" }).select().single());

    must(await db.from("playlist_songs").delete().eq("playlist_id", playlist.playlist_id));
    for (let i = 0; i < rotation.length; i += 500) {
      must(await db.from("playlist_songs").insert(rotation.slice(i, i + 500).map((s, j) => ({
        playlist_id: playlist.playlist_id, song_id: s.song_id, sort_order: i + j, added_by: "importer",
      }))));
    }

    built.push({ name, slug, imprint, playlist, size: rotation.length });
  }

  // Biggest catalogue first: the channels page leads with Pop, R&B, Afrobeat.
  built.sort((a, b) => b.size - a.size);
  for (const [order, { name, slug, imprint, playlist, size }] of built.entries()) {
    // epoch is left alone on re-runs so live channels don't jump.
    must(await db.from("radio_stations").upsert({
      station_name: name, slug, station_type: "imprint",
      related_imprint_id: imprint.imprint_id, playlist_id: playlist.playlist_id,
      description: `${imprint.imprint_name}, live.`, sort_order: order, status: "active",
    }, { onConflict: "slug" }));
    console.log(`  channel ${name.padEnd(28)} ${size} songs`);
  }
}

// --- run ---------------------------------------------------------------------

const { entries: all } = await scan();
// MP3s first so every WAV master finds its streaming twin.
all.sort((a, b) => (a.format === "wav") - (b.format === "wav"));
const entries = all.slice(0, LIMIT);

const imprints = await upsertImprints(all);
const artists = await upsertArtists(all, imprints);

if (!CHANNELS_ONLY) {
  const existing = must(await db.from("songs").select("song_id, song_code, source_path, title, album_title, primary_artist_id, primary_imprint_id"));
  const files = must(await db.from("song_files").select("checksum, song_id"));
  const done = new Set(existing.map((s) => s.source_path));
  const pathById = new Map(existing.map((s) => [s.song_id, s.source_path]));
  const checksums = new Map(files.filter((f) => f.checksum).map((f) => [f.checksum, pathById.get(f.song_id)]));
  const songsByKey = new Map();
  for (const e of all) {
    const s = existing.find((x) => x.source_path === e.sourcePath);
    if (s) songsByKey.set(songKey(e), s);
  }
  const ctx = { imprints, artists, done, checksums, songsByKey };

  const tally = { imported: 0, master: 0, skipped: 0, duplicate: 0, failed: 0 };
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      try {
        const result = await importOne(entry, ctx);
        tally[result]++;
        if (result !== "skipped") await log({ status: result, path: entry.sourcePath });
      } catch (err) {
        tally.failed++;
        await log({ status: "failed", path: entry.sourcePath, error: String(err.message ?? err) });
      }
      const n = Object.values(tally).reduce((a, b) => a + b, 0);
      if (n % 25 === 0 || n === entries.length) {
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`${n}/${entries.length}  ${JSON.stringify(tally)}  ${mins} min`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\ndone: ${JSON.stringify(tally)}   log: ${logFile}`);
}

console.log("\nchannels:");
await buildChannels(imprints);
