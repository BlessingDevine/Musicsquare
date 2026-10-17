// Renames a song: records the new title in song-titles.json (file path → title)
// and applies it, so a later re-import keeps it too.
//   node scripts/admin/jobs/rename.mjs <song_id> "<New title>" [--apply]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APPLY, args, CATALOG, commit, describe, fail, runScript, songById } from "./common.mjs";

const [id, title] = args;
const newTitle = title?.trim();
if (!newTitle) fail("Type the new title.");
const s = await songById(id);
if (s.title === newTitle) fail("That's already its title.");
console.log(`Song: ${describe(s)}`);
console.log(`New title: ${newTitle}`);
if (!APPLY) process.exit(0);

const file = join(CATALOG, "song-titles.json");
const titles = JSON.parse(readFileSync(file, "utf8"));
titles[s.source_path] = newTitle;
writeFileSync(file, JSON.stringify(titles, null, 2) + "\n");
runScript("titles.mjs");
commit("scripts/catalog/song-titles.json", `Rename "${s.title}" to "${newTitle}"`);
console.log(`\nDone: "${s.title}" is now "${newTitle}" everywhere.`);
