// Real wall photos hung on walls of the 3D home, so they are analyzed and measured like the rest.
import * as THREE from 'three';
import { H } from './house.js';
import { safeImg } from './dom.js';
import { loadWallPhotos, saveWallPhotos } from './store.js';

const UP = new THREE.Vector3(0, 1, 0), ray = new THREE.Raycaster();
const clamp = (v, lo, hi) => (lo <= hi ? Math.min(Math.max(v, lo), hi) : (lo + hi) / 2); // too big to fit: centre it

/** `onMove(was)` is called just before a hung photo moves, changes size or goes: `was(point)` tells
 *  whether a point lay on it, so pins measured from it can be dropped. */
export function createWallPhotos({ scene, house }, { onMove = () => {} } = {}) {
  const surfaces = new Set(house.surfaces);
  // {image, widthM, aspect, pos?, normal?}; a photo without pos is waiting to be placed.
  let photos = loadWallPhotos().filter((p) => p?.widthM > 0 && p.aspect > 0 && safeImg(p.image));
  const meshes = new Map(); // photo -> mesh

  function unhang(p) {
    const mesh = meshes.get(p);
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.map.dispose();
    mesh.material.dispose();
    meshes.delete(p);
  }
  function hang(p) {
    unhang(p);
    if (!p.pos) return;
    const n = new THREE.Vector3(...p.normal);
    const map = new THREE.TextureLoader().load(p.image);
    map.colorSpace = THREE.SRGBColorSpace;
    // Unlit: a photo carries its own lighting.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.widthM, p.widthM / p.aspect), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
    mesh.position.set(...p.pos).addScaledVector(n, 0.006); // in front of the defect decals (4 mm)
    mesh.lookAt(mesh.position.clone().add(n));
    // Deliberately not in house.surfaces or occluders: pin rays pass through to the wall behind,
    // so room, surface and size work unchanged.
    scene.add(mesh);
    meshes.set(p, mesh);
  }
  photos.forEach(hang);

  /** The wall under the crosshair -> {point, n, piece} or null (furniture, window, floor or ceiling). */
  function aim(camera) {
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = ray.intersectObjects(house.occluders, false)[0];
    if (!hit || !surfaces.has(hit.object)) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
    if (n.dot(ray.ray.direction) > 0) n.negate();
    return Math.abs(n.y) > 0.5 ? null : { point: hit.point, n, piece: new THREE.Box3().setFromObject(hit.object) };
  }
  /** Keep the photo on its piece of wall: between floor and ceiling, and not past the wall's ends. */
  function seat(p, { point, n, piece }) {
    const w = p.widthM, h = w / p.aspect, along = Math.abs(n.x) > 0.5 ? 'z' : 'x', pos = point.clone();
    pos[along] = clamp(point[along], piece.min[along] + w / 2, piece.max[along] - w / 2);
    pos.y = clamp(point.y, h / 2, H - h / 2);
    p.pos = pos.toArray();
    p.normal = n.toArray();
  }
  const inside = (p, point, margin = 0) => {
    if (!p.pos) return false;
    const n = new THREE.Vector3(...p.normal), d = new THREE.Vector3(...point).sub(new THREE.Vector3(...p.pos));
    return Math.abs(d.dot(n)) < 0.05 + margin && Math.abs(d.dot(new THREE.Vector3().crossVectors(UP, n))) <= p.widthM / 2 + margin
      && Math.abs(d.y) <= p.widthM / p.aspect / 2 + margin;
  };
  const placed = () => photos.filter((p) => p.pos);
  /** The placed photo under the crosshair, else the one placed last. */
  function target(camera) {
    const a = aim(camera);
    return (a && placed().find((p) => inside(p, a.point.toArray()))) ?? placed().at(-1) ?? null;
  }
  const commit = () => saveWallPhotos(photos);
  const leaving = (p) => { if (p.pos) { const old = { ...p }; onMove((point) => inside(old, point)); } };

  return {
    get has() { return photos.length > 0; },
    get placed() { return placed().length; },
    get waiting() { return photos.length - placed().length; },
    list: () => photos.map(({ image, ...p }) => p),

    /** A new photo to hang: {image, widthM, aspect}. -> false if the browser could not store it. */
    add(photo) {
      photos.push({ image: photo.image, widthM: photo.widthM, aspect: photo.aspect });
      if (commit()) return true;
      photos.pop();
      return false;
    },

    /** Hang the next waiting photo where the crosshair meets a wall; with none waiting, move the photo
     *  aimed at (or the last one). -> false if it is not aimed at a clear wall. */
    place(camera) {
      const a = aim(camera), p = photos.find((q) => !q.pos) ?? target(camera);
      if (!a || !p) return false;
      leaving(p);
      seat(p, a);
      hang(p);
      commit();
      return true;
    },

    /** Make the photo aimed at (or the last one) bigger or smaller: its width in metres decides every size. */
    resize(camera, factor) {
      const p = target(camera);
      if (!p) return null;
      leaving(p);
      p.widthM = Math.round(clamp(p.widthM * factor, 0.2, 6) * 100) / 100;
      seat(p, { point: new THREE.Vector3(...p.pos), n: new THREE.Vector3(...p.normal), piece: new THREE.Box3(new THREE.Vector3(-1e9, 0, -1e9), new THREE.Vector3(1e9, H, 1e9)) });
      hang(p);
      commit();
      return p.widthM;
    },

    /** Is this point on a wall covered by one of the photos? */
    contains: (point) => photos.some((p) => inside(p, point)),

    /** Take down the photo aimed at (or the last one). -> false if there is none on a wall. */
    remove(camera) {
      const p = target(camera);
      if (!p) return false;
      leaving(p);
      unhang(p);
      photos = photos.filter((q) => q !== p);
      commit();
      return true;
    },
  };
}
