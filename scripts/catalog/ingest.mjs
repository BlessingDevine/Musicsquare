// Imports the catalogue: uploads each song to S3 and records it in Supabase,
// then builds one live channel per imprint.
//
//   node scripts/catalog/ingest.mjs            everything
//   node scripts/catalog/ingest.mjs --limit 20 a test batch
//   node scripts/catalog/ingest.mjs --channels rebuild channels only
//   node scripts/catalog/ingest.mjs --only riot-temple   one label (its slug) only
//
// Held artists (paused with hold.mjs) are skipped entirely — nothing of theirs
// is imported or moved, new files included — until they are released.
//
// Reads .env.local (see .env.local.example). AWS access comes from the
// musicsquare-uploader CLI profile (AWS_PROFILE), never from a file here.
// A WAV with no matching MP3 is converted to a 320k MP3 for streaming, which
// needs ffmpeg (`brew install ffmpeg`).
//
// Resumable: a file already imported (matched by source path, or by checksum
// if it has been moved or renamed) is skipped, so a run can be stopped with
// Ctrl-C and started again. Cloud-only Drive files are downloaded as they are
// read; one that hangs is logged and skipped rather than stalling the run.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { parseBuffer } from "music-metadata";
import { analyse } from "./cues.mjs";
import { abs, parseImprint, scan, slugify } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const CHANNELS_ONLY = args.includes("--channels");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
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

// Every list read goes through this. PostgREST returns at most 1,000 rows a
// request; reading songs without paging would see only the first 1,000 of
// 2,300 and re-upload the rest as "new". `build` makes a fresh query per page.
async function selectAll(build, page = 1000) {
  const rows = [];
  for (let from = 0; ; from += page) {
    const data = must(await build().range(from, from + page - 1));
    rows.push(...data);
    if (data.length < page) return rows;
  }
}

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
  const { done, checksums } = ctx;
  if (done.has(entry.sourcePath)) return "skipped";
  // Each path is handled once even with several workers.
  done.add(entry.sourcePath);

  // An MP3 arriving beside a WAV that was already imported (and converted)
  // is the same song: link the song to the MP3 rather than import it twice.
  // The stream stays the converted copy; the WAV stays the master.
  if (entry.format !== "wav") {
    const twin = ctx.songsByKey.get(songKey(entry));
    if (twin?.source_path?.toLowerCase().endsWith(".wav")) {
      must(await db.from("songs").update({ source_path: entry.sourcePath }).eq("song_id", twin.song_id));
      await log({ status: "linked", path: entry.sourcePath, from: twin.source_path, song: twin.song_code });
      twin.source_path = entry.sourcePath;
      return "linked";
    }
  }

  // Reading a cloud-only file makes Google Drive download it.
  const bytes = await withTimeout(readFile(entry.file), READ_TIMEOUT_MS, "reading from Drive");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksums.has(checksum)) {
    // Same audio as a song already imported. If that song's old file is gone,
    // it was moved or renamed (reorganised into an artist folder, say): keep
    // the song — same code, same place in the rotations — and re-point it.
    // If the old file is still there, this is a genuine second copy.
    const prior = ctx.songsById.get(ctx.songByChecksum.get(checksum));
    if (prior && !existsSync(abs(prior.source_path))) {
      await moveSong(prior, entry, ctx);
      return "moved";
    }
    await log({ status: "duplicate", path: entry.sourcePath, of: checksums.get(checksum) });
    return "duplicate";
  }

  const mime = entry.format === "wav" ? "audio/wav" : entry.format === "m4a" ? "audio/mp4" : "audio/mpeg";
  const { format, common } = await parseBuffer(bytes, { mimeType: mime }, { duration: true });

  // A WAV with a matching MP3 is that song's master: private, never streamed.
  if (entry.format === "wav") {
    const twin = ctx.songsByKey.get(songKey(entry));
    if (twin) {
      await uploadMaster(twin, bytes, checksum);
      checksums.set(checksum, entry.sourcePath);
      return "master";
    }
    // A WAV on its own (Vegah Riot's Vol 3 arrived like this): make a 320k
    // MP3 to stream, and keep the WAV as the private master. The duration
    // comes from the MP3, because that is the file listeners hear.
    const mp3 = await toMp3(entry.file);
    const mp3Format = (await parseBuffer(mp3, { mimeType: "audio/mpeg" }, { duration: true })).format;
    const song = await createSong(entry, ctx, mp3Format.duration, common.track?.no);
    try {
      await uploadStream(song, mp3, "mp3", "audio/mpeg", mp3Format.bitrate);
      await uploadMaster(song, bytes, checksum);
    } catch (err) {
      await db.from("songs").delete().eq("song_id", song.song_id);
      throw err;
    }
    checksums.set(checksum, entry.sourcePath);
    ctx.songsByKey.set(songKey(entry), song);
    return "transcoded";
  }

  const song = await createSong(entry, ctx, format.duration, common.track?.no);
  try {
    await uploadStream(song, bytes, entry.format, mime, format.bitrate, checksum);
  } catch (err) {
    // Don't leave a song row with no audio behind; the next run retries it.
    await db.from("songs").delete().eq("song_id", song.song_id);
    throw err;
  }

  checksums.set(checksum, entry.sourcePath);
  ctx.songsByKey.set(songKey(entry), song);
  return "imported";
}

async function moveSong(prior, entry, { imprints, artists, songsById }) {
  const imprint = imprints.get(entry.imprint.slug);
  const patch = {
    source_path: entry.sourcePath,
    title: entry.title,
    album_title: entry.album,
    primary_artist_id: entry.artist ? artists.get(entry.artist.slug).artist_id : null,
    primary_imprint_id: imprint.imprint_id,
    genre: imprint.primary_genre,
    subgenre: imprint.secondary_genres.join(", ") || null,
    version_type: entry.version,
  };
  // Only touch the release status if the move changed what kind of take it
  // is; a status set by hand (archived, say) is otherwise left alone.
  if (entry.version !== prior.version_type) {
    patch.release_status = entry.version === "alt" ? "draft" : "released_radio";
  }
  must(await db.from("songs").update(patch).eq("song_id", prior.song_id));
  await log({ status: "moved", path: entry.sourcePath, from: prior.source_path, song: prior.song_code });
  Object.assign(prior, patch);
  songsById.set(prior.song_id, prior);
}

async function createSong(entry, { imprints, artists }, durationSeconds, trackNo) {
  const imprint = imprints.get(entry.imprint.slug);
  // Cue points for the channel crossfades (see cues.mjs). A failure here just
  // means the song plays whole; scripts/catalog/cues.mjs can fill it later.
  const durationMs = durationSeconds ? Math.round(durationSeconds * 1000) : null;
  const cues = await analyse(entry.file).catch(() => null);
  return must(await db.from("songs").insert({
    cue_in_ms: cues?.cueInMs ?? null,
    cue_out_ms: cues && durationMs ? Math.min(cues.cueOutMs, durationMs) : null,
    title: entry.title,
    primary_artist_id: entry.artist ? artists.get(entry.artist.slug).artist_id : null,
    primary_imprint_id: imprint.imprint_id,
    album_title: entry.album,
    track_number: trackNo ?? null,
    genre: imprint.primary_genre,
    subgenre: imprint.secondary_genres.join(", ") || null,
    duration_ms: durationSeconds ? Math.round(durationSeconds * 1000) : null,
    version_type: entry.version,
    // Already on air via RadioKing, so released to radio; ALT takes stay drafts.
    release_status: entry.version === "alt" ? "draft" : "released_radio",
    source_path: entry.sourcePath,
  }).select("song_id, song_code").single());
}

/** The public streaming file. Checksum defaults to the bytes uploaded. */
async function uploadStream(song, bytes, ext, mime, bitrate, checksum) {
  const key = `audio/${song.song_code}.${ext}`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: bytes, ContentType: mime,
    CacheControl: "public, max-age=31536000, immutable",
  }));
  must(await db.from("song_files").insert({
    song_id: song.song_id, file_type: "mp3", storage_key: key,
    checksum: checksum ?? createHash("sha256").update(bytes).digest("hex"),
    byte_size: bytes.length,
    bitrate: bitrate ? Math.round(bitrate / 1000) : null,
    is_public: true,
  }));
}

/** The private master. Never served: CloudFront can only read audio/. */
async function uploadMaster(song, bytes, checksum) {
  const key = `masters/${song.song_code}.wav`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: "audio/wav" }));
  must(await db.from("song_files").insert({
    song_id: song.song_id, file_type: "master_wav", storage_key: key,
    checksum, byte_size: bytes.length, is_public: false,
  }));
}

/** WAV -> 320kbps MP3 in memory, via ffmpeg (Homebrew). */
function toMp3(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", file,
      "-codec:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "3", "-f", "mp3", "pipe:1"]);
    const chunks = [];
    let err = "";
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.stderr.on("data", (c) => (err += c));
    ff.on("error", (e) => reject(new Error(`ffmpeg not available (brew install ffmpeg): ${e.message}`)));
    ff.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg: ${err.trim()}`))));
  });
}

const songKey = (e) => `${e.artist?.slug ?? e.imprint.slug}|${e.album ?? ""}|${e.title.toLowerCase()}`;

// --- channels ----------------------------------------------------------------
// One live channel per imprint, named for its genre. The rotation is every
// released song on the imprint, minus ALT takes, keeping one recording per
// artist + title (the catalogue holds 146 titles recorded twice).

// Labels whose music is in the catalogue (site, app) but not on air yet.
const NO_CHANNEL = new Set(JSON.parse(readFileSync(new URL("./channels-off.json", import.meta.url), "utf8")));

async function buildChannels(imprints) {
  const built = [];
  for (const imprint of imprints.values()) {
    if (NO_CHANNEL.has(imprint.slug)) continue;
    const songs = await selectAll(() => db.from("songs")
      .select("song_id, title, primary_artist_id, source_path")
      .eq("primary_imprint_id", imprint.imprint_id)
      .in("release_status", ["released_radio", "released_app", "released_public"])
      .neq("version_type", "alt")
      .not("duration_ms", "is", null)
      .order("source_path")
      .order("song_id"));
    const seen = new Set();
    const rotation = songs.filter((s) => {
      const k = `${s.primary_artist_id}|${s.title.toLowerCase()}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    if (!rotation.length) continue;

    const genres = [imprint.primary_genre, ...imprint.secondary_genres];
    // A label can name its channel outright (genre-names.json); otherwise the genres do.
    const name = parseImprint(imprint.imprint_name).channel ?? genres.join(" / ");
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

  // Biggest catalogue first: the channels page leads with Pop, R&B, Afrobeats.
  built.sort((a, b) => b.size - a.size);
  // One channel per imprint for good. When a label's genre is renamed (Afrobeat
  // → Afrobeats) its existing channel is renamed in place — same slug, same
  // epoch — rather than a second channel being created beside it.
  const existing = await selectAll(() => db.from("radio_stations").select("station_id, slug, related_imprint_id").order("slug"));
  const kept = new Set();
  for (const [order, { name, slug, imprint, playlist, size }] of built.entries()) {
    const prior = existing.find((st) => st.related_imprint_id === imprint.imprint_id) ?? existing.find((st) => st.slug === slug);
    const row = {
      station_name: name, station_type: "imprint",
      related_imprint_id: imprint.imprint_id, playlist_id: playlist.playlist_id,
      description: `${imprint.imprint_name}, live.`, sort_order: order, status: "active",
    };
    // epoch is left alone on re-runs so live channels don't jump.
    if (prior) must(await db.from("radio_stations").update(row).eq("station_id", prior.station_id));
    else must(await db.from("radio_stations").insert({ ...row, slug }));
    kept.add(prior?.station_id ?? slug);
    console.log(`  channel ${name.padEnd(28)} ${size} songs${prior && prior.slug !== slug ? `  (renamed; keeps /${prior.slug})` : ""}`);
  }
  // A channel whose label no longer has a rotation goes quiet rather than playing stale songs.
  for (const st of existing) {
    if (!kept.has(st.station_id)) {
      must(await db.from("radio_stations").update({ status: "archived" }).eq("station_id", st.station_id));
      console.log(`  channel /${st.slug} archived (no songs)`);
    }
  }
}

// --- run ---------------------------------------------------------------------

const scanned = (await scan().then((r) => r.entries)).filter((e) => !ONLY || e.imprint.slug === ONLY);
if (ONLY && !scanned.length) throw new Error(`No music found for --only ${ONLY} (use the label's slug, e.g. riot-temple)`);
// Held artists stay untouched until hold.mjs --release.
const held = new Set((await selectAll(() => db.from("artists").select("slug").eq("status", "paused").order("slug"))).map((a) => a.slug));
const all = scanned.filter((e) => !(e.artist && held.has(e.artist.slug)));
if (scanned.length !== all.length) console.log(`skipping ${scanned.length - all.length} files of held artists: ${[...held].join(", ")}`);
// MP3s first so every WAV master finds its streaming twin.
all.sort((a, b) => (a.format === "wav") - (b.format === "wav"));
const entries = all.slice(0, LIMIT);

const imprints = await upsertImprints(all);
const artists = await upsertArtists(all, imprints);

if (!CHANNELS_ONLY) {
  const existing = await selectAll(() => db.from("songs")
    .select("song_id, song_code, source_path, title, album_title, primary_artist_id, primary_imprint_id, version_type")
    .order("song_id"));
  const files = await selectAll(() => db.from("song_files")
    .select("checksum, song_id, file_type").order("song_file_id"));
  const done = new Set(existing.map((s) => s.source_path));
  const songsById = new Map(existing.map((s) => [s.song_id, s]));
  const checksums = new Map(files.filter((f) => f.checksum)
    .map((f) => [f.checksum, songsById.get(f.song_id)?.source_path]));
  // Only a streaming file's checksum identifies a song that can be moved; a
  // master WAV moves with its MP3 and is just skipped as a copy.
  const songByChecksum = new Map(files.filter((f) => f.checksum && f.file_type === "mp3")
    .map((f) => [f.checksum, f.song_id]));
  const byPath = new Map(existing.map((s) => [s.source_path, s]));
  const songsByKey = new Map();
  for (const e of all) {
    const s = byPath.get(e.sourcePath);
    if (s) songsByKey.set(songKey(e), s);
  }
  const ctx = { imprints, artists, done, checksums, songsById, songByChecksum, songsByKey };

  const tally = { imported: 0, transcoded: 0, moved: 0, linked: 0, master: 0, skipped: 0, duplicate: 0, failed: 0 };
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      try {
        const result = await importOne(entry, ctx);
        tally[result]++;
        // moveSong writes its own, fuller entry (with the old path).
        if (!["skipped", "moved", "linked"].includes(result)) await log({ status: result, path: entry.sourcePath });
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

  // Artists left with no songs (every song moved to another artist folder)
  // are archived, not deleted; one that gains songs again is reactivated.
  const credited = new Set((await selectAll(() => db.from("songs")
    .select("primary_artist_id").order("song_id"))).map((r) => r.primary_artist_id));
  for (const a of await selectAll(() => db.from("artists").select("artist_id, artist_name, status").order("artist_id"))) {
    const want = credited.has(a.artist_id) ? "active" : "archived";
    if (a.status !== want && (a.status === "active" || a.status === "archived")) {
      must(await db.from("artists").update({ status: want }).eq("artist_id", a.artist_id));
      console.log(`  artist ${a.artist_name}: ${a.status} -> ${want}`);
    }
  }
}

console.log("\nchannels:");
await buildChannels(imprints);
