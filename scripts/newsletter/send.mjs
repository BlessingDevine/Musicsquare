// Sends a built Drumroll (drumroll.mjs) through Resend.
//
//   node scripts/newsletter/send.mjs                        what would go out this Friday (changes nothing)
//   node scripts/newsletter/send.mjs --test you@example.com send a test copy to one address, now
//   node scripts/newsletter/send.mjs --schedule             schedule it for Friday 9:00 AM Pacific to the whole list
//   node scripts/newsletter/send.mjs --update               replace the scheduled broadcast with a rebuilt issue (same time)
//   add --date 2026-10-30 for another Friday's issue
//   add --at 13:00 to schedule (or reschedule) at another Pacific time that day, e.g. a late issue
//
// Needs two lines in .env.local, added by Robert (never by Claude):
//   RESEND_API_KEY=re_…            a Resend API key with full access (Resend → API Keys)
//   RESEND_SEGMENT_ID=…            the list to send to (Resend → Audience → Segments → the Drumroll list's ID)
// The unsubscribe link ({{{RESEND_UNSUBSCRIBE_URL}}}) is filled in by Resend for each reader.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "../admin/jobs/common.mjs"; // loads .env.local

const OUT_ROOT = "/Users/robertsimenya/Desktop/SQUARE MUSIC PROJECTS/SQUARE BUSINESS/Drumroll";
const args = process.argv.slice(2);
const flag = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const DATE = flag("--date") ?? nextFriday();
const TEST = flag("--test");
const SCHEDULE = args.includes("--schedule");
const UPDATE = args.includes("--update");
const AT = flag("--at") ?? "09:00";
if (!/^\d{2}:\d{2}$/.test(AT)) throw new Error("--at must look like 13:00 (Pacific time).");

function nextFriday() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return d.toLocaleDateString("en-CA");
}

/** AT (9:00 AM unless --at) in Los Angeles on DATE, as an exact moment (PDT or PST, whichever applies that day). */
function nineAmPacific(date) {
  for (const offset of ["-07:00", "-08:00"]) {
    const t = new Date(`${date}T${AT}:00${offset}`);
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(t);
    if (Number(hour) === Number(AT.slice(0, 2))) return t;
  }
  throw new Error("Couldn't work out 9 AM Pacific for " + date);
}

const dir = join(OUT_ROOT, DATE);
const meta = join(dir, "send.json");
if (!existsSync(meta)) throw new Error(`No Drumroll built for ${DATE} yet: run node scripts/newsletter/drumroll.mjs first.`);
const send = JSON.parse(readFileSync(meta, "utf8"));
const html = readFileSync(send.html, "utf8");
const when = nineAmPacific(DATE);

console.log(`Drumroll ${DATE}\n  From:     ${send.from}\n  Subject:  ${send.subject}\n  Preview:  ${send.preview}\n  Sends at: ${when.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "full", timeStyle: "short" })} Pacific`);
if (send.broadcast) console.log(`  Already scheduled in Resend (broadcast ${send.broadcast}). Scheduling again would send it twice.`);
if (!TEST && !SCHEDULE && !UPDATE) {
  console.log("\nNothing sent. Use --test <address> for a test copy, or --schedule for Friday.");
  process.exit(0);
}

const KEY = process.env.RESEND_API_KEY;
if (!KEY) throw new Error("RESEND_API_KEY isn't in .env.local yet (see the top of this file).");
const api = async (path, body, method = "POST") => {
  const r = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend said ${r.status}: ${j.message ?? JSON.stringify(j)}`);
  return j;
};

// Replies land at fans@gosquare.app, where squaredrum.com/api/inbound drops auto-replies, takes "unsubscribe"
// replies off the list and forwards the rest to fans@squaredrum.com.
const REPLY_TO = "fans@gosquare.app";

if (TEST) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(TEST)) throw new Error("That test address doesn't look right.");
  // A test is a one-off email: the unsubscribe placeholder only works in broadcasts, so it points at the privacy page.
  const r = await api("/emails", { from: send.from, reply_to: REPLY_TO, to: [TEST], subject: `[Test] ${send.subject}`, html: html.replaceAll("{{{RESEND_UNSUBSCRIBE_URL}}}", "https://www.squaredrum.com/privacy") });
  console.log(`\nTest sent to ${TEST} (${r.id}).`);
}

if (SCHEDULE) {
  if (send.broadcast) throw new Error("This issue is already scheduled; cancel it in Resend first if you need to change it.");
  const SEGMENT = process.env.RESEND_SEGMENT_ID;
  if (!SEGMENT) throw new Error("RESEND_SEGMENT_ID isn't in .env.local yet (see the top of this file).");
  if (when.getTime() < Date.now()) throw new Error(`${AT} Pacific has already passed for this issue: pick a later time with --at.`);
  const r = await api("/broadcasts", {
    segment_id: SEGMENT,
    from: send.from,
    reply_to: REPLY_TO,
    subject: send.subject,
    html,
    name: `Drumroll ${DATE}`,
    send: true,
    scheduled_at: when.toISOString(),
  });
  send.broadcast = r.id;
  writeFileSync(meta, JSON.stringify(send, null, 2) + "\n");
  console.log(`\nScheduled for ${AT} Pacific on ${DATE} (broadcast ${r.id}). You can see or cancel it in Resend → Broadcasts.`);
}

if (UPDATE) {
  // Resend can't edit a scheduled broadcast ("Only draft broadcasts can be edited"), so the old one is cancelled
  // (deleting a scheduled broadcast cancels its delivery) and the rebuilt issue is scheduled for the same moment.
  // Cancel first, so the list can never get it twice.
  if (!send.broadcast) throw new Error("This issue isn't scheduled yet; use --schedule.");
  if (when.getTime() < Date.now()) throw new Error("This issue has already gone out.");
  const SEGMENT = process.env.RESEND_SEGMENT_ID;
  if (!SEGMENT) throw new Error("RESEND_SEGMENT_ID isn't in .env.local yet (see the top of this file).");
  const old = send.broadcast;
  await api(`/broadcasts/${old}`, undefined, "DELETE");
  delete send.broadcast;
  writeFileSync(meta, JSON.stringify(send, null, 2) + "\n");
  const r = await api("/broadcasts", { segment_id: SEGMENT, from: send.from, reply_to: REPLY_TO, subject: send.subject, html, name: `Drumroll ${DATE}`, send: true, scheduled_at: when.toISOString() });
  send.broadcast = r.id;
  writeFileSync(meta, JSON.stringify(send, null, 2) + "\n");
  console.log(`\nReplaced: cancelled ${old}, scheduled the new version as ${r.id} for ${AT} Pacific on ${DATE}.`);
}
