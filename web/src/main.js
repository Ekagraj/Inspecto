import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHouse, roomAt } from './house.js';
import { createWalk } from './walk.js';
import { loadDecals, plantDefects, clearDefects, visibleBoxes, randomPose, rng } from './defects.js';
import { capture, detect } from './detect.js';
import { createPins, SEVERITY_COLOR } from './pins.js';
import { DEFECTS, nameOf, money, totals } from './costs.js';
import './style.css';

const $ = (s) => document.querySelector(s);
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe3f2);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
const house = buildHouse(scene);
const walk = createWalk(camera, canvas, house.colliders);
walk.teleport(4.6, 3.4, 0.6);

const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();

export const app = { THREE, renderer, scene, camera, house, walk, planted: [] };

// The home's own condition: a fixed set of defects (the game replants with a random seed).
const LISTING_SEED = 7;
const decals = await loadDecals();
await house.ready;
export function replant(seed, count = 8) {
  clearDefects(scene, app.planted);
  app.planted = plantDefects(scene, house, decals, seed, count);
  return app.planted;
}
replant(LISTING_SEED);

// --- Findings: pins in 3D + detail card ---
const card = $('#card'), chip = $('#chip'), status = $('#status');
let openId = null, hover = null;

export const pins = createPins(app, {
  onChange(findings) {
    const t = totals(findings);
    $('#count').textContent = findings.length
      ? `${findings.length} finding${findings.length > 1 ? 's' : ''} · ${money(t.low)}–${money(t.high)} · Report →`
      : 'No findings yet';
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
  $('#card-where').textContent = `${f.roomName}, ${f.surface} (${f.material})`;
  $('#card-size').textContent = `${f.sizeM[0].toFixed(2)} × ${f.sizeM[1].toFixed(2)} m (${f.areaM2.toFixed(2)} m²)`;
  $('#card-score').textContent = `${Math.round(f.score * 100)}%`;
  $('#card-cost').textContent = `${money(f.cost.low)}–${money(f.cost.high)} (estimate)`;
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
function showBoxes(dets, ms = 2500) {
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
  try {
    const shot = capture(app);
    const dets = source ? source(shot) : await detect(shot.image);
    showBoxes(dets);
    const r = pins.addDetections(dets, shot);
    status.textContent = !dets.length ? 'Nothing found in this view'
      : [r.added && `${r.added} new`, r.merged && `${r.merged} already pinned`, r.ignored && `${r.ignored} ignored`].filter(Boolean).join(' · ');
    return { dets, ...r };
  } catch (e) {
    console.warn(e);
    status.textContent = 'Detector offline. Start the server (see README).';
    return null;
  } finally { busy = false; }
}
$('#analyze').addEventListener('click', () => analyze());

// --- Input ---
const start = $('#start');
$('#enter').addEventListener('click', () => { start.hidden = true; walk.lock(); });
canvas.addEventListener('click', (e) => {
  if (!start.hidden) return;
  const locked = document.pointerLockElement === canvas;
  const point = locked ? { x: 0, y: 0 } : { x: (e.clientX / innerWidth) * 2 - 1, y: 1 - (e.clientY / innerHeight) * 2 };
  const f = pins.pick(camera, point);
  if (f) openCard(f);
  else if (openId) closeCard();
  else if (!locked) walk.lock();
});
addEventListener('keydown', (e) => {
  if (!start.hidden || e.target.closest?.('input,textarea,button')) return;
  if (e.code === 'Space') { e.preventDefault(); analyze(); }
  else if (e.code === 'KeyE') { if (openId) closeCard(); else if (hover) openCard(hover); }
  else if (e.code === 'KeyX' && openId) pins.remove(openId);
  else if (e.code === 'Escape' && openId) closeCard();
});

const clock = new THREE.Clock();
let roomName = '', frame = 0;
renderer.setAnimationLoop(() => {
  walk.update(clock.getDelta());
  const name = roomAt(camera.position.x, camera.position.z)?.name ?? 'Outside';
  if (name !== roomName) $('#room').textContent = roomName = name;
  if (frame++ % 6 === 0) { // which pin is under the crosshair?
    const f = pins.pick(camera, { x: 0, y: 0 }, 50);
    if (f?.id !== hover?.id) {
      hover = f;
      chip.hidden = !f;
      if (f) chip.textContent = `#${f.n} ${nameOf(f.label)} · E for details`;
    }
  }
  renderer.render(scene, camera);
});

// Hooks for tests and tools.
const truth = (shot) => visibleBoxes(shot.camera, app.planted, house.occluders).map((b) => ({ ...b, score: 0.9 }));
window.inspecto = {
  app, pins, teleport: walk.teleport, analyze, replant, rng,
  analyzeTruth: () => analyze(truth), // pin the ground-truth boxes instead of asking the detector
  planted: () => app.planted.map(({ mesh, ...d }) => d),
  randomPose: (rand) => randomPose(rand, app.planted, house.colliders),
  /** One synthetic training shot: random pose near a defect -> {image, boxes}. */
  synthShot(rand) {
    walk.teleport(...randomPose(rand, app.planted, house.colliders));
    const shot = capture(app, 640);
    return { image: shot.image, w: shot.canvas.width, h: shot.canvas.height, boxes: visibleBoxes(shot.camera, app.planted, house.occluders) };
  },
};
