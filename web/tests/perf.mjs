// Real-GPU frame rate check in headless Chrome (prints the GPU name so you can confirm it is not software).
// Usage: node tests/perf.mjs   (dev server on :5173)
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
for (const q of ['?fx=0', '?fx=1', ...process.argv.slice(2)]) {
  await page.goto('http://localhost:5173/' + q);
  await page.waitForFunction(() => window.inspecto);
  await page.click('#enter');
  await page.evaluate(() => window.inspecto.teleport(4.9, 3.9, 0.75, -0.05));
  await page.waitForTimeout(q.includes('auto') ? 8000 : 1500); // give the governor time to settle
  const r = await page.evaluate(async () => {
    let frames = 0, on = true;
    const tick = () => { frames++; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await new Promise((res) => setTimeout(res, 3000));
    on = false;
    const { renderer } = window.inspecto.app, c = renderer.domElement;
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { level: window.inspecto.quality(), gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).slice(0, 40) : '?', fps: Math.round(frames / 3), canvas: `${c.width}x${c.height}`, triangles: renderer.info.render.triangles, calls: renderer.info.render.calls };
  });
  console.log(q.padEnd(22), JSON.stringify(r));
}
await browser.close();
