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

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
const PORT = 4747;
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
  import: ({ label }, apply) => (apply ? [[cat("ingest.mjs"), "--only", need(label, SLUG)], [cat("covers.mjs"), "--upload"]] : [[job("newfiles.mjs"), need(label, SLUG)]]),
  covers: (_, apply) => [[cat("covers.mjs"), ...(apply ? ["--upload"] : [])]],
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
async function artistRow(slug) {
  const { data, error } = await db.from("artists").select("artist_name").eq("slug", slug).maybeSingle();
  if (error || !data) throw new Error("Artist not found.");
  return data;
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
  })();
  return run.id;
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
    if (!/^(localhost|127\.0\.0\.1):4747$/.test(req.headers.host ?? "")) return send(res, 403, { error: "Forbidden" });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, PAGE.replace("__TOKEN__", TOKEN), "text/html; charset=utf-8");
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (req.headers["x-admin-token"] !== TOKEN) return send(res, 403, { error: "Reload the page." });

    if (req.method === "GET" && url.pathname === "/api/meta") return send(res, 200, await meta());
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
