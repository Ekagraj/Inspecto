// Real-GPU screenshots of fixed views, for judging the look. Usage: node tests/look.mjs <outDir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const VIEWS = { living: [4.9, 3.9, 0.75, -0.05], kitchen: [6.5, 4.0, -0.6, -0.05], bedroom: [5.3, 6.5, 2.2, -0.05], hall: [9.3, 5.2, 1.57, 0] };
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error(String(e)));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log(m.type(), m.text().slice(0, 200)));
await page.goto('http://localhost:5173/?fx=1');
await page.waitForFunction(() => window.inspecto, null, { timeout: 60000 });
await page.click('#enter');
for (const [name, v] of Object.entries(VIEWS)) {
  await page.evaluate((v) => window.inspecto.teleport(...v), v);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/look-${name}.jpg`, type: 'jpeg', quality: 80 });
}
await browser.close();
