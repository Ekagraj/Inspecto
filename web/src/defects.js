// Plant defect decals on walls and ceilings (seeded), and work out which are visible from a camera.
import * as THREE from 'three';
import { ROOMS, H, roomAt } from './house.js';

// Longest side in metres, per label.
const SIZE = { crack: [0.4, 1.1], stairstep_crack: [0.6, 1.2], mold: [0.35, 0.9], peeling_paint: [0.35, 0.8], water_seepage: [0.45, 1.1] };
const CEILING_OK = ['mold', 'peeling_paint', 'water_seepage'];

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let decalIndex;
const textures = {};
const loader = new THREE.TextureLoader();
export async function loadDecals() {
  return (decalIndex ??= await (await fetch('/decals/decals.json')).json());
}

const ray = new THREE.Raycaster();
const UP = new THREE.Vector3(0, 1, 0);

/** Plant `count` defects. Returns [{id, label, room, surface, pos, normal, size, decal, mesh}]. */
export function plantDefects(scene, house, decals, seed, count = 8) {
  const rand = rng(seed), pick = (a) => a[Math.floor(rand() * a.length)], span = (a, b) => a + rand() * (b - a);
  const labels = Object.keys(SIZE), planted = [];
  scene.updateMatrixWorld(true);

  for (let tries = 0; planted.length < count && tries < 400; tries++) {
    const label = pick(labels), decal = pick(decals.filter((d) => d.label === label));
    const long = span(...SIZE[label]);
    const w = decal.aspect >= 1 ? long : long * decal.aspect, h = decal.aspect >= 1 ? long / decal.aspect : long;
    const room = pick(ROOMS), cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
    const onCeiling = CEILING_OK.includes(label) && rand() < 0.2;

    // Aim a ray from inside the room at the target surface; the hit gives the exact face.
    let origin, dir;
    if (onCeiling) {
      origin = new THREE.Vector3(span(room.x0 + 0.5, room.x1 - 0.5), 1.2, span(room.z0 + 0.5, room.z1 - 0.5));
      dir = UP.clone();
    } else {
      const side = Math.floor(rand() * 4), y = span(h / 2 + 0.25, H - h / 2 - 0.15);
      dir = new THREE.Vector3([0, 0, -1, 1][side], 0, [-1, 1, 0, 0][side]);
      origin = dir.x ? new THREE.Vector3(cx, y, span(room.z0 + 0.3, room.z1 - 0.3)) : new THREE.Vector3(span(room.x0 + 0.3, room.x1 - 0.3), y, cz);
    }
    ray.set(origin, dir);
    const hit = ray.intersectObjects(house.surfaces)[0];
    if (!hit) continue;
    const n = dir.clone().negate();
    const u = onCeiling ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3().crossVectors(UP, n);
    const v = onCeiling ? new THREE.Vector3(0, 0, 1) : UP;
    const pos = hit.point;

    // Every corner must sit on a clear surface: no door gap, window or furniture in front.
    const clear = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].every(([a, b]) => {
      const p = pos.clone().addScaledVector(u, a * w / 2).addScaledVector(v, b * h / 2).addScaledVector(n, 0.5);
      ray.set(p, dir);
      const first = ray.intersectObjects(house.occluders)[0];
      return first && Math.abs(first.distance - 0.5) < 0.02 && house.surfaces.includes(first.object);
    });
    if (!clear || roomAt(pos.x + n.x * 0.1, pos.z + n.z * 0.1) !== room) continue;
    if (planted.some((d) => d.mesh.position.distanceTo(pos) < (Math.max(...d.size) + long) / 2 + 0.3)) continue;

    const map = (textures[decal.file] ??= Object.assign(loader.load(`/decals/${decal.file}`), { colorSpace: THREE.SRGBColorSpace }));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
      map, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, toneMapped: false,
    }));
    mesh.position.copy(pos).addScaledVector(n, 0.004);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v.clone(), n));
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    planted.push({
      id: `d${seed}-${planted.length}`, label, room: room.id, surface: onCeiling ? 'ceiling' : 'wall',
      pos: pos.toArray(), normal: n.toArray(), size: [w, h], decal: decal.file, mesh,
    });
  }
  return planted;
}

export function clearDefects(scene, planted) {
  for (const d of planted) { scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); }
}

/** Screen boxes (0..1, y down) of the planted defects a camera can actually see. */
export function visibleBoxes(camera, planted, occluders) {
  camera.updateMatrixWorld(true);
  const eye = camera.getWorldPosition(new THREE.Vector3()), out = [];
  for (const d of planted) {
    const [w, h] = d.size, n = new THREE.Vector3(...d.normal), centre = new THREE.Vector3(...d.pos);
    const toEye = eye.clone().sub(centre);
    if (toEye.normalize().dot(n) < 0.25) continue; // too oblique or behind
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, seen = 0, behind = false;
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) {
      const p = d.mesh.localToWorld(new THREE.Vector3(a * w / 2, b * h / 2, 0));
      const dist = p.distanceTo(eye);
      ray.set(eye, p.clone().sub(eye).normalize());
      const first = ray.intersectObjects(occluders)[0];
      const s = p.project(camera);
      if (s.z > 1) behind = true;
      if ((!first || first.distance > dist - 0.03) && Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1) seen++;
      x1 = Math.min(x1, s.x); x2 = Math.max(x2, s.x); y1 = Math.min(y1, -s.y); y2 = Math.max(y2, -s.y);
    }
    if (behind || seen < 6) continue;
    const box = [x1, y1, x2, y2].map((c) => (THREE.MathUtils.clamp(c, -1, 1) + 1) / 2);
    if (box[2] - box[0] < 0.035 || box[3] - box[1] < 0.035) continue;
    out.push({ id: d.id, label: d.label, box });
  }
  return out;
}

/** A random standing pose that looks at (or near) one planted defect. */
export function randomPose(rand, planted, colliders) {
  for (let i = 0; i < 60; i++) {
    const d = planted[Math.floor(rand() * planted.length)], n = new THREE.Vector3(...d.normal);
    const dist = 0.9 + rand() * 2.8, swing = (rand() - 0.5) * 1.8;
    const dir = d.surface === 'ceiling' ? new THREE.Vector3(Math.cos(swing * 4), 0, Math.sin(swing * 4)) : n.clone().applyAxisAngle(UP, swing);
    const x = d.pos[0] + dir.x * dist, z = d.pos[2] + dir.z * dist;
    if (roomAt(x, z)?.id !== d.room || colliders.some((c) => x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3)) continue;
    const j = () => (rand() - 0.5) * 0.9;
    const dx = d.pos[0] + j() - x, dy = d.pos[1] + j() - 1.6, dz = d.pos[2] + j() - z;
    return [x, z, Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
  }
  return [4.6, 3.4, 0.6, 0];
}
