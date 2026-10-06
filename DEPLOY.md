# Deploying and updating

The site lives at `~/Sites/musicsquareradio-2026`. It is a git repository with
one commit on `main` and nothing pushed anywhere yet.

**Do not work in the Google Drive copy.** The original is still at
`Desktop/SQUARE MUSIC PROJECTS/SQUARE BUSINESS/MUSIC SQUARE RADIO/WEBSITE/musicsquareradio-2026`
as a backup. Drive corrupted files in it twice during the build — it stripped the
extension off `src/lib/station.ts` and left duplicate `* 2.ts` files, which
surfaced as errors in a dozen files that were fine. Once GitHub has this, delete
the Drive copy; git is the better backup.

---

## 1. Put it on GitHub

Create a new **empty** repository at github.com/new — no README, no .gitignore,
nothing, or the first push will conflict. Then:

```bash
cd ~/Sites/musicsquareradio-2026
git remote add origin https://github.com/YOUR-USERNAME/musicsquareradio.git
git push -u origin main
```

## 2. Connect Vercel

Go to **vercel.com/new** and import the repository. Vercel detects Next.js on
its own — do not change the build command, output directory or install command.

**Environment variables** (Settings → Environment Variables, all environments).
The live channels need exactly these three, all safe to be public:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → Publishable key |
| `NEXT_PUBLIC_AUDIO_BASE_URL` | `https://d1j1hqrpj9spbo.cloudfront.net` |

**Never add `SUPABASE_SECRET_KEY` to Vercel.** Only the importer on the Mac
uses it. Without these three, the site still builds and runs; the channels page
just says the channels are being tuned and the home page hides its channel
cards. After adding or changing them, redeploy — they are read at build time.

The first build takes about a minute and gives you a live `.vercel.app` URL.
Check it before touching DNS.

## 3. The domain

**Done, Oct 2026.** `musicsquareradio.com` is this project's primary domain and
`www.musicsquareradio.com` redirects to it. The domain is registered at GoDaddy
and its DNS already pointed at Vercel (the old v0 site was on Vercel too), so
moving it was done entirely in Vercel: remove it from the old project, add it to
this one. In the current Vercel UI, domains and environment variables both live
under **Settings → Environments → Production**.

The canonical address is fixed as `https://musicsquareradio.com` in
`src/app/layout.tsx`; link previews and the card image use it. If the primary
domain ever changes, change it there.

DNS at GoDaddy: one A record, `@` → `216.150.1.1` (Vercel's current address;
the older `216.198.79.1` was removed in Oct 2026), and `www` as a CNAME to
Vercel. The MX and TXT records there run the station's Microsoft 365 email —
leave them alone.

The old v0 Vercel project is no longer used by this site (the drop used to
play from its Blob storage; it now comes from the catalogue).

---

## Updating the site

```bash
cd ~/Sites/musicsquareradio-2026
# make the change
npm run dev          # check it at http://localhost:3200
git add -A
git commit -m "what changed"
git push
```

Vercel rebuilds and goes live in about a minute.

To check something risky before it is public, push a branch instead — Vercel
builds it to a private preview URL and leaves the live site alone:

```bash
git checkout -b new-schedule
git push -u origin new-schedule
```

### Almost everything you'll change is in one file

`src/lib/station.ts` holds:

| What | Constant |
| --- | --- |
| The weekly schedule | `WEEK` |
| Featured artists | `ROSTER` |
| The four channels | `CHANNELS` |
| Genres on the About page | `GENRES` |
| Catalogue headline figures | `CATALOGUE` |
| Navigation | `NAV` |
| Social links | `SOCIALS` |
| Donate button target | `SUPPORT_URL` |

**If you edit `WEEK`, keep it summing to 168 hours** — seven days, no gaps, no
overlaps, end-of-day written as `24`. That total is the only integrity check the
schedule has, and every hours-per-week figure on the site is derived from it.

### Before pushing anything substantial

```bash
npx tsc --noEmit && npx eslint src && npm run build
```

If that passes, Vercel will build too.

---

## If a deploy goes wrong

Vercel keeps every previous deployment. Open the project → **Deployments**, find
the last good one, and choose **Promote to Production**. That is instant and does
not require a git revert. Fix the code afterwards, at your own pace.

---

## Two things to know

**The audio does not go through your host.** Listeners connect straight to
RadioKing, so hosting only ever serves the page — roughly 220KB. Traffic spikes
cost you nothing on Vercel's free tier.

**Today's drop picks itself.** It rotates daily from the catalogue
(`src/lib/drop.ts`) — nothing to update. An artist joins the rotation once
they are on `ROSTER` and have released music in the catalogue.

---

## Note on the home folder

Your home folder is itself a git repository, so this project sits nested
inside one. That is harmless — git treats a directory with its own `.git` as a
separate repo and will not track its contents — but it means `git` commands run
from your home folder are talking to a *different* repository. Always `cd` into
`~/Sites/musicsquareradio-2026` first.
