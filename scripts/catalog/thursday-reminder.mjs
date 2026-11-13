// New Music Friday check: a Mac notification AND an email to Robert, saying what goes live on Friday at 9 AM
// (or warning that nothing is waiting yet, while there's still time to import something).
//   node scripts/catalog/thursday-reminder.mjs           Thursday 10 AM (thursday-reminder.plist): always reports;
//                                                         builds Friday's Drumroll draft when music is waiting
//   node scripts/catalog/thursday-reminder.mjs --early   Wednesday 10 AM (wednesday-check.plist): early warning,
//                                                         only speaks up when nothing is waiting yet
// The email goes to ALERT_EMAIL in .env.local through Resend (the Drumroll key); if that fails, the notification
// still shows and the log says why.

import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../admin/jobs/common.mjs";

const EARLY = process.argv.includes("--early");

const { data, error } = await db
  .from("songs")
  .select("album_title, artists!songs_primary_artist_id_fkey(artist_name)")
  .eq("release_status", "ready");
if (error) throw new Error(error.message);

const albums = [...new Set(data.map((s) => `${s.artists?.artist_name ?? "Label"} – ${s.album_title ?? "Singles"}`))];
if (EARLY && albums.length) {
  console.log(`${new Date().toLocaleString()}: (Wednesday) ${albums.length} album(s) waiting for Friday, all good.`);
  process.exit(0);
}

// Thursday with music waiting: build Friday's Drumroll draft first, so it's ready to check when the reminder appears.
let drumroll = false;
if (!EARLY && albums.length) {
  const builder = join(dirname(fileURLToPath(import.meta.url)), "../newsletter/drumroll.mjs");
  drumroll = spawnSync(process.execPath, [builder], { stdio: "inherit" }).status === 0;
}

const title = albums.length ? "New Music Friday is tomorrow" : EARLY ? "Nothing for New Music Friday yet" : "New Music Friday is tomorrow, and nothing is waiting";
const message = albums.length
  ? `${albums.length === 1 ? "1 album goes" : `${albums.length} albums go`} live at 9 AM: ${albums.join(", ")}. ${drumroll ? "Drumroll's draft is in your Drumroll folder: check it, then schedule it." : "Build Drumroll and check it before it goes out."}`
  : EARLY
    ? "Friday is in two days and no album is waiting for release. Import this week's music by Thursday so it goes live at 9 AM with Drumroll."
    : "No album is waiting for 9 AM tomorrow, so Drumroll has nothing to announce. Import something today, or ask Claude for a news issue instead.";

// AppleScript strings: escape backslashes and quotes.
const q = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
execFileSync("osascript", ["-e", `display notification ${q(message)} with title ${q(title)} subtitle "Squaredrum" sound name "Glass"`]);
console.log(`${new Date().toLocaleString()}: ${EARLY ? "(Wednesday) " : ""}${message}`);

// The same words by email, so it isn't missed when the Mac notification scrolls away.
const to = process.env.ALERT_EMAIL;
const key = process.env.RESEND_API_KEY;
if (!to || !key) {
  console.log("  Email skipped: ALERT_EMAIL or RESEND_API_KEY isn't in .env.local.");
} else {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const stamp = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Squaredrum alerts <alerts@gosquare.app>",
      to: [to],
      subject: title,
      text: `${message}\n\n(Automatic check from the Mac, ${stamp} Pacific.)`,
      html: `<p style="font:16px/1.5 Helvetica,Arial,sans-serif;color:#0b0b0c;">${esc(message)}</p><p style="font:12px Helvetica,Arial,sans-serif;color:#6f6c64;">Automatic check from the Mac, ${esc(stamp)} Pacific.</p>`,
    }),
  }).catch((e) => ({ ok: false, statusText: e.message }));
  console.log(r.ok ? `  Emailed ${to}.` : `  Email failed: ${r.status ?? ""} ${r.statusText}`);
}
