// Puts a live song's streaming copy back in LABELS when its file has gone missing
// from the folder (Robert, Oct 2026: "if it is missing from the folder, always
// replace it with the streaming copy"). The copy is saved under the song's catalogue
// title ("Dark Thoughts (Alternate Version).mp3"), the song is re-pointed there, and
// the move goes in "LABELS - move log.tsv". Archived songs are left alone: most are
// duplicates whose files were cleared on purpose.
//
//   node scripts/catalog/restore-masters.mjs           list what's missing
//   node scripts/catalog/restore-masters.mjs --apply   restore them
//
// The streaming copy is the levelled MP3 (-14 LUFS), not the original master.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { BUSINESS, abs } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const songs = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from("songs")
    .select("song_id, title, source_path, release_status, song_files(storage_key)")
    .neq("release_status", "archived").order("source_path").range(from, from + 999);
  if (error) throw error;
  songs.push(...data);
  if (data.length < 1000) break;
}

const missing = songs.filter((s) => s.source_path && !existsSync(abs(s.source_path)));
console.log(`${songs.length} live songs · ${missing.length} with no file in LABELS`);
for (const s of missing) {
  const key = s.song_files?.[0]?.storage_key;
  const to = `${dirname(s.source_path)}/${s.title.replace(/[/:]/g, ".")}${extname(s.source_path) || ".mp3"}`;
  console.log(`  ${s.source_path.split("/").slice(-2).join("/")}  →  ${to.split("/").pop()}${key ? "" : "  (no streaming copy!)"}`);
  if (!APPLY || !key) continue;
  if (existsSync(abs(to))) { console.log("    skipped: a file with that name is already there"); continue; }
  const res = await fetch(`${process.env.NEXT_PUBLIC_AUDIO_BASE_URL}/${key}`);
  if (!res.ok) { console.log(`    download failed (${res.status})`); continue; }
  mkdirSync(dirname(abs(to)), { recursive: true });
  writeFileSync(abs(to), Buffer.from(await res.arrayBuffer()));
  const { error } = await db.from("songs").update({ source_path: to }).eq("song_id", s.song_id);
  if (error) throw error;
  appendFileSync(join(BUSINESS, "LABELS - move log.tsv"), `${abs(s.source_path)} (missing)\t${abs(to)} (streaming copy ${key})\n`);
  console.log("    restored");
}
if (!APPLY && missing.length) console.log("\nRun with --apply to restore them.");
