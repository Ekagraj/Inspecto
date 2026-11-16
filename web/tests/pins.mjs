// Pinning test. Feeds ground-truth screen boxes through the pinning code and checks that
// pins land on the planted defects (position, size, room, no duplicates), then checks the
// detail card, removal and persistence. Usage: node tests/pins.mjs [outDir]  (dev server on :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const open = async () => {
  await page.goto('http://localhost:5173/');
  await page.waitForFunction(() => window.inspecto);
  await page.click('#enter');
};
await open();

// 1. Accuracy over several random homes and many random views.
const stats = await page.evaluate(async () => {
  const I = window.inspecto, rows = [];
  let dupes = 0, strays = 0, planted = 0, found = 0;
  for (let seed = 201; seed <= 206; seed++) {
    I.replant(seed, 10);
    I.pins.clear();
    await new Promise((r) => setTimeout(r, 200));
    const rand = I.rng(seed * 31);
    for (let k = 0; k < 30; k++) {
      I.teleport(...I.randomPose(rand));
      await I.analyzeTruth();
    }
    const truth = I.planted(), used = new Set();
    planted += truth.length;
    for (const f of I.pins.findings) {
      const near = truth.map((d) => ({ d, dist: Math.hypot(d.pos[0] - f.pos[0], d.pos[1] - f.pos[1], d.pos[2] - f.pos[2]) })).sort((a, b) => a.dist - b.dist)[0];
      if (near.dist > 0.5) { strays++; continue; }
      if (used.has(near.d.id)) dupes++;
      used.add(near.d.id);
      rows.push({
        dist: near.dist, room: f.room === near.d.room, surface: f.surface === near.d.surface,
        label: f.label === near.d.label || f.label === 'damaged_tile',
        size: Math.max(Math.abs(f.sizeM[0] / near.d.size[0] - 1), Math.abs(f.sizeM[1] / near.d.size[1] - 1)),
      });
    }
    found += used.size;
  }
  I.pins.clear();
  const q = (key, p) => rows.map((r) => r[key]).sort((a, b) => a - b)[Math.floor((rows.length - 1) * p)];
  return {
    pins: rows.length, planted, found, dupes, strays,
    posMedian: q('dist', 0.5), pos95: q('dist', 0.95), sizeMedian: q('size', 0.5), size90: q('size', 0.9),
    wrongRoom: rows.filter((r) => !r.room).length, wrongSurface: rows.filter((r) => !r.surface).length, wrongLabel: rows.filter((r) => !r.label).length,
  };
});
console.log('accuracy:', JSON.stringify(stats, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
if (stats.dupes) errors.push(`${stats.dupes} duplicate pins`);
if (stats.strays) errors.push(`${stats.strays} pins far from any planted defect`);
if (stats.wrongRoom || stats.wrongSurface || stats.wrongLabel) errors.push('pin with wrong room, surface or label');
if (stats.posMedian > 0.05 || stats.pos95 > 0.25) errors.push('pin position error too high');
if (stats.sizeMedian > 0.15) errors.push('pin size error too high');
if (stats.found < stats.planted * 0.6) errors.push('too few planted defects pinned');

// 2. Detail card, removal, persistence (listing home).
await page.evaluate(async () => {
  const I = window.inspecto;
  I.replant(7);
  await new Promise((r) => setTimeout(r, 200));
  const rand = I.rng(99);
  for (let k = 0; k < 25; k++) { I.teleport(...I.randomPose(rand)); await I.analyzeTruth(); }
  const f = I.pins.findings.find((f) => f.surface === 'wall');
  I.teleport(f.pos[0] + f.normal[0] * 1.6, f.pos[2] + f.normal[2] * 1.6, Math.atan2(f.normal[0], f.normal[2]), Math.atan2(f.pos[1] - 1.6, 1.6));
});
const before = await page.evaluate(() => window.inspecto.pins.findings.length);
await page.waitForSelector('#chip:not([hidden])', { timeout: 15000 }).catch(() => errors.push('no hover chip at the crosshair'));
await page.keyboard.press('KeyE');
await page.waitForTimeout(200);
if (await page.isHidden('#card')) errors.push('E did not open the detail card');
await page.screenshot({ path: `${out}/pin-card.png` });
console.log('card:', await page.textContent('#card-title'), '|', await page.textContent('#card-where'), '|', await page.textContent('#card-size'), '|', await page.textContent('#card-cost'));

await page.reload();
await page.waitForFunction(() => window.inspecto);
const restored = await page.evaluate(() => window.inspecto.pins.findings.length);
if (restored !== before) errors.push(`persistence: ${before} findings before reload, ${restored} after`);
console.log('summary:', await page.textContent('#sum-n'), 'findings,', await page.textContent('#sum-cost'));

await page.click('#enter');
await page.evaluate(() => {
  const I = window.inspecto, f = I.pins.findings.find((f) => f.surface === 'wall');
  I.teleport(f.pos[0] + f.normal[0] * 1.6, f.pos[2] + f.normal[2] * 1.6, Math.atan2(f.normal[0], f.normal[2]), Math.atan2(f.pos[1] - 1.6, 1.6));
});
await page.waitForSelector('#chip:not([hidden])', { timeout: 15000 }).catch(() => {});
await page.mouse.click(640, 360); // click the pin at the centre of the view
await page.waitForTimeout(200);
if (await page.isHidden('#card')) errors.push('click did not open the detail card');
await page.keyboard.press('KeyX');
await page.waitForTimeout(200);
const after = await page.evaluate(() => window.inspecto.pins.findings.length);
if (after !== before - 1 || !(await page.isHidden('#card'))) errors.push('X did not remove the finding');
await page.evaluate(() => window.inspecto.teleport(4.6, 3.4, 0.6));
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/pins-room.png` });

await browser.close();
if (errors.length) { console.error('FAIL\n' + errors.join('\n')); process.exit(1); }
console.log('pins ok');
