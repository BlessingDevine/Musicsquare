// Marks songs explicit from a Finder tag, so squaredrum.com (and later the
// apps) can show the "E" badge.
//
//   node scripts/catalog/explicit.mjs            report what would change
//   node scripts/catalog/explicit.mjs --apply    write it to the catalogue
//   node scripts/catalog/explicit.mjs --suggest  list songs whose lyrics have strong language
//
// Robert tags a song file, or a whole album or artist folder, with a Finder
// tag named "Explicit" (right-click → Tags…). Every song under a tagged folder
// counts. Removing the tag makes the songs clean again on the next --apply.
// Only 'clean' ⇄ 'explicit' are changed; 'radio_edit' and 'instrumental' are
// left alone. Tags are read from the xattr com.apple.metadata:_kMDItemUserTags.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { abs } from "./scan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const args = process.argv.slice(2);
const TAG = "explicit";

async function all(query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// Finder tags are a binary plist in an xattr; plutil turns it into JSON.
// Each tag reads "Name" or "Name\n<colour number>".
const tagCache = new Map();
function tagsOf(path) {
  if (tagCache.has(path)) return tagCache.get(path);
  let tags = [];
  try {
    const hex = execFileSync("xattr", ["-px", "com.apple.metadata:_kMDItemUserTags", path], { stdio: ["ignore", "pipe", "ignore"] }).toString().replace(/\s/g, "");
    const json = execFileSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: Buffer.from(hex, "hex") }).toString();
    tags = JSON.parse(json).map((t) => t.split("\n")[0].trim().toLowerCase());
  } catch {
    // No tags.
  }
  tagCache.set(path, tags);
  return tags;
}

/** Tagged itself, or inside a tagged folder (up to the IMPRINT or LABELS folder). */
function isTagged(rel) {
  const parts = rel.split("/");
  for (let i = parts.length; i > 0; i--) {
    if (tagsOf(abs(parts.slice(0, i).join("/"))).includes(TAG)) return true;
  }
  return false;
}

const songs = await all(() =>
  db.from("songs").select("song_id, song_code, title, source_path, clean_explicit").in("clean_explicit", ["clean", "explicit"]).order("song_id"),
);

if (args.includes("--suggest")) {
  // A starting point for review, not a verdict: Robert decides what gets tagged.
  const WORDS = /\b(fuck\w*|shit\w*|bitch\w*|ass(hole)?s?|dick|pussy|nigg\w+|motherfuck\w*|cunt|hoe?s?|damn)\b/gi;
  const lyrics = await all(() => db.from("song_lyrics").select("song_id, lyrics").order("song_id"));
  const byId = new Map(songs.map((s) => [s.song_id, s]));
  const hits = lyrics
    .map((l) => ({ s: byId.get(l.song_id), words: [...new Set((l.lyrics ?? "").match(WORDS)?.map((w) => w.toLowerCase()) ?? [])] }))
    .filter((h) => h.s && h.words.length && h.s.clean_explicit !== "explicit");
  console.log(`${lyrics.length} songs have lyrics; ${hits.length} contain strong language:\n`);
  for (const h of hits) console.log(`${h.s.source_path}\n    ${h.words.join(", ")}`);
  process.exit(0);
}

const changes = [];
let missing = 0;
for (const s of songs) {
  if (!existsSync(abs(s.source_path))) {
    missing++;
    continue;
  }
  const want = isTagged(s.source_path) ? "explicit" : "clean";
  if (want !== s.clean_explicit) changes.push({ ...s, want });
}

for (const c of changes) console.log(`${c.want === "explicit" ? "E" : "clean"}  ${c.source_path}`);
console.log(`\n${changes.length} songs to change (${changes.filter((c) => c.want === "explicit").length} → explicit); ${missing} skipped (file not on this Mac)`);

if (args.includes("--apply") && changes.length) {
  for (const want of ["explicit", "clean"]) {
    const ids = changes.filter((c) => c.want === want).map((c) => c.song_id);
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await db.from("songs").update({ clean_explicit: want }).in("song_id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
  }
  console.log("Applied. squaredrum.com shows the badges within 5 minutes.");
} else if (changes.length) {
  console.log("Nothing written. Run with --apply to save.");
}
