// Player module: Athlete SkinnedMesh, skeletal animations (ground, skydive, glider, victory),
// M16 + 3D multi-part Shotgun & SMG weapons, menu showcase framing, controls, damage & cameras.

import { G, b2a, wrap, CUSTOM, SETTINGS } from './state.js';
import { H, biome, pushOut } from './world.js';
import { playFootstep, playHurt } from './audio.js';

export let AP = null;
export const CL = {};
export const K = 2.5;
let NB = 0;
let SH = null;
let RFS = null;

export const hp0 = [0, 0, 0];
const qa = [0, 0, 0, 0];
const qb = [0, 0, 0, 0];
const ARMD = [
  ['RightArm', 0.222646, -0.055023, -0.326867, 0.91682],
  ['RightForeArm', 0.035271, 0.009978, 0.294763, 0.954867],
  ['LeftArm', -0.219235, -0.121932, -0.079305, 0.964769],
  ['LeftForeArm', -0.044594, 0.00984, -0.264081, 0.963418],
];

const _aq = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _a = new THREE.Quaternion();
const _t = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

export let hurtT = 0;
export let deadT = 0;
export let shHit = 0;
export function setShHit(v) { shHit = v; }
export function setHurtT(v) { hurtT = v; }
export function resetDeadT() { deadT = 0; }
export function addDeadT(dt) { deadT += dt; }

let showcaseLight = null;
let showcaseRim = null;
let showcaseFill = null;
let showcasePad = null;
let showcaseSpot = null;
let footstepTimer = 0;
const _camPosSm = new THREE.Vector3();
const _camLookSm = new THREE.Vector3();
let camSmReady = false;

export function mkState() {
  return {
    cw: { run: 0, walk: 0, back: 0, strafe: 0 },
    ct: { run: 0, walk: 0, back: 0, strafe: 0 },
    ft: 0, jw: 0, jt: 0, vt: 0, skyT: 0, glideT: 0,
  };
}

function findShowcaseSpot() {
  // Choose a flat beach overlook on the W/SW coast facing inward toward the volcano & forest
  let best = { x: G.SPAWN[0], z: G.SPAWN[1], y: H(G.SPAWN[0], G.SPAWN[1]), yaw: G.SPAWN[2] };
  let bestScore = -1e9;
  for (let a = 2.0; a < 4.5; a += 0.12) {
    for (let r = 105; r <= 148; r += 3) {
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = H(x, z);
      if (h < 1.3 || h > 5.5) continue;
      const gx = Math.abs(H(x + 2, z) - H(x - 2, z));
      const gz = Math.abs(H(x, z + 2) - H(x, z - 2));
      const flat = 1 - Math.min(1, Math.hypot(gx, gz));
      // Camera sits ~4.8m seaward from character looking toward island center (0, 10, 0)
      const toCenterYaw = Math.atan2(x, z);
      const camTestX = x + Math.sin(toCenterYaw) * 5.2;
      const camTestZ = z + Math.cos(toCenterYaw) * 5.2;
      const camGround = H(camTestX, camTestZ);
      if (camGround > h + 0.6) continue;
      const score = flat * 10 - Math.abs(h - 2.4);
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, y: h, yaw: toCenterYaw };
      }
    }
  }
  return best;
}

export async function initPlayerSystem(reportProgress) {
  const res = await fetch('/assets/models/athlete_pack.json');
  AP = await res.json();
  NB = AP.names.length;
  reportProgress(0.60, 'Inicializando esqueleto, armas 3D y paracaídas…');

  const player = buildAthlete();
  buildWeaponSet(player);
  attachGlider(player);

  const muzzle = player.userData.weapons.m16.userData.mz;
  const flash = new THREE.PointLight(0x8feaff, 0, 9);
  muzzle.add(flash);

  G.scene.add(player);
  G.player = player;
  G.weapons = player.userData.weapons;
  G.rifle = player.userData.rifle;
  G.muzzle = muzzle;
  G.flash = flash;
  G.gliderMesh = player.userData.glider;

  // 3-point showcase & victory lighting rig
  showcaseLight = new THREE.PointLight(0xfff5e4, 0, 16);
  showcaseRim = new THREE.PointLight(0x38bdf8, 0, 16);
  showcaseFill = new THREE.PointLight(0xdbeafe, 0, 14);
  G.scene.add(showcaseLight, showcaseRim, showcaseFill);

  showcaseSpot = findShowcaseSpot();

  // Subtle grounded coastal lobby platform so boots sit cleanly flush
  const padGeo = new THREE.CylinderGeometry(1.45, 1.62, 0.14, 32);
  const padMat = new THREE.MeshPhongMaterial({
    color: 0x0f1f38,
    specular: 0x38bdf8,
    shininess: 40,
  });
  showcasePad = new THREE.Mesh(padGeo, padMat);
  const padRing = new THREE.Mesh(
    new THREE.RingGeometry(1.32, 1.44, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
  );
  padRing.position.y = 0.08;
  showcasePad.add(padRing);
  showcasePad.position.set(showcaseSpot.x, showcaseSpot.y - 0.04, showcaseSpot.z);
  showcasePad.receiveShadow = true;
  showcasePad.userData.ring = padRing;
  G.scene.add(showcasePad);
  // Adjust character stand height onto top of dais
  showcaseSpot.standY = showcaseSpot.y + 0.03;

  applyCustomization();
  return { AP, CL };
}

export function buildAthlete() {
  if (!SH) {
    const g = new THREE.BufferGeometry();
    const A = (k, a, n) => g.setAttribute(k, new THREE.BufferAttribute(a, n));
    A('position', new Float32Array(b2a(AP.p)), 3);
    A('normal', new Float32Array(b2a(AP.n)), 3);
    A('uv', new Float32Array(b2a(AP.u)), 2);
    g.setIndex(new THREE.BufferAttribute(AP.i32 ? new Uint32Array(b2a(AP.i)) : new Uint16Array(b2a(AP.i)), 1));
    A('skinIndex', Uint16Array.from(new Uint8Array(b2a(AP.si))), 4);
    A('skinWeight', Float32Array.from(new Uint8Array(b2a(AP.sw)), v => v / 255), 4);
    g.scale(K, K, K);
    g.computeBoundingSphere();

    const T = d => {
      const t = new THREE.TextureLoader().load(d);
      t.flipY = false;
      t.anisotropy = 4;
      return t;
    };
    SH = { g, tc: T(AP.tc), tn: T(AP.tn), Tr: new Float32Array(b2a(AP.T)), Qr: new Float32Array(b2a(AP.Q)) };
    for (const n in AP.clips) {
      const c = AP.clips[n];
      CL[n] = {
        n: c.n,
        d: (c.n - 1) / 30,
        q: Float32Array.from(new Int16Array(b2a(c.q)), v => v / 32767),
        h: new Float32Array(b2a(c.h)),
      };
    }
  }

  const Tr = SH.Tr, Qr = SH.Qr;
  const bones = AP.names.map((n, k) => {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(Tr[k * 3] * K, Tr[k * 3 + 1] * K, Tr[k * 3 + 2] * K);
    b.quaternion.set(Qr[k * 4], Qr[k * 4 + 1], Qr[k * 4 + 2], Qr[k * 4 + 3]);
    return b;
  });
  AP.par.forEach((p, k) => {
    if (p >= 0) bones[p].add(bones[k]);
  });

  const meshMat = new THREE.MeshPhongMaterial({
    map: SH.tc,
    normalMap: SH.tn,
    specular: 0x222222,
    shininess: 16,
    skinning: true,
  });
  const mesh = new THREE.SkinnedMesh(SH.g, meshMat);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const mr = new THREE.Group();
  mr.rotation.y = Math.PI - 0.48;
  mr.add(mesh, bones[0]);

  const root = new THREE.Group();
  root.add(mr);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  const bn = {};
  bones.forEach(b => (bn[b.name] = b));
  root.userData = {
    bn,
    mesh,
    mat: meshMat,
    mr,
    st: mkState(),
    lower: AP.names.map(n => /Leg|Foot|Toe|Hips/.test(n)),
  };
  return root;
}

export function applyCustomization() {
  if (!G.player || !G.player.userData) return;
  const mat = G.player.userData.mat;
  if (mat) {
    const c = new THREE.Color(CUSTOM.suitColor || '#ffffff');
    const base = new THREE.Color(0xffffff);
    base.lerp(c, 0.35);
    mat.color.copy(base);
  }
  const bn = G.player.userData.bn;
  if (bn && bn.Head) {
    let visor = bn.Head.getObjectByName('customVisorGlow');
    if (!visor) {
      visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.032, 0.045),
        new THREE.MeshBasicMaterial({ color: CUSTOM.visorColor || '#67e8f9', transparent: true, opacity: 0.72 })
      );
      visor.name = 'customVisorGlow';
      visor.position.set(0, 0.045, 0.088);
      bn.Head.add(visor);
    }
    visor.material.color.set(CUSTOM.visorColor || '#67e8f9');
  }
  if (G.flash) {
    G.flash.color.set(CUSTOM.accentColor || '#8feaff');
  }
  if (showcasePad && showcasePad.userData.ring) {
    showcasePad.userData.ring.material.color.set(CUSTOM.accentColor || '#38bdf8');
  }
}

// ---------- 3D Multi-Part Weapons (M16 + Shotgun + SMG) ----------
export function makeRifle() {
  if (!RFS) {
    const R_ = AP.rifle, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b2a(R_.p)), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b2a(R_.n)), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b2a(R_.u)), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(b2a(R_.i)), 1));
    const t = new THREE.TextureLoader().load(R_.t);
    t.flipY = false;
    RFS = { g, m: new THREE.MeshPhongMaterial({ map: t, specular: 0x555555, shininess: 48 }) };
  }
  const grp = new THREE.Group();
  const m = new THREE.Mesh(RFS.g, RFS.m);
  m.castShadow = true;
  grp.add(m);
  const mz = new THREE.Object3D();
  mz.position.fromArray(AP.rifle.mz);
  grp.add(mz);
  grp.userData.mz = mz;
  return grp;
}

// 9-part Composite 3D Pump Shotgun (aligned with AP.rifle local frame: -Z muzzle, +Z stock)
export function makeShotgun() {
  const grp = new THREE.Group();
  const metal = new THREE.MeshPhongMaterial({ color: 0x1e293b, specular: 0x7dd3fc, shininess: 68 });
  const darkGrip = new THREE.MeshPhongMaterial({ color: 0x0f172a, specular: 0x222222, shininess: 18 });
  const accent = new THREE.MeshPhongMaterial({ color: 0x0ea5e9, emissive: 0x0284c7, emissiveIntensity: 0.45, specular: 0xbbeeff, shininess: 90 });
  const chrome = new THREE.MeshPhongMaterial({ color: 0x94a3b8, specular: 0xffffff, shininess: 95 });

  // 1. Heavy Receiver
  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.135, 0.44), metal);
  rec.position.set(0, -0.02, 0.14);
  // 2. Main Wide-Bore Barrel (-Z)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.72, 14).rotateX(Math.PI / 2), chrome);
  barrel.position.set(0, -0.015, -0.40);
  // 3. Under-barrel Pressure Tube
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.62, 12).rotateX(Math.PI / 2), metal);
  tube.position.set(0, -0.072, -0.35);
  // 4. Ribbed Pump Slide
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.075, 0.25), darkGrip);
  pump.position.set(0, -0.078, -0.30);
  // 5. Vented Heat Shield
  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.042, 0.42), darkGrip);
  shroud.position.set(0, 0.035, -0.26);
  // 6. Sculpted Buttstock (+Z)
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.145, 0.42), darkGrip);
  stock.position.set(0, -0.06, 0.54);
  stock.rotation.x = 0.14;
  // 7. Angled Pistol Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.16, 0.075), darkGrip);
  grip.position.set(0, -0.14, 0.31);
  grip.rotation.x = 0.34;
  // 8. Hydro Pressure Cell on Side
  const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.24, 10).rotateX(Math.PI / 2), accent);
  cell.position.set(0.056, -0.02, 0.12);
  // 9. Muzzle Choke & Sight
  const choke = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.033, 0.08, 12).rotateX(Math.PI / 2), accent);
  choke.position.set(0, -0.015, -0.76);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.045, 0.12), accent);
  sight.position.set(0, 0.065, 0.12);

  [rec, barrel, tube, pump, shroud, stock, grip, cell, choke, sight].forEach(m => {
    m.castShadow = true;
    grp.add(m);
  });

  const mz = new THREE.Object3D();
  mz.position.set(0, -0.015, -0.81);
  grp.add(mz);
  grp.userData.mz = mz;
  return grp;
}

// 8-part Composite 3D Compact Hydro-SMG (aligned with AP.rifle local frame: -Z muzzle, +Z stock)
export function makeSMG() {
  const grp = new THREE.Group();
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x16243a, specular: 0x38bdf8, shininess: 72 });
  const trimMat = new THREE.MeshPhongMaterial({ color: 0x0b1220, specular: 0x1e293b, shininess: 22 });
  const glowMat = new THREE.MeshPhongMaterial({ color: 0x22d3ee, emissive: 0x06b6d4, emissiveIntensity: 0.65, specular: 0xffffff, shininess: 95 });
  const steelMat = new THREE.MeshPhongMaterial({ color: 0x64748b, specular: 0xe2e8f0, shininess: 85 });

  // 1. Compact Receiver
  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.125, 0.42), bodyMat);
  rec.position.set(0, -0.015, 0.04);
  // 2. Perforated Shroud
  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.095, 0.28), trimMat);
  shroud.position.set(0, -0.01, -0.28);
  // 3. Suppressor / Hydro Barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.24, 12).rotateX(Math.PI / 2), steelMat);
  barrel.position.set(0, -0.01, -0.50);
  // 4. Extended Angled Magazine
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.28, 0.075), glowMat);
  mag.position.set(0, -0.18, -0.08);
  mag.rotation.x = -0.18;
  // 5. Pistol Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.15, 0.068), trimMat);
  grip.position.set(0, -0.13, 0.19);
  grip.rotation.x = 0.28;
  // 6. Folding Skeleton Stock
  const stockBar = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.055, 0.30), steelMat);
  stockBar.position.set(0, -0.015, 0.39);
  const stockPad = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.14, 0.05), trimMat);
  stockPad.position.set(0, -0.045, 0.54);
  // 7. Holographic Reflex Sight
  const sightFrame = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.095), trimMat);
  sightFrame.position.set(0, 0.075, 0.04);
  const sightLens = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.036, 0.012), glowMat);
  sightLens.position.set(0, 0.082, 0.04);
  // 8. Cyan Hydro Rail Strip
  const hydroTube = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.32, 8).rotateX(Math.PI / 2), glowMat);
  hydroTube.position.set(-0.048, -0.01, 0.02);

  [rec, shroud, barrel, mag, grip, stockBar, stockPad, sightFrame, sightLens, hydroTube].forEach(m => {
    m.castShadow = true;
    grp.add(m);
  });

  const mz = new THREE.Object3D();
  mz.position.set(0, -0.01, -0.63);
  grp.add(mz);
  grp.userData.mz = mz;
  return grp;
}

export function buildWeaponSet(actor) {
  const m16 = makeRifle();
  const shotgun = makeShotgun();
  const smg = makeSMG();
  attachRifle(m16, actor);
  attachRifle(shotgun, actor);
  attachRifle(smg, actor);
  shotgun.visible = false;
  smg.visible = false;
  actor.userData.weapons = { m16, shotgun, smg };
  actor.userData.rifle = m16;
  actor.userData.activeWeaponId = 'm16';
  return actor.userData.weapons;
}

export function equipActorWeapon(actor, weaponId = 'm16', hidden = false) {
  if (!actor || !actor.userData) return;
  const ws = actor.userData.weapons;
  if (!ws) {
    if (actor.userData.rifle) actor.userData.rifle.visible = !hidden;
    return;
  }
  const activeId = ws[weaponId] ? weaponId : 'm16';
  actor.userData.activeWeaponId = activeId;
  for (const id in ws) {
    ws[id].visible = !hidden && id === activeId;
  }
  actor.userData.rifle = ws[activeId];
  if (actor === G.player) {
    G.rifle = ws[activeId];
    G.muzzle = ws[activeId].userData.mz;
    if (G.flash && G.muzzle) G.muzzle.add(G.flash);
  }
}

export function attachRifle(r, actor) {
  const f = AP.rf;
  (actor || G.player).userData.bn.Spine2.add(r);
  r.position.set(f[0], f[1], f[2]);
  r.quaternion.set(f[3], f[4], f[5], f[6]);
}

// ---------- Composite 3D Glider / Parachute (7 parts) ----------
export function buildGlider() {
  const grp = new THREE.Group();
  const wingMat = new THREE.MeshPhongMaterial({ color: 0x0ea5e9, specular: 0xbae6fd, shininess: 45, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshPhongMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.2, specular: 0xffffff, shininess: 65 });
  const strutMat = new THREE.MeshPhongMaterial({ color: 0x1e293b, specular: 0x94a3b8, shininess: 60 });

  // Swept Left & Right Wing Panels
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.06, 1.05), wingMat);
  wingL.position.set(-0.88, 0.72, 0.05);
  wingL.rotation.set(0.06, 0.24, -0.14);

  const wingR = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.06, 1.05), wingMat);
  wingR.position.set(0.88, 0.72, 0.05);
  wingR.rotation.set(0.06, -0.24, 0.14);

  // Wingtip Gold Accent Fins
  const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.92), trimMat);
  tipL.position.set(-1.72, 0.62, 0.22);
  tipL.rotation.y = 0.24;

  const tipR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 0.92), trimMat);
  tipR.position.set(1.72, 0.62, 0.22);
  tipR.rotation.y = -0.24;

  // Central Spine Boom & Control Crossbar
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.45, 8).rotateX(Math.PI / 2), strutMat);
  boom.position.set(0, 0.76, 0.08);

  const handleBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.92, 8).rotateZ(Math.PI / 2), trimMat);
  handleBar.position.set(0, 0.02, -0.18);

  // Twin V-Struts connecting crossbar to wing canopy
  const strutL = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 6), strutMat);
  strutL.position.set(-0.34, 0.38, -0.08);
  strutL.rotation.set(-0.22, 0, 0.28);

  const strutR = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 6), strutMat);
  strutR.position.set(0.34, 0.38, -0.08);
  strutR.rotation.set(-0.22, 0, -0.28);

  [wingL, wingR, tipL, tipR, boom, handleBar, strutL, strutR].forEach(m => {
    m.castShadow = true;
    grp.add(m);
  });

  return grp;
}

export function attachGlider(actor) {
  const g = buildGlider();
  g.position.set(0, 2.38, 0.05);
  g.visible = false;
  actor.add(g);
  actor.userData.glider = g;
  return g;
}

// ---------- Skeletal Samplers & Helpers ----------
function samp(c, t, k, o) {
  const m = c.n - 1;
  let f = t * 30;
  f = ((f % m) + m) % m;
  const i = Math.floor(f), w = f - i, j = Math.min(i + 1, m), a = (i * NB + k) * 4, b = (j * NB + k) * 4, q = c.q;
  const sg = (q[a] * q[b] + q[a + 1] * q[b + 1] + q[a + 2] * q[b + 2] + q[a + 3] * q[b + 3]) < 0 ? -1 : 1;
  for (let x = 0; x < 4; x++) o[x] = q[a + x] * (1 - w) + q[b + x] * w * sg;
}

function sampH(c, t, o) {
  const m = c.n - 1;
  let f = t * 30;
  f = ((f % m) + m) % m;
  const i = Math.floor(f), w = f - i, j = Math.min(i + 1, m), h = c.h;
  for (let x = 0; x < 3; x++) o[x] = h[i * 3 + x] * (1 - w) + h[j * 3 + x] * w;
}

function armFix(B) {
  for (const a of ARMD) B[a[0]].quaternion.multiply(_aq.set(a[1], a[2], a[3], a[4]));
}

function addRot(b, ang, axis = AX) {
  if (!ang) return;
  _p.identity();
  for (let p = b.parent; p && p.isBone; p = p.parent) _p.premultiply(p.quaternion);
  _a.setFromAxisAngle(axis, ang);
  _t.copy(_p).invert().multiply(_a).multiply(_p);
  b.quaternion.premultiply(_t);
}

export function poseBot(r) {
  const B = r.userData.bn;
  for (let k = 0; k < NB; k++) {
    samp(CL.fire, 0, k, qa);
    B[AP.names[k]].quaternion.set(qa[0], qa[1], qa[2], qa[3]).normalize();
  }
  armFix(B);
  sampH(CL.fire, 0, hp0);
  B.Hips.position.set(hp0[0] * K, hp0[1] * K, hp0[2] * K);
}

export function animate(r, dt, a) {
  const u = r.userData, B = u.bn, low = u.lower, st = u.st, cw = st.cw, ct = st.ct;
  const spd = a.spd, k = Math.min(1, dt * 10), fwd = a.fwd, side = a.side, slow = a.wade || a.walk;
  const tg = {
    run: fwd > 0.3 && !slow ? 1 : 0,
    walk: fwd > 0.3 && slow ? 1 : 0,
    back: fwd < -0.3 ? 1 : 0,
    strafe: Math.abs(fwd) <= 0.3 && Math.abs(side) > 0.3 ? 1 : 0,
  };
  const rate = {
    run: spd / 5.9,
    walk: spd / 3.1,
    back: spd / 5.9,
    strafe: Math.min(2.2, spd / 1.63) * (side > 0 ? -1 : 1),
  };
  let sum = 0;
  for (const n in cw) {
    cw[n] += (tg[n] - cw[n]) * k;
    if (cw[n] > 0.02) ct[n] += dt * rate[n];
    sum += cw[n];
  }
  const nrm = sum > 1 ? 1 / sum : 1, idle = Math.max(0, 1 - sum * nrm), act = a.shoot;
  if (act || st.ft > 0) {
    st.ft += dt * 1.6;
    if (st.ft >= CL.fire.d) st.ft = act ? st.ft - CL.fire.d : 0;
  }
  const ft = st.ft, jmax = (CL.jump.n - 2) / 30;
  st.jw += ((a.ground ? 0 : 1) - st.jw) * Math.min(1, dt * (a.ground ? 10 : 18));
  if (a.ground) {
    if (st.jw < 0.02) st.jt = 0;
  } else {
    st.jt = Math.min(st.jt + dt / 1.05, jmax);
  }

  const jw = st.jw, jt = st.jt, hp = [0, 0, 0], tmp = [0, 0, 0];
  for (let kk = 0; kk < NB; kk++) {
    samp(CL.fire, ft, kk, qa);
    const o = qa.slice();
    if (low[kk]) {
      for (let j = 0; j < 4; j++) o[j] *= idle;
      for (const n in cw) {
        const w = cw[n] * nrm;
        if (w < 0.001) continue;
        samp(CL[n], ct[n], kk, qb);
        const s = (qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3]) < 0 ? -1 : 1;
        for (let j = 0; j < 4; j++) o[j] += qb[j] * w * s;
      }
      if (jw > 0.001) {
        samp(CL.jump, jt, kk, qb);
        const s = (o[0] * qb[0] + o[1] * qb[1] + o[2] * qb[2] + o[3] * qb[3]) < 0 ? -1 : 1;
        for (let j = 0; j < 4; j++) o[j] = o[j] * (1 - jw) + qb[j] * jw * s;
      }
    }
    B[AP.names[kk]].quaternion.set(o[0], o[1], o[2], o[3]).normalize();
  }
  armFix(B);
  sampH(CL.fire, ft, hp);
  for (let j = 0; j < 3; j++) hp[j] *= idle;
  for (const n in cw) {
    const w = cw[n] * nrm;
    if (w < 0.001) continue;
    sampH(CL[n], ct[n], tmp);
    for (let j = 0; j < 3; j++) hp[j] += tmp[j] * w;
  }
  if (jw > 0.001) {
    sampH(CL.jump, jt, tmp);
    hp[1] = hp[1] * (1 - jw) + tmp[1] * jw;
  }

  const cr = a.land > 0 ? Math.sin(Math.min(1, a.land / 0.3) * Math.PI) : 0;
  const p = a.pitch;
  B.Hips.position.set(hp[0] * K, (hp[1] - cr * 0.06) * K, hp[2] * K);
  addRot(B.Spine, -p * 0.25 + cr * 0.2);
  addRot(B.Spine1, -p * 0.3);
  addRot(B.Spine2, -p * 0.3);
  addRot(B.Neck, -p * 0.1);
  addRot(B.Head, -p * 0.1);
  addRot(B.LeftUpLeg, -0.5 * cr);
  addRot(B.RightUpLeg, -0.5 * cr);
  addRot(B.LeftLeg, 0.9 * cr);
  addRot(B.RightLeg, 0.9 * cr);

  // Subtle weapon recoil kick
  if (a.rec && a.rec > 0.02) {
    addRot(B.RightArm, -a.rec * 0.12, AX);
    addRot(B.Spine2, a.rec * 0.05, AX);
  }

  // Reload animation tilt
  if (a.reload > 0) {
    const rPulse = Math.sin(a.reload * 7.5) * 0.28;
    addRot(B.LeftArm, -0.55 + rPulse, AX);
    addRot(B.LeftForeArm, 0.65, AY);
    addRot(B.RightArm, 0.18, AX);
  }
}

export function animSkydive(r, dt, steer = 0, diveForward = 0) {
  const u = r.userData, B = u.bn, st = u.st;
  st.skyT = (st.skyT || 0) + dt;
  const t = st.skyT;
  const Qr = SH.Qr;
  for (let k = 0; k < NB; k++) {
    B[AP.names[k]].quaternion.set(Qr[k * 4], Qr[k * 4 + 1], Qr[k * 4 + 2], Qr[k * 4 + 3]).normalize();
  }
  const Tr = SH.Tr;
  B.Hips.position.set(Tr[0] * K, Tr[1] * K, Tr[2] * K);

  // Belly-down aerodynamic skydive arch + spread arms/legs
  const diveAngle = 0.95 + diveForward * 0.28;
  addRot(B.Hips, diveAngle, AX);
  addRot(B.Hips, -steer * 0.38, AZ);
  addRot(B.Spine, -0.22, AX);
  addRot(B.Spine1, -0.18, AX);
  addRot(B.Neck, -0.35, AX);
  addRot(B.Head, -0.35, AX);

  const windWave = Math.sin(t * 7.5) * 0.09;
  addRot(B.LeftArm, -0.85 + windWave, AZ);
  addRot(B.RightArm, 0.85 - windWave, AZ);
  addRot(B.LeftArm, -0.35, AX);
  addRot(B.RightArm, -0.35, AX);
  addRot(B.LeftForeArm, 0.45, AY);
  addRot(B.RightForeArm, -0.45, AY);

  addRot(B.LeftUpLeg, 0.35 + windWave * 0.7, AX);
  addRot(B.RightUpLeg, 0.35 - windWave * 0.7, AX);
  addRot(B.LeftUpLeg, -0.22, AZ);
  addRot(B.RightUpLeg, 0.22, AZ);
  addRot(B.LeftLeg, 0.55, AX);
  addRot(B.RightLeg, 0.55, AX);
}

export function animGlide(r, dt, steer = 0) {
  const u = r.userData, B = u.bn, st = u.st;
  st.glideT = (st.glideT || 0) + dt;
  const t = st.glideT;
  const Qr = SH.Qr;
  for (let k = 0; k < NB; k++) {
    B[AP.names[k]].quaternion.set(Qr[k * 4], Qr[k * 4 + 1], Qr[k * 4 + 2], Qr[k * 4 + 3]).normalize();
  }
  const Tr = SH.Tr;
  B.Hips.position.set(Tr[0] * K, Tr[1] * K, Tr[2] * K);

  // Holding overhead glider bar with gentle wind leg sway
  const sway = Math.sin(t * 2.4) * 0.1;
  addRot(B.Hips, -steer * 0.24, AZ);
  addRot(B.Hips, 0.14, AX);
  addRot(B.Spine1, -0.08, AX);
  addRot(B.Head, -0.06, AX);

  addRot(B.LeftArm, -1.85, AX);
  addRot(B.RightArm, -1.85, AX);
  addRot(B.LeftArm, -0.22, AZ);
  addRot(B.RightArm, 0.22, AZ);
  addRot(B.LeftForeArm, -0.35, AX);
  addRot(B.RightForeArm, -0.35, AX);

  addRot(B.LeftUpLeg, 0.2 + sway, AX);
  addRot(B.RightUpLeg, 0.2 - sway, AX);
  addRot(B.LeftLeg, 0.42 + sway * 0.5, AX);
  addRot(B.RightLeg, 0.42 - sway * 0.5, AX);

  if (u.glider) {
    u.glider.rotation.z = -steer * 0.22;
    u.glider.rotation.x = Math.sin(t * 2.0) * 0.03;
  }
}

export function animDead(r, dt) {
  equipActorWeapon(r, r.userData.activeWeaponId || 'm16', true);
  if (r.userData.glider) r.userData.glider.visible = false;
  if (r.userData.fl) r.userData.fl.visible = false;
  const u = r.userData, B = u.bn, tm = (CL.die.n - 2) / 30;
  u.t = Math.min((u.t || 0) + dt, tm);
  for (let k = 0; k < NB; k++) {
    samp(CL.die, u.t, k, qa);
    B[AP.names[k]].quaternion.set(qa[0], qa[1], qa[2], qa[3]).normalize();
  }
  sampH(CL.die, u.t, hp0);
  B.Hips.position.set(hp0[0] * K, hp0[1] * K, hp0[2] * K);
}

// Battle Royale full-body celebratory victory dance/pose
export function animVictory(r, dt) {
  const u = r.userData, B = u.bn, st = u.st;
  st.vt = (st.vt || 0) + dt;
  const t = st.vt;

  for (let k = 0; k < NB; k++) {
    samp(CL.fire, 0, k, qa);
    B[AP.names[k]].quaternion.set(qa[0], qa[1], qa[2], qa[3]).normalize();
  }
  sampH(CL.fire, 0, hp0);

  const bounce = Math.abs(Math.sin(t * 4.2)) * 0.075;
  B.Hips.position.set(hp0[0] * K, (hp0[1] + bounce) * K, hp0[2] * K);

  const pump = Math.sin(t * 4.2) * 0.24;
  const sway = Math.sin(t * 2.1) * 0.14;
  addRot(B.Spine, -0.07 + Math.sin(t * 4.2) * 0.05, AX);
  addRot(B.Spine1, sway, AZ);
  addRot(B.Head, -0.08 + Math.sin(t * 4.2) * 0.08, AX);

  addRot(B.LeftShoulder, -0.35, AZ);
  addRot(B.RightShoulder, 0.35, AZ);
  addRot(B.LeftArm, -1.65 + pump, AZ);
  addRot(B.RightArm, 1.65 - pump, AZ);
  addRot(B.LeftForeArm, -0.45 + pump * 0.5, AX);
  addRot(B.RightForeArm, -0.45 - pump * 0.5, AX);

  const knee = Math.max(0, Math.sin(t * 4.2)) * 0.22;
  addRot(B.LeftUpLeg, -knee * 0.6, AX);
  addRot(B.RightUpLeg, -knee * 0.6, AX);
  addRot(B.LeftLeg, knee * 1.1, AX);
  addRot(B.RightLeg, knee * 1.1, AX);
}

// Menu 3D showcase: full-body framing (head to boots) cleanly on right side, zero menu overlap
export function updateMenuShowcase(dt, nowSec) {
  const player = G.player;
  if (!player || !showcaseSpot) return;

  player.visible = true;
  if (showcasePad) showcasePad.visible = true;
  if (player.userData.glider) player.userData.glider.visible = false;

  const pose = CUSTOM.pose || 'idle';
  equipActorWeapon(player, G.P.weaponId || 'm16', pose === 'victory');

  const sx = showcaseSpot.x;
  const sz = showcaseSpot.z;
  const sy = showcaseSpot.standY || showcaseSpot.y;
  player.position.set(sx, sy, sz);
  player.rotation.set(0, showcaseSpot.yaw + Math.sin(nowSec * 0.38) * 0.12, 0);

  // Balanced 3-point studio + island lighting
  if (showcaseLight && showcaseRim && showcaseFill) {
    const fYaw = showcaseSpot.yaw;
    const fx = -Math.sin(fYaw), fz = -Math.cos(fYaw);
    const rx = Math.cos(fYaw), rz = -Math.sin(fYaw);
    showcaseLight.intensity = 1.45;
    showcaseLight.position.set(sx + fx * 3.8 + rx * 1.8, sy + 3.4, sz + fz * 3.8 + rz * 1.8);
    showcaseRim.intensity = 1.85;
    showcaseRim.color.set(CUSTOM.accentColor || '#38bdf8');
    showcaseRim.position.set(sx - fx * 3.0 - rx * 1.4, sy + 2.9, sz - fz * 3.0 - rz * 1.4);
    showcaseFill.intensity = 0.75;
    showcaseFill.position.set(sx + fx * 3.5 - rx * 2.0, sy + 1.5, sz + fz * 3.5 - rz * 2.0);
  }

  // Play selected pose with smooth natural motion
  if (pose === 'victory') {
    animVictory(player, dt);
  } else if (pose === 'run') {
    animate(player, dt, { fwd: 1, side: 0, spd: 8.2, wade: false, walk: false, shoot: false, pitch: 0.02, ground: true, land: 0, reload: 0 });
  } else if (pose === 'jump') {
    animate(player, dt, { fwd: 0.2, side: 0, spd: 3, wade: false, walk: false, shoot: false, pitch: 0.1, ground: false, land: 0, reload: 0 });
  } else if (pose === 'aim') {
    animate(player, dt, { fwd: 0, side: 0, spd: 0, wade: false, walk: false, shoot: true, pitch: 0.04, ground: true, land: 0, reload: 0 });
  } else {
    // Natural breathing idle + subtle head glance
    animate(player, dt, {
      fwd: 0, side: 0, spd: 0, wade: false, walk: false, shoot: false,
      pitch: Math.sin(nowSec * 1.35) * 0.035,
      ground: true, land: 0, reload: 0,
    });
    const B = player.userData.bn;
    if (B && B.Head) {
      addRot(B.Head, Math.sin(nowSec * 0.6) * 0.11, AY);
    }
  }

  // Full-body mathematical camera framing: char height 2.5m (y = 0..2.5)
  const cam = G.cam;
  const targetFov = 42;
  if (Math.abs(cam.fov - targetFov) > 0.05) {
    cam.fov = targetFov;
    cam.updateProjectionMatrix();
  }
  const halfTan = Math.tan((targetFov * Math.PI) / 360);
  const visH = 3.85; // 2.5m character fills ~65% of screen height -> clean head & boot margins!
  const aspect = Math.max(0.75, cam.aspect || 1.6);
  const distScale = aspect < 1.35 ? 1.35 / aspect : 1.0;
  const dist = (visH / (2 * halfTan)) * distScale;

  // Look left of character in camera-right space so character sits cleanly in the right ~68% zone
  const fYaw = showcaseSpot.yaw;
  const fx = -Math.sin(fYaw), fz = -Math.cos(fYaw);
  const rx = Math.cos(fYaw), rz = -Math.sin(fYaw);
  const subOpen = G.MENU_PANEL && G.MENU_PANEL !== 'main';
  const shiftLeft = -(subOpen ? 0.25 : 0.20) * visH * aspect;
  const orbitSway = Math.sin(nowSec * 0.32) * 0.35;
  const bob = Math.cos(nowSec * 0.48) * 0.08;

  const targetCamPos = new THREE.Vector3(
    sx + fx * dist + rx * (shiftLeft + orbitSway),
    sy + 1.48 + bob,
    sz + fz * dist + rz * (shiftLeft + orbitSway)
  );
  const targetLook = new THREE.Vector3(
    sx + rx * shiftLeft,
    sy + 1.24,
    sz + rz * shiftLeft
  );

  if (!camSmReady) {
    _camPosSm.copy(targetCamPos);
    _camLookSm.copy(targetLook);
    camSmReady = true;
  } else {
    const damp = 1 - Math.exp(-5.5 * dt);
    _camPosSm.lerp(targetCamPos, damp);
    _camLookSm.lerp(targetLook, damp);
  }
  cam.position.copy(_camPosSm);
  cam.lookAt(_camLookSm);
}

export function disableShowcaseLights() {
  camSmReady = false;
  if (showcaseLight) showcaseLight.intensity = 0;
  if (showcaseRim) showcaseRim.intensity = 0;
  if (showcaseFill) showcaseFill.intensity = 0;
  if (showcasePad) showcasePad.visible = false;
}

export function updateVictoryCamera(dt, nowSec) {
  const P = G.P;
  const cam = G.cam;
  const player = G.player;
  if (!player) return;

  player.visible = true;
  equipActorWeapon(player, G.P.weaponId || 'm16', true);
  if (player.userData.glider) player.userData.glider.visible = false;
  player.position.set(P.x, P.y, P.z);
  player.rotation.set(0, P.yaw, 0);
  animVictory(player, dt);

  if (showcaseLight && showcaseRim && showcaseFill) {
    showcaseLight.intensity = 1.65;
    showcaseLight.position.set(P.x - Math.sin(P.yaw) * 3.5, P.y + 3.8, P.z - Math.cos(P.yaw) * 3.5);
    showcaseRim.intensity = 2.0;
    showcaseRim.color.set('#ffd84a');
    showcaseRim.position.set(P.x + Math.sin(P.yaw) * 3.0, P.y + 3.0, P.z + Math.cos(P.yaw) * 3.0);
    showcaseFill.intensity = 0.85;
    showcaseFill.position.set(P.x + Math.cos(P.yaw) * 3.2, P.y + 1.8, P.z - Math.sin(P.yaw) * 3.2);
  }

  const targetFov = 46;
  if (Math.abs(cam.fov - targetFov) > 0.1) {
    cam.fov = targetFov;
    cam.updateProjectionMatrix();
  }
  const angle = P.yaw + Math.PI + nowSec * 0.45;
  const dist = 5.4;
  const cx = P.x + Math.sin(angle) * dist;
  const cz = P.z + Math.cos(angle) * dist;
  const cy = Math.max(P.y + 1.75, H(cx, cz) + 0.85);
  cam.position.set(cx, cy, cz);
  cam.lookAt(P.x, P.y + 1.24, P.z);
}

export function hurt(n, by, raw, hooks = {}) {
  const P = G.P;
  if (P.dead || G.VICTORY_STATE === 'win') return;
  if (!raw && G.inCar && G.curCar && G.curCar.idx < 4) {
    if (hooks.onVehHit) hooks.onVehHit(G.curCar, n);
    hurtT = 0.08;
    return;
  }
  if (P.sh > 0) {
    const a = Math.min(P.sh, n);
    P.sh -= a;
    n -= a;
    shHit = 0.45;
  }
  P.hp = Math.max(0, P.hp - n);
  hurtT = 0.3;
  playHurt();
  if (hooks.onDamageIndicator && typeof by === 'number' && by >= 0) {
    hooks.onDamageIndicator(by);
  }

  if (P.hp <= 0) {
    P.dead = true;
    P.deaths++;
    deadT = 0;
    if (hooks.onNetDied) hooks.onNetDied(by);
    G.mouse = false;
    if (G.inCar && hooks.onDismount) hooks.onDismount();
    if (hooks.onPlayerDied) hooks.onPlayerDied(by);
  }
}

export function respawn(hooks = {}) {
  const P = G.P;
  if (G.inCar && hooks.onDismount) hooks.onDismount();
  G.V.speed = 0;
  P.hp = 100;
  P.sh = 0;
  P.dead = false;
  P.ammo = 30;
  P.reload = 0;
  P.weaponId = 'm16';
  P.vy = 0;
  P.ground = true;
  P.damageDealt = 0;

  let s;
  if (G.ONLINE && hooks.netSpawn) s = hooks.netSpawn();
  else s = G.SPAWN;

  P.x = s[0];
  P.z = s[1];
  P.yaw = s[2];
  P.pitch = -0.15;
  P.y = H(P.x, P.z);

  if (G.player) {
    G.player.userData.dead = false;
    G.player.userData.st = mkState();
    equipActorWeapon(G.player, 'm16', false);
    if (G.player.userData.glider) G.player.userData.glider.visible = false;
  }
  const deadEl = document.getElementById('dead');
  if (deadEl) deadEl.style.display = 'none';
}

export function updatePlayerMovement(dt, hooks = {}) {
  const P = G.P;
  const keys = G.keys;
  const AIM = G.AIM;

  if (keys.ArrowLeft) P.yaw += 1.8 * dt;
  if (keys.ArrowRight) P.yaw -= 1.8 * dt;
  if (keys.ArrowUp) P.pitch = Math.min(0.8, P.pitch + 1.2 * dt);
  if (keys.ArrowDown) P.pitch = Math.max(-0.9, P.pitch - 1.2 * dt);

  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  let mx = 0, mz = 0;
  if (keys.KeyW) { mx += fx; mz += fz; }
  if (keys.KeyS) { mx -= fx; mz -= fz; }
  if (keys.KeyD) { mx += rx; mz += rz; }
  if (keys.KeyA) { mx -= rx; mz -= rz; }
  if (P.dead) { mx = 0; mz = 0; }

  const moving = !!(mx || mz);
  const l = Math.hypot(mx, mz) || 1;
  const gh = H(P.x, P.z);
  const inWater = gh < -0.3;
  const spd = (keys.ShiftLeft && AIM < 0.5 ? 10 : 6) * (inWater ? 0.5 : 1) * (1 - 0.35 * AIM) * (hooks.isDrinking ? 0.52 : 1);
  const nx = P.x + (mx / l) * spd * dt;
  const nz = P.z + (mz / l) * spd * dt;

  const q = { x: nx, z: nz };
  pushOut(q, 0.45);
  pushOut(q, 0.45);
  if (H(q.x, q.z) > -3.2) {
    P.x = q.x;
    P.z = q.z;
  }

  const g = H(P.x, P.z);
  if (P.ground && keys.Space && !P.dead) {
    P.vy = 8;
    P.ground = false;
  }
  P.vy -= 24 * dt;
  P.y += P.vy * dt;
  if (P.y <= g) {
    if (!P.ground && P.vy < -5) P.land = 0.3;
    P.y = g;
    P.vy = 0;
    P.ground = true;
  }

  if (moving && P.ground && !P.dead) {
    footstepTimer -= dt * (spd / 6);
    if (footstepTimer <= 0) {
      footstepTimer = 0.38;
      playFootstep(biome(P.x, P.z));
    }
  }

  if (G.player) {
    G.player.visible = true;
    G.player.position.set(P.x, P.y, P.z);
    G.player.rotation.y = P.yaw;
    if (G.player.userData.glider) G.player.userData.glider.visible = false;
    if (P.land > 0) P.land -= dt;
    if (P.dead) {
      animDead(G.player, dt);
      deadT += dt;
    } else {
      animate(G.player, dt, {
        fwd: moving ? (mx * fx + mz * fz) / l : 0,
        side: moving ? (mx * rx + mz * rz) / l : 0,
        spd,
        wade: inWater,
        walk: hooks.isDrinking || false,
        shoot: (G.mouse && !P.reload && P.ammo > 0) || P.rec > 0,
        pitch: P.pitch,
        ground: P.ground,
        land: P.land,
        reload: P.reload,
        rec: P.rec,
      });
    }
  }

  return {
    fwd: moving ? (mx * fx + mz * fz) / l : 0,
    side: moving ? (mx * rx + mz * rz) / l : 0,
    spd,
    inWater,
  };
}

export function updateGameplayCamera(specTarget) {
  const P = G.P;
  const cam = G.cam;
  const AIM = G.AIM;
  const baseFov = SETTINGS.fov || 70;

  if (specTarget) {
    cam.position.set(specTarget.x + Math.sin(specTarget.yaw) * 6, specTarget.y + 4.2, specTarget.z + Math.cos(specTarget.yaw) * 6);
    cam.lookAt(specTarget.x, specTarget.y + 1.8, specTarget.z);
  } else if (G.inCar && G.carRoot && G.curCar) {
    const cc = G.curCar.spec.cam;
    const backX = Math.sin(G.V.yaw) * cc[0], backZ = Math.cos(G.V.yaw) * cc[0];
    cam.position.set(G.V.x + backX, P.y + cc[1], G.V.z + backZ);
    cam.lookAt(G.V.x - Math.sin(G.V.yaw) * cc[2], P.y + cc[3], G.V.z - Math.cos(G.V.yaw) * cc[2]);
  } else {
    cam.rotation.set(P.pitch, P.yaw, 0);
    cam.position.set(P.x, P.y + 2.2, P.z).add(
      new THREE.Vector3(1.7 - 0.75 * AIM, 1.0 - 0.3 * AIM, 4.0 - 1.7 * AIM).applyEuler(cam.rotation)
    );
  }

  const fovT = G.inCar ? Math.max(76, baseFov + 6) : baseFov - 25 * AIM;
  if (Math.abs(cam.fov - fovT) > 0.01) {
    cam.fov = fovT;
    cam.updateProjectionMatrix();
  }
  const ch = H(cam.position.x, cam.position.z) + 0.6;
  if (cam.position.y < ch) cam.position.y = ch;
}
