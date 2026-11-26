// In-app detector check: real detector vs ground-truth boxes on rendered views of homes with
// freshly planted defects. Note: decals come from the same pool the detector trained on, so this
// measures "does it work in the app", not generalisation (ml/evaluate.py does that on real photos).
// Usage: node tests/detect-eval.mjs [seeds=3] [shots=20] [query, e.g. '?detector=browser&ep=wasm']   (dev server + API server running)
import { chromium } from 'playwright';

const seeds = +(process.argv[2] ?? 3), shots = +(process.argv[3] ?? 20);
const browser = await chromium.launch({ channel: process.env.CHANNEL, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }); // CHANNEL=chrome: real Chrome
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => { console.error(String(e)); process.exit(1); });
await page.goto(`http://localhost:5173/${process.argv[4] ?? ''}`);
await page.waitForFunction(() => window.inspecto);
await page.click('#enter');

const iou = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - w * h);
};
const per = {}; // label -> {tp, fp, fn}
const cell = (l) => (per[l] ??= { tp: 0, fp: 0, fn: 0 });
let located = 0, truthTotal = 0;
for (let s = 9001; s < 9001 + seeds; s++) {
  await page.evaluate((s) => { window.inspecto.replant(s, 10); window._rand = window.inspecto.rng(s); }, s);
  await page.waitForTimeout(300);
  for (let k = 0; k < shots; k++) {
    const { dets, truth } = await page.evaluate(() => window.inspecto.evalShot(window._rand));
    const used = new Set();
    truthTotal += truth.length;
    for (const t of truth) {
      if (dets.some((d) => iou(d.box, t.box) >= 0.5)) located++; // found, whatever the label
      const i = dets.findIndex((d, i) => !used.has(i) && d.label === t.label && iou(d.box, t.box) >= 0.5);
      if (i >= 0) { used.add(i); cell(t.label).tp++; } else cell(t.label).fn++;
    }
    dets.forEach((d, i) => { if (!used.has(i)) cell(d.label).fp++; });
  }
}
await browser.close();
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
let TP = 0, FP = 0, FN = 0;
for (const [l, c] of Object.entries(per).sort()) {
  TP += c.tp; FP += c.fp; FN += c.fn;
  console.log(l.padEnd(16), 'precision', pct(c.tp, c.tp + c.fp).padStart(4), 'recall', pct(c.tp, c.tp + c.fn).padStart(4), `(tp ${c.tp}, fp ${c.fp}, fn ${c.fn})`);
}
console.log('ALL'.padEnd(16), 'precision', pct(TP, TP + FP).padStart(4), 'recall', pct(TP, TP + FN).padStart(4), `| located regardless of label: ${pct(located, truthTotal)} of ${truthTotal}`);
