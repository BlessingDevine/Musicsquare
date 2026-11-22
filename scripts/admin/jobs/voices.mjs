// Artist voices: speaks lines in an artist's voice with Voicebox (the free voice studio app on this Mac),
// saves each clip in SQUARE BUSINESS/VOICEOVERS/Artist voices/<Artist>/, then listens back to it
// (transcribes it) and flags any clip whose words don't match what was typed.
//
//   node scripts/admin/jobs/voices.mjs --profile <voice id> --line "<text>" [--line "<text>"]... [--instruct "<how to say it>"]
//
// Voicebox must be open: its engine answers on localhost:17493. A voice made in Admin carries
// "[squaredrum:<artist slug>]" in its Voicebox description, which is how Admin knows whose voice it is.
// server.mjs uses the helpers exported here for the Artist voices panel.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VO_ROOT } from "./voiceover.mjs";

export const VB = process.env.VOICEBOX_URL ?? "http://127.0.0.1:17493";
export const VOICES_ROOT = join(VO_ROOT, "Artist voices");
export const TAG = /\[squaredrum:([a-z0-9-]{1,60})\]/;
export const VB_LANGS = ["en", "fr", "pt", "es", "de", "it", "sw", "ar", "zh", "ja", "ko", "ru", "nl", "tr", "hi"];

/** One request to Voicebox; throws with Voicebox's own message when it says no. */
export async function vb(path, { timeout = 15_000, ...opts } = {}) {
  let r;
  try {
    r = await fetch(VB + path, { ...opts, signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new Error(e.name === "TimeoutError" ? "Voicebox took too long to answer." : "Voicebox isn't running. Press Start Voicebox.");
  }
  const text = await r.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  if (!r.ok) {
    const d = body?.detail;
    throw new Error(`Voicebox: ${typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join("; ") : `error ${r.status}`}`);
  }
  return body;
}

export async function vbUp() {
  try { await vb("/health", { timeout: 2500 }); return true; } catch { return false; }
}

/** Voicebox's own Whisper (turbo) writes down what is said in an audio file. */
export async function transcribe(file, lang = "en") {
  const fd = new FormData();
  fd.append("file", new Blob([readFileSync(file)], { type: "audio/wav" }), basename(file));
  fd.append("language", lang);
  fd.append("model", "turbo");
  return String((await vb("/transcribe", { method: "POST", body: fd, timeout: 600_000 })).text ?? "").trim();
}

// The listener writes "9" where the line says "nine", so small number words count as their digits.
const NUM = Object.fromEntries("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ").map((w, i) => [w, String(i)]));
Object.assign(NUM, { thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100" });
const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  .split(" ").map((w) => NUM[w] ?? w).join(" ");
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** How closely what was heard matches what was typed, 0–1. Compares words, and letters without spaces ("Squaredrum" = "Square drum"). */
export function match(want, heard) {
  const w = norm(want), h = norm(heard);
  if (!w) return 1;
  const byWords = 1 - distance(w.split(" "), h ? h.split(" ") : []) / w.split(" ").length;
  const a = w.replace(/ /g, ""), b = h.replace(/ /g, "");
  const byLetters = 1 - distance([...a], [...b]) / a.length;
  return Math.max(0, Math.min(1, Math.max(byWords, byLetters)));
}

/** A name that is safe as a file or folder name on the Mac. */
export function safe(s, max = 80) {
  return String(s).replace(/[\u0000-\u001f/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, max).trim() || "Untitled";
}

/** The artist name a voice belongs to ("Lea Babi · Kokoro" → "Lea Babi"), or null for voices not made in Admin. */
export function voiceOwner(profile) {
  return TAG.test(profile.description ?? "") ? profile.name.replace(/\s+·\s+.*$/, "") : null;
}

/** Where a voice's clips are saved. */
export function voiceFolder(profile) {
  const owner = voiceOwner(profile);
  return owner ? join(VOICES_ROOT, safe(owner)) : join(VOICES_ROOT, "Other voices", safe(profile.name));
}

/** Which engine and model size Voicebox should use for this voice. */
export function engineFor(profile) {
  if (profile.voice_type === "preset") return { engine: profile.preset_engine ?? profile.default_engine };
  if (profile.voice_type === "designed") return { engine: profile.default_engine ?? "qwen_voice_design" };
  return { engine: profile.default_engine ?? "qwen", model_size: "1.7B" };
}

// --- the job: speak lines and check them ---------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function args() {
  const a = process.argv.slice(2);
  const out = { lines: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--line") out.lines.push(a[++i]);
    else if (a[i] === "--profile") out.profile = a[++i];
    else if (a[i] === "--instruct") out.instruct = a[++i];
  }
  return out;
}

function unused(folder, stem) {
  let to = join(folder, `${stem}.wav`);
  for (let n = 2; existsSync(to); n++) to = join(folder, `${stem} ${n}.wav`);
  return to;
}

async function speak(profile, text, instruct) {
  const lang = profile.language ?? "en";
  const { id } = await vb("/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile_id: profile.id, text, language: lang, ...engineFor(profile), ...(instruct ? { instruct } : {}) }),
    timeout: 60_000,
  });
  const said = { loading_model: "Loading the voice model (the first time can take a few minutes)…", downloading: "Downloading the voice model (first time only)…", generating: "Speaking…" };
  let last = "";
  const until = Date.now() + 20 * 60_000;
  while (Date.now() < until) {
    const g = await vb(`/history/${id}`);
    if (g.status === "completed") return { id, seconds: g.duration };
    if (g.status === "failed" || g.status === "error") throw new Error(g.error || "Voicebox couldn't make this one.");
    if (g.status !== last && said[g.status]) console.log(`   ${said[g.status]}`);
    last = g.status;
    await sleep(2000);
  }
  throw new Error("It took longer than 20 minutes, so I stopped waiting.");
}

async function main() {
  const { profile: pid, lines, instruct } = args();
  if (!pid || !lines.length) throw new Error("Pick a voice and type at least one line.");
  if (!(await vbUp())) throw new Error("Voicebox isn't running. Press Start Voicebox, wait for it to say Ready, then try again.");
  const profile = await vb(`/profiles/${pid}`);
  const folder = voiceFolder(profile);
  mkdirSync(folder, { recursive: true });
  const day = new Date().toLocaleDateString("en-CA");
  console.log(`Voice: ${profile.name}  ·  ${lines.length} clip${lines.length > 1 ? "s" : ""}  ·  saving to ${folder.replace(/^.*\/SQUARE BUSINESS\//, "")}\n`);
  let made = 0, check = 0, failed = 0;
  for (const [n, text] of lines.entries()) {
    console.log(`${n + 1}/${lines.length}  "${text.length > 80 ? text.slice(0, 77) + "…" : text}"`);
    try {
      const { id, seconds } = await speak(profile, text, instruct);
      const audio = Buffer.from(await (await fetch(`${VB}/audio/${id}`, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
      const to = unused(folder, `${day} ${safe(text.split(/\s+/).slice(0, 7).join(" "), 60)}`);
      writeFileSync(to, audio);
      made++;
      console.log("   Listening back to check the words…");
      const heard = await transcribe(to, profile.language ?? "en");
      const score = Math.round(match(text, heard) * 100);
      if (score >= 85) console.log(`   ✓ ${seconds?.toFixed(1) ?? "?"} s · words match ${score}% · saved "${basename(to)}"`);
      else {
        check++;
        console.log(`   ⚠ ${seconds?.toFixed(1) ?? "?"} s · words match only ${score}%. Listen before using it.\n     Heard: "${heard.slice(0, 200)}"\n     Saved "${basename(to)}"`);
      }
    } catch (e) {
      failed++;
      console.log(`   ✗ ${e.message}`);
    }
  }
  console.log(`\n${made} made${check ? `, ${check} to check by ear` : ""}${failed ? `, ${failed} failed` : ""}.`);
  if (check) console.log("A low match usually means the voice's sample has the wrong words, or the line has names the listener spells differently.");
  if (failed) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
