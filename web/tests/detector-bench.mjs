// Timing and memory of the in-browser detector, one fresh browser per configuration (empty cache).
// Usage: node tests/detector-bench.mjs REFDIR [chrome|webkit|chromium] [webgpu|wasm] [fp32|fp16] [runs=20]
// REFDIR is from ml/parity.py --dump (its photos are used). Dev server or `vite preview` on :5173.
// Memory: macOS `footprint` of every browser process (includes GPU memory on Apple silicon), after - before,
// then again after freeDetector(). Columns: browser, backend, build, size, fetch ms, compile ms, first run ms,
// median inference ms, median per-photo ms (decode + resize + inference), memory +MB, after free +MB, longest frame gap ms, GPU.
import { chromium, webkit } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [dir, engine = 'chrome', ep = 'webgpu', model = 'fp32', runs = '20'] = process.argv.slice(2);
const photos = JSON.parse(readFileSync(`${dir}/ref.json`, 'utf8')).map((r) => readFileSync(r.path).toString('base64'));
const browser = engine === 'webkit' ? await webkit.launch()
  : await chromium.launch({ channel: engine === 'chrome' ? 'chrome' : undefined, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage();
await page.goto(`http://localhost:5173/photo.html?detector=browser&ep=${ep}&model=${model}`);
await page.waitForTimeout(1500);

/** Total footprint (MB) of the browser's processes. */
function footprintMB() {
  const kids = (pid) => { try { return execFileSync('pgrep', ['-P', pid]).toString().split('\n').filter(Boolean); } catch { return []; } }; // exits 1 with no children
  const pids = [], walk = (pid) => { pids.push(pid); kids(pid).forEach(walk); };
  kids(String(process.pid)).forEach(walk); // Playwright starts the browser as a child of this process,
  if (engine === 'webkit') pids.push(...kids('1').filter((p) => { try { return /WebKit\.(GPU|WebContent|Networking)\.Development/.test(execFileSync('ps', ['-o', 'comm=', '-p', p]).toString()); } catch { return false; } })); // but WebKit's helpers are launchd's
  const out = execFileSync('footprint', ['-f', 'bytes', '--noCategories', ...pids.flatMap((p) => ['-p', p])], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return Math.round([...out.matchAll(/phys_footprint: (\d+) B/g)].reduce((s, m) => s + Number(m[1]), 0) / 2 ** 20);
}
const before = footprintMB();

const r = await page.evaluate(async ({ photos, runs }) => {
  const { askWorker } = await import('/src/detect.js');
  const blob = (b64) => new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' });
  let gap = 0, last = performance.now(), on = true; // longest gap between frames while detecting
  const tick = () => { const t = performance.now(); gap = Math.max(gap, t - last); last = t; if (on) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const t0 = performance.now();
  const first = await askWorker({ type: 'detect', image: blob(photos[0]) });
  const firstWall = performance.now() - t0;
  const ms = [], wall = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const d = await askWorker({ type: 'detect', image: blob(photos[(i + 1) % photos.length]) });
    wall.push(performance.now() - t);
    ms.push(d.ms);
  }
  on = false;
  const gpu = navigator.gpu ? await navigator.gpu.requestAdapter().then((a) => a && `${a.info?.vendor} ${a.info?.architecture}`.trim()) : 'none';
  return { backend: first.backend, timing: first.timing, warm: first.ms, firstWall, ms, wall, gap, gpu };
}, { photos, runs: +runs });
const after = footprintMB();
await page.evaluate(async () => (await import('/src/detect.js')).freeDetector()); // what leaving the page does (pagehide)
await page.waitForTimeout(3000);
const freed = footprintMB();
await browser.close();

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log(`| ${engine} | ${r.backend}${r.backend !== ep ? ` (asked ${ep})` : ''} | ${model} | ${(r.timing.bytes / 1e6).toFixed(0)} MB | ${r.timing.fetchMs} | ${r.timing.createMs} | ${r.warm} | ${median(r.ms)} | ${Math.round(median(r.wall))} | ${after - before} | ${freed - before} | ${Math.round(r.gap)} | ${r.gpu} |`);
