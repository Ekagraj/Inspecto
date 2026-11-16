// A real wall photo hung on a wall of the 3D home, so it is analyzed and measured like the rest.
import * as THREE from 'three';
import { H } from './house.js';
import { safeImg } from './dom.js';
import { loadWallPhoto, saveWallPhoto } from './store.js';

const UP = new THREE.Vector3(0, 1, 0), ray = new THREE.Raycaster();

export function createWallPhoto({ scene, house }) {
  const surfaces = new Set(house.surfaces);
  let photo = loadWallPhoto(), mesh = null; // {image, widthM, aspect, pos?, normal?}
  if (!(photo?.widthM > 0 && photo.aspect > 0 && safeImg(photo.image))) photo = null;

  function unhang() {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.map.dispose();
    mesh.material.dispose();
    mesh = null;
  }
  function hang() {
    unhang();
    if (!photo?.pos) return;
    const n = new THREE.Vector3(...photo.normal);
    const map = new THREE.TextureLoader().load(photo.image);
    map.colorSpace = THREE.SRGBColorSpace;
    // Unlit: a photo carries its own lighting.
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(photo.widthM, photo.widthM / photo.aspect), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
    mesh.position.set(...photo.pos).addScaledVector(n, 0.006); // in front of the defect decals (4 mm)
    mesh.lookAt(mesh.position.clone().add(n));
    // Deliberately not in house.surfaces or occluders: pin rays pass through to the wall behind,
    // so room, surface and size work unchanged.
    scene.add(mesh);
  }
  hang();

  return {
    get has() { return !!photo; },
    get placed() { return !!photo?.pos; },

    /** Hang the photo where the crosshair meets a wall. -> false if it is not aimed at a clear wall. */
    place(camera) {
      if (!photo) return false;
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hit = ray.intersectObjects(house.occluders, false)[0];
      if (!hit || !surfaces.has(hit.object)) return false; // furniture or a window is in the way
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
      if (n.dot(ray.ray.direction) > 0) n.negate();
      if (Math.abs(n.y) > 0.5) return false; // walls only
      const h = photo.widthM / photo.aspect;
      const y = Math.min(Math.max(hit.point.y, h / 2), Math.max(h / 2, H - h / 2)); // between floor and ceiling
      photo = { ...photo, pos: [hit.point.x, y, hit.point.z], normal: n.toArray() };
      saveWallPhoto(photo);
      hang();
      return true;
    },

    /** Is this point on the wall covered by the photo? */
    contains(p) {
      if (!photo?.pos) return false;
      const n = new THREE.Vector3(...photo.normal), d = new THREE.Vector3(...p).sub(new THREE.Vector3(...photo.pos));
      return Math.abs(d.dot(n)) < 0.05 && Math.abs(d.dot(new THREE.Vector3().crossVectors(UP, n))) <= photo.widthM / 2
        && Math.abs(d.y) <= photo.widthM / photo.aspect / 2;
    },

    remove() {
      unhang();
      photo = null;
      saveWallPhoto(null);
    },
  };
}
