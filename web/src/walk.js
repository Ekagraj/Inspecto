// First-person walk: pointer-lock (or drag) look, WASD move, circle-vs-rectangle collision.
import * as THREE from 'three';

const EYE = 1.6, RADIUS = 0.25, SPEED = 2.2, RUN = 4.2;

export function createWalk(camera, dom, colliders) {
  const keys = new Set();
  let yaw = 0, pitch = 0, dragging = false, enabled = true;
  camera.rotation.order = 'YXZ';

  const apply = () => camera.rotation.set(pitch, yaw, 0);
  const look = (dx, dy) => {
    yaw -= dx * 0.0023;
    pitch = THREE.MathUtils.clamp(pitch - dy * 0.0023, -1.45, 1.45);
    apply();
  };

  dom.addEventListener('mousedown', () => { dragging = true; });
  addEventListener('mouseup', () => { dragging = false; });
  addEventListener('mousemove', (e) => {
    if (enabled && (document.pointerLockElement === dom || dragging)) look(e.movementX, e.movementY);
  });
  addEventListener('keydown', (e) => { if (!e.target.closest?.('input,textarea')) keys.add(e.code); });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const collide = (p) => {
    for (const c of colliders) {
      const nx = THREE.MathUtils.clamp(p.x, c.x0, c.x1), nz = THREE.MathUtils.clamp(p.z, c.z0, c.z1);
      const dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
      if (d2 >= RADIUS * RADIUS) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2), push = (RADIUS - d) / d;
        p.x += dx * push; p.z += dz * push;
      } else { // centre is inside the rectangle: leave through the nearest edge
        const exits = [[c.x0 - RADIUS - p.x, 0], [c.x1 + RADIUS - p.x, 0], [0, c.z0 - RADIUS - p.z], [0, c.z1 + RADIUS - p.z]];
        const [ex, ez] = exits.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
        p.x += ex; p.z += ez;
      }
    }
  };

  return {
    // Pointer lock can be refused (headless, embedded views); drag-to-look still works.
    lock: () => { dom.requestPointerLock?.()?.catch?.(() => {}); },
    set enabled(v) { enabled = v; if (!v) keys.clear(); },
    teleport(x, z, y = 0, p = 0) { camera.position.set(x, EYE, z); yaw = y; pitch = p; apply(); },
    update(dt) {
      if (!enabled) return;
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      if (!f && !s) return;
      const v = (keys.has('ShiftLeft') ? RUN : SPEED) * Math.min(dt, 0.05) / Math.hypot(f, s);
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const p = camera.position;
      p.x += (-sin * f + cos * s) * v;
      p.z += (-cos * f - sin * s) * v;
      collide(p); collide(p); // second pass settles corners
    },
  };
}
