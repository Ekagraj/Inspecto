// Smoke test: open the app headless, visit each room, screenshot, fail on console errors.
// Usage: node tests/smoke.mjs [outDir]   (dev server must be running on :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const VIEWS = { living: [4.6, 3.4, 0.6], kitchen: [6.6, 4.0, -0.5], hall: [9.3, 5.2, 1.57], bedroom: [5.2, 6.5, 2.2], bath: [6.6, 6.5, -2.4] };

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.inspecto);
await page.evaluate(() => window.inspecto.ready);
await page.click('#enter');
for (const [name, v] of Object.entries(VIEWS)) {
  await page.evaluate((v) => window.inspecto.teleport(...v), v);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
}
// Walking into a wall must not pass through it.
await page.evaluate(() => window.inspecto.teleport(1, 1, 0));
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');
const z = await page.evaluate(() => window.inspecto.app.camera.position.z);
if (z < 0.25 || z > 0.6) errors.push(`collision check failed: z=${z}`);

// Stand in front of the first wall defect and analyze the view.
const pose = await page.evaluate(() => {
  const d = window.inspecto.planted().find((d) => d.surface === 'wall');
  const x = d.pos[0] + d.normal[0] * 1.8, z = d.pos[2] + d.normal[2] * 1.8;
  return [x, z, Math.atan2(d.normal[0], d.normal[2]), Math.atan2(d.pos[1] - 1.6, 1.8)];
});
await page.evaluate((p) => window.inspecto.teleport(...p), pose);
await page.waitForTimeout(300);
const dets = await page.evaluate(() => window.inspecto.analyze());
console.log('detections:', JSON.stringify(dets.map((d) => [d.label, d.score])));
await page.screenshot({ path: `${out}/analyze.png` });
if (!dets.length) errors.push('no detections in front of a planted defect');

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('smoke ok');
