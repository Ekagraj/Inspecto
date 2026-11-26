// The damage detector, run in the browser (onnxruntime-web) inside a worker so the 3D view never stalls.
// Pre- and post-processing copy server/detector.py (preprocess, postprocess) step for step.

const SIZE = 384, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const LABELS = ['crack', 'mold', 'peeling_paint', 'stairstep_crack', 'water_seepage', 'scuff', 'hole'];
const THRESHOLD = 0.4;

let ready = null; // Promise<{ort, session, backend, timing}>
const CACHE = 'inspecto-detector-v1'; // rename when the model file changes, so old copies are deleted

/** The model file, from the Cache API after the first visit. Reports download progress. */
async function modelBytes(url, progress) {
  const cache = self.caches ? await caches.open(CACHE).catch(() => null) : null; // no Cache API on plain http
  let res = await cache?.match(url);
  const cached = Boolean(res);
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
  const parts = [], reader = res.body.getReader();
  let loaded = 0;
  for (let r; !(r = await reader.read()).done;) {
    parts.push(r.value);
    loaded += r.value.length;
    progress({ loaded, cached });
  }
  const bytes = new Uint8Array(loaded);
  parts.reduce((at, part) => (bytes.set(part, at), at + part.length), 0);
  if (cache && !cached) await cache.put(url, new Response(bytes)).catch(() => {}); // storage full: works, just not kept
  for (const name of await self.caches?.keys() ?? []) if (name.startsWith('inspecto-detector') && name !== CACHE) caches.delete(name);
  return { bytes, cached };
}

async function open(url, backend, strict, progress) {
  const t0 = performance.now();
  const { bytes, cached } = await modelBytes(url, progress);
  const t1 = performance.now();
  progress({ compiling: true, cached });
  // WASM-only browsers load the smaller onnxruntime build (14 MB of wasm instead of 29).
  const ort = await (backend === 'webgpu' ? import('onnxruntime-web/webgpu') : import('onnxruntime-web/wasm'));
  const create = async (ep) => ({ ort, session: await ort.InferenceSession.create(bytes, { executionProviders: [ep] }), backend: ep });
  let out = null;
  if (backend === 'webgpu' && self.navigator.gpu) {
    try { out = await create('webgpu'); } catch (e) {
      if (strict) throw e;
      console.warn('WebGPU unavailable, using WASM:', e);
    }
  } else if (backend === 'webgpu' && strict) throw new Error('WebGPU is not available in this browser');
  out ??= await create('wasm');
  return { ...out, timing: { fetchMs: Math.round(t1 - t0), createMs: Math.round(performance.now() - t1), bytes: bytes.length, cached } };
}

/** Data URL, Blob or File -> upright RGBA pixels at full size. No colour management, as PIL. */
async function pixels(image) {
  const blob = typeof image === 'string' ? await (await fetch(image)).blob() : image;
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0); // 1:1, so nothing is smoothed; the resize below is ours
  bmp.close();
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Source index pairs and weights along one axis: torch bilinear, align_corners=False, no antialiasing. */
function axis(n) {
  const i0 = new Int32Array(SIZE), i1 = new Int32Array(SIZE), w = new Float32Array(SIZE);
  for (let d = 0; d < SIZE; d++) {
    const src = Math.max((d + 0.5) * (n / SIZE) - 0.5, 0);
    i0[d] = Math.floor(src);
    i1[d] = Math.min(i0[d] + 1, n - 1);
    w[d] = src - i0[d];
  }
  return [i0, i1, w];
}

/** RGBA pixels -> (1, 3, 384, 384) float32: RGB / 255, bilinear resize, ImageNet mean/std. */
export function preprocess({ data, width, height }) {
  const [y0, y1, wy] = axis(height), [x0, x1, wx] = axis(width);
  const out = new Float32Array(3 * SIZE * SIZE), plane = SIZE * SIZE;
  for (let y = 0; y < SIZE; y++) {
    const r0 = y0[y] * width, r1 = y1[y] * width, b = wy[y];
    for (let x = 0; x < SIZE; x++) {
      const a = wx[x], p00 = (r0 + x0[x]) * 4, p01 = (r0 + x1[x]) * 4, p10 = (r1 + x0[x]) * 4, p11 = (r1 + x1[x]) * 4;
      for (let c = 0; c < 3; c++) {
        const top = (data[p00 + c] / 255) * (1 - a) + (data[p01 + c] / 255) * a;
        const bot = (data[p10 + c] / 255) * (1 - a) + (data[p11 + c] / 255) * a;
        out[c * plane + y * SIZE + x] = (top * (1 - b) + bot * b - MEAN[c]) / STD[c];
      }
    }
  }
  return out;
}

/** dets (300 x 4, cxcywh 0..1) and labels (300 x 8 logits, last = no object) -> detections above threshold. */
export function postprocess(boxes, logits, classes, threshold = THRESHOLD) {
  const prob = Float64Array.from(logits, (v) => 1 / (1 + Math.exp(-v)));
  const order = Array.from(prob.keys()).sort((i, j) => prob[j] - prob[i]).slice(0, 300); // stable, as numpy's
  const out = [];
  for (const k of order) {
    if (prob[k] <= threshold) break;
    const q = Math.floor(k / classes), c = k % classes;
    if (c >= LABELS.length) continue;
    const [cx, cy, w, h] = boxes.slice(q * 4, q * 4 + 4);
    const clip = (v) => Math.min(1, Math.max(0, v));
    out.push({ label: LABELS[c], score: Math.round(prob[k] * 1000) / 1000, box: [clip(cx - w / 2), clip(cy - h / 2), clip(cx + w / 2), clip(cy + h / 2)] });
  }
  return out;
}

self.onmessage = async ({ data: { id, type, url, backend, strict, image } }) => {
  let loading = false;
  try {
    const px = await pixels(image);
    const input = preprocess(px);
    if (type === 'tensor') return self.postMessage({ id, tensor: input, width: px.width, height: px.height }, [input.buffer]);
    loading = true;
    ready ??= open(url, backend, strict, (progress) => self.postMessage({ id, progress }))
      .catch((e) => { ready = null; throw e; }); // a failed load is retried next time
    const { ort, session, backend: used, timing } = await ready;
    loading = false;
    const t = performance.now();
    const res = await session.run({ input: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
    const detections = postprocess(res.dets.data, res.labels.data, res.labels.dims[2]);
    const ms = Math.round(performance.now() - t);
    for (const v of Object.values(res)) v.dispose?.();
    self.postMessage({ id, detections, ms, backend: used, timing, width: px.width, height: px.height });
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e), loading });
  }
};
