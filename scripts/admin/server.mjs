// Squaredrum Admin: buttons for the everyday catalogue jobs, so they don't need
// the Terminal. A small web server on this Mac only (127.0.0.1); it runs the
// scripts in scripts/catalog (and scripts/admin/jobs) and shows their output.
//
//   node scripts/admin/server.mjs        then open http://localhost:4747
//
// Started by the "Squaredrum Admin" app on the Desktop (scripts/admin/make-app.sh).
// Only one job runs at a time. Every job that changes something is previewed
// first; the page asks before running it for real. Requests must carry the
// token printed into the page, so no other website can start a job.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, parse, posix, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { LABELS_ROOT, parseImprint } from "../catalog/scan.mjs";
import { KINDS, VO_INBOX, voiceFiles } from "./jobs/voiceover.mjs";
import { TAG, VB_LANGS, VOICES_ROOT, safe, transcribe, vb, vbUp, voiceFolder, voiceOwner } from "./jobs/voices.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
const PORT = Number(process.env.ADMIN_PORT ?? 4747);
const TOKEN = randomBytes(24).toString("hex");
process.loadEnvFile(join(REPO, ".env.local"));
process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? "/usr/bin:/bin"}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

// --- what the page may run ----------------------------------------------------

const SLUG = /^[a-z0-9-]{1,60}$/;
const UUID = /^[0-9a-f-]{36}$/;
const LANGS = ["en", "sw", "sn", "ln", "fr", "pt", "es", "yo"];
const cat = (f) => join(REPO, "scripts/catalog", f);
const job = (f) => join(HERE, "jobs", f);

/**
 * Each job turns the form's values into one or more script runs. `apply` is
 * false for the preview and true for the real run. Anything not checked here
 * never reaches a script.
 */
const JOBS = {
  newfiles: ({ label }) => [[job("newfiles.mjs"), need(label, SLUG)]],
  // Covers for the imported label only: a full covers run reads every album in the catalogue.
  import: ({ label }, apply) => {
    const slug = need(label, SLUG);
    if (!apply) return [[job("newfiles.mjs"), slug]];
    const folder = labelFolder(slug);
    return [[cat("ingest.mjs"), "--only", slug], [cat("covers.mjs"), ...(folder ? ["--only", folder] : []), "--upload"]];
  },
  // An album name looks at that album's folder only; empty checks every album, label and single cover.
  covers: async ({ album }, apply) => {
    const upload = apply ? ["--upload"] : [];
    if (!album?.trim()) return [[cat("covers.mjs"), ...upload]];
    return (await albumFolders(need(album.trim(), /^[^\n]{1,120}$/))).map((f) => [cat("covers.mjs"), "--only", f, ...upload]);
  },
  lyrics: (_, apply) => [[cat("media.mjs"), ...(apply ? ["--upload"] : [])]],
  sync: ({ who, lang }, apply) => [
    [cat("sync-lyrics.mjs"), "--only", need(who, /^[^\n]{1,80}$/), "--lang", LANGS.includes(lang) ? lang : "en", ...(apply ? ["--upload"] : [])],
  ],
  photos: ({ artist }, apply) => [[cat("photos.mjs"), need(artist, SLUG), ...(apply ? ["--upload"] : [])]],
  replace: async ({ song }, apply) => {
    const s = await songRow(need(song, UUID));
    if (!apply) return [["echo", `Will upload the file now in the folder for:\n  ${s.title} (${s.song_code})\n  ${s.source_path}\nLikes, playlists and lyrics stay.`]];
    return [[cat("replace.mjs"), s.source_path]];
  },
  rename: ({ song, title }, apply) => [[job("rename.mjs"), need(song, UUID), need(title, /^[^\n]{1,120}$/), ...(apply ? ["--apply"] : [])]],
  status: ({ song, to }, apply) => [[job("status.mjs"), need(song, UUID), need(to, /^(archived|released_radio)$/), ...(apply ? ["--apply"] : [])]],
  instagram: ({ artist, handle }, apply) => [[job("instagram.mjs"), need(artist, SLUG), handle?.trim() ? handle.trim() : "-", ...(apply ? ["--apply"] : [])]],
  hold: async ({ artist, action }, apply) => {
    if (action === "list") return [[cat("hold.mjs"), "--list"]];
    const name = (await artistRow(need(artist, SLUG))).artist_name;
    if (!apply) return [["echo", action === "release" ? `Will put ${name}'s music back on air everywhere.` : `Will take ${name}'s music off air everywhere (nothing is deleted).`]];
    return [[cat("hold.mjs"), ...(action === "release" ? ["--release"] : []), name]];
  },
  explicit: (_, apply) => [[cat("explicit.mjs"), ...(apply ? ["--apply"] : [])]],
  playlists: (_, apply) => [[cat("playlists.mjs"), ...(apply ? ["--upload"] : [])]],
  canvas: (_, apply) => [[cat("canvas.mjs"), ...(apply ? ["--upload"] : [])]],
  audit: () => [[cat("audit.mjs")]],
  drumroll: () => [[join(REPO, "scripts/newsletter/drumroll.mjs")]],
  drumrollsend: ({ test }, apply) =>
    test?.trim()
      ? [[join(REPO, "scripts/newsletter/send.mjs"), ...(apply ? ["--test", need(test.trim(), /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/)] : [])]]
      : [[join(REPO, "scripts/newsletter/send.mjs"), ...(apply ? ["--schedule"] : [])]],
  voiceover: ({ vosrc, vofiles, vodest, vofmt, volevel, vostrength }, apply) => [
    [
      job("voiceover.mjs"),
      "--src", voFolder(vosrc),
      ...(Array.isArray(vofiles) ? vofiles.slice(0, 300).flatMap((f) => ["--file", need(String(f), /^[^\n\/]{1,255}$/)]) : []),
      "--dest", voFolder(vodest),
      "--format", need(vofmt ?? "wav", /^(wav|mp3|both)$/),
      "--level", need(volevel ?? "level", /^(level|keep)$/),
      "--strength", String(Math.min(100, Math.max(0, Math.round(Number(need(String(vostrength ?? "100"), /^\d{1,3}$/)))))),
      ...(apply ? ["--apply"] : []),
    ],
  ],
  // Artist voices: speak lines in a Voicebox voice. Nothing to preview; it only adds new clips.
  voices: ({ vbprofile, vblines, vbinstruct }) => {
    const lines = (Array.isArray(vblines) ? vblines : []).map((l) => String(l).trim()).filter(Boolean);
    if (!lines.length) throw new Error("Type at least one line.");
    if (lines.length > 50) throw new Error("50 lines at a time at most.");
    return [[
      job("voices.mjs"),
      "--profile", need(vbprofile, UUID),
      ...lines.flatMap((l) => ["--line", need(l, /^[^\n]{1,1000}$/)]),
      ...(vbinstruct?.trim() ? ["--instruct", need(vbinstruct.trim(), /^[^\n]{1,300}$/)] : []),
    ]];
  },
  friday: ({ which }, apply) => [
    [cat("release.mjs"), ...(which?.trim() ? ["--only", need(which.trim(), /^[^\n]{1,120}$/)] : []), ...(apply ? ["--apply"] : [])],
  ],
};

function need(value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error("Something in the form is missing or not allowed.");
  return value;
}

async function songRow(id) {
  const { data, error } = await db.from("songs").select("song_id, song_code, title, source_path").eq("song_id", id).maybeSingle();
  if (error || !data) throw new Error("Song not found.");
  return data;
}
/** The LABELS folder for a label slug ("piano-nation" → "LABELS/Piano Nation - Afro-house, Amapiano"), or null. */
function labelFolder(slug) {
  const name = readdirSync(LABELS_ROOT).find((n) => !n.startsWith(".") && parseImprint(n).slug === slug);
  return name ? join(LABELS_ROOT, name) : null;
}
/** Every folder holding songs of the album with this name (any capitals). */
async function albumFolders(album) {
  const { data, error } = await db.from("songs").select("source_path").ilike("album_title", album.replace(/[%_\\]/g, "\\$&"));
  if (error) throw new Error(error.message);
  const folders = [...new Set(data.map((r) => posix.dirname(r.source_path)))];
  if (!folders.length) throw new Error(`No album called "${album}" in the catalogue.`);
  return folders;
}
async function artistRow(slug) {
  const { data, error } = await db.from("artists").select("artist_name").eq("slug", slug).maybeSingle();
  if (error || !data) throw new Error("Artist not found.");
  return data;
}

// --- voiceovers: folders, uploads and auditions for "Clean voiceovers" ------------

// The page may only use the To clean folder and folders picked in this Mac's own folder dialog.
const voPicked = new Set([resolve(VO_INBOX)]);
const AUDITION = join(tmpdir(), "squaredrum-vo-audition");
let auditioning = false;

function voFolder(src) {
  const p = resolve(typeof src === "string" && src ? src : VO_INBOX);
  if (!voPicked.has(p)) throw new Error("Choose the folder again.");
  if (p === resolve(VO_INBOX)) mkdirSync(p, { recursive: true });
  if (!existsSync(p)) throw new Error("That folder is gone. Choose it again.");
  return p;
}

/** Shows the Mac's folder dialog; resolves to the chosen path, or null if cancelled. */
function pickFolder(prompt = "Choose a folder of voiceovers to clean", start = null) {
  return new Promise((done) => {
    const from = start && existsSync(start) ? ` default location (POSIX file ${JSON.stringify(start)})` : "";
    const script = ["activate", `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)}${from})`];
    const child = spawn("osascript", script.flatMap((l) => ["-e", l]));
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.on("close", (code) => {
      if (code !== 0 || !out.trim()) return done(null);
      const p = resolve(out.trim());
      voPicked.add(p);
      done(p);
    });
  });
}

function probe(file) {
  return new Promise((done) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.on("close", () => done(Number(out.trim()) || 0));
  });
}

async function voList(src) {
  const folder = voFolder(src);
  const names = voiceFiles(folder).slice(0, 300);
  const files = await Promise.all(names.map(async (name) => ({ name, seconds: await probe(join(folder, name)) })));
  return { folder, inbox: folder === resolve(VO_INBOX), files };
}

/** Saves an uploaded file into To clean under a safe, unused name. */
async function voUpload(req, rawName) {
  const { name: stem, ext } = parse(basename(String(rawName ?? "")).replace(/[\u0000-\u001f/\\:]/g, "").replace(/^\.+/, ""));
  if (!stem || !KINDS.has(ext.toLowerCase())) throw new Error("Only audio or video files can be uploaded.");
  const size = Number(req.headers["content-length"] ?? 0);
  if (size > 4 * 1024 ** 3) throw new Error("That file is over 4 GB.");
  mkdirSync(VO_INBOX, { recursive: true });
  const short = stem.slice(0, 150);
  let to = join(VO_INBOX, `${short}${ext}`);
  for (let n = 2; existsSync(to); n++) to = join(VO_INBOX, `${short} ${n}${ext}`);
  try {
    await pipeline(req, createWriteStream(to, { flags: "wx" }));
  } catch (e) {
    rmSync(to, { force: true });
    throw e;
  }
  return basename(to);
}

/** Cleans the first 30 seconds of one file into orig.wav and voice.wav for listening. */
function voAudition(src, file) {
  const folder = voFolder(src);
  const name = basename(String(file ?? ""));
  if (!voiceFiles(folder).includes(name)) throw new Error("Pick a file from the list.");
  if (auditioning) throw new Error("An audition is already being made.");
  if (current && !current.done) throw new Error("Wait for the running job to finish.");
  auditioning = true;
  rmSync(AUDITION, { recursive: true, force: true });
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [job("voiceover.mjs"), "--src", folder, "--audition", name, "--out", AUDITION], { cwd: REPO, env: process.env });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    child.on("close", (code) => {
      auditioning = false;
      code === 0 ? done({ ok: true }) : failed(new Error(strip(out).trim().split("\n").slice(-3).join(" ") || "The audition failed."));
    });
  });
}

// --- artist voices: Voicebox voices, and new voices from a recording or a ready-made voice ---
// Voicebox (the voice studio app) does the work; these only ask it things on this Mac.

let vbCaps = null; // what this Voicebox version can do, read once from its own API description
async function vbStatus() {
  if (!(await vbUp())) return { up: false };
  if (!vbCaps) {
    try {
      const spec = await vb("/openapi.json");
      const pattern = spec.components?.schemas?.GenerationRequest?.properties?.engine?.anyOf?.find((a) => a.pattern)?.pattern ?? "";
      vbCaps = { design: pattern.includes("qwen_voice_design") };
    } catch { vbCaps = { design: false }; }
  }
  const voices = (await vb("/profiles")).map((p) => ({
    id: p.id, name: p.name, artist: (p.description ?? "").match(TAG)?.[1] ?? null, owner: voiceOwner(p),
    type: p.voice_type ?? "cloned", engine: p.preset_engine ?? p.default_engine ?? null, preset: p.preset_voice_id ?? null,
    lang: p.language ?? "en", samples: p.sample_count ?? 0, made: p.generation_count ?? 0,
  })).sort((a, b) => (!!b.artist - !!a.artist) || a.name.localeCompare(b.name));
  return { up: true, ...vbCaps, voices };
}

let vbStarting = null;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const vbAppOpen = () => spawnSync("pgrep", ["-x", "voicebox"]).status === 0;
/**
 * Opens Voicebox in the background and waits (up to 2 minutes) for its engine to answer. If the
 * Voicebox window is open but its engine isn't answering (it happens), Voicebox is closed and opened again.
 */
function vbStart() {
  vbStarting ??= (async () => {
    if (await vbUp()) return { up: true };
    if (vbAppOpen()) {
      for (let i = 0; i < 5 && !(await vbUp()); i++) await pause(2000); // it may just be starting
      if (await vbUp()) return { up: true };
      spawnSync("pkill", ["-TERM", "-x", "voicebox"]);
      for (let i = 0; i < 40 && vbAppOpen(); i++) await pause(500);
      await pause(1500); // opening it while it is still closing does nothing
    }
    spawn("open", ["-g", "-a", "Voicebox"], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) {
      if (await vbUp()) return { up: true };
      if (i % 5 === 4 && !vbAppOpen()) spawn("open", ["-g", "-a", "Voicebox"], { stdio: "ignore" }); // the open didn't take: try again
      await pause(2000);
    }
    throw new Error("Voicebox didn't start. Open it from Applications and check it says it's ready.");
  })().finally(() => (vbStarting = null));
  return vbStarting;
}

function ffmpeg(argv) {
  return new Promise((done, failed) => {
    const child = spawn("ffmpeg", argv);
    let err = "";
    child.stderr.on("data", (b) => (err += b));
    child.on("close", (code) => (code === 0 ? done() : failed(new Error(`Couldn't read that recording. ${err.trim().split("\n").pop() ?? ""}`))));
  });
}

const VB_TMP = join(tmpdir(), "squaredrum-voices");
/** Saves an uploaded recording as the artist's reference clip (up to 30 s, mono WAV), then writes down what is said in it. */
async function vbSample(req, url) {
  const artist = (await artistRow(need(url.searchParams.get("artist"), SLUG))).artist_name;
  const lang = VB_LANGS.includes(url.searchParams.get("lang")) ? url.searchParams.get("lang") : "en";
  const { name: stem, ext } = parse(basename(String(url.searchParams.get("name") ?? "")).replace(/[\u0000-\u001f/\\:]/g, "").replace(/^\.+/, ""));
  if (!stem || !KINDS.has(ext.toLowerCase())) throw new Error("Only audio or video files can be used.");
  if (Number(req.headers["content-length"] ?? 0) > 1024 ** 3) throw new Error("That file is over 1 GB.");
  mkdirSync(VB_TMP, { recursive: true });
  const tmp = join(VB_TMP, `${randomBytes(6).toString("hex")}${ext}`);
  try {
    await pipeline(req, createWriteStream(tmp));
    const total = await probe(tmp);
    if (total < 5) throw new Error("That recording is under 5 seconds. Use 10–30 seconds of clear speech.");
    const from = Math.max(0, Math.min(Number(url.searchParams.get("start")) || 0, total - 5));
    const seconds = Math.min(30, total - from);
    const dir = join(VOICES_ROOT, safe(artist), "Reference");
    mkdirSync(dir, { recursive: true });
    let to = join(dir, `${safe(stem, 100)}.wav`);
    for (let n = 2; existsSync(to); n++) to = join(dir, `${safe(stem, 100)} ${n}.wav`);
    await ffmpeg(["-v", "error", "-y", "-ss", String(from), "-t", String(seconds), "-i", tmp, "-vn", "-ac", "1", "-ar", "24000", to]);
    const text = await transcribe(to, lang);
    return { ref: relative(VOICES_ROOT, to), seconds: Math.round(seconds * 10) / 10, total: Math.round(total), from, text };
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** A file under Artist voices, from a path the page sent back; anything outside it is refused. */
function vbFile(rel) {
  const p = resolve(VOICES_ROOT, String(rel ?? ""));
  if (!p.startsWith(resolve(VOICES_ROOT) + sep) || extname(p).toLowerCase() !== ".wav" || !existsSync(p)) throw new Error("That clip isn't there any more.");
  return p;
}

const PRESET_ENGINES = ["kokoro", "qwen_custom_voice"];
async function vbPresets(engine) {
  if (!PRESET_ENGINES.includes(engine)) throw new Error("Unknown engine.");
  return (await vb(`/profiles/presets/${engine}`)).voices ?? [];
}

/** Makes a new Voicebox voice for an artist: from their reference clip, a ready-made voice, or a description. */
async function vbCreate({ artist: slug, kind, ref, text, lang, engine, voice, design }) {
  const artist = (await artistRow(need(slug, SLUG))).artist_name;
  const language = VB_LANGS.includes(lang) ? lang : "en";
  const taken = new Set((await vb("/profiles")).map((p) => p.name));
  const label = kind === "clone" ? "" : kind === "preset" ? ` · ${need(voice, /^[A-Za-z0-9_.-]{1,60}$/).replace(/_/g, " ")}` : " · described";
  let name = `${artist}${label}`;
  for (let n = 2; taken.has(name); n++) name = kind === "clone" ? `${artist} · recording ${n}` : `${artist}${label} ${n}`;
  const base = { name, language, description: `Squaredrum artist voice [squaredrum:${slug}]` };
  const make = (extra) => vb("/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...base, ...extra }) });

  if (kind === "clone") {
    const file = vbFile(ref);
    const words = need(String(text ?? "").trim(), /^[\s\S]{3,3000}$/);
    const p = await make({ voice_type: "cloned" });
    try {
      const fd = new FormData();
      fd.append("file", new Blob([readFileSync(file)], { type: "audio/wav" }), basename(file));
      fd.append("reference_text", words);
      await vb(`/profiles/${p.id}/samples`, { method: "POST", body: fd, timeout: 120_000 });
    } catch (e) {
      await vb(`/profiles/${p.id}`, { method: "DELETE" }).catch(() => {}); // the empty voice we just made
      throw e;
    }
    return { id: p.id, name };
  }
  if (kind === "preset") {
    if (!PRESET_ENGINES.includes(engine)) throw new Error("Pick Kokoro or Qwen CustomVoice.");
    if (!(await vbPresets(engine)).some((v) => v.voice_id === voice)) throw new Error("Pick a voice from the list.");
    const p = await make({ voice_type: "preset", preset_engine: engine, preset_voice_id: voice });
    return { id: p.id, name };
  }
  if (kind === "design") {
    if (!vbCaps?.design) throw new Error("This version of Voicebox can't make a voice from a description yet. Update Voicebox.");
    const p = await make({ voice_type: "designed", design_prompt: need(String(design ?? "").trim(), /^[^\n]{10,500}$/) });
    return { id: p.id, name };
  }
  throw new Error("Choose how to make the voice.");
}

/** The latest clips saved for a voice (newest first). */
async function vbClips(pid) {
  const folder = voiceFolder(await vb(`/profiles/${need(pid, UUID)}`));
  if (!existsSync(folder)) return { folder: relative(VOICES_ROOT, folder), clips: [] };
  const names = readdirSync(folder).filter((n) => n.toLowerCase().endsWith(".wav") && !n.startsWith("."))
    .map((n) => ({ n, t: statSync(join(folder, n)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 20);
  const clips = await Promise.all(names.map(async ({ n, t }) => ({ name: n, path: relative(VOICES_ROOT, join(folder, n)), at: new Date(t).toISOString(), seconds: await probe(join(folder, n)) })));
  return { folder: relative(VOICES_ROOT, folder), clips };
}

// --- the one running job --------------------------------------------------------

let current = null; // { id, name, apply, lines: string[], done, ok, child }

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r(?!\n)/g, "\n");

async function start(name, form, apply) {
  if (current && !current.done) throw new Error("Another job is still running. Wait for it to finish.");
  const build = JOBS[name];
  if (!build) throw new Error("Unknown job.");
  const steps = await build(form ?? {}, !!apply);
  current = { id: randomBytes(6).toString("hex"), name, apply: !!apply, lines: [], done: false, ok: false, child: null };
  const run = current;
  (async () => {
    for (const [file, ...argv] of steps) {
      const ok = await new Promise((resolve) => {
        const child = file === "echo" ? null : spawn(process.execPath, [file, ...argv], { cwd: REPO, env: process.env });
        if (!child) {
          run.lines.push(...argv.join(" ").split("\n"));
          return resolve(true);
        }
        run.child = child;
        let partial = "";
        const take = (buf) => {
          const text = partial + strip(buf.toString());
          const parts = text.split("\n");
          partial = parts.pop();
          run.lines.push(...parts);
        };
        child.stdout.on("data", take);
        child.stderr.on("data", take);
        child.on("close", (code) => {
          if (partial) run.lines.push(partial);
          resolve(code === 0);
        });
      });
      if (!ok) {
        run.done = true;
        return;
      }
    }
    run.ok = true;
    run.done = true;
  })().finally(() => remember(run));
  return run.id;
}

// --- run history (kept on this Mac, for the Overview) ---------------------------

const HISTORY = join(HERE, ".history.json");
let history = [];
try { history = JSON.parse(readFileSync(HISTORY, "utf8")); } catch {}
function remember(run) {
  history.unshift({ name: run.name, apply: run.apply, ok: run.ok, at: new Date().toISOString(), lines: run.lines.length });
  history = history.slice(0, 300);
  try { writeFileSync(HISTORY, JSON.stringify(history)); } catch {}
}

// --- overview: read-only numbers for the home screen ------------------------------

const RELEASE_LOG = join(LABELS_ROOT, "..", "Friday releases log.tsv");

async function count(status) {
  const { count: n, error } = await db.from("songs").select("song_id", { count: "exact", head: true }).eq("release_status", status);
  if (error) throw new Error(error.message);
  return n ?? 0;
}

async function overview() {
  const [live, ready, archived, draft, artists, waiting] = await Promise.all([
    count("released_radio"), count("ready"), count("archived"), count("draft"),
    db.from("artists").select("artist_name, status"),
    db.from("songs").select("album_title, artists!songs_primary_artist_id_fkey(artist_name)").eq("release_status", "ready").limit(5000),
  ]);
  if (artists.error) throw new Error(artists.error.message);
  if (waiting.error) throw new Error(waiting.error.message);
  const albums = new Map();
  for (const s of waiting.data) {
    const key = `${s.album_title ?? "Singles"}\u0000${s.artists?.artist_name ?? ""}`;
    albums.set(key, (albums.get(key) ?? 0) + 1);
  }
  // Songs released per day, from the release log (date, song, artist, album, title).
  const days = {};
  const recent = [];
  if (existsSync(RELEASE_LOG)) {
    const rows = readFileSync(RELEASE_LOG, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
    for (const [date, , artist, album] of rows) if (/^\d{4}-\d{2}-\d{2}$/.test(date)) days[date] = (days[date] ?? 0) + 1;
    const seen = new Set();
    for (const [date, , artist, album] of rows.reverse()) {
      const key = `${album}\u0000${artist}`;
      if (!album || seen.has(key)) continue;
      seen.add(key);
      recent.push({ date, artist, album, songs: rows.filter((r) => r[3] === album && r[2] === artist).length });
      if (recent.length === 8) break;
    }
  }
  return {
    songs: { live, ready, archived, draft },
    artists: { onAir: artists.data.filter((a) => a.status === "active").length, held: artists.data.filter((a) => a.status === "paused").map((a) => a.artist_name).sort() },
    waiting: [...albums].map(([k, n]) => ({ album: k.split("\u0000")[0], artist: k.split("\u0000")[1], songs: n })).sort((a, b) => b.songs - a.songs),
    days,
    recent,
    history: history.slice(0, 120),
    running: current && !current.done ? { name: current.name, apply: current.apply } : null,
  };
}

// --- social: PostFast, read only ---------------------------------------------------
// Only GET requests to PostFast: accounts, posts, and published-post metrics. Nothing here can create,
// change or delete a post. The key (POSTFAST_API_KEY in .env.local) belongs to one PostFast workspace.

const PF = "https://api.postfa.st";
let socialCache = null; // { at, data } — PostFast is asked at most every 5 minutes

async function pf(path) {
  const r = await fetch(PF + path, { headers: { "pf-api-key": process.env.POSTFAST_API_KEY } });
  if (!r.ok) throw new Error(`PostFast said ${r.status}${r.status === 401 || r.status === 403 ? " (check POSTFAST_API_KEY)" : ""}`);
  return r.json();
}

async function social(fresh) {
  if (!process.env.POSTFAST_API_KEY) return { configured: false };
  if (!fresh && socialCache && Date.now() - socialCache.at < 5 * 60_000) return socialCache.data;
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const accounts = await pf("/social-media/my-social-accounts");
  // Upcoming (scheduled, drafts) for 35 days, and anything that failed in the last 14.
  const posts = [];
  for (const [statuses, from, to] of [["SCHEDULED,DRAFT", now, now + 35 * 864e5], ["FAILED", now - 14 * 864e5, now + 35 * 864e5]]) {
    for (let page = 0; page < 12; page++) {
      const res = await pf(`/social-posts?statuses=${statuses}&from=${iso(from)}&to=${iso(to)}&limit=50&page=${page}`);
      posts.push(...(res.data ?? []));
      if (!res.pageInfo?.hasNextPage) break;
    }
  }
  const metrics = (await pf(`/social-posts/analytics?startDate=${iso(now - 14 * 864e5)}&endDate=${iso(now)}`)).data ?? [];
  const num = (v) => (v == null ? 0 : Number(v) || 0);
  const firstLine = (t) => String(t ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 140) ?? "";
  const list = accounts.map((a) => {
    const mine = posts.filter((p) => p.socialMediaId === a.id);
    // Rejected in PostFast's approval step: they stay in the queue but don't publish, so they don't count.
    const rejected = mine.filter((p) => p.status !== "FAILED" && p.approvalStatus === "REJECTED").length;
    const upcoming = mine.filter((p) => p.status !== "FAILED" && p.approvalStatus !== "REJECTED").sort((x, y) => new Date(x.scheduledAt) - new Date(y.scheduledAt));
    const published = metrics.filter((m) => m.socialMediaId === a.id);
    const best = published.reduce((b, m) => (num(m.latestMetric?.reach) > num(b?.latestMetric?.reach) ? m : b), null);
    return {
      id: a.id, platform: a.platform, handle: a.platformUsername ?? a.displayName ?? "", name: a.displayName ?? "",
      connected: a.connectionStatus === "CONNECTED", disabledReason: a.disabledReason ?? null,
      followers: a.followerCount == null ? null : Number(a.followerCount),
      scheduled: upcoming.filter((p) => p.status === "SCHEDULED").length,
      drafts: upcoming.filter((p) => p.status === "DRAFT").length,
      rejected,
      next: upcoming.find((p) => p.status === "SCHEDULED")?.scheduledAt ?? null,
      days: upcoming.filter((p) => p.status === "SCHEDULED").map((p) => p.scheduledAt),
      // Two scheduled posts on one account in the same minute (e.g. a feed post and a Reel of the same thing).
      doubles: Object.values(upcoming.filter((p) => p.status === "SCHEDULED").reduce((g, p) => ((g[p.scheduledAt] ??= []).push(p), g), {}))
        .filter((g) => g.filter((p) => p.controls?.instagramPublishType !== "STORY").length > 1)
        .map((g) => ({ at: g[0].scheduledAt, types: g.map((p) => p.controls?.instagramPublishType ?? p.platform), text: firstLine(g[0].content) })),
      failed: mine.filter((p) => p.status === "FAILED").map((p) => ({ at: p.scheduledAt, error: p.lastError?.message ?? "Failed", text: firstLine(p.content) })),
      posted14: published.length,
      reach14: published.reduce((t, m) => t + num(m.latestMetric?.reach), 0),
      likes14: published.reduce((t, m) => t + num(m.latestMetric?.likes), 0),
      best: best ? { text: firstLine(best.content), reach: num(best.latestMetric?.reach), at: best.publishedAt } : null,
    };
  }).sort((x, y) => x.handle.localeCompare(y.handle));
  const handle = new Map(list.map((a) => [a.id, a.handle]));
  const next = posts.filter((p) => p.status === "SCHEDULED" && p.approvalStatus !== "REJECTED").sort((x, y) => new Date(x.scheduledAt) - new Date(y.scheduledAt)).slice(0, 14)
    .map((p) => ({ at: p.scheduledAt, handle: handle.get(p.socialMediaId) ?? "?", platform: p.platform, type: p.controls?.instagramPublishType ?? null, text: firstLine(p.content) }));
  const data = { configured: true, at: new Date().toISOString(), accounts: list, next };
  socialCache = { at: Date.now(), data };
  return data;
}

// --- lists for the page ---------------------------------------------------------

async function meta() {
  const [labels, artists] = await Promise.all([
    db.from("imprints").select("slug, imprint_name").order("imprint_name"),
    db.from("artists").select("slug, artist_name, instagram, status").order("artist_name"),
  ]);
  if (labels.error) throw new Error(labels.error.message);
  if (artists.error) throw new Error(artists.error.message);
  return {
    labels: labels.data.map((l) => ({ slug: l.slug, name: l.imprint_name.replace(/\s+-\s+.*$/, "") })),
    artists: artists.data.map((a) => ({ slug: a.slug, name: a.artist_name, instagram: a.instagram, held: a.status === "paused" })),
  };
}

async function findSongs(q) {
  const term = q.trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (term.length < 2) return [];
  const { data, error } = await db
    .from("songs")
    .select("song_id, song_code, title, album_title, release_status, artists!songs_primary_artist_id_fkey(artist_name)")
    .or(`title.ilike.%${term}%,song_code.ilike.%${term}%`)
    .order("title")
    .limit(40);
  if (error) throw new Error(error.message);
  return data.map((s) => ({ id: s.song_id, code: s.song_code, title: s.title, album: s.album_title, artist: s.artists?.artist_name ?? null, status: s.release_status }));
}

// --- http -------------------------------------------------------------------------

const PAGE = readFileSync(join(HERE, "page.html"), "utf8");

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-frame-options": "DENY" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000) throw new Error("Too large.");
  }
  return JSON.parse(raw || "{}");
}

createServer(async (req, res) => {
  try {
    // Only this Mac's own browser, by name, so a web page can't reach us through DNS tricks.
    if (req.headers.host !== `localhost:${PORT}` && req.headers.host !== `127.0.0.1:${PORT}`) return send(res, 403, { error: "Forbidden" });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE.replace("__TOKEN__", TOKEN), "text/html; charset=utf-8");
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (req.headers["x-admin-token"] !== TOKEN) return send(res, 403, { error: "Reload the page." });

    if (req.method === "GET" && url.pathname === "/api/meta") return send(res, 200, await meta());
    if (req.method === "GET" && url.pathname === "/api/overview") return send(res, 200, await overview());
    if (req.method === "GET" && url.pathname === "/api/social") return send(res, 200, await social(url.searchParams.has("fresh")));
    if (req.method === "GET" && url.pathname === "/api/songs") return send(res, 200, await findSongs(url.searchParams.get("q") ?? ""));
    if (req.method === "GET" && url.pathname === "/api/job") {
      if (!current) return send(res, 200, null);
      const from = Number(url.searchParams.get("from") ?? 0);
      const { id, name, apply, done, ok, lines } = current;
      return send(res, 200, { id, name, apply, done, ok, total: lines.length, lines: lines.slice(from) });
    }
    if (req.method === "POST" && url.pathname === "/api/run") {
      const { name, form, apply } = await body(req);
      return send(res, 200, { id: await start(name, form, apply) });
    }
    if (req.method === "POST" && url.pathname === "/api/vo/upload") return send(res, 200, { name: await voUpload(req, url.searchParams.get("name")) });
    if (req.method === "POST" && url.pathname === "/api/vo/pick") return send(res, 200, { folder: await pickFolder() });
    if (req.method === "POST" && url.pathname === "/api/vo/pick-save") {
      const { src, last } = await body(req);
      const from = last && voPicked.has(resolve(last)) && existsSync(last) ? resolve(last) : voFolder(src);
      return send(res, 200, { folder: await pickFolder("Save the clean voiceovers in…", from) });
    }
    if (req.method === "GET" && url.pathname === "/api/vo/files") return send(res, 200, await voList(url.searchParams.get("src")));
    if (req.method === "POST" && url.pathname === "/api/vo/open") {
      spawn("open", [voFolder((await body(req)).src)], { stdio: "ignore" });
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/vo/audition") {
      const { src, file } = await body(req);
      return send(res, 200, await voAudition(src, file));
    }
    if (req.method === "GET" && url.pathname === "/api/vo/clip") {
      const k = url.searchParams.get("k");
      const file = join(AUDITION, k === "voice" ? "voice.wav" : "orig.wav");
      if (!existsSync(file)) return send(res, 404, { error: "No audition yet." });
      res.writeHead(200, { "content-type": "audio/wav", "content-length": statSync(file).size, "cache-control": "no-store" });
      return void (await pipeline(createReadStream(file), res));
    }
    if (req.method === "GET" && url.pathname === "/api/vb/status") return send(res, 200, await vbStatus());
    if (req.method === "POST" && url.pathname === "/api/vb/start") return send(res, 200, await vbStart());
    if (req.method === "GET" && url.pathname === "/api/vb/presets") return send(res, 200, await vbPresets(url.searchParams.get("engine")));
    if (req.method === "POST" && url.pathname === "/api/vb/sample") return send(res, 200, await vbSample(req, url));
    if (req.method === "POST" && url.pathname === "/api/vb/create") return send(res, 200, await vbCreate(await body(req)));
    if (req.method === "GET" && url.pathname === "/api/vb/clips") return send(res, 200, await vbClips(url.searchParams.get("profile")));
    if (req.method === "GET" && url.pathname === "/api/vb/clip") {
      const file = vbFile(url.searchParams.get("p"));
      res.writeHead(200, { "content-type": "audio/wav", "content-length": statSync(file).size, "cache-control": "no-store" });
      return void (await pipeline(createReadStream(file), res));
    }
    if (req.method === "POST" && url.pathname === "/api/vb/show") {
      const { profile, ref } = await body(req);
      const folder = ref ? dirname(vbFile(ref)) : voiceFolder(await vb(`/profiles/${need(profile, UUID)}`));
      mkdirSync(folder, { recursive: true });
      spawn("open", [folder], { stdio: "ignore" });
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/stop") {
      if (current?.child && !current.done) current.child.kill("SIGINT");
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/quit") {
      send(res, 200, { ok: true });
      if (current?.child && !current.done) current.child.kill("SIGINT");
      setTimeout(() => process.exit(0), 200);
      return;
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Squaredrum Admin on http://localhost:${PORT}`));
