// Sets or clears an artist's Instagram handle (socials.json) and uploads it.
//   node scripts/admin/jobs/instagram.mjs <artist-slug> <handle or "-"> [--apply]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APPLY, args, CATALOG, commit, db, fail, runScript } from "./common.mjs";

const [slug, raw] = args;
const handle = raw === "-" ? null : raw?.replace(/^@/, "").trim().toLowerCase();
if (handle !== null && !/^[a-z0-9._]{1,30}$/.test(handle ?? "")) fail("An Instagram handle is letters, numbers, dots and underscores only.");
const { data: artist, error } = await db.from("artists").select("artist_name, instagram").eq("slug", slug).maybeSingle();
if (error) fail(error.message);
if (!artist) fail("No artist with that name.");
console.log(`${artist.artist_name}: ${artist.instagram ? "@" + artist.instagram : "no handle"} → ${handle ? "@" + handle : "no handle"}`);
if ((artist.instagram ?? null) === handle) fail("No change.");
if (!APPLY) process.exit(0);

const file = join(CATALOG, "socials.json");
const socials = JSON.parse(readFileSync(file, "utf8"));
if (handle) socials[slug] = handle;
else delete socials[slug];
writeFileSync(file, JSON.stringify(socials, null, 2) + "\n");
runScript("socials.mjs", "--upload");
commit("scripts/catalog/socials.json", `Instagram: ${artist.artist_name} ${handle ? "@" + handle : "removed"}`);
console.log("\nDone. The Instagram button is updated on all three platforms.");
