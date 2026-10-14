// Catalogue check and artist readiness, in one pass. Read-only: it changes
// nothing, it only reports.
//
//   node scripts/catalog/audit.mjs            print a summary
//   node scripts/catalog/audit.mjs --json     also write scripts/catalog/out/audit.json
//
// Song problems it looks for:
//   - titles that still look like file names (".mp", "_", "2_17", ALL CAPS)
//   - the same song title twice for one artist (within an album or across albums)
// Album problems: no cover, cover without a Canvas.
// Artist readiness, one row per artist with songs: songs, albums, covers,
// Canvases, artist page (photo index on the CDN), roster card (site), bio, photos.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { BUSINESS } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const JSON_OUT = process.argv.includes("--json");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const CDN = process.env.NEXT_PUBLIC_AUDIO_BASE_URL.replace(/\/$/, "");

async function all(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const [artists, songs, covers] = await Promise.all([
  all("artists", "artist_id, artist_name, slug, genre, status"),
  all("songs", "song_id, title, album_title, primary_artist_id, source_path"),
  all("album_covers", "folder_path, canvas_key, canvas_checksum, checksum"),
]);
const roster = new Set(
  [...readFileSync(join(here, "../../src/lib/station.ts"), "utf8").matchAll(/slug: "([a-z0-9-]+)", name:/g)].map((m) => m[1]),
);
const coverByFolder = new Map(covers.map((c) => [c.folder_path, c]));
const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(alt\)|\(remix\)|\(extended\)|\(.*mix\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// ── Song titles ──
const oddTitles = [];
for (const s of songs) {
  const t = s.title ?? "";
  const why = /\.mp$|\.mp3$|\.wav$/i.test(t)
    ? "file extension in the title"
    : /_/.test(t)
      ? "underscore in the title"
      : /\b\d{3,4}\s?(am|pm)\b/i.test(t)
        ? "time without a colon"
        : t.length > 3 && t === t.toUpperCase() && /[A-Z]/.test(t)
          ? "ALL CAPS"
          : null;
  if (why) oddTitles.push({ title: t, why, path: s.source_path });
}

// ── Duplicates per artist ──
const byArtist = new Map();
for (const s of songs) {
  if (!byArtist.has(s.primary_artist_id)) byArtist.set(s.primary_artist_id, []);
  byArtist.get(s.primary_artist_id).push(s);
}
const artistById = new Map(artists.map((a) => [a.artist_id, a]));
const duplicates = [];
for (const [id, list] of byArtist) {
  const groups = new Map();
  for (const s of list) {
    // Versions (ALT, remixes, extended) are deliberate, so compare the exact title.
    const k = (s.title ?? "").toLowerCase().trim();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const albums = g.map((s) => s.album_title ?? "(no album)");
    duplicates.push({
      artist: artistById.get(id)?.artist_name ?? "?",
      title: g[0].title,
      count: g.length,
      sameAlbum: new Set(albums).size < albums.length,
      albums: [...new Set(albums)],
    });
  }
}

// ── Albums ──
const albumFolders = new Map(); // folder -> { artistId, title, songs }
for (const s of songs) {
  const folder = dirname(s.source_path);
  if (!albumFolders.has(folder)) albumFolders.set(folder, { artistId: s.primary_artist_id, title: s.album_title, songs: 0 });
  albumFolders.get(folder).songs++;
}
const noCover = [];
const noCanvas = [];
for (const [folder, a] of albumFolders) {
  const c = coverByFolder.get(folder);
  const who = artistById.get(a.artistId)?.artist_name ?? "?";
  if (!c) noCover.push({ artist: who, album: a.title ?? folder.split("/").pop(), folder });
  else if (!c.canvas_key || c.canvas_checksum !== c.checksum) noCanvas.push({ artist: who, album: a.title ?? folder.split("/").pop() });
}

// ── Artist readiness ──
function artistFolder(name) {
  const root = join(BUSINESS, "LABELS");
  for (const label of readdirSync(root)) {
    for (const kind of ["Artists", "Compilations"]) {
      const dir = join(root, label, kind);
      if (!existsSync(dir)) continue;
      const hit = readdirSync(dir).find((d) => d.toLowerCase() === name.toLowerCase());
      if (hit) return { path: join(dir, hit), label: label.split(" - ")[0] };
    }
  }
  return null;
}
const pages = new Map(
  await Promise.all(
    artists.map(async (a) => [a.slug, (await fetch(`${CDN}/audio/photos/${a.slug}/index.json`, { method: "HEAD" })).ok]),
  ),
);
const readiness = [];
for (const a of artists) {
  const list = byArtist.get(a.artist_id) ?? [];
  if (!list.length) continue;
  const folders = [...new Set(list.map((s) => dirname(s.source_path)))];
  const withCover = folders.filter((f) => coverByFolder.has(f)).length;
  const withCanvas = folders.filter((f) => {
    const c = coverByFolder.get(f);
    return c && c.canvas_key && c.canvas_checksum === c.checksum;
  }).length;
  const f = artistFolder(a.artist_name);
  const photosDir = f && join(f.path, "Photos");
  const photos = photosDir && existsSync(photosDir) ? readdirSync(photosDir).filter((x) => /\.(png|jpe?g|webp)$/i.test(x)).length : 0;
  const pressKit = f && join(f.path, "Press Kit");
  const bio = !!(pressKit && existsSync(pressKit) && readdirSync(pressKit).some((x) => /bio/i.test(x)));
  readiness.push({
    artist: a.artist_name,
    slug: a.slug,
    label: f?.label ?? null,
    genre: a.genre,
    songs: list.length,
    albums: folders.length,
    covers: withCover,
    canvases: withCanvas,
    page: pages.get(a.slug) ?? false,
    roster: roster.has(a.slug),
    bio,
    photos,
  });
}
readiness.sort((x, y) => Number(y.page) - Number(x.page) || y.songs - x.songs);

// ── Report ──
const pageCount = readiness.filter((r) => r.page).length;
console.log(`${artists.length} artists · ${readiness.length} with songs · ${songs.length} songs · ${albumFolders.size} albums`);
console.log(`Artist pages: ${pageCount} · on the roster: ${readiness.filter((r) => r.roster).length}`);
console.log(`Albums without a cover: ${noCover.length} · covers without a Canvas: ${noCanvas.length}`);
console.log(`Titles that look like file names: ${oddTitles.length}`);
console.log(`Repeated titles: ${duplicates.length} (${duplicates.filter((d) => d.sameAlbum).length} inside one album)`);
const ready = readiness.filter((r) => !r.page && r.photos >= 8).sort((x, y) => y.photos - x.photos);
console.log(`Photos already in the folder but no page yet (8+): ${ready.map((r) => `${r.artist} (${r.photos})`).join(", ") || "none"}`);
if (JSON_OUT) {
  const out = join(here, "out/audit.json");
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), readiness, oddTitles, duplicates, noCover, noCanvas }, null, 2));
  console.log(`Wrote ${out}`);
}
