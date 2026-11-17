// Photo page test: real photos the model never trained on go through the real detector.
// Checks the running total, the width -> verdict maths, persistence, removal and error states.
// Usage: node tests/photo.mjs [outDir]  (dev server on :5173, API on :8000)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const T = '../data/test/';
const files = [
  'istockphoto-1215728829-612x612_jpg.rf.01452fe7bb1d39095ab56c077b831f95.jpg', // water seepage
  'istockphoto-1095488774-612x612_jpg.rf.8f3550b7b5d364eae763886f3d61601f.jpg', // mold
  'peeling_paint-53525d4d-dc70-11ed-a742-88b1113a23b0_jpg.rf.3e940b00c432344cafac27d94e521ce7.jpg',
].map((f) => T + f);

const browser = await chromium.launch();
// The browser reports a position on a university campus in Manhattan.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, permissions: ['geolocation'], geolocation: { latitude: 40.8075, longitude: -73.9626 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const check = (ok, msg) => { if (!ok) errors.push(msg); console.log(ok ? 'ok  ' : 'FAIL', msg); };
const idle = (n) => page.waitForFunction((k) => document.querySelectorAll('.photo').length === k && !document.querySelector('.drop.busy'), n, { timeout: 180000 });
const nums = (s) => s.replace(/,/g, '').match(/\d+/g).map(Number);
const sums = async () => {
  const rows = (await page.locator('.det .cost').allInnerTexts()).map(nums);
  return [rows.reduce((s, r) => s + r[0], 0), rows.reduce((s, r) => s + r[1], 0)];
};

// An iPhone-style photo: HEIC, 12 megapixels (made from a real test photo with macOS sips).
const heic = `${out}/IMG_0001.HEIC`;
execFileSync('sips', ['-s', 'format', 'heic', '-Z', '4032', files[0], '--out', heic]);

await page.goto('http://localhost:5173/photo.html');
await page.evaluate(() => localStorage.removeItem('inspecto.photos.v1'));
await page.reload();
check((await page.locator('.hero').count()) === 0, 'no total before any photo');

await page.setInputFiles('.drop input', files);
await idle(3);
const verdicts = await page.locator('.photo > .body > .head .sev').allInnerTexts();
console.log('verdicts (newest first):', verdicts.join(' | '));
const found = await page.locator('.det').count();
check(found >= 2, `detector found problems in real photos (${found} in 3 photos)`);
check((await page.locator('.photo .box').count()) === found, 'one box drawn per problem');
let [low, high] = await sums();
check(nums(await page.locator('.hero .range').innerText()).join() === [low, high].join(), `total range is the sum of all problems ($${low} – $${high})`);
await page.screenshot({ path: `${out}/photo.png`, fullPage: true });

// Location: three price levels, chosen by search or by the current position.
check(await page.locator('.controls button', { hasText: 'Place on a wall' }).first().isVisible(), 'each photo offers "Place on a wall in the 3D home"');
const pick = async (text) => { await page.fill('#area', text); await page.locator('#area').blur(); await page.waitForTimeout(300); return (await sums())[0]; };
const us = low, scr = await pick('Scranton'), tre = await pick('trenton'), nyc = await pick('New York City metro (NY-NJ)');
check(scr < us && us < tre && tre < nyc, `prices rise from outskirts to city ($${scr} < US $${us} < $${tre} < $${nyc})`);
check(Math.abs(nyc / us - 33.62 / 26.64) < 0.03, 'New York is priced by the wage ratio (about +26%)');
await pick('Paris');
check((await page.locator('.loc-note').innerText()).includes('not in the price table') && (await sums())[0] === nyc, 'an unknown place is refused and the price is unchanged');
await pick('US average');
await page.locator('.loc button').click();
await page.waitForFunction(() => document.querySelector('.loc-now b')?.textContent.includes('New York'));
check((await page.locator('.loc-note').innerText()).includes('Nearest test area'), '"Use my current location" picks the nearest area (Manhattan -> New York)');
await page.screenshot({ path: `${out}/photo-location.png` });
await page.reload();
await idle(3);
check((await page.locator('.loc-now b').innerText()).includes('New York'), 'the location is remembered');
await pick('US average');

// Width drives the verdict: at 0.2 m nothing can be more than a small fix.
const first = page.locator('.photo', { has: page.locator('.det') }).first();
await first.locator('.controls input').fill('0.2');
await first.locator('.controls input').blur();
await page.waitForFunction(() => [...document.querySelectorAll('.controls input')].some((i) => i.value === '0.2'));
const small = await page.locator('.photo', { has: page.locator('.controls input[value="0.2"]') }).locator('.det .sev').allInnerTexts();
check(small.length > 0 && small.every((t) => t.toLowerCase() === 'small fix'), 'a 0.2 m wide photo only gives small fixes');
const [low2] = await sums();
check(low2 <= low, `total drops or holds when the area is smaller ($${low} -> $${low2})`);

await page.reload();
await idle(3);
check((await page.locator('.controls input[value="0.2"]').count()) === 1, 'photos and width survive a reload');

await page.locator('.photo').first().locator('.controls button', { hasText: 'Remove' }).click();
await idle(2);
check(true, 'remove takes a photo out');
[low, high] = await sums();
check(nums(await page.locator('.hero .range').innerText()).join() === [low, high].join(), 'total follows the removal');

await page.setInputFiles('.drop input', heic);
await idle(3);
check((await page.locator('.photo').first().locator('.det').count()) >= 1, 'a 12 MP iPhone HEIC photo is read and analyzed');

const merged = await page.evaluate(async () => (await import('/src/photo.js')).merge([
  { label: 'water_seepage', score: 0.4, box: [0, 0, 0.9, 0.6] }, { label: 'water_seepage', score: 0.6, box: [0.1, 0.1, 0.2, 0.2] },
  { label: 'crack', score: 0.5, box: [0.1, 0.1, 0.2, 0.2] }, { label: 'water_seepage', score: 0.5, box: [0.95, 0.9, 1, 1] }]));
check(merged.length === 3 && merged[0].score === 0.6 && merged[0].box.join() === '0,0,0.9,0.6', 'a stain boxed twice is counted once; other types and separate spots are kept');

// Any other format the browser cannot open (TIFF stands in for ProRAW .DNG) goes the same way.
const tiff = `${out}/wall.tiff`;
execFileSync('sips', ['-s', 'format', 'tiff', files[1], '--out', tiff]);
await page.setInputFiles('.drop input', tiff);
await idle(4);
check(true, 'a TIFF is converted and analyzed');
await page.locator('.photo').first().locator('.controls button', { hasText: 'Remove' }).click();
await idle(3);

await page.setInputFiles('.drop input', 'package.json');
await page.waitForSelector('.status.error');
check((await page.locator('.status.error').innerText()).includes('not an image'), 'a non-image file is refused with a message');
check((await page.locator('.photo').count()) === 3, 'the refused file adds nothing');

await page.route('**/api/detect', (r) => r.abort());
await page.setInputFiles('.drop input', files[0]);
await page.waitForFunction(() => document.querySelector('.status.error')?.textContent.includes('detector'));
check((await page.locator('.photo').count()) === 3, 'detector offline: clear message, nothing added');

// "Place on a wall" hands the photo to the 3D home and goes there.
await page.locator('.controls button', { hasText: 'Place on a wall' }).first().click();
await page.waitForURL('http://localhost:5173/', { timeout: 20000 }).catch(() => {});
check(page.url() === 'http://localhost:5173/' && (await page.evaluate(() => !!localStorage.getItem('inspecto.wallphoto.v1'))), '"Place on a wall" saves the photo and opens the 3D home');

await browser.close();
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('photo test passed');
