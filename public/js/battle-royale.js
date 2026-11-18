// Battle Royale module: Battle Bus 3D model, Skydiving & Parachute drop mechanics,
// 6-phase Storm Circle, Victory/Defeat triggers, and Redesigned 512px Tactical Map & Minimap.

import { G, R, mulberry, wrap, SETTINGS } from './state.js';
import { H, Hterr, biome, ROAD, DECK } from './world.js';
import { hurt, deadT, animSkydive, animGlide, equipActorWeapon } from './player.js';
import { VEH_ICON } from './vehicles.js';
import { spawnVictoryFx, endDrink } from './weapons.js';
import { playVictoryFanfare, playGliderOpen, updateWindSound } from './audio.js';

export const BR_FASES = [
  { w: 60, s: 45, r: 110, d: 1 },
  { w: 45, s: 40, r: 65, d: 2 },
  { w: 40, s: 35, r: 35, d: 4 },
  { w: 30, s: 30, r: 16, d: 6 },
  { w: 25, s: 25, r: 6, d: 8 },
  { w: 15, s: 20, r: 0, d: 10 },
];

export const MAP_POIS = [
  { name: 'Volcán Caldera', x: 6, z: 59, color: '#fb923c' },
  { name: 'Circuito Este', x: 245, z: -12, color: '#facc15' },
  { name: 'Picos Nevados', x: -85, z: -72, color: '#e0f2fe' },
  { name: 'Dunas del Sur', x: -72, z: 86, color: '#fcd34d' },
  { name: 'Bosque Central', x: 56, z: -54, color: '#86efac' },
  { name: 'Bahía Dorada', x: -124, z: 10, color: '#7dd3fc' },
];

const stormWall = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 160, 72, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x8f3dff, transparent: true, opacity: 0.27, side: THREE.DoubleSide, depthWrite: false })
);
stormWall.frustumCulled = false;
stormWall.visible = false;

const nextWall = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 70, 72, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
);
nextWall.frustumCulled = false;
nextWall.visible = false;

let battleBus = null;
let busFlame = null;
let busBurner = null;
let specI = 0;
let specPrev = false;
let minimapBase = null;

// ---------- Composite 3D Flying Battle Bus (10 parts) ----------
function buildBattleBus() {
  const grp = new THREE.Group();
  const hullMat = new THREE.MeshPhongMaterial({ color: 0x0284c7, specular: 0xbae6fd, shininess: 65 });
  const trimMat = new THREE.MeshPhongMaterial({ color: 0xfacc15, emissive: 0x854d0e, emissiveIntensity: 0.2, specular: 0xffffff, shininess: 75 });
  const darkMat = new THREE.MeshPhongMaterial({ color: 0x0f172a, specular: 0x475569, shininess: 40 });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x7dd3fc, emissive: 0x0369a1, emissiveIntensity: 0.35, specular: 0xffffff, shininess: 95 });
  const balloonMat = new THREE.MeshPhongMaterial({ color: 0x0ea5e9, specular: 0xe0f2fe, shininess: 35 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.88 });

  // 1. Armored Bus Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.7, 9.6), hullMat);
  body.position.set(0, 0, 0);
  // 2. Gold Roof & Skirt Trim
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.32, 0.34, 9.8), trimMat);
  roof.position.set(0, 1.4, 0);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(3.45, 0.6, 0.7), trimMat);
  bumper.position.set(0, -1.0, -4.95);
  // 3. Panoramic Windshield & Side Windows (-Z front)
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.85, 1.1, 0.16), glassMat);
  windshield.position.set(0, 0.45, -4.82);
  const sideWinL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.85, 7.2), glassMat);
  sideWinL.position.set(-1.6, 0.45, 0.2);
  const sideWinR = sideWinL.clone();
  sideWinR.position.x = 1.6;
  // 4. Side Aero-Wings / Stabilizers
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 2.2), trimMat);
  wingL.position.set(-2.7, -0.3, 0.8);
  wingL.rotation.z = 0.08;
  const wingR = wingL.clone();
  wingR.position.x = 2.7;
  wingR.rotation.z = -0.08;
  // 5. Twin Rear Jet Turbines (+Z rear)
  const engGeo = new THREE.CylinderGeometry(0.55, 0.65, 2.0, 12).rotateX(Math.PI / 2);
  const engL = new THREE.Mesh(engGeo, darkMat);
  engL.position.set(-1.1, -0.4, 5.1);
  const engR = engL.clone();
  engR.position.x = 1.1;

  busFlame = new THREE.Group();
  const coneGeo = new THREE.ConeGeometry(0.45, 2.8, 10).rotateX(Math.PI / 2);
  const flL = new THREE.Mesh(coneGeo, flameMat);
  flL.position.set(-1.1, -0.4, 7.2);
  const flR = flL.clone();
  flR.position.x = 1.1;
  busFlame.add(flL, flR);

  // 6. Hot-Air / Aero-Balloon Envelope Overhead
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(3.8, 20, 14), balloonMat);
  balloon.scale.set(1.0, 1.18, 1.55);
  balloon.position.set(0, 7.2, 0.2);
  const balloonStripe = new THREE.Mesh(new THREE.TorusGeometry(3.75, 0.24, 10, 28).rotateX(Math.PI / 2), trimMat);
  balloonStripe.scale.set(1.0, 1.52, 1.0);
  balloonStripe.position.set(0, 7.2, 0.2);

  // 7. Suspension Struts & Burner Flame
  for (const sx of [-1.2, 1.2]) {
    for (const sz of [-2.2, 2.2]) {
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.8, 6), darkMat);
      cable.position.set(sx * 1.1, 3.2, sz);
      grp.add(cable);
    }
  }
  busBurner = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.5, 10), flameMat);
  busBurner.position.set(0, 2.4, 0.2);

  [body, roof, bumper, windshield, sideWinL, sideWinR, wingL, wingR, engL, engR, balloon, balloonStripe].forEach(m => {
    m.castShadow = true;
    grp.add(m);
  });
  grp.add(busFlame, busBurner);

  // Beacon light
  const beacon = new THREE.PointLight(0x38bdf8, 1.8, 35);
  beacon.position.set(0, -1.8, 0);
  grp.add(beacon);

  grp.scale.setScalar(1.15);
  grp.visible = false;
  return grp;
}

export function initBattleRoyale() {
  G.scene.add(stormWall, nextWall);
  battleBus = buildBattleBus();
  G.scene.add(battleBus);
  buildMinimapTerrainCache();
}

export const brTime = () => (performance.now() - G.BR.t0) / 1000 + G.BR.off;
export const fmtT = s => {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

export function brBuild(seed) {
  const rnd = mulberry((seed ^ 0x5709) | 0);
  const Z = [{ x: 0, z: 0, r: R + 5 }];
  for (const f of BR_FASES) {
    const p = Z[Z.length - 1];
    let best = null;
    for (let i = 0; i < 40; i++) {
      const a = rnd() * 2 * Math.PI;
      const d = Math.sqrt(rnd()) * Math.max(0, p.r - f.r) * 0.9;
      best = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d, r: f.r };
      if (Hterr(best.x, best.z) > 2) break;
    }
    Z.push(best);
  }
  return Z;
}

export function brZone(t) {
  if (t === undefined) t = brTime();
  const Z = G.BR.Z;
  if (!Z || !Z.length) return { ph: 1, st: 0, left: 60, x: 0, z: 0, r: R + 5, tx: 0, tz: 0, tr: 110, d: 1 };
  let t0 = 0;
  for (let i = 0; i < BR_FASES.length; i++) {
    const f = BR_FASES[i], a = Z[i], b = Z[i + 1];
    if (t < t0 + f.w) return { ph: i + 1, st: 0, left: t0 + f.w - t, x: a.x, z: a.z, r: a.r, tx: b.x, tz: b.z, tr: b.r, d: f.d };
    if (t < t0 + f.w + f.s) {
      const k = (t - t0 - f.w) / f.s;
      return { ph: i + 1, st: 1, left: t0 + f.w + f.s - t, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, r: a.r + (b.r - a.r) * k, tx: b.x, tz: b.z, tr: b.r, d: f.d };
    }
    t0 += f.w + f.s;
  }
  const e = Z[Z.length - 1];
  return { ph: BR_FASES.length, st: 2, left: 0, x: e.x, z: e.z, r: e.r, tx: e.x, tz: e.z, tr: e.r, d: BR_FASES[BR_FASES.length - 1].d };
}

export function brStart(seed, elapsed = 0) {
  G.BR.on = true;
  G.BR.over = false;
  G.BR.Z = brBuild(seed);
  G.BR.t0 = performance.now();
  G.BR.off = elapsed;
  G.BR.acc = 0;
  G.BR.bAcc = 0;
  G.BR.key = '';
  G.VICTORY_STATE = null;
  G.VICTORY_TIMER = 0;
  stormWall.visible = true;
}

export function brStop() {
  G.BR.on = false;
  G.BR.over = false;
  stormWall.visible = false;
  nextWall.visible = false;
  if (battleBus) battleBus.visible = false;
  G.DROP.phase = 'landed';
  updateWindSound(false);
  G.ZPT = null;
  G.VICTORY_STATE = null;
  const sfx = document.getElementById('stormFx');
  if (sfx) sfx.style.opacity = 0;
}

// ---------- Battle Bus & Skydiving Drop Mechanics ----------
export function startDropPhase(seed, elapsed = 0) {
  const rnd = mulberry((seed ^ 0xB455) | 0);
  const angle = rnd() * Math.PI * 2;
  const offsetDist = (rnd() - 0.5) * 55;
  const ox = -Math.sin(angle) * offsetDist;
  const oz = Math.cos(angle) * offsetDist;
  const span = 215;

  const D = G.DROP;
  D.busDur = 24;
  D.busElapsed = elapsed;
  D.startX = ox - Math.cos(angle) * span;
  D.startZ = oz - Math.sin(angle) * span;
  D.endX = ox + Math.cos(angle) * span;
  D.endZ = oz + Math.sin(angle) * span;
  D.busY = 128;
  D.busYaw = Math.atan2(-(D.endX - D.startX), -(D.endZ - D.startZ));
  D.vSpeed = 0;
  D.hSpeed = 0;
  D.bank = 0;
  D.gliderOpen = false;
  D.spaceLatch = true;

  endDrink();

  if (elapsed >= D.busDur - 2) {
    D.phase = 'landed';
    if (battleBus) battleBus.visible = false;
    if (G.player) {
      G.player.visible = true;
      equipActorWeapon(G.player, G.P.weaponId, false);
      if (G.player.userData.glider) G.player.userData.glider.visible = false;
    }
    return;
  }

  D.phase = 'bus';
  const k = Math.min(1, Math.max(0, elapsed / D.busDur));
  D.busX = D.startX + (D.endX - D.startX) * k;
  D.busZ = D.startZ + (D.endZ - D.startZ) * k;

  G.P.x = D.busX;
  G.P.y = D.busY - 2.0;
  G.P.z = D.busZ;
  G.P.yaw = D.busYaw;
  G.P.pitch = -0.35;
  G.P.ground = false;

  if (G.player) {
    G.player.visible = false;
    equipActorWeapon(G.player, G.P.weaponId, true);
    if (G.player.userData.glider) G.player.userData.glider.visible = false;
  }
  if (battleBus) {
    battleBus.visible = true;
    battleBus.position.set(D.busX, D.busY, D.busZ);
    battleBus.rotation.set(0, D.busYaw, 0);
  }
}

export function jumpFromBus(hooks = {}) {
  const D = G.DROP;
  if (D.phase !== 'bus' || G.P.dead) return;
  D.phase = 'freefall';
  D.gliderOpen = false;
  D.vSpeed = -12;
  D.hSpeed = 16;
  D.spaceLatch = true;
  G.P.x = D.busX;
  G.P.y = D.busY - 3.2;
  G.P.z = D.busZ;
  G.P.ground = false;
  if (G.player) {
    G.player.visible = true;
    equipActorWeapon(G.player, G.P.weaponId, true);
    if (G.player.userData.glider) G.player.userData.glider.visible = false;
  }
  playGliderOpen();
  if (hooks.onToast) hooks.onToast('¡En caída libre! Pulsa [ESPACIO] para abrir el ala delta');
}

export function toggleGlider(forceOpen = null) {
  const D = G.DROP;
  if (D.phase !== 'freefall' && D.phase !== 'glider') return;
  const open = forceOpen !== null ? forceOpen : D.phase === 'freefall';
  if (open && D.phase !== 'glider') {
    D.phase = 'glider';
    D.gliderOpen = true;
    D.vSpeed = Math.max(D.vSpeed, -6.5);
    playGliderOpen();
    if (G.player && G.player.userData.glider) G.player.userData.glider.visible = true;
  } else if (!open && D.phase === 'glider') {
    const gnd = Math.max(0, H(G.P.x, G.P.z));
    if (G.P.y - gnd < 26) return; // auto-lock open close to ground
    D.phase = 'freefall';
    D.gliderOpen = false;
    if (G.player && G.player.userData.glider) G.player.userData.glider.visible = false;
  }
}

export function updateDropPhase(dt, hooks = {}) {
  const D = G.DROP;
  if (G.MENU_OPEN || G.VICTORY_STATE) {
    updateWindSound(false);
    return;
  }

  // Always advance the Battle Bus while its flight duration is active
  if (D.busElapsed < D.busDur) {
    D.busElapsed += dt;
    const k = Math.min(1, D.busElapsed / D.busDur);
    D.busX = D.startX + (D.endX - D.startX) * k;
    D.busZ = D.startZ + (D.endZ - D.startZ) * k;
    if (battleBus) {
      battleBus.visible = true;
      battleBus.position.set(D.busX, D.busY + Math.sin(D.busElapsed * 2.1) * 0.4, D.busZ);
      battleBus.rotation.set(0, D.busYaw, Math.sin(D.busElapsed * 1.4) * 0.025);
      if (busFlame) busFlame.scale.z = 0.85 + Math.sin(D.busElapsed * 26) * 0.18;
      if (busBurner) busBurner.scale.y = 0.8 + Math.cos(D.busElapsed * 19) * 0.22;
    }
  } else if (battleBus) {
    battleBus.visible = false;
  }

  if (D.phase === 'landed') {
    updateWindSound(false);
    return;
  }

  const spaceDown = !!G.keys.Space;
  const spaceJustPressed = spaceDown && !D.spaceLatch;
  D.spaceLatch = spaceDown;

  const P = G.P;

  if (D.phase === 'bus') {
    P.x = D.busX;
    P.y = D.busY - 2.0;
    P.z = D.busZ;
    updateWindSound(true, 0.35, true);
    if (spaceJustPressed || D.busElapsed >= D.busDur - 1.5) {
      jumpFromBus(hooks);
    }
    return;
  }

  // Freefall or Glider movement physics
  const isGliding = D.phase === 'glider';
  const gndH = H(P.x, P.z);
  const altAboveGnd = P.y - Math.max(0, gndH);

  if (spaceJustPressed) {
    toggleGlider();
  }
  if (!isGliding && altAboveGnd <= 26 && P.y > gndH) {
    toggleGlider(true);
  }

  const keys = G.keys;
  const steer = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const thrust = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  D.bank += (steer - D.bank) * Math.min(1, dt * 8);

  if (keys.ArrowLeft) P.yaw += 1.8 * dt;
  if (keys.ArrowRight) P.yaw -= 1.8 * dt;

  // Steering rotates yaw gently + strafes sideways
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
  const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);

  const targetVSpeed = isGliding ? -6.2 + (thrust > 0 ? -1.4 : 0) : (thrust > 0 ? -34 : -22);
  const targetHSpeed = isGliding ? (thrust >= 0 ? 20 : 12) : (thrust > 0 ? 24 : 15);
  D.vSpeed += (targetVSpeed - D.vSpeed) * Math.min(1, dt * 3.5);
  D.hSpeed += (targetHSpeed - D.hSpeed) * Math.min(1, dt * 3.5);

  const moveX = (fx * (thrust < 0 ? 0.25 : 1) + rx * steer * 0.65);
  const moveZ = (fz * (thrust < 0 ? 0.25 : 1) + rz * steer * 0.65);
  const ml = Math.hypot(moveX, moveZ) || 1;
  P.x = Math.max(-210, Math.min(210, P.x + (moveX / ml) * D.hSpeed * dt));
  P.z = Math.max(-210, Math.min(210, P.z + (moveZ / ml) * D.hSpeed * dt));
  P.y += D.vSpeed * dt;

  updateWindSound(true, isGliding ? 0.45 : Math.min(1, Math.abs(D.vSpeed) / 34), false);

  if (G.player) {
    G.player.visible = true;
    G.player.position.set(P.x, P.y, P.z);
    G.player.rotation.set(0, P.yaw, 0);
    equipActorWeapon(G.player, P.weaponId, true);
    if (G.player.userData.glider) G.player.userData.glider.visible = D.phase === 'glider';
    if (D.phase === 'glider') animGlide(G.player, dt, D.bank);
    else animSkydive(G.player, dt, D.bank, Math.max(0, thrust));
  }

  // Landing on terrain
  const landH = H(P.x, P.z);
  if (P.y <= landH) {
    P.y = landH;
    P.vy = 0;
    P.ground = true;
    P.land = 0.35;
    D.phase = 'landed';
    D.gliderOpen = false;
    updateWindSound(false);
    if (G.player) {
      if (G.player.userData.glider) G.player.userData.glider.visible = false;
      equipActorWeapon(G.player, P.weaponId, false);
    }
    if (hooks.onToast) hooks.onToast('¡Aterrizaje completado! ¡A combatir!');
  }
}

export function updateDropCamera() {
  const D = G.DROP;
  const P = G.P;
  const cam = G.cam;
  const baseFov = SETTINGS.fov || 70;

  if (D.phase === 'bus') {
    const yaw = P.yaw;
    const dist = 24;
    const cx = D.busX + Math.sin(yaw) * dist;
    const cz = D.busZ + Math.cos(yaw) * dist;
    const cy = D.busY + 7.5 - Math.sin(P.pitch) * 6;
    cam.position.set(cx, cy, cz);
    cam.lookAt(D.busX, D.busY + 1.5, D.busZ);
    const fovT = Math.min(92, baseFov + 10);
    if (Math.abs(cam.fov - fovT) > 0.1) { cam.fov = fovT; cam.updateProjectionMatrix(); }
    return;
  }

  // Freefall or glider dynamic chase camera
  const isGlide = D.phase === 'glider';
  const dist = isGlide ? 6.4 : 5.2;
  cam.rotation.set(P.pitch, P.yaw, 0);
  cam.position.set(P.x, P.y + (isGlide ? 2.4 : 1.7), P.z).add(
    new THREE.Vector3(0.4, isGlide ? 1.5 : 2.1, dist).applyEuler(cam.rotation)
  );
  const ch = H(cam.position.x, cam.position.z) + 0.8;
  if (cam.position.y < ch) cam.position.y = ch;

  const fovT = isGlide ? baseFov + 4 : Math.min(95, baseFov + 12);
  if (Math.abs(cam.fov - fovT) > 0.1) { cam.fov = fovT; cam.updateProjectionMatrix(); }
}

export function specTarget() {
  const al = Object.values(G.RMS).filter(r => r.ready && !r.dead);
  if (G.keys.Space && !specPrev) specI++;
  specPrev = !!G.keys.Space;
  return al.length ? al[specI % al.length] : null;
}

export function brCheckWin(hooks = {}) {
  if (!G.NET.host || !G.ONLINE || G.NET.ended || !G.BR.on) return;
  const all = Object.values(G.NET.players);
  const aliveHumans = all.filter(p => !p.dead);
  if (all.length >= 2 && aliveHumans.length <= 1) {
    const winId = aliveHumans.length ? aliveHumans[0].id : all.slice().sort((a, b) => (b.out || 0) - (a.out || 0))[0].id;
    if (hooks.onHostWin) hooks.onHostWin(winId);
  }
}

export function triggerVictoryFx() {
  G.VICTORY_STATE = 'win';
  G.VICTORY_TIMER = 0;
  updateWindSound(false);
  spawnVictoryFx({ x: G.P.x, y: G.P.y, z: G.P.z });
  playVictoryFanfare();
}

export function brUpdate(dt, hooks = {}) {
  if (!G.BR.on) return;
  const z = brZone();
  const ended = G.BR.over || (G.ONLINE && G.NET.ended);
  const P = G.P;

  const sr = Math.max(z.r, 0.05);
  stormWall.position.set(z.x, 30, z.z);
  stormWall.scale.set(sr, 1, sr);
  stormWall.material.opacity = 0.27 + Math.sin(performance.now() * 0.002) * 0.05;
  nextWall.visible = z.st < 2 && z.tr > 0.3;
  if (nextWall.visible) {
    nextWall.position.set(z.tx, 10, z.tz);
    nextWall.scale.set(z.tr, 1, z.tr);
  }

  const key = z.ph + '-' + z.st;
  if (key !== G.BR.key) {
    G.BR.key = key;
    if (hooks.onToast) {
      if (z.st === 1) hooks.onToast('¡La tormenta se está cerrando!');
      else if (z.st === 2) hooks.onToast('¡Zona final!');
      else if (z.ph > 1) hooks.onToast('Nueva zona segura marcada en el mapa');
    }
  }

  const dist = Math.hypot(P.x - z.x, P.z - z.z) - z.r;
  const out = dist > 0 && G.DROP.phase === 'landed';
  const stormFxEl = document.getElementById('stormFx');
  if (stormFxEl) stormFxEl.style.opacity = out && !P.dead && !ended && !G.MENU_OPEN ? 1 : 0;

  if (!ended && !P.dead && !G.MENU_OPEN) {
    if (out) {
      G.BR.acc += dt;
      while (G.BR.acc >= 1) {
        G.BR.acc -= 1;
        hurt(z.d, -1, true, hooks);
      }
    } else {
      G.BR.acc = 0;
    }
  }

  const botLimit = G.ONLINE ? (G.NET.nb | 0) : G.activeBotCount;
  if ((!G.ONLINE || G.NET.host) && !ended) {
    G.BR.bAcc += dt;
    if (G.BR.bAcc >= 1) {
      G.BR.bAcc -= 1;
      for (const h of G.bots) {
        const b = h.userData.root, u = b.userData;
        if (u.bi >= botLimit || u.dead || (u.drop && u.drop.state !== 3)) continue;
        if (Math.hypot(b.position.x - z.x, b.position.z - z.z) > z.r) {
          u.hp -= z.d;
          if (u.hp <= 0) { u.dead = true; u.t = 0; }
        }
      }
    }
    const botsAlive = G.bots.filter(h => h.userData.root.userData.bi < botLimit && !h.userData.root.userData.dead).length;
    if (!G.ONLINE) {
      if (P.dead && deadT > 2.0) {
        G.BR.over = true;
        G.VICTORY_STATE = 'loss';
        if (hooks.onSoloEnd) hooks.onSoloEnd(false, botsAlive);
      } else if (!P.dead && botsAlive === 0) {
        G.BR.over = true;
        triggerVictoryFx();
        if (hooks.onSoloEnd) hooks.onSoloEnd(true, 0);
      }
    }
  }

  const aliveTotal = G.ONLINE
    ? Object.values(G.NET.players).filter(p => !p.dead).length + G.bots.filter(h => h.userData.root.userData.bi < botLimit && !h.userData.root.userData.dead).length
    : (P.dead ? 0 : 1) + G.bots.filter(h => h.userData.root.userData.bi < botLimit && !h.userData.root.userData.dead).length;

  G.ZPT = !ended && !G.MENU_OPEN && !P.dead && Math.hypot(P.x - z.tx, P.z - z.tz) > z.tr + 2 ? { x: z.tx, z: z.tz } : null;

  if (hooks.onZoneHud) {
    hooks.onZoneHud({ z, out, dist, aliveTotal, totalPhases: BR_FASES.length });
  }
}

// ---------- High-Resolution 512px 2D Island Map & Real-World Minimap ----------
// World coverage spans -220..320 in X and -230..230 in Z so East Race Circuit (+245) fits cleanly!
const MAP_MIN_X = -215;
const MAP_MAX_X = 315;
const MAP_MIN_Z = -235;
const MAP_MAX_Z = 215;
const MAP_SPAN_X = MAP_MAX_X - MAP_MIN_X; // 530m
const MAP_SPAN_Z = MAP_MAX_Z - MAP_MIN_Z; // 450m

function buildMinimapTerrainCache() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const wx = MAP_MIN_X + (px / size) * MAP_SPAN_X;
      const wz = MAP_MIN_Z + (py / size) * MAP_SPAN_Z;
      const b = biome(wx, wz);
      const h = Hterr(wx, wz);
      const hx = Hterr(wx + 2.2, wz) - Hterr(wx - 2.2, wz);
      const hz = Hterr(wx, wz + 2.2) - Hterr(wx, wz - 2.2);
      const hillShade = Math.max(-18, Math.min(18, (-hx - hz) * 3.5));

      let r = 14, g = 74, bl = 114;
      if (b === 'Mar') {
        const shallow = Math.max(0, 1 + h / 6);
        r = Math.round(10 + shallow * 18);
        g = Math.round(52 + shallow * 65);
        bl = Math.round(92 + shallow * 58);
      } else if (b === 'Playa') {
        r = 228; g = 204; bl = 142;
        if (h < 0.35) { r = 240; g = 232; bl = 200; } // shoreline foam edge
      } else if (b === 'Desierto') {
        r = 212 + hillShade; g = 160 + hillShade * 0.8; bl = 84;
      } else if (b === 'Nieve') {
        r = 232 + hillShade * 0.6; g = 242 + hillShade * 0.5; bl = 250;
      } else if (b === 'Montaña') {
        const vd = Math.hypot(wx - 6, wz - 59);
        if (vd < 7.8) { r = 245; g = 92; bl = 22; }
        else if (vd < 13) { r = 92; g = 58; bl = 46; }
        else { r = 122 + hillShade; g = 118 + hillShade; bl = 114 + hillShade; }
      } else {
        const s = Math.min(1, Math.max(0, h / 22));
        r = 72 - s * 22 + hillShade;
        g = 148 - s * 32 + hillShade;
        bl = 58 - s * 14 + hillShade * 0.4;
      }

      if (ROAD && ROAD.distTo(wx, wz) < 3.6) {
        r = 68; g = 74; bl = 84;
      }

      const idx = (py * size + px) * 4;
      img.data[idx] = Math.max(0, Math.min(255, Math.round(r)));
      img.data[idx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      img.data[idx + 2] = Math.max(0, Math.min(255, Math.round(bl)));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Subtle topographic grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let i = 1; i < 6; i++) {
    const p = (i / 6) * size;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = 'bold 11px Inter, sans-serif';
  cols.forEach((lbl, i) => {
    ctx.fillText(lbl, (i + 0.08) * (size / 6), 14);
    ctx.fillText(String(i + 1), 6, (i + 0.16) * (size / 6));
  });

  // East Bridge & Race Circuit Loop
  if (DECK) {
    const toPx = (wx, wz) => [((wx - MAP_MIN_X) / MAP_SPAN_X) * size, ((wz - MAP_MIN_Z) / MAP_SPAN_Z) * size];
    const bs = DECK.bridgeSamples(4);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    bs.forEach((p, i) => {
      const [mx, my] = toPx(p[0], p[1]);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    });
    ctx.stroke();

    const ls = DECK.loopSamples(1);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ls.forEach((p, i) => {
      const [mx, my] = toPx(p[0], p[1]);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    });
    ctx.closePath();
    ctx.stroke();
  }

  minimapBase = c;
}

export function renderMinimap(canvas, expanded = false) {
  if (!canvas || !minimapBase || G.MENU_OPEN) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const toMap = (wx, wz) => [((wx - MAP_MIN_X) / MAP_SPAN_X) * w, ((wz - MAP_MIN_Z) / MAP_SPAN_Z) * h];
  const scaleX = w / MAP_SPAN_X;

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(minimapBase, 0, 0, w, h);

  // POI markers & names (full names on expanded map, compact tags on HUD minimap)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  MAP_POIS.forEach(poi => {
    const [px, py] = toMap(poi.x, poi.z);
    if (expanded) {
      ctx.font = 'bold 12px Inter, sans-serif';
      const tw = ctx.measureText(poi.name).width + 12;
      ctx.fillStyle = 'rgba(7, 15, 29, 0.72)';
      ctx.fillRect(px - tw * 0.5, py - 10, tw, 18);
      ctx.fillStyle = poi.color;
      ctx.fillText(poi.name, px, py - 1);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = 'bold 8px Inter, sans-serif';
      ctx.fillText(poi.name.split(' ')[0], px, py);
    }
  });

  // Safe zone & animated closing storm
  if (G.BR.on) {
    const z = brZone();
    const [zx, zy] = toMap(z.x, z.z);
    const zr = z.r * scaleX;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(zx, zy, Math.max(1, zr), 0, Math.PI * 2, true);
    ctx.fillStyle = z.st === 1 ? 'rgba(147, 51, 234, 0.44)' : 'rgba(139, 92, 246, 0.34)';
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = z.st === 1 ? '#e879f9' : '#c084fc';
    ctx.lineWidth = expanded ? 3 : 2;
    ctx.beginPath();
    ctx.arc(zx, zy, Math.max(1, zr), 0, Math.PI * 2);
    ctx.stroke();

    if (z.st < 2 && z.tr > 0.5) {
      const [tx, ty] = toMap(z.tx, z.tz);
      const tr = z.tr * scaleX;
      ctx.save();
      ctx.setLineDash(expanded ? [7, 5] : [4, 3]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = expanded ? 2 : 1.4;
      ctx.beginPath();
      ctx.arc(tx, ty, tr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Battle Bus flight trajectory & live bus icon
  if (G.DROP.busElapsed < G.DROP.busDur) {
    const [sx, sy] = toMap(G.DROP.startX, G.DROP.startZ);
    const [ex, ey] = toMap(G.DROP.endX, G.DROP.endZ);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = expanded ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();

    const [bx, by] = toMap(G.DROP.busX, G.DROP.busZ);
    ctx.fillStyle = '#0ea5e9';
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, expanded ? 7 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Vehicles
  for (let i = 0; i < G.CARS.length; i++) {
    const c = G.CARS[i];
    if (!c || c.dead) continue;
    const [vx, vy] = toMap(c.st.x, c.st.z);
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#09111f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(vx, vy, expanded ? 4.5 : 2.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (expanded) {
      ctx.font = '11px sans-serif';
      ctx.fillText(VEH_ICON[i] || '🚗', vx, vy - 10);
    }
  }

  // Active shield cans
  ctx.fillStyle = '#38bdf8';
  for (const p of G.POT) {
    if (!p.on) continue;
    const [px, py] = toMap(p.pos.x, p.pos.z);
    const sz = expanded ? 5 : 3;
    ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);
  }

  // Active weapon/grenade loot drops
  for (const l of G.loots) {
    if (!l.active) continue;
    const [lx, ly] = toMap(l.x, l.z);
    ctx.fillStyle = l.kind === 'weapon' ? '#f472b6' : '#fb923c';
    ctx.beginPath();
    ctx.arc(lx, ly, expanded ? 4 : 2.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Remote players (visible on map in Online)
  if (G.ONLINE) {
    for (const id in G.RMS) {
      const r = G.RMS[id];
      if (!r.ready || r.dead) continue;
      if (expanded || r.shootT > 0 || Math.hypot(r.x - G.P.x, r.z - G.P.z) < 50) {
        const [rx, ry] = toMap(r.x, r.z);
        ctx.fillStyle = '#fb7185';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(rx, ry, expanded ? 5 : 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (expanded) {
          ctx.fillStyle = '#fecdd3';
          ctx.font = 'bold 10px Inter, sans-serif';
          ctx.fillText(r.name, rx, ry - 10);
        }
      }
    }
  }

  // Firing or nearby bots
  const limit = G.ONLINE ? (G.NET.nb | 0) : G.activeBotCount;
  for (const bHb of G.bots) {
    const b = bHb.userData.root, u = b.userData;
    if (u.bi >= limit || u.dead || (u.drop && u.drop.state === 0)) continue;
    const firing = (u.ai && u.ai.sh > 0) || (u.nt && u.nt.shoot);
    if (firing || Math.hypot(b.position.x - G.P.x, b.position.z - G.P.z) < 38) {
      const [bx, by] = toMap(b.position.x, b.position.z);
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(bx, by, expanded ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Local Player Arrow + View Cone
  const [px, py] = toMap(G.P.x, G.P.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-G.P.yaw);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, expanded ? 28 : 19, -Math.PI * 0.68, -Math.PI * 0.32);
  ctx.closePath();
  ctx.fill();

  const sc = expanded ? 1.45 : 1;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0ea5e9';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -5.5 * sc);
  ctx.lineTo(4.2 * sc, 4.2 * sc);
  ctx.lineTo(0, 2.2 * sc);
  ctx.lineTo(-4.2 * sc, 4.2 * sc);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
