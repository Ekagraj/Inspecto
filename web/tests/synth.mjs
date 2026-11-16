// Render labeled training views from the app itself: random planted defects, random poses,
// boxes from projecting the decals. Usage: node tests/synth.mjs <outDir> <firstSeed> <seeds> <shotsPerSeed>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [out, first, seeds, shots] = [process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5]];
const CATS = ['crack', 'mold', 'peeling_paint', 'stairstep_crack', 'water_seepage'];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => { console.error(String(e)); process.exit(1); });
await page.goto('http://localhost:5173/');
await page.waitForFunction(() => window.inspecto);
await page.click('#enter');

const coco = { images: [], annotations: [], categories: CATS.map((name, id) => ({ id, name, supercategory: 'defect' })) };
for (let s = first; s < first + seeds; s++) {
  await page.evaluate((s) => { window.inspecto.replant(s, 10); window._rand = window.inspecto.rng(s * 7919); }, s);
  await page.waitForTimeout(250); // let decal textures load
  for (let k = 0; k < shots; k++) {
    const shot = await page.evaluate(() => window.inspecto.synthShot(window._rand));
    const id = coco.images.length, file = `synth_${s}_${k}.jpg`;
    writeFileSync(`${out}/${file}`, Buffer.from(shot.image.split(',')[1], 'base64'));
    coco.images.push({ id, file_name: file, width: shot.w, height: shot.h });
    for (const b of shot.boxes) {
      const [x1, y1, x2, y2] = [b.box[0] * shot.w, b.box[1] * shot.h, b.box[2] * shot.w, b.box[3] * shot.h];
      coco.annotations.push({ id: coco.annotations.length, image_id: id, category_id: CATS.indexOf(b.label), bbox: [x1, y1, x2 - x1, y2 - y1], area: (x2 - x1) * (y2 - y1), iscrowd: 0 });
    }
  }
}
writeFileSync(`${out}/_annotations.coco.json`, JSON.stringify(coco));
console.log(coco.images.length, 'images', coco.annotations.length, 'boxes');
await browser.close();
