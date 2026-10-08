// Moves one label from IMPRINT/ to LABELS/ and updates the catalogue in the
// same step, so nothing on air changes and nothing has to be re-imported.
//
//   node scripts/catalog/move-label.mjs riot-temple            show the plan
//   node scripts/catalog/move-label.mjs riot-temple --apply    do it
//
// IMPRINT/<LABEL - GENRE>/ARISTS/<ARTIST>/MUSIC/<album>/…  →  LABELS/<Label - Genre>/Artists/<Artist>/Songs/<Album title>/…
//   IMAGES → Photos, VIDEO(S) → Videos, DOCUMENTS → Lyrics; label Cover/Logo → Artwork/.
//   An artist whose albums sit straight in the artist folder (no MUSIC) gets them under Songs/.
//   Album folders are named after the album (album-titles.json, or ALBUMS below).
//   Artist folders take the LABELS spelling (RENAMES below, else the existing LABELS folder).
//
// The catalogue follows: songs.source_path and album_title, album_covers.folder_path,
// renamed artists' names and slugs, and the keys in album-titles / song-titles /
// media-links.json. Held artists stay held. Every move is logged to
// SQUARE BUSINESS/LABELS - move log.tsv (old path, new path) so it can be undone.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { BUSINESS, DEFAULT_ROOT, LABELS_ROOT, displayName, parseImprint, parsePath, slugify } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const [SLUG] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!SLUG) throw new Error("usage: node scripts/catalog/move-label.mjs <label-slug> [--apply]");

// IMPRINT artist folder → LABELS artist folder, where the spelling differs (Robert, Oct 2026).
const RENAMES = { "DUSK CANON": "Dusk Cannon", "LUCID ARROW": "Lucid Arrows", "J CRUZZ": "J Cruz" };
// Album folder (path under IMPRINT/) → album title, where album-titles.json has none.
const ALBUMS = {
  "RIOT TEMPLE - ROCK/ARISTS/KNOX HAVOC/MUSIC/Knox 2": "I'm Fine, This Is Great",
  "RIOT TEMPLE - ROCK/ARISTS/KNOX HAVOC/MUSIC/Knox 3": "Legend By Morning",
};
const ASSETS = { MUSIC: "Songs", IMAGES: "Photos", VIDEO: "Videos", VIDEOS: "Videos", DOCUMENTS: "Lyrics" };
const AUDIO = /\.(mp3|wav|m4a)$/i;
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const json = (f) => join(here, f);
const readJson = (f) => JSON.parse(readFileSync(json(f), "utf8"));
const ALBUM_TITLES = readJson("album-titles.json");
const fileName = (s) => s.replace(/\//g, "-").replace(/:/g, ".");

const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((e) => !e.name.startsWith("."));
const srcLabel = dirs(DEFAULT_ROOT).find((e) => e.isDirectory() && parseImprint(e.name).slug === SLUG)?.name;
const dstLabel = dirs(LABELS_ROOT).find((e) => e.isDirectory() && parseImprint(e.name).slug === SLUG)?.name;
if (!srcLabel) throw new Error(`No IMPRINT folder for ${SLUG}`);
if (!dstLabel) throw new Error(`No LABELS folder for ${SLUG}`);
const SRC = join(DEFAULT_ROOT, srcLabel);
const DST = join(LABELS_ROOT, dstLabel);
const rel = (p) => p.slice(DEFAULT_ROOT.length + 1);
const relNew = (p) => p.slice(BUSINESS.length + 1);

const moves = []; // { from, to } — files
const albumMoves = []; // { from, to } — album folders (rel paths), for album_covers + titles
const artistRenames = []; // { from: slug, name }

function plan(from, to) {
  for (const e of dirs(from)) {
    const f = join(from, e.name);
    if (e.isDirectory()) plan(f, join(to, e.name));
    else moves.push({ from: f, to: join(to, e.name) });
  }
}

/** An album folder inside Songs/: name it after the album. */
function planAlbum(from, toSongs) {
  const r = rel(from);
  const title = ALBUMS[r] ?? ALBUM_TITLES[r] ?? null;
  const name = title ? fileName(title) : from.split("/").at(-1);
  const to = join(toSongs, name);
  albumMoves.push({ from: r, to: relNew(to), title });
  plan(from, to);
}

const existingLabelsArtists = dirs(join(DST, "Artists")).filter((e) => e.isDirectory()).map((e) => e.name);
const artistsDir = dirs(SRC).find((e) => /^ART?ISTS$/i.test(e.name))?.name;

for (const e of dirs(SRC)) {
  const p = join(SRC, e.name);
  if (e.isFile()) {
    // Label art at the top of the IMPRINT folder → Artwork/.
    const stem = e.name.replace(/\.[^.]+$/, "").toLowerCase();
    const ext = e.name.slice(e.name.lastIndexOf("."));
    const to = ["cover", "logo"].includes(stem) ? join(DST, "Artwork", stem[0].toUpperCase() + stem.slice(1) + ext) : join(DST, "Archives", e.name);
    moves.push({ from: p, to });
  }
}
if (artistsDir) {
  for (const a of dirs(join(SRC, artistsDir)).filter((e) => e.isDirectory())) {
    const from = join(SRC, artistsDir, a.name);
    const target = RENAMES[a.name] ?? existingLabelsArtists.find((n) => key(n) === key(a.name)) ?? displayName(a.name);
    const to = join(DST, "Artists", target);
    const oldSlug = slugify(displayName(a.name));
    if (slugify(target) !== oldSlug) artistRenames.push({ from: oldSlug, name: target });
    const kids = dirs(from);
    const hasMusic = kids.some((k) => k.name.toUpperCase() === "MUSIC");
    for (const k of kids) {
      const kp = join(from, k.name);
      if (k.isDirectory() && k.name.toUpperCase() === "MUSIC") {
        for (const m of dirs(kp)) {
          if (m.isDirectory()) planAlbum(join(kp, m.name), join(to, "Songs"));
          else moves.push({ from: join(kp, m.name), to: join(to, "Songs", m.name) });
        }
      } else if (k.isDirectory() && ASSETS[k.name.toUpperCase()]) {
        plan(kp, join(to, ASSETS[k.name.toUpperCase()]));
      } else if (k.isDirectory() && !hasMusic) {
        planAlbum(kp, join(to, "Songs")); // albums straight in the artist folder (Throne Attic)
      } else if (k.isDirectory()) {
        plan(kp, join(to, k.name));
      } else {
        moves.push({ from: kp, to: join(to, k.name) });
      }
    }
  }
}
const leftovers = dirs(SRC).filter((e) => e.isDirectory() && e.name !== artistsDir);
if (leftovers.length) throw new Error(`Not handled yet (compilations?): ${leftovers.map((e) => e.name).join(", ")}`);

// Safety: nothing may land on an existing file, and no two files may share a target.
const clash = moves.filter((m) => existsSync(m.to));
const dupTargets = moves.filter((m, i) => moves.findIndex((x) => x.to === m.to) !== i);
if (clash.length || dupTargets.length) {
  for (const m of [...clash, ...dupTargets].slice(0, 20)) console.log("CLASH", relNew(m.to));
  throw new Error("Stopping: targets already exist or collide. Nothing was moved.");
}

// Catalogue rows that follow.
async function all(q) {
  const rows = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q().range(f, f + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const songs = await all(() => db.from("songs").select("song_id, source_path, title, album_title, primary_artist_id").like("source_path", `${srcLabel}/%`).order("song_id"));
const byPath = new Map(songs.map((s) => [s.source_path, s]));
const held = new Set((await all(() => db.from("artists").select("artist_id").eq("status", "paused").order("artist_id"))).map((a) => a.artist_id));
// Files renamed on disk before the catalogue caught up (the held Riot Temple
// artists, Oct 2026): match them through the rename log, else by folder +
// cleaned-up name ("05-LANDR-Dont Wait Up-Balanced-High" ≈ "Don't Wait Up").
const renamed = new Map();
const RENAME_LOG = join(BUSINESS, "Riot Temple - rename log.tsv");
if (existsSync(RENAME_LOG)) {
  for (const line of readFileSync(RENAME_LOG, "utf8").split("\n").slice(1)) {
    const [o, n] = line.split("\t");
    if (o && n) renamed.set(rel(n), rel(o));
  }
}
const stemKey = (p) => key(p.split("/").at(-1).replace(/\.[^.]+$/, "").replace(/^(\d+\s*-\s*)?LANDR\s*-\s*/i, "").replace(/-(Open|Balanced|Warm|Bright)-(High|Medium|Low)$/i, "").replace(/_\d+$/, ""));
// Folder case may have changed too (DUSK 2 → Dusk 2).
const folderKey = (p) => p.split("/").slice(0, -1).join("/").toLowerCase();
const byFolderStem = new Map(songs.map((s) => [`${folderKey(s.source_path)}|${stemKey(s.source_path)}`, s]));
const findSong = (fromRel) =>
  byPath.get(fromRel) ?? byPath.get(renamed.get(fromRel)) ?? byFolderStem.get(`${folderKey(fromRel)}|${stemKey(fromRel)}`);
const songUpdates = [];
for (const m of moves) {
  const s = AUDIO.test(m.from) ? findSong(rel(m.from)) : null;
  if (!s) continue;
  const parsed = parsePath(LABELS_ROOT, m.to);
  const patch = { source_path: relNew(m.to) };
  if (parsed && parsed.album !== s.album_title) patch.album_title = parsed.album;
  // Held artists' titles were never imported cleanly; their files now carry the real names.
  if (parsed && held.has(s.primary_artist_id) && parsed.title !== s.title) patch.title = parsed.title;
  songUpdates.push({ id: s.song_id, patch, old: s });
}
const matched = new Set(songUpdates.map((u) => u.id));
const unmatchedSongs = songs.filter((s) => !matched.has(s.song_id));

console.log(`${srcLabel}  →  LABELS/${dstLabel}`);
console.log(`${moves.length} files (${moves.filter((m) => AUDIO.test(m.from)).length} audio), ${albumMoves.length} album folders`);
for (const a of albumMoves.filter((a) => a.from.split("/").at(-1) !== a.to.split("/").at(-1))) console.log(`  album  ${a.from.split("/").slice(-1)[0]}  →  ${a.to.split("/").at(-1)}`);
for (const r of artistRenames) console.log(`  artist ${r.from}  →  ${r.name} (${slugify(r.name)})`);
console.log(`catalogue: ${songUpdates.length} songs follow (${songUpdates.filter((u) => u.patch.album_title).length} album names, ${songUpdates.filter((u) => u.patch.title).length} titles)`);
if (unmatchedSongs.length) {
  console.log(`  ${unmatchedSongs.length} catalogue songs have no file here (left as they are):`);
  for (const s of unmatchedSongs.slice(0, 10)) console.log(`    ${s.source_path}`);
}
if (!APPLY) {
  console.log("\nNothing changed. Run with --apply to move.");
  process.exit(0);
}

// --- apply ------------------------------------------------------------------
const LOG = join(BUSINESS, "LABELS - move log.tsv");
if (!existsSync(LOG)) writeFileSync(LOG, "old path\tnew path\n");
for (const m of moves) {
  mkdirSync(dirname(m.to), { recursive: true });
  renameSync(m.from, m.to);
  appendFileSync(LOG, `${m.from}\t${m.to}\n`);
}
console.log(`moved ${moves.length} files`);

for (const r of artistRenames) {
  const { error } = await db.from("artists").update({ artist_name: r.name, slug: slugify(r.name) }).eq("slug", r.from);
  if (error) throw new Error(`artist ${r.from}: ${error.message}`);
}
for (const u of songUpdates) {
  const { error } = await db.from("songs").update(u.patch).eq("song_id", u.id);
  if (error) throw new Error(`song ${u.old.source_path}: ${error.message}`);
}
for (const a of albumMoves) {
  const { error } = await db.from("album_covers").update({ folder_path: a.to }).eq("folder_path", a.from);
  if (error) throw new Error(`cover ${a.from}: ${error.message}`);
}
console.log(`catalogue updated: ${songUpdates.length} songs, ${artistRenames.length} artists, album covers re-pointed`);

// Title lists keyed by path follow the files; album titles are now the folder names.
const movedRel = new Map(moves.map((m) => [rel(m.from), relNew(m.to)]));
for (const f of ["song-titles.json", "media-links.json"]) {
  const data = readJson(f);
  const out = Object.fromEntries(Object.entries(data).map(([k, v]) => [movedRel.get(k) ?? k, v]));
  writeFileSync(json(f), JSON.stringify(out, null, 2) + "\n");
}
const titles = readJson("album-titles.json");
for (const a of albumMoves) delete titles[a.from];
writeFileSync(json("album-titles.json"), JSON.stringify(titles, null, 2) + "\n");

// What's left behind in IMPRINT should be empty folders only.
const left = [];
(function walk(p) {
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(p, e.name));
    else if (e.name !== ".DS_Store") left.push(join(p, e.name));
  }
})(SRC);
console.log(left.length ? `${left.length} files still in IMPRINT/${srcLabel}: ${left.slice(0, 5).join(", ")}` : `done. IMPRINT/${srcLabel} holds only empty folders now.`);
