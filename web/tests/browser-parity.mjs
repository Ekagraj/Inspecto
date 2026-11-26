// In-browser detector vs the Python ONNX reference, on the same photos.
// 1. ml/parity.py --dump DIR writes the reference (boxes + model input tensors).
// 2. node tests/browser-parity.mjs DIR [chromium|webkit|chrome] [webgpu|wasm]   (dev server running)
// Reports the resized-tensor difference and a box table like ml/parity.py's.
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';

const [dir, engine = 'chromium', ep = ''] = process.argv.slice(2);
const ref = JSON.parse(readFileSync(`${dir}/ref.json`, 'utf8'));
const launch = engine === 'webkit' ? webkit.launch() : chromium.launch({ channel: engine === 'chrome' ? 'chrome' : undefined, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const browser = await launch;
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'warning' && console.log('  [page]', m.text().slice(0, 200)));
await page.goto(`http://localhost:5173/photo.html?detector=browser${ep ? `&ep=${ep}` : ''}`);

const iou = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w <= 0 || h <= 0 ? 0 : (w * h) / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - w * h);
};
/** Same pairing as ml/parity.py compare(). */
function compare(want, got) {
  const free = [...want], pairs = [];
  for (const g of [...got].sort((a, b) => b.score - a.score)) {
    const best = free.filter((r) => r.label === g.label).sort((a, b) => iou(b.box, g.box) - iou(a.box, g.box))[0];
    if (best && iou(best.box, g.box) >= 0.5) { free.splice(free.indexOf(best), 1); pairs.push([best, g]); }
  }
  return { pairs: pairs.length, onlyRef: free.length, onlyBrowser: got.length - pairs.length,
    score: Math.max(0, ...pairs.map(([r, g]) => Math.abs(r.score - g.score))), iou: Math.min(1, ...pairs.map(([r, g]) => iou(r.box, g.box))) };
}

const rows = [];
let worstTensor = 0, sumMean = 0, backend = '', bad = 0;
for (const r of ref) {
  const name = r.path.split('/').pop();
  const out = await page.evaluate(async ({ img, tensor, type }) => {
    const { askWorker } = await import('/src/detect.js');
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes(img)], { type });
    const want = new Float32Array(bytes(tensor).buffer);
    const t = await askWorker({ type: 'tensor', image: blob });
    let max = 0, sum = 0;
    for (let i = 0; i < want.length; i++) { const d = Math.abs(t.tensor[i] - want[i]); sum += d; if (d > max) max = d; }
    const d = await askWorker({ type: 'detect', image: blob });
    return { max, mean: sum / want.length, dets: d.detections, backend: d.backend, ms: d.ms, width: t.width, height: t.height };
  }, { img: readFileSync(r.path).toString('base64'), tensor: readFileSync(`${dir}/${r.tensor}`).toString('base64'), type: 'image/jpeg' });
  backend = out.backend;
  worstTensor = Math.max(worstTensor, out.max);
  sumMean += out.mean;
  const c = compare(r.dets, out.dets);
  rows.push(c);
  if (c.onlyRef || c.onlyBrowser) { bad++; console.log('  differs:', name, JSON.stringify(r.dets), JSON.stringify(out.dets)); }
  if (name.startsWith('portrait_exif6')) {
    console.log(`  portrait EXIF 6: browser read ${out.width}x${out.height} (${out.height > out.width ? 'upright, portrait' : 'NOT turned'}), boxes ${JSON.stringify(out.dets.map((d) => d.box.map((v) => +v.toFixed(3))))} vs Python ${JSON.stringify(r.dets.map((d) => d.box.map((v) => +v.toFixed(3))))}`);
    if (out.height <= out.width) bad++;
  }
}
await browser.close();
// Tensor values are (pixel / 255 - mean) / std, so one grey level is about 1 / (255 * 0.225) = 0.017.
console.log(`\n${engine}, ${backend}: input tensor max |diff| ${worstTensor.toExponential(2)} (${(worstTensor * 255 * 0.229).toFixed(3)} grey levels), mean ${(sumMean / ref.length).toExponential(2)}`);
console.log(`| Build | Photos | Boxes (Python ONNX) | Paired | Only in Python | Only in browser | Worst score diff | Lowest pair IoU |`);
console.log(`| browser ${backend} (${engine}) | ${ref.length} | ${rows.reduce((s, c) => s + c.pairs + c.onlyRef, 0)} | ${rows.reduce((s, c) => s + c.pairs, 0)} | ${rows.reduce((s, c) => s + c.onlyRef, 0)} | ${rows.reduce((s, c) => s + c.onlyBrowser, 0)} | ${Math.max(...rows.map((c) => c.score)).toFixed(3)} | ${Math.min(...rows.map((c) => c.iou)).toFixed(3)} |`);
process.exit(bad ? 1 : 0);
