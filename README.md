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
- `/channels` — the four channels in full, plus the blocks that fill the rest of
  the week.
- `/schedule` — the whole week, hour by hour.
- `/about` — what the station is, how the music is made, who runs it.
- `/privacy` — describes what the site actually does. Accurate as built; it
  needs revisiting the moment analytics, ads or accounts are added.
- `/donate` — "Support the station". `SUPPORT_URL` in `station.ts` is `null`,
  so the page shows the three free ways to help and hides the contribution
  block entirely. Set that constant and the fourth item appears.

**Everything numeric on both pages is derived from `WEEK`** via `airtime(label)`
and friends: hours a week, days a week, when each slot runs, what is on air now,
what is next, and the ranking on the schedule page. Nothing is typed in twice,
so no page can drift out of agreement with the timetable. `OTHER_BLOCKS` is
likewise computed as "every label on the timetable that isn't one of the four
channels".

Those thirteen deliberately get a quieter treatment with no artwork. The
station's own sleeves carry baked-in typography and there are no roster
portraits that honestly represent them, so inventing imagery would have been
worse than the hierarchy being explicit: four channels have catalogues, the
rest is schedule. See the caveat at the end of "The schedule" — that hierarchy
is a claim about catalogues, not about airtime.

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
day's programming, today's drop, socials, nav.

## Icons

`app/icon.svg` is the mark; `app/apple-icon.png` is the same thing at 180×180.
That PNG is **generated pixel by pixel by a script** rather than rasterised —
there is no ImageMagick here, `next/og` fails on this setup with "Input buffer
contains unsupported image format", and drawing the SVG to a canvas silently
produced a blank square. The generator is short and lives in the commit history;
regenerate it that way if the mark changes. It is 549 bytes.

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
  with them and must never be presented as the station's total: `ROSTER` (11) is
  only the artists with portraits on the site — always framed as "11 of ~300" —
  and `CHANNEL_TRACKS` (108) is the four channel playlists alone.
- The catalogue spans **sixteen genres in several languages**, which is wider
  than any one week of `WEEK`. That is why `GENRES` is its own list rather than
  derived from the schedule — EDM, Rock and Zouk are in rotation but did not
  appear in the week that was transcribed.

Only French is named as a language on the page, because the standing French Mix
block is the one piece of direct evidence. Ask before naming others.

## Still to build

Built so far: the home page and `/channels`. Roster, Schedule, About, Contact,
Media and Donate still only exist as sections on the home page or not at all.

The old site remains at `../musicsquareradio3` as a reference.
