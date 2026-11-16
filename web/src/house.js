// Procedural apartment: floor plan data -> walls with real door and window openings, floors,
// ceilings, trim and furniture. Lighting is baked offline by bake.js, so it is free at runtime:
// walls, floors and ceilings read a lightmap atlas through uv1; everything else ("props")
// carries its baked light in vertex colours.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const H = 2.6; // ceiling height (m)
export const TEXEL = 0.04; // lightmap texel size (m)
export const LIGHT_SCALE = 4; // the PNG stores light / LIGHT_SCALE
export const SUN_DIR = new THREE.Vector3(0.35, 0.75, -1).normalize(); // towards the sun
const T = 0.14, DOOR_H = 2.05, WIN_Y0 = 0.9, WIN_Y1 = 2.1, ATLAS_W = 1024;

// x runs east, z runs south, origin at the north-west corner. floorAlbedo is the floor
// texture's rough average colour, used for bounced light in the bake.
export const ROOMS = [
  { id: 'living', name: 'Living room', x0: 0, z0: 0, x1: 6, z1: 4.5, floorTex: 'laminate_floor_02', floorMat: 'wood', floorAlbedo: 0xb8946a, wallMat: 'plaster', wallColor: 0xece6da },
  { id: 'kitchen', name: 'Kitchen', x0: 6, z0: 0, x1: 10, z1: 4.5, floorTex: 'floor_tiles_06', floorMat: 'tile', floorAlbedo: 0xa9a8a2, wallMat: 'plaster', wallColor: 0xe3e8e1 },
  { id: 'hall', name: 'Hallway', x0: 0, z0: 4.5, x1: 10, z1: 5.9, floorTex: 'laminate_floor_02', floorMat: 'wood', floorAlbedo: 0xb8946a, wallMat: 'plaster', wallColor: 0xeae7e1, lamp: 2.4 },
  { id: 'bedroom', name: 'Bedroom', x0: 0, z0: 5.9, x1: 6, z1: 9.5, floorTex: 'laminate_floor_02', floorMat: 'wood', floorAlbedo: 0xb8946a, wallMat: 'plaster', wallColor: 0xdfe5ea },
  { id: 'bath', name: 'Bathroom', x0: 6, z0: 5.9, x1: 10, z1: 9.5, floorTex: 'marble_tiles', floorMat: 'tile', floorAlbedo: 0xbdb5a8, wallMat: 'tile', wallTex: 'long_white_tiles', wallColor: 0xc9dcdf, lamp: 2.4 },
];

// Axis-aligned walls; doors and windows are [centre along the wall, width].
const WALLS = [
  { a: [0, 0], b: [10, 0], windows: [[3, 2.0], [8, 1.4]] },
  { a: [0, 9.5], b: [10, 9.5], windows: [[2.4, 1.8]] },
  { a: [0, 0], b: [0, 9.5] }, { a: [10, 0], b: [10, 9.5] },
  { a: [0, 4.5], b: [10, 4.5], doors: [[3, 1.0], [8, 1.0]] },
  { a: [0, 5.9], b: [10, 5.9], doors: [[3, 0.95], [8, 0.9]] },
  { a: [6, 0], b: [6, 4.5], doors: [[2.25, 1.8]] },
  { a: [6, 5.9], b: [6, 9.5] },
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
  const scaleUV = (geo, su, sv) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  };

  // Baked light. Row 0 of the PNG is v = 0 (flipY off); no mipmaps, so atlas islands do not bleed.
  const lightmap = Object.assign(loader.load('/bake/lightmap.png'), {
    flipY: false, colorSpace: THREE.SRGBColorSpace, channel: 1, generateMipmaps: false, minFilter: THREE.LinearFilter,
  });
  // MeshBasicMaterial shows albedo x lightmap / PI and ignores realtime lights.
  const lit = (o) => new THREE.MeshBasicMaterial({ ...o, lightMap: lightmap, lightMapIntensity: Math.PI * LIGHT_SCALE });

  const surfaces = []; // walls, floors, ceilings: where defects can be and pins can land
  const occluders = []; // surfaces + props: what blocks a line of sight
  const colliders = []; // {x0,z0,x1,z1} rectangles the player cannot enter
  const props = []; // meshes lit by baked vertex colours, in a fixed order (bake file order)
  const faces = []; // lightmapped rectangles: {mesh, vOff, rect, origin, du, dv, n, albedo}
  const portals = []; // window openings, the sky's way in: {centre, n, u, v}
  const lamps = []; // ceiling lights: {pos, r, power}

  // Shelf-pack one rectangular face into the atlas. Deterministic, so runtime and bake agree.
  let penX = 1, penY = 1, rowH = 0;
  function allocFace(mesh, face, albedo) {
    // BoxGeometry/PlaneGeometry lay out each face's 4 vertices as uv (0,1) (1,1) (0,0) (1,0).
    const p = mesh.geometry.attributes.position;
    const at = (i) => new THREE.Vector3().fromBufferAttribute(p, face * 4 + i).applyMatrix4(mesh.matrixWorld);
    const origin = at(2), du = at(3).sub(origin), dv = at(0).sub(origin);
    const w = Math.ceil(du.length() / TEXEL - 1e-6), h = Math.ceil(dv.length() / TEXEL - 1e-6);
    if (penX + w + 1 > ATLAS_W) { penX = 1; penY += rowH + 2; rowH = 0; }
    faces.push({ mesh, vOff: face * 4, rect: { x: penX, y: penY, w, h }, origin, du, dv, n: new THREE.Vector3().crossVectors(du, dv).normalize(), albedo: new THREE.Color(albedo).toArray() });
    penX += w + 2;
    rowH = Math.max(rowH, h);
  }

  const prop = (mesh) => {
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    props.push(mesh);
    occluders.push(mesh);
    return mesh;
  };
  const trim = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.45 });
  const walnut = new THREE.MeshStandardMaterial({ color: 0x5c3f2a, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0, transparent: true, opacity: 0.1, depthWrite: false });
  const wallMats = {};
  const wallMat = (room) => (room
    ? (wallMats[room.id] ??= lit({ color: room.wallColor, map: room.wallTex ? tex(room.wallTex) : null }))
    : (wallMats.out ??= new THREE.MeshBasicMaterial({ color: 0x8c8a84 })));

  for (const w of WALLS) {
    const alongX = w.a[1] === w.b[1], fixed = alongX ? w.a[1] : w.a[0], end = alongX ? w.b[0] : w.b[1];
    const at = (along, y, off = 0) => (alongX ? [along, y, fixed + off] : [fixed + off, y, along]);
    const side = (along, d) => roomAt(...at(along, 0, d).filter((_, i) => i !== 1));
    // A trim/frame bar running along the wall, subdivided so vertex-baked light has detail.
    const beam = (len, h, depth, mat, along, y, off = 0) => {
      const sl = Math.ceil(len / 0.4), sh = Math.ceil(h / 0.5);
      const m = new THREE.Mesh(alongX ? new THREE.BoxGeometry(len, h, depth, sl, sh, 1) : new THREE.BoxGeometry(depth, h, len, 1, sh, sl), mat);
      m.position.set(...at(along, y, off));
      return prop(m);
    };
    const wallBox = (from, to, y0, y1) => {
      const len = to - from, h = y1 - y0, mid = (from + to) / 2;
      if (len < 1e-6) return;
      const geo = alongX ? new THREE.BoxGeometry(len, h, T) : new THREE.BoxGeometry(T, h, len);
      scaleUV(geo, len / 1.2, h / 1.2);
      const rooms = [side(mid, 0.3), side(mid, -0.3)], f0 = alongX ? 4 : 0; // box faces: +x, -x, +y, -y, +z, -z
      const mats = Array(6).fill(wallMat(null));
      mats[f0] = wallMat(rooms[0]);
      mats[f0 + 1] = wallMat(rooms[1]);
      const mesh = new THREE.Mesh(geo, mats);
      mesh.position.set(...at(mid, (y0 + y1) / 2));
      mesh.updateMatrixWorld();
      scene.add(mesh);
      surfaces.push(mesh);
      rooms.forEach((r, i) => r && allocFace(mesh, f0 + i, r.wallColor));
      if (y0 > 0) return;
      colliders.push(alongX ? { x0: from, x1: to, z0: fixed - T / 2, z1: fixed + T / 2 } : { x0: fixed - T / 2, x1: fixed + T / 2, z0: from, z1: to });
      rooms.forEach((r, i) => r && beam(len, 0.1, 0.014, trim, mid, 0.05, (i ? -1 : 1) * (T / 2 + 0.007))); // baseboard
    };

    let from = alongX ? w.a[0] : w.a[1];
    const openings = [
      ...(w.doors || []).map(([c, width]) => ({ c, width, y0: 0, y1: DOOR_H })),
      ...(w.windows || []).map(([c, width]) => ({ c, width, y0: WIN_Y0, y1: WIN_Y1 })),
    ].sort((p, q) => p.c - q.c);
    for (const o of openings) {
      const a = o.c - o.width / 2, b = o.c + o.width / 2, oh = o.y1 - o.y0, yc = o.y0 + oh / 2, D = T + 0.05;
      wallBox(from, a, 0, H);
      wallBox(a, b, o.y1, H); // lintel
      if (o.y0) wallBox(a, b, 0, o.y0); // wall under a window
      // Casing: bars centred on the cut edges, so the raw wall ends are hidden inside them.
      const mat = o.y0 ? trim : walnut;
      for (const e of [a, b]) beam(0.08, oh, D, mat, e, yc);
      beam(o.width + 0.16, 0.08, D, mat, o.c, o.y1);
      if (o.y0) {
        beam(o.width + 0.2, 0.05, T + 0.16, trim, o.c, o.y0); // sill board
        beam(0.04, oh, 0.05, trim, o.c, yc); // mullion
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(o.width, oh), glass);
        pane.position.set(...at(o.c, yc));
        if (!alongX) pane.rotation.y = Math.PI / 2;
        scene.add(pane);
        const inward = side(o.c, 0.3) ? 1 : -1;
        portals.push({
          centre: new THREE.Vector3(...at(o.c, yc)), n: new THREE.Vector3().setComponent(alongX ? 2 : 0, inward),
          u: new THREE.Vector3().setComponent(alongX ? 0 : 2, o.width), v: new THREE.Vector3(0, oh, 0),
        });
      }
      from = b;
    }
    wallBox(from, end, 0, H);
  }

  const ceilMat = lit({ color: 0xf4f2ee });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.86, 0.66).multiplyScalar(5) }); // over 1.0 so it blooms
  for (const r of ROOMS) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const fgeo = new THREE.PlaneGeometry(w, d);
    scaleUV(fgeo, w / 2, d / 2);
    const floor = new THREE.Mesh(fgeo, lit({ map: tex(r.floorTex) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, H, cz);
    scene.add(floor, ceil);
    floor.updateMatrixWorld();
    ceil.updateMatrixWorld();
    surfaces.push(floor, ceil);
    allocFace(floor, 0, r.floorAlbedo);
    allocFace(ceil, 0, 0xf4f2ee);

    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), lampMat);
    lamp.position.set(cx, H - 0.02, cz);
    scene.add(lamp);
    lamps.push({ pos: new THREE.Vector3(cx, H - 0.05, cz), r: 0.22, power: r.lamp ?? 1 });
  }

  // Every face has its atlas rectangle now, so the atlas height is known: write uv1.
  const atlas = { w: ATLAS_W, h: penY + rowH + 1 };
  for (const f of faces) {
    const g = f.mesh.geometry;
    if (!g.attributes.uv1) g.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    [[0, 1], [1, 1], [0, 0], [1, 0]].forEach(([u, v], i) => g.attributes.uv1.setXY(f.vOff + i, (f.rect.x + u * f.rect.w) / atlas.w, (f.rect.y + v * f.rect.h) / atlas.h));
  }

  // Props get their light from vertex colours times this plain ambient.
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));

  // Bathroom fixtures: no CC0 models at hand, so plain primitives.
  const white = new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.25 });
  const fixture = (w, h, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, Math.ceil(w / 0.3), 2, Math.ceil(d / 0.3)), white);
    m.position.set(x, h / 2, z);
    prop(m);
    colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
  };
  fixture(0.75, 0.55, 1.7, 9.55, 8.5); // tub
  fixture(0.9, 0.85, 0.5, 6.7, 9.15); // vanity

  const rug = (x, z, w, d, base, stripe) => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 176;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 256, 176);
    g.strokeStyle = stripe; g.lineWidth = 3; g.strokeRect(12, 12, 232, 152);
    g.lineWidth = 1;
    for (let i = 30; i < 230; i += 14) { g.beginPath(); g.moveTo(i, 24); g.lineTo(i, 152); g.stroke(); }
    const map = Object.assign(new THREE.CanvasTexture(c), { colorSpace: THREE.SRGBColorSpace });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d, Math.ceil(w / 0.2), Math.ceil(d / 0.2)), new THREE.MeshStandardMaterial({ map, roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.006, z);
    prop(m);
  };
  rug(3, 2.1, 2.8, 1.9, '#2f4a4f', '#d9c9a3');
  rug(3.4, 7.9, 1.7, 2.3, '#8a4b32', '#ecd9b8');

  occluders.push(...surfaces);

  const gltf = new GLTFLoader();
  const ready = Promise.all(FURNITURE.map(([name]) => gltf.loadAsync(`/models/${name}/${name}.gltf`))).then(async (loaded) => {
    loaded.forEach(({ scene: obj }, i) => { // in list order, so the props order is stable
      const [, x, z, rot] = FURNITURE[i];
      obj.position.set(x, 0, z);
      obj.rotation.y = rot;
      scene.add(obj);
      obj.updateMatrixWorld(true);
      obj.traverse((o) => { if (o.isMesh) { props.push(o); occluders.push(o); } });
      const b = new THREE.Box3().setFromObject(obj);
      if (b.max.y > 0.25) colliders.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z });
    });
    // Baked light for props: one RGB float triple per vertex, concatenated in props order.
    const res = await fetch('/bake/props.bin').catch(() => null);
    const data = res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    const expected = props.reduce((s, m) => s + m.geometry.attributes.position.count * 12, 0);
    if (data?.byteLength !== expected) return console.warn('No matching light bake for props: run `node tests/bake.mjs`.');
    const floats = new Float32Array(data.buffer);
    let at = 0;
    for (const m of props) {
      const n = m.geometry.attributes.position.count * 3;
      m.geometry.setAttribute('color', new THREE.BufferAttribute(floats.subarray(at, at + n), 3));
      at += n;
      for (const mat of [].concat(m.material)) { mat.vertexColors = true; mat.needsUpdate = true; }
    }
  });

  return { surfaces, occluders, colliders, props, faces, atlas, portals, lamps, ready };
}
