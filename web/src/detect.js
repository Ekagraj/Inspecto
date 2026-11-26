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
// a production build such as the live demo, in this browser, so nothing is uploaded. ?detector=browser|server forces one; ?ep=wasm|webgpu forces the browser backend.
const query = new URLSearchParams(location.search);
export const MODEL_URL = import.meta.env.VITE_MODEL_URL || '/onnx/detector-fp32.onnx';
let useServer = null;

async function serverUp() {
  if (query.get('detector')) return query.get('detector') === 'server';
  if (import.meta.env.PROD) return false;
  try {
    const res = await fetch('/api/health');
    return res.ok && (await res.json()).detector === true;
  } catch { return false; }
}

let worker = null, seq = 0;
const waiting = new Map();
/** One message to the detector worker -> its reply. Started on first use. */
export function askWorker(msg, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./detect-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.error) p?.reject(new Error(data.error)); else p?.resolve(data);
    };
    worker.onerror = (e) => { freeDetector(); console.warn(e); };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ url: MODEL_URL, backend: query.get('ep'), ...msg, id }, transfer);
  });
}

/** Stop the worker and free the model's memory (GPU buffers included). It restarts on the next detect(). */
export function freeDetector() {
  worker?.terminate();
  worker = null;
  for (const p of waiting.values()) p.reject(new Error('Detector stopped'));
  waiting.clear();
}
addEventListener('pagehide', freeDetector);

/** -> [{label, score, box: [x1,y1,x2,y2]}] with box in 0..1, y down. `image` is a JPEG data URL. */
export async function detect(image) {
  if (!(await (useServer ??= serverUp()))) return (await askWorker({ type: 'detect', image })).detections;
  const res = await fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
  if (!res.ok) throw new Error(`Detector error ${res.status}`);
  return (await res.json()).detections;
}
