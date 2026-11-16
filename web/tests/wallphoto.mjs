// Wall-photo test: a real photo the model never trained on is hung on a living-room wall with
// the P key, analyzed by the real detector and pinned with a real-world size.
// Usage: node tests/wallphoto.mjs [outDir]  (dev server on :5173, API on :8000)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const file = '../data/test/istockphoto-1215728829-612x612_jpg.rf.01452fe7bb1d39095ab56c077b831f95.jpg'; // water stain, 612 x 408
const photo = { image: 'data:image/jpeg;base64,' + readFileSync(file).toString('base64'), widthM: 1, aspect: 612 / 408 };

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const check = (ok, msg) => { if (!ok) errors.push(msg); console.log(ok ? 'ok  ' : 'FAIL', msg); };
const frames = (n = 3) => page.evaluate((k) => new Promise((r) => { const f = () => (k-- > 0 ? requestAnimationFrame(f) : r()); f(); }), n);

await page.goto('http://localhost:5173/');
await page.evaluate((p) => { localStorage.clear(); localStorage.setItem('inspecto.wallphoto.v1', JSON.stringify(p)); }, photo);
await page.reload();
await page.waitForFunction(() => window.inspecto, null, { timeout: 120000 });
await page.click('#enter');
check((await page.innerText('#status')).toLowerCase().includes('press p'), 'a waiting photo is announced');

// Face the clear part of the living room's north wall from 0.65 m, so the photo fills the view.
await page.evaluate(() => window.inspecto.teleport(1.0, 0.75, 0, 0));
await frames();
await page.keyboard.press('p');
check(await page.evaluate(() => window.inspecto.wall.placed), 'P hangs the photo on the wall');
await page.waitForTimeout(1500); // texture decode
await frames();
await page.screenshot({ path: `${out}/wallphoto.png` });

const r = await page.evaluate(async () => {
  const res = await window.inspecto.analyze();
  return { dets: res?.dets.length ?? -1, findings: window.inspecto.pins.findings.map(({ thumb, ...f }) => f) };
});
const mine = r.findings.filter((f) => f.source === 'photo');
console.log('detections:', r.dets, 'photo findings:', JSON.stringify(mine.map((f) => [f.label, f.severity, ...f.sizeM.map((v) => +v.toFixed(2)), f.roomName, f.surface])));
check(mine.length >= 1, 'a defect in the photo is pinned and marked as from the photo');
check(mine.every((f) => f.roomName === 'Living room' && f.surface === 'wall'), 'it is located on the living-room wall');
check(mine.some((f) => f.sizeM[0] > 0.2 && f.sizeM[0] < 1.15 && f.sizeM[1] < 0.8), 'its size fits inside the 1.0 x 0.67 m photo');
await frames();
await page.screenshot({ path: `${out}/wallphoto-pinned.png` });

await page.reload();
await page.waitForFunction(() => window.inspecto, null, { timeout: 120000 });
check(await page.evaluate(() => window.inspecto.wall.placed), 'the photo is still on the wall after a reload');
await page.click('#enter');

await page.evaluate(() => document.querySelector('#photo-remove').click());
check(await page.evaluate(() => !window.inspecto.wall.has && localStorage.getItem('inspecto.wallphoto.v1') === null), 'Remove takes the photo down and forgets it');
check(await page.evaluate(() => !window.inspecto.pins.findings.some((f) => f.source === 'photo')), 'its pins go with it');

await browser.close();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('wall photo test passed');
