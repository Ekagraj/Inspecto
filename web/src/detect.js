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

/** -> [{label, score, box: [x1,y1,x2,y2]}] with box in 0..1, y down. */
export async function detect(image) {
  const res = await fetch('/api/detect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
  if (!res.ok) throw new Error(`Detector error ${res.status}`);
  return (await res.json()).detections;
}
