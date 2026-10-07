// Walks the catalogue folders and works out what each audio file is, from
// its path. Used by the importer; run on its own it is a dry run that touches
// nothing remote:
//
//   node scripts/catalog/scan.mjs [catalog-root]
//
// Writes scripts/catalog/out/manifest.json and prints a summary.
//
// Three layouts, all under IMPRINT/:
//   <Imprint - Genre>/ARISTS/<Artist>/MUSIC/[<Album>/]<Title>.mp3
//   <Imprint - Genre>/<Artist>/MUSIC/[<Album>/]<Title>.mp3
//   <Imprint - Genre>/MUSIC/<Album>/<Title>.mp3       (imprint compilations)
//
// Most files sit in Google Drive as cloud-only placeholders. Reading one makes
// Drive download it, so the dry run reads tags only from files already on
// disk and reports the rest as cloud-only.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ROOT = join(
  homedir(),
  "Desktop/SQUARE MUSIC PROJECTS/SQUARE BUSINESS/IMPRINT",
);

const AUDIO = new Set([".mp3", ".wav", ".m4a"]);
const ARTISTS_DIR = /^ART?ISTS$/i; // the folders are spelled ARISTS
const ACRONYMS = new Set(["R&B", "EDM", "DJ", "MC", "AI", "UK", "USA", "LA", "TV"]);
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

// Typos baked into the folder names. Corrected for display only; the folders
// themselves are left alone.
const TYPOS = [
  [/\bReggaton\b/gi, "Reggaeton"],
  [/\bReaggaeton\b/gi, "Reggaeton"],
  [/\bSqaure\b/gi, "Square"],
  [/\bAmampiano\b/gi, "Amapiano"],
  [/\bVoll\b/gi, "Vol"],
];
const fixTypos = (s) => TYPOS.reduce((t, [re, to]) => t.replace(re, to), s);

const capitalise = (w) =>
  // Not after apostrophes: Farmer's, J'ai.
  w.toLowerCase().replace(/(^|[-(])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());

// The folders are in capitals. Title-case them for display, but only when the
// whole string is capitals — "Album 1" was typed deliberately; leave it.
export function displayName(raw) {
  const s = raw.trim().replace(/\s+/g, " ");
  if (s !== s.toUpperCase()) return fixTypos(s);
  return fixTypos(
    s
      .split(" ")
      .map((w) => (ACRONYMS.has(w) || ROMAN.test(w) ? w : capitalise(w)))
      .join(" "),
  );
}

// ~350 files are named with no capitals at all — URL-style
// ("de-cero-a-millón-(remix)") or plain ("boots dirty and worn") — and carry
// no title tag. Rebuild a title: hyphens to spaces, title case, roman
// numerals upper, short joining words (English and Spanish) lowercase except
// at the start.
const SMALL = new Set(["a", "an", "and", "the", "of", "to", "in", "on", "at", "for", "by", "or",
  "de", "del", "la", "el", "los", "las", "y", "e", "en", "con"]);
const SLUG_NAME = /^[^\p{Lu}]+$/u;

function unslug(name) {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w, i) => {
      if (ROMAN.test(w.toUpperCase()) && w.length > 1) return w.toUpperCase();
      return i > 0 && SMALL.has(w) ? w : capitalise(w);
    })
    .join(" ");
}

export function slugify(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// "VELVET NOIR RECORDS - R&B:SOUL" -> Velvet Noir Records, [R&B, Soul].
// macOS stores the "/" Finder shows as ":" on disk.
export function parseImprint(folder) {
  const m = folder.match(/^(.*?)\s*-\s*(.+)$/);
  const name = displayName(m ? m[1] : folder);
  const genres = m ? m[2].split(/[:/]/).map((g) => displayName(g.trim())) : [];
  return { name, slug: slugify(name), genres };
}

// "(ALT)" takes are kept in the catalogue but out of rotation.
const VERSION_PATTERNS = [
  [/\s*\((alt|alternate)(\s+version)?\)\s*$/i, "alt"],
  [/\s*\(instrumental\)\s*$/i, "instrumental"],
];

export function parseTitle(file) {
  // Stray underscores stand in for characters a filename can't hold (a "?"
  // usually); dropping them reads better than guessing.
  // Export leftovers seen in the wild: a doubled extension ("Toll Booth.mp.mp3"),
  // a copy suffix ("Work Left_0"), a zero-padded track number ("01-Almost There").
  let title = basename(file, extname(file))
    .replace(/\.mp[34]?$/i, "")
    .replace(/_\d+$/, "")
    .replace(/^0\d\s*-\s*/, "")
    .replace(/_/g, "").replace(/\s+/g, " ").trim();
  if (SLUG_NAME.test(title)) title = unslug(title);
  let version = "original";
  for (const [re, type] of VERSION_PATTERNS) {
    if (re.test(title)) {
      title = title.replace(re, "");
      version = type;
      break;
    }
  }
  if (/\bremix\b/i.test(title)) version = "remix";
  return { title, version };
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (AUDIO.has(extname(entry.name).toLowerCase())) yield p;
  }
}

// Album names from the covers, where the folder name isn't the real title
// ("LEA BABI/MUSIC/ALBUM 1" → "Sexual Fantasies"). Keyed by the album folder
// relative to IMPRINT/; folders are never renamed for this. Edit the JSON and
// run `node scripts/catalog/titles.mjs` to apply it to songs already imported.
export const ALBUM_TITLES = JSON.parse(
  readFileSync(new URL("./album-titles.json", import.meta.url), "utf8"),
);

/** Parse one path into catalogue fields, or null if it is outside the layout. */
/**
 * The artist (or imprint) folder that owns a file — the folder holding its
 * MUSIC/, IMAGES/, DOCUMENTS/ and VIDEOS/ — relative to IMPRINT/, or null.
 * Two layouts: <…>/<Artist>/MUSIC/[<Album>/]file, and (Sembora) no MUSIC
 * folder at all: <Imprint>/ARTISTS/<Artist>/[<Album>/]file.
 */
export function ownerOf(sourcePath) {
  const parts = sourcePath.split("/");
  const music = parts.findIndex((p) => p.toUpperCase() === "MUSIC");
  if (music >= 1) return parts.slice(0, music).join("/");
  if (parts.length >= 4 && ARTISTS_DIR.test(parts[1])) return parts.slice(0, 3).join("/");
  return null;
}

export function parsePath(root, file) {
  const parts = relative(root, file).split(sep);
  let music = parts.findIndex((p) => p.toUpperCase() === "MUSIC");
  // Sembora's layout has no MUSIC folder: <Imprint>/ARTISTS/<Artist>/<Album>/file.
  // Treat it as if MUSIC sat right under the artist folder.
  let offset = 1;
  if (music < 1 && parts.length >= 4 && ARTISTS_DIR.test(parts[1])) {
    music = 3;
    offset = 0;
  }
  if (music < 1) return null;

  const imprint = parseImprint(parts[0]);
  // The artist folder is the one directly above MUSIC — under ARISTS/ for
  // most imprints, straight under the imprint for a few (Kingston Square).
  let artist = null;
  if ((music === 3 && ARTISTS_DIR.test(parts[1])) || music === 2) {
    const name = displayName(parts[music - 1]);
    artist = { name, slug: slugify(name) };
  } else if (music !== 1) {
    return null;
  }

  const between = parts.slice(music + offset, -1);
  const album = ALBUM_TITLES[parts.slice(0, -1).join("/")] ?? (between.length ? displayName(between.join(" · ")) : null);
  const { title, version } = parseTitle(parts.at(-1));

  return {
    sourcePath: parts.join("/"),
    imprint,
    artist,
    album,
    title,
    version,
    format: extname(file).slice(1).toLowerCase(),
  };
}

// SF_DATALESS: the file is a cloud placeholder with no bytes on disk.
const SF_DATALESS = 0x40000000;

export function cloudOnly(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 200) {
    const chunk = files.slice(i, i + 200);
    const lines = execFileSync("stat", ["-f", "%Xf", ...chunk], {
      encoding: "utf8",
      maxBuffer: 1 << 24,
    }).trim().split("\n");
    chunk.forEach((f, j) => out.set(f, (parseInt(lines[j], 16) & SF_DATALESS) !== 0));
  }
  return out;
}

export async function scan(root = DEFAULT_ROOT) {
  const entries = [];
  const skipped = [];
  for await (const file of walk(root)) {
    const parsed = parsePath(root, file);
    if (parsed) entries.push({ file, ...parsed });
    else skipped.push(relative(root, file));
  }
  const dataless = cloudOnly(entries.map((e) => e.file));
  for (const e of entries) e.cloudOnly = dataless.get(e.file);
  entries.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return { entries, skipped };
}

// --- dry run ----------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? DEFAULT_ROOT;
  const { parseFile } = await import("music-metadata");
  const { entries, skipped } = await scan(root);

  // Tags and exact durations, from files already on disk only.
  let read = 0;
  for (const e of entries) {
    if (e.cloudOnly) continue;
    try {
      const { format, common } = await parseFile(e.file, { duration: true });
      e.durationMs = format.duration ? Math.round(format.duration * 1000) : null;
      e.bitrate = format.bitrate ? Math.round(format.bitrate / 1000) : null;
      e.tags = { artist: common.artist, album: common.album, track: common.track?.no, genre: common.genre?.[0] };
      read++;
    } catch (err) {
      e.error = String(err.message ?? err);
    }
  }

  const out = join(dirname(fileURLToPath(import.meta.url)), "out");
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "manifest.json"), JSON.stringify({ root, entries, skipped }, null, 2));

  const count = (f) => entries.reduce((m, e) => m.set(f(e), (m.get(f(e)) ?? 0) + 1), new Map());
  const byImprint = count((e) => e.imprint.name);
  const artists = new Set(entries.filter((e) => e.artist).map((e) => `${e.imprint.slug}/${e.artist.slug}`));
  const byVersion = count((e) => e.version);
  const dupKey = (e) => `${e.artist?.slug ?? e.imprint.slug}|${e.title.toLowerCase()}|${e.version}`;
  const dups = [...count(dupKey)].filter(([, n]) => n > 1);
  const durations = entries.filter((e) => e.durationMs);
  const bitrates = count((e) => e.bitrate ?? "unread");

  console.log(`\n${entries.length} audio files  (${entries.filter((e) => e.cloudOnly).length} cloud-only, ${read} read locally)`);
  console.log(`${byImprint.size} imprints, ${artists.size} artist folders, ${skipped.length} files outside the layout\n`);
  for (const [k, n] of [...byImprint].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log(`\nversions: ${[...byVersion].map(([k, n]) => `${k} ${n}`).join(", ")}`);
  console.log(`same artist + title + version more than once: ${dups.length}`);
  for (const [k, n] of dups.slice(0, 8)) console.log(`  ${n}x  ${k}`);
  if (durations.length) {
    const mins = durations.reduce((s, e) => s + e.durationMs, 0) / durations.length / 60000;
    console.log(`\naverage length (local sample): ${mins.toFixed(2)} min`);
  }
  console.log(`bitrates (kbps, local sample): ${[...bitrates].filter(([k]) => k !== "unread").sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}:${n}`).join("  ")}`);
  const tagArtists = count((e) => e.tags?.artist ?? null);
  tagArtists.delete(null);
  console.log(`ID3 artist values (local sample): ${[...tagArtists].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} (${n})`).join(", ")}`);
  if (skipped.length) console.log(`\noutside the layout:\n  ${skipped.slice(0, 10).join("\n  ")}`);
  console.log(`\nmanifest: ${join(out, "manifest.json")}`);
}
