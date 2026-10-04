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
There are no environment variables to set.

The first build takes about a minute and gives you a live `.vercel.app` URL.
Check it before touching DNS.

## 3. Point the domain at it

In the Vercel project: **Settings → Domains**. Add both `musicsquareradio.com`
and `www.musicsquareradio.com`, then create the DNS records Vercel shows you at
whoever manages the domain.

Leave the old site running until the new one resolves. Shared-link previews
take their address from Vercel's `VERCEL_PROJECT_PRODUCTION_URL` (see
`src/app/layout.tsx`), which follows the production domain on its own — but it
is read at build time, so **redeploy once after the domain is attached**
(Deployments → latest → Redeploy) or previews keep pointing at `.vercel.app`.
That still works, it just shows the wrong address under the card.

If previews ever show nothing, check that **Settings → Environment Variables →
Automatically expose System Environment Variables** is on. Without it the site
falls back to `www.musicsquareradio.com`, which only works once DNS has moved.

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
| Today's featured record | `DROP` |
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

**The "Play the drop" audio is borrowed.** `DROP.audio` in `station.ts` points at
a file on the *old* project's Vercel Blob storage. It works today, but deleting
that old Vercel project will silence it. Re-upload that MP3 alongside this site
when convenient and update the constant.

---

## Note on the home folder

Your home folder is itself a git repository, so this project sits nested
inside one. That is harmless — git treats a directory with its own `.git` as a
separate repo and will not track its contents — but it means `git` commands run
from your home folder are talking to a *different* repository. Always `cd` into
`~/Sites/musicsquareradio-2026` first.
