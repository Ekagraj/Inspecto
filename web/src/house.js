// Procedural apartment: floor plan data -> walls, floors, ceilings, lights, furniture.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const H = 2.6; // ceiling height (m)
// Trim, rugs and sunlight live on this layer: people see them, capture() hides them,
// so the detector keeps seeing the plain rooms it was trained on. Raycasts ignore it too.
export const DECOR_LAYER = 1;
const T = 0.14; // wall thickness
const DOOR_H = 2.05;

// x runs east, z runs south, origin at the north-west corner.
export const ROOMS = [
  { id: 'living', name: 'Living room', x0: 0, z0: 0, x1: 6, z1: 4.5, floorTex: 'laminate_floor_02', floorMat: 'wood', wallMat: 'plaster', wallColor: 0xece6da },
  { id: 'kitchen', name: 'Kitchen', x0: 6, z0: 0, x1: 10, z1: 4.5, floorTex: 'floor_tiles_06', floorMat: 'tile', wallMat: 'plaster', wallColor: 0xe3e8e1 },
  { id: 'hall', name: 'Hallway', x0: 0, z0: 4.5, x1: 10, z1: 5.9, floorTex: 'laminate_floor_02', floorMat: 'wood', wallMat: 'plaster', wallColor: 0xeae7e1 },
  { id: 'bedroom', name: 'Bedroom', x0: 0, z0: 5.9, x1: 6, z1: 9.5, floorTex: 'laminate_floor_02', floorMat: 'wood', wallMat: 'plaster', wallColor: 0xdfe5ea },
  { id: 'bath', name: 'Bathroom', x0: 6, z0: 5.9, x1: 10, z1: 9.5, floorTex: 'marble_tiles', floorMat: 'tile', wallMat: 'tile', wallTex: 'long_white_tiles', wallColor: 0xc9dcdf },
];

// Axis-aligned walls; doors are [centre along the wall, width].
const WALLS = [
  { a: [0, 0], b: [10, 0] }, { a: [0, 9.5], b: [10, 9.5] },
  { a: [0, 0], b: [0, 9.5] }, { a: [10, 0], b: [10, 9.5] },
  { a: [0, 4.5], b: [10, 4.5], doors: [[3, 1.0], [8, 1.0]] },
  { a: [0, 5.9], b: [10, 5.9], doors: [[3, 0.95], [8, 0.9]] },
  { a: [6, 0], b: [6, 4.5], doors: [[2.25, 1.8]] },
  { a: [6, 5.9], b: [6, 9.5] },
];

// Fake windows: bright panels on the inside of exterior walls. pos is the panel centre.
export const WINDOWS = [
  { pos: [3, 1.5, T / 2], normal: [0, 0, 1], w: 2.0, h: 1.2 },
  { pos: [8, 1.6, T / 2], normal: [0, 0, 1], w: 1.4, h: 1.0 },
  { pos: [2.4, 1.5, 9.5 - T / 2], normal: [0, 0, -1], w: 1.8, h: 1.2 },
];

const FURNITURE = [
  ['sofa_03', 3, 0.62, 0], ['modern_coffee_table_01', 3, 2.0, Math.PI / 2], ['modern_arm_chair_01', 1.0, 2.4, Math.PI / 2],
  ['wooden_bookshelf_worn', 0.3, 3.7, Math.PI / 2], ['potted_plant_04', 5.4, 0.5, 0],
  ['dining_table', 8, 2.4, 0], ['dining_chair_02', 8, 1.55, 0], ['dining_chair_02', 8, 3.25, Math.PI],
  ['electric_stove', 9.3, 0.45, 0],
  ['GothicBed_01', 1.25, 7.9, Math.PI / 2], ['painted_wooden_nightstand', 0.35, 6.5, Math.PI / 2],
  ['modern_wooden_cabinet', 4.6, 9.15, Math.PI],
];

export function roomAt(x, z) {
  return ROOMS.find((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) || null;
}

/** Surface type, material and room for a raycast hit (point + world normal). */
export function describeHit(point, normal) {
  const surface = normal.y > 0.5 ? 'floor' : normal.y < -0.5 ? 'ceiling' : 'wall';
  const room = roomAt(point.x + normal.x * 0.05, point.z + normal.z * 0.05);
  const material = !room ? 'plaster' : surface === 'floor' ? room.floorMat : surface === 'wall' ? room.wallMat : 'plaster';
  return { surface, room, material };
}

export function buildHouse(scene) {
  const loader = new THREE.TextureLoader();
  const texCache = {};
  const tex = (name) => {
    if (!texCache[name]) {
      const t = loader.load(`/textures/${name}.jpg`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      texCache[name] = t;
    }
    return texCache[name];
  };
  const wallMats = {};
  const wallMaterial = (room) => {
    if (!room) return (wallMats.out ??= new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 1 }));
    return (wallMats[room.id] ??= new THREE.MeshStandardMaterial({
      color: room.wallColor, roughness: room.wallMat === 'tile' ? 0.35 : 0.95, map: room.wallTex ? tex(room.wallTex) : null,
    }));
  };
  const scaleUV = (geo, su, sv) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  };

  const decor = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.layers.set(DECOR_LAYER); scene.add(mesh); return mesh; };
  const trim = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.4 });
  const walnut = new THREE.MeshStandardMaterial({ color: 0x5c3f2a, roughness: 0.5 });
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  const surfaces = []; // walls, floors, ceilings: where defects can be and pins can land
  const occluders = []; // surfaces + furniture
  const colliders = []; // {x0,z0,x1,z1} rectangles the player cannot enter

  const addWallBox = (alongX, fixed, from, to, y0, y1, solid) => {
    const len = to - from, h = y1 - y0, mid = (from + to) / 2;
    const geo = alongX ? new THREE.BoxGeometry(len, h, T) : new THREE.BoxGeometry(T, h, len);
    scaleUV(geo, len / 1.2, h / 1.2);
    const cx = alongX ? mid : fixed, cz = alongX ? fixed : mid;
    const side = (d) => wallMaterial(alongX ? roomAt(cx, cz + d) : roomAt(cx + d, cz));
    const neutral = wallMaterial(roomAt(cx, cz) ?? roomAt(cx + 0.01, cz + 0.01));
    // BoxGeometry material order: +x, -x, +y, -y, +z, -z
    const mats = alongX
      ? [neutral, neutral, neutral, neutral, side(0.3), side(-0.3)]
      : [side(0.3), side(-0.3), neutral, neutral, neutral, neutral];
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set(cx, (y0 + y1) / 2, cz);
    scene.add(mesh);
    surfaces.push(mesh);
    if (solid) for (const s of [1, -1]) { // baseboard on both faces
      const off = s * (T / 2 + 0.007);
      decor(alongX ? box(len, 0.1, 0.014, trim) : box(0.014, 0.1, len, trim), cx + (alongX ? 0 : off), 0.05, cz + (alongX ? off : 0));
    }
    if (solid) {
      colliders.push(alongX
        ? { x0: from, x1: to, z0: fixed - T / 2, z1: fixed + T / 2 }
        : { x0: fixed - T / 2, x1: fixed + T / 2, z0: from, z1: to });
    }
  };

  for (const w of WALLS) {
    const alongX = w.a[1] === w.b[1];
    const fixed = alongX ? w.a[1] : w.a[0];
    let from = alongX ? w.a[0] : w.a[1];
    const end = alongX ? w.b[0] : w.b[1];
    for (const [c, width] of [...(w.doors || [])].sort((p, q) => p[0] - q[0])) {
      addWallBox(alongX, fixed, from, c - width / 2, 0, H, true);
      addWallBox(alongX, fixed, c - width / 2, c + width / 2, DOOR_H, H, false);
      const D = T + 0.05, at = (along, y) => (alongX ? [along, y, fixed] : [fixed, y, along]); // door casing
      for (const e of [c - width / 2, c + width / 2]) decor(alongX ? box(0.07, DOOR_H, D, walnut) : box(D, DOOR_H, 0.07, walnut), ...at(e, DOOR_H / 2));
      decor(alongX ? box(width + 0.14, 0.07, D, walnut) : box(D, 0.07, width + 0.14, walnut), ...at(c, DOOR_H + 0.035));
      from = c + width / 2;
    }
    addWallBox(alongX, fixed, from, end, 0, H, true);
  }

  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 1 });
  for (const r of ROOMS) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const fgeo = new THREE.PlaneGeometry(w, d);
    scaleUV(fgeo, w / 2, d / 2);
    const floor = new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({ map: tex(r.floorTex), roughness: r.floorMat === 'tile' ? 0.4 : 0.7 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, H, cz);
    scene.add(floor, ceil);
    surfaces.push(floor, ceil);

    const light = new THREE.PointLight(0xfff1dc, 9, 0, 1.6);
    light.position.set(cx, H - 0.35, cz);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), new THREE.MeshBasicMaterial({ color: 0xfff6e6 }));
    lamp.position.set(cx, H - 0.02, cz);
    scene.add(light, lamp);
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8ad9c, 1.1));

  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdff0ff).multiplyScalar(4.5) }); // far over 1.0 so only windows bloom
  const frame = new THREE.MeshStandardMaterial({ color: 0xfbfbf8, roughness: 0.6 });
  for (const win of WINDOWS) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(win.w + 0.12, win.h + 0.12, 0.03), frame));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(win.w, win.h), glass);
    pane.position.z = 0.02;
    g.add(pane, new THREE.Mesh(new THREE.BoxGeometry(0.04, win.h, 0.04), frame));
    g.position.set(...win.pos);
    g.lookAt(win.pos[0] + win.normal[0], win.pos[1], win.pos[2] + win.normal[2]);
    scene.add(g);
    g.traverse((o) => o.isMesh && occluders.push(o));
  }

  // Bathroom fixtures: no CC0 models at hand, so plain primitives.
  const white = new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.25 });
  const fixture = (w, h, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), white);
    m.position.set(x, h / 2, z);
    scene.add(m);
    occluders.push(m);
    colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
  };
  fixture(0.75, 0.55, 1.7, 9.55, 8.5); // tub
  fixture(0.9, 0.85, 0.5, 6.7, 9.15); // vanity

  occluders.push(...surfaces);

  // Rugs and sunlight patches (display only).
  const paint = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'));
    return Object.assign(new THREE.CanvasTexture(c), { colorSpace: THREE.SRGBColorSpace });
  };
  const flat = (w, d, mat, x, y, z) => { const m = decor(new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat), x, y, z); m.rotation.x = -Math.PI / 2; return m; };
  const rug = (x, z, w, d, base, stripe) => flat(w, d, new THREE.MeshStandardMaterial({ roughness: 1, map: paint(256, 176, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 256, 176);
    g.strokeStyle = stripe; g.lineWidth = 3; g.strokeRect(12, 12, 232, 152);
    g.lineWidth = 1; for (let i = 30; i < 230; i += 14) { g.beginPath(); g.moveTo(i, 24); g.lineTo(i, 152); g.stroke(); }
  }) }), x, 0.006, z);
  rug(3, 2.1, 2.8, 1.9, '#2f4a4f', '#d9c9a3');
  rug(3.4, 7.9, 1.7, 2.3, '#8a4b32', '#ecd9b8');
  const sun = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5, map: paint(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,236,196,1)'); grad.addColorStop(1, 'rgba(255,236,196,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  }) });
  for (const win of WINDOWS) flat(win.w * 1.5, 3.2, sun, win.pos[0] + win.normal[0] * 1.5, 0.012, win.pos[2] + win.normal[2] * 1.5);

  const gltf = new GLTFLoader();
  const ready = Promise.all(FURNITURE.map(async ([name, x, z, rot]) => {
    const { scene: obj } = await gltf.loadAsync(`/models/${name}/${name}.gltf`);
    obj.position.set(x, 0, z);
    obj.rotation.y = rot;
    scene.add(obj);
    obj.updateMatrixWorld(true);
    obj.traverse((o) => o.isMesh && occluders.push(o));
    const b = new THREE.Box3().setFromObject(obj);
    if (b.max.y > 0.25) colliders.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z });
  }));

  return { surfaces, occluders, colliders, ready };
}
