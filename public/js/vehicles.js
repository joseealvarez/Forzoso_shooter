// Vehicles module: Citroën C3, Peugeot 206, Canyon Aeroad bike (with crank splitting & IK rider),
// Honda Africa Twin motorbike, surface grip, ramming physics, damage/smoke, and deterministic placement.

import { G, b64f, mulberry } from './state.js';
import { H, biome, pushOut, addObstacle, removeObstacle, updateDynamicObstacle, hasNearbyObstacle, loadGLB } from './world.js';
import { AP, K } from './player.js';
import { boomFx } from './weapons.js';
import { updateEngineSound, playHitmarker } from './audio.js';

export const CAR_SPEC = { hp: 300, vmax: 23, vsh: 30, acc: 13, brk: 15, rev: -8, steer: 1.35, col: 1.55, obsR: 2.05, exit: 2.9, cam: [8, 4.6, 2.5, 1.0] };
export const CAR_SLOTS = [
  { name: 'Citroën C3', to: 'al Citroën C3', from: 'del Citroën C3', opts: [[4.5, 2.5], [5, -2.5], [6, 0], [7, 3], [7, -3], [9, 0], [10, 4], [11, -4], [13, 0]], fb: [8, 0] },
  { name: 'Citroën C3', to: 'al Citroën C3', from: 'del Citroën C3', opts: [[5, 9], [7, 11], [9, 9], [11, 11], [6, 13], [10, 13]], fb: [8, 10] },
  { name: 'Peugeot 206', to: 'al Peugeot 206', from: 'del Peugeot 206', opts: [[5, -9], [7, -11], [9, -9], [11, -11], [6, -13], [10, -13]], fb: [8, -10] },
  { name: 'Peugeot 206', to: 'al Peugeot 206', from: 'del Peugeot 206', opts: [[19, 0], [22, 3], [22, -3], [25, 0], [19, 5], [19, -5], [25, 5], [25, -5]], fb: [20, 0] },
  {
    name: 'Canyon Aeroad', to: 'a la bici Canyon Aeroad', from: 'de la bici Canyon Aeroad',
    opts: [[2, 6.5], [3, 6.5], [1.5, 7], [4, 6.5]], fb: [3, 6.5],
    spec: { hp: 150, vmax: 11, vsh: 15, acc: 7, brk: 12, rev: -3, steer: 2.1, col: 0.75, obsR: 0.85, exit: 1.5, cam: [5, 3.1, 1.6, 0.8] },
  },
  {
    name: 'Honda Africa Twin', to: 'a la moto Honda Africa Twin', from: 'de la moto Honda Africa Twin',
    opts: [[2, -6.5], [3, -6.5], [1.5, -7], [4, -6.5]], fb: [3, -6.5],
    spec: { hp: 220, vmax: 30, vsh: 38, acc: 17, brk: 18, rev: -4, steer: 1.7, col: 0.85, obsR: 1.0, exit: 1.7, cam: [5.6, 3.3, 1.8, 0.9] },
  },
];
CAR_SLOTS.forEach(S => { S.spec = Object.assign({}, CAR_SPEC, S.spec || {}); });

export const VEH = { seed: null };
export const VEH_ICON = ['🚗', '🚗', '🚗', '🚗', '🚲', '🏍️'];

const BIKE_RUNS = [
  [[0, 17343], [3, 46], [0, 16], [3, 46], [0, 630], [4, 1726], [0, 10169], [2, 1104], [1, 1104], [0, 26987], [4, 26], [0, 9812]],
  [[0, 2569], [4, 6], [0, 96], [4, 223], [0, 934], [4, 2617], [0, 192], [3, 72], [0, 19440]],
];

const RIDE_SPEC = {
  4: {
    s: 0.9, xc: 0, seat: [0, 1.21, -0.30], spine: 0.3, pitchMin: 0.3, pitchMax: 1.25,
    gripN: [-0.19, 0.97, 0.40], gripP: [0.19, 0.97, 0.40],
    ankle: [0, 0.158 * 0.9 + 0.015, -0.187 * 0.9],
    pedals: { bb: [-0.0855, 0.2857], x: { N: -0.099, P: 0.099 }, rel: { N: [0.1828, -0.0314], P: [-0.1827, 0.0313] } },
  },
  5: {
    s: 0.9, xc: 0.0708, seat: [0, 0.96, -0.38], spine: 0.25, pitchMin: 0.2, pitchMax: 1.0,
    gripN: [-0.34, 1.17, 0.22], gripP: [0.34, 1.17, 0.22],
    footP: [0.30, 0.36 + 0.158 * 0.9 + 0.02, -0.15 - 0.187 * 0.9],
    footN: [-0.30, 0.36 + 0.158 * 0.9 + 0.02, -0.15 - 0.187 * 0.9],
  },
};

// ---------- Rider IK Solver ----------
const RIDER = (function () {
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const qm = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const qi = q => [-q[0], -q[1], -q[2], q[3]];
  const qr = (q, v) => {
    const u = [q[0], q[1], q[2]], t = mul(cross(u, v), 2);
    return add(add(v, mul(t, q[3])), cross(u, t));
  };
  const qax = (ax, a) => { const s = Math.sin(a / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)]; };
  const qnorm = q => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
  const qft = (f, t) => {
    f = nrm(f); t = nrm(t);
    const d = dot(f, t);
    if (d > 0.999999) return [0, 0, 0, 1];
    if (d < -0.999999) {
      let a = cross(f, [1, 0, 0]);
      if (len(a) < 0.1) a = cross(f, [0, 1, 0]);
      return qax(nrm(a), Math.PI);
    }
    const a = cross(f, t);
    return qnorm([a[0], a[1], a[2], 1 + d]);
  };
  const X = [1, 0, 0], Y = [0, 1, 0], ROOT = qax(Y, Math.PI - 0.48);
  let NB, names, par, ix, Tr, Qr, K, rest, ready = false;

  function fk(lq, hp, wq, wp) {
    for (let k = 0; k < NB; k++) {
      const p = par[k];
      if (p < 0) { wq[k] = qnorm(qm(ROOT, lq[k])); wp[k] = qr(ROOT, hp); }
      else { wq[k] = qnorm(qm(wq[p], lq[k])); wp[k] = add(wp[p], qr(wq[p], Tr[k])); }
    }
  }

  function init(AP_, Tr_, Qr_, K_) {
    names = AP_.names; par = AP_.par; NB = names.length; K = K_; ix = {};
    names.forEach((n, i) => (ix[n] = i));
    Tr = []; Qr = [];
    for (let k = 0; k < NB; k++) {
      Tr.push([Tr_[k * 3] * K, Tr_[k * 3 + 1] * K, Tr_[k * 3 + 2] * K]);
      Qr.push([Qr_[k * 4], Qr_[k * 4 + 1], Qr_[k * 4 + 2], Qr_[k * 4 + 3]]);
    }
    const wq = [], wp = [];
    fk(Qr, Tr[0], wq, wp);
    const palm = {};
    for (const s of ['Left', 'Right']) {
      const h = ix[s + 'Hand'];
      const fd = nrm(sub(wp[ix[s + 'HandMiddle1']], wp[h]));
      const sd = nrm(sub(wp[ix[s + 'HandIndex1']], wp[ix[s + 'HandMiddle1']]));
      let n = nrm(cross(fd, sd));
      const toBody = sub(wp[ix.Hips], wp[h]);
      if (dot(n, toBody) < 0) n = mul(n, -1);
      palm[s] = qr(qi(wq[h]), n);
    }
    rest = { wq, wp, palm };
    ready = true;
  }

  function solve(P) {
    const lq = Qr.map(q => q.slice()), wq = [], wp = [], hp0 = qr(qi(ROOT), P.hips);
    const hipQ = qm(qax(Y, 0.48), qax(X, P.pitch));
    lq[0] = qnorm(qm(hipQ, Qr[0]));
    const sp = P.spine / 3;
    for (const n of ['Spine', 'Spine1', 'Spine2']) lq[ix[n]] = qnorm(qm(Qr[ix[n]], qax(X, sp)));
    const hd = -(P.pitch + P.spine) * (P.headUp === undefined ? 0.85 : P.headUp);
    lq[ix.Neck] = qnorm(qm(Qr[ix.Neck], qax(X, hd * 0.5)));
    lq[ix.Head] = qnorm(qm(Qr[ix.Head], qax(X, hd * 0.5)));
    fk(lq, hp0, wq, wp);

    const setW = (b, w) => { wq[b] = qnorm(w); lq[b] = qnorm(qm(qi(wq[par[b]]), wq[b])); };
    const swing = (b, f, t) => { setW(b, qm(qft(f, t), wq[b])); fk(lq, hp0, wq, wp); };
    function limb(a, b, c, T, pole) {
      const A = wp[a], B = wp[b], C = wp[c], l1 = len(sub(B, A)), l2 = len(sub(C, B)), d = sub(T, A);
      const dist = len(d);
      const dist2 = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
      const dir = nrm(d);
      const along = (l1 * l1 - l2 * l2 + dist2 * dist2) / (2 * dist2);
      const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
      let pp = sub(pole, mul(dir, dot(pole, dir)));
      pp = len(pp) < 1e-4 ? [0, 0, -1] : nrm(pp);
      const Bn = add(add(A, mul(dir, along)), mul(pp, h));
      swing(a, sub(B, A), sub(Bn, A));
      swing(b, sub(wp[c], wp[b]), sub(add(A, mul(dir, dist2)), wp[b]));
      return dist - (l1 + l2);
    }

    const out = { reach: {} };
    for (const s of ['Left', 'Right']) {
      const sd = s === 'Left' ? 'L' : 'R', o = s === 'Left' ? -1 : 1;
      if (P.grips) {
        out.reach[s + 'Arm'] = limb(ix[s + 'Arm'], ix[s + 'ForeArm'], ix[s + 'Hand'], P.grips[sd], [o * 0.75, -0.55, 0.35]);
        const h = ix[s + 'Hand'];
        const ax = nrm(sub(wp[h], wp[ix[s + 'ForeArm']]));
        const n = qr(wq[h], rest.palm[s]), want = nrm([-o * 0.35, -1, 0]);
        const pj = v => nrm(sub(v, mul(ax, dot(v, ax))));
        const n1 = pj(n), w1 = pj(want);
        const ang = Math.atan2(dot(ax, cross(n1, w1)), dot(n1, w1));
        setW(h, qm(qax(ax, ang), wq[h]));
        fk(lq, hp0, wq, wp);
      }
      if (P.feet) {
        out.reach[s + 'Leg'] = limb(ix[s + 'UpLeg'], ix[s + 'Leg'], ix[s + 'Foot'], P.feet[sd], [o * 0.25, 0.15, -1]);
        const f = ix[s + 'Foot'];
        setW(f, qm(qm(qax(Y, Math.PI), qax(X, P.footPitch || 0)), qm(qi(ROOT), rest.wq[f])));
        fk(lq, hp0, wq, wp);
      }
    }
    out.q = lq; out.hips = hp0; out.wp = wp; out.wq = wq;
    return out;
  }

  function ride(spec, ph) {
    const s = spec.s, M = p => [-p[0] / s, p[1] / s, -p[2] / s];
    const hips = M(spec.seat), gr = { L: M(spec.gripP), R: M(spec.gripN) };
    let fP, fN;
    if (spec.pedals) {
      const pd = spec.pedals, c = Math.cos(ph || 0), sn = Math.sin(ph || 0);
      const pos = k => {
        const r = pd.rel[k];
        return [pd.x[k], pd.bb[1] + r[1] * c - r[0] * sn + spec.ankle[1], pd.bb[0] + r[1] * sn + r[0] * c + spec.ankle[2]];
      };
      fP = pos('P');
      fN = pos('N');
    } else {
      fP = spec.footP;
      fN = spec.footN;
    }
    const ft = { L: M(fP), R: M(fN) };
    if (spec._pt === undefined) {
      let pt = spec.pitchMax;
      for (let q = spec.pitchMin; q <= spec.pitchMax; q += 0.03) {
        const o = solve({ hips, pitch: q, spine: spec.spine, grips: gr, feet: null });
        if (o.reach.LeftArm < -0.04 && o.reach.RightArm < -0.04) { pt = q; break; }
      }
      spec._pt = pt;
    }
    return solve({ hips, pitch: spec._pt, spine: spec.spine, grips: gr, feet: ft, footPitch: spec.footPitch || 0 });
  }

  return { init, solve, ride, get ready() { return ready; } };
})();

export function ridePose(root, c) {
  if (!RIDER.ready) RIDER.init(AP, b64f(AP.T), b64f(AP.Q), K);
  const o = RIDER.ride(RIDE_SPEC[c.idx], c.ph || 0), B = root.userData.bn;
  for (let k = 0; k < AP.names.length; k++) {
    const q = o.q[k];
    B[AP.names[k]].quaternion.set(q[0], q[1], q[2], q[3]);
  }
  B.Hips.position.set(o.hips[0], o.hips[1], o.hips[2]);
}

export function mountRider(root, c) {
  const sp = RIDE_SPEC[c.idx];
  c.root.add(root);
  root.position.set(sp.xc, 0, 0);
  root.rotation.set(0, Math.PI, 0);
  root.scale.setScalar(sp.s);
  root.userData.mounted = c;
}

export function dismountRider(root) {
  if (!root || !root.userData.mounted) return;
  G.scene.add(root);
  root.scale.setScalar(1);
  root.rotation.set(0, 0, 0);
  root.userData.mounted = null;
  const rf = root === G.player ? G.rifle : root.userData.rifle;
  if (rf) rf.visible = true;
}

function splitCranks(model) {
  const meshes = [];
  model.traverse(m => { if (m.isMesh) meshes.push(m); });
  if (meshes.length < 2) return;
  const BB = new THREE.Vector3(0, 0.2837, -0.0865);
  const PN = new THREE.Vector3(-0.099, 0.2523, 0.0963);
  const PP = new THREE.Vector3(0.099, 0.315, -0.2692);
  const crank = new THREE.Group();
  crank.position.copy(BB);
  const pg = { N: new THREE.Group(), P: new THREE.Group() };
  pg.N.position.copy(PN).sub(BB);
  pg.P.position.copy(PP).sub(BB);
  crank.add(pg.N, pg.P);
  let parent = null;

  meshes.slice(0, 2).forEach((m, mi) => {
    const g = m.geometry, idx = g.index.array, parts = { 1: [], 2: [], 3: [], 4: [], 0: [] };
    let t = 0;
    for (const [id, n] of BIKE_RUNS[mi]) {
      parts[id].push(idx.subarray(t * 3, (t + n) * 3));
      t += n;
    }
    const join = a => {
      let L = 0;
      for (const x of a) L += x.length;
      const o = new idx.constructor(L);
      let q = 0;
      for (const x of a) { o.set(x, q); q += x.length; }
      return o;
    };
    const sub = (id, par, pivot) => {
      if (!parts[id].length) return;
      const geo = new THREE.BufferGeometry();
      for (const k in g.attributes) geo.setAttribute(k, g.attributes[k]);
      geo.setIndex(new THREE.BufferAttribute(join(parts[id]), 1));
      const mm = new THREE.Mesh(geo, m.material);
      mm.frustumCulled = false;
      mm.position.copy(pivot).negate();
      par.add(mm);
    };
    sub(1, pg.N, PN);
    sub(2, pg.P, PP);
    sub(3, crank, BB);
    sub(4, crank, BB);
    g.setIndex(new THREE.BufferAttribute(join(parts[0]), 1));
    parent = m.parent;
  });
  (parent || model).add(crank);
  model.userData.crank = { g: crank, pg };
}

export function crankUpdate(c, speed, dt, pedaling) {
  const k = c.crank;
  if (!k) return;
  if (pedaling) c.ph += speed * 0.8 * dt;
  k.g.rotation.x = c.ph;
  k.pg.N.rotation.x = -c.ph;
  k.pg.P.rotation.x = -c.ph;
}

export function useCar(c) {
  G.curCar = c;
  G.V = c.st;
  G.carRoot = c.root;
  G.carObs = c.obs;
}

export function setCarObstacle(enabled, c) {
  c = c || G.curCar;
  const o = c && c.obs;
  if (!o) return;
  if (enabled) addObstacle(o);
  else removeObstacle(o);
}

function findCarSpot(slot) {
  const S = CAR_SLOTS[slot];
  const fx = -Math.sin(G.SPAWN[2]), fz = -Math.cos(G.SPAWN[2]);
  const rx = Math.cos(G.SPAWN[2]), rz = -Math.sin(G.SPAWN[2]);
  const isCarObs = o => G.CARS.some(c => c && c.obs === o);
  for (const [f, sd] of S.opts) {
    const x = G.SPAWN[0] + fx * f + rx * sd, z = G.SPAWN[1] + fz * f + rz * sd, h = H(x, z);
    const gx = (H(x + 1, z) - H(x - 1, z)) * 0.5, gz = (H(x, z + 1) - H(x, z - 1)) * 0.5;
    if (h > 1 && h < 22 && Math.hypot(x, z) < 170 * 0.98 && Math.hypot(gx, gz) < 0.5 && !hasNearbyObstacle(x, z, 2.4, isCarObs)) {
      return { x, z };
    }
  }
  return { x: G.SPAWN[0] + fx * S.fb[0] + rx * S.fb[1], z: G.SPAWN[1] + fz * S.fb[0] + rz * S.fb[1] };
}

function vehSpot(slot, seed) {
  const R = 170;
  const sh = mulberry((seed ^ 0x7E41) | 0), perm = [0, 1, 2, 3, 4, 5];
  for (let i = 5; i > 0; i--) {
    const j = Math.floor(sh() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const sec = perm[slot], rnd = mulberry((seed * 31 + slot * 7919 + 13) | 0);
  const isCarObs = o => G.CARS.some(c => c && c.obs === o);
  for (let n = 0; n < 400; n++) {
    const a = ((n < 250 ? sec + rnd() : rnd() * 6) / 6) * 2 * Math.PI;
    const r = 25 + Math.sqrt(rnd()) * (R * 0.86 - 25);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = H(x, z);
    if (x > 95 || h <= 1 || h >= 22) continue;
    const gx = (H(x + 1, z) - H(x - 1, z)) * 0.5, gz = (H(x, z + 1) - H(x, z - 1)) * 0.5;
    if (Math.hypot(gx, gz) >= 0.5) continue;
    if (hasNearbyObstacle(x, z, 2.4, isCarObs)) continue;
    if (G.SPAWNS.some(p => Math.hypot(x - p[0], z - p[1]) < 8)) continue;
    return { x, z, yaw: rnd() * 2 * Math.PI };
  }
  const f = findCarSpot(slot);
  return { x: f.x, z: f.z, yaw: G.SPAWN[2] };
}

export function updateCarTransform(c) {
  c = c || G.curCar;
  if (!c || !c.root) return;
  const v = c.st;
  const gx = (H(v.x + 1, v.z) - H(v.x - 1, v.z)) * 0.5;
  const gz = (H(v.x, v.z + 1) - H(v.x, v.z - 1)) * 0.5;
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
  const slopeForward = gx * fx + gz * fz, slopeRight = gx * rx + gz * rz;
  c.root.position.set(v.x, H(v.x, v.z), v.z);
  c.root.rotation.set(-Math.atan(slopeForward), v.yaw + Math.PI, -Math.atan(slopeRight));
  if (c.obs) updateDynamicObstacle(c.obs, v.x, v.z);
}

function vehWreckLook(c, on) {
  c.model.traverse(m => {
    if (!m.isMesh) return;
    if (on) {
      if (m.userData.om) return;
      m.userData.om = m.material;
      const f = x => {
        const y = x.clone();
        if (y.color) y.color.multiplyScalar(0.16);
        if (y.emissive) y.emissive.set(0x000000);
        return y;
      };
      m.material = Array.isArray(m.material) ? m.material.map(f) : f(m.material);
    } else if (m.userData.om) {
      m.material = m.userData.om;
      m.userData.om = null;
    }
  });
}

export function vehRepair(c) {
  if (!c || c.max === undefined) return;
  c.hp = c.max;
  c.ph = 0;
  if (c.dead) { c.dead = false; vehWreckLook(c, false); }
}

export function vehWreck(c, hooks = {}) {
  if (c.dead) return;
  c.dead = true;
  c.hp = 0;
  c.st.speed = 0;
  const mine = G.inCar && G.curCar === c;
  if (mine) toggleCar(true, hooks);
  vehWreckLook(c, true);
  const p = new THREE.Vector3(c.root.position.x, c.root.position.y + 1.2, c.root.position.z);
  boomFx(p, Math.hypot(G.P.x - p.x, G.P.y - p.y, G.P.z - p.z));
  if (mine && hooks.onToast) hooks.onToast('¡' + c.name + ' ha quedado destruido!');
}

export function vehDamage(c, d, hooks = {}) {
  if (!c || c.dead) return;
  c.hp = Math.max(0, c.hp - d);
  if (G.ONLINE && G.NET.host && hooks.onNetVehHp) hooks.onNetVehHp(c.idx, Math.round(c.hp));
  if (c.hp <= 0) vehWreck(c, hooks);
}

export function vehHit(c, d, hooks = {}) {
  if (!c || c.dead || !(d > 0)) return;
  if (G.ONLINE && !G.NET.host && hooks.onNetVehHit) hooks.onNetVehHit(c.idx, Math.round(d));
  else vehDamage(c, d, hooks);
}

export function applyVehHp(a) {
  if (Array.isArray(a)) {
    a.forEach((hp, i) => {
      const c = G.CARS[i];
      if (c && hp >= 0 && hp < c.hp) {
        c.hp = hp;
        if (hp <= 0) vehWreck(c);
      }
    });
  }
}

export function vehPlace(c) {
  vehRepair(c);
  const sp = vehSpot(c.idx, VEH.seed);
  c.st.x = sp.x;
  c.st.z = sp.z;
  c.st.yaw = sp.yaw;
  c.st.speed = 0;
  updateCarTransform(c);
}

export function placeVehicles(seed) {
  VEH.seed = seed | 0;
  for (const c of G.CARS) if (c) vehPlace(c);
}

// Smoke & fire pool for damaged/wrecked vehicles
const SMK = [];
const smkG = new THREE.SphereGeometry(1, 8, 6);
function smokePuff(x, y, z, dark, fire) {
  let p = SMK.find(q => !q.on);
  if (!p) {
    if (SMK.length >= 70) return;
    const m = new THREE.Mesh(smkG, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
    G.scene.add(m);
    p = { m, on: false, v: new THREE.Vector3(), t: 0, life: 1, fire: false };
    SMK.push(p);
  }
  p.on = true;
  p.t = 0;
  p.fire = fire;
  p.life = fire ? 0.5 + Math.random() * 0.3 : 1.6 + Math.random();
  p.m.material.color.setHex(fire ? 0xff8a2a : dark ? 0x222222 : 0x808080);
  p.m.visible = true;
  p.m.position.set(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8);
  p.v.set((Math.random() - 0.5) * 0.8, 2 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8);
}

export function vehFx(dt) {
  for (const c of G.CARS) {
    if (!c || !c.root || c.max === undefined) continue;
    const f = c.hp / c.max;
    if (f > 0.35) continue;
    if (Math.hypot(c.root.position.x - G.P.x, c.root.position.z - G.P.z) > 130) continue;
    c.sm = (c.sm || 0) - dt;
    if (c.sm > 0) continue;
    c.sm = c.dead ? 0.07 : f < 0.15 ? 0.12 : 0.25;
    smokePuff(c.root.position.x, c.root.position.y + c.size.y * 0.8, c.root.position.z, c.dead, c.dead && Math.random() < 0.3);
  }
  for (const p of SMK) {
    if (!p.on) continue;
    p.t += dt;
    const k = p.t / p.life;
    if (k >= 1) { p.on = false; p.m.visible = false; continue; }
    p.m.position.addScaledVector(p.v, dt);
    p.m.scale.setScalar(p.fire ? 0.7 * (1 - k) + 0.15 : 0.5 + k * 1.8);
    p.m.material.opacity = (p.fire ? 0.85 : 0.55) * (1 - k);
  }
}

export function nearestCar() {
  let best = null, bd = 5.8;
  for (const c of G.CARS) {
    if (!c || c.dead) continue;
    const d = Math.hypot(G.P.x - c.st.x, G.P.z - c.st.z);
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}

export function forceDismount() {
  if (!G.inCar) return;
  G.inCar = false;
  dismountRider(G.player);
  G.V.speed = 0;
  setCarObstacle(true);
  if (G.player) G.player.visible = true;
  if (G.rifle) G.rifle.visible = true;
  updateEngineSound(false, 0);
}

export function toggleCar(force = false, hooks = {}) {
  const P = G.P;
  if (!G.carReady || (!force && (P.dead || G.MENU_OPEN))) return;
  if (!G.inCar) {
    let c = null, bd = 5.8;
    for (const k of G.CARS) {
      if (!k || k.dead || (G.ONLINE && hooks.carDrivenRemote && hooks.carDrivenRemote(k.idx))) continue;
      const d = Math.hypot(P.x - k.st.x, P.z - k.st.z);
      if (d <= bd) { bd = d; c = k; }
    }
    if (!c) {
      if (G.ONLINE && nearestCar() && hooks.onToast) hooks.onToast('Otro jugador está conduciendo ese coche');
      return;
    }
    useCar(c);
    G.inCar = true;
    G.V.speed = 0;
    setCarObstacle(false);
    P.x = G.V.x; P.z = G.V.z; P.y = H(G.V.x, G.V.z); P.yaw = G.V.yaw; P.vy = 0; P.ground = true;
    if (G.rifle) G.rifle.visible = false;
    if (c.idx >= 4) { mountRider(G.player, c); G.player.visible = true; }
    else G.player.visible = false;
    G.mouse = false;
    G.rmb = false;
    if (hooks.onToast) hooks.onToast('Has subido ' + c.to);
  } else {
    G.V.speed = 0;
    updateEngineSound(false, 0);
    const rx = Math.cos(G.V.yaw), rz = -Math.sin(G.V.yaw);
    let exit = null;
    for (const side of [1, -1, 1.35, -1.35]) {
      const ex = G.curCar.spec.exit;
      const q = { x: G.V.x + rx * ex * side, z: G.V.z + rz * ex * side };
      pushOut(q, 0.45);
      if (H(q.x, q.z) > -0.2) { exit = q; break; }
    }
    if (!exit) exit = { x: G.V.x - Math.sin(G.V.yaw) * G.curCar.spec.exit * 1.14, z: G.V.z + Math.cos(G.V.yaw) * G.curCar.spec.exit * 1.14 };
    G.inCar = false;
    dismountRider(G.player);
    setCarObstacle(true);
    P.x = exit.x; P.z = exit.z; P.y = H(P.x, P.z); P.yaw = G.V.yaw; P.vy = 0; P.ground = true;
    G.player.visible = true;
    if (G.rifle) G.rifle.visible = true;
    if (hooks.onToast) hooks.onToast('Te has bajado ' + G.curCar.from);
  }
}

export function updateVehicleDriving(dt, hooks = {}) {
  const P = G.P;
  const keys = G.keys;
  const throttle = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const steering = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  const cs = G.curCar.spec;
  const bio = biome(G.V.x, G.V.z);
  const surfGrip = bio === 'Nieve' ? 0.85 : bio === 'Desierto' ? 0.92 : bio === 'Playa' ? 0.90 : 1.0;

  if (throttle > 0) G.V.speed = Math.min(keys.ShiftLeft ? cs.vsh : cs.vmax, G.V.speed + cs.acc * surfGrip * dt);
  else if (throttle < 0) G.V.speed = Math.max(cs.rev, G.V.speed - cs.brk * dt);
  else G.V.speed *= Math.exp(-(keys.Space ? 5 : 1.0) * dt);

  const steerGrip = Math.min(1, Math.abs(G.V.speed) / 5) * surfGrip;
  G.V.yaw += steering * cs.steer * steerGrip * (G.V.speed < -0.1 ? -1 : 1) * dt;
  const vfx = -Math.sin(G.V.yaw), vfz = -Math.cos(G.V.yaw);
  const nx = G.V.x + vfx * G.V.speed * dt, nz = G.V.z + vfz * G.V.speed * dt;
  const q = { x: nx, z: nz };
  pushOut(q, cs.col);
  pushOut(q, cs.col);
  if (Math.hypot(q.x - nx, q.z - nz) > 0.12) G.V.speed *= -0.18;
  if (H(q.x, q.z) > -1.0) { G.V.x = q.x; G.V.z = q.z; }
  else G.V.speed *= 0.35;

  P.x = G.V.x; P.z = G.V.z; P.y = H(P.x, P.z); P.yaw = G.V.yaw; P.vy = 0; P.ground = true;
  updateCarTransform();
  crankUpdate(G.curCar, G.V.speed, dt, (keys.KeyW || keys.ShiftLeft) && G.V.speed > 0.2);

  // Vehicle engine sound
  updateEngineSound(true, Math.abs(G.V.speed), G.curCar.idx === 4, G.curCar.idx === 5);

  // Ramming bots at speed
  if (Math.abs(G.V.speed) > 9 && (!G.ONLINE || G.NET.host)) {
    const hitR = cs.col + 0.7;
    for (const h of G.bots) {
      const b = h.userData.root, u = b.userData;
      if (u.dead || !b.visible) continue;
      if (Math.hypot(b.position.x - G.V.x, b.position.z - G.V.z) < hitR && Math.abs(b.position.y - P.y) < 2.2) {
        const ramDmg = Math.round(Math.abs(G.V.speed) * 4.5);
        u.hp -= ramDmg;
        G.P.damageDealt += ramDmg;
        if (u.hp <= 0) {
          u.dead = true; u.t = 0;
          G.P.kills++;
          playHitmarker(true);
          if (hooks.onBotKilled) hooks.onBotKilled(b);
        } else {
          // Knock bot aside
          b.position.x += (b.position.x - G.V.x) * 1.4;
          b.position.z += (b.position.z - G.V.z) * 1.4;
        }
      }
    }
  }
}

function makeCar(slot, model, scale) {
  if (scale && scale !== 1) model.scale.setScalar(scale);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= bounds.min.y;
  model.position.z -= center.z;
  model.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const root = new THREE.Group();
  root.add(model);
  root.rotation.order = 'YXZ';
  const spot = findCarSpot(slot);
  const S = CAR_SLOTS[slot];
  const c = {
    idx: slot, name: S.name, to: S.to, from: S.from, spec: S.spec,
    root, st: { x: spot.x, z: spot.z, yaw: G.SPAWN[2], speed: 0 },
    obs: { x: spot.x, z: spot.z, r: S.spec.obsR },
    max: S.spec.hp, hp: S.spec.hp, dead: false, ph: 0,
    size: bounds.getSize(new THREE.Vector3()), model, crank: model.userData.crank || null,
  };
  const hb = new THREE.Mesh(
    new THREE.BoxGeometry(c.size.x * 0.92, c.size.y * 0.9, c.size.z * 0.95),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hb.position.y = c.size.y * 0.45;
  hb.userData.veh = c;
  c.root.add(hb);
  c.hb = hb;

  G.CARS[slot] = c;
  if (VEH.seed !== null) vehPlace(c);
  updateCarTransform(c);
  G.scene.add(root);
  setCarObstacle(true, c);
  G.carReady = true;
}

export async function initVehicles(reportProgress) {
  reportProgress(0.78, 'Cargando Citroën C3, Peugeot 206, bici y moto…');
  const [citroen, peugeot, bike, moto] = await Promise.all([
    loadGLB('/assets/models/citroen_c3.glb'),
    loadGLB('/assets/models/peugeot_206.glb'),
    loadGLB('/assets/models/canyon_aeroad.glb'),
    loadGLB('/assets/models/honda_africa_twin.glb'),
  ]);

  makeCar(0, citroen.scene);
  makeCar(1, citroen.scene.clone(true));
  makeCar(2, peugeot.scene, 1.22);
  makeCar(3, peugeot.scene.clone(true), 1.22);
  splitCranks(bike.scene);
  makeCar(4, bike.scene);
  makeCar(5, moto.scene);

  reportProgress(0.92, 'Vehículos desplegados en la isla…');
}
