import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHouse, roomAt } from './house.js';
import { createWalk } from './walk.js';
import { loadDecals, plantDefects, clearDefects, visibleBoxes, randomPose, rng } from './defects.js';
import { capture, detect } from './detect.js';
import './style.css';

const canvas = document.querySelector('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

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

const $ = (s) => document.querySelector(s);
const start = $('#start');
$('#enter').addEventListener('click', () => { start.hidden = true; walk.lock(); });
canvas.addEventListener('click', () => { if (start.hidden) walk.lock(); });

const clock = new THREE.Clock();
let roomName = '';
renderer.setAnimationLoop(() => {
  walk.update(clock.getDelta());
  const name = roomAt(camera.position.x, camera.position.z)?.name ?? 'Outside';
  if (name !== roomName) $('#room').textContent = roomName = name;
  renderer.render(scene, camera);
});

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

// --- Analyze this view ---
const LABELS = { crack: 'Crack', stairstep_crack: 'Stair-step crack', mold: 'Mold', peeling_paint: 'Peeling paint', water_seepage: 'Water stain / seepage', damaged_tile: 'Damaged tile' };
const boxes = $('#boxes'), status = $('#status');
function showBoxes(dets, ms = 4000) {
  boxes.replaceChildren(...dets.map((d) => {
    const el = document.createElement('div');
    el.className = 'box';
    el.style.cssText = `left:${d.box[0] * 100}%;top:${d.box[1] * 100}%;width:${(d.box[2] - d.box[0]) * 100}%;height:${(d.box[3] - d.box[1]) * 100}%`;
    el.dataset.label = `${LABELS[d.label] ?? d.label} ${Math.round(d.score * 100)}%`;
    return el;
  }));
  clearTimeout(showBoxes.t);
  showBoxes.t = setTimeout(() => boxes.replaceChildren(), ms);
}
let busy = false;
export async function analyze() {
  if (busy) return [];
  busy = true;
  status.textContent = 'Analyzing…';
  try {
    const shot = capture(app);
    const dets = await detect(shot.image);
    showBoxes(dets);
    status.textContent = dets.length ? `${dets.length} possible defect${dets.length > 1 ? 's' : ''}` : 'Nothing found in this view';
    document.dispatchEvent(new CustomEvent('inspecto:detections', { detail: { dets, shot } }));
    return dets;
  } catch (e) {
    status.textContent = 'Detector offline. Start the server (see README).';
    return [];
  } finally { busy = false; }
}
$('#analyze').addEventListener('click', analyze);
addEventListener('keydown', (e) => { if (e.code === 'Space' && start.hidden && !e.target.closest?.('input,textarea,button')) { e.preventDefault(); analyze(); } });

// Hooks for tests and tools.
window.inspecto = {
  app, teleport: walk.teleport, ready: house.ready, analyze, replant,
  planted: () => app.planted.map(({ mesh, ...d }) => d),
  /** One synthetic training shot: random pose near a defect -> {image, boxes}. */
  synthShot(rand) {
    walk.teleport(...randomPose(rand, app.planted, house.colliders));
    const shot = capture(app, 640);
    return { image: shot.image, w: shot.canvas.width, h: shot.canvas.height, boxes: visibleBoxes(shot.camera, app.planted, house.occluders) };
  },
  rng,
};
