// Shared bits for the admin jobs: the catalogue client and a git commit for
// the JSON files the jobs edit (so Robert only has to press Push).

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const CATALOG = join(REPO, "scripts/catalog");
process.loadEnvFile(join(REPO, ".env.local"));
export const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

export const APPLY = process.argv.includes("--apply");
export const args = process.argv.slice(2).filter((a) => a !== "--apply");

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}

/** Runs another catalogue script, its output shown as part of this job's. */
export function runScript(file, ...argv) {
  const r = spawnSync(process.execPath, [join(CATALOG, file), ...argv], { stdio: "inherit", cwd: REPO });
  if (r.status !== 0) fail(`${file} stopped with an error.`);
}

/** Commits one edited file in the radio repo; GitHub Desktop then shows it ready to push. */
export function commit(file, message) {
  spawnSync("git", ["-C", REPO, "add", file]);
  const r = spawnSync("git", ["-C", REPO, "commit", "-q", "-m", message, "--", file], { encoding: "utf8" });
  console.log(r.status === 0 ? "Saved in the radio project. Push it in GitHub Desktop when convenient." : "Nothing new to save in the radio project.");
}

export async function songById(id) {
  if (!/^[0-9a-f-]{36}$/.test(id ?? "")) fail("That isn't a song id.");
  const { data, error } = await db
    .from("songs")
    .select("song_id, song_code, title, album_title, release_status, source_path, artists!songs_primary_artist_id_fkey(artist_name)")
    .eq("song_id", id)
    .maybeSingle();
  if (error) fail(error.message);
  if (!data) fail("No song with that id.");
  return data;
}

export const describe = (s) => `${s.title} — ${s.artists?.artist_name ?? "label compilation"}, ${s.album_title ?? "no album"} (${s.song_code})`;
