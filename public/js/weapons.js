// Weapons, Inventory, Water-Jet Pooling, Grenades, Shield Potions (4-stage drink choreography),
// and Real 3D Island Weapon/Loot Pickups

import { G, mulberry } from './state.js';
import { H, los, terrainRayDist, loadGLB } from './world.js';
import { AP, shHit, setShHit, hurt, makeShotgun, makeSMG, equipActorWeapon } from './player.js';
import { playShot, playReload, playHitmarker, playExplosion, playSplash, playPickup, playShieldSip, playShieldComplete } from './audio.js';

// ---------- Weapon & Inventory Definitions ----------
export const WEAPON_DEFS = {
  m16: {
    id: 'm16',
    name: 'Rifle Hydro M16',
    short: 'M16 Hydro',
    magSize: 30,
    rate: 0.1,
    reloadTime: 1.6,
    damage: 25,
    pellets: 1,
    spread: 0.012,
    jetColor: 0x58dfff,
    recoil: 0.006,
  },
  shotgun: {
    id: 'shotgun',
    name: 'Escopeta Tormenta',
    short: 'Escopeta',
    magSize: 8,
    rate: 0.65,
    reloadTime: 1.85,
    damage: 16, // x6 pellets = 96 close range
    pellets: 6,
    spread: 0.068,
    jetColor: 0x38bdf8,
    recoil: 0.024,
  },
  smg: {
    id: 'smg',
    name: 'Subfusil Glacial',
    short: 'Subfusil',
    magSize: 40,
    rate: 0.065,
    reloadTime: 1.4,
    damage: 16,
    pellets: 1,
    spread: 0.022,
    jetColor: 0x67e8f9,
    recoil: 0.0045,
  },
};

export const INVENTORY = {
  activeSlot: 0, // 0: M16, 1: Secondary weapon (null until picked up), 2: Grenades, 3: Portable Shield Cans
  slots: [
    { type: 'weapon', id: 'm16', ammo: 30 },
    null,
    { type: 'grenade', id: 'grenade', name: 'Granadas Galleta', count: 3 },
    { type: 'shield', id: 'shield', name: 'Escudo Portátil', count: 1 },
  ],
};

export function resetInventory() {
  INVENTORY.activeSlot = 0;
  INVENTORY.slots[0] = { type: 'weapon', id: 'm16', ammo: 30 };
  INVENTORY.slots[1] = null;
  INVENTORY.slots[2] = { type: 'grenade', id: 'grenade', name: 'Granadas Galleta', count: 3 };
  INVENTORY.slots[3] = { type: 'shield', id: 'shield', name: 'Escudo Portátil', count: 1 };
  G.P.ammo = 30;
  G.P.reload = 0;
  G.P.weaponId = 'm16';
  grCount = Math.min(GR_MAX, 3);
  grRegen = 0;
  if (G.player) equipActorWeapon(G.player, 'm16', G.DROP.phase !== 'landed');
}

export function getActiveWeaponDef() {
  const s = INVENTORY.slots[INVENTORY.activeSlot];
  if (s && s.type === 'weapon') return WEAPON_DEFS[s.id] || WEAPON_DEFS.m16;
  return WEAPON_DEFS[G.P.weaponId] || WEAPON_DEFS.m16;
}

export function selectSlot(idx, hooks = {}) {
  if (idx < 0 || idx >= 4) return;
  const s = INVENTORY.slots[idx];
  if (!s) return;
  if (s.type === 'shield') {
    if (s.count > 0 && G.P.sh < 100 && !drink && !G.P.dead && !G.inCar && G.DROP.phase === 'landed') {
      s.count--;
      startDrink();
    } else if (G.P.sh >= 100 && hooks.onToast) {
      hooks.onToast('Escudo ya está al 100%');
    }
    return;
  }
  if (drink) endDrink();
  if (s.type === 'grenade') {
    INVENTORY.activeSlot = idx;
    if (G.player) equipActorWeapon(G.player, G.P.weaponId, true);
    return;
  }
  if (s.type === 'weapon') {
    INVENTORY.activeSlot = idx;
    G.P.ammo = s.ammo;
    G.P.reload = 0;
    G.P.weaponId = s.id;
    if (G.player) equipActorWeapon(G.player, s.id, G.DROP.phase !== 'landed');
  }
}

// ---------- Object Pools: Water Jets, Drops, Splashes, Tracers, Shield Orbs ----------
const ray = new THREE.Raycaster();
const tracers = [];
const waterJets = [];
const waterJetPool = [];
const waterJetParticles = [];
const dropPool = [];
const waterSplashes = [];
const splashPool = [];
const shieldOrbs = [];

const waterJetGeo = new THREE.CylinderGeometry(0.008, 0.045, 1, 7, 1, true);
const waterJetDropGeo = new THREE.SphereGeometry(0.035, 7, 6);
const splashRingGeo = new THREE.TorusGeometry(0.22, 0.018, 6, 28);
const splashDropGeo = new THREE.SphereGeometry(0.035, 7, 6);
const shieldOrbGeo = new THREE.SphereGeometry(0.075, 8, 6);

function acquireJetMesh(colorHex) {
  let m = waterJetPool.pop();
  if (!m) {
    m = new THREE.Mesh(
      waterJetGeo,
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.82, depthWrite: false })
    );
  }
  m.material.color.setHex(colorHex);
  m.material.opacity = 0.82;
  m.visible = true;
  return m;
}

function acquireDropMesh(colorHex) {
  let m = dropPool.pop();
  if (!m) {
    m = new THREE.Mesh(
      waterJetDropGeo,
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.9, depthWrite: false })
    );
  }
  m.material.color.setHex(colorHex);
  m.material.opacity = 0.9;
  m.visible = true;
  return m;
}

export function waterJet(from, target, colorHex = 0x58dfff) {
  const direction = target.clone().sub(from);
  const distance = direction.length();
  if (distance < 0.05) return;
  direction.normalize();
  const length = Math.min(distance, 24);
  const end = from.clone().addScaledVector(direction, length);

  const jet = acquireJetMesh(colorHex);
  jet.position.copy(from).add(end).multiplyScalar(0.5);
  jet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  jet.scale.set(1, length, 1);
  G.scene.add(jet);
  waterJets.push({ mesh: jet, life: 0.13, maxLife: 0.13 });

  let side = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 0.001) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(side, direction).normalize();

  for (let i = 0; i < 7; i++) {
    const mesh = acquireDropMesh(i % 3 ? colorHex : 0xd9faff);
    const spread = 0.035;
    mesh.position.copy(from)
      .addScaledVector(direction, Math.random() * 0.3)
      .addScaledVector(side, (Math.random() - 0.5) * spread)
      .addScaledVector(up, (Math.random() - 0.5) * spread);
    const speed = 31 + Math.random() * 13;
    const velocity = direction.clone().multiplyScalar(speed)
      .addScaledVector(side, (Math.random() - 0.5) * 2.2)
      .addScaledVector(up, (Math.random() - 0.5) * 2.2);
    mesh.scale.setScalar(0.55 + Math.random() * 0.85);
    G.scene.add(mesh);
    waterJetParticles.push({ mesh, velocity, life: 0.28 + Math.random() * 0.13, maxLife: 0.41 });
  }
}

export function waterSplash(point) {
  let s = splashPool.pop();
  if (!s) {
    const group = new THREE.Group();
    const ringMat1 = new THREE.MeshBasicMaterial({ color: 0xd9f7ff, transparent: true, opacity: 0.9, depthWrite: false });
    const ringMat2 = new THREE.MeshBasicMaterial({ color: 0x75dfff, transparent: true, opacity: 0.75, depthWrite: false });
    const dropMat = new THREE.MeshBasicMaterial({ color: 0xbcefff, transparent: true, opacity: 0.95, depthWrite: false });
    const ring1 = new THREE.Mesh(splashRingGeo, ringMat1);
    const ring2 = new THREE.Mesh(splashRingGeo, ringMat2);
    ring1.rotation.x = ring2.rotation.x = Math.PI / 2;
    ring1.position.y = 0.012;
    ring2.position.y = 0.018;
    group.add(ring1, ring2);
    const drops = [];
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(splashDropGeo, dropMat);
      group.add(mesh);
      drops.push({ mesh, velocity: new THREE.Vector3() });
    }
    s = { group, ring1, ring2, drops, ringMat1, ringMat2, dropMat, life: 0 };
  }

  s.life = 0;
  s.group.position.set(point.x, 0.025, point.z);
  s.ring1.scale.setScalar(0.12);
  s.ring2.scale.setScalar(0.05);
  s.ringMat1.opacity = 0.9;
  s.ringMat2.opacity = 0.75;
  s.dropMat.opacity = 0.95;

  for (const drop of s.drops) {
    const a = Math.random() * Math.PI * 2;
    const speed = 0.65 + Math.random() * 1.45;
    drop.mesh.position.set(Math.cos(a) * 0.07, 0.04, Math.sin(a) * 0.07);
    drop.mesh.scale.setScalar(0.65 + Math.random() * 0.8);
    drop.velocity.set(Math.cos(a) * speed, 2.1 + Math.random() * 2.5, Math.sin(a) * speed);
  }
  G.scene.add(s.group);
  waterSplashes.push(s);

  const dist = Math.hypot(point.x - G.P.x, point.z - G.P.z);
  playSplash(dist);
}

export function tracer(a, b, c) {
  const ln = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a, b]),
    new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 1 })
  );
  ln.life = 0.08;
  G.scene.add(ln);
  tracers.push(ln);
}

function spawnShieldOrb(x, y, z, burst = false) {
  const count = burst ? 14 : 1;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = burst ? 0.35 + Math.random() * 0.75 : 0.4 + Math.random() * 0.45;
    const m = new THREE.Mesh(
      shieldOrbGeo,
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x67e8f9 : 0x38bdf8, transparent: true, opacity: 0.85, depthWrite: false })
    );
    m.position.set(x + Math.cos(a) * r, y + (burst ? 1.1 : 0.7 + Math.random() * 1.1), z + Math.sin(a) * r);
    G.scene.add(m);
    shieldOrbs.push({
      m,
      vy: burst ? 1.6 + Math.random() * 2.1 : 1.1 + Math.random() * 0.9,
      ang: a,
      r,
      life: burst ? 0.75 : 0.65,
      maxLife: burst ? 0.75 : 0.65,
    });
  }
}

export function updateEffects(dt) {
  for (let i = waterJets.length - 1; i >= 0; i--) {
    const j = waterJets[i];
    j.life -= dt;
    j.mesh.material.opacity = 0.82 * Math.max(0, j.life / j.maxLife);
    if (j.life <= 0) {
      G.scene.remove(j.mesh);
      waterJetPool.push(j.mesh);
      waterJets.splice(i, 1);
    }
  }
  for (let i = waterJetParticles.length - 1; i >= 0; i--) {
    const p = waterJetParticles[i];
    p.life -= dt;
    p.velocity.y -= 3.5 * dt;
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.mesh.material.opacity = 0.9 * Math.max(0, p.life / p.maxLife);
    p.mesh.scale.multiplyScalar(Math.max(0.1, 1 - dt * 1.5));
    if (p.life <= 0) {
      G.scene.remove(p.mesh);
      dropPool.push(p.mesh);
      waterJetParticles.splice(i, 1);
    }
  }
  for (let i = waterSplashes.length - 1; i >= 0; i--) {
    const s = waterSplashes[i];
    s.life += dt;
    const t = Math.min(1, s.life / 0.72);
    s.ring1.scale.setScalar(0.12 + t * 1.35);
    const t2 = Math.max(0, Math.min(1, (s.life - 0.07) / 0.65));
    s.ring2.scale.setScalar(0.05 + t2 * 1.05);
    s.ringMat1.opacity = 0.9 * (1 - t);
    s.ringMat2.opacity = 0.75 * (1 - t2);
    s.dropMat.opacity = 0.95 * (1 - Math.min(1, s.life / 0.62));
    for (const drop of s.drops) {
      drop.velocity.y -= 8.5 * dt;
      drop.mesh.position.addScaledVector(drop.velocity, dt);
      drop.mesh.scale.multiplyScalar(Math.max(0.1, 1 - dt * 1.5));
    }
    if (s.life > 0.78) {
      G.scene.remove(s.group);
      splashPool.push(s);
      waterSplashes.splice(i, 1);
    }
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.material.opacity = Math.max(0, t.life / 0.08);
    if (t.life <= 0) {
      G.scene.remove(t);
      t.geometry.dispose();
      t.material.dispose();
      tracers.splice(i, 1);
    }
  }
  for (let i = shieldOrbs.length - 1; i >= 0; i--) {
    const o = shieldOrbs[i];
    o.life -= dt;
    o.ang += dt * 3.5;
    o.m.position.y += o.vy * dt;
    o.m.position.x = G.P.x + Math.cos(o.ang) * o.r;
    o.m.position.z = G.P.z + Math.sin(o.ang) * o.r;
    o.m.material.opacity = Math.max(0, o.life / o.maxLife) * 0.85;
    o.m.scale.setScalar(0.5 + 0.5 * (o.life / o.maxLife));
    if (o.life <= 0) {
      G.scene.remove(o.m);
      o.m.material.dispose();
      shieldOrbs.splice(i, 1);
    }
  }
}

// ---------- Shooting & Reload ----------
export function startReload() {
  const slot = INVENTORY.slots[INVENTORY.activeSlot];
  if (!slot || slot.type !== 'weapon') return;
  const def = WEAPON_DEFS[slot.id] || WEAPON_DEFS.m16;
  if (G.P.reload <= 0 && G.P.ammo < def.magSize) {
    G.P.reload = def.reloadTime;
    playReload();
  }
}

export function shoot(hooks = {}) {
  const slot = INVENTORY.slots[INVENTORY.activeSlot];
  if (slot && slot.type === 'grenade') {
    throwGrenade(hooks);
    return;
  }
  const def = getActiveWeaponDef();
  const P = G.P;
  const cam = G.cam;

  P.ammo--;
  if (slot && slot.type === 'weapon') slot.ammo = P.ammo;
  P.fire = def.rate;
  P.rec = 1;
  P.pitch += def.recoil;
  P.yaw += (Math.random() - 0.5) * def.recoil * 0.65;

  cam.updateMatrixWorld();
  const o = cam.position.clone();
  const baseDir = new THREE.Vector3();
  cam.getWorldDirection(baseDir);

  const from = new THREE.Vector3();
  if (G.muzzle) G.muzzle.getWorldPosition(from);
  if (G.flash) {
    G.flash.color.setHex(def.jetColor);
    G.flash.intensity = def.id === 'shotgun' ? 1.85 : 1.25;
  }
  playShot(def.id, 0);

  const targets = hooks.shootTargets ? hooks.shootTargets() : [];
  let anyHit = false;
  let anyKill = false;

  for (let p = 0; p < def.pellets; p++) {
    const d = baseDir.clone();
    const spr = def.spread * (1 - 0.72 * G.AIM);
    d.x += (Math.random() - 0.5) * spr;
    d.y += (Math.random() - 0.5) * spr;
    d.z += (Math.random() - 0.5) * spr;
    d.normalize();

    let dist = terrainRayDist(o, d, 250);
    let waterHit = false;
    if (Math.abs(d.y) > 0.00001) {
      const waterDist = -o.y / d.y;
      if (waterDist > 0 && waterDist < dist) {
        const wp = o.clone().addScaledVector(d, waterDist);
        if (H(wp.x, wp.z) < 0) {
          dist = waterDist;
          waterHit = true;
        }
      }
    }

    ray.set(o, d);
    ray.far = dist;
    const hit = ray.intersectObjects(targets, false)[0];
    let hitBot = null, hitVeh = null;
    if (hit) {
      dist = hit.distance;
      hitBot = hit.object.userData.root || null;
      hitVeh = hit.object.userData.veh || null;
      waterHit = false;
    }

    const end = o.clone().addScaledVector(d, dist);
    waterJet(from, end, def.jetColor);
    if (waterHit) waterSplash(end);
    if (hitVeh && hooks.onVehHit) hooks.onVehHit(hitVeh, def.damage);

    if (G.ONLINE && hooks.onNetShot) {
      hooks.onNetShot(end, waterHit, hitBot, def.damage);
      if (hitBot && hitBot.visible) anyHit = true;
    } else if (hitBot && hitBot.visible) {
      anyHit = true;
      P.damageDealt += def.damage;
      hitBot.userData.hp -= def.damage;
      if (hitBot.userData.mat) {
        hitBot.userData.mat.emissive.setHex(0x884422);
        setTimeout(() => { if (hitBot.userData.mat) hitBot.userData.mat.emissive.setHex(0); }, 70);
      }
      if (hitBot.userData.hp <= 0 && !hitBot.userData.dead) {
        anyKill = true;
        hitBot.userData.dead = true;
        hitBot.userData.t = 0;
        P.kills++;
        if (!P.dead) P.hp = Math.min(100, P.hp + 50);
        if (hooks.onBotKilled) hooks.onBotKilled(hitBot);
      }
    }
  }

  if (anyHit) {
    playHitmarker(anyKill);
    if (hooks.onHitmarker) hooks.onHitmarker(anyKill);
  }
}

// ---------- Shield Potions (4-stage fluid Fortnite-grade drink choreography) ----------
const POT_N = 14;
const POT_SH = 50;
export const POT_RESPAWN = 25;
let canProto = null;
let heldCan = null;
export let drink = null;
let toastT = 0;

export function getDrinkProgress() {
  if (!drink) return null;
  return {
    active: true,
    pct: Math.min(100, Math.round((drink.t / DK.D) * 100)),
    t: drink.t,
    total: DK.D,
  };
}

const bubble = new THREE.Mesh(
  new THREE.SphereGeometry(1.5, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0x4fc3ff, transparent: true, opacity: 0.14, depthWrite: false })
);
bubble.visible = false;

const DK = {
  D: 2.6,
  ra: [1.32, -0.44, -0.62],
  fa: [1.06, -0.52, -1.26],
  rb: [1.62, -0.56, -0.66],
  fb: [1.66, 0.28, -1.14],
  la: [0.42, 0.22, 0.38],
  lfa: [-0.75, 0.3, 0.25],
  head: [-0.36, 0, 0],
  neck: [-0.18, 0, 0],
  spine: [-0.10, 0, 0],
  tilt: 0.85,
  cy: 0,
  co: 0.02,
  h: 0.34,
};
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q2 = new THREE.Quaternion(), _ax = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _rq = new THREE.Quaternion();
let _qrCache = null;

function restQ(B, name, k, e) {
  const i = AP.names.indexOf(name);
  const idx = i * 4;
  if (!_qrCache) {
    const bin = atob(AP.Q), u8 = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j);
    _qrCache = new Float32Array(u8.buffer);
  }
  _rq.set(_qrCache[idx], _qrCache[idx + 1], _qrCache[idx + 2], _qrCache[idx + 3]);
  if (e) { _e.set(e[0], e[1], e[2], 'XYZ'); _rq.multiply(_q.setFromEuler(_e)); }
  B[name].quaternion.slerp(_rq, k);
}

function drinkPose(w, tl, t) {
  const B = G.player.userData.bn;
  for (const n of ['LeftShoulder', 'RightShoulder', 'LeftHand', 'RightHand']) restQ(B, n, w);

  // Subtle sip pulse while tilting can at lips
  const sipPulse = tl > 0.4 ? Math.sin(t * 7.5) * 0.07 * tl : 0;
  const mix = (a, b) => a.map((x, i) => x + (b[i] - x) * tl);
  const ra = mix(DK.ra, DK.rb);
  const fa = mix(DK.fa, DK.fb);
  fa[0] += sipPulse;

  restQ(B, 'RightArm', w, ra);
  restQ(B, 'RightForeArm', w, fa);

  // Natural left arm balance gesture near chest/waist
  restQ(B, 'LeftArm', w * 0.9, DK.la);
  restQ(B, 'LeftForeArm', w * 0.9, DK.lfa);

  const rot = (n, e, k) => {
    _e.set(e[0] * k, e[1] * k, e[2] * k, 'XYZ');
    _q.setFromEuler(_e);
    B[n].quaternion.multiply(_q);
  };
  rot('Spine1', DK.spine, tl + sipPulse * 0.5);
  rot('Neck', DK.neck, tl);
  rot('Head', DK.head, tl + sipPulse * 0.4);

  G.player.updateMatrixWorld(true);
  const hd = B.RightHand;
  hd.getWorldPosition(_v1);
  B.RightHandMiddle1.getWorldPosition(_v2);
  _v1.add(_v2).multiplyScalar(0.5);

  const yw = G.P.yaw - 0.48;
  _ax.set(Math.cos(yw), 0, -Math.sin(yw));
  _q.setFromAxisAngle(_ax, (DK.tilt + sipPulse * 0.8) * tl);
  _q2.setFromAxisAngle(_up, G.P.yaw + DK.cy);
  _q.multiply(_q2);
  _up.set(0, 1, 0);
  _v2.copy(_up).applyQuaternion(_q).multiplyScalar(DK.co);
  _v1.add(_v2);

  hd.getWorldQuaternion(_q2).invert();
  heldCan.quaternion.copy(_q2.multiply(_q));
  heldCan.position.copy(hd.worldToLocal(_v1));
  // Smooth draw-in scale during first 0.25s and put-away scale during final 0.25s
  const scaleIn = Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (DK.D - t) / 0.25));
  heldCan.scale.setScalar((DK.h / 1.15) * (0.2 + 0.8 * scaleIn));
}

function mkCan() {
  const c = canProto.clone(true);
  c.traverse(m => { if (m.isMesh) m.material = canProto.userData.mats[m.userData.mi]; });
  return c;
}

function potSpot(near, RNG) {
  const R = 170;
  for (let n = 0; n < 300; n++) {
    let x, z;
    if (near) {
      const a = RNG() * 6.28, r = 8 + RNG() * 22;
      x = G.SPAWN[0] + Math.cos(a) * r;
      z = G.SPAWN[1] + Math.sin(a) * r;
    } else {
      x = (RNG() - 0.5) * R * 1.7;
      z = (RNG() - 0.5) * R * 1.7;
    }
    const h = H(x, z);
    if (h > 2 && Math.hypot(x, z) < R * 0.95) return [x, h, z];
  }
  return null;
}

export function placePot(p, near) {
  let RNG = Math.random;
  if (G.ONLINE) {
    p.gen = (p.gen || 0) + 1;
    RNG = mulberry(G.NET.seed + G.POT.indexOf(p) * 7919 + p.gen * 104729);
  }
  const s = potSpot(near, RNG);
  if (s) {
    p.pos.set(s[0], s[1], s[2]);
    p.on = true;
    p.wait = 0;
    p.root.visible = true;
  } else {
    p.on = false;
    p.wait = -1;
    p.root.visible = false;
  }
}

export function startDrink() {
  if (drink || G.P.dead || G.inCar || G.DROP.phase !== 'landed' || !heldCan) return;
  drink = { t: 0, given: false, sip1: false, sip2: false, orbT: 0 };
}

export function endDrink() {
  drink = null;
  if (heldCan && heldCan.parent) heldCan.parent.remove(heldCan);
  if (heldCan) heldCan.visible = false;
  const activeSlot = INVENTORY.slots[INVENTORY.activeSlot];
  const hideGun = !activeSlot || activeSlot.type !== 'weapon' || G.P.dead || G.inCar || G.DROP.phase !== 'landed';
  if (G.player) equipActorWeapon(G.player, G.P.weaponId, hideGun);
}

export function potionsUpdate(dt, hooks = {}) {
  const P = G.P;
  bubble.visible = P.sh > 0 && !P.dead && !G.MENU_OPEN;
  if (bubble.visible) {
    bubble.position.set(P.x, P.y + 1.4, P.z);
    const s = 1 + Math.sin(performance.now() / 260) * 0.02 + shHit * 0.25;
    bubble.scale.set(s, s * 1.15, s);
    bubble.material.opacity = 0.1 + 0.1 * (P.sh / 100) + shHit * 0.85;
  }
  setShHit(Math.max(0, shHit - dt));
  if (!canProto || G.MENU_OPEN || G.DROP.phase !== 'landed') return;

  for (const p of G.POT) {
    if (!p.on) {
      p.wait -= dt;
      if (p.wait <= 0 && p.wait !== -1) placePot(p, false);
      continue;
    }
    p.t += dt;
    p.can.rotation.y = p.t * 1.6;
    p.can.position.y = 0.95 + Math.sin(p.t * 2.2) * 0.12;
    p.ring.scale.setScalar(1 + Math.sin(p.t * 3) * 0.08);
    if (!drink && !P.dead && !G.inCar && Math.hypot(P.x - p.pos.x, P.z - p.pos.z) < 1.8 && Math.abs(P.y - p.pos.y) < 2.5) {
      if (P.sh >= 100) {
        const shSlot = INVENTORY.slots[3];
        if (shSlot && shSlot.count < 3) {
          p.on = false; p.root.visible = false; p.wait = POT_RESPAWN;
          shSlot.count++;
          playPickup();
          if (hooks.onToast) hooks.onToast('+1 Escudo guardado en ranura 4');
          if (G.ONLINE && hooks.onNetPot) hooks.onNetPot(G.POT.indexOf(p));
        } else if (toastT <= 0 && hooks.onToast) {
          toastT = 1.8;
          hooks.onToast('Escudo al máximo');
        }
      } else {
        p.on = false; p.root.visible = false; p.wait = POT_RESPAWN;
        startDrink();
        if (G.ONLINE && hooks.onNetPot) hooks.onNetPot(G.POT.indexOf(p));
      }
    }
  }
  if (toastT > 0) toastT -= dt;

  if (drink && (P.dead || G.inCar)) endDrink();
  if (drink) {
    drink.t += dt;
    const t = drink.t, D = DK.D;
    const ss = (a, b, x) => {
      x = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return x * x * (3 - 2 * x);
    };
    // Smooth draw (0..0.45), hold & sip (0.45..1.95), smooth recovery (1.95..2.6)
    const w = ss(0, 0.48, t) * (1 - ss(D - 0.55, D, t));
    const tl = ss(0.42, 0.85, t) * (1 - ss(D - 0.85, D - 0.45, t));

    if (!heldCan.parent || heldCan.parent !== G.player.userData.bn.RightHand) {
      G.player.userData.bn.RightHand.add(heldCan);
      heldCan.visible = true;
      equipActorWeapon(G.player, G.P.weaponId, true);
    }
    drinkPose(w, tl, t);

    // Subtle rising shield energy orbs & sip sound effects
    drink.orbT += dt;
    if (t > 0.45 && t < 2.0 && drink.orbT >= 0.14) {
      drink.orbT = 0;
      spawnShieldOrb(P.x, P.y, P.z, false);
    }
    if (!drink.sip1 && t > 0.78) {
      drink.sip1 = true;
      playShieldSip();
    }
    if (!drink.sip2 && t > 1.32) {
      drink.sip2 = true;
      playShieldSip();
    }

    if (!drink.given && t >= 1.85) {
      drink.given = true;
      P.sh = Math.min(100, P.sh + POT_SH);
      setShHit(0.65);
      playShieldComplete();
      spawnShieldOrb(P.x, P.y, P.z, true);
      if (hooks.onToast) hooks.onToast('+' + POT_SH + ' Escudo activado');
    }
    if (t >= D) endDrink();
  }
}

// ---------- Real 3D Island Weapon & Supply Pickups ----------
export function spawnLootDrops(seed) {
  for (const l of G.loots) G.scene.remove(l.mesh);
  G.loots.length = 0;

  const rnd = mulberry((seed ^ 0x4A21) | 0);
  const items = [
    { kind: 'weapon', id: 'shotgun', label: 'Escopeta Tormenta', color: 0x38bdf8 },
    { kind: 'weapon', id: 'smg', label: 'Subfusil Glacial', color: 0x22d3ee },
    { kind: 'weapon', id: 'shotgun', label: 'Escopeta Tormenta', color: 0x38bdf8 },
    { kind: 'weapon', id: 'smg', label: 'Subfusil Glacial', color: 0x22d3ee },
    { kind: 'grenade', id: 'grenade', label: '+2 Granadas Galleta', color: 0xf59e0b },
    { kind: 'grenade', id: 'grenade', label: '+2 Granadas Galleta', color: 0xf59e0b },
  ];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let x = 0, z = 0, h = -1;
    for (let t = 0; t < 120; t++) {
      const a = (i / items.length) * Math.PI * 2 + rnd() * 0.65;
      const r = 24 + rnd() * 115;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      h = H(x, z);
      if (h > 2 && h < 28) break;
    }
    if (h <= 1) continue;

    const grp = new THREE.Group();
    grp.position.set(x, h, z);

    // Real 3D weapon/item model hovering above glowing pedestal
    let propModel;
    if (item.id === 'shotgun') {
      propModel = makeShotgun();
      propModel.scale.setScalar(1.38);
      propModel.rotation.z = 0.14;
    } else if (item.id === 'smg') {
      propModel = makeSMG();
      propModel.scale.setScalar(1.42);
      propModel.rotation.z = 0.14;
    } else {
      propModel = grProto ? grProto.clone(true) : new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8));
      propModel.scale.setScalar(1.1);
    }
    propModel.position.y = 0.92;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.92, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: item.color, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.position.y = 0.08;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 13, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: item.color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
    );
    beam.position.y = 6.5;

    grp.add(propModel, ring, beam);
    G.scene.add(grp);
    G.loots.push({ ...item, x, y: h, z, mesh: grp, box: propModel, active: true, t: i });
  }
}

export function updateLoots(dt, hooks = {}) {
  if (G.MENU_OPEN || G.P.dead || G.DROP.phase !== 'landed') return;
  for (const l of G.loots) {
    if (!l.active) continue;
    l.t += dt;
    l.box.rotation.y = l.t * 1.45;
    l.box.position.y = 0.92 + Math.sin(l.t * 2.5) * 0.14;
    if (!G.inCar && Math.hypot(G.P.x - l.x, G.P.z - l.z) < 2.1 && Math.abs(G.P.y - l.y) < 2.5) {
      l.active = false;
      l.mesh.visible = false;
      playPickup();
      if (l.kind === 'weapon') {
        const def = WEAPON_DEFS[l.id];
        INVENTORY.slots[1] = { type: 'weapon', id: l.id, ammo: def.magSize };
        INVENTORY.activeSlot = 1;
        G.P.ammo = def.magSize;
        G.P.reload = 0;
        G.P.weaponId = l.id;
        if (G.player) equipActorWeapon(G.player, l.id, false);
        if (hooks.onToast) hooks.onToast('Equipado: ' + l.label);
      } else if (l.kind === 'grenade') {
        grCount = Math.min(GR_MAX, grCount + 2);
        INVENTORY.slots[2].count = grCount;
        if (hooks.onToast) hooks.onToast(l.label);
      }
    }
  }
}

// ---------- Grenades (Cookie Bag GLB) ----------
export const GR_MAX = 10;
export const GR_REGEN = 12;
export const GR_FUSE = 2.5;
export const GR_R = 12;
export const GR_DMG = 140;
export const GR_SPEED = 21;
export const GR_SIZE = 1.1;

export let grProto = null;
export let grCount = 3;
export let grRegen = 0;
export let grCool = 0;
let shake = 0;
let boomI = 0;

const booms = [];
const UPV = new THREE.Vector3(0, 1, 0);
const boomLight = new THREE.PointLight(0xffa040, 0, 50);
const BG = new THREE.SphereGeometry(1, 16, 12);
const CG = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const RG = new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2);
const crumbM = [
  new THREE.MeshLambertMaterial({ color: 0xc98a4b }),
  new THREE.MeshLambertMaterial({ color: 0x6b4423 }),
];

export function throwGrenade(hooks = {}) {
  const P = G.P;
  if (G.MENU_OPEN || !grProto || grCount <= 0 || grCool > 0 || P.dead || drink || G.inCar || G.DROP.phase !== 'landed') return;
  grCount--;
  if (INVENTORY.slots[2]) INVENTORY.slots[2].count = grCount;
  grCool = 0.6;
  G.cam.updateMatrixWorld();
  const d = new THREE.Vector3();
  G.cam.getWorldDirection(d);
  const o = new THREE.Vector3(
    P.x - Math.sin(P.yaw) * 0.8 + Math.cos(P.yaw) * 0.4,
    P.y + 1.9,
    P.z - Math.cos(P.yaw) * 0.8 - Math.sin(P.yaw) * 0.4
  );
  const m = grProto.clone(true);
  m.position.copy(o);
  G.scene.add(m);
  const v0 = d.clone().multiplyScalar(GR_SPEED).add(new THREE.Vector3(0, 4.5, 0));
  if (G.ONLINE && hooks.onNetGrenade) hooks.onNetGrenade(o, v0);
  G.grens.push({
    m,
    v: v0,
    w: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16),
    t: 0,
    rest: false,
    own: true,
  });
}

export function spawnRemoteGrenade(oArr, vArr, ownerId) {
  if (!grProto) return;
  const mm = grProto.clone(true);
  mm.position.fromArray(oArr);
  G.scene.add(mm);
  G.grens.push({
    m: mm,
    v: new THREE.Vector3().fromArray(vArr),
    w: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16),
    t: 0,
    rest: false,
    own: false,
    owner: ownerId,
  });
}

function gNormal(x, z) {
  const e = 0.5;
  return new THREE.Vector3(-(H(x + e, z) - H(x - e, z)), 2 * e, -(H(x, z + e) - H(x, z - e))).normalize();
}

export function boomFx(p, dp) {
  const mk = (c, o) => new THREE.Mesh(BG, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false }));
  const fb = mk(0xffa52e, 0.9), core = mk(0xfff2b0, 1);
  const ring = new THREE.Mesh(RG, new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  const grp = new THREE.Group();
  grp.position.copy(p);
  grp.add(fb, core, ring);
  G.scene.add(grp);

  const bits = [];
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(CG, crumbM[i % 3 ? 0 : 1]);
    const a = Math.random() * 6.28, s = 4 + Math.random() * 9;
    m.position.copy(p);
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    G.scene.add(m);
    bits.push({ m, v: new THREE.Vector3(Math.cos(a) * s, 5 + Math.random() * 9, Math.sin(a) * s) });
  }
  booms.push({ grp, fb, core, ring, bits, t: 0 });
  boomLight.position.set(p.x, p.y + 1.5, p.z);
  boomI = 14;
  shake = Math.max(shake, Math.max(0, 1 - dp / 50) * 1.4);
  playExplosion(dp);
}

function explode(g, hooks = {}) {
  const p = g.m.position.clone();
  G.scene.remove(g.m);

  let hitAny = false;
  let killedAny = false;

  for (const h of G.bots) {
    const b = h.userData.root;
    if (b.userData.dead) continue;
    const d = Math.hypot(b.position.x - p.x, b.position.y + 1.2 - p.y, b.position.z - p.z);
    if (d < GR_R && los(p.x, p.y + 0.8, p.z, b.position.x, b.position.y + 1.2, b.position.z)) {
      const dm = Math.round(GR_DMG * (1 - d / GR_R));
      if (!G.ONLINE) {
        hitAny = true;
        G.P.damageDealt += dm;
        b.userData.hp -= dm;
        if (b.userData.hp <= 0 && !b.userData.dead) {
          killedAny = true;
          b.userData.dead = true;
          b.userData.t = 0;
          G.P.kills++;
          if (!G.P.dead) G.P.hp = Math.min(100, G.P.hp + 50);
          if (hooks.onBotKilled) hooks.onBotKilled(b);
        }
      } else if (g.own && hooks.onNetBotExplode) {
        hitAny = true;
        hooks.onNetBotExplode(b.userData.bi, dm);
      }
    }
  }

  if (hitAny) {
    playHitmarker(killedAny);
    if (hooks.onHitmarker) hooks.onHitmarker(killedAny);
  }

  const P = G.P;
  const dp = Math.hypot(P.x - p.x, P.y + 1 - p.y, P.z - p.z);
  if (dp < GR_R && !P.dead && !(G.inCar && G.curCar && G.curCar.idx < 4) && los(p.x, p.y + 0.8, p.z, P.x, P.y + 1, P.z)) {
    hurt(Math.round(70 * (1 - dp / GR_R)), g.own ? -1 : g.owner, false, hooks);
  }
  if (g.own && hooks.onVehHit) {
    for (const c of G.CARS) {
      if (!c || c.dead) continue;
      const dv = Math.hypot(c.root.position.x - p.x, c.root.position.y + 1 - p.y, c.root.position.z - p.z);
      if (dv < GR_R + 2.5) hooks.onVehHit(c, Math.round(GR_DMG * 1.4 * (1 - Math.min(1, dv / (GR_R + 2.5)))));
    }
  }
  boomFx(p, dp);
}

export function grenadesUpdate(dt, hooks = {}) {
  grCool = Math.max(0, grCool - dt);
  if (grCount < GR_MAX) {
    grRegen += dt;
    if (grRegen >= GR_REGEN) {
      grRegen = 0;
      grCount++;
    }
  } else {
    grRegen = 0;
  }
  if (INVENTORY.slots[2]) INVENTORY.slots[2].count = grCount;

  for (let i = G.grens.length - 1; i >= 0; i--) {
    const g = G.grens[i], p = g.m.position;
    g.t += dt;
    if (!g.rest) {
      g.v.y -= 20 * dt;
      p.addScaledVector(g.v, dt);
      const h = H(p.x, p.z), gy = Math.max(h, 0) + GR_SIZE * 0.45;
      if (p.y < gy) {
        p.y = gy;
        const n = h < 0 ? UPV : gNormal(p.x, p.z), vn = g.v.dot(n);
        if (vn < 0) {
          g.v.addScaledVector(n, -1.4 * vn);
          g.v.x *= 0.72;
          g.v.z *= 0.72;
          g.w.multiplyScalar(0.6);
          if (g.v.length() < 2.2) { g.v.set(0, 0, 0); g.rest = true; }
        }
      }
      g.m.rotation.x += g.w.x * dt;
      g.m.rotation.y += g.w.y * dt;
      g.m.rotation.z += g.w.z * dt;
    }
    const left = GR_FUSE - g.t;
    g.m.scale.setScalar(left < 1 ? 1 + 0.14 * Math.sin(g.t * 26) : 1);
    if (left <= 0) {
      G.grens.splice(i, 1);
      explode(g, hooks);
    }
  }

  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i];
    b.t += dt;
    const k = Math.min(1, b.t / 0.55), e = 1 - Math.pow(1 - k, 3);
    b.fb.scale.setScalar(Math.max(0.01, GR_R * 0.5 * e));
    b.fb.material.opacity = 0.9 * (1 - k);
    b.core.scale.setScalar(Math.max(0.01, GR_R * 0.3 * e));
    b.core.material.opacity = Math.pow(1 - k, 2);
    b.ring.scale.setScalar(Math.max(0.01, GR_R * 1.1 * e));
    b.ring.position.y = 0.15;
    b.ring.material.opacity = 0.7 * (1 - k);
    for (const c of b.bits) {
      c.v.y -= 18 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += dt * 9;
      const gy = Math.max(H(c.m.position.x, c.m.position.z), 0);
      if (c.m.position.y < gy) { c.m.position.y = gy; c.v.set(0, 0, 0); }
      c.m.scale.setScalar(Math.max(0.01, 1 - Math.max(0, b.t - 0.8) / 0.8));
    }
    if (b.t > 1.6) {
      G.scene.remove(b.grp);
      b.fb.material.dispose();
      b.core.material.dispose();
      b.ring.material.dispose();
      b.bits.forEach(c => G.scene.remove(c.m));
      booms.splice(i, 1);
    }
  }
  boomI = Math.max(0, boomI - dt * 30);
  boomLight.intensity = boomI;
  if (shake > 0) {
    G.cam.position.x += (Math.random() - 0.5) * shake;
    G.cam.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 3);
  }
}

// ---------- Victory Confetti Particles ----------
const victorySparks = [];
export function spawnVictoryFx(center) {
  const colors = [0xffd84a, 0x38bdf8, 0x4ade80, 0xf472b6, 0xffffff];
  for (let i = 0; i < 85; i++) {
    const m = new THREE.Mesh(CG, new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
    m.position.set(center.x + (Math.random() - 0.5) * 2.2, center.y + 1.5, center.z + (Math.random() - 0.5) * 2.2);
    const a = Math.random() * Math.PI * 2;
    const sp = 2.5 + Math.random() * 6.5;
    G.scene.add(m);
    victorySparks.push({
      m,
      v: new THREE.Vector3(Math.cos(a) * sp, 7 + Math.random() * 8, Math.sin(a) * sp),
      life: 4.0 + Math.random() * 1.5,
    });
  }
}

export function updateVictoryFx(dt) {
  for (let i = victorySparks.length - 1; i >= 0; i--) {
    const s = victorySparks[i];
    s.life -= dt;
    s.v.y -= 9.8 * dt;
    s.m.position.addScaledVector(s.v, dt);
    s.m.rotation.x += dt * 7;
    s.m.rotation.y += dt * 5;
    if (s.life <= 0) {
      G.scene.remove(s.m);
      s.m.material.dispose();
      victorySparks.splice(i, 1);
    }
  }
}

export async function initWeaponsAndPickups(reportProgress) {
  G.scene.add(bubble);
  G.scene.add(boomLight);

  const [shieldGltf, grenadeGltf] = await Promise.all([
    loadGLB('/assets/models/shield.glb'),
    loadGLB('/assets/models/grenade.glb'),
  ]);

  // Init Shield Potions
  {
    const raw = shieldGltf.scene;
    raw.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(raw), sz = box.getSize(new THREE.Vector3()), ct = box.getCenter(new THREE.Vector3());
    const mats = [], S = 1.15 / sz.y;
    raw.traverse(m => {
      if (!m.isMesh) return;
      const o = m.material;
      if (o.map) { o.map.encoding = THREE.LinearEncoding; o.map.anisotropy = 4; o.map.needsUpdate = true; }
      const nm = new THREE.MeshPhongMaterial({
        map: o.map, normalMap: o.normalMap,
        emissive: 0xffffff, emissiveMap: o.map, emissiveIntensity: 0.55,
        specular: 0x666666, shininess: 70, side: THREE.DoubleSide,
      });
      m.userData.mi = mats.length;
      mats.push(nm);
      m.material = nm;
    });
    raw.position.set(-ct.x, -ct.y, -ct.z);
    const piv = new THREE.Group();
    piv.add(raw);
    piv.scale.setScalar(S);
    piv.userData.mats = mats;
    canProto = new THREE.Group();
    canProto.add(piv);
    canProto.userData.mats = mats;

    for (let i = 0; i < POT_N; i++) {
      const root = new THREE.Group(), can = mkCan();
      can.position.y = 0.9;
      root.add(can);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.8, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x4fc3ff, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.position.y = 0.08;
      root.add(ring);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 16, 12, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
      );
      beam.position.y = 8;
      root.add(beam);
      const p = { root, can, ring, pos: root.position, on: false, t: Math.random() * 6, wait: 0 };
      G.scene.add(root);
      G.POT.push(p);
      placePot(p, i < 3);
    }
    heldCan = mkCan();
    heldCan.visible = false;
    G.scene.add(heldCan);
  }

  // Init Grenades
  {
    const raw = grenadeGltf.scene;
    raw.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(raw), sz = box.getSize(new THREE.Vector3()), ct = box.getCenter(new THREE.Vector3());
    raw.traverse(m => {
      if (!m.isMesh) return;
      const o = m.material;
      if (o.map) { o.map.encoding = THREE.LinearEncoding; o.map.anisotropy = 4; o.map.needsUpdate = true; }
      m.material = new THREE.MeshPhongMaterial({
        map: o.map, normalMap: o.normalMap, specular: 0x333333, shininess: 25, side: THREE.DoubleSide,
      });
    });
    raw.position.set(-ct.x, -ct.y, -ct.z);
    const piv = new THREE.Group();
    piv.add(raw);
    piv.scale.setScalar(GR_SIZE / sz.y);
    grProto = new THREE.Group();
    grProto.add(piv);
  }

  reportProgress(0.72, 'Armas 3D, granadas y escudos listos…');
}
