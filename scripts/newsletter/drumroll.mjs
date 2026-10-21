// Drumroll — Squaredrum's New Music Friday email. Builds the week's issue from the catalogue and an editable
// notes file, as a send-ready HTML email for Resend (images on the CDN, Resend's unsubscribe link).
//
//   node scripts/newsletter/drumroll.mjs                    build this coming Friday's issue
//   node scripts/newsletter/drumroll.mjs --date 2026-10-30  build the issue for another Friday
//
// Writes to "SQUARE BUSINESS/Drumroll/<date>/":
//   notes.md            the words: subject, headline, one line per album, Squaredrum world news. Created on the first
//                       run with sensible defaults; edit it (or ask Claude to) and run again to rebuild.
//   Drumroll <date>.html  the email, ready to send
//   preview.png         what it looks like
//
// What goes in, by itself:
//   New releases   every album waiting for Friday (`ready`); if none are waiting, albums added in the 7 days before
//   Spotlight      a roster artist with an artist page who wasn't in the last 8 issues (history.json)
//   Watch it move  the lead album's Canvas as an animated picture (uploaded to the CDN under audio/newsletter/)
//   On air         the lead album's radio channel
//   (Off the Square, the music-press headlines, stays on squaredrum.com/news and is not in the email.)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "../admin/jobs/common.mjs";

const OUT_ROOT = "/Users/robertsimenya/Desktop/SQUARE MUSIC PROJECTS/SQUARE BUSINESS/Drumroll";
const CDN = (process.env.NEXT_PUBLIC_AUDIO_BASE_URL ?? "https://d1j1hqrpj9spbo.cloudfront.net").replace(/\/$/, "");
const SITE = "https://www.squaredrum.com";
const FROM = "Drumroll by Squaredrum <drumroll@gosquare.app>";
// GoSquare links stay out of Drumroll until the app is in the stores (Robert, Oct 2026: gosquare.app is
// only a GoDaddy placeholder). Set GOSQUARE_LIVE=1 in .env.local on launch day to bring them back.
const APP_LIVE = process.env.GOSQUARE_LIVE === "1";
const LISTEN = APP_LIVE ? "GoSquare" : "squaredrum.com";
const ADDRESS = "SQUAREDRUM LLC · 9350 Wilshire Blvd, Suite 203-C23, Beverly Hills, CA 90212";
const SOCIAL = { Instagram: "https://www.instagram.com/squaredrumla/", TikTok: "https://www.tiktok.com/@squaredrumla", YouTube: "https://www.youtube.com/@squaredrum" };
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = process.argv.slice(2);
const DATE = args.includes("--date") ? args[args.indexOf("--date") + 1] : nextFriday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) throw new Error("--date must look like 2026-10-30");
const OUT = join(OUT_ROOT, DATE);
mkdirSync(OUT, { recursive: true });

function nextFriday() {
  const d = new Date();
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return d.toLocaleDateString("en-CA");
}
const longDate = new Date(`${DATE}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ---------------------------------------------------------------- catalogue
const slugify = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const all = async (q) => {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
};

const [artists, imprints, stations] = await Promise.all([
  all(() => db.from("artists").select("artist_id, artist_name, slug, genre, status")),
  all(() => db.from("imprints").select("imprint_id, imprint_name, slug")),
  all(() => db.from("radio_stations").select("slug, station_name, related_imprint_id, status").eq("status", "active")),
]);
const artistById = new Map(artists.map((a) => [a.artist_id, a]));
const imprintById = new Map(imprints.map((i) => [i.imprint_id, i]));

const cols = "song_id, title, album_title, track_number, created_at, release_status, primary_artist_id, primary_imprint_id";
let week = await all(() => db.from("songs").select(cols).eq("release_status", "ready"));
let waiting = true;
if (!week.length) {
  // Nothing queued (or it already went out early): the albums added in the 7 days before this Friday.
  waiting = false;
  const since = new Date(new Date(`${DATE}T09:00:00`).getTime() - 7 * 86400000).toISOString();
  week = await all(() => db.from("songs").select(cols).eq("release_status", "released_radio").gte("created_at", since));
}
if (!week.length) throw new Error(`No new albums for ${DATE}: import this week's release first (it waits for Friday by itself).`);

const coverRows = await all(() => db.from("song_covers").select("song_id, cover_key, canvas_key").in("song_id", week.map((s) => s.song_id)));
const coverBy = new Map(coverRows.map((c) => [c.song_id, c]));

const albumMap = new Map();
for (const s of week) {
  const artist = artistById.get(s.primary_artist_id);
  const imprint = imprintById.get(s.primary_imprint_id);
  const name = artist?.artist_name ?? imprint?.imprint_name ?? "Squaredrum";
  const album = s.album_title?.trim() || "Singles";
  const key = `${artist?.slug ?? imprint?.slug}::${album}`;
  if (!albumMap.has(key)) {
    albumMap.set(key, {
      title: album, artist, imprint, name, songs: [],
      slug: slugify(album === name ? album : `${album} ${name}`),
    });
  }
  const a = albumMap.get(key);
  a.songs.push(s);
  const c = coverBy.get(s.song_id);
  if (c?.cover_key && !a.cover) a.cover = c.cover_key;
  if (c?.canvas_key && !a.canvas) a.canvas = c.canvas_key;
}
// A release is a new album: nothing from it was out before this week, and it has at least 3 songs. Songs added
// to an album that's already out (a stray track on an old compilation, say) don't headline the email.
const weekStart = new Date(new Date(`${DATE}T09:00:00`).getTime() - 7 * 86400000).toISOString();
for (const a of albumMap.values()) {
  const owner = a.artist ? ["primary_artist_id", a.artist.artist_id] : ["primary_imprint_id", a.imprint?.imprint_id];
  const { count } = await db
    .from("songs")
    .select("song_id", { count: "exact", head: true })
    .eq(owner[0], owner[1])
    .eq("album_title", a.title)
    .eq("release_status", "released_radio")
    .lt("created_at", waiting ? new Date().toISOString() : weekStart);
  a.isNew = !count && a.songs.length >= 3;
}
const albums = [...albumMap.values()].filter((a) => a.isNew).sort((x, y) => y.songs.length - x.songs.length);
if (!albums.length) throw new Error(`No new albums for ${DATE} (only songs added to albums that are already out).`);

// Artist pages on the CDN: bio, hero and gallery photos (photos.mjs).
const pages = new Map();
async function page(slug) {
  if (!slug) return null;
  if (!pages.has(slug)) {
    pages.set(slug, await fetch(`${CDN}/audio/photos/${slug}/index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  return pages.get(slug);
}
const photoUrl = (slug, p, min) => `${CDN}/audio/photos/${slug}/${p.id}-${p.widths.find((w) => w >= min) ?? p.widths.at(-1)}.jpg`;
/** The opening of a text: whole sentences up to `max` characters, but at least `min` (a punchy first line such as
 * "Put the phone down." says too little on its own); a sentence that runs far past `max` is cut at a word. */
const sentences = (text, max, min = 80) => {
  const out = [];
  for (const s of (text ?? "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”’)]*/g) ?? []) {
    const len = out.join(" ").length;
    if (len >= min && len + s.length > max) break;
    out.push(s.trim());
    if (out.join(" ").length >= min && out.join(" ").length > max) break;
  }
  const t = out.join(" ");
  return t.length > max * 1.5 ? t.slice(0, max * 1.4).replace(/[\s,;:]+\S*$/, "") + "…" : t;
};

for (const a of albums) {
  a.page = await page(a.artist?.slug);
  a.line = sentences(a.page?.bio, 170) || `${a.songs.length} new songs of ${a.artist?.genre ?? "music"} from ${a.name}.`;
}
// The lead album: the biggest release with an artist page (for the big photo), else the biggest.
const lead = albums.find((a) => a.page?.photos?.some((p) => p.role === "hero")) ?? albums[0];
const heroPhoto = lead.page?.photos?.find((p) => p.role === "hero" && p.shape === "wide") ?? lead.page?.photos?.find((p) => p.role === "hero");
const heroUrl = heroPhoto ? photoUrl(lead.artist.slug, heroPhoto, 1200) : `${CDN}/${lead.cover}`;

// ---------------------------------------------------------------- notes (the editable words)
const words = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = `${words[albums.length] ?? albums.length} new album${albums.length === 1 ? "" : "s"}.`;
const names = [...new Set(albums.map((a) => a.name))];
const nameList = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ");
const NOTES = join(OUT, "notes.md");
if (!existsSync(NOTES)) {
  writeFileSync(
    NOTES,
    `# Drumroll · New Music Friday · ${longDate}
# Edit the words after each colon, then run the builder again. Lines starting with # are ignored.

Subject: New Music Friday: ${nameList}
Preview: ${count.replace(/\.$/, "")} ${waiting ? "out today" : "this week"}, free on ${LISTEN}.
Headline: ${count} | ${waiting ? "Out today." : "New this week."}
Intro: ${albums.map((a) => `${a.title} from ${a.name}`).join(", ")}. Free on ${LISTEN} from this morning.

## Releases
# One line per album: "Album title: what it is in a sentence".
${albums.map((a) => `${a.title}: ${a.line}`).join("\n")}

## Squaredrum world
# What's happening inside Squaredrum this week (new artists, an artist going live on Instagram, Canvases,
# collabs…), one per line: "Title | one or two sentences | optional link | optional button words".
# Leave empty to skip the section.
`,
  );
}
const notes = { releases: new Map(), world: [] };
let section = "";
for (const raw of readFileSync(NOTES, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("# ")) continue;
  if (line.startsWith("## ")) {
    section = line.slice(3).toLowerCase();
    continue;
  }
  const kv = /^([^:|]{2,60}):\s*(.+)$/.exec(line);
  if (!section && kv) notes[kv[1].trim().toLowerCase()] = kv[2].trim();
  else if (section === "releases" && kv) notes.releases.set(kv[1].trim().toLowerCase(), kv[2].trim());
  else if (section.startsWith("squaredrum world")) {
    const [title, text, link, label] = line.split("|").map((x) => x.trim());
    notes.world.push({ title, text: text ?? "", link: link ?? "", label: label ?? "" });
  }
}
for (const a of albums) a.line = notes.releases.get(a.title.toLowerCase()) ?? a.line;
const [head1, head2] = (notes.headline ?? `${count} | Out today.`).split("|").map((x) => x.trim());

// ---------------------------------------------------------------- spotlight (rotates)
const HISTORY = join(OUT_ROOT, "history.json");
const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, "utf8")) : {};
const recent = new Set(
  Object.entries(history)
    .filter(([d]) => d < DATE)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 8)
    .map(([, h]) => h.spotlight),
);
const releasing = new Set(albums.map((a) => a.artist?.slug).filter(Boolean));
let spot = null;
const candidates = artists
  .filter((a) => a.status === "active" && !releasing.has(a.slug) && !recent.has(a.slug))
  .sort((x, y) => (history[DATE]?.spotlight === x.slug ? -1 : history[DATE]?.spotlight === y.slug ? 1 : x.slug.localeCompare(y.slug)));
// Start the alphabet where the last issue's spotlight left off, so it walks through the roster.
const last = Object.entries(history).filter(([d]) => d < DATE).sort(([a], [b]) => b.localeCompare(a))[0]?.[1]?.spotlight ?? "";
const ordered = history[DATE]?.spotlight ? candidates : [...candidates.filter((a) => a.slug > last), ...candidates.filter((a) => a.slug <= last)];
for (const a of ordered) {
  const p = await page(a.slug);
  if (p?.bio && p.photos?.length) {
    spot = { artist: a, page: p };
    break;
  }
}
if (spot) {
  const songs = await all(() =>
    db.from("songs").select("title, album_title").eq("primary_artist_id", spot.artist.artist_id).eq("release_status", "released_radio").eq("version_type", "original"),
  );
  // Three songs, the same three every time this issue is rebuilt.
  const seed = [...DATE].reduce((n, c) => n * 31 + c.charCodeAt(0), 7);
  spot.songs = songs.map((s, i) => ({ s, k: (seed * (i + 13)) % 997 })).sort((a, b) => a.k - b.k).slice(0, 3).map((x) => x.s.title);
  const portrait = spot.page.photos.find((p) => p.role !== "hero" && p.shape !== "wide") ?? spot.page.photos[0];
  spot.photo = photoUrl(spot.artist.slug, portrait, 600);
  spot.quote = sentences(spot.page.bio, 200);
}

// ---------------------------------------------------------------- Canvas as an animated picture
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-west-1" });
async function upload(file, key, type) {
  await s3.send(new PutObjectCommand({ Bucket: process.env.AUDIO_BUCKET, Key: key, Body: readFileSync(file), ContentType: type, CacheControl: "public, max-age=31536000" }));
  return `${CDN}/${key}`;
}
let canvasGif = null;
const canvasAlbum = lead.canvas ? lead : albums.find((a) => a.canvas);
if (canvasAlbum) {
  const work = join(tmpdir(), "drumroll");
  mkdirSync(work, { recursive: true });
  const mp4 = join(work, "canvas.mp4");
  const gif = join(OUT, "canvas.gif");
  writeFileSync(mp4, Buffer.from(await (await fetch(`${CDN}/${canvasAlbum.canvas}`)).arrayBuffer()));
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", mp4, "-t", "5", "-vf", "fps=8,scale=220:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle", gif]);
  canvasGif = { url: await upload(gif, `audio/newsletter/${DATE}/canvas-${canvasAlbum.slug}.gif`, "image/gif"), album: canvasAlbum };
}

// ---------------------------------------------------------------- On air
const station = stations.find((s) => s.related_imprint_id === lead.imprint?.imprint_id);

// ---------------------------------------------------------------- the email
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const F = {
  display: "font-family:Anton,Impact,'Arial Narrow Bold',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em;",
  mono: "font-family:'Space Mono',ui-monospace,Menlo,Courier,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;",
  body: "font-family:'Instrument Sans',Helvetica,Arial,sans-serif;",
};
const C = { ink: "#0b0b0c", paper: "#f5f3ee", gold: "#d4a24c", goldDeep: "#886221", text: "#3d3b37", mute: "#6f6c64", line: "#e4e0d6", soft: "#bdb9b0" };
const link = (href, label, color = C.ink) =>
  `<a href="${esc(href)}" style="${F.mono}color:${color};text-decoration:none;border-bottom:1px solid ${C.gold};padding-bottom:2px;">${esc(label)} &rarr;</a>`;
const eyebrow = (n, label) =>
  `<tr><td style="padding:40px 36px 16px;${F.mono}color:${C.goldDeep};">${String(n).padStart(2, "0")} &middot; ${esc(label)}</td></tr>`;
let n = 0;

const releaseCells = albums.map(
  (a) => `<td class="col" valign="top" width="${albums.length > 1 ? 50 : 100}%" style="padding:0 ${albums.length > 1 ? 10 : 0}px 24px;">
      <a href="${SITE}/releases/${a.slug}"><img src="${CDN}/${a.cover?.replace(/\.jpg$/, "-600.jpg") ?? ""}" width="${albums.length > 1 ? 254 : 528}" alt="${esc(a.title)} cover" style="display:block;width:100%;height:auto;border:0;"></a>
      <div style="${F.mono}color:${C.mute};padding-top:14px;">${esc(a.name)}${a.imprint && a.artist ? ` &middot; ${esc(a.imprint.imprint_name)}` : ""}</div>
      <div style="${F.display}font-size:28px;line-height:1;color:${C.ink};padding-top:6px;">${esc(a.title)}</div>
      <div style="${F.body}font-size:14px;line-height:1.55;color:${C.text};padding:10px 0 12px;">${esc(a.line)}</div>
      ${link(`${SITE}/releases/${a.slug}`, "Play the album")}
    </td>`,
);
const releaseRows = [];
for (let i = 0; i < releaseCells.length; i += 2) releaseRows.push(`<tr>${releaseCells.slice(i, i + 2).join("")}${releaseCells.length > 1 && i + 1 >= releaseCells.length ? '<td class="col" width="50%"></td>' : ""}</tr>`);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only"><title>Drumroll · ${esc(longDate)}</title>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Instrument+Sans:wght@400;600&family=Space+Mono&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:#e9e6de;}
  a{color:${C.ink};}
  @media (max-width:620px){ .wrap{width:100%!important;} .col{display:block!important;width:100%!important;padding:0 0 24px!important;} .px{padding-left:20px!important;padding-right:20px!important;} .hero-h{font-size:42px!important;} }
</style></head>
<body style="margin:0;padding:0;background:#e9e6de;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(notes.preview ?? "")}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9e6de;"><tr><td align="center" style="padding:24px 12px 40px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${C.paper};">

<tr><td style="background:${C.ink};padding:24px 36px 20px;" class="px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td valign="middle"><a href="${SITE}"><img src="${CDN}/audio/newsletter/brand/squaredrum-horizontal-dark.png" width="150" alt="SQUAREDRUM" style="display:block;border:0;width:150px;height:auto;"></a></td>
    <td valign="middle" align="right"><div style="${F.display}font-size:30px;line-height:1;color:${C.gold};">Drumroll</div>
      <div style="${F.mono}font-size:10px;color:${C.soft};padding-top:6px;">New Music Friday &middot; ${esc(longDate)}</div></td>
  </tr></table>
</td></tr>

<tr><td style="background:${C.ink};"><a href="${SITE}/releases/${lead.slug}"><img src="${esc(heroUrl)}" width="600" alt="${esc(lead.name)}" style="display:block;width:100%;height:auto;border:0;"></a></td></tr>
<tr><td class="px" style="background:${C.ink};padding:24px 36px 34px;">
  <div style="${F.mono}color:${C.gold};padding-bottom:12px;">New Music Friday &middot; ${waiting ? "Out today" : "New this week"}</div>
  <div class="hero-h" style="${F.display}font-size:56px;line-height:.95;color:#ffffff;">${esc(head1)}${head2 ? `<br><span style="color:${C.gold};">${esc(head2)}</span>` : ""}</div>
  <div style="${F.body}font-size:16px;line-height:1.55;color:${C.soft};padding-top:14px;">${esc(notes.intro ?? "")}</div>
</td></tr>

${eyebrow(++n, "New releases")}
<tr><td class="px" style="padding:0 26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${releaseRows.join("")}</table></td></tr>

${
  notes.world.length
    ? `${eyebrow(++n, "Squaredrum world")}
<tr><td class="px" style="padding:0 36px;">${notes.world
        .map(
          (w) => `<div style="border-top:1px solid ${C.line};padding:16px 0;">
  <div style="${F.body}font-size:17px;font-weight:600;line-height:1.35;color:${C.ink};">${esc(w.title)}</div>
  ${w.text ? `<div style="${F.body}font-size:14px;line-height:1.6;color:${C.text};padding-top:6px;">${esc(w.text)}</div>` : ""}
  ${w.link ? `<div style="padding-top:10px;">${link(w.link, w.label || (/instagram\.com/.test(w.link) ? "Follow on Instagram" : "Read more"))}</div>` : ""}
</div>`,
        )
        .join("")}</td></tr>`
    : ""
}

${
  spot
    ? `${eyebrow(++n, "Artist spotlight")}
<tr><td class="px" style="padding:0 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td class="col" valign="top" width="190" style="padding-right:24px;"><a href="${SITE}/artists/${spot.artist.slug}"><img src="${esc(spot.photo)}" width="190" alt="${esc(spot.artist.artist_name)}" style="display:block;width:100%;height:auto;border:0;"></a></td>
  <td class="col" valign="top">
    <div style="${F.display}font-size:40px;line-height:1;color:${C.ink};">${esc(spot.artist.artist_name)}</div>
    <div style="${F.body}font-size:15px;line-height:1.6;color:${C.text};padding:12px 0 14px;">${esc(spot.quote)}</div>
    ${spot.songs.length ? `<div style="${F.mono}color:${C.mute};padding-bottom:6px;">Start with these ${words[spot.songs.length].toLowerCase()}</div>
    ${spot.songs.map((t, i) => `<div style="${F.body}font-size:14px;color:${C.ink};border-top:1px solid ${C.line};padding:7px 0;"><span style="${F.mono}color:${C.goldDeep};">0${i + 1}</span>&nbsp;&nbsp;${esc(t)}</div>`).join("")}` : ""}
    <div style="padding-top:14px;">${link(`${SITE}/artists/${spot.artist.slug}`, `Meet ${spot.artist.artist_name}`)}</div>
  </td></tr></table></td></tr>`
    : ""
}

${
  canvasGif
    ? `<tr><td style="padding-top:40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ink};"><tr>
  <td class="col" valign="middle" width="220" style="padding:32px 0 32px 36px;"><img src="${esc(canvasGif.url)}" width="200" alt="The Canvas for ${esc(canvasGif.album.title)}" style="display:block;width:200px;height:auto;border:0;"></td>
  <td class="col px" valign="middle" style="padding:32px 36px 32px 26px;">
    <div style="${F.mono}color:${C.gold};">${String(++n).padStart(2, "0")} &middot; Watch it move</div>
    <div style="${F.display}font-size:36px;line-height:1;color:#ffffff;padding-top:10px;">Every song has a Canvas.</div>
    <div style="${F.body}font-size:14px;line-height:1.55;color:${C.soft};padding:12px 0 16px;">${APP_LIVE ? `Play anything from ${esc(canvasGif.album.title)} in GoSquare and this moves behind it, with lyrics that light up line by line.` : `Open ${esc(canvasGif.album.title)} on squaredrum.com and this moves at the top of the page while the music plays.`}</div>
    ${APP_LIVE ? link("https://gosquare.app", "Open in GoSquare", "#ffffff") : link(`${SITE}/releases/${canvasGif.album.slug}`, "See it move", "#ffffff")}
  </td></tr></table></td></tr>`
    : ""
}

${
  station
    ? `${eyebrow(++n, "On air")}
<tr><td class="px" style="padding:0 36px;">
  <div style="${F.mono}color:#c0392b;">&#9679; Live now</div>
  <div style="${F.display}font-size:34px;line-height:1;color:${C.ink};padding-top:8px;">${esc(station.station_name)}</div>
  <div style="${F.body}font-size:14px;line-height:1.6;color:${C.text};padding:10px 0 14px;">${esc(lead.name)} joins the rotation today. One of ${stations.length} channels that never stop: everyone hears the same song at the same moment, like real radio.</div>
  ${link(`${SITE}/?channel=${encodeURIComponent(station.slug)}#onair`, `Tune in to ${station.station_name}`)}
</td></tr>`
    : ""
}

<tr><td class="px" style="padding:36px 36px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line};border-bottom:1px solid ${C.line};"><tr>
  <td width="70" style="${F.display}font-size:46px;line-height:1;color:${C.goldDeep};padding:16px 0;">20</td>
  <td style="${F.body}font-size:14px;line-height:1.55;color:${C.text};padding:16px 0;"><b style="color:${C.ink};">Free downloads every week.</b> Keep your favourites offline. No subscription, no ads.</td>
</tr></table></td></tr>

<tr><td align="center" style="padding:40px 36px 44px;">
  ${APP_LIVE
    ? `<a href="https://gosquare.app" style="display:inline-block;background:${C.gold};color:${C.ink};${F.mono}font-size:13px;letter-spacing:.14em;text-decoration:none;padding:17px 34px;">Open GoSquare &rarr;</a>
  <div style="${F.body}font-size:13px;color:${C.mute};padding-top:14px;">Free on the App Store and Google Play</div>`
    : `<a href="${SITE}/releases" style="display:inline-block;background:${C.gold};color:${C.ink};${F.mono}font-size:13px;letter-spacing:.14em;text-decoration:none;padding:17px 34px;">Listen on squaredrum.com &rarr;</a>
  <div style="${F.body}font-size:13px;color:${C.mute};padding-top:14px;">Every album, every channel. Free, no sign-up needed.</div>`}
</td></tr>

<tr><td class="px" style="background:${C.ink};padding:30px 36px 34px;${F.body}font-size:12px;line-height:1.7;color:#8f8b82;">
  <div style="padding-bottom:14px;">${Object.entries(SOCIAL).map(([k, v]) => `<a href="${v}" style="${F.mono}color:${C.gold};text-decoration:none;margin-right:14px;">${k}</a>`).join("")}</div>
  You're getting Drumroll every Friday because you signed up on squaredrum.com.<br>
  <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#d8d4ca;">Unsubscribe</a> &middot; <a href="${SITE}/privacy" style="color:#d8d4ca;">Privacy</a><br>
  ${esc(ADDRESS)} &middot; info@squaredrum.com
</td></tr>

</table></td></tr></table>
</body></html>
`;

const FILE = join(OUT, `Drumroll ${DATE}.html`);
writeFileSync(FILE, html);
writeFileSync(
  join(OUT, "send.json"),
  JSON.stringify({ from: FROM, subject: notes.subject ?? `New Music Friday: ${nameList}`, preview: notes.preview ?? "", scheduled_at: `${DATE}T09:00:00 America/Los_Angeles`, html: FILE }, null, 2) + "\n",
);
history[DATE] = { spotlight: spot?.artist.slug ?? null, releases: albums.map((a) => `${a.name} – ${a.title}`) };
writeFileSync(HISTORY, JSON.stringify(history, null, 2) + "\n");

// Preview picture (the {{{…}}} unsubscribe placeholder is only filled in by Resend).
if (existsSync(CHROME)) {
  const shot = join(OUT, "preview.png");
  execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=640,5200", "--virtual-time-budget=15000", `--screenshot=${shot}`, `file://${FILE}`], { stdio: "ignore" });
}

const issue = readdirSync(OUT_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= DATE).length;
console.log(`Drumroll No. ${issue} · ${longDate}${waiting ? "" : " (nothing waiting for Friday, so this uses the past week's albums)"}`);
console.log(`  Releases:   ${albums.map((a) => `${a.name} – ${a.title} (${a.songs.length})`).join("; ")}`);
console.log(`  Spotlight:  ${spot?.artist.artist_name ?? "none (no artist page available)"}`);
console.log(`  Canvas:     ${canvasGif ? canvasGif.album.title : "none"}`);
console.log(`  On air:     ${station?.station_name ?? "none"}`);
console.log(`  World news: ${notes.world.length} items`);
console.log(`\nEmail:   ${FILE}\nWords:   ${NOTES}\nPreview: ${join(OUT, "preview.png")}`);
