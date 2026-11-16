import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildHouse, roomAt } from './house.js';
import { createWalk } from './walk.js';
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

// Hooks for tests and later steps.
export const app = { THREE, renderer, scene, camera, house, walk };
window.inspecto = { app, teleport: walk.teleport, ready: house.ready };
