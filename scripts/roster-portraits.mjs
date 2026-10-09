// Builds the roster portraits in public/roster/ from the artists' IMAGES
// folders in the catalogue. Run with `node scripts/roster-portraits.mjs`;
// add `--only <slug>` to rebuild one artist (and leave the rest untouched), or
// `--preview <file.jpg>` to write a black-and-white contact sheet instead.
//
// Every card on the site is 4:5. Where an artist only has album covers, the
// crop is chosen to leave the printed title out — the station's covers carry
// their own typography and it must never show inside a roster card. Files are
// saved in colour; the site drains them to black and white in CSS.
//
// Replacing a photo under the same filename is fine on Vercel (each deploy
// re-optimises it), but the local dev server keeps its resized copies for
// hours: delete .next/dev/cache/images to see the new one locally.

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Photos live in LABELS/<Label>/Artists/<Artist>/Photos (IMPRINT/ was retired in Oct 2026).
const IMPRINT = join(homedir(), "Desktop/SQUARE MUSIC PROJECTS/SQUARE BUSINESS/LABELS");
const V = "Velvet Noir Records - R&B, Soul/Artists";
const S = "Sunflag Africa - Afrobeats/Artists";
const W = "Wavelight Records - POP/Artists";
const RT = "Riot Temple - Rock/Artists";
const RW = "Redwood Records - Country/Artists";
const PN = "Piano Nation - Afro-house, Amapiano/Artists";

// slug, source image, crop centre x, crop top, crop height — all as fractions
// of the source. Width is always 4:5 of the height.
const PORTRAITS = [
  ["fizz", `${S}/Fizz/Photos/Fizz 1.jpg`, 0.5, 0, 1],
  // New look (Oct 2026, the "Holy Moly" era): the close-up, not the full-length shot.
  ["neka", `${S}/Neka/Photos/Neka 1.png`, 0.5, 0, 1],
  // Robert removed the printed titles from Bantan's and Echo Rae's covers.
  ["bantan", `${V}/Bantan/Photos/Cover II.jpg`, 0.42, 0, 1],
  ["sanza-benito", `${S}/Sanza Benito/Photos/Benito 1.jpg`, 0.5, 0, 1],
  ["pala", `${S}/Pala/Photos/Pala 1.png`, 0.5, 0, 1],
  ["nova-liyah", `${W}/Nova Liyah/Photos/2.png`, 0.5, 0, 1],
  ["echo-rae", `${W}/Echo Rae/Photos/Echo 1.jpg`, 0.45, 0, 1],
  ["lumi-astra", `${W}/Lumi Astra/Photos/2.jpg`, 0.5, 0, 1],
  ["lea-babi", `${V}/Lea Babi/Photos/hero 1.png`, 0.5, 0, 1],
  ["lucas-meno", `${V}/Lucas Meno/Photos/02.jpg`, 0.5, 0, 1],
  ["virgo-dunst", `${V}/Virgo Dunst/Photos/3.jpg`, 0.5, 0, 1],
  ["j-cruz", `${W}/J Cruz/Photos/2.jpg`, 0.5, 0, 1],
  ["riven-cole", `${W}/Riven Cole/Photos/01.jpg`, 0.5, 0, 1],
  ["noah-rust", `${RT}/Noah Rust/Photos/Noah Rust.png`, 0.5, 0, 1],
  ["vegah-riot", `${RT}/Vegah Riot/Photos/02.png`, 0.5, 0, 1],
  ["saka", `${W}/Saka/Photos/1.jpg`, 0.45, 0.12, 0.85, [`${W}/Saka/Photos/1.jpg`, 0.42, 0.14, 0.64]],
  ["sadie-rose", `${RW}/Sadie Rose/Photos/Sadie 1.jpg`, 0.42, 0, 1],
  // Ash's photos carry a strip of colour swatches down the left edge: keep it out.
  ["ash-revenant", `${RT}/Ash Revenant/Photos/1.png`, 0.47, 0, 1, [`${RT}/Ash Revenant/Photos/1.png`, 0.52, 0.03, 0.94]],
  ["iron-mirage", `${RT}/Iron Mirage/Photos/Iron Mirage 1.png`, 0.52, 0, 1],
  ["lunah", `${V}/Lunah/Photos/Lunah 1.jpg`, 0.5, 0.03, 1],
  // The group shot keeps all three faces in a 4:5 card; today's drop (square)
  // uses the head-and-shoulders close-up, which only fits all three square.
  // Both of them, full length; the square drop crop keeps their faces.
  ["litha-flow", `${PN}/Litha Flow/Photos/hero 1.png`, 0.5, 0, 1],
  ["luv-tonez", `${V}/Luv Tonez/Photos/Luv Tonez.jpeg`, 0.5, 0, 1,
    [`${V}/Luv Tonez/Photos/Luv Tonez 1.jpg`, 0.5, 0, 1]],
];

// ratio is width / height: 0.8 for the 4:5 roster cards, 1 for the square
// drop artwork.
async function crop([, file, cx, fy, fh], ratio = 0.8) {
  const src = join(IMPRINT, file);
  const m = await sharp(src).metadata();
  let h = Math.round(fh * m.height);
  let w = Math.round(ratio * h);
  if (w > m.width) {
    w = m.width;
    h = Math.round(w / ratio);
  }
  const left = Math.max(0, Math.min(Math.round(cx * m.width - w / 2), m.width - w));
  const top = Math.max(0, Math.min(Math.round(fy * m.height), m.height - h));
  return sharp(src).extract({ left, top, width: w, height: h });
}

const onlyAt = process.argv.indexOf("--only");
const ONLY = onlyAt > -1 ? process.argv[onlyAt + 1] : null;
if (ONLY && !PORTRAITS.some((p) => p[0] === ONLY)) throw new Error(`no roster entry "${ONLY}"`);

const preview = process.argv.indexOf("--preview");
if (preview > -1) {
  const TW = 200, TH = 250;
  const comps = [];
  let svg = "";
  for (const [i, p] of PORTRAITS.entries()) {
    const x = (i % 5) * (TW + 10), y = Math.floor(i / 5) * (TH + 30);
    const img = await (await crop(p)).resize(TW, TH).grayscale().jpeg({ quality: 75 }).toBuffer();
    comps.push({ input: img, left: x, top: y });
    svg += `<text x="${x}" y="${y + TH + 17}" font-family="Helvetica" font-size="13">${p[0]}</text>`;
  }
  const width = 5 * (TW + 10), height = Math.ceil(PORTRAITS.length / 5) * (TH + 30);
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${svg}</svg>`), left: 0, top: 0 });
  await sharp({ create: { width, height, channels: 3, background: "#fff" } })
    .composite(comps).jpeg({ quality: 80 }).toFile(process.argv[preview + 1]);
} else {
  await mkdir(join(root, "public/roster"), { recursive: true });
  for (const p of PORTRAITS.filter((p) => !ONLY || p[0] === ONLY)) {
    // 960x1200 is ~3x the largest card; mozjpeg keeps each well under 200KB.
    const out = await (await crop(p)).resize(960, 1200).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await writeFile(join(root, "public/roster", `${p[0]}.jpg`), out);
    // Today's drop shows artwork square (desktop and phones); a square crop of
    // the same photo — or the entry's own square source — shows uncropped.
    const squareEntry = p[5] ? [p[0], ...p[5]] : p;
    const sq = await (await crop(squareEntry, 1)).resize(1200, 1200).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await writeFile(join(root, "public/roster", `${p[0]}-square.jpg`), sq);
    console.log(`public/roster/${p[0]}.jpg  ${Math.round(out.length / 1024)}KB  + square ${Math.round(sq.length / 1024)}KB`);
  }
  // The home page's channel cards ("What we play") are square too. Each is
  // fronted by an artist from that channel's imprint.
  for (const [name, file, cx] of ONLY ? [] : [
    ["pop-lumi-astra", `${W}/Lumi Astra/Photos/2.jpg`, 0.5],
    ["rnb-bantan", `${V}/Bantan/Photos/Cover II.jpg`, 0.5],
  ]) {
    const src = join(IMPRINT, file);
    const m = await sharp(src).metadata();
    const side = Math.min(m.width, m.height);
    const left = Math.max(0, Math.min(Math.round(cx * m.width - side / 2), m.width - side));
    const out = await sharp(src).extract({ left, top: 0, width: side, height: side })
      .resize(1200, 1200).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await writeFile(join(root, "public/channels", `${name}.jpg`), out);
    console.log(`public/channels/${name}.jpg  ${Math.round(out.length / 1024)}KB`);
  }
}
