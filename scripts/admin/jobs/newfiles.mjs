// Before an import: lists the music files in one label's folders that aren't
// in the catalogue yet, and flags names that need a second look.
//   node scripts/admin/jobs/newfiles.mjs <label-slug>

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
console.log(`${mine.length} songs in ${mine[0].imprint.name}'s folders; ${fresh.length} not in the catalogue yet.\n`);
for (const e of fresh) {
  const flags = [];
  if (/\bYT\b/.test(e.sourcePath)) flags.push("YouTube file? (YT in the name)");
  if (/\(ALT\)|alternate/i.test(e.sourcePath)) flags.push("alternate version, comes in switched off");
  if (e.cloudOnly) flags.push("still in Google Drive only, will download");
  console.log(`  ${e.artist?.name ?? e.imprint.name} · ${e.album ?? "no album"} · ${e.title}${flags.length ? "   ⚠ " + flags.join("; ") : ""}`);
}
if (fresh.length) console.log("\nA song that was moved or renamed shows here too; the import recognises it and doesn't add it twice.");
else console.log("Nothing new to import.");
