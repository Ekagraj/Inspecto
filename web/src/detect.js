// Capture the current view and ask the local detector what it sees.

/** Render one frame and grab it, plus a frozen copy of the camera for later raycasting. */
export function capture({ renderer, scene, camera }, maxW = 768) {
  renderer.render(scene, camera); // same tick as the read, so the buffer is still valid
  const src = renderer.domElement, k = Math.min(1, maxW / src.width);
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * k);
  c.height = Math.round(src.height * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const cam = camera.clone();
  cam.updateMatrixWorld(true);
  return { image: c.toDataURL('image/jpeg', 0.9), camera: cam, canvas: c };
}

// Where detection runs: in dev (npm run dev), the local Python server when it is running; otherwise, and always in
// a production build such as the live demo, in this browser, so nothing is uploaded.
// Test switches: ?detector=browser|server, ?ep=wasm|webgpu (forces the backend), ?model=fp32|fp16 (ONNX build).
const query = new URLSearchParams(location.search);
const BUILD = query.get('model') === 'fp32' ? 'fp32' : 'fp16'; // fp16: half the download, same results (README)
const MODEL_MB = { fp16: 54, fp32: 108 }[BUILD];
export const MODEL_URL = import.meta.env.VITE_MODEL_URL || `/onnx/detector-${BUILD}.onnx`;
let useServer = null;

/** WebGPU only on desktop Chrome and Edge. Safari and every mobile browser use WASM (about 0.4 GB, 0.75 s per photo
 *  on an M3): WebKit's WebGPU held over 1 GB, and phones have little memory to spare. */
function backend() {
  const ua = navigator.userAgentData; // Chromium only
  return query.get('ep') || (ua && !ua.mobile && ua.brands.some((b) => /^(Google Chrome|Microsoft Edge)$/.test(b.brand)) ? 'webgpu' : 'wasm');
}

async function serverUp() {
  if (query.get('detector')) return query.get('detector') === 'server';
  if (import.meta.env.PROD) return false;
  try {
    const res = await fetch('/api/health');
    return res.ok && (await res.json()).detector === true;
  } catch { return false; }
}

let worker = null, seq = 0;
const waiting = new Map(); // id -> {resolve, reject, onProgress}
/** One message to the detector worker -> its reply. Started on first use. */
export function askWorker(msg, onProgress) {
  if (!worker) {
    worker = new Worker(new URL('./detect-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = waiting.get(data.id);
      if (data.progress) return p?.onProgress?.(data.progress);
      waiting.delete(data.id);
      if (data.backend) document.documentElement.dataset.detector = data.backend; // which backend ran, for tests
      if (!data.error) p?.resolve(data);
      else p?.reject(new Error(data.loading ? `The detector could not be loaded (${data.error}). Check the connection and try again.` : data.error));
    };
    worker.onerror = (e) => { console.warn(e); freeDetector('The detector could not be started in this browser.'); };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress });
    worker.postMessage({ url: MODEL_URL, backend: backend(), strict: query.has('ep'), ...msg, id });
  });
}

/** Stop the worker and free the model's memory. It restarts on the next detect(). Runs when the page is left. */
export function freeDetector(reason = 'Detector stopped') {
  worker?.terminate();
  worker = null;
  for (const p of waiting.values()) p.reject(new Error(typeof reason === 'string' ? reason : 'Detector stopped'));
  waiting.clear();
}
addEventListener('pagehide', () => freeDetector());

/** Status line while the model loads: the first time it is downloaded (once), later it comes from the browser cache. */
const loadingText = ({ loaded = 0, cached, compiling }) => (compiling ? 'Preparing the detector…'
  : cached ? 'Loading the detector…' : `Downloading the detector, ${MODEL_MB} MB, once only… ${Math.round(loaded / 1e6)} MB`);

/** -> [{label, score, box: [x1,y1,x2,y2]}] with box in 0..1, y down. `image` is a JPEG data URL.
 *  `onStatus(text)` reports the one-time model download. */
export async function detect(image, onStatus) {
  if (!(await (useServer ??= serverUp()))) return (await askWorker({ type: 'detect', image }, (p) => onStatus?.(loadingText(p)))).detections;
  const res = await fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
  if (!res.ok) throw new Error(`Detector error ${res.status}`);
  return (await res.json()).detections;
}
