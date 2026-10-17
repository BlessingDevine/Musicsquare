// Before an import: lists the music files in one label's folders that aren't
// in the catalogue yet, and flags names that need a second look.
//   node scripts/admin/jobs/newfiles.mjs <label-slug>

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { scan } from "../../catalog/scan.mjs";
import { args, db, fail } from "./common.mjs";

const [slug] = args;
const { entries } = await scan();
const mine = entries.filter((e) => e.imprint.slug === slug);
if (!mine.length) fail("No music found in that label's folders.");

const have = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("songs").select("source_path").range(from, from + 999);
  if (error) fail(error.message);
  data.forEach((r) => have.add(r.source_path.normalize("NFC")));
  if (data.length < 1000) break;
}
const fresh = mine.filter((e) => !have.has(e.sourcePath.normalize("NFC")));

// A file whose audio is already in the catalogue (a copy, or a song that moved) is skipped by the import.
const sums = new Map();
for (const e of fresh) if (!e.cloudOnly) sums.set(e.sourcePath, createHash("sha256").update(readFileSync(e.file)).digest("hex"));
const known = new Map();
if (sums.size) {
  const { data, error } = await db
    .from("song_files")
    .select("checksum, songs(title, artists!songs_primary_artist_id_fkey(artist_name))")
    .in("checksum", [...new Set(sums.values())]);
  if (error) fail(error.message);
  for (const r of data) known.set(r.checksum, `${r.songs?.title} by ${r.songs?.artists?.artist_name ?? "a label compilation"}`);
}
const copies = fresh.filter((e) => known.has(sums.get(e.sourcePath)));
const brandNew = fresh.filter((e) => !copies.includes(e));

console.log(`${mine.length} songs in ${mine[0].imprint.name}'s folders; ${brandNew.length} new to import.\n`);
for (const e of brandNew) {
  const flags = [];
  if (/\bYT\b/.test(e.sourcePath)) flags.push("YouTube file? (YT in the name)");
  if (/\(ALT\)|alternate/i.test(e.sourcePath)) flags.push("alternate version, comes in switched off");
  if (e.cloudOnly) flags.push("still in Google Drive only, will download");
  console.log(`  ${e.artist?.name ?? e.imprint.name} · ${e.album ?? "no album"} · ${e.title}${flags.length ? "   ⚠ " + flags.join("; ") : ""}`);
}
if (!brandNew.length) console.log("Nothing new to import.");
if (copies.length) {
  console.log(`\nAlready in the catalogue under another file (the import skips these):`);
  for (const e of copies) console.log(`  ${e.sourcePath.split("/").slice(-1)[0]} in ${e.artist?.name ?? e.imprint.name}'s folder = ${known.get(sums.get(e.sourcePath))}`);
}
