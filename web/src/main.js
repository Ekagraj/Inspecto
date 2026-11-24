import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { buildHouse, roomAt } from './house.js';
import { createWalk } from './walk.js';
import { loadDecals, plantDefects, clearDefects, visibleBoxes, randomPose, rng } from './defects.js';
import { capture, detect } from './detect.js';
import { createPins } from './pins.js';
import { createWallPhotos } from './wallphoto.js';
import { decode, toJpeg } from './photokit.js';
import { createMinimap } from './minimap.js';
import { createFx } from './fx.js';
import { DEFECTS, SEVERITY_COLOR, nameOf, money, totals, costOf, localized, loadArea } from './costs.js';
import './style.css';

const $ = (s) => document.querySelector(s);
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.backgroundIntensity = 1.5; // the park outside reads as bright daylight
scene.environmentIntensity = 0.3; // reflections only; diffuse light is baked

const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
const house = buildHouse(scene);
const walk = createWalk(camera, canvas, house.colliders);
const SPAWN = [4.6, 3.4, 0.6];

// Quality levels, cheapest first. Full retina resolution with every effect ran at 5 fps on an
// M3, so for people a governor (below) picks the best level the GPU can hold. Automated runs
// (tests, data rendering) stay on plain rendering unless ?fx=1; ?fx=0 forces plain.
const LEVELS = [{ pr: 1 }, { pr: 1.5 }, { pr: 1, fx: true }, { pr: 1.5, fx: true }, { pr: 2, fx: true }];
const fxParam = new URLSearchParams(location.search).get('fx');
const auto = fxParam === 'auto' || (!fxParam && !navigator.webdriver);
let level = fxParam === '1' ? 3 : auto ? 2 : 1, ceiling = LEVELS.length - 1, fx = null;
function applyLevel() {
  const q = LEVELS[level];
  renderer.setPixelRatio(Math.min(q.pr, devicePixelRatio));
  if (q.fx) fx ??= createFx(renderer, scene, camera);
  resize();
}
const gov = { t: 0, n: 0 };
function govern(dt) {
  if (!auto || dt > 0.25) return; // hidden tab or a one-off hitch is not a measurement
  gov.t += dt; gov.n++;
  if (gov.t < 1.5) return;
  const fps = gov.n / gov.t;
  gov.t = gov.n = 0;
  if (fps < 40 && level > 0) { ceiling = --level; applyLevel(); } // never retry a level that was too slow
  else if (fps > 56 && level < ceiling) { level++; applyLevel(); }
}

const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  fx?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
applyLevel();

export const app = { THREE, renderer, scene, camera, house, walk, planted: [] };

// The home's own condition: a fixed set of defects (the game replants with a random seed).
const LISTING_SEED = 7;
const [decals, sky] = await Promise.all([loadDecals(), new HDRLoader().loadAsync('/textures/sky_2k.hdr'), house.ready]);
sky.mapping = THREE.EquirectangularReflectionMapping;
scene.background = scene.environment = sky;
export function replant(seed, count = 8) {
  clearDefects(scene, app.planted);
  app.planted = plantDefects(scene, house, decals, seed, count);
  return app.planted;
}
replant(LISTING_SEED);

// --- Findings: pins in 3D, minimap, summary, detail card ---
const card = $('#card'), chip = $('#chip'), status = $('#status'), summary = $('#summary');
const minimap = createMinimap($('#minimap'));
let openId = null, hover = null;

// Real wall photos added by the user. Pins measured from a photo go when that photo moves, changes size or is removed.
const wall = createWallPhotos(app, { onMove: (was) => pins.findings.filter((f) => f.source === 'photo' && was(f.pos)).forEach((f) => pins.remove(f.id)) });
export const pins = createPins(app, {
  source: (pos) => (wall.contains(pos) ? 'photo' : null),
  onChange(findings) {
    const t = totals(localized(findings)); // priced for the place chosen on the report or photo page
    if ($('#sum-n').textContent !== String(findings.length)) { // restart the count animation
      summary.classList.remove('bump');
      void summary.offsetWidth;
      summary.classList.add('bump');
    }
    $('#sum-n').textContent = findings.length;
    $('#sum-cost').textContent = findings.length ? `${money(t.low)} – ${money(t.high)}` : 'Nothing pinned yet';
    minimap.pins(findings);
    if (openId && !findings.some((f) => f.id === openId)) closeCard();
  },
});

function openCard(f) {
  const d = DEFECTS[f.label];
  openId = f.id;
  pins.select(f.id);
  $('#card-thumb').src = f.thumb;
  $('#card-n').textContent = `#${f.n}`;
  $('#card-title').textContent = nameOf(f.label);
  $('#card-sev').textContent = f.severity;
  $('#card-sev').style.background = SEVERITY_COLOR[f.severity];
  $('#card-where').textContent = `${f.roomName}, ${f.surface} (${f.material})${f.source === 'photo' ? ' · from your photo' : ''}`;
  $('#card-size').textContent = `${f.sizeM[0].toFixed(2)} × ${f.sizeM[1].toFixed(2)} m (${f.areaM2.toFixed(2)} m²)`;
  $('#card-score').textContent = `${Math.round(f.score * 100)}%`;
  const area = loadArea(), cost = costOf(f.label, f.severity, area.factor);
  $('#card-cost').textContent = `${money(cost.low)} – ${money(cost.high)} (estimate${area.id === 'us' ? '' : `, ${area.name}`})`;
  $('#card-cause').textContent = d?.cause ?? '';
  $('#card-action').textContent = d?.action ?? '';
  card.hidden = false;
}
function closeCard() {
  openId = null;
  pins.select(null);
  card.hidden = true;
}
$('#card-close').addEventListener('click', closeCard);
$('#card-remove').addEventListener('click', () => pins.remove(openId));

// --- Analyze this view ---
const boxes = $('#boxes');
function showBoxes(dets, ms = 2600) {
  boxes.replaceChildren(...dets.map((d) => {
    const el = document.createElement('div');
    el.className = 'box';
    el.style.cssText = `left:${d.box[0] * 100}%;top:${d.box[1] * 100}%;width:${(d.box[2] - d.box[0]) * 100}%;height:${(d.box[3] - d.box[1]) * 100}%`;
    el.dataset.label = `${nameOf(d.label)} ${Math.round(d.score * 100)}%`;
    return el;
  }));
  clearTimeout(showBoxes.t);
  showBoxes.t = setTimeout(() => boxes.replaceChildren(), ms);
}

let busy = false;
/** Capture, detect, pin. `source(shot)` replaces the detector in tests. */
export async function analyze(source) {
  if (busy) return null;
  busy = true;
  status.textContent = 'Analyzing…';
  document.body.classList.add('scanning');
  try {
    pins.visible = false; // the detector must not see our own markers
    const shot = capture(app);
    pins.visible = true;
    // Let the scan sweep play at least once when a person is watching.
    const [dets] = await Promise.all([source ? source(shot) : detect(shot.image), source ? 0 : new Promise((r) => setTimeout(r, 700))]);
    showBoxes(dets);
    const r = pins.addDetections(dets, shot);
    status.textContent = !dets.length ? 'Nothing found in this view'
      : [r.added && `${r.added} new`, r.merged && `${r.merged} already pinned`, r.ignored && `${r.ignored} ignored`].filter(Boolean).join(' · ');
    return { dets, ...r };
  } catch (e) {
    console.warn(e);
    pins.visible = true;
    status.textContent = 'Detector offline. Start the server (see README).';
    return null;
  } finally {
    busy = false;
    document.body.classList.remove('scanning');
  }
}
$('#analyze').addEventListener('click', () => analyze());

// --- Wall photos ---
function syncPhoto(message) {
  $('#photo-remove').hidden = !wall.placed;
  $('#hint-photo').hidden = !wall.has;
  $('#hint-size').hidden = !wall.placed;
  if (message) status.textContent = message;
}
const waitingText = () => `${wall.waiting} photo${wall.waiting === 1 ? '' : 's'} ready · aim at a clear wall and press P`;
$('#photo-remove').addEventListener('click', () => syncPhoto(wall.remove(camera) ? 'Photo removed' : ''));
/** Photos can be added right here: dropped on the view or picked with the button. They start 1 m wide. */
async function addPhotos(files) {
  let failed = 0;
  for (const file of files) {
    try {
      const bmp = await decode(file);
      if (!wall.add({ image: toJpeg(bmp, 800, 0.8), widthM: 1, aspect: bmp.width / bmp.height })) failed++;
    } catch { failed++; }
  }
  syncPhoto(wall.waiting ? waitingText() + (failed ? ` · ${failed} could not be read or stored` : '') : 'That file could not be read as a photo');
}
$('#photo-add input').addEventListener('change', (e) => { addPhotos([...e.target.files]); e.target.value = ''; });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); addPhotos([...e.dataTransfer.files]); });
syncPhoto();

// --- Input ---
const live = () => document.body.classList.contains('live');
$('#enter').addEventListener('click', () => {
  walk.teleport(...SPAWN);
  document.body.classList.add('live');
  $('#enter').blur(); // or the keys below would go to this button
  walk.lock();
  if (wall.waiting) status.textContent = waitingText();
});
canvas.addEventListener('click', (e) => {
  if (!live()) return;
  const locked = document.pointerLockElement === canvas;
  const point = locked ? { x: 0, y: 0 } : { x: (e.clientX / innerWidth) * 2 - 1, y: 1 - (e.clientY / innerHeight) * 2 };
  const f = pins.pick(camera, point);
  if (f) openCard(f);
  else if (openId) closeCard();
  else if (!locked) walk.lock();
});
addEventListener('keydown', (e) => {
  if (!live() || e.target.closest?.('input,textarea,button')) return;
  if (e.code === 'Space') { e.preventDefault(); analyze(); }
  else if (e.code === 'KeyE') { if (openId) closeCard(); else if (hover) openCard(hover); }
  else if (e.code === 'KeyX' && openId) pins.remove(openId);
  else if (e.code === 'Escape' && openId) closeCard();
  else if (e.code === 'KeyP' && wall.has) {
    const ok = wall.place(camera);
    syncPhoto(!ok ? 'Aim at a clear piece of wall, then press P' : wall.waiting ? `Photo placed · ${waitingText()}` : 'Photo placed · [ and ] resize it · stand so it fills the view, then press Space');
  } else if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && wall.placed) {
    const width = wall.resize(camera, e.code === 'BracketRight' ? 1.1 : 1 / 1.1);
    if (width) syncPhoto(`Photo is now ${width.toFixed(2)} m wide · press Space to analyze it`);
  }
});

// --- Frame loop ---
const clock = new THREE.Clock();
let roomName = '', lastPick = 0;
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta(), t = clock.elapsedTime;
  govern(dt);
  if (live()) walk.update(dt);
  else { // slow orbit behind the start screen, always looking across the living room
    const dx = 1.9 * Math.cos(t * 0.09 + 0.9), dz = 1.2 * Math.sin(t * 0.09 + 0.9);
    walk.teleport(3.3 + dx, 2.6 + dz, Math.atan2(dx, dz), -0.06);
  }

  const room = roomAt(camera.position.x, camera.position.z);
  if ((room?.name ?? 'Outside') !== roomName) $('#room').textContent = roomName = room?.name ?? 'Outside';
  minimap.player(camera.position.x, camera.position.z, camera.rotation.y, room?.id);
  const now = performance.now();
  pins.update(now);
  if (now - lastPick > 100) { // which pin is under the crosshair?
    lastPick = now;
    const f = live() ? pins.pick(camera, { x: 0, y: 0 }, 50) : null;
    if (f?.id !== hover?.id) {
      hover = f;
      chip.hidden = !f;
      document.body.classList.toggle('hovering', !!f);
      if (f) chip.textContent = `#${f.n} ${nameOf(f.label)} · E for details`;
    }
  }
  if (LEVELS[level].fx) fx.render(t); else renderer.render(scene, camera);
});

$('#enter').disabled = false;
$('#enter-cta').textContent = 'Start inspection →';

// Hooks for tests and tools.
const truth = (shot) => visibleBoxes(shot.camera, app.planted, house.occluders).map((b) => ({ ...b, score: 0.9 }));
window.inspecto = {
  app, pins, wall, teleport: walk.teleport, analyze, replant, rng,
  quality: () => level, // current LEVELS index chosen by the governor
  bake: async (o) => (await import('./bake.js')).bake(app, o), // dev tool, see tests/bake.mjs
  analyzeTruth: () => analyze(truth), // pin the ground-truth boxes instead of asking the detector
  planted: () => app.planted.map(({ mesh, ...d }) => d),
  randomPose: (rand) => randomPose(rand, app.planted, house.colliders),
  /** Detector vs ground truth for one random view (no pinning). */
  async evalShot(rand) {
    walk.teleport(...randomPose(rand, app.planted, house.colliders));
    pins.visible = false;
    const shot = capture(app);
    pins.visible = true;
    return { dets: await detect(shot.image), truth: truth(shot) };
  },
  /** One synthetic training shot: random pose near a defect -> {image, boxes}. */
  synthShot(rand) {
    walk.teleport(...randomPose(rand, app.planted, house.colliders));
    pins.visible = false;
    const shot = capture(app, 640);
    pins.visible = true;
    return { image: shot.image, w: shot.canvas.width, h: shot.canvas.height, boxes: visibleBoxes(shot.camera, app.planted, house.occluders) };
  },
};
