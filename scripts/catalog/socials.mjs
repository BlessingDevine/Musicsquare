// Artist Instagram handles: socials.json (artist slug → handle, no @) into the
// artists.instagram column (migration 20261016000000_artist_instagram.sql).
// squaredrum.com and GoSquare show an Instagram button for each one.
//
//   node scripts/catalog/socials.mjs            show what would change
//   node scripts/catalog/socials.mjs --upload   save it
//
// Taking an artist out of socials.json clears their handle.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(join(here, "../../.env.local"));
const UPLOAD = process.argv.includes("--upload");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const wanted = JSON.parse(readFileSync(join(here, "socials.json"), "utf8"));
const { data: artists, error } = await db.from("artists").select("artist_id, artist_name, slug, instagram");
if (error) throw new Error(`${error.message} (has migration 20261016000000_artist_instagram.sql been run?)`);

const unknown = Object.keys(wanted).filter((slug) => !artists.some((a) => a.slug === slug));
if (unknown.length) throw new Error(`No artist with slug: ${unknown.join(", ")}`);

let changed = 0;
for (const a of artists) {
  const handle = wanted[a.slug]?.replace(/^@/, "").toLowerCase() ?? null;
  if (handle === a.instagram) continue;
  changed++;
  console.log(`${a.artist_name}: ${a.instagram ? "@" + a.instagram : "—"} → ${handle ? "@" + handle : "—"}`);
  if (!UPLOAD) continue;
  const { error: e } = await db.from("artists").update({ instagram: handle }).eq("artist_id", a.artist_id);
  if (e) throw new Error(`${a.artist_name}: ${e.message}`);
}
console.log(`${changed} ${changed === 1 ? "artist" : "artists"} ${UPLOAD ? "updated" : "would change (add --upload to save)"}`);
