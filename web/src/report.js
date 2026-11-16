// Report page: findings grouped by room, repair-cost range and a suggested offer adjustment.
import './style.css';
import './report.css';
import { h, safeImg } from './dom.js';
import { loadFindings, saveFindings } from './store.js';
import { DEFECTS, COST_NOTE, SEVERITY_COLOR, nameOf, money, totals } from './costs.js';

const ROOM_ORDER = ['living', 'kitchen', 'hall', 'bedroom', 'bath'];
const ASKING_KEY = 'inspecto.asking.v1';
const SEV_RANK = { major: 0, moderate: 1, minor: 2 };

const label = (t) => h('span', { class: 'label', text: t });
const range = (c) => `${money(c.low)} – ${money(c.high)}`;

function readAsking() {
  try { return Math.max(0, Number(localStorage.getItem(ASKING_KEY)) || 0); } catch { return 0; }
}
function writeAsking(n) {
  try { localStorage.setItem(ASKING_KEY, String(n)); } catch { /* storage blocked: fine */ }
}

const DISCLAIMER = h('div', { class: 'notice', role: 'note' },
  h('b', { text: 'Visual triage, not a licensed inspection. ' }),
  'This report comes from an AI looking at images of the home. It can miss defects, mislabel them and cannot see behind walls. ',
  `${COST_NOTE} `,
  'A "damaged tile" is inferred from a crack on a tiled surface. Get a licensed inspector and contractor quotes before you make or accept an offer.');

function header() {
  return h('div', { class: 'bar' },
    h('a', { class: 'logo', href: '/', text: 'Inspecto' }),
    label(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })),
    h('a', { class: 'btn', href: '/', text: '← Back to the home' }),
    h('a', { class: 'btn', href: '/photo.html', text: 'Check a photo' }),
    h('button', { class: 'ghost', text: 'Print / save PDF', onclick: () => window.print() }));
}

function empty() {
  return h('div', { class: 'empty panel ticks' },
    h('h2', { text: 'No findings yet' }),
    h('p', { text: 'Walk through the home, press Space to analyze a view, and every defect the AI finds is pinned and priced here.' }),
    h('a', { href: '/', text: 'Back to the home' }));
}

function hero(findings) {
  const t = totals(findings);
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const rooms = new Set(findings.map((f) => f.room)).size;
  return h('section', { class: 'hero' },
    h('div', {},
      label('Estimated repair cost (midpoint)'),
      h('h1', { text: money(t.mid) }),
      h('div', { class: 'range' }, 'Likely range ', h('b', { text: range(t) }))),
    h('div', {},
      h('div', { class: 'stats panel' },
        h('div', {}, label('Findings'), h('b', { text: String(findings.length) })),
        h('div', {}, label('Rooms'), h('b', { text: String(rooms) })),
        h('div', {}, label('Major'), h('b', { text: String(count('major')) }))),
      h('div', { class: 'sevline' }, ...['major', 'moderate', 'minor'].map((s) =>
        h('span', { class: 'sev', style: `background:${SEVERITY_COLOR[s]}`, text: `${count(s)} ${s}` })))));
}

function offerPanel(findings) {
  const t = totals(findings);
  const flagged = findings.filter((f) => DEFECTS[f.label]?.urgency === 'urgent' || f.severity === 'major').length;
  const result = h('div', { class: 'result', 'aria-live': 'polite' });
  const input = h('input', { id: 'asking', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '450,000' });
  const asking0 = readAsking();
  if (asking0) input.value = asking0.toLocaleString('en-US');

  const update = () => {
    const asking = Number(input.value.replace(/[^\d]/g, ''));
    writeAsking(asking);
    result.replaceChildren();
    if (!asking) {
      result.append(label('Suggested offer'), h('div', { class: 'big dim', text: 'Enter the asking price' }));
      return;
    }
    const off = (c) => Math.max(0, asking - c);
    result.append(
      label('Suggested offer'),
      h('div', { class: 'big', text: money(off(t.mid)) }),
      h('div', { class: 'sub' }, h('b', { text: `−${money(Math.min(t.mid, asking))}` }), ` (${((Math.min(t.mid, asking) / asking) * 100).toFixed(1)}% of asking)`),
      h('div', { class: 'sub', text: `Range ${money(off(t.high))} – ${money(off(t.low))}, from the high and low repair estimates` }));
  };
  input.addEventListener('input', update);
  update();

  return h('section', { class: 'offer panel ticks' },
    h('div', {},
      label('Offer adjustment'),
      h('h2', { text: 'What to offer' }),
      h('p', { text: 'Take the repair estimate off the asking price. Use the range as your negotiating room, and the midpoint as a starting point.' }),
      h('div', { class: 'field' }, h('span', { text: '$' }), input),
      flagged ? h('p', { style: 'margin:14px 0 0' }, h('span', { class: 'flag', text: 'Get a quote first' }),
        ` ${flagged} finding${flagged > 1 ? 's are' : ' is'} major or urgent. Their real cost could be well above this estimate.`) : null),
    result);
}

function item(f) {
  const d = DEFECTS[f.label] ?? {};
  const urgent = d.urgency === 'urgent' || f.severity === 'major';
  const src = safeImg(f.thumb);
  return h('article', { class: 'item panel ticks' },
    src ? h('img', { src, alt: `Captured view of finding ${f.n}`, loading: 'lazy' }) : h('div'),
    h('div', { class: 'body' },
      h('div', { class: 'head' },
        h('span', { class: 'n', text: `#${f.n}` }),
        h('h3', { text: nameOf(f.label) }),
        h('span', { class: 'sev', style: `background:${SEVERITY_COLOR[f.severity]}`, text: f.severity }),
        h('span', { class: 'cost', text: range(f.cost) })),
      h('div', { class: 'meta' },
        h('span', { text: `${f.surface} · ${f.material}` }),
        h('span', { text: `${f.sizeM[0].toFixed(2)} × ${f.sizeM[1].toFixed(2)} m` }),
        h('span', { text: `confidence ${Math.round(f.score * 100)}%` }),
        f.source === 'photo' ? h('span', { text: 'from your photo' }) : null),
      d.cause ? h('p', {}, h('b', { text: 'Likely cause. ' }), d.cause) : null,
      d.action ? h('p', {}, h('b', { text: 'What to do. ' }), d.action) : null,
      urgent ? h('span', { class: 'flag', text: 'Get a specialist quote before offering' }) : null));
}

function rooms(findings) {
  const byRoom = new Map();
  for (const f of findings) (byRoom.get(f.room) ?? byRoom.set(f.room, []).get(f.room)).push(f);
  const order = [...byRoom.keys()].sort((a, b) => (ROOM_ORDER.indexOf(a) + 1 || 99) - (ROOM_ORDER.indexOf(b) + 1 || 99));
  return order.map((id) => {
    const list = byRoom.get(id).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.n - b.n);
    return h('section', { class: 'room' },
      h('div', { class: 'room-head' },
        h('h2', { text: list[0].roomName }),
        label(`${list.length} finding${list.length > 1 ? 's' : ''}`),
        h('span', { class: 'sub', text: `Subtotal ${range(totals(list))}` })),
      h('div', { class: 'items' }, ...list.map(item)));
  });
}

function footer() {
  let armed = false;
  const btn = h('button', { class: 'ghost danger', text: 'Start a new inspection' });
  btn.addEventListener('click', () => {
    if (!armed) { // two clicks instead of a browser confirm dialog
      armed = true;
      btn.classList.add('armed');
      btn.textContent = 'Click again to clear all findings';
      setTimeout(() => { armed = false; btn.classList.remove('armed'); btn.textContent = 'Start a new inspection'; }, 4000);
      return;
    }
    saveFindings([]);
    location.href = '/';
  });
  return h('div', { class: 'foot' }, DISCLAIMER.cloneNode(true), btn);
}

const findings = loadFindings();
const root = document.querySelector('#root');
root.append(h('main', { class: 'wrap' },
  header(),
  DISCLAIMER,
  ...(findings.length ? [hero(findings), offerPanel(findings), ...rooms(findings)] : [empty()]),
  footer()));
