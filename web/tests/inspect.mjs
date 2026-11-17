// Condition-report test: a move-in inspection, then its move-out, through the real page, the
// real server and the real detector. Checks retake comparison, the new-damage total,
// a person's corrections, persistence and the print layout.
// Usage: node tests/inspect.mjs [outDir]  (dev server on :5173, API on :8000)
// It creates two inspections named "TEST ..." and deletes exactly those two folders at the end.
import { chromium } from 'playwright';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const T = '../data/test/';
const stain = T + 'istockphoto-1215728829-612x612_jpg.rf.01452fe7bb1d39095ab56c077b831f95.jpg';
const peeling = T + 'peeling_paint-53525d4d-dc70-11ed-a742-88b1113a23b0_jpg.rf.3e940b00c432344cafac27d94e521ce7.jpg';
const name = `TEST flat ${Date.now()}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const check = (ok, msg) => { if (!ok) errors.push(msg); console.log(ok ? 'ok  ' : 'FAIL', msg); };
const idle = (photos) => page.waitForFunction((k) => document.querySelectorAll('.photo').length === k && !document.querySelector('.file.busy'), photos, { timeout: 240000 });
const num = async (sel) => Number((await page.locator(sel).first().innerText()).replace(/[^\d]/g, ''));
const stat = async (i) => Number(await page.locator('.stats b').nth(i).innerText());
const settle = () => page.waitForTimeout(700);

try {
  await page.goto('http://localhost:5173/inspect.html');
  await page.waitForSelector('#new-name');

  // 1. Move-in: one photo of the living room.
  await page.fill('#new-name', name);
  await page.click('.new-form button');
  await page.waitForSelector('.title h1');
  check((await page.locator('.title h1').innerText()) === name && page.url().includes('?id='), 'a move-in inspection is created and opened');
  await page.setInputFiles('.new-form .file input', stain);
  await page.waitForSelector('.status.error');
  check((await page.locator('.photo').count()) === 0, 'a photo without a room name is refused with a message');
  await page.fill('#room', 'Living room');
  await page.setInputFiles('.new-form .file input', stain);
  await idle(1);
  const recorded = await page.locator('.det').count();
  check(recorded >= 1 && (await page.locator('.photo .label').first().innerText()).toLowerCase().includes('move-in'), `the move-in photo is analyzed and dated (${recorded} problem recorded)`);
  check((await page.locator('.sev.state').count()) === 0, 'a move-in photo has no new / existing marks');

  // 2. Move-out, compared with it.
  await page.click('.bar button');
  await page.waitForSelector('.insp');
  await page.locator('.insp', { hasText: name }).locator('button', { hasText: 'Start the move-out' }).click();
  await page.waitForSelector('.pair');
  check((await page.locator('.pair .file').count()) === 1 && (await num('.hero h1')) === 0, 'the move-out shows the move-in photo and asks for a retake; nothing is charged yet');

  await page.setInputFiles('.pair .file input', stain); // the same wall, unchanged
  await idle(2);
  const states = await page.locator('.pair .sev.state').allInnerTexts();
  check(states.length >= 1 && states.every((s) => s.toLowerCase() === 'was already there'), `an unchanged wall is not charged (${states.join(', ')})`);
  check((await num('.hero h1')) === 0 && (await stat(0)) === 0, 'the new-damage total is still $0');

  // 3. A wall nobody photographed at move-in: counted as new, but flagged for a person.
  await page.fill('#room', 'Hall');
  await page.setInputFiles('.new-form .file input', peeling);
  await idle(3);
  const hall = page.locator('.room', { hasText: 'Hall' });
  const fresh = await stat(0);
  check(fresh >= 2 && (await stat(2)) === fresh && (await num('.hero h1')) > 0, `${fresh} problems on the unphotographed wall count as new and are all flagged to check`);
  await page.screenshot({ path: `${out}/inspect.png`, fullPage: true });

  // 4. A person's corrections win.
  const total = await num('.hero .range b');
  await hall.locator('.det').nth(0).locator('button', { hasText: 'It was already there' }).click();
  await settle();
  check((await stat(0)) === fresh - 1 && (await stat(2)) === fresh - 1 && (await num('.hero .range b')) < total, '"It was already there" takes a problem off the bill and off the to-check list');
  await hall.locator('.det').nth(1).locator('button', { hasText: 'Not damage' }).click();
  await settle();
  check((await stat(0)) === fresh - 2, '"Not damage" strikes a problem out');
  if (fresh >= 3) {
    const row = hall.locator('.det').nth(2), before = await row.locator('.cost').innerText();
    await row.locator('select').selectOption('stairstep_crack');
    await settle();
    check((await row.locator('.cost').innerText()) !== before && (await row.locator('.meta').innerText()).includes('type set by you'), 'changing the type changes the price and is recorded as a correction');
  }
  const kept = [await stat(0), await num('.hero h1')];
  await page.reload();
  await idle(3);
  check((await stat(0)) === kept[0] && (await num('.hero h1')) === kept[1], 'everything survives a reload (it is saved on the laptop, not in the browser)');

  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: `${out}/inspect-print.png`, fullPage: true });
  check((await page.locator('.file:visible, .choice:visible').count()) === 0, 'the printed report has no buttons');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${out}/inspect-phone.png` });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'fits a phone screen without sideways scrolling');
} finally {
  // Remove exactly the two inspections this test made.
  const mine = (await page.evaluate(async () => (await fetch('/api/inspections')).json()).catch(() => [])).filter((i) => i.name === name);
  for (const i of mine) if (/^[0-9a-f]{12}$/.test(i.id) && existsSync(`../data/inspections/${i.id}/inspection.json`)) rmSync(`../data/inspections/${i.id}`, { recursive: true });
  console.log(`cleaned up ${mine.length} test inspections`);
  await browser.close();
}
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('inspect test passed');
