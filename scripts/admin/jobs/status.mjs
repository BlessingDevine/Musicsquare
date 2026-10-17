// Archives a song (hidden everywhere, nothing deleted), brings one back, or
// switches on an alternate version that came in as a draft. The radio
// channels are rebuilt afterwards so the schedule matches.
//   node scripts/admin/jobs/status.mjs <song_id> archived|released_radio [--apply]

import { APPLY, args, describe, fail, runScript, songById, db } from "./common.mjs";

const [id, to] = args;
const WORDS = { archived: "archived (hidden everywhere)", released_radio: "live on all platforms", draft: "a draft (not live)" };
if (!["archived", "released_radio"].includes(to)) fail("Choose archive or make live.");
const s = await songById(id);
console.log(`Song: ${describe(s)}`);
console.log(`Now: ${WORDS[s.release_status] ?? s.release_status}`);
if (s.release_status === to) fail(`It's already ${WORDS[to]}.`);
console.log(`Will be: ${WORDS[to]}`);
if (!APPLY) process.exit(0);

const { error } = await db.from("songs").update({ release_status: to }).eq("song_id", id);
if (error) fail(error.message);
console.log("\nSaved. Rebuilding the radio channels…");
runScript("ingest.mjs", "--channels");
console.log(`\nDone: "${s.title}" is ${WORDS[to]}. The sites update within five minutes.`);
