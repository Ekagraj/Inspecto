// The live demo as visitors get it: a production build, no Python server, detection in the browser.
// Usage: npm run build && npx vite preview --port 4173 &   then   node tests/live.mjs PHOTO.jpg [chrome|webkit|all] [base URL]
// Checks: photo page and 3D Analyze find damage; the one-time download message names the size; a second visit
// loads the model from the cache, not the network; nothing is POSTed and /api is never called; the backend
// follows the rule (WebGPU on desktop Chrome, WASM on Safari and mobile); a failed model download says so.
import { chromium, webkit, devices } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const [photo, which = 'all', base = 'http://localhost:4173'] = process.argv.slice(2);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed++; };

// Persistent profiles, as a normal browser window: WebKit's throwaway contexts act like Private Browsing and drop
// the Cache API on reload.
const profile = (type, options) => type.launchPersistentContext(mkdtempSync(`${tmpdir()}/inspecto-live-`), options);

async function run(name, type, contextOptions, wantBackend) {
  console.log(`\n# ${name}`);
  const context = await profile(type, contextOptions);
  const requests = [];
  const hosts = new Set();
  context.on('request', (r) => { const u = new URL(r.url()); requests.push(`${r.method()} ${u.pathname}`); if (u.origin !== new URL(base).origin) hosts.add(u.hostname); });
  const page = await context.newPage();
  const statuses = new Set();
  await page.exposeFunction('seen', (t) => statuses.add(t));
  await page.addInitScript(() => new MutationObserver(() => document.querySelectorAll('[role=status], #status').forEach((e) => e.textContent && window.seen(e.textContent)))
    .observe(document, { subtree: true, childList: true, characterData: true }));

  // 1. Photo page, first visit: the model is downloaded once, with its size shown.
  await page.goto(`${base}/photo.html`);
  await page.setInputFiles('.drop input', photo);
  await page.waitForSelector('.photo .det, .status.error', { timeout: 300000 });
  check(await page.locator('.photo .det').count() > 0, `photo page finds damage (${await page.locator('.photo .det').count()} box)`);
  check([...statuses].some((t) => /Downloading the detector, 54 MB, once only/.test(t)), 'first visit shows "Downloading the detector, 54 MB, once only…"');
  const backend = await page.evaluate(() => document.documentElement.dataset.detector);
  check(backend === wantBackend, `backend ${backend} (want ${wantBackend})`);
  check(requests.filter((r) => r.includes('/onnx/')).length === 1, `model fetched once (${requests.filter((r) => r.includes('/onnx/')).length})`);

  // 2. Second visit: from the Cache API, no network.
  const before = requests.length;
  statuses.clear();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.setInputFiles('.drop input', photo);
  await page.waitForSelector('.photo .det, .status.error', { timeout: 300000 });
  check(!requests.slice(before).some((r) => r.includes('/onnx/')), 'second visit: model comes from the browser cache, not the network');
  check(![...statuses].some((t) => /Downloading/.test(t)), 'second visit: no download message');

  // 3. The 3D home's Analyze button.
  await page.goto(`${base}/`);
  await page.waitForFunction(() => window.inspecto);
  await page.click('#enter');
  await page.evaluate(() => window.inspecto.replant(9001, 10));
  const truthShot = await page.evaluate(async () => {
    for (let k = 0, rand = window.inspecto.rng(9001); k < 30; k++) { // a view with a planted defect in it
      const pose = window.inspecto.randomPose(rand);
      window.inspecto.teleport(...pose);
      const r = await window.inspecto.analyze();
      if (r?.dets.length) return r.dets.length;
    }
    return 0;
  });
  check(truthShot > 0, `3D Analyze finds damage (${truthShot} in a view)`);
  check(!/could not|stopped|error/i.test(await page.textContent('#status')), `3D status: "${await page.textContent('#status')}"`);

  check(!requests.some((r) => r.startsWith('POST')), 'nothing is POSTed');
  check(!requests.some((r) => r.includes('/api/')), '/api is never called');
  check([...hosts].every((h) => /^fonts\.(googleapis|gstatic)\.com$/.test(h)), `other sites contacted: ${[...hosts].join(', ') || 'none'} (web fonts only)`);
  await context.close();
}

async function failingDownload(type, options) {
  console.log('\n# model download blocked');
  const browser = await type.launch(options);
  const page = await browser.newPage();
  await page.route('**/onnx/**', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await page.goto(`${base}/photo.html`);
  await page.setInputFiles('.drop input', photo);
  await page.waitForSelector('.status.error', { timeout: 120000 });
  const text = await page.textContent('.status.error');
  check(/could not be loaded \(HTTP 404\)/.test(text), `clear error: "${text}"`);
  await browser.close();
}

if (which !== 'webkit') {
  await run('Chrome, desktop', chromium, { channel: 'chrome' }, 'webgpu');
  await run('Chrome, phone (Pixel 7 emulation)', chromium, { channel: 'chrome', ...devices['Pixel 7'] }, 'wasm');
  await failingDownload(chromium, { channel: 'chrome' });
}
if (which !== 'chrome') {
  await run('WebKit (Safari engine), desktop', webkit, {}, 'wasm');
  await run('WebKit, iPhone 15 emulation', webkit, devices['iPhone 15'], 'wasm');
  await failingDownload(webkit, {});
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
