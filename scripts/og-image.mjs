// Builds src/app/opengraph-image.jpg — the card shown when a link to the site
// is shared. Run with `node scripts/og-image.mjs` after changing the logo or
// the wall artwork; the output is committed, so nothing runs at build time.
//
// It is the hero, flattened: the station's own sleeves drained to black and
// white, dimmed and thrown out of focus, with the brand kit's tagline lockup
// on the centre seam and the gold hairline running down to meet it.
//
// JPEG, not PNG: WhatsApp drops previews much over 300KB, and a blurred
// photographic wall is exactly what PNG compresses worst. 4:4:4 chroma keeps
// the gold edges of the logo from smearing.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 1200;
const H = 630;
const INK = "#0a0a0b";

// The kit's horizontal lockup with tagline, dark version. Its paths are drawn
// as-is: this runs once, so there is no reason to slim them.
const LOGO = join(root, "scripts/og-logo.svg");

const COLS = 6;
const GAP = 12;
const TILE = (W - GAP * (COLS - 1)) / COLS; // 190
const OFFSETS = [-70, -150, -30, -120, -50, -140]; // staggered, like the drift

const covers = (await readdir(join(root, "public/wall")))
  .filter((f) => f.endsWith(".jpg"))
  .sort();

const tiles = [];
let n = 0;
for (let c = 0; c < COLS; c++) {
  for (let y = OFFSETS[c]; y < H; y += TILE + GAP) {
    const file = join(root, "public/wall", covers[(n * 7) % covers.length]);
    n++;
    const input = await sharp(file).resize(TILE, TILE).toBuffer();
    // Tiles hanging off the top are cropped rather than placed negatively.
    const top = Math.max(0, y);
    const cropTop = top - y;
    const visible = Math.min(TILE - cropTop, H - top);
    if (visible <= 0) continue;
    tiles.push({
      input: await sharp(input)
        .extract({ left: 0, top: cropTop, width: TILE, height: visible })
        .toBuffer(),
      left: Math.round(c * (TILE + GAP)),
      top,
    });
  }
}

// Two passes: sharp always applies composite() last in a pipeline, so the
// grade has to run on the finished mosaic, not the empty canvas under it.
const mosaic = await sharp({
  create: { width: W, height: H, channels: 3, background: INK },
})
  .composite(tiles)
  .png()
  .toBuffer();

const wall = await sharp(mosaic)
  .grayscale()
  .blur(2.2)
  .linear(0.3, 0) // dimmed to 30%, as on the hero
  // Explicit format: a `create` input otherwise comes back as raw pixels,
  // which sharp can't read again ("unsupported image format").
  .png()
  .toBuffer();

const logoSvg = await readFile(LOGO, "utf8");
const logoW = 900;
const logoH = Math.round((logoW * 137) / 855.33);
const logoX = (W - logoW) / 2;
const logoY = (H - logoH) / 2;
const seam = 30; // gap between the hairline and the lockup

const logo = await sharp(Buffer.from(logoSvg))
  .resize(logoW * 2) // rasterise at 2x, then downsample, for clean edges
  .resize(logoW)
  .png()
  .toBuffer();

const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${INK}" stop-opacity="0.95"/>
      <stop offset="0.22" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="0.78" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.95"/>
    </linearGradient>
    <radialGradient id="pool" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${INK}" stop-opacity="0.85"/>
      <stop offset="0.6" stop-color="${INK}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <ellipse cx="${W / 2}" cy="${H / 2}" rx="620" ry="210" fill="url(#pool)"/>
  <g stroke="#d4a24c" stroke-width="1.5" stroke-opacity="0.7">
    <line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${logoY - seam}"/>
    <line x1="${W / 2}" y1="${logoY + logoH + seam}" x2="${W / 2}" y2="${H}"/>
  </g>
</svg>`);

const out = await sharp(wall)
  .composite([
    { input: overlay, left: 0, top: 0 },
    { input: logo, left: Math.round(logoX), top: Math.round(logoY) },
  ])
  .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" })
  .toBuffer();

await writeFile(join(root, "src/app/opengraph-image.jpg"), out);
console.log(`opengraph-image.jpg  ${W}x${H}  ${Math.round(out.length / 1024)}KB`);
