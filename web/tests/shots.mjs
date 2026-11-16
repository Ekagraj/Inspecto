// Screenshots with full post-processing, for visual checks and the README.
// Usage: node tests/shots.mjs [outDir]   (dev server on :5173; pins use ground-truth boxes, no detector needed)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
page.on('pageerror', (e) => console.error(String(e)));
const face = (f, d = 1.9) => [f.pos[0] + f.normal[0] * d, f.pos[2] + f.normal[2] * d, Math.atan2(f.normal[0], f.normal[2]), Math.atan2(f.pos[1] - 1.6, d)];

await page.goto('http://localhost:5173/?fx=1');
await page.waitForFunction(() => window.inspecto);
await page.evaluate(() => window.inspecto.pins.clear());
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/start.png` });

await page.click('#enter');
const wall = await page.evaluate(async () => {
  const I = window.inspecto, rand = I.rng(5);
  for (let k = 0; k < 30; k++) { I.teleport(...I.randomPose(rand)); await I.analyzeTruth(); }
  return I.pins.findings.find((f) => f.surface === 'wall' && f.room !== 'bath');
});
await page.evaluate((p) => window.inspecto.teleport(...p), face(wall));
await page.waitForTimeout(1500);
await page.evaluate(() => window.inspecto.analyzeTruth());
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/analyze.png` });
await page.waitForTimeout(2600);
await page.keyboard.press('KeyE');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/finding.png` });
await page.keyboard.press('KeyE');
await page.evaluate(() => window.inspecto.teleport(4.9, 3.9, 0.75, -0.05));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/living.png` });
await browser.close();
console.log('shots saved to', out);
