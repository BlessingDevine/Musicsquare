// Takes an artist's music off air everywhere (Musicsquare Radio, GoSquare,
// squaredrum.com) without deleting anything, or puts it back.
//
//   node scripts/catalog/hold.mjs "Knox Havoc" "Dusk Canon"            hold
//   node scripts/catalog/hold.mjs --release "Knox Havoc"               release
//   node scripts/catalog/hold.mjs --list                               what's held
//
// Holding sets the artist to `paused` and their released songs to `draft`.
// Every site reads only active artists and released songs (Row Level
// Security), so they disappear at once; the channels are rebuilt afterwards
// so the radio stops scheduling them. The importer never overrides either
// status, so held songs stay held through later imports. New files added to a
// held artist's folders do import as released, though: run hold again after
// such an import. Releasing restores `released_radio` and `active`.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
  if (!process.env[key]) throw new Error(`${key} is missing from .env.local`);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

const args = process.argv.slice(2);
const release = args.includes("--release");
const names = args.filter((a) => !a.startsWith("--"));

if (args.includes("--list")) {
  const held = must(await db.from("artists").select("artist_name, artist_id").eq("status", "paused").order("artist_name"));
  for (const a of held) {
    const { count } = await db.from("songs").select("song_id", { count: "exact", head: true }).eq("primary_artist_id", a.artist_id).eq("release_status", "draft");
    console.log(`${a.artist_name}: ${count} songs held`);
  }
  if (!held.length) console.log("No artists are held.");
  process.exit(0);
}
if (!names.length) throw new Error('Name at least one artist, e.g. node scripts/catalog/hold.mjs "Knox Havoc"');

for (const name of names) {
  const [artist] = must(await db.from("artists").select("artist_id, artist_name, status").ilike("artist_name", name));
  if (!artist) throw new Error(`No artist called "${name}"`);
  // Only flip between the two states this tool owns; ALT takes stay drafts.
  const from = release ? ["draft"] : ["released_radio", "released_app", "released_public"];
  const to = release ? "released_radio" : "draft";
  let q = db.from("songs").update({ release_status: to }).eq("primary_artist_id", artist.artist_id).in("release_status", from);
  if (release) q = q.neq("version_type", "alt");
  const songs = must(await q.select("song_id"));
  must(await db.from("artists").update({ status: release ? "active" : "paused" }).eq("artist_id", artist.artist_id));
  console.log(`${artist.artist_name}: ${songs.length} songs ${release ? "released" : "held"} (artist ${release ? "active" : "paused"})`);
}

console.log("\nRebuilding channels…");
const r = spawnSync(process.execPath, [join(here, "ingest.mjs"), "--channels"], { stdio: "inherit" });
process.exit(r.status ?? 1);
