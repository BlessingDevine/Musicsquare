// Applies scripts/catalog/album-titles.json to songs already in the catalogue:
// every song whose file sits directly in a listed folder gets that album title.
// New imports pick the titles up by themselves (scan.mjs). Safe to re-run.
//
//   node scripts/catalog/titles.mjs

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ALBUM_TITLES, SONG_TITLES } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("songs").select("song_id, source_path, album_title, title").order("song_code").range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data);
  if (data.length < 1000) break;
}

let changed = 0;
for (const [folder, title] of Object.entries(ALBUM_TITLES)) {
  const ids = rows
    .filter((r) => r.source_path.slice(0, r.source_path.lastIndexOf("/")) === folder && r.album_title !== title)
    .map((r) => r.song_id);
  if (!ids.length) continue;
  const { error } = await db.from("songs").update({ album_title: title }).in("song_id", ids);
  if (error) throw new Error(`${folder}: ${error.message}`);
  changed += ids.length;
  console.log(`  ${String(ids.length).padStart(3)} songs → ${title}`);
}
// Song names (song-titles.json), keyed by the song's own file path.
let renamed = 0;
const byPath = new Map(rows.map((r) => [r.source_path, r]));
for (const [path, title] of Object.entries(SONG_TITLES)) {
  const row = byPath.get(path);
  if (!row || row.title === title) continue;
  const { error } = await db.from("songs").update({ title }).eq("song_id", row.song_id);
  if (error) throw new Error(`${path}: ${error.message}`);
  renamed++;
}
console.log(`${changed} songs given album titles · ${renamed} songs renamed`);
