// Pieces shared by the pages that work on real photos (photo check, condition reports).
import { h } from './dom.js';
import { AREAS, AREA_NOTE, money, severityOf, costOf, findArea, nearestArea } from './costs.js';

export const VERDICT = { minor: 'Small fix', moderate: 'Needs repair', major: 'Serious issue' };
export const range = (c) => `${money(c.low)} – ${money(c.high)}`;

/** File -> bitmap. iPhone HEIC or ProRAW (.DNG), TIFF and so on are converted by the local server. */
export async function decode(file) {
  try { return await createImageBitmap(file); } catch { /* not a format this browser reads */ }
  const res = await fetch('/api/jpeg', { method: 'POST', body: file });
  if (!res.ok) throw new Error('could not convert');
  return createImageBitmap(await res.blob());
}

export function toJpeg(bmp, max, q) {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

/** A flat photo has no scale, so real size comes from the width the user gives for the photo. */
export function priceOf(detections, widthM, aspect, factor) {
  return detections.map((d) => {
    const [x1, y1, x2, y2] = d.box.map((v) => Math.min(1, Math.max(0, Number(v))));
    const w = (x2 - x1) * widthM, ht = ((y2 - y1) * widthM) / aspect;
    const severity = severityOf(d.label, w, ht);
    return { ...d, box: [x1, y1, x2, y2], sizeM: [w, ht], severity, cost: costOf(d.label, severity, factor) };
  });
}

/** "Where is this wall?" search + current location. set(areaOrNull, note) is called with the choice. */
export function areaPanel(area, note, set) {
  const search = h('input', { type: 'search', list: 'areas', id: 'area', placeholder: 'Search: New York, Trenton, Scranton…', autocomplete: 'off' });
  search.addEventListener('change', () => {
    if (!search.value.trim()) return;
    const hit = findArea(search.value);
    set(hit, hit ? '' : `"${search.value}" is not in the price table yet. The three test areas are New York City, Trenton-Princeton and Scranton-Wilkes-Barre.`);
  });
  const locate = h('button', { class: 'ghost', text: 'Use my current location' });
  locate.addEventListener('click', () => {
    if (!navigator.geolocation) { set(null, 'This browser cannot share a location. Search instead.'); return; }
    locate.disabled = true;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { const n = nearestArea(coords.latitude, coords.longitude); set(n.area, `Nearest test area to you, about ${Math.round(n.km)} km away.`); },
      () => set(null, 'Your location could not be read (permission denied, unavailable, or the page is not on a secure connection). Search instead.'),
      { timeout: 10000 });
  });
  const pct = Math.round((area.factor - 1) * 100);
  return h('section', { class: 'loc panel' },
    h('label', { for: 'area', class: 'label', text: 'Where is this wall?' }),
    h('div', { class: 'loc-row' }, search, h('datalist', { id: 'areas' }, AREAS.map((a) => h('option', { value: a.name }))), locate),
    h('div', { class: 'loc-now' }, h('b', { text: area.name }), h('span', { class: 'sev', text: area.tier }),
      h('span', { text: pct ? `repair prices ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% against the US average` : 'US-average repair prices' })),
    note ? h('p', { class: 'loc-note', role: 'status', text: note }) : null,
    h('p', { class: 'loc-src', text: `Local factor: ${AREA_NOTE}. Wages are only part of a repair price, so treat this as a rough adjustment.` }));
}
