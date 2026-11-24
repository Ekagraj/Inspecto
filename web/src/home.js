// Your home from its floor plan: the server reads walls, doors, windows and stairs off the plan
// picture (server/floorplan.py); this page shows what it found over the plan and builds it in 3D.
import './style.css';
import './report.css';
import './home.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { h } from './dom.js';
import { decode } from './photokit.js';
import { createWalk } from './walk.js';

const H = 2.44, DOOR_H = 2.03, SILL = 0.9, HEAD = 2.1; // metres; 8 ft ceilings unless the plan says otherwise
const COLOR = { door: '#2fbf5b', window: '#3b8eea', stairs: '#ffb224' };
const FT = 3.28084;
const ftIn = (m) => { const i = Math.round(m * FT * 12); return `${Math.floor(i / 12)}′ ${i % 12}″`; };

const root = document.querySelector('#root');
const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
const planCanvas = h('canvas', { class: 'plan-canvas', 'aria-label': 'Floor plan with what was found drawn over it' });
const view = h('canvas', { class: 'home-3d', 'aria-label': '3D view of the home' });
const summary = h('div', { class: 'home-summary' });
const status = h('p', { class: 'home-status', role: 'status' });
const overviewBtn = h('button', { class: 'ghost', text: 'Overview', disabled: true });
const walkBtn = h('button', { class: 'ghost', text: 'Walk inside', disabled: true });

root.append(h('div', { class: 'wrap' },
  h('a', { class: 'label', href: '/', text: '← Inspecto' }),
  h('h1', { class: 'home-title', text: 'Your home' }),
  h('p', { class: 'home-lead', text: 'Add your floor plan. The walls, doors, windows and stairs are read off it and built in 3D. Check that they match.' }),
  h('div', { class: 'home-actions' },
    h('button', { text: 'Add floor plan', onclick: () => fileInput.click() }), fileInput, status),
  h('div', { class: 'home-grid' },
    h('section', {}, h('span', { class: 'label', text: 'What was found' }), planCanvas, summary),
    h('section', {}, h('span', { class: 'label', text: '3D' }), view,
      h('div', { class: 'home-actions' }, overviewBtn, walkBtn),
      h('p', { class: 'fine', text: 'Walk: W A S D or arrow keys, drag or click to look. Esc frees the mouse.' })))));

// --- 3D ---
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f12);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.8); // from one side, so walls facing different ways differ
sun.position.set(7, 10, 3);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
const orbit = new OrbitControls(camera, view);
let home = null, walk = null, walking = false;

function boxGeometry([x0, z0, x1, z1], y0, y1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Shell (metres, x east, z south) -> meshes and the rectangles a walker cannot enter. */
function build(shell) {
  const group = new THREE.Group(), colliders = [], solid = [], glass = [], steps = [];
  for (const w of shell.walls) {
    solid.push(boxGeometry(w, 0, H));
    colliders.push({ x0: w[0], z0: w[1], x1: w[2], z1: w[3] });
  }
  for (const o of shell.openings) {
    solid.push(boxGeometry(o.box, o.kind === 'door' ? DOOR_H : HEAD, H));
    if (o.kind === 'window') { // a window or a glass slider: sill below, glass between, not walkable
      solid.push(boxGeometry(o.box, 0, SILL));
      const [x0, z0, x1, z1] = o.box, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      glass.push(boxGeometry(o.alongX ? [x0, mz - 0.01, x1, mz + 0.01] : [mx - 0.01, z0, mx + 0.01, z1], SILL, HEAD));
      colliders.push({ x0, z0, x1, z1 });
    }
  }
  for (const s of shell.stairs) { // shortcut: not climbable yet, and always rising towards +x / +z
    const [x0, z0, x1, z1] = s.box, len = s.climbsAlongX ? x1 - x0 : z1 - z0, n = Math.max(3, Math.round(len / 0.25));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * len, b = ((i + 1) / n) * len;
      steps.push(boxGeometry(s.climbsAlongX ? [x0 + a, z0, x0 + b, z1] : [x0, z0 + a, x1, z0 + b], 0, ((i + 1) / n) * H));
    }
    colliders.push({ x0, z0, x1, z1 });
  }
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
  if (solid.length) group.add(new THREE.Mesh(mergeGeometries(solid), mat(0xece6da)));
  if (glass.length) group.add(new THREE.Mesh(mergeGeometries(glass), mat(0x9fc6d8, { transparent: true, opacity: 0.3, roughness: 0.1 })));
  if (steps.length) group.add(new THREE.Mesh(mergeGeometries(steps), mat(0xb8946a)));
  const [w, d] = shell.size;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xb8946a));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(w / 2, 0, d / 2);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(0xf4f1ea));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(w / 2, H, d / 2);
  ceiling.visible = false;
  group.add(floor, ceiling);
  return { group, colliders, ceiling, size: [w, d] };
}

function overview() {
  walking = false;
  if (walk) walk.enabled = false;
  document.exitPointerLock?.();
  home.ceiling.visible = false;
  const [w, d] = home.size, r = Math.max(w, d);
  camera.position.set(w / 2, r * 1.1, d / 2 + r * 0.9);
  orbit.target.set(w / 2, 0, d / 2);
  orbit.enabled = true;
  orbit.update();
}

function walkInside(shell) {
  const free = (x, z) => !home.colliders.some((c) => x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3);
  const start = [...shell.rooms.map((r) => r.at), [shell.size[0] / 2, shell.size[1] / 2]].find(([x, z]) => free(x, z)) || [1, 1];
  orbit.enabled = false;
  home.ceiling.visible = true;
  walk = walk || createWalk(camera, view, home.colliders);
  walk.enabled = true;
  const [cx, cz] = [shell.size[0] / 2, shell.size[1] / 2]; // face into the home, not at the nearest wall
  walk.teleport(start[0], start[1], Math.atan2(start[0] - cx, start[1] - cz));
  walk.lock();
  walking = true;
}

function resize() {
  const w = view.clientWidth, ht = view.clientHeight;
  if (view.width !== Math.round(w * renderer.getPixelRatio())) {
    renderer.setSize(w, ht, false);
    camera.aspect = w / ht;
    camera.updateProjectionMatrix();
  }
}
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  resize();
  if (walking) walk.update(clock.getDelta()); else clock.getDelta();
  renderer.render(scene, camera);
});

// --- Plan overlay and summary ---
function drawPlan(bmp, shell) {
  planCanvas.width = bmp.width;
  planCanvas.height = bmp.height;
  const g = planCanvas.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const [ox, oy] = shell.origin, k = 1 / shell.metresPerPixel;
  const rect = ([x0, z0, x1, z1], color, label) => {
    const x = ox + x0 * k, y = oy + z0 * k, w = Math.max((x1 - x0) * k, 3), ht = Math.max((z1 - z0) * k, 3);
    g.fillStyle = color + 'cc';
    g.fillRect(x, y, w, ht);
    g.font = '600 14px Geist, sans-serif';
    g.fillStyle = color;
    g.fillText(label, x + w + 3, y + 12);
  };
  shell.openings.forEach((o, i) => rect(o.box, COLOR[o.kind], String(i + 1)));
  shell.stairs.forEach((s) => { g.globalAlpha = 0.35; rect(s.box, COLOR.stairs, 'stairs'); g.globalAlpha = 1; });
}

function showSummary(shell) {
  const count = (kind) => shell.openings.filter((o) => o.kind === kind).length;
  const sure = shell.lengthsAgreeing >= 2;
  summary.replaceChildren(
    h('p', { class: sure ? '' : 'home-warn', text: sure
      ? `Size read from ${shell.lengthsAgreeing} of ${shell.lengthsRead} lengths written on the plan: ${shell.size[0].toFixed(1)} × ${shell.size[1].toFixed(1)} m.`
      : `Only ${shell.lengthsAgreeing} written length could be checked. Please check the size: ${shell.size[0].toFixed(1)} × ${shell.size[1].toFixed(1)} m.` }),
    h('ul', { class: 'home-legend' },
      h('li', {}, h('i', { style: `background:${COLOR.door}` }), `${count('door')} doors or open doorways`),
      h('li', {}, h('i', { style: `background:${COLOR.window}` }), `${count('window')} windows or glass doors`),
      h('li', {}, h('i', { style: `background:${COLOR.stairs}` }), `${shell.stairs.length} stairs`)),
    shell.rooms.length
      ? h('p', { text: 'Rooms read: ' + shell.rooms.map((r) => r.size ? `${r.name} (${ftIn(r.size[0])} × ${ftIn(r.size[1])})` : r.name).join(', ') + '.' })
      : h('p', { text: 'No room names could be read.' }));
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  status.textContent = 'Reading the plan…';
  status.classList.remove('home-warn');
  summary.replaceChildren(); // the old plan's result must not pass for the new one
  try {
    const bmp = await decode(file);
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height)); // the server refuses huge images
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const res = await fetch('/api/floorplan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: c.toDataURL('image/png') }) }); // PNG: JPEG blurs the thin lines
    const shell = await res.json();
    if (!res.ok) throw new Error(shell.detail || 'The plan could not be read');
    drawPlan(c, shell);
    showSummary(shell);
    if (home) scene.remove(home.group);
    home = build(shell);
    scene.add(home.group);
    if (walk) walk = null; // colliders belong to the old plan
    overviewBtn.disabled = walkBtn.disabled = false;
    overviewBtn.onclick = overview;
    walkBtn.onclick = () => walkInside(shell);
    overview();
    status.textContent = '';
  } catch (e) {
    status.textContent = e.message === 'Failed to fetch' ? 'The local server is not running (see README).' : e.message;
    status.classList.add('home-warn');
  }
});
