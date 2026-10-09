import sharp from "sharp";
import { join } from "node:path";
const [dir, ...files] = process.argv.slice(2);
// Light, low-variation lines near the middle are the dividers.
function gutter(vals, n) {
  const lo = Math.floor(n * 0.3), hi = Math.ceil(n * 0.7);
  let run = [], best = [];
  for (let i = lo; i < hi; i++) {
    if (vals[i] > 225) run.push(i); else { if (run.length > best.length) best = run; run = []; }
  }
  if (run.length > best.length) best = run;
  return best.length ? [best[0], best.at(-1)] : null;
}
for (const f of files) {
  const { data, info } = await sharp(join(dir, f)).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const rowMin = (y, x0, x1) => { let m = 255; for (let x = x0; x < x1; x += 2) m = Math.min(m, data[y * W + x]); return m; };
  const colMin = (x, y0, y1) => { let m = 255; for (let y = y0; y < y1; y += 2) m = Math.min(m, data[y * W + x]); return m; };
  // horizontal divider: rows that are light across (allowing 2% noise) — use 5th percentile
  const pct = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length * 0.05)];
  const rows = Array.from({ length: H }, (_, y) => { const a = []; for (let x = 0; x < W; x += 4) a.push(data[y * W + x]); return pct(a); });
  const h = gutter(rows, H);
  const out = { f, W, H, h, bands: [] };
  for (const [y0, y1] of [[0, h[0]], [h[1] + 1, H]]) {
    const cols = Array.from({ length: W }, (_, x) => { const a = []; for (let y = y0; y < y1; y += 4) a.push(data[y * W + x]); return pct(a); });
    out.bands.push({ y0, y1, v: gutter(cols, W) });
  }
  console.log(JSON.stringify(out));
}
