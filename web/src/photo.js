// Photo check: analyze real wall photos with the local detector and keep a running repair total.
import './style.css';
import './report.css';
import './photo.css';
import { h, safeImg } from './dom.js';
import { detect } from './detect.js';
import { saveWallPhoto } from './store.js';
import { DEFECTS, COST_NOTE, SEVERITY_COLOR, AREAS, AREA_NOTE, nameOf, money, severityOf, costOf, totals, loadArea, saveArea, findArea, nearestArea } from './costs.js';

const KEY = 'inspecto.photos.v1';
const VERDICT = { minor: 'Small fix', moderate: 'Needs repair', major: 'Serious issue' };
const root = document.querySelector('#root');
const label = (t) => h('span', { class: 'label', text: t });
const range = (c) => `${money(c.low)} – ${money(c.high)}`;

let photos = load(); // [{n, thumb, aspect, widthM, detections: [{label, score, box}]}], newest first
let status = null; // {text, error}
let busy = false;
let area = loadArea(); // one location for all photos: shared photos carry no GPS
let areaNote = '';

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(photos)); return true; } catch { return false; }
}

/** A flat photo has no scale, so real size comes from the width the user gives for the photo. */
function price(p) {
  return p.detections.map((d) => {
    const [x1, y1, x2, y2] = d.box.map((v) => Math.min(1, Math.max(0, Number(v))));
    const w = (x2 - x1) * p.widthM, ht = ((y2 - y1) * p.widthM) / p.aspect;
    const severity = severityOf(d.label, w, ht);
    return { ...d, box: [x1, y1, x2, y2], sizeM: [w, ht], severity, cost: costOf(d.label, severity, area.factor) };
  });
}

/** The detector often boxes one stain several times; overlapping boxes of one type are one problem. */
export function merge(dets) {
  const area = ([x1, y1, x2, y2]) => Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const out = [];
  for (const d of [...dets].sort((a, b) => area(b.box) - area(a.box))) {
    const big = out.find((o) => o.label === d.label
      && area([Math.max(o.box[0], d.box[0]), Math.max(o.box[1], d.box[1]), Math.min(o.box[2], d.box[2]), Math.min(o.box[3], d.box[3])]) > 0.5 * area(d.box));
    if (!big) { out.push({ ...d, box: [...d.box] }); continue; }
    big.box = [Math.min(big.box[0], d.box[0]), Math.min(big.box[1], d.box[1]), Math.max(big.box[2], d.box[2]), Math.max(big.box[3], d.box[3])];
    big.score = Math.max(big.score, d.score);
  }
  return out;
}

async function decode(file) {
  try { return await createImageBitmap(file); } catch { /* not a format this browser reads */ }
  // iPhone HEIC or ProRAW (.DNG), TIFF and so on: the local server converts what macOS can read.
  const res = await fetch('/api/jpeg', { method: 'POST', body: file });
  if (!res.ok) throw new Error('could not convert');
  return createImageBitmap(await res.blob());
}

function toJpeg(bmp, max, q) {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

async function addFiles(files) {
  if (busy || !files.length) return;
  busy = true;
  const list = [...files], problems = [];
  let added = 0;
  for (const [i, file] of list.entries()) {
    status = { text: `Analyzing photo ${i + 1} of ${list.length}…` };
    render();
    let bmp;
    try {
      bmp = await decode(file);
    } catch {
      problems.push(`"${file.name}" is not an image that could be read (JPEG, PNG and iPhone HEIC or DNG photos work).`);
      continue;
    }
    let detections;
    try {
      detections = merge(await detect(toJpeg(bmp, 1280, 0.9)));
    } catch {
      problems.push('The detector is not answering. Start it with: uv run uvicorn server.app:app --port 8000');
      break;
    }
    photos.unshift({ n: Math.max(0, ...photos.map((p) => p.n)) + 1, thumb: toJpeg(bmp, 800, 0.8), aspect: bmp.width / bmp.height, widthM: 1, detections });
    added++;
  }
  if (added && !save()) problems.push('Browser storage is full, so the new photos will be gone after a reload. Remove some older photos.');
  busy = false;
  status = problems.length ? { text: problems.join(' '), error: true } : null;
  render();
}

function header() {
  return h('div', { class: 'bar' },
    h('a', { class: 'logo', href: '/', text: 'Inspecto' }),
    label('Check your own photos'),
    h('a', { class: 'btn', href: '/', text: '← Back to the home' }));
}

function notice() {
  return h('div', { class: 'notice', role: 'note' },
    h('b', { text: 'Visual triage, not a licensed inspection. ' }),
    'Use a close-up, straight-on photo of the damaged area: wide room shots miss things. ',
    'The size of each problem is worked out from the width you enter under the photo, so check it. ',
    'Every photo is priced on its own, so do not add the same damage twice. ',
    'Placing a photo in the 3D home checks your wall, not your room layout. ',
    `${COST_NOTE} Photos are analyzed on this laptop and never uploaded.`);
}

function setArea(next, note = '') {
  if (next) { area = next; saveArea(next); }
  areaNote = note;
  render();
}

function location() {
  const search = h('input', { type: 'search', list: 'areas', id: 'area', placeholder: 'Search: New York, Trenton, Scranton…', autocomplete: 'off' });
  search.addEventListener('change', () => {
    if (!search.value.trim()) return;
    const hit = findArea(search.value);
    setArea(hit, hit ? '' : `"${search.value}" is not in the price table yet. The three test areas are New York City, Trenton-Princeton and Scranton-Wilkes-Barre.`);
  });
  const locate = h('button', { class: 'ghost', text: 'Use my current location' });
  locate.addEventListener('click', () => {
    if (!navigator.geolocation) { setArea(null, 'This browser cannot share a location. Search instead.'); return; }
    locate.disabled = true;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { const n = nearestArea(coords.latitude, coords.longitude); setArea(n.area, `Nearest test area to you, about ${Math.round(n.km)} km away.`); },
      () => setArea(null, 'Your location could not be read (permission denied or unavailable). Search instead.'),
      { timeout: 10000 });
  });
  const pct = Math.round((area.factor - 1) * 100);
  return h('section', { class: 'loc panel' },
    h('label', { for: 'area', class: 'label', text: 'Where is this wall?' }),
    h('div', { class: 'loc-row' }, search, h('datalist', { id: 'areas' }, AREAS.map((a) => h('option', { value: a.name }))), locate),
    h('div', { class: 'loc-now' }, h('b', { text: area.name }), h('span', { class: 'sev', text: area.tier }),
      h('span', { text: pct ? `repair prices ${pct > 0 ? '+' : '−'}${Math.abs(pct)}% against the US average` : 'US-average repair prices' })),
    areaNote ? h('p', { class: 'loc-note', role: 'status', text: areaNote }) : null,
    h('p', { class: 'loc-src', text: `Local factor: ${AREA_NOTE}. Wages are only part of a repair price, so treat this as a rough adjustment.` }));
}

function hero(found) {
  const t = totals(found);
  return h('section', { class: 'hero' },
    h('div', {},
      label('Estimated repair cost so far (midpoint)'),
      h('h1', { text: money(t.mid) }),
      h('div', { class: 'range' }, 'Likely range ', h('b', { text: range(t) }))),
    h('div', { class: 'stats panel' },
      h('div', {}, label('Photos'), h('b', { text: String(photos.length) })),
      h('div', {}, label('Problems'), h('b', { text: String(found.length) })),
      h('div', {}, label('Serious'), h('b', { text: String(found.filter((f) => f.severity === 'major').length) }))));
}

function drop() {
  const input = h('input', { type: 'file', accept: 'image/*,.heic,.heif,.dng', multiple: '', disabled: busy, 'aria-label': 'Add wall photos' });
  input.addEventListener('change', () => addFiles(input.files));
  return h('label', { class: `drop panel ticks${busy ? ' busy' : ''}` },
    input,
    h('strong', { text: photos.length ? 'Add more photos' : 'Add a photo of your wall' }),
    h('span', { text: 'Drop photos anywhere on this page, or click to choose. Each one is checked and its repair cost is added to the total.' }));
}

function detection(f, i, advice) {
  const d = DEFECTS[f.label] ?? {};
  return h('div', { class: 'det' },
    h('div', { class: 'head' },
      h('span', { class: 'n', text: `#${i + 1}` }),
      h('b', { text: nameOf(f.label) }),
      h('span', { class: 'sev', style: `background:${SEVERITY_COLOR[f.severity]}`, text: VERDICT[f.severity] }),
      h('span', { class: 'cost', text: range(f.cost) })),
    h('div', { class: 'meta' },
      h('span', { text: `about ${f.sizeM[0].toFixed(2)} × ${f.sizeM[1].toFixed(2)} m` }),
      h('span', { text: `confidence ${Math.round(f.score * 100)}%` })),
    advice && d.cause ? h('p', {}, h('b', { text: 'Likely cause. ' }), d.cause) : null,
    advice && d.action ? h('p', {}, h('b', { text: 'What to do. ' }), d.action) : null,
    d.urgency === 'urgent' || f.severity === 'major' ? h('span', { class: 'flag', text: 'Get a specialist quote' }) : null);
}

function card(p) {
  const found = price(p);
  const worst = ['major', 'moderate', 'minor'].find((s) => found.some((f) => f.severity === s));
  const src = safeImg(p.thumb), seen = new Set(); // cause and action once per defect type
  const width = h('input', { type: 'number', min: '0.2', max: '10', step: '0.1', value: String(p.widthM), id: `w${p.n}` });
  width.addEventListener('change', () => {
    p.widthM = Math.min(10, Math.max(0.2, Number(width.value) || 1));
    save();
    render();
  });
  return h('article', { class: 'item photo panel ticks' },
    h('div', { class: 'shot' },
      src ? h('img', { src, alt: `Your photo ${p.n}` }) : null,
      ...found.map((f, i) => h('div', {
        class: 'box', 'data-label': `#${i + 1}`,
        style: `left:${f.box[0] * 100}%;top:${f.box[1] * 100}%;width:${(f.box[2] - f.box[0]) * 100}%;height:${(f.box[3] - f.box[1]) * 100}%`,
      }))),
    h('div', { class: 'body' },
      h('div', { class: 'head' },
        h('h3', { text: `Photo ${p.n}` }),
        h('span', { class: 'sev', style: `background:${worst ? SEVERITY_COLOR[worst] : 'var(--green)'}`, text: worst ? VERDICT[worst] : 'No damage found' }),
        h('span', { class: 'cost', text: found.length ? range(totals(found)) : money(0) })),
      found.length ? found.map((f, i) => detection(f, i, !seen.has(f.label) && seen.add(f.label))) : h('p', { text: 'Nothing was found in this photo. If you can see damage, try a closer, straight-on photo of just that area.' }),
      h('div', { class: 'controls' },
        h('label', { for: `w${p.n}`, class: 'label', text: 'Width of the area in this photo' }),
        width, h('span', { class: 'label', text: 'metres' }),
        h('button', { class: 'ghost', text: 'Place on a wall in the 3D home', onclick: () => {
          if (saveWallPhoto({ image: p.thumb, widthM: p.widthM, aspect: p.aspect })) { location.href = '/'; return; }
          status = { text: 'Browser storage is full, so the photo could not be sent to the 3D home. Remove some photos first.', error: true };
          render();
        } }),
        h('button', { class: 'ghost', text: 'Remove', onclick: () => { photos = photos.filter((x) => x !== p); save(); render(); } }))));
}

function render() {
  const found = photos.flatMap(price);
  root.replaceChildren(h('main', { class: 'wrap' },
    header(),
    notice(),
    location(),
    photos.length ? hero(found) : null,
    drop(),
    status ? h('p', { class: `status${status.error ? ' error' : ''}`, role: 'status', text: status.text }) : null,
    h('div', { class: 'photos' }, photos.map(card))));
}

// The whole page is the drop target, so a photo dropped beside the box is not opened by the browser.
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
addEventListener('dragleave', () => document.body.classList.remove('dragging'));
addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  addFiles(e.dataTransfer.files);
});
render();
