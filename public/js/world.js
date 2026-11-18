// World module: Procedural island terrain, biomes, volcano, ocean, annular road,
// elevated bridge/race circuit, instanced flora/rocks, shadows, and spatial hash collisions.

import { G, R, SIZE, SEG, VOLC, sm, rnd, SETTINGS } from './state.js';

// ---------- Procedural Noise ----------
export function hash(x, y) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 5; i++) {
    s += a * vn(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return s / 0.96875;
}

export function H0(x, z) {
  const d = Math.hypot(x, z) / R + (fbm(x * 0.008, z * 0.008) - 0.5) * 0.5;
  const m = sm(0, 0.6, 1 - d);
  const e = fbm(x * 0.012 + 9, z * 0.012);
  const mt = Math.pow(fbm(x * 0.02 + 100, z * 0.02), 2.2);
  let h = m * (5 + e * 14 + mt * 70) - 6;
  const vd = Math.hypot(x - VOLC.x, z - VOLC.z);
  if (vd < VOLC.R) {
    h = VOLC.floorY + (h - VOLC.floorY) * sm(4.5, VOLC.rim, vd);
    h += 3 * Math.exp(-Math.pow((vd - VOLC.rim) / 3.5, 2));
  }
  return h;
}

export let ROAD = null;
export let DECK = null;
export let RACE = null;

export function Hterr(x, z) {
  return ROAD ? ROAD.carve(x, z, H0(x, z)) : H0(x, z);
}

export function H(x, z) {
  const h = Hterr(x, z);
  if (x > 100 && DECK) {
    const d = DECK.at(x, z);
    if (d > h) return d;
  }
  return h;
}

export function biome(x, z) {
  const h = Hterr(x, z);
  if (h < 0) return 'Mar';
  if (h < 1.6) return 'Playa';
  const sec = Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * 3) % 3;
  if (sec === 0) return 'Nieve';
  if (sec === 1) return 'Desierto';
  return h > 24 ? 'Montaña' : 'Bosque';
}

// Fast terrain raycast (coarse step + binary refinement)
export function terrainRayDist(o, d, maxDist = 250) {
  let prevT = 1.5;
  for (let t = 2.0; t <= maxDist; t += 2.0) {
    const px = o.x + d.x * t;
    const py = o.y + d.y * t;
    const pz = o.z + d.z * t;
    if (py < H(px, pz)) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 5; k++) {
        const mid = (lo + hi) * 0.5;
        if (o.y + d.y * mid < H(o.x + d.x * mid, o.z + d.z * mid)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prevT = t;
  }
  return maxDist;
}

export function los(ax, ay, az, bx, by, bz) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 2.2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (ay + (by - ay) * t < H(ax + (bx - ax) * t, az + (bz - az) * t) + 0.3) return false;
  }
  return true;
}

// ---------- Spatial Hash Obstacles ----------
export const OBS = [];
const CELL_SIZE = 8;
const obsGrid = new Map();

function cellKey(cx, cz) {
  return `${cx},${cz}`;
}

function registerInGrid(o) {
  const minX = Math.floor((o.x - o.r - 2.5) / CELL_SIZE);
  const maxX = Math.floor((o.x + o.r + 2.5) / CELL_SIZE);
  const minZ = Math.floor((o.z - o.r - 2.5) / CELL_SIZE);
  const maxZ = Math.floor((o.z + o.r + 2.5) / CELL_SIZE);
  o._cells = [];
  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const k = cellKey(cx, cz);
      let arr = obsGrid.get(k);
      if (!arr) {
        arr = [];
        obsGrid.set(k, arr);
      }
      arr.push(o);
      o._cells.push(k);
    }
  }
}

function unregisterFromGrid(o) {
  if (!o._cells) return;
  for (const k of o._cells) {
    const arr = obsGrid.get(k);
    if (!arr) continue;
    const idx = arr.indexOf(o);
    if (idx >= 0) arr.splice(idx, 1);
  }
  o._cells = null;
}

export function addObstacle(o) {
  if (OBS.indexOf(o) < 0) {
    OBS.push(o);
    registerInGrid(o);
  }
}

export function removeObstacle(o) {
  const idx = OBS.indexOf(o);
  if (idx >= 0) {
    OBS.splice(idx, 1);
    unregisterFromGrid(o);
  }
}

export function updateDynamicObstacle(o, nx, nz) {
  if (!o) return;
  const active = OBS.indexOf(o) >= 0;
  if (active) unregisterFromGrid(o);
  o.x = nx;
  o.z = nz;
  if (active) registerInGrid(o);
}

export function pushOut(o, pr) {
  const cx = Math.floor(o.x / CELL_SIZE);
  const cz = Math.floor(o.z / CELL_SIZE);
  const seen = new Set();
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const arr = obsGrid.get(cellKey(cx + dx, cz + dz));
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const c = arr[k];
        if (seen.has(c)) continue;
        seen.add(c);
        const odx = o.x - c.x;
        const odz = o.z - c.z;
        const rr = c.r + pr;
        if (odx > rr || odx < -rr || odz > rr || odz < -rr) continue;
        const d2 = odx * odx + odz * odz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2);
          if (d < 1e-4) {
            o.x = c.x + rr;
          } else {
            o.x = c.x + (odx / d) * rr;
            o.z = c.z + (odz / d) * rr;
          }
        }
      }
    }
  }
}

export function hasNearbyObstacle(x, z, radius, ignoreFn = null) {
  const cx = Math.floor(x / CELL_SIZE);
  const cz = Math.floor(z / CELL_SIZE);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const arr = obsGrid.get(cellKey(cx + dx, cz + dz));
      if (!arr) continue;
      for (let k = 0; k < arr.length; k++) {
        const o = arr[k];
        if (ignoreFn && ignoreFn(o)) continue;
        if (Math.hypot(x - o.x, z - o.z) < o.r + radius) return true;
      }
    }
  }
  return false;
}

// ---------- Road & Deck Builders ----------
function buildRoad(PTS) {
  const N = PTS.length / 3;
  const HALF = 3.6, SHOULDER = 1.0, FLAT = 8.5, BLEND = 16, REACH = FLAT + BLEND + 1.5;
  const CELL = 0.5, X0 = -150, Z0 = -150, NX = 600, NZ = 600;
  const dist = new Float32Array(NX * NZ).fill(40);
  const yy = new Float32Array(NX * NZ);

  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const ax = PTS[i * 3], az = PTS[i * 3 + 1], ay = PTS[i * 3 + 2];
    const bx = PTS[j * 3], bz = PTS[j * 3 + 1], by = PTS[j * 3 + 2];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const gx0 = Math.max(0, Math.floor((Math.min(ax, bx) - REACH - X0) / CELL));
    const gx1 = Math.min(NX - 1, Math.ceil((Math.max(ax, bx) + REACH - X0) / CELL));
    const gz0 = Math.max(0, Math.floor((Math.min(az, bz) - REACH - Z0) / CELL));
    const gz1 = Math.min(NZ - 1, Math.ceil((Math.max(az, bz) + REACH - Z0) / CELL));
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = X0 + gx * CELL, pz = Z0 + gz * CELL;
        let t = ((px - ax) * dx + (pz - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
        const k = gz * NX + gx;
        if (d < dist[k]) {
          dist[k] = d;
          yy[k] = ay + (by - ay) * t;
        }
      }
    }
  }

  function look(x, z, arr) {
    const fx = (x - X0) / CELL, fz = (z - Z0) / CELL;
    if (fx < 0 || fz < 0 || fx >= NX - 1 || fz >= NZ - 1) return null;
    const ix = fx | 0, iz = fz | 0, u = fx - ix, v = fz - iz, k = iz * NX + ix;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + NX] * (1 - u) + arr[k + NX + 1] * u) * v;
  }

  function distTo(x, z) {
    const d = look(x, z, dist);
    return d === null ? 40 : d;
  }

  function carve(x, z, h0) {
    const d = look(x, z, dist);
    if (d === null || d >= FLAT + BLEND) return h0;
    const s = Math.min(1, Math.max(0, (d - FLAT) / BLEND)), w = 1 - s * s * (3 - 2 * s);
    return h0 + (look(x, z, yy) - h0) * w;
  }

  function sample(SUB) {
    const out = [];
    const P = i => {
      i = ((i % N) + N) % N;
      return [PTS[i * 3], PTS[i * 3 + 1], PTS[i * 3 + 2]];
    };
    for (let i = 0; i < N; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let s = 0; s < SUB; s++) {
        const t = s / SUB, t2 = t * t, t3 = t2 * t, r = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          r[c] = 0.5 * (
            2 * p1[c] +
            (-p0[c] + p2[c]) * t +
            (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 +
            (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3
          );
        }
        out.push(r);
      }
    }
    return out;
  }

  function ribbon(lift) {
    const S = sample(2), n = S.length;
    const asp = { p: [], uv: [], idx: [] }, sh = { p: [], uv: [], idx: [] };
    let len = 0;
    for (let i = 0; i <= n; i++) {
      const a = S[i % n], b = S[(i + 1) % n], c = S[(i - 1 + n) % n];
      if (i > 0) len += Math.hypot(a[0] - S[i - 1][0], a[1] - S[i - 1][1]);
      let tx = b[0] - c[0], tz = b[1] - c[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx, y = a[2] + lift;
      const at = o => [a[0] + nx * o, y, a[1] + nz * o];
      asp.p.push(...at(-HALF), ...at(HALF));
      asp.uv.push(0, len / 14.4, 1, len / 14.4);
      sh.p.push(...at(-HALF - SHOULDER), ...at(-HALF), ...at(HALF), ...at(HALF + SHOULDER));
      sh.uv.push(len / 3, 0.06, len / 3, 0.44, len / 3, 0.44, len / 3, 0.06);
    }
    for (let i = 0; i < n; i++) {
      let q = i * 2;
      asp.idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      q = i * 4;
      sh.idx.push(q, q + 1, q + 4, q + 1, q + 5, q + 4, q + 2, q + 3, q + 6, q + 3, q + 7, q + 6);
    }
    return { asp, sh, length: len };
  }

  return { N, PTS, HALF, SHOULDER, FLAT, BLEND, distTo, carve, ribbon, sample };
}

function buildDeck(LOOP) {
  const N = LOOP.length / 2;
  const BR = { x0: 117.7, z0: -12, y0: 7.99, jx: 270 };
  const HALF = 6, Y = 3.0, BAR = 0.6;
  const yProf = s => BR.y0 + (Y - BR.y0) * sm(8, 80, s);
  const CELL = 0.5, X0 = 100, Z0 = -230, NX = 1400, NZ = 740, REACH = HALF + 1.5;
  const dist = new Float32Array(NX * NZ).fill(40);
  const yy = new Float32Array(NX * NZ);

  function seg(ax, az, ay, bx, bz, by) {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
    const g0 = Math.max(0, Math.floor((Math.min(ax, bx) - REACH - X0) / CELL));
    const g1 = Math.min(NX - 1, Math.ceil((Math.max(ax, bx) + REACH - X0) / CELL));
    const h0 = Math.max(0, Math.floor((Math.min(az, bz) - REACH - Z0) / CELL));
    const h1 = Math.min(NZ - 1, Math.ceil((Math.max(az, bz) + REACH - Z0) / CELL));
    for (let gz = h0; gz <= h1; gz++) {
      for (let gx = g0; gx <= g1; gx++) {
        const px = X0 + gx * CELL, pz = Z0 + gz * CELL;
        let t = ((px - ax) * dx + (pz - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - ax - dx * t, pz - az - dz * t);
        const k = gz * NX + gx;
        if (d < dist[k]) {
          dist[k] = d;
          yy[k] = ay + (by - ay) * t;
        }
      }
    }
  }

  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    seg(LOOP[i * 2], LOOP[i * 2 + 1], Y, LOOP[j * 2], LOOP[j * 2 + 1], Y);
  }
  for (let s = 0; s < BR.jx - BR.x0; s += 2) {
    const e = Math.min(s + 2, BR.jx - BR.x0);
    seg(BR.x0 + s, BR.z0, yProf(s), BR.x0 + e, BR.z0, yProf(e));
  }

  function at(x, z) {
    const fx = (x - X0) / CELL, fz = (z - Z0) / CELL;
    if (fx < 0 || fz < 0 || fx >= NX - 1 || fz >= NZ - 1) return -1e9;
    const ix = fx | 0, iz = fz | 0, u = fx - ix, v = fz - iz, k = iz * NX + ix;
    const d = (dist[k] * (1 - u) + dist[k + 1] * u) * (1 - v) + (dist[k + NX] * (1 - u) + dist[k + NX + 1] * u) * v;
    if (d > HALF) return -1e9;
    return (yy[k] * (1 - u) + yy[k + 1] * u) * (1 - v) + (yy[k + NX] * (1 - u) + yy[k + NX + 1] * u) * v;
  }

  function distTo(x, z) {
    const fx = (x - X0) / CELL, fz = (z - Z0) / CELL;
    if (fx < 0 || fz < 0 || fx >= NX - 1 || fz >= NZ - 1) return 40;
    const ix = fx | 0, iz = fz | 0, u = fx - ix, v = fz - iz, k = iz * NX + ix;
    return (dist[k] * (1 - u) + dist[k + 1] * u) * (1 - v) + (dist[k + NX] * (1 - u) + dist[k + NX + 1] * u) * v;
  }

  function bridgeSamples(step) {
    const L = BR.jx - 6 - BR.x0, n = Math.ceil(L / step), out = [];
    for (let i = 0; i <= n; i++) {
      const s = Math.min(L, i * step);
      out.push([BR.x0 + s, BR.z0, yProf(s)]);
    }
    return out;
  }

  function loopSamples(sub) {
    const out = [];
    const P = i => {
      i = ((i % N) + N) % N;
      return [LOOP[i * 2], LOOP[i * 2 + 1]];
    };
    for (let i = 0; i < N; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let s = 0; s < sub; s++) {
        const t = s / sub, t2 = t * t, t3 = t2 * t, r = [0, 0, Y];
        for (let c = 0; c < 2; c++) {
          r[c] = 0.5 * (
            2 * p1[c] +
            (-p0[c] + p2[c]) * t +
            (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 +
            (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3
          );
        }
        out.push(r);
      }
    }
    return out;
  }

  const nearJ = p => Math.abs(p[1] - BR.z0) < 6.5 && Math.abs(p[0] - BR.jx) < 2;

  function extrude(S, closed, prof, sc, skip) {
    const n = S.length, P = [], UV = [], I = [], T = [], s = [0];
    let base = 0;
    for (let i = 0; i < n; i++) {
      const a = S[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = S[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      T.push([tx / l, tz / l]);
      if (i > 0) s.push(s[i - 1] + Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]));
    }
    s.push(closed ? s[n - 1] + Math.hypot(S[0][0] - S[n - 1][0], S[0][1] - S[n - 1][1]) : s[n - 1]);
    const V = (i, k) => {
      const a = S[i % n], t = T[i % n], q = prof[k];
      return [a[0] - t[1] * q[0], a[2] + q[1], a[1] + t[0] * q[0]];
    };
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      if (skip && skip(S[i], i)) continue;
      for (let k = 0; k < prof.length - 1; k++) {
        P.push(...V(i, k), ...V(i, k + 1), ...V(i + 1, k), ...V(i + 1, k + 1));
        UV.push(prof[k][2], s[i] / sc, prof[k + 1][2], s[i] / sc, prof[k][2], s[i + 1] / sc, prof[k + 1][2], s[i + 1] / sc);
        I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        base += 4;
      }
    }
    return { p: P, uv: UV, idx: I, length: s[n] };
  }

  function circles() {
    const out = [], o = HALF + BAR, B = bridgeSamples(1.25), L = loopSamples(2);
    const side = (S, closed, isLoop) => {
      const n = S.length;
      for (let i = 0; i < n; i++) {
        const a = S[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
        const b = S[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const l = Math.hypot(tx, tz) || 1;
        tx /= l; tz /= l;
        for (const sg of [-1, 1]) {
          if (isLoop && sg === 1 && Math.abs(S[i][1] - BR.z0) < 7.4 && Math.abs(S[i][0] - BR.jx) < 2) continue;
          out.push([S[i][0] - tz * o * sg, S[i][1] + tx * o * sg]);
        }
      }
    };
    side(B, false, false);
    side(L, true, true);
    return out;
  }

  function kerbRuns(S) {
    const n = S.length, flag = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const a = S[(i - 6 + n) % n], b = S[i], c = S[(i + 6) % n];
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1];
      const cr = ux * vz - uz * vx, lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
      const sin = cr / (lu * lv || 1);
      const kap = (2 * Math.abs(sin)) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1);
      if (kap > 1 / 70) flag[i] = cr > 0 ? 1 : -1;
    }
    const runs = [];
    let i = 0;
    while (i < n) {
      if (!flag[i]) { i++; continue; }
      const sd = flag[i];
      let j = i;
      while (j + 1 < n && flag[j + 1] === sd) j++;
      if (j - i >= 6) runs.push({ i0: i, i1: j, side: sd });
      i = j + 1;
    }
    return runs;
  }

  return { HALF, Y, BAR, BR, N, LOOP, at, distTo, bridgeSamples, loopSamples, extrude, circles, kerbRuns, nearJ, yProf };
}

// ---------- GLB Loader Promise Helper ----------
export function loadGLB(url) {
  return new Promise((resolve, reject) => {
    new THREE.GLTFLoader().load(url, resolve, undefined, reject);
  });
}

let waterNorm = null;
let lavaA = null;
let lavaMat = null;
let lavaLight = null;
let skyDome = null;

export function applyQualitySettings() {
  if (!G.renderer || !G.sun) return;
  const q = SETTINGS.quality;
  const maxDpr = q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : q === 'medium' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
  G.renderer.setPixelRatio(maxDpr);
  const shadowOn = q !== 'low';
  G.renderer.shadowMap.enabled = shadowOn;
  G.sun.castShadow = shadowOn;
  if (shadowOn) {
    const res = q === 'high' ? 2048 : 1024;
    if (G.sun.shadow.mapSize.width !== res) {
      G.sun.shadow.mapSize.set(res, res);
      if (G.sun.shadow.map) {
        G.sun.shadow.map.dispose();
        G.sun.shadow.map = null;
      }
    }
  }
}

export function updateWorldEnvironment(dt, nowMs) {
  if (waterNorm) {
    waterNorm.offset.x += dt * 0.02;
    waterNorm.offset.y += dt * 0.008;
  }
  if (lavaA && lavaMat && lavaLight) {
    lavaA.offset.x += dt * 0.006;
    lavaA.offset.y += dt * 0.004;
    lavaMat.emissiveIntensity = 0.85 + Math.sin(nowMs * 0.0017) * 0.12;
    lavaLight.intensity = 1.6 + Math.sin(nowMs * 0.0031) * 0.35;
  }
  // Keep directional sun shadow frustum centered near player/camera
  if (G.sun && G.sun.castShadow) {
    const cx = Math.round(G.P.x / 4) * 4;
    const cz = Math.round(G.P.z / 4) * 4;
    G.sun.position.set(cx + 100, 180, cz + 70);
    G.sun.target.position.set(cx, 0, cz);
    G.sun.target.updateMatrixWorld();
  }
}

export async function initWorld(reportProgress, onToast) {
  // Load island paths
  const pathsRes = await fetch('/assets/data/island_paths.json');
  const paths = await pathsRes.json();
  ROAD = buildRoad(new Float32Array(paths.pts));
  DECK = buildDeck(new Float32Array(paths.loop));
  reportProgress(0.12, 'Generando relieve y biomas de la isla…');

  // Renderer & Scene
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = SETTINGS.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x88cbe8);
  scene.fog = new THREE.FogExp2(0x8fd0ee, 0.0028);

  const cam = new THREE.PerspectiveCamera(SETTINGS.fov || 70, window.innerWidth / window.innerHeight, 0.1, 750);
  cam.rotation.order = 'YXZ';

  // Sky gradient dome for richer Battle Royale atmosphere
  const skyGeo = new THREE.SphereGeometry(520, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1f6fc2) },
      midColor: { value: new THREE.Color(0x7cc7ee) },
      bottomColor: { value: new THREE.Color(0xd7effc) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        vec3 col = mix(bottomColor, midColor, smoothstep(-0.05, 0.18, h));
        col = mix(col, topColor, smoothstep(0.18, 0.72, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  skyDome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyDome);

  const hemi = new THREE.HemisphereLight(0xe5f6ff, 0x5c6b42, 0.92);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1d4, 1.05);
  sun.position.set(100, 180, 70);
  sun.castShadow = SETTINGS.quality !== 'low';
  sun.shadow.mapSize.set(SETTINGS.quality === 'high' ? 2048 : 1024, SETTINGS.quality === 'high' ? 2048 : 1024);
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 360;
  const d = 80;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(sun.target);

  G.renderer = renderer;
  G.scene = scene;
  G.cam = cam;
  G.sun = sun;
  G.hemi = hemi;
  applyQualitySettings();

  // Terrain Mesh
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const DESERT_TILE = 14, SNOW_TILE = 10, GRASS_TILE = 8, ROCK_TILE = 8;
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const C = new THREE.Color();
  const wts = new Float32Array(pos.count * 3);
  const wm = new Float32Array(pos.count);
  const uvA = geo.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = Hterr(x, z);
    pos.setY(i, h);
    const b = biome(x, z), j = (hash(x, z) - 0.5) * 0.07;
    wts[i * 3] = b === 'Desierto' ? 1 : 0;
    wts[i * 3 + 1] = b === 'Nieve' ? 1 : 0;
    wts[i * 3 + 2] = b === 'Bosque' ? 1 : 0;
    wm[i] = b === 'Montaña' ? 1 : 0;
    uvA.setXY(i, x / DESERT_TILE, z / DESERT_TILE);
    if (b === 'Mar') C.set(0xc9b27a);
    else if (b === 'Playa') C.set(0xe8d49a);
    else if (b === 'Desierto') C.set(0xd9a85a);
    else if (b === 'Nieve') C.set(0xf1f6fa);
    else if (b === 'Montaña') C.set(0x80807a);
    else C.set(0x5e9a46).lerp(new THREE.Color(0x3f7a38), sm(3, 14, h));
    C.offsetHSL(0, 0, j);
    col.set([C.r, C.g, C.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('wts', new THREE.BufferAttribute(wts, 3));
  geo.setAttribute('wm', new THREE.BufferAttribute(wm, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const uTex = { value: 0 };
  let texLoaded = 0;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function loadTex(url, cb) {
    const t = new THREE.TextureLoader().load(url, cb);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }
  const terrTex = url => loadTex(url, () => {
    if (++texLoaded === 8) uTex.value = 1;
  });

  const tSandA = terrTex('/assets/textures/terrain/sandA.jpg');
  const tSandN = terrTex('/assets/textures/terrain/sandN.jpg');
  const tSnowA = terrTex('/assets/textures/terrain/snowA.jpg');
  const tSnowN = terrTex('/assets/textures/terrain/snowN.jpg');
  const tGrassA = terrTex('/assets/textures/terrain/grassA.jpg');
  const tGrassN = terrTex('/assets/textures/terrain/grassN.jpg');
  const tRockA = terrTex('/assets/textures/volcano/rockA.jpg');
  const tRockN = terrTex('/assets/textures/volcano/rockN.jpg');

  const SAND_TINT = 'vec3(0.93,1.0,0.88)';
  const GRASS_TINT = 'vec3(0.9,1.0,1.5)';
  const SAND_NORMAL = 1.0;

  const terrainMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    specular: 0x000000,
    shininess: 1,
    map: tSandA,
    normalMap: tSandN,
    normalScale: new THREE.Vector2(SAND_NORMAL, SAND_NORMAL),
  });

  terrainMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, {
      uTex,
      tSnowA: { value: tSnowA }, tSnowN: { value: tSnowN },
      tGrassA: { value: tGrassA }, tGrassN: { value: tGrassN },
      tRockA: { value: tRockA }, tRockN: { value: tRockN },
    });
    const KR = (DESERT_TILE / ROCK_TILE).toFixed(4);
    const KS = (DESERT_TILE / SNOW_TILE).toFixed(4);
    const KG = (DESERT_TILE / GRASS_TILE).toFixed(4);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute vec3 wts;\nattribute float wm;\nvarying vec3 vWts;\nvarying float vWm;\n#include <common>')
      .replace('#include <begin_vertex>', 'vWts=wts;vWm=wm;\n#include <begin_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', 'varying vec3 vWts;\nvarying float vWm;\nuniform float uTex;\nuniform sampler2D tSnowA,tSnowN,tGrassA,tGrassN,tRockA,tRockN;\n#include <common>')
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>',
        '#include <color_fragment>\n' +
        'vec3 wT=vWts*uTex;\nfloat wR=vWm*uTex;\n' +
        'float lum=dot(vColor,vec3(.299,.587,.114));\n' +
        'vec3 sandC=texture2D(map,vUv).rgb*' + SAND_TINT + '*(lum/.6814);\n' +
        'vec3 snowC=vColor*texture2D(tSnowA,vUv*' + KS + ').rgb;\n' +
        'vec3 grassC=texture2D(tGrassA,vUv*' + KG + ').rgb*' + GRASS_TINT + '*(lum/.496);\n' +
        'diffuseColor.rgb=mix(diffuseColor.rgb,sandC,wT.x);\n' +
        'diffuseColor.rgb=mix(diffuseColor.rgb,snowC,wT.y);\n' +
        'vec3 rockC=texture2D(tRockA,vUv*' + KR + ').rgb*vec3(1.5,1.3,1.15)*(lum/.5);\n' +
        'diffuseColor.rgb=mix(diffuseColor.rgb,grassC,wT.z);\n' +
        'diffuseColor.rgb=mix(diffuseColor.rgb,rockC,wR);')
      .replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
        'float vd=length(vUv*' + DESERT_TILE.toFixed(1) + '-vec2(' + VOLC.x.toFixed(1) + ',' + VOLC.z.toFixed(1) + '));\n' +
        'totalEmissiveRadiance+=vec3(1.,.32,.05)*.55*wR*(1.-smoothstep(6.,16.,vd));')
      .replace('#include <normal_fragment_maps>',
        'vec3 mapN=vec3(0.,0.,1.)*(1.-wT.x-wT.y-wT.z-wR)\n' +
        '  +(texture2D(normalMap,vUv).xyz*2.-1.)*wT.x\n' +
        '  +(texture2D(tSnowN,vUv*' + KS + ').xyz*2.-1.)*wT.y\n' +
        '  +(texture2D(tGrassN,vUv*' + KG + ').xyz*2.-1.)*wT.z\n' +
        '  +(texture2D(tRockN,vUv*' + KR + ').xyz*2.-1.)*wR;\n' +
        'mapN.xy*=normalScale;\n' +
        'normal=perturbNormal2Arb(-vViewPosition,normal,mapN,faceDirection);');
  };

  const terrainMesh = new THREE.Mesh(geo, terrainMat);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  reportProgress(0.24, 'Construyendo carretera y circuito sobre el mar…');

  // Annular Road Mesh
  const mkGeo = d => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    g.setIndex(d.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };

  {
    const rb = ROAD.ribbon(0.08);
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 1024;
    const cx = cv.getContext('2d');
    const aTex = new THREE.CanvasTexture(cv);
    aTex.wrapT = THREE.RepeatWrapping;
    aTex.anisotropy = maxAniso;
    const paint = img => {
      cx.fillStyle = '#3b3d42';
      cx.fillRect(0, 0, 512, 1024);
      if (img) for (let y = 0; y < 1024; y += 256) for (let x = 0; x < 512; x += 256) cx.drawImage(img, x, y, 256, 256);
      cx.fillStyle = 'rgba(235,235,225,.92)';
      cx.fillRect(16, 0, 14, 1024);
      cx.fillRect(482, 0, 14, 1024);
      cx.fillStyle = 'rgba(245,215,80,.95)';
      for (let y = 0; y < 1024; y += 512) cx.fillRect(250, y, 12, 256);
      aTex.needsUpdate = true;
    };
    paint(null);
    const ia = new Image();
    ia.onload = () => paint(ia);
    ia.src = '/assets/textures/road/asphalt.jpg';

    const asp = new THREE.Mesh(mkGeo(rb.asp), new THREE.MeshLambertMaterial({ map: aTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const gTex = loadTex('/assets/textures/road/gravel.jpg');
    const shd = new THREE.Mesh(mkGeo(rb.sh), new THREE.MeshLambertMaterial({ map: gTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    asp.receiveShadow = true;
    shd.receiveShadow = true;
    scene.add(shd, asp);
  }

  // Lava & Water
  lavaA = loadTex('/assets/textures/volcano/lavaA.jpg');
  const lavaN = loadTex('/assets/textures/volcano/lavaN.jpg');
  lavaA.repeat.set(1.4, 1.4);
  lavaMat = new THREE.MeshPhongMaterial({
    color: 0x552a14, map: lavaA, emissive: 0xffffff, emissiveMap: lavaA,
    emissiveIntensity: 0.9, normalMap: lavaN, normalScale: new THREE.Vector2(0.8, 0.8),
    specular: 0x331100, shininess: 20,
  });
  const lavaGeo = new THREE.CircleGeometry(VOLC.lavaR, 48);
  lavaGeo.rotateX(-Math.PI / 2);
  const lavaMesh = new THREE.Mesh(lavaGeo, lavaMat);
  lavaMesh.position.set(VOLC.x, VOLC.lavaY, VOLC.z);
  scene.add(lavaMesh);

  lavaLight = new THREE.PointLight(0xff5a1a, 1.6, 55);
  lavaLight.position.set(VOLC.x, VOLC.lavaY + 4, VOLC.z);
  scene.add(lavaLight);

  const WATER_TILE = 16;
  const waterMat = new THREE.MeshPhongMaterial({
    color: 0x2284ba, transparent: true, opacity: 0.80,
    specular: 0xbbeeff, shininess: 95, normalScale: new THREE.Vector2(0.65, 0.65),
  });
  waterNorm = loadTex('/assets/textures/terrain/waterN.jpg', t => {
    t.repeat.set(1600 / WATER_TILE, 1600 / WATER_TILE);
    waterMat.normalMap = t;
    waterMat.needsUpdate = true;
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), waterMat);
  water.position.y = 0;
  water.receiveShadow = true;
  scene.add(water);

  // Bridge & Race Circuit
  {
    const HALF = DECK.HALF, LS = DECK.loopSamples(2), BS = DECK.bridgeSamples(1.25);
    const _rd = ROAD.distTo;
    ROAD.distTo = (x, z) => Math.min(_rd(x, z), DECK.distTo(x, z));
    DECK.circles().forEach(c => addObstacle({ x: c[0], z: c[1], r: 0.9 }));

    const MAT = (map, o) => new THREE.MeshLambertMaterial(Object.assign({ map, side: THREE.DoubleSide }, o || {}));
    const PO = f => ({ polygonOffset: true, polygonOffsetFactor: -f, polygonOffsetUnits: -f });
    const add = (g, mat, shadow = true) => {
      const m = new THREE.Mesh(mkGeo(g), mat);
      m.receiveShadow = shadow;
      scene.add(m);
      return m;
    };
    const canvasTex = (w, h, draw) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      draw(x);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
      return { c, x, t };
    };
    const imgInto = (ct, src, after) => {
      const im = new Image();
      im.onload = () => { after(ct.x, im); ct.t.needsUpdate = true; };
      im.src = src;
    };

    const asp = canvasTex(512, 1024, x => {
      x.fillStyle = '#34363b'; x.fillRect(0, 0, 512, 1024);
      x.fillStyle = 'rgba(240,240,232,.93)'; x.fillRect(14, 0, 9, 1024); x.fillRect(489, 0, 9, 1024);
    });
    imgInto(asp, '/assets/textures/road/asphalt.jpg', (x, im) => {
      for (let yy = 0; yy < 1024; yy += 192) for (let xx = 0; xx < 512; xx += 192) x.drawImage(im, xx, yy, 192, 192);
      x.fillStyle = 'rgba(240,240,232,.93)'; x.fillRect(14, 0, 9, 1024); x.fillRect(489, 0, 9, 1024);
    });

    const aspMat = MAT(asp.t, PO(2));
    const stoneT = loadTex('/assets/textures/road/stone.jpg');
    const concT = loadTex('/assets/textures/road/concrete.jpg');
    const top = [[-HALF, 0.08, 0], [HALF, 0.08, 1]];
    const body = [[-HALF, 0, 0], [-HALF, -1.5, 0.35], [HALF, -1.5, 0.65], [HALF, 0, 1]];
    const barR = [[HALF - 0.3, 0.08, 0], [HALF - 0.3, 0.95, 0.3], [HALF + 0.3, 0.95, 0.7], [HALF + 0.3, 0.08, 1]];
    const barL = [[-HALF + 0.3, 0.08, 0], [-HALF + 0.3, 0.95, 0.3], [-HALF - 0.3, 0.95, 0.7], [-HALF - 0.3, 0.08, 1]];
    const stoneM = MAT(stoneT), concM = MAT(concT);

    add(DECK.extrude(BS, false, top, 24), aspMat);
    add(DECK.extrude(LS, true, top, 24), aspMat);
    add(DECK.extrude(BS, false, body, 8), stoneM);
    add(DECK.extrude(LS, true, body, 8), stoneM);
    for (const pr of [barL, barR]) add(DECK.extrude(BS, false, pr, 4), concM);
    add(DECK.extrude(LS, true, barL, 4), concM);
    add(DECK.extrude(LS, true, barR, 4, p => DECK.nearJ(p)), concM);

    const kerb = canvasTex(64, 256, x => {
      x.fillStyle = '#d4141c'; x.fillRect(0, 0, 64, 128);
      x.fillStyle = '#f4f4f0'; x.fillRect(0, 128, 64, 128);
    });
    const kerbM = MAT(kerb.t, PO(3));
    DECK.kerbRuns(LS).forEach(r => {
      const sub = LS.slice(r.i0, r.i1 + 1);
      add(DECK.extrude(sub, false, [[r.side * (HALF - 1.4), 0.1, 0], [r.side * HALF, 0.1, 1]], 2.4), kerbM);
    });

    let mi = 0, md = 1e9;
    LS.forEach((p, i) => {
      const dd = Math.hypot(p[0] - DECK.BR.jx, p[1] - (DECK.BR.z0 + 40));
      if (dd < md) { md = dd; mi = i; }
    });
    const chk = canvasTex(480, 100, x => {
      for (let r = 0; r < 5; r++) for (let c = 0; c < 24; c++) {
        x.fillStyle = (r + c) % 2 ? '#111' : '#f2f2f2';
        x.fillRect(c * 20, r * 20, 20, 20);
      }
    });
    add(DECK.extrude([LS[mi], LS[mi + 1], LS[mi + 2]], false, [[-HALF, 0.1, 0], [HALF, 0.1, 1]], 2.5), MAT(chk.t, PO(4)));

    const a = LS[mi], b = LS[mi + 2], tl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / tl, tz = (b[1] - a[1]) / tl, nx = -tz, nz = tx, gy = DECK.Y;
    const ban = canvasTex(1024, 128, x => {
      x.fillStyle = '#c8102e'; x.fillRect(0, 0, 1024, 128);
      x.fillStyle = '#fff'; x.font = 'bold 76px Arial,sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('CIRCUITO ISLA BATTLE', 512, 66);
    });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2b2e35 });
    const red = new THREE.MeshLambertMaterial({ color: 0xc8102e });
    const bm = new THREE.MeshLambertMaterial({ map: ban.t });
    for (const sg of [-1, 1]) {
      const pst = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.8), dark);
      pst.position.set(a[0] + nx * sg * (HALF + 1.4), gy + 4, a[1] + nz * sg * (HALF + 1.4));
      pst.castShadow = true;
      scene.add(pst);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * (HALF + 1.4) + 0.8, 1.6, 0.9), [red, red, red, red, bm, bm]);
    beam.position.set(a[0], gy + 7.6, a[1]);
    beam.rotation.y = Math.atan2(-nz, nx);
    beam.castShadow = true;
    scene.add(beam);

    // Stone pillars
    const pil = [];
    const addP = (S, step) => {
      for (let i = 0; i < S.length; i += step) {
        const a0 = S[i], b0 = S[Math.min(S.length - 1, i + 1)], c0 = S[Math.max(0, i - 1)];
        let px = b0[0] - c0[0], pz = b0[1] - c0[1];
        const l = Math.hypot(px, pz) || 1;
        px /= l; pz /= l;
        for (const sg of [-1, 1]) {
          const x = a0[0] - pz * sg * 3.8, z = a0[1] + px * sg * 3.8, g = Hterr(x, z), ptop = a0[2] - 1.45;
          if (g > ptop - 1.2) continue;
          pil.push([x, z, Math.min(g - 1.5, -10), ptop]);
        }
      }
    };
    addP(BS, 10);
    addP(LS, 10);
    const pT = loadTex('/assets/textures/road/stone.jpg');
    pT.repeat.set(3, 1);
    const pilIm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.9, 1.05, 1, 10), new THREE.MeshLambertMaterial({ map: pT }), pil.length);
    const dm = new THREE.Object3D();
    pil.forEach((p, i) => {
      dm.position.set(p[0], (p[2] + p[3]) / 2, p[1]);
      dm.scale.set(1, p[3] - p[2], 1);
      dm.updateMatrix();
      pilIm.setMatrixAt(i, dm.matrix);
    });
    pilIm.boundingSphere = new THREE.Sphere(new THREE.Vector3(240, 0, 0), 420);
    scene.add(pilIm);

    // Build RACE lap timer
    RACE = (function () {
      const n = LS.length;
      const cp = LS[(mi + (n >> 1)) % n];
      const KEY = 'islaBattle.circuito.mejorVuelta';
      let best = null;
      try { const v = parseFloat(localStorage.getItem(KEY)); if (v > 0) best = v; } catch (_) {}
      let racing = false, t0 = 0, prevS = null, prevT = 0, cpOK = false, inZone = false, recT = 0;
      const fmt = ms => {
        if (ms === null) return '--:--.---';
        const m = Math.floor(ms / 60000), s = ms - m * 60000;
        return m + ':' + (s < 10000 ? '0' : '') + (s / 1000).toFixed(3);
      };
      const pan = document.getElementById('race');
      const cur = document.getElementById('raceCur');
      const lastEl = document.getElementById('raceLast');
      const bestEl = document.getElementById('raceBest');
      if (bestEl) bestEl.textContent = fmt(best);

      function onTrack(x, z, y) {
        if (y < DECK.Y - 1.5) return false;
        let m = 1e9;
        for (let i = 0; i < n; i++) {
          const dx = x - LS[i][0], dz = z - LS[i][1], dd = dx * dx + dz * dz;
          if (dd < m) m = dd;
        }
        return m < HALF * HALF;
      }

      function stop() {
        racing = false; cpOK = false; prevS = null; inZone = false;
        if (pan) { pan.style.display = 'none'; pan.classList.remove('rec'); }
      }

      function update(x, z, y, alive) {
        if (!pan) return;
        const now = performance.now();
        if (!alive || !onTrack(x, z, y)) {
          if (inZone || racing) stop();
          return;
        }
        if (!inZone) { inZone = true; pan.style.display = 'block'; prevS = null; }
        const dx = x - a[0], dz = z - a[1], s = dx * tx + dz * tz, lat = -dx * tz + dz * tx;
        if (prevS !== null && prevS < 0 && s >= 0 && s < 6 && Math.abs(lat) < HALF + 1) {
          const tc = prevT + (now - prevT) * (-prevS / (s - prevS));
          if (racing && cpOK) {
            const lap = tc - t0;
            if (lastEl) lastEl.textContent = fmt(lap);
            if (best === null || lap < best) {
              const first = best === null;
              best = lap;
              if (bestEl) bestEl.textContent = fmt(best);
              pan.classList.add('rec');
              recT = 4;
              try { localStorage.setItem(KEY, String(best)); } catch (_) {}
              if (onToast) onToast(first ? 'Primera vuelta: ' + fmt(lap) : '¡Nuevo récord! ' + fmt(lap));
            } else if (onToast) onToast('Vuelta: ' + fmt(lap));
          } else if (!racing && onToast) onToast('¡Cronómetro en marcha!');
          racing = true; t0 = tc; cpOK = false;
          if (cur) cur.classList.remove('idle');
        }
        if (racing && !cpOK && Math.hypot(x - cp[0], z - cp[1]) < 10) cpOK = true;
        prevS = s; prevT = now;
        if (recT > 0) {
          recT -= (now - (update.t || now)) / 1000;
          if (recT <= 0) pan.classList.remove('rec');
        }
        update.t = now;
        if (cur) {
          if (racing) cur.textContent = fmt(now - t0);
          else { cur.textContent = 'Cruza la meta para empezar'; cur.classList.add('idle'); }
        }
      }
      return { update, stop };
    })();
  }

  reportProgress(0.35, 'Cargando árboles, cactus y rocas de la isla…');

  // Scatter Flora & Rocks
  function scatterPts(n, test) {
    const pts = [];
    let tries = 0;
    while (pts.length < n && tries < n * 30) {
      tries++;
      const x = (Math.random() - 0.5) * SIZE, z = (Math.random() - 0.5) * SIZE, h = H(x, z);
      if (ROAD.distTo(x, z) > 9 && test(x, z, h)) pts.push([x, h, z]);
    }
    return pts;
  }

  function scatterSpaced(n, test, minD) {
    const pts = [], m2 = minD * minD;
    let tries = 0;
    while (pts.length < n && tries < n * 60) {
      tries++;
      const x = (Math.random() - 0.5) * SIZE, z = (Math.random() - 0.5) * SIZE, h = H(x, z);
      if (ROAD.distTo(x, z) < 9 || !test(x, z, h)) continue;
      let ok = true;
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i][0] - x, dz = pts[i][2] - z;
        if (dx * dx + dz * dz < m2) { ok = false; break; }
      }
      if (ok) pts.push([x, h, z]);
    }
    return pts;
  }

  const forestPts = scatterSpaced(280, (x, z) => biome(x, z) === 'Bosque' && fbm(x * 0.05, z * 0.05) > 0.32, 6);
  const snowPts = scatterPts(170, (x, z, h) => biome(x, z) === 'Nieve' && h > 3);
  const cactusPts = scatterPts(90, (x, z) => biome(x, z) === 'Desierto');
  const rockPts = scatterPts(140, (x, z, h) => h > 1 && Math.random() < 0.6);

  function glbMeshes(gltf, keepOrigin) {
    gltf.scene.updateMatrixWorld(true);
    const out = [];
    gltf.scene.traverse(m => {
      if (!m.isMesh) return;
      const mw = m.matrixWorld.clone();
      if (keepOrigin === false) mw.setPosition(0, 0, 0);
      const g = m.geometry.clone().applyMatrix4(mw);
      const o = m.material;
      const fix = t => {
        if (t) { t.encoding = THREE.LinearEncoding; t.anisotropy = 4; t.needsUpdate = true; }
        return t;
      };
      const mat = new THREE.MeshLambertMaterial({ map: fix(o.map), color: o.map ? 0xffffff : o.color, side: THREE.DoubleSide });
      out.push({ g, mat });
    });
    return out;
  }

  const [treeGltf, cactusGltf, rockGltf] = await Promise.all([
    loadGLB('/assets/models/tree.glb'),
    loadGLB('/assets/models/cactus.glb'),
    loadGLB('/assets/models/rock.glb'),
  ]);

  // Trees
  {
    treeGltf.scene.updateMatrixWorld(true);
    let src = null;
    treeGltf.scene.traverse(m => { if (m.isMesh && !src) src = m; });
    if (src) {
      const g = src.geometry.clone().applyMatrix4(src.matrixWorld);
      const o = src.material;
      if (o.map) { o.map.encoding = THREE.LinearEncoding; o.map.anisotropy = 4; o.map.needsUpdate = true; }
      const m = new THREE.MeshLambertMaterial({ map: o.map, side: THREE.DoubleSide, alphaTest: 0.4 });
      const put = (pts, tint) => {
        const im = new THREE.InstancedMesh(g, m, pts.length);
        const d = new THREE.Object3D(), c = new THREE.Color();
        pts.forEach((p, i) => {
          d.position.set(p[0], p[1] - 0.15, p[2]);
          d.rotation.set(0, Math.random() * 6.28, 0);
          const sc = 0.62 * rnd(0.8, 1.4);
          d.scale.setScalar(sc);
          addObstacle({ x: p[0], z: p[2], r: 0.7 * sc });
          d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
          if (tint) { c.set(tint).offsetHSL(0, 0, rnd(-0.04, 0.04)); im.setColorAt(i, c); }
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, 0), 260);
        scene.add(im);
      };
      put(forestPts);
      put(snowPts, 0xd6ece8);
    }
  }

  // Cactus
  {
    const types = glbMeshes(cactusGltf, false);
    if (types.length) {
      const groups = types.map(() => []);
      cactusPts.forEach(p => groups[Math.floor(Math.random() * types.length)].push(p));
      types.forEach((t, k) => {
        const pts = groups[k];
        if (!pts.length) return;
        const im = new THREE.InstancedMesh(t.g, t.mat, pts.length);
        const d = new THREE.Object3D();
        pts.forEach((p, i) => {
          d.position.set(p[0], p[1] - 0.05, p[2]);
          d.rotation.set(0, Math.random() * 6.28, 0);
          const sc = rnd(0.75, 1.2);
          d.scale.setScalar(sc);
          addObstacle({ x: p[0], z: p[2], r: 0.55 * sc });
          d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), 260);
        scene.add(im);
      });
    }
  }

  // Rocks
  {
    const r = glbMeshes(rockGltf)[0];
    if (r) {
      r.g.computeBoundingBox();
      const bb = r.g.boundingBox, c = bb.getCenter(new THREE.Vector3());
      r.g.translate(-c.x, -bb.min.y, -c.z);
      const im = new THREE.InstancedMesh(r.g, r.mat, rockPts.length);
      const d = new THREE.Object3D();
      rockPts.forEach((p, i) => {
        const s = rnd(0.9, 2.1);
        addObstacle({ x: p[0], z: p[2], r: 0.8 * s });
        d.position.set(p[0], p[1] - 0.12 * s, p[2]);
        d.rotation.set(0, Math.random() * 6.28, 0);
        d.scale.set(s * rnd(0.85, 1.2), s * rnd(0.7, 1.15), s * rnd(0.85, 1.2));
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, 0), 260);
      scene.add(im);
    }
  }

  // Compute Spawn points around island shore
  const P = G.P;
  for (let a = 0; a < 6.28; a += 0.1) {
    let r = R * 0.9;
    while (Hterr(Math.cos(a) * r, Math.sin(a) * r) < 1.5 && r > 20) r -= 2;
    if (r < R * 0.8 && biome(Math.cos(a) * r, Math.sin(a) * r) === 'Playa') {
      P.x = Math.cos(a) * r;
      P.z = Math.sin(a) * r;
      break;
    }
  }
  P.y = H(P.x, P.z);
  P.yaw = Math.atan2(P.x, P.z);
  G.SPAWN = [P.x, P.z, P.yaw];

  const spawns = [G.SPAWN];
  for (let a = 0.2; a < 6.28; a += 0.5) {
    let r = R * 0.95;
    while (Hterr(Math.cos(a) * r, Math.sin(a) * r) < 1.5 && r > 20) r -= 1;
    r -= 5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (r > 60 && x < 95 && Hterr(x, z) > 1.5) spawns.push([x, z, Math.atan2(x, z)]);
  }
  G.SPAWNS = spawns;

  reportProgress(0.48, 'Isla lista. Cargando atleta y armas…');
}
