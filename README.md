# Musicsquare Radio — 2026 rebuild

A ground-up replacement for musicsquareradio.com. Next.js 16 (App Router,
Turbopack) and Tailwind v4 tokens plus CSS Modules. No other dependencies.

```bash
npm install
npm run dev    # http://localhost:3200 via .claude/launch.json, or npm run dev
npm run build
```

## The design

Two voices, held to white / black / gold and nothing else.

- **Engraved print** — Bodoni Moda, set huge and tight. The human side.
- **Machine telemetry** — Space Mono at 11px, tracked out, for every number,
  status and label. The AI side.
- **Instrument Sans** carries body copy between them.

Pages are bookended in near-black (hero and page headers, on-air strip, roster,
footer) with the archive in white between. A gold hairline runs down the exact
centre of every dark header — the axis the live record sits on.

Photography is black and white everywhere, always. Gold only ever appears in
type, rules and the frame around the live record. That rule is what keeps a
catalogue of very colourful cover art from fighting the brand.

## The hero: the catalogue

`src/components/wall.tsx` builds a wall of the station's own sleeves, and the
record that is playing right now is pulled out of it and framed in gold on the
centre seam.

- Six columns, each holding its own slice of the artwork **listed twice** and
  drifting by exactly half its height — so the loop is seamless with no
  JavaScript. Columns alternate direction and run at different speeds, which
  stops the eye locking onto the repeat.
- The wall is drained, dimmed to 30% and thrown 1.5px out of focus. Several of
  these sleeves carry their own large typography; the blur is what stops it
  shouting over the wordmark. The whole grid is masked top and bottom so it
  dissolves into the black instead of cutting off.
- The live record is at **full brightness against that dimmed wall** — that
  contrast is what makes it read as the one thing playing. Its artwork comes
  straight off the RadioKing feed (`now.artwork`), so it is never stale. It is
  a plain `<img>`, not `next/image`, because the host changes per track.
- Source art lives in `public/wall/`. The originals were 2048px, 77MB total, for
  tiles that render at ~200px — they are downscaled to 512px JPEG (1.9MB).
  Keep them that way.

Two earlier heroes were built and dropped, both worth knowing about:

1. **A procedural WebGL bust**, half porcelain woman and half gold machine. It
   was removed because a chrome android face is the stock image of AI — it read
   as generic and said nothing about music or radio. three.js went with it.
2. **A live audio waveform**, smooth one side of the seam and quantised the
   other. Technically the nicest of the three — RadioKing serves the stream with
   `access-control-allow-origin: *` so an `AnalyserNode` really can read it —
   but it was rejected on looks. If it is ever revived, note that broadcast
   audio sits far below full scale and needs auto-gain, and that
   `createMediaElementSource` permanently reroutes playback through the graph.

## Mobile

The page is built mobile-first in behaviour even where the CSS is desktop-first.
Things that are easy to break if you edit the hero:

- **The hero must stay one screen tall down to 320×568**, because its whole job
  is getting to the play button. Two media queries defend that: `max-height:
  740px` (short phones) drops the proof and genre lines and shrinks the record;
  `max-height: 460px` (phone landscape) sizes the record and the wordmark off
  `svh` instead of `vw` and clamps the track title to one line. Sizing them off
  width is exactly what pushes the button off a short, wide screen.
- **The wall is flex, not grid.** In a grid, narrowing the column count wraps
  the surplus columns onto a second row where they keep being composited
  off-screen. Surplus columns are hidden outright — 6 → 4 → 3 — so they are
  never painted and `next/image` never fetches them.
- Blur is cheaper on desktop than on a phone GPU; the wall's blur drops from
  1.5px to 0.6px under 560px.
- `viewportFit: "cover"` is set, so the fixed header, the hero console, the
  player bar, the sheet and the footer all add `env(safe-area-inset-*)` back as
  padding.
- The docked player is fixed, so `body[data-playing="true"]` gets bottom padding
  to stop it covering the footer. `PlayerBar` sets that attribute.
- The roster rail sets `overscroll-behavior-x: contain` so a swipe past the last
  card doesn't trigger the browser's back gesture, and `scroll-padding-inline`
  so snapped cards land on the gutter.
- The logo steps down under 390px on its own — without it the burger clips off
  the right edge on a 320px screen.

## Live data

- Stream: RadioKing `music-square-radio/812353`.
- **`/api/live`** proxies three RadioKing widget endpoints in one call and
  normalises them: `track/current`, `track/next?limit=1` and
  `track/ckoi?limit=4` (their name for play history). The widget API sends no
  CORS headers, so the browser can't read it directly.
  - Each endpoint is settled independently — a failure on history must not take
    out the now-playing line.
  - The artwork field is `cover` on `current` and `cover_url` on the other two.
  - `default_cover: true` means RadioKing's generic placeholder; that gets
    nulled so our own fallback shows instead.
  - History usually still lists the track that is on air, so it is filtered
    against `current` before being trimmed to three.
- **Polling is timed off the track, not a clock.** `PlayerProvider` schedules
  the next fetch for just after `current.endsAt`, clamped to 8–60s. A
  four-minute track costs one request instead of eight.
- `buy_link` is deliberately not surfaced. The values RadioKing returns are
  mismatched — "No Longer Available" linked to an album called "This Was Their
  Finest Hour" — so they would send listeners to the wrong record.
- The schedule, on-air strip and channel cards all read the visitor's own clock,
  and track times are rendered in their timezone.

## Pages

`app/layout.tsx` owns the chrome — nav, footer and the docked player — so every
page gets it. Page files only render their own `<main>`.

- `/` — the home page.
- `/channels` — every live channel, from the catalogue (see "Live channels").
- `/schedule` — the whole week, hour by hour.
- `/about` — what the station is, how the music is made, who runs it.
- `/privacy` — describes what the site actually does. Accurate as built; it
  needs revisiting the moment analytics, ads or accounts are added.
- `/donate` — "Support the station". `SUPPORT_URL` in `station.ts` is `null`,
  so the page shows the three free ways to help and hides the contribution
  block entirely. Set that constant and the fourth item appears.

**Everything numeric on the schedule is derived from `WEEK`** via
`airtime(label)` and friends: hours a week, days a week, when each slot runs,
what is on air now, what is next, and the ranking on the schedule page.
Nothing is typed in twice, so no page can drift out of agreement with the
timetable.

Nav hrefs are absolute (`/channels`, `/#drop`) so they work from any page. The
scroll-spy only watches the `/#` entries and only on the home page.

## The schedule

`WEEK` in `station.ts` is the station's real weekly programming, transcribed
from the scheduler in April 2026. It is indexed to match `Date.getDay()`, so
`WEEK[0]` is Sunday. A block running to the end of the day is stored as `24`
rather than `23.99`, which is what makes the week add up to a clean **168 hours
across 17 blocks with no gaps and no overlaps** — worth re-checking if you edit
it, because that sum is the only integrity test the data has.

The week grid uses **five tones, not five colours** — families are ordered
darkest to lightest and the key at the foot of the grid spells them out. Gold is
reserved for whatever is on air. Adding colour here would undo the palette the
rest of the site is built on.

Below 1080px the grid is replaced by a day-at-a-time list with a scrollable day
strip; a seven-column timetable is unreadable on a phone.

Two things to check with the station:

- The scheduler spells it **"Amampiano"**; the site says **"Amapiano"**, which
  is the standard spelling of the genre. Revert in `WEEK` if the original was
  deliberate.
- **"Sunday Lofi" runs Mon–Thu at 23:00** and **"Sunday House" runs Saturday
  afternoon**, per the scheduler. The names look like reused playlist titles
  rather than mistakes, but they read oddly on a public timetable.

There is also a real tension between the timetable and the "four channels"
framing, which came from the old site. By airtime the station's backbone is
**Afro Mix (25h a week, all seven days)**, while **Afrobeat gets 4h across two
days** and Country 8h. Hip Hop, Trapsoul, Dancehall & Reggae, Kizomba Mix and
Reggaeton all get as much air as, or more than, two of the four "channels". The
channels page is still accurate about the *catalogues*; it is not the shape of
the broadcast week.

## Content

Everything editable lives in `src/lib/station.ts` — channels, roster, the
day's programming, socials, nav.

**Today's drop** (`src/lib/drop.ts`) is not edited by hand. Every day at
midnight Pacific it moves to the next roster artist, in a fixed shuffled order,
so each artist recurs exactly every N days (N = roster artists with released
music, 16 in Oct 2026) and gets a different song each time round. Originals
only. The artwork is the artist's roster portrait; the note is built from the
song's album and imprint, never invented. An artist joins the rotation once
they are on `ROSTER` and have music in the catalogue.

## Logo and icons

The logo comes from the brand kit (`NEW LOGO/musicsquare-radio-logo-kit` in the
station's project folder, Oct 2026): a square signal inside three widening gold
brackets, then the wordmark. `src/components/logo.tsx` inlines the kit's
`horizontal-dark.svg` paths rather than using an `<img>`, so one component
covers every context:

- **The wordmark follows `currentColor`**, and `tone="light"` switches the gold
  and bracket opacities to the kit's light version (`#A97A25`, .72/.45 instead
  of `#D4A24C`, .65/.35). The header uses dark over the hero and light once it
  docks white on scroll.
- **The site gold is the logo's gold.** `--color-gold` was moved to the kit's
  `#D4A24C` (Oct 2026), with `--color-gold-deep` (`#886221`, text on paper)
  and `--color-gold-hi` (`#EAD4AE`, hover) derived on the same hue. The logo's
  dark version reads `var(--color-gold)`, so the two can't drift apart again.
  Gold on paper is for fills only — it is 2.3:1, too light for text.
- **Size it off the wordmark.** Its capitals are only 28% of the lockup height
  and the strokes are hairline — below ~2rem tall it stops reading as a name.
- **`collapsible`** (header only): under 430px there is not room beside the
  listen button and burger, so the box goes square and
  `preserveAspectRatio="xMinYMid slice"` crops the lockup to the mark alone. The
  hero spells out the name directly beneath it.
- The kit's paths sample every rounded corner as a polyline with 13-digit
  coordinates. They were simplified (35KB → 13KB, under 0.1 unit of deviation)
  before inlining. If the logo changes, regenerate from the kit rather than
  hand-editing the path strings.

`app/icon.svg` is the kit's `app-icon-small.svg` — the small-size variant, which
drops the faint outer bracket so the mark survives at 16px. `app/apple-icon.png`
is the kit's `apple-touch-icon-180.png`, copied as-is. The kit's `app-icons/`
folder also holds Android, iOS and PWA sizes if a web manifest is ever added.

### Link preview card

`app/opengraph-image.jpg` is the card shown when a link is shared — the hero
flattened: wall sleeves drained to black and white, dimmed to 30% and blurred,
with the kit's tagline lockup (`scripts/og-logo.svg`) on the centre seam. It is
**built by `node scripts/og-image.mjs` and committed**, not generated at build
time; rerun it if the logo or `public/wall/` changes. JPEG at ~50KB, because
WhatsApp drops previews much over 300KB. X uses the same image, and
`twitter.card` in the layout asks for the large format.

Two sharp traps the script documents, both of which surface as the misleading
"Input buffer contains unsupported image format" or as a silently wrong image:
a `create` canvas returns raw pixels unless given an output format, and
`composite()` always runs last in a pipeline, so grading the mosaic needs a
second pass.

Do not reintroduce `app/favicon.ico` — the create-next-app default was shipping
the Next.js logo as the site's icon, because `favicon.ico` outranks the `icons`
metadata entry.

## Facts to keep straight

Supplied by the station owner, Aug 2026 — these override anything inferred from
the old site:

- **Founded 2024**, not 2025. `STATION.founded` drives the hero eyebrow, the
  About stats and the footer copyright, so it only needs changing in one place.
- Operated by **Squaredrum LLC**, an AI record label with its own roster.
- Founder: a **Los Angeles based, award-winning music producer and industry
  executive, 25+ years in the business.** Unnamed on the page because no name
  was given — the section is written so a name and a photo can drop straight in.
- **Close to 300 artists and over 2,000 songs, still growing.** These live in
  `CATALOGUE` and are what every page quotes. Two numbers are easy to confuse
  with them and must never be presented as the station's total: `ROSTER` (21 as of Oct 2026) is
  only the artists with portraits on the site — always framed as "21 of ~300", never as the roster —
  and `CHANNEL_TRACKS` (108) is the four channel playlists alone.
- The catalogue spans **sixteen genres in several languages**, which is wider
  than any one week of `WEEK`. That is why `GENRES` is its own list rather than
  derived from the schedule — EDM, Rock and Zouk are in rotation but did not
  appear in the week that was transcribed.

Only French is named as a language on the page, because the standing French Mix
block is the one piece of direct evidence. Ask before naming others.

## Live channels

The channels are separate from the RadioKing stream. Each is its own station
playing the catalogue around the clock, and **all of it is files**: there is no
streaming server.

- **Audio** is in a private S3 bucket (`musicsquare-audio-<account id>`,
  us-west-1) served only through CloudFront
  (`https://d1j1hqrpj9spbo.cloudfront.net`). The bucket policy lets CloudFront
  read `audio/*` and nothing else, so WAV masters under `masters/` are never
  public. Made by `scripts/aws/setup-audio.sh`.
- **The catalogue** is in Supabase. The schema is
  `supabase/migrations/20261004000000_catalog.sql` — a slice of the SquareDrum
  Database Schema document (KNOWLEDGE BASE/CATALOG), same table names and
  status vocabularies, deviations marked in the file. Row Level Security lets
  the website's publishable key read only released songs; the `channel_tracks`
  view is what the site reads.
- **Being live** is arithmetic (`src/lib/live-channel.ts`). Each channel has a
  rotation with exact song lengths and a fixed start time (`epoch`). From the
  clock alone every browser works out the same song and the same second, then
  plays that file from that point. Each pass through a rotation is reshuffled
  with a seed of channel + pass number, so the order varies but is identical
  for everyone.
- **The player** (`player-provider.tsx`) starts the song that is on air
  *inside the tap*, using the summary the page already has — iOS Safari blocks
  `play()` after an `await`. The full rotation loads in the background and is
  used when that song ends. A song that ends always hands on to the next
  one, never back to itself: browsers trim ~40ms of MP3 padding, so `ended`
  fires just before the clock reaches the end, and re-reading the clock there
  used to restart the same song at its tail. The next song starts from the
  top if within 8s of schedule and rejoins the clock beyond that. The audio
  element deliberately has no
  `crossOrigin`: plain playback doesn't need CORS, and requesting it made every
  song fail on a CloudFront edge that hadn't received the CORS policy yet.
- **Crossfades, like radio.** Each song plays from its cue in to its cue out
  (`songs.cue_in_ms` / `cue_out_ms`, measured from the audio by
  `scripts/catalog/cues.mjs`: leading silence skipped, and the cue out at
  the song's real end — natural fade and outro included, only the silence
  after it skipped. Robert's call: the mix is the last 3s of the song,
  whatever the song does there. After changing the thresholds, re-run
  `node scripts/catalog/cues.mjs --all`).
  The next song starts 3s before the cue out (`CROSSFADE_MS` in
  `live-channel.ts`; it was 5s for a day, shortened by ear) with an equal-power crossfade. The overlap is part of the
  channel clock — a slot is playing time minus the fade — so everyone mixes
  at the same moment.
- **One audio element, plus Web Audio for the overlap**
  (`src/lib/channel-mixer.ts`). Safari — macOS and iOS — only lets an
  element start from a tap, and iOS plays one element at a time, so a
  two-element design faded the old song into silence on Safari. The tapped
  element plays every song, and it is never routed through Web Audio:
  routing it (createMediaElementSource) worked in Chrome but in Safari its
  output dropped out when it switched files — the crossfade played, then the
  music cut. It is faded by plain volume (iOS ignores volume but honours
  `muted`).
- **The overlap** is a separate copy of the next song's opening (the head,
  ~1.2MB, fetched and decoded 12s ahead) played through Web Audio: it fades
  in while the element fades out; then the element, silent, jumps to the next
  song, lines up with the head — median of eight readings, because browsers
  report `currentTime` in ~150ms steps while an element is near silent — and
  takes over. Desktop holds the element at volume 0.001, never 0 or muted:
  Chrome parks its audio output at zero and restarting it stalls the
  hand-over. Measured alignment after the correction: within ~10ms.
- **The decision is made one fade-length before the change.** With a head
  ready, the overlap starts on the clock; without one (no CORS, head failed
  or too short) the song fades out over its full 3s and the next starts on
  the clock, pre-downloaded so it starts at once. (Deciding at the change
  itself, as shipped briefly, left the fallback 0ms to fade — a hard cut.)
- **CloudFront CORS gotcha.** The managed SimpleCORS response headers policy
  omits `Access-Control-Allow-Origin` when the request carries `Priority`
  (Chrome and Safari send it on every fetch) or `Cache-Control: no-cache`.
  curl and node send neither, so every check passed while every browser
  failed — and silently fell back to the segue. The distribution now uses a
  custom policy, `musicsquare-audio-cors-always` (any origin, OriginOverride
  on), from `scripts/aws/cors-policy.sh`. Test CORS with browser headers:
  `curl -H "Origin: https://musicsquareradio.com" -H "Priority: u=1, i" …`.
- **Web Audio needs CORS** on the files. Each page probes once
  (`probeAudioCors`) and the mixer only routes through Web Audio when that
  passed.
- **`?debug`** on any page address shows a panel: CDN CORS yes/no, mixer mode,
  whether the next song's head is ready, and how the last change went. Use it
  to diagnose a phone remotely.
- **Server side**, `src/lib/catalog.ts` holds rotations in memory for five
  minutes. `/api/channels` returns what every channel is airing (polled by the
  cards, timed to the next song change); `/api/channels/[slug]` returns one
  rotation for the player.

### Adding music

Put songs in the catalogue folder, `SQUARE BUSINESS/LABELS/` (the master tree
since Oct 2026; the old `IMPRINT/` tree was moved into it label by label with
`scripts/catalog/move-label.mjs` and is empty):

```
LABELS/<Label - Genre, Genre>/Artists/<Artist>/Songs/[<Album title>/]<Title>.mp3
                                              /Photos  /Videos  /Lyrics  /Press Kit  /Branding  /Social Media
LABELS/<Label>/Compilations/<Collection>/Songs/…     (house collections, credited to the collection)
LABELS/<Label>/Compilations/<Album>/<Title>.mp3      (the label's own albums, credited to the label)
LABELS/<Label>/Artwork/Cover.png, Logo.png
```

Folder and file names are used as written: name them the way they should read.
Catalogue source paths start with `LABELS/` (relative to `SQUARE BUSINESS/`);
the older notes below say `IMPRINT/` where they predate the move. Then:

```bash
node scripts/catalog/ingest.mjs
```

Uploads run as the IAM user `musicsquare-uploader` (AWS CLI profile of the
same name, selected by `AWS_PROFILE` in `.env.local`), made by
`scripts/aws/setup-uploader.sh`. It can add files under `audio/` and
`masters/` and list the bucket — no deletes, nothing else in the account. The
root login is not kept on the Mac; `aws login` is only needed to change the
AWS setup itself.

The importer is resumable and skips anything already imported (by path, or by
checksum if a file was moved). It rebuilds every channel's rotation at the end
without touching any channel's `epoch`, so nobody listening hears a jump.
`node scripts/catalog/scan.mjs` is a dry run that changes nothing.

What the importer decides, all in `scan.mjs` / `ingest.mjs`:

- Imprint, genre, artist and album come from the folder names (the ID3 artist
  tags are unusable — the most common value is "informs"). Capitalised folder
  names are title-cased; files named with no capitals ("adicto-a-tu-amor",
  "boots dirty and worn") get rebuilt titles. Known folder typos (Reggaton,
  Sqaure, Amampiano, Voll) are corrected for display only.
- New songs are `released_radio` — they already air on RadioKing — with
  `rights_status` `unknown`. "(ALT)" takes import as drafts and stay out of
  rotation. Where an artist has two recordings of the same title, only the
  first goes into the rotation; both stay in the catalogue.
- A WAV with a matching MP3 is filed as that song's private master. A WAV on
  its own is converted to a 320k MP3 for streaming (needs `brew install
  ffmpeg`) and also kept as the master. If an MP3 later appears beside it, the
  song is linked to that MP3 rather than imported again.
- **Reorganising is safe.** A file whose audio matches an imported song, where
  the song's old file no longer exists, is treated as moved: the same song
  (same code, same place in the rotations) is re-pointed to the new folder,
  artist and album. If the old file still exists it is a genuine copy and is
  skipped. An artist left with no songs is archived, never deleted. First used
  Oct 2026 when DREAMY POP was renamed DREAMY POP V1 (58 songs).
- Every list read is paged (`selectAll`). PostgREST returns at most 1,000 rows
  per request; before this, a re-run would have seen only 1,000 of the
  imported songs and uploaded the rest again.
- Cue points for the crossfades are measured for each new song as it is
  imported. To re-measure (after changing the thresholds in `cues.mjs`), run
  `node scripts/catalog/cues.mjs --all`.
- Channels: one per imprint, named for its genres, biggest catalogue first.
  Adding songs to a channel changes its rotation length, so anyone listening
  at the moment of an import jumps once to the new position.

## Still to build

The old site remains at `../musicsquareradio3` as a reference.

## Album covers

`node scripts/catalog/covers.mjs` reports which album folders in `IMPRINT/` have
a cover; `--upload` uploads new or changed ones. The cover is the image named
`cover` (`cover.jpg` / `.png` / `.webp`) or named exactly like its album folder
(`TRAPSOUL III/Trapsoul III.jpg`). Failing that, the script guesses: the
folder's square image, never a YouTube one (`YT` in the name), preferring
"cover" in the name, `.jpg` over `.png`, and `Cover 2` over `Cover 2b`.
Guesses are listed in the report; naming a file `cover` overrides one.
If the album folder has no image at all, the artist's (or collection's)
`IMAGES` folder is checked, accepting only cover-like names — the album's own
name, `Cover 2`, or the artist/collection name plus a number (`Apex II`,
`Lumi III`) — square and never YouTube art. Bare numbers (`01.jpg`) never count,
because those folders hold numbered artist photos. Covers are
cropped square, resized to 1000px JPEG and stored content-addressed at
`audio/covers/<hash>.jpg` (the only prefix CloudFront serves), recorded in
`album_covers` and read through the `song_covers` view
(`supabase/migrations/20261007010000_album_covers.sql`). GoSquare shows them
straight away; unchanged covers are skipped on re-runs.
Each image is also stored at 300px and 600px (`<key>-300.jpg`, `-600.jpg`) so
lists don't download the 1000px file; `--thumbs` backfills any missing sizes.

Label artwork: each imprint folder may hold `Cover.*` and `Logo.*`; the same
script uploads them to `imprint_art` (keyed by imprint slug, so a label with no
music yet keeps its artwork ready) — `supabase/migrations/20261007020000_imprint_art.sql`.
GoSquare uses the cover for label pages, Browse tiles and radio channels, and
the logo for the Imprints row.

## Album titles

Where a folder name isn't the album's real title (`LEA BABI/MUSIC/ALBUM 1` is
"Sexual Fantasies" on its cover), `scripts/catalog/album-titles.json` maps the
folder (relative to `IMPRINT/`) to the title. The importer uses it for new
songs; `node scripts/catalog/titles.mjs` applies it to songs already imported.
Folders are never renamed for this. Song names work the same way:
`scripts/catalog/song-titles.json` maps a file (relative to `IMPRINT/`) to its
real title — Serenity Soundz's 220 "Relaxing/Soothing Piano NN" placeholders
have names there — and `titles.mjs` applies both lists.

## Lyrics and videos

`node scripts/catalog/media.mjs` matches files in each artist's `DOCUMENTS/`
(lyrics: .rtf .docx .txt .md) and `VIDEOS/` (.mp4 .mov) to their songs by title,
splitting lyric sheets that hold many songs (`SONG 7: "DÉJÀ VU"`, `1. Title`,
`Title 1: Title`); `--upload` loads lyrics into `song_lyrics` and converts each
video to 1080p H.264 with a poster frame on the CDN (`song_videos`). Files whose
names don't match a song go in `media-links.json`. Migration:
`supabase/migrations/20261007030000_lyrics_videos.sql`.

Replaced a song's audio under the same file name? The importer skips known
paths, so run `node scripts/catalog/replace.mjs "<path under IMPRINT/>"`: it
uploads the new MP3 under a new key (the old one is cached as immutable),
re-points the song, and re-measures its length and crossfade cues.

Song covers: a single's own artwork goes in the artist's `IMAGES/` named after
the song plus "Cover" (or listed in `scripts/catalog/media-links.json`); the
same `covers.mjs --upload` stores it in `song_art`, and `song_covers` prefers it
over the album cover (`supabase/migrations/20261007040000_song_art.sql`).

## Curated playlists

Robert keeps one file per playlist in `SQUARE BUSINESS/PLAYLISTS/` (next to
`IMPRINT/`): `Late Night Drive.rtf` with one song per line ("Artist - Title", or
a unique title), an optional first line `About: …`, and an optional same-name
cover image. `node scripts/catalog/playlists.mjs [--upload]` loads them into
`playlists` (owner_type `curator`) and `playlist_songs`; a removed file archives
its playlist. Migration: `supabase/migrations/20261008000000_curated_playlists.sql`.

## Genre names

`scripts/catalog/genre-names.json` names a label's genre (and channel) where the
folder lists its styles instead — `SEMBORA - ZOUK, KOMPA & KIZOMBA` is
Afro-Caribbean.
