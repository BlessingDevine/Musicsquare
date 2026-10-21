// Thursday reminder for New Music Friday: a Mac notification listing what goes live tomorrow at 9 AM
// (or warning that nothing is waiting yet). Run by launchd every Thursday at 10 AM (thursday-reminder.plist).
//   node scripts/catalog/thursday-reminder.mjs

import { execFileSync } from "node:child_process";
import { db } from "../admin/jobs/common.mjs";

const { data, error } = await db
  .from("songs")
  .select("album_title, artists!songs_primary_artist_id_fkey(artist_name)")
  .eq("release_status", "ready");
if (error) throw new Error(error.message);

const albums = [...new Set(data.map((s) => `${s.artists?.artist_name ?? "Label"} – ${s.album_title ?? "Singles"}`))];
const title = "New Music Friday is tomorrow";
const message = albums.length
  ? `${albums.length === 1 ? "1 album goes" : `${albums.length} albums go`} live at 9 AM: ${albums.join(", ")}. Check Drumroll before it goes out.`
  : "Nothing is waiting for Friday yet. Import this week's release, then check Drumroll.";

// AppleScript strings: escape backslashes and quotes.
const q = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
execFileSync("osascript", ["-e", `display notification ${q(message)} with title ${q(title)} subtitle "Squaredrum" sound name "Glass"`]);
console.log(`${new Date().toLocaleString()}: ${message}`);
