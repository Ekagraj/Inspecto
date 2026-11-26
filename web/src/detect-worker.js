// The damage detector, run in the browser (onnxruntime-web) inside a worker so the 3D view never stalls.
// Pre- and post-processing copy server/detector.py (preprocess, postprocess) step for step.
import * as ort from 'onnxruntime-web/webgpu';

const SIZE = 384, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const LABELS = ['crack', 'mold', 'peeling_paint', 'stairstep_crack', 'water_seepage', 'scuff', 'hole'];
const THRESHOLD = 0.4;

let ready = null; // Promise<{session, backend}>

async function open(url, backend) {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  if (backend !== 'wasm' && self.navigator.gpu) {
    try {
      return { session: await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }), backend: 'webgpu' };
    } catch (e) {
      if (backend === 'webgpu') throw e;
      console.warn('WebGPU unavailable, using WASM:', e);
    }
  }
  return { session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }), backend: 'wasm' };
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

self.onmessage = async ({ data: { id, type, url, backend, image } }) => {
  try {
    const px = await pixels(image);
    const input = preprocess(px);
    if (type === 'tensor') return self.postMessage({ id, tensor: input, width: px.width, height: px.height }, [input.buffer]);
    ready ??= open(url, backend).catch((e) => { ready = null; throw e; }); // a failed load is retried next time
    const { session, backend: used } = await ready;
    const t = performance.now();
    const res = await session.run({ input: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
    const detections = postprocess(res.dets.data, res.labels.data, res.labels.dims[2]);
    const ms = Math.round(performance.now() - t);
    for (const v of Object.values(res)) v.dispose?.();
    self.postMessage({ id, detections, ms, backend: used, width: px.width, height: px.height });
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) });
  }
};
