// New Music Friday: puts everything the importer left waiting (`ready`) on air at once — Musicsquare Radio,
// GoSquare and squaredrum.com — then rebuilds the channels so the radio plays it. Run by launchd every
// Friday at 9 AM (scripts/catalog/release-friday.plist), the moment Drumroll goes out.
//
//   node scripts/catalog/release.mjs                      what's waiting for Friday (changes nothing)
//   node scripts/catalog/release.mjs --apply              release it all now
//   node scripts/catalog/release.mjs --apply --only "Ngibheke Kahle"   just one album or artist, early
//
// Each release is logged in "SQUARE BUSINESS/Friday releases log.tsv" (date, song code, artist, album, title).

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../admin/jobs/common.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1]?.toLowerCase() : null;
const LOG = "/Users/robertsimenya/Desktop/SQUARE MUSIC PROJECTS/SQUARE BUSINESS/Friday releases log.tsv";

const { data, error } = await db
  .from("songs")
  .select("song_id, song_code, title, album_title, artists!songs_primary_artist_id_fkey(artist_name)")
  .eq("release_status", "ready");
if (error) throw new Error(error.message);

const name = (s) => s.artists?.artist_name ?? "Label compilation";
const songs = data.filter((s) => !ONLY || [name(s), s.album_title ?? ""].some((v) => v.toLowerCase() === ONLY));
const albums = new Map();
for (const s of songs) {
  const k = `${name(s)} — ${s.album_title ?? "Singles"}`;
  albums.set(k, (albums.get(k) ?? 0) + 1);
}

if (!songs.length) {
  console.log(ONLY ? `Nothing waiting matches "${args[args.indexOf("--only") + 1]}".` : "Nothing is waiting for Friday.");
  process.exit(0);
}
const n = (k) => `${k} song${k === 1 ? "" : "s"}`;
console.log(`${n(songs.length)} waiting for Friday:`);
for (const [k, c] of albums) console.log(`  ${k} (${n(c)})`);
if (!APPLY) {
  console.log("\nNothing changed. Add --apply to release them now.");
  process.exit(0);
}

// Release in batches (PostgREST URLs get long with hundreds of ids).
for (let i = 0; i < songs.length; i += 200) {
  const ids = songs.slice(i, i + 200).map((s) => s.song_id);
  const { error: e } = await db.from("songs").update({ release_status: "released_radio" }).in("song_id", ids).eq("release_status", "ready");
  if (e) throw new Error(e.message);
}
const day = new Date().toLocaleDateString("en-CA"); // local date, e.g. 2026-10-23
if (!existsSync(LOG)) writeFileSync(LOG, "released\tsong\tartist\talbum\ttitle\n");
appendFileSync(LOG, songs.map((s) => [day, s.song_code, name(s), s.album_title ?? "", s.title].join("\t")).join("\n") + "\n");
console.log(`\nReleased ${n(songs.length)}. Rebuilding the channels…`);

const r = spawnSync(process.execPath, [join(here, "ingest.mjs"), "--channels"], { stdio: "inherit" });
if (r.status !== 0) throw new Error("Channel rebuild failed — run: node scripts/catalog/ingest.mjs --channels");
console.log("Done: on air everywhere. squaredrum.com refreshes within 5 minutes.");
