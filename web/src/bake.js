// Offline light bake (a dev tool, loaded only by tests/bake.mjs). A small CPU lightmapper:
//   1. direct light at every lightmap texel and prop vertex: sun, sky through the window
//      openings, ceiling lamps, each with shadow rays;
//   2. a few gather passes: each point looks around with cosine-weighted rays and collects
//      the light already stored where the rays land, which adds bounced light and soft
//      ambient occlusion.
// Stored values are V = irradiance / PI, so a surface shows albedo x V.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { LIGHT_SCALE, SUN_DIR } from './house.js';
import { rng } from './defects.js';

const SUN = [15, 13.3, 11]; // irradiance on a surface facing the sun
const SKY = [8.8, 10.8, 13.2]; // radiance of the sky seen through a window
const LAMP = [74, 56, 35]; // radiance of a ceiling lamp disc
const EPS = 0.012;

export async function bake({ scene, house }, { samples = 48, passes = 3, directSamples = 8 } = {}) {
  const t0 = performance.now(), rand = rng(1234);
  scene.updateMatrixWorld(true);

  // --- Triangle soup of everything that blocks light, with a face id or albedo per triangle.
  const meshes = [...house.surfaces, ...house.props];
  const triCountOf = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  const triTotal = meshes.reduce((s, m) => s + triCountOf(m), 0);
  const pos = new Float32Array(triTotal * 9), triN = new Float32Array(triTotal * 3);
  const triFace = new Int32Array(triTotal).fill(-1), triAlb = new Float32Array(triTotal * 3).fill(0.5), triV = new Float32Array(triTotal * 3);
  const faceIds = new Map(); // surface mesh -> face id per box side
  house.faces.forEach((f, id) => { (faceIds.get(f.mesh) ?? faceIds.set(f.mesh, []).get(f.mesh))[f.vOff / 4] = id; });
  const surfaceCount = house.surfaces.length, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), col = new THREE.Color();
  const propTri0 = []; // first triangle of each prop
  let t = 0;
  meshes.forEach((m, mi) => {
    const p = m.geometry.attributes.position, idx = m.geometry.index, ids = faceIds.get(m);
    if (mi >= surfaceCount) {
      propTri0.push(t);
      const mat = [].concat(m.material)[0];
      col.copy(mat.color ?? col.set(1, 1, 1)).multiplyScalar(mat.map ? 0.5 : 1); // textured props: assume a mid-tone
    }
    for (let k = 0, n = triCountOf(m); k < n; k++, t++) {
      const v = [a, b, c].map((vec, j) => vec.fromBufferAttribute(p, idx ? idx.getX(k * 3 + j) : k * 3 + j).applyMatrix4(m.matrixWorld));
      v.forEach((vec, j) => vec.toArray(pos, t * 9 + j * 3));
      b.sub(a); c.sub(a); b.cross(c).normalize().toArray(triN, t * 3);
      const face = mi < surfaceCount ? ids?.[k >> 1] ?? -1 : -1; // two triangles per rectangular face
      triFace[t] = face;
      if (face >= 0) triAlb.set(house.faces[face].albedo, t * 3);
      else if (mi >= surfaceCount) col.toArray(triAlb, t * 3);
    }
  });
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const bvh = new MeshBVH(geo);
  const order = geo.index; // MeshBVH reorders triangles through this index
  console.log(`bake: ${triTotal} triangles, ${house.faces.length} faces, atlas ${house.atlas.w}x${house.atlas.h}`);

  const ray = new THREE.Ray(), d = new THREE.Vector3(), q = new THREE.Vector3();
  /** First hit along (o, dir) -> original triangle id, or -1. Sets hitDist. */
  let hitDist = 0;
  const trace = (o, dir, far = Infinity) => {
    ray.origin.copy(o); ray.direction.copy(dir);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 1e-4, far);
    if (!hit) return -1;
    hitDist = hit.distance;
    return (order.getX(hit.faceIndex * 3) / 3) | 0;
  };

  // --- Per-face and per-prop storage.
  const F = house.faces.map((f) => {
    const n = f.rect.w * f.rect.h;
    return { ...f, direct: new Float32Array(n * 3), ind: new Float32Array(n * 3), total: new Float32Array(n * 3), bad: new Uint8Array(n), du2: f.du.lengthSq(), dv2: f.dv.lengthSq() };
  });
  const P = house.props.map((m, i) => {
    const n = m.geometry.attributes.position.count, nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    const wp = new Float32Array(n * 3), wn = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      a.fromBufferAttribute(m.geometry.attributes.position, k).applyMatrix4(m.matrixWorld).toArray(wp, k * 3);
      b.fromBufferAttribute(m.geometry.attributes.normal, k).applyMatrix3(nm).normalize().toArray(wn, k * 3);
    }
    return { mesh: m, tri0: propTri0[i], n, wp, wn, direct: new Float32Array(n * 3), ind: new Float32Array(n * 3), total: new Float32Array(n * 3), bad: new Uint8Array(n) };
  });

  // --- Direct light at point p (already lifted off the surface) with normal n. Adds into out[o..o+2].
  const sun = new THREE.Vector3();
  function direct(p, n, out, o) {
    sun.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.05).add(SUN_DIR).normalize(); // soft-edged sun
    let k = n.dot(sun);
    if (k > 0 && trace(p, sun) < 0) { k /= Math.PI; out[o] += SUN[0] * k; out[o + 1] += SUN[1] * k; out[o + 2] += SUN[2] * k; }
    for (const w of house.portals) {
      q.copy(w.centre).addScaledVector(w.u, rand() - 0.5).addScaledVector(w.v, rand() - 0.5);
      d.subVectors(q, p);
      const r2 = d.lengthSq(), r = Math.sqrt(r2);
      d.divideScalar(r);
      const cp = n.dot(d), cw = -w.n.dot(d);
      if (cp <= 0 || cw <= 0 || trace(p, d, r - 1e-3) >= 0) continue;
      k = cp * cw * w.u.length() * w.v.length() / (Math.PI * Math.max(r2, 0.05));
      out[o] += SKY[0] * k; out[o + 1] += SKY[1] * k; out[o + 2] += SKY[2] * k;
    }
    for (const l of house.lamps) {
      const rr = l.r * Math.sqrt(rand()), an = rand() * Math.PI * 2;
      q.set(l.pos.x + rr * Math.cos(an), l.pos.y, l.pos.z + rr * Math.sin(an));
      d.subVectors(q, p);
      const r2 = d.lengthSq(), r = Math.sqrt(r2);
      d.divideScalar(r);
      const cp = n.dot(d), cl = d.y; // the lamp faces down
      if (cp <= 0 || cl <= 0 || r > 9 || trace(p, d, r - 1e-3) >= 0) continue;
      k = l.power * cp * cl * Math.PI * l.r * l.r / (Math.PI * Math.max(r2, 0.05));
      out[o] += LAMP[0] * k; out[o + 1] += LAMP[1] * k; out[o + 2] += LAMP[2] * k;
    }
  }

  // --- One gather sample: light leaving whatever a cosine-weighted ray from p hits.
  const tu = new THREE.Vector3(), tv = new THREE.Vector3(), hp = new THREE.Vector3();
  const frame = (n) => { tu.set(Math.abs(n.y) > 0.9 ? 1 : 0, Math.abs(n.y) > 0.9 ? 0 : 1, 0).cross(n).normalize(); tv.crossVectors(n, tu); };
  /** Adds bounced light into out[o..]; returns 1 if the ray hit the back of a surface (p is inside something). */
  function gather(p, n, out, o) {
    const r1 = rand(), r2 = rand() * Math.PI * 2, r = Math.sqrt(r1);
    d.copy(n).multiplyScalar(Math.sqrt(1 - r1)).addScaledVector(tu, r * Math.cos(r2)).addScaledVector(tv, r * Math.sin(r2));
    const tri = trace(p, d);
    if (tri < 0) return 0; // escaped through a window: the sky is already counted as direct light
    if (triN[tri * 3] * d.x + triN[tri * 3 + 1] * d.y + triN[tri * 3 + 2] * d.z > 0) return 1;
    const face = triFace[tri];
    let src = triV, so = tri * 3;
    if (face >= 0) {
      const f = F[face];
      hp.copy(p).addScaledVector(d, hitDist).sub(f.origin);
      const i = Math.min(f.rect.w - 1, Math.max(0, Math.floor(hp.dot(f.du) / f.du2 * f.rect.w)));
      const j = Math.min(f.rect.h - 1, Math.max(0, Math.floor(hp.dot(f.dv) / f.dv2 * f.rect.h)));
      src = f.total; so = (j * f.rect.w + i) * 3;
    }
    out[o] += triAlb[tri * 3] * src[so]; out[o + 1] += triAlb[tri * 3 + 1] * src[so + 1]; out[o + 2] += triAlb[tri * 3 + 2] * src[so + 2];
    return 0;
  }

  /** Visit every texel and prop vertex: fn(point, normal, store, offset, jitterU, jitterV). */
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  function everywhere(fn) {
    for (const f of F) {
      n.copy(f.n);
      for (let j = 0; j < f.rect.h; j++) for (let i = 0; i < f.rect.w; i++) {
        fn(f, (j * f.rect.w + i) * 3, (ju, jv) => p.copy(f.origin).addScaledVector(f.du, (i + ju) / f.rect.w).addScaledVector(f.dv, (j + jv) / f.rect.h).addScaledVector(n, EPS));
      }
    }
    for (const s of P) for (let k = 0; k < s.n; k++) {
      n.fromArray(s.wn, k * 3);
      fn(s, k * 3, () => p.fromArray(s.wp, k * 3).addScaledVector(n, EPS));
    }
  }
  const refreshProps = () => { // a prop triangle shines with the mean of its corners
    for (const s of P) {
      const idx = s.mesh.geometry.index, nt = triCountOf(s.mesh);
      for (let k = 0; k < nt; k++) for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (let j = 0; j < 3; j++) sum += s.total[(idx ? idx.getX(k * 3 + j) : k * 3 + j) * 3 + ch];
        triV[(s.tri0 + k) * 3 + ch] = sum / 3;
      }
    }
  };

  // --- 1. Direct.
  everywhere((s, o, at) => {
    for (let k = 0; k < directSamples; k++) { at(rand(), rand()); direct(p, n, s.direct, o); }
    for (let ch = 0; ch < 3; ch++) s.total[o + ch] = s.direct[o + ch] /= directSamples;
  });
  refreshProps();
  console.log(`bake: direct done ${((performance.now() - t0) / 1000).toFixed(0)}s`);

  // --- 2. Gather passes (each adds one more bounce).
  for (let pass = 0; pass < passes; pass++) {
    everywhere((s, o, at) => {
      let back = 0;
      s.ind[o] = s.ind[o + 1] = s.ind[o + 2] = 0;
      frame(n);
      for (let k = 0; k < samples; k++) { at(rand(), rand()); back += gather(p, n, s.ind, o); }
      for (let ch = 0; ch < 3; ch++) s.ind[o + ch] /= samples;
      if (pass === 0) s.bad[o / 3] = back > samples * 0.4 ? 1 : 0; // mostly back faces: the point is inside a wall or object
    });
    // Bounced light is smooth by nature, so blur it hard (twice = roughly Gaussian) to kill sampling blotches.
    for (const f of F) { blur(f.ind, f.bad, f.rect.w, f.rect.h, 4); blur(f.ind, f.bad, f.rect.w, f.rect.h, 4); }
    for (const s of [...F, ...P]) for (let i = 0; i < s.total.length; i++) s.total[i] = s.direct[i] + s.ind[i];
    refreshProps();
    console.log(`bake: gather ${pass + 1}/${passes} done ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }

  // --- 3. Clean up and write out.
  for (const f of F) { blur(f.total, f.bad, f.rect.w, f.rect.h, 1); dilate(f.total, f.bad, f.rect.w, f.rect.h); }
  for (const s of P) { // vertices buried in other geometry take the prop's average light
    const mean = [0, 0, 0];
    let good = 0;
    for (let k = 0; k < s.n; k++) if (!s.bad[k]) { good++; for (let ch = 0; ch < 3; ch++) mean[ch] += s.total[k * 3 + ch]; }
    for (let k = 0; k < s.n; k++) if (s.bad[k] && good) for (let ch = 0; ch < 3; ch++) s.total[k * 3 + ch] = mean[ch] / good;
  }

  const { w: W, h: Hh } = house.atlas, canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = Hh;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(W, Hh);
  const srgb = (x) => { x = Math.min(1, Math.max(0, x / LIGHT_SCALE)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)); };
  for (const f of F) {
    const { x, y, w, h } = f.rect;
    for (let j = -1; j <= h; j++) for (let i = -1; i <= w; i++) { // one texel of padding, edge colour repeated
      const so = (Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))) * 3, o = ((y + j) * W + x + i) * 4;
      img.data[o] = srgb(f.total[so]); img.data[o + 1] = srgb(f.total[so + 1]); img.data[o + 2] = srgb(f.total[so + 2]); img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const propData = new Float32Array(P.reduce((s, x) => s + x.n * 3, 0));
  let at = 0;
  for (const s of P) { propData.set(s.total, at); at += s.n * 3; }
  const bytes = new Uint8Array(propData.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  console.log(`bake: finished in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  return { png: canvas.toDataURL('image/png'), props: btoa(bin) };
}

/** Box blur of radius r inside one face, skipping bad texels. */
function blur(data, bad, w, h, r) {
  const src = data.slice();
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (bad[j * w + i]) continue;
    let n = 0, s0 = 0, s1 = 0, s2 = 0;
    for (let y = Math.max(0, j - r); y <= Math.min(h - 1, j + r); y++) for (let x = Math.max(0, i - r); x <= Math.min(w - 1, i + r); x++) {
      if (bad[y * w + x]) continue;
      const o = (y * w + x) * 3;
      s0 += src[o]; s1 += src[o + 1]; s2 += src[o + 2]; n++;
    }
    const o = (j * w + i) * 3;
    data[o] = s0 / n; data[o + 1] = s1 / n; data[o + 2] = s2 / n;
  }
}

/** Fill bad texels (inside walls, under furniture legs) from their good neighbours. */
function dilate(data, bad, w, h) {
  for (let it = 0; it < 8; it++) {
    const was = bad.slice();
    let left = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!was[j * w + i]) continue;
      let n = 0, s0 = 0, s1 = 0, s2 = 0;
      for (let y = Math.max(0, j - 1); y <= Math.min(h - 1, j + 1); y++) for (let x = Math.max(0, i - 1); x <= Math.min(w - 1, i + 1); x++) {
        if (was[y * w + x]) continue;
        const o = (y * w + x) * 3;
        s0 += data[o]; s1 += data[o + 1]; s2 += data[o + 2]; n++;
      }
      if (!n) { left++; continue; }
      const o = (j * w + i) * 3;
      data[o] = s0 / n; data[o + 1] = s1 / n; data[o + 2] = s2 / n;
      bad[j * w + i] = 0;
    }
    if (!left) break;
  }
}
