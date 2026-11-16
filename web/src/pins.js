// Turn 2D detections into findings pinned at their 3D location.
import * as THREE from 'three';
import { describeHit } from './house.js';
import { severityOf, costOf, SEVERITY_COLOR } from './costs.js';
import { loadFindings, saveFindings } from './store.js';

const UP = new THREE.Vector3(0, 1, 0);
const ray = new THREE.Raycaster();
const ndc = (u, v) => new THREE.Vector2(u * 2 - 1, 1 - v * 2);

function iou(a, b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter);
}

function thumbnail(canvas, [x1, y1, x2, y2]) {
  const pad = 0.15, bw = (x2 - x1) * canvas.width, bh = (y2 - y1) * canvas.height;
  const sx = Math.max(0, x1 * canvas.width - bw * pad), sy = Math.max(0, y1 * canvas.height - bh * pad);
  const sw = Math.min(canvas.width - sx, bw * (1 + 2 * pad)), sh = Math.min(canvas.height - sy, bh * (1 + 2 * pad));
  const k = Math.min(1, 240 / Math.max(sw, sh)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

function markerTexture(n, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(48, 48, 40, 0, Math.PI * 2);
  g.fillStyle = color; g.fill();
  g.lineWidth = 8; g.strokeStyle = '#14181c'; g.stroke();
  g.fillStyle = '#14181c'; g.font = '700 44px ui-monospace, Menlo, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 48, 51);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPins(app, { persist = true, onChange = () => {}, source = () => null } = {}) {
  const { scene, house } = app;
  const surfaces = new Set(house.surfaces);
  const group = new THREE.Group();
  scene.add(group);
  let findings = persist ? loadFindings() : [];
  let selected = null;
  const born = new Map(); // finding id -> time it was pinned, for the pop-in animation

  /** Where on the house does this screen box sit? -> {pos, normal, u, w, h} or null. */
  function locate([x1, y1, x2, y2], cam) {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, qx = (x2 - x1) / 4, qy = (y2 - y1) / 4;
    // 1. Five rays vote for a surface plane. Furniture and windows occlude and do not vote.
    const planes = new Map();
    [[cx, cy], [cx - qx, cy - qy], [cx + qx, cy - qy], [cx - qx, cy + qy], [cx + qx, cy + qy]].forEach(([u, v], i) => {
      ray.setFromCamera(ndc(u, v), cam);
      const hit = ray.intersectObjects(house.occluders, false)[0];
      if (!hit || !surfaces.has(hit.object)) return;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
      if (n.dot(ray.ray.direction) > 0) n.negate();
      const key = `${n.x},${n.y},${n.z}|${Math.round(n.dot(hit.point) / 0.03)}`; // coplanar wall pieces share a key
      const p = planes.get(key) ?? { n, points: [], hasCentre: false };
      p.points.push(hit.point);
      p.hasCentre ||= i === 0;
      planes.set(key, p);
    });
    const best = [...planes.values()].sort((a, b) => b.points.length - a.points.length || b.hasCentre - a.hasCentre)[0];
    if (!best || best.points.length < 2) return null;

    // 2. Measure on the infinite plane, so a partly hidden defect is still centred and sized right.
    const n = best.n, plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, best.points[0]);
    const onPlane = (u, v) => { ray.setFromCamera(ndc(u, v), cam); return ray.ray.intersectPlane(plane, new THREE.Vector3()); };
    const pos = onPlane(cx, cy) ?? best.points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(best.points.length);
    // Mid-edge points, not corners: corners overestimate size when the view is oblique.
    const L = onPlane(x1, cy), R = onPlane(x2, cy), T = onPlane(cx, y1), B = onPlane(cx, y2);
    const size = (a, b) => THREE.MathUtils.clamp(a && b ? a.distanceTo(b) : 0.3, 0.05, 4);
    const u = Math.abs(n.y) < 0.5 ? new THREE.Vector3().crossVectors(UP, n)
      : (L && R ? R.clone().sub(L).normalize() : new THREE.Vector3(1, 0, 0));
    return { pos, normal: n, u, w: size(L, R), h: size(T, B) };
  }

  function draw() {
    for (const o of [...group.children]) {
      group.remove(o);
      o.geometry?.dispose();
      o.material.map?.dispose();
      o.material.dispose();
    }
    for (const f of findings) {
      const color = SEVERITY_COLOR[f.severity], pos = new THREE.Vector3(...f.pos), n = new THREE.Vector3(...f.normal);
      const u = new THREE.Vector3(...f.u).multiplyScalar(f.sizeM[0] / 2), v = new THREE.Vector3().crossVectors(n, new THREE.Vector3(...f.u)).multiplyScalar(f.sizeM[1] / 2);
      const base = pos.clone().addScaledVector(n, 0.012);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => base.clone().addScaledVector(u, a).addScaledVector(v, b));
      group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color, toneMapped: false })));
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(f.n, color), toneMapped: false, depthWrite: false }));
      sprite.position.copy(pos).addScaledVector(n, 0.04);
      sprite.userData.id = f.id;
      sprite.renderOrder = 2;
      group.add(sprite);
    }
  }

  function changed() {
    if (persist) saveFindings(findings);
    draw();
    onChange(findings);
  }

  const api = {
    get findings() { return findings; },
    locate,

    /** Pin detections from one captured view. -> {added, merged, ignored} */
    addDetections(dets, shot) {
      const result = { added: 0, merged: 0, ignored: 0 }, kept = [];
      for (const d of [...dets].sort((a, b) => b.score - a.score)) { // class-agnostic NMS
        if (kept.some((k) => iou(k.box, d.box) > 0.6)) result.ignored++; else kept.push(d);
      }
      for (const d of kept) {
        const loc = locate(d.box, shot.camera);
        const where = loc && describeHit(loc.pos, loc.normal);
        if (!where?.room) { result.ignored++; continue; } // not on a building surface
        // No labeled tile data exists: a crack on a tiled surface is reported as a damaged tile.
        const label = where.material === 'tile' && d.label.includes('crack') ? 'damaged_tile' : d.label;
        const severity = severityOf(label, loc.w, loc.h);
        // A box cut off by the frame edge gives a shifted centre and a too-small size.
        const clipped = d.box[0] < 0.01 || d.box[1] < 0.01 || d.box[2] > 0.99 || d.box[3] > 0.99;
        const fresh = {
          label, score: d.score, clipped, source: source(loc.pos.toArray()), room: where.room.id, roomName: where.room.name, surface: where.surface, material: where.material,
          pos: loc.pos.toArray(), normal: loc.normal.toArray(), u: loc.u.toArray(), sizeM: [loc.w, loc.h], areaM2: loc.w * loc.h,
          severity, cost: costOf(label, severity), thumb: thumbnail(shot.canvas, d.box), ts: Date.now(),
        };
        // Same spot seen again: keep the fully visible reading, then the more confident one.
        const twin = findings.find((f) => f.room === fresh.room && loc.pos.distanceTo(new THREE.Vector3(...f.pos))
          < (f.label === label ? Math.max(0.4, Math.max(...f.sizeM, loc.w, loc.h) / 2) : 0.25));
        if (twin) {
          if (twin.clipped !== clipped ? !clipped : d.score > twin.score) Object.assign(twin, fresh);
          result.merged++;
        } else {
          const id = crypto.randomUUID();
          born.set(id, performance.now());
          findings.push({ id, n: Math.max(0, ...findings.map((f) => f.n)) + 1, ...fresh });
          result.added++;
        }
      }
      changed();
      return result;
    },

    remove(id) {
      findings = findings.filter((f) => f.id !== id);
      if (selected === id) selected = null;
      changed();
    },
    clear() { findings = []; selected = null; changed(); },
    select(id) { selected = id; },
    set visible(v) { group.visible = v; },

    /** Per-frame marker animation: new pins pop in, the selected pin breathes. */
    update(now) {
      for (const s of group.children) {
        if (!s.isSprite) continue;
        const x = Math.min(1, (now - (born.get(s.userData.id) ?? 0)) / 450) - 1;
        const pop = 1 + 2.70158 * x ** 3 + 1.70158 * x ** 2; // ease-out-back
        s.scale.setScalar(0.17 * pop * (s.userData.id === selected ? 1.35 + 0.08 * Math.sin(now / 180) : 1));
      }
    },

    /** The pin nearest a screen point (NDC), if it is within `maxPx` and not hidden behind something. */
    pick(camera, point, maxPx = 70) {
      if (!group.visible) return null;
      const eye = camera.getWorldPosition(new THREE.Vector3()), w = app.renderer.domElement.clientWidth / 2, h = app.renderer.domElement.clientHeight / 2;
      const near = findings.map((f) => {
        const p = new THREE.Vector3(...f.pos).addScaledVector(new THREE.Vector3(...f.normal), 0.04), s = p.clone().project(camera);
        return { f, p, px: s.z > 1 ? Infinity : Math.hypot((s.x - point.x) * w, (s.y - point.y) * h) };
      }).filter((c) => c.px < maxPx).sort((a, b) => a.px - b.px);
      for (const c of near) {
        const dist = c.p.distanceTo(eye);
        ray.set(eye, c.p.clone().sub(eye).normalize());
        const first = ray.intersectObjects(house.occluders, false)[0];
        if (!first || first.distance > dist - 0.08) return c.f;
      }
      return null;
    },
  };
  draw();
  onChange(findings);
  return api;
}
