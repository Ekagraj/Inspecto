// Report page test: seeds findings, checks totals, grouping, offer maths, empty state, clearing.
// Usage: node tests/report.mjs [outDir]  (dev server on :5173)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const mk = (n, label, room, roomName, severity, cost, extra = {}) => ({
  n, label, room, roomName, surface: 'wall', material: 'plaster', sizeM: [0.4, 0.2], areaM2: 0.08,
  severity, score: 0.82, cost, thumb: px, pos: [0, 1, 0], normal: [0, 0, 1], ...extra,
});
const seed = [
  mk(1, 'crack', 'living', 'Living room', 'minor', { low: 100, high: 350 }),
  mk(2, 'water_seepage', 'bath', 'Bathroom', 'major', { low: 1000, high: 3000 }),
  mk(3, 'peeling_paint', 'kitchen', 'Kitchen', 'moderate', { low: 200, high: 600 }),
  mk(4, 'crack', 'living', 'Living room', 'major', { low: 500, high: 1500 }, { label: '<img src=x onerror=window.pwned=1>' }),
];

await page.goto('http://localhost:5173/report.html');
await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('inspecto.findings.v1', JSON.stringify(s)); }, seed);
await page.reload();
await page.waitForSelector('.hero');

const check = (ok, msg) => { if (!ok) errors.push(msg); console.log(ok ? 'ok  ' : 'FAIL', msg); };
const text = (sel) => page.locator(sel).first().innerText();

const low = 100 + 1000 + 200 + 500, high = 350 + 3000 + 600 + 1500;
const mid = Math.round((low + high) / 2 / 50) * 50;
check((await text('.hero h1')).replace(/[$,]/g, '') === String(mid), `headline midpoint $${mid}`);
check((await text('.hero .range')).includes(`$${low.toLocaleString('en-US')}`), 'range shows low total');
const heads = await page.locator('.room-head h2').allInnerTexts();
check(heads.join('|') === 'Living room|Kitchen|Bathroom', `rooms in order (${heads.join(', ')})`);
check((await page.locator('.item').count()) === 4, '4 finding cards');
check(!(await page.evaluate(() => window.pwned)), 'stored text is never run as HTML');
const living = await page.locator('.room').first().locator('.item h3').allInnerTexts();
check(living.length === 2, 'living room has 2 findings');
check((await page.locator('.flag').count()) >= 2, 'major findings are flagged');

// Offer maths
await page.fill('#asking', '450000');
const offer = (await text('.offer .result .big')).replace(/[$,]/g, '');
check(offer === String(450000 - mid), `suggested offer ${450000 - mid}`);
await page.reload();
await page.waitForSelector('.hero');
check((await page.inputValue('#asking')) === '450,000', 'asking price remembered');
await page.screenshot({ path: `${out}/report.png`, fullPage: true });
await page.emulateMedia({ media: 'print' });
await page.screenshot({ path: `${out}/report-print.png`, fullPage: true });
await page.emulateMedia({ media: 'screen' });

// Clear: first click arms, second clears and leaves.
await page.click('.foot .danger');
check((await page.locator('.foot .danger').innerText()).toLowerCase().startsWith('click again'), 'first click only arms');
await page.click('.foot .danger');
await page.waitForURL('http://localhost:5173/');
check((await page.evaluate(() => localStorage.getItem('inspecto.findings.v1'))) === '[]', 'findings cleared');

// Empty state
await page.goto('http://localhost:5173/report.html');
await page.waitForSelector('.empty');
await page.screenshot({ path: `${out}/report-empty.png` });
check((await page.locator('.hero').count()) === 0, 'empty state shows no totals');

await browser.close();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('report test passed');
