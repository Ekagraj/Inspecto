// Floor-plan minimap: rooms, the player's position and heading, and pins.
import { ROOMS } from './house.js';
import { SEVERITY_COLOR } from './costs.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

export function createMinimap(svg) {
  svg.setAttribute('viewBox', '-0.3 -0.3 10.6 10.1');
  const rooms = Object.fromEntries(ROOMS.map((r) => {
    const rect = el('rect', { x: r.x0, y: r.z0, width: r.x1 - r.x0, height: r.z1 - r.z0, class: 'mm-room' });
    svg.append(rect);
    return [r.id, rect];
  }));
  const dots = el('g', {}), me = el('path', { d: 'M0,-0.42 L0.27,0.3 L0,0.14 L-0.27,0.3 Z', class: 'mm-me' });
  svg.append(dots, me);
  let current;
  return {
    /** yaw 0 looks north (-z); positive yaw turns left. */
    player(x, z, yaw, roomId) {
      me.setAttribute('transform', `translate(${x.toFixed(2)} ${z.toFixed(2)}) rotate(${(-yaw * 180 / Math.PI).toFixed(1)})`);
      if (roomId !== current) {
        rooms[current]?.classList.remove('on');
        rooms[current = roomId]?.classList.add('on');
      }
    },
    pins(findings) {
      dots.replaceChildren(...findings.map((f) => el('circle', { cx: f.pos[0], cy: f.pos[2], r: 0.2, fill: SEVERITY_COLOR[f.severity], class: 'mm-pin' })));
    },
  };
}
