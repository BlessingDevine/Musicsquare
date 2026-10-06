// Builds the roster portraits in public/roster/ from the artists' IMAGES
// folders in the catalogue. Run with `node scripts/roster-portraits.mjs`;
// add `--preview <file.jpg>` to write a black-and-white contact sheet instead.
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
const IMPRINT = join(homedir(), "Desktop/SQUARE MUSIC PROJECTS/SQUARE BUSINESS/IMPRINT");
const V = "VELVET NOIR RECORDS - R&B:SOUL/ARISTS";
const S = "SUNFLAG AFRICA - AFROBEAT/ARISTS";
const W = "WAVELIGHT RECORDS - POP/ARISTS";
const RT = "RIOT TEMPLE - ROCK/ARISTS";

// slug, source image, crop centre x, crop top, crop height — all as fractions
// of the source. Width is always 4:5 of the height.
const PORTRAITS = [
  ["fizz", `${S}/FIZZ/IMAGES/Fizz 1.jpg`, 0.5, 0, 1],
  // Robert removed the printed titles from Bantan's and Echo Rae's covers.
  ["bantan", `${V}/BANTAN/IMAGES/Cover II.jpg`, 0.42, 0, 1],
  ["sanza-benito", `${S}/SANZA BENITO/IMAGES/Benito 1.jpg`, 0.5, 0, 1],
  ["pala", `${S}/PALA/IMAGES/Pala 1.png`, 0.5, 0, 1],
  ["nova-liyah", `${W}/NOVA LIYAH/IMAGES/2.png`, 0.5, 0, 1],
  ["echo-rae", `${W}/ECHO RAE/IMAGES/Echo 1.jpg`, 0.45, 0, 1],
  ["lumi-astra", `${W}/LUMI ASTRA/IMAGES/2.jpg`, 0.5, 0, 1],
  ["lea-babi", `${V}/LEA BABI/IMAGES/Lea 1.png`, 0.5, 0, 1], // already 4:5
  ["lucas-meno", `${V}/LUCAS MENO/IMAGES/02.jpg`, 0.5, 0, 1],
  ["virgo-dunst", `${V}/VIRGO DUNST/IMAGES/3.jpg`, 0.5, 0, 1],
  ["j-cruz", `${W}/J CRUZZ/IMAGES/2.jpg`, 0.5, 0, 1],
  ["riven-cole", `${W}/RIVEN COLE/IMAGES/01.jpg`, 0.5, 0, 1],
  ["noah-rust", `${RT}/NOAH RUST/IMAGES/Noah Rust.png`, 0.5, 0, 1],
  ["vegah-riot", `${RT}/VEGAH RIOT/IMAGES/02.png`, 0.5, 0, 1],
  ["saka", `${W}/SAKA/IMAGES/1.jpg`, 0.45, 0.12, 0.85, [`${W}/SAKA/IMAGES/1.jpg`, 0.42, 0.14, 0.64]],
  ["iron-mirage", `${RT}/IRON MIRAGE/IMAGES/Iron Mirage 1.png`, 0.52, 0, 1],
  ["lunah", `${V}/LUNAH/IMAGES/Lunah 1.jpg`, 0.5, 0.03, 1],
  // The group shot keeps all three faces in a 4:5 card; today's drop (square)
  // uses the head-and-shoulders close-up, which only fits all three square.
  ["luv-tonez", `${V}/LUV TONEZ/IMAGES/Luv Tonez.jpeg`, 0.5, 0, 1,
    [`${V}/LUV TONEZ/IMAGES/Luv Tonez 1.jpg`, 0.5, 0, 1]],
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
    // Today's drop shows artwork square (desktop and phones); a square crop of
    // the same photo — or the entry's own square source — shows uncropped.
    const squareEntry = p[5] ? [p[0], ...p[5]] : p;
    const sq = await (await crop(squareEntry, 1)).resize(1200, 1200).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    await writeFile(join(root, "public/roster", `${p[0]}-square.jpg`), sq);
    console.log(`public/roster/${p[0]}.jpg  ${Math.round(out.length / 1024)}KB  + square ${Math.round(sq.length / 1024)}KB`);
  }
  // The home page's channel cards ("What we play") are square too. Each is
  // fronted by an artist from that channel's imprint.
  for (const [name, file, cx] of [
    ["pop-lumi-astra", `${W}/LUMI ASTRA/IMAGES/2.jpg`, 0.5],
    ["rnb-bantan", `${V}/BANTAN/IMAGES/Cover II.jpg`, 0.5],
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
