// Condition reports: move-in and move-out inspections, photos per room, before / after comparison.
// Storage, dates and the comparison live on the local server (server/inspections.py, compare.py).
import './style.css';
import './report.css';
import './photo.css';
import './inspect.css';
import { h } from './dom.js';
import { DEFECTS, COST_NOTE, SEVERITY_COLOR, nameOf, money, totals, loadArea, saveArea } from './costs.js';
import { VERDICT, range, decode, toJpeg, priceOf, areaPanel } from './photokit.js';

const root = document.querySelector('#root');
const label = (t) => h('span', { class: 'label', text: t });
const when = (iso) => new Date(iso.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const KIND = { 'move-in': 'Move-in', 'move-out': 'Move-out' };
const ROOMS = ['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Hallway'];

let list = []; // every inspection, newest first
let doc = null, base = null; // the open inspection and, for a move-out, the move-in it is compared with
let area = loadArea(), areaNote = '';
let status = null; // {text, error}
let busy = false;

async function api(method, path = '', body) {
  let res;
  try {
    res = await fetch(`/api/inspections${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body && JSON.stringify(body) });
  } catch { res = null; }
  if (!res || res.status >= 500) throw new Error('The local server is not answering. Start it with: uv run uvicorn server.app:app --port 8000');
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'That did not work.');
  return res.json();
}

/** Run a server action; any failure becomes a message on the page instead of a silent stop. */
async function act(message, fn) {
  if (busy) return;
  busy = true;
  status = message ? { text: message } : status;
  if (message) render();
  try { await fn(); status = null; } catch (e) { status = { text: e.message, error: true }; }
  busy = false;
  render();
}

async function open(id, push = true) {
  doc = id ? await api('GET', `/${id}`) : null;
  base = doc?.baseline ? await api('GET', `/${doc.baseline}`) : null;
  if (!doc) list = await api('GET');
  if (push) history.pushState(null, '', id ? `?id=${id}` : location.pathname);
  scrollTo(0, 0);
}

async function addPhoto(room, file, before) {
  let bmp;
  try { bmp = await decode(file); } catch { throw new Error(`"${file.name}" is not an image that could be read (JPEG, PNG and iPhone HEIC or DNG photos work).`); }
  // A retake shows the same view, so it starts with the width given for the move-in photo.
  doc.photos.push(await api('POST', `/${doc.id}/photos`, { room, image: toJpeg(bmp, 1600, 0.9), widthM: before?.widthM ?? 1, pair: before?.id ?? null }));
}

const patch = (p, changes) => act(null, async () => Object.assign(p, await api('PATCH', `/${doc.id}/photos/${p.id}`, changes)));
const priced = (p) => priceOf(p.detections, p.widthM, p.aspect, area.factor);
/** What the report charges for: new since move-in and not struck out by a person. */
const charged = (photos) => photos.flatMap(priced).filter((d) => d.status === 'new' && !d.removed);

function bar(...links) {
  return h('div', { class: 'bar' }, h('a', { class: 'logo', href: '/', text: 'Inspecto' }), label('Condition reports'), ...links);
}

function notice() {
  return h('div', { class: 'notice', role: 'note' },
    h('b', { text: 'A record of what the walls look like, not a licensed inspection. ' }),
    'Photograph each wall at move-in, then retake the same views at move-out: the app marks what is new and prices the repair. ',
    'It can miss damage or name it wrongly, so check every item: you can change the type, mark it as already there, or strike it out. ',
    `${COST_NOTE} Photos and reports stay on this laptop.`);
}

function fileButton(text, hint, onFile) {
  const input = h('input', { type: 'file', accept: 'image/*,.heic,.heif,.dng', capture: 'environment', disabled: busy });
  input.addEventListener('change', () => input.files[0] && onFile(input.files[0]));
  return h('label', { class: `file${busy ? ' busy' : ''}` }, input, h('strong', { text }), hint ? h('span', { text: hint }) : null);
}

// --- List of inspections ---
function listView() {
  const name = h('input', { type: 'text', id: 'new-name', maxlength: '80', placeholder: 'Property or unit, for example "Flat 2B, 14 Elm Street"', autocomplete: 'off' });
  const create = () => act(null, async () => {
    if (!name.value.trim()) throw new Error('Give the inspection a name first.');
    await open((await api('POST', '', { name: name.value, kind: 'move-in' })).id);
  });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && create());
  return [
    bar(h('a', { class: 'btn', href: '/', text: '← Back to the home' }), h('a', { class: 'btn', href: '/photo.html', text: 'Check a single photo' })),
    notice(),
    h('div', { class: 'title' }, label('Move-in and move-out'), h('h1', { text: 'Condition reports' })),
    h('section', { class: 'new-form panel ticks' },
      h('label', { for: 'new-name', class: 'label', text: 'New move-in inspection' }),
      h('div', { class: 'loc-row' }, name, h('button', { text: 'Start move-in inspection', onclick: create }))),
    status ? h('p', { class: `status${status.error ? ' error' : ''}`, role: 'status', text: status.text }) : null,
    h('div', { class: 'photos' },
      list.length ? list.map((i) => h('article', { class: 'insp panel' },
        h('h3', { text: i.name }),
        h('span', { class: 'sev', style: `background:${i.kind === 'move-in' ? 'var(--green)' : 'var(--amber)'}`, text: KIND[i.kind] }),
        h('span', { class: 'sub', text: `${when(i.created)} · ${i.photos} photo${i.photos === 1 ? '' : 's'}` }),
        h('div', { class: 'go' },
          i.kind === 'move-in' ? h('button', { class: 'ghost', text: 'Start the move-out', onclick: () => act(null, async () => open((await api('POST', '', { name: i.name, kind: 'move-out', baseline: i.id })).id)) }) : null,
          h('button', { text: 'Open', onclick: () => act(null, () => open(i.id)) }))))
        : h('p', { class: 'status', text: 'No inspections yet. Start with a move-in inspection of the property.' })),
  ];
}

// --- One photo with its problems ---
function problem(p, f, i, editable) {
  const out = doc.kind === 'move-out' && editable;
  const type = editable
    ? h('select', { 'aria-label': `Type of problem ${i + 1}` }, Object.keys(DEFECTS).map((k) => h('option', { value: k, selected: k === f.label, text: nameOf(k) })))
    : h('b', { text: nameOf(f.label) });
  if (editable) type.addEventListener('change', () => patch(p, { detections: { [i]: { label: type.value } } }));
  const choose = (value, text) => h('button', { 'aria-pressed': String(f.status === value), text, onclick: () => patch(p, { detections: { [i]: { status: value } } }) });
  return h('div', { class: `det${f.removed ? ' removed' : ''}` },
    h('div', { class: 'head' },
      h('span', { class: 'n', text: `#${i + 1}` }), type,
      h('span', { class: 'sev', style: `background:${SEVERITY_COLOR[f.severity]}`, text: VERDICT[f.severity] }),
      out && !f.removed ? h('span', { class: `sev state ${f.status}`, text: f.status === 'new' ? 'New' : 'Was already there' }) : null,
      h('span', { class: 'cost', text: range(f.cost) })),
    h('div', { class: 'meta' },
      h('span', { text: `about ${f.sizeM[0].toFixed(2)} × ${f.sizeM[1].toFixed(2)} m` }),
      h('span', { text: f.corrected ? 'type set by you' : `confidence ${Math.round(f.score * 100)}%` })),
    out && !f.removed && !f.sure ? h('p', {}, h('span', { class: 'flag', text: 'Please check' }), ` ${f.why}`) : null,
    editable ? h('div', { class: 'choice' },
      out && !f.removed ? [choose('new', 'It is new'), choose('existing', 'It was already there')] : null,
      h('button', { text: f.removed ? 'Restore' : 'Not damage', onclick: () => patch(p, { detections: { [i]: { removed: !f.removed } } }) })) : null);
}

function photoCard(p, owner, editable) {
  const found = priced(p);
  const width = h('input', { type: 'number', min: '0.2', max: '10', step: '0.1', value: String(p.widthM), id: `w${p.id}` });
  width.addEventListener('change', () => patch(p, { widthM: Math.min(10, Math.max(0.2, Number(width.value) || 1)) }));
  return h('article', { class: 'item photo panel' },
    h('div', { class: 'shot' },
      h('img', { src: `/api/inspections/${owner.id}/photos/${p.id}.jpg`, alt: `${p.room}, ${KIND[owner.kind].toLowerCase()} photo taken ${when(p.addedAt)}`, loading: 'lazy' }),
      ...found.map((f, i) => (f.removed ? null : h('div', {
        class: 'box', 'data-label': `#${i + 1}`,
        style: `left:${f.box[0] * 100}%;top:${f.box[1] * 100}%;width:${(f.box[2] - f.box[0]) * 100}%;height:${(f.box[3] - f.box[1]) * 100}%`,
      })))),
    h('div', { class: 'body' },
      h('div', { class: 'head' }, label(`${KIND[owner.kind]} · ${when(p.addedAt)}`)),
      found.length ? found.map((f, i) => problem(p, f, i, editable)) : h('p', { text: 'No problems found in this photo.' }),
      editable ? h('div', { class: 'controls' },
        h('label', { for: `w${p.id}`, class: 'label', text: 'Width of the area in this photo' }), width, h('span', { class: 'label', text: 'metres' })) : null));
}

// --- One inspection ---
function inspectionView() {
  const out = doc.kind === 'move-out';
  const rooms = [...new Set([...(base?.photos ?? []), ...doc.photos].map((p) => p.room))];
  const add = (room, before) => (file) => act('Analyzing the photo…', () => addPhoto(room, file, before));
  const all = doc.photos.flatMap(priced).filter((d) => !d.removed);
  const fresh = charged(doc.photos), t = totals(fresh);

  const room = h('input', { type: 'text', id: 'room', list: 'rooms', maxlength: '40', placeholder: 'Room name', autocomplete: 'off' });
  const newRoom = h('section', { class: 'new-form panel ticks' },
    h('label', { for: 'room', class: 'label', text: rooms.length ? 'Another room' : 'First room' }),
    h('div', { class: 'loc-row' }, room, h('datalist', { id: 'rooms' }, ROOMS.map((r) => h('option', { value: r })))),
    fileButton('Add a photo of this room', 'Close-up and straight-on works best. On a phone this opens the camera.', (file) => {
      if (!room.value.trim()) { status = { text: 'Type the room name first, then add the photo.', error: true }; render(); return; }
      add(room.value.trim())(file);
    }));

  return [
    bar(h('button', { class: 'ghost', text: '← All inspections', onclick: () => act(null, () => open(null)) }),
      h('button', { class: 'ghost', text: 'Print / save PDF', onclick: () => window.print() })),
    notice(),
    h('div', { class: 'title' },
      label(`${KIND[doc.kind]} inspection`),
      h('h1', { text: doc.name }),
      h('p', { text: out ? `Move-out started ${when(doc.created)} · compared with the move-in of ${when(base.created)}` : `Started ${when(doc.created)}` })),
    out ? areaPanel(area, areaNote, (next, note = '') => { if (next) { area = next; saveArea(next); } areaNote = note; render(); }) : null,
    out ? h('section', { class: 'hero' },
      h('div', {},
        label('New damage since move-in, estimated repair (midpoint)'),
        h('h1', { text: money(t.mid) }),
        h('div', { class: 'range' }, 'Likely range ', h('b', { text: range(t) }), ` · priced for ${area.name}`)),
      h('div', { class: 'stats panel' },
        h('div', {}, label('New'), h('b', { text: String(fresh.length) })),
        h('div', {}, label('Already there'), h('b', { text: String(all.filter((d) => d.status === 'existing').length) })),
        h('div', {}, label('To check'), h('b', { text: String(all.filter((d) => !d.sure).length) }))))
      : h('section', { class: 'hero' },
        h('div', {}, label('Condition recorded at move-in'), h('h1', { text: String(all.length) }), h('div', { class: 'range', text: `problem${all.length === 1 ? '' : 's'} found so far` })),
        h('div', { class: 'stats panel' },
        h('div', {}, label('Rooms'), h('b', { text: String(rooms.length) })),
        h('div', {}, label('Photos'), h('b', { text: String(doc.photos.length) })),
        h('div', {}, label('Problems recorded'), h('b', { text: String(all.length) })))),
    status ? h('p', { class: `status${status.error ? ' error' : ''}`, role: 'status', text: status.text }) : null,
    ...rooms.map((name) => {
      const before = (base?.photos ?? []).filter((p) => p.room === name), mine = doc.photos.filter((p) => p.room === name);
      return h('section', { class: 'room' },
        h('div', { class: 'room-head' }, h('h2', { text: name }),
          out ? h('span', { class: 'sub', text: `New damage ${range(totals(charged(mine)))}` }) : label(`${mine.length} photo${mine.length === 1 ? '' : 's'}`)),
        ...before.map((b) => {
          const retakes = mine.filter((p) => p.pair === b.id);
          return h('div', { class: 'pair' },
            photoCard(b, base, false),
            retakes.length ? h('div', { class: 'stack' }, retakes.map((p) => photoCard(p, doc, true)))
              : fileButton('Retake this view', 'Stand where the move-in photo was taken and frame the same piece of wall.', add(name, b)));
        }),
        h('div', { class: 'photos' }, mine.filter((p) => !p.pair).map((p) => photoCard(p, doc, true))),
        fileButton(`Add another photo of the ${name.toLowerCase()}`, out ? 'For a wall that was not photographed at move-in. Its problems count as new until you say otherwise.' : null, add(name)));
    }),
    newRoom,
    h('div', { class: 'foot' }, notice()),
  ];
}

function render() {
  root.replaceChildren(h('main', { class: 'wrap' }, doc ? inspectionView() : listView()));
}

const start = () => act(null, async () => {
  try { await open(new URLSearchParams(location.search).get('id'), false); } catch (e) {
    doc = null; // a link to an inspection that is gone still shows the list
    list = await api('GET').catch(() => []);
    throw e;
  }
});
addEventListener('popstate', start);
start();
