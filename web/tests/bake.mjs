// Bake the home's lighting into web/public/bake (lightmap.png + props.bin).
// Rerun whenever house.js geometry, furniture or the light settings in bake.js change.
// Usage: node tests/bake.mjs [samples=48] [passes=3]   (dev server on :5173; takes a few minutes)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const samples = +(process.argv[2] ?? 48), passes = +(process.argv[3] ?? 3);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => m.text().startsWith('bake:') && console.log(m.text()));
page.on('pageerror', (e) => { console.error(String(e)); process.exit(1); });
await page.goto('http://localhost:5173/?fx=0');
await page.waitForFunction(() => window.inspecto, null, { timeout: 60000 });
const out = await page.evaluate((o) => window.inspecto.bake(o), { samples, passes });
await browser.close();

const dir = new URL('../public/bake/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'lightmap.png', Buffer.from(out.png.split(',')[1], 'base64'));
writeFileSync(dir + 'props.bin', Buffer.from(out.props, 'base64'));
console.log('bake: wrote', dir);
