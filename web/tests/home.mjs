// Home-from-plan test: a real listing plan goes through the real plan reader, then the 3D shell is
// built, overviewed and walked. Plans are not in git (listing images); pass your own.
// Usage: node tests/home.mjs plan.png [plan2.png ...] [--out dir]  (dev server on :5173, API on :8000)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : 'test-results';
if (!args.length) { console.log('usage: node tests/home.mjs plan.png [...] [--out dir]'); process.exit(2); }
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const check = (ok, msg) => { if (!ok) errors.push(msg); console.log(ok ? 'ok  ' : 'FAIL', msg); };

await page.goto('http://localhost:5173/home.html');
for (const [i, plan] of args.entries()) {
  await page.setInputFiles('input[type=file]', plan);
  await page.waitForFunction(() => !document.querySelector('.home-status').textContent.startsWith('Reading'), null, { timeout: 120000 });
  const text = await page.textContent('.home-summary');
  console.log('    ', text.replace(/\s+/g, ' ').slice(0, 220));
  check(/Size read from \d+ of \d+/.test(text), `plan ${i + 1}: size read from written lengths`);
  check(/[1-9]\d* doors/.test(text) && /[1-9]\d* windows/.test(text), `plan ${i + 1}: doors and windows found`);
  check(!(await page.isDisabled('text=Walk inside')), `plan ${i + 1}: 3D ready`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/home-plan${i + 1}-overview.png` });
  await page.click('text=Walk inside');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  await page.locator('.home-3d').screenshot({ path: `${out}/home-plan${i + 1}-walk.png` });
  await page.click('text=Overview');
}
check(!errors.filter((e) => !e.startsWith('plan')).length, 'no page errors ' + errors.join(' | '));
await browser.close();
process.exit(errors.length ? 1 : 0);
