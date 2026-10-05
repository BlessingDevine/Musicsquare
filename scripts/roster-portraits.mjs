// Builds the roster portraits in public/roster/ from the artists' IMAGES
// folders in the catalogue. Run with `node scripts/roster-portraits.mjs`;
// add `--preview <file.jpg>` to write a black-and-white contact sheet instead.
//
// Every card on the site is 4:5. Where an artist only has album covers, the
// crop is chosen to leave the printed title out — the station's covers carry
// their own typography and it must never show inside a roster card. Files are
// saved in colour; the site drains them to black and white in CSS.

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMPRINT = join(homedir(), "Desktop/SQUARE MUSIC PROJECTS/SQUARE BUSINESS/IMPRINT");
const V = "VELVET NOIR RECORDS - R&B:SOUL/ARISTS";
const S = "SUNFLAG AFRICA - AFROBEAT/ARISTS";
const W = "WAVELIGHT RECORDS - POP/ARISTS";

// slug, source image, crop centre x, crop top, crop height — all as fractions
// of the source. Width is always 4:5 of the height.
const PORTRAITS = [
  ["fizz", `${S}/FIZZ/IMAGES/Fizz 1.jpg`, 0.5, 0, 1],
  // Cover II ("Closer Than Close"): the title sits on the right; crop left.
  ["bantan", `${V}/BANTAN/IMAGES/Cover II.jpg`, 0.264, 0.14, 0.66],
  ["sanza-benito", `${S}/SANZA BENITO/IMAGES/Benito 1.jpg`, 0.5, 0, 1],
  ["pala", `${S}/PALA/IMAGES/Pala 1.png`, 0.5, 0, 1],
  ["nova-liyah", `${W}/NOVA LIYAH/IMAGES/2.png`, 0.5, 0, 1],
  // Cover 1: "Echo Rae" is printed across the top; start below it.
  ["echo-rae", `${W}/ECHO RAE/IMAGES/Echo Cover 1.jpg`, 0.412, 0.22, 0.78],
  // Vol III: the title is along the bottom; stop above it.
  ["lumi-astra", `${W}/LUMI ASTRA/IMAGES/Lumi III.jpg`, 0.504, 0.06, 0.66],
  ["lunah", `${V}/LUNAH/IMAGES/Lunah 1.jpg`, 0.5, 0.03, 1],
  ["luv-tonez", `${V}/LUV TONEZ/IMAGES/Luv Tonez 2.jpg`, 0.5, 0, 1],
];

async function crop([, file, cx, fy, fh]) {
  const src = join(IMPRINT, file);
  const m = await sharp(src).metadata();
  let h = Math.round(fh * m.height);
  let w = Math.round(0.8 * h);
  if (w > m.width) {
    w = m.width;
    h = Math.round(w / 0.8);
  }
  const left = Math.max(0, Math.min(Math.round(cx * m.width - w / 2), m.width - w));
  const top = Math.max(0, Math.min(Math.round(fy * m.height), m.height - h));
  return sharp(src).extract({ left, top, width: w, height: h });
}

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
  for (const p of PORTRAITS) {
    // 960x1200 is ~3x the largest card; mozjpeg keeps each well under 200KB.
    const out = await (await crop(p)).resize(960, 1200).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await writeFile(join(root, "public/roster", `${p[0]}.jpg`), out);
    console.log(`public/roster/${p[0]}.jpg  ${Math.round(out.length / 1024)}KB`);
  }
  // The home page's "drop" shows its artwork square; the new Luv Tonez photo
  // is square already, so it goes in uncropped.
  const drop = await sharp(join(IMPRINT, `${V}/LUV TONEZ/IMAGES/Luv Tonez 2.jpg`))
    .resize(1200, 1200).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  await writeFile(join(root, "public/roster/luv-tonez-square.jpg"), drop);
  console.log(`public/roster/luv-tonez-square.jpg  ${Math.round(drop.length / 1024)}KB`);
}
