// Bots module: Dynamic bot pool (up to 24 Solo / 0..12 Online),
// Battle Bus skydiving & gliding drop phase, tactical ground AI, and P2P sync.

import { G, R, r1, r2, wrap } from './state.js';
import { H, los, pushOut } from './world.js';
import {
  buildAthlete, buildWeaponSet, attachGlider, equipActorWeapon,
  mkState, poseBot, animate, animDead, animSkydive, animGlide, hurt,
} from './player.js';
import { tracer, POT_RESPAWN } from './weapons.js';
import { vehDamage } from './vehicles.js';
import { playShot } from './audio.js';

export const MAX_SOLO_BOTS = 24;
export const MAX_ONLINE_BOTS = 12;

export const botsFor = n => Math.max(2, Math.min(6, 8 - n));

function createOneBot(i) {
  const b = buildAthlete();
  b.userData.bot = true;
  b.userData.bi = i;
  b.userData.name = 'Bot ' + (i + 1);
  const hb = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2.6, 0.8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hb.position.y = 1.3;
  hb.userData.root = b;
  b.add(hb);
  G.bots.push(hb);

  buildWeaponSet(b);
  attachGlider(b);
  const fl = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd070 })
  );
  fl.visible = false;
  b.userData.rifle.userData.mz.add(fl);
  b.userData.fl = fl;

  b.userData.dead = true;
  b.visible = false;
  G.scene.add(b);
  return hb;
}

export function ensureBotPool(count) {
  const target = Math.min(MAX_SOLO_BOTS, Math.max(0, count | 0));
  while (G.bots.length < target) {
    createOneBot(G.bots.length);
  }
}

export function initBots() {
  ensureBotPool(12);
}

function pickDryLandingSpot() {
  for (let n = 0; n < 200; n++) {
    const x = (Math.random() - 0.5) * R * 1.45;
    const z = (Math.random() - 0.5) * R * 1.45;
    if (H(x, z) > 2.2) return { x, z };
  }
  return { x: G.SPAWN[0], z: G.SPAWN[1] };
}

function assignBotDrop(b) {
  const u = b.userData;
  const land = pickDryLandingSpot();
  const busActive = G.DROP.busElapsed < G.DROP.busDur - 3;
  if (busActive) {
    u.drop = {
      state: 0, // 0: bus, 1: freefall, 2: glider, 3: landed
      jumpT: Math.max(G.DROP.busElapsed + 0.6, 1.8 + Math.random() * 14.5),
      tx: land.x,
      tz: land.z,
      vSpeed: 0,
    };
    b.visible = false;
    b.position.set(G.DROP.busX, G.DROP.busY - 2, G.DROP.busZ);
    if (u.glider) u.glider.visible = false;
    equipActorWeapon(b, 'm16', true);
  } else {
    u.drop = { state: 3, jumpT: 0, tx: land.x, tz: land.z, vSpeed: 0 };
    b.position.set(land.x, H(land.x, land.z), land.z);
    b.visible = true;
    equipActorWeapon(b, 'm16', false);
    if (u.glider) u.glider.visible = false;
  }
}

export function spawnBot(b, force) {
  const bi = b.userData.bi;
  const limit = G.ONLINE ? (G.NET.nb | 0) : G.activeBotCount;
  if (bi >= limit) {
    b.userData.dead = true;
    b.visible = false;
    return;
  }
  if (G.ONLINE) {
    if (force) onlineBotPlace(b);
    else { b.userData.dead = true; b.visible = false; }
    return;
  }
  if (G.BR.on && !force) return;

  b.userData.hp = 100;
  b.userData.sh = 0;
  b.userData.dead = false;
  b.userData.st = mkState();
  b.userData.ai = { sw: 0, sd: 1, mode: 0, seen: 0, cool: 1, burst: 4, fl: 0, sh: 0, tx: null, tz: 0, wt: 0 };
  if (b.userData.bn) poseBot(b);
  b.rotation.y = Math.random() * 6;
  assignBotDrop(b);
}

export function onlineBotPlace(b) {
  const u = b.userData;
  u.hp = 100;
  u.sh = 0;
  u.dead = false;
  u.st = mkState();
  u.nt = null;
  u.net = null;
  u.ai = { sw: 0, sd: 1, mode: 0, seen: 0, cool: 1, burst: 4, fl: 0, sh: 0, tx: null, tz: 0, wt: 0 };
  if (u.bn) poseBot(b);
  b.rotation.y = Math.random() * 6;
  assignBotDrop(b);
}

function botTargets() {
  const a = [];
  if (!G.P.dead && G.DROP.phase === 'landed') {
    a.push({
      x: G.P.x, y: G.P.y, z: G.P.z, id: G.NET.id, ground: G.P.ground, local: true,
      car: G.inCar && G.curCar && G.curCar.idx < 4 ? G.curCar : null,
    });
  }
  if (G.ONLINE) {
    for (const id in G.RMS) {
      const r = G.RMS[id];
      if (r.ready && !r.dead && (r.ds === undefined || r.ds === 3)) {
        a.push({
          x: r.x, y: r.y, z: r.z, id: +id, ground: true, local: false,
          car: r.inCar && r.carT && r.carT.i < 4 ? G.CARS[r.carT.i] : null,
        });
      }
    }
  }
  return a;
}

function botFire(b, dist, tg, hooks = {}) {
  const u = b.userData, ai = u.ai;
  ai.fl = 0.06;
  ai.sh = 0.4;
  const from = new THREE.Vector3();
  u.rifle.userData.mz.getWorldPosition(from);
  const hit = Math.random() < Math.max(0.1, 0.5 - dist / 110) * (tg.ground ? 1 : 0.6);
  const to = new THREE.Vector3(tg.x, tg.y + 1.5, tg.z);
  if (!hit) {
    to.x += (Math.random() - 0.5) * 5;
    to.y += (Math.random() - 0.5) * 3;
    to.z += (Math.random() - 0.5) * 5;
  }
  tracer(from, to, 0xff7a5a);
  playShot('m16', dist);
  if (G.ONLINE && hooks.onNetBotFire) hooks.onNetBotFire(u.bi, to);
  if (hit) {
    if (tg.local) hurt(7, -1, false, hooks);
    else if (tg.car) vehDamage(tg.car, 7, hooks);
    else if (hooks.onNetHitPlayer) hooks.onNetHitPlayer(tg.id, 7);
  }
}

export function applyBotKill(by, hooks = {}) {
  const k = G.NET.players[by];
  if (k) k.k++;
  if (by === G.NET.id) {
    if (k) G.P.kills = k.k;
    if (!G.P.dead) G.P.hp = Math.min(100, G.P.hp + 50);
  }
  if (hooks.onKillsChanged) hooks.onKillsChanged();
}

export function netBotDamage(i, d, by, hooks = {}) {
  const h = G.bots[i];
  if (!h || !(d > 0)) return;
  const b = h.userData.root, u = b.userData;
  if (u.dead || i >= (G.NET.nb | 0)) return;
  u.hp -= d;
  if (u.mat) {
    u.mat.emissive.setHex(0x884422);
    setTimeout(() => { if (u.mat) u.mat.emissive.setHex(0); }, 70);
  }
  if (u.hp <= 0) {
    u.dead = true;
    u.t = 0;
    if (hooks.onNetBotKilled) hooks.onNetBotKilled(by, u.name);
    applyBotKill(by, hooks);
  }
}

export function botsUpdate(dt, brZoneFn, hooks = {}) {
  if (G.MENU_OPEN) return;
  const limit = G.ONLINE ? (G.NET.nb | 0) : G.activeBotCount;

  if (G.ONLINE && !G.NET.host) {
    botsNetFrame(dt);
    return;
  }
  if (G.ONLINE && (G.NET.ended || !G.NET.started)) return;

  const T = botTargets();
  const zb = G.BR.on && brZoneFn ? brZoneFn() : null;

  for (const h of G.bots) {
    const b = h.userData.root, u = b.userData;
    if (u.bi >= limit) {
      b.visible = false;
      continue;
    }
    if (u.dead) {
      animDead(b, dt);
      continue;
    }

    // Handle Battle Bus Drop -> Freefall -> Glider -> Landed
    if (u.drop && u.drop.state !== 3) {
      const dr = u.drop;
      if (dr.state === 0) {
        b.visible = false;
        b.position.set(G.DROP.busX, G.DROP.busY - 2, G.DROP.busZ);
        if (G.DROP.busElapsed >= dr.jumpT || G.DROP.busElapsed >= G.DROP.busDur - 1.5) {
          dr.state = 1;
          dr.vSpeed = -16;
          b.position.set(G.DROP.busX + (Math.random() - 0.5) * 3, G.DROP.busY - 3, G.DROP.busZ + (Math.random() - 0.5) * 3);
          b.visible = true;
          equipActorWeapon(b, 'm16', true);
        }
        u.net = { fwd: 0, side: 0, spd: 0, walk: false, shoot: false, pitch: 0, ds: 0 };
        continue;
      }

      const gnd = H(b.position.x, b.position.z);
      const alt = b.position.y - Math.max(0, gnd);
      if (dr.state === 1 && alt < 32) {
        dr.state = 2;
        if (u.glider) u.glider.visible = true;
      }

      const dxT = dr.tx - b.position.x, dzT = dr.tz - b.position.z;
      const distT = Math.hypot(dxT, dzT);
      if (distT > 1) {
        const tgtYaw = Math.atan2(-dxT, -dzT);
        b.rotation.y += wrap(tgtYaw - b.rotation.y) * Math.min(1, dt * 4);
      }
      const hSpd = dr.state === 2 ? 15 : 13;
      const vSpd = dr.state === 2 ? -6.5 : -24;
      if (distT > 2) {
        b.position.x += (dxT / distT) * hSpd * dt;
        b.position.z += (dzT / distT) * hSpd * dt;
      }
      b.position.y += vSpd * dt;

      if (b.position.y <= gnd) {
        b.position.y = gnd;
        dr.state = 3;
        if (u.glider) u.glider.visible = false;
        equipActorWeapon(b, 'm16', false);
        u.net = { fwd: 0, side: 0, spd: 0, walk: false, shoot: false, pitch: 0, ds: 3 };
      } else {
        b.visible = true;
        if (dr.state === 2) animGlide(b, dt, 0);
        else animSkydive(b, dt, 0, 1);
        u.net = { fwd: 0, side: 0, spd: hSpd, walk: false, shoot: false, pitch: 0, ds: dr.state };
      }
      continue;
    }

    const ai = u.ai, bx_ = b.position.x, bz_ = b.position.z;

    // 1. Check nearby grenade threat -> flee!
    let fleeGren = null;
    for (const g of G.grens) {
      const gd = Math.hypot(g.m.position.x - bx_, g.m.position.z - bz_);
      if (gd < 11) { fleeGren = g.m.position; break; }
    }

    // 2. Nearest target
    let tg = null, dist = 1e9;
    for (const t of T) {
      const d = Math.hypot(t.x - bx_, t.z - bz_);
      if (d < dist) { dist = d; tg = t; }
    }

    // 3. Nearest shield potion if injured
    let seekPot = null;
    if (u.hp < 70 && !fleeGren) {
      let bestPd = 22;
      for (const p of G.POT) {
        if (!p.on) continue;
        const pd = Math.hypot(p.pos.x - bx_, p.pos.z - bz_);
        if (pd < bestPd) { bestPd = pd; seekPot = p; }
      }
    }

    const dx = tg ? tg.x - bx_ : 0, dz = tg ? tg.z - bz_ : 0;
    const see = !!tg && dist < 65 && !fleeGren;
    let fwd = 0, side = 0, spd = 0, walk = false, pitch = 0;

    if (fleeGren) {
      const awayYaw = Math.atan2(-(bx_ - fleeGren.x), -(bz_ - fleeGren.z));
      b.rotation.y += wrap(awayYaw - b.rotation.y) * Math.min(1, dt * 9);
      fwd = 1;
      spd = 6.5;
    } else if (seekPot) {
      const potYaw = Math.atan2(-(seekPot.pos.x - bx_), -(seekPot.pos.z - bz_));
      b.rotation.y += wrap(potYaw - b.rotation.y) * Math.min(1, dt * 6);
      fwd = 1;
      spd = 5.4;
      if (Math.hypot(seekPot.pos.x - bx_, seekPot.pos.z - bz_) < 1.8) {
        seekPot.on = false;
        seekPot.root.visible = false;
        seekPot.wait = POT_RESPAWN;
        u.hp = Math.min(100, u.hp + 35);
      }
    } else if (zb && Math.hypot(bx_ - zb.x, bz_ - zb.z) > zb.r - 4) {
      const inYaw = Math.atan2(-(zb.tx - bx_), -(zb.tz - bz_));
      b.rotation.y += wrap(inYaw - b.rotation.y) * Math.min(1, dt * 6);
      fwd = 1;
      spd = 5.8;
    } else if (see) {
      b.rotation.y += wrap(Math.atan2(-dx, -dz) - b.rotation.y) * Math.min(1, dt * 6);
      ai.sw -= dt;
      if (ai.sw <= 0) {
        ai.sw = 1 + Math.random() * 1.5;
        ai.sd = Math.random() < 0.5 ? -1 : 1;
        ai.mode = dist > 26 ? 0 : dist < 10 ? 1 : (Math.random() < 0.72 ? 2 : 0);
      }
      if (ai.mode === 0) { fwd = 1; spd = 5.2; }
      else if (ai.mode === 1) { fwd = -1; spd = 4.5; }
      else { side = ai.sd; spd = 3.8; }
      pitch = Math.atan2(tg.y + 1.6 - (b.position.y + 1.8), dist);
      ai.seen += dt;
    } else {
      ai.seen = 0;
      ai.wt -= dt;
      if (
        ai.tx === null ||
        ai.wt <= 0 ||
        Math.hypot(ai.tx - bx_, ai.tz - bz_) < 3 ||
        (zb && Math.hypot(ai.tx - zb.tx, ai.tz - zb.tz) > zb.tr + 4)
      ) {
        ai.wt = 5 + Math.random() * 6;
        for (let i = 0; i < 14; i++) {
          const sp = zb ? Math.max(zb.tr * 0.8, 3) : R * 0.8;
          const x = (zb ? zb.tx : 0) + (Math.random() - 0.5) * 2 * sp;
          const z = (zb ? zb.tz : 0) + (Math.random() - 0.5) * 2 * sp;
          if (H(x, z) > 2 && (!zb || Math.hypot(x - zb.tx, z - zb.tz) <= zb.tr)) {
            ai.tx = x;
            ai.tz = z;
            break;
          }
        }
      }
      if (ai.tx !== null) {
        b.rotation.y += wrap(Math.atan2(-(ai.tx - bx_), -(ai.tz - bz_)) - b.rotation.y) * Math.min(1, dt * 4);
        fwd = 1;
        spd = 3.6;
        walk = true;
      }
    }

    const yw = b.rotation.y;
    const nx = bx_ + (-Math.sin(yw) * fwd + Math.cos(yw) * side) * spd * dt;
    const nz = bz_ + (-Math.cos(yw) * fwd - Math.sin(yw) * side) * spd * dt;
    const q = { x: nx, z: nz };
    pushOut(q, 0.45);
    pushOut(q, 0.45);
    if (H(q.x, q.z) > 0.8) {
      b.position.x = q.x;
      b.position.z = q.z;
    } else {
      b.rotation.y += 1.2 * dt * 8;
      ai.wt = 0;
    }
    b.position.y = H(b.position.x, b.position.z);

    if (see && dist < 55 && ai.seen > 0.7 && los(bx_, b.position.y + 2.2, bz_, tg.x, tg.y + 2, tg.z)) {
      ai.cool -= dt;
      if (ai.cool <= 0) {
        botFire(b, dist, tg, hooks);
        ai.burst--;
        if (ai.burst <= 0) { ai.burst = 4; ai.cool = 1.2 + Math.random(); }
        else ai.cool = 0.2;
      }
    }
    ai.fl -= dt;
    ai.sh -= dt;
    u.fl.visible = ai.fl > 0;
    u.net = { fwd, side, spd, walk, shoot: ai.sh > 0, pitch, ds: 3 };
    animate(b, dt, { fwd, side, spd, wade: false, walk, shoot: ai.sh > 0, pitch, ground: true, land: 0, reload: 0 });
  }
}

export function botsBroadcast(netSendFn) {
  const a = [];
  for (let i = 0; i < (G.NET.nb | 0); i++) {
    const h = G.bots[i];
    if (!h) continue;
    const b = h.userData.root, u = b.userData, n = u.net || {};
    const ds = n.ds !== undefined ? n.ds : 3;
    const flags = (u.dead ? 1 : 0) | (n.walk ? 2 : 0) | (n.shoot ? 4 : 0) | ((ds & 3) << 3);
    a.push([
      i, r1(b.position.x), r1(b.position.y), r1(b.position.z),
      r2(b.rotation.y), r2(n.pitch || 0), r2(n.fwd || 0), r2(n.side || 0), r2(n.spd || 0),
      flags, Math.round(u.hp || 0),
    ]);
  }
  netSendFn({ t: 'b', a });
}

export function botsNetFrame(dt) {
  const k = Math.min(1, dt * 12);
  for (const h of G.bots) {
    const b = h.userData.root, u = b.userData, n = u.nt;
    if (!n || u.bi >= (G.NET.nb | 0)) { b.visible = false; continue; }
    const ds = n.ds !== undefined ? n.ds : 3;
    if (ds === 0 && !u.dead) {
      b.visible = false;
      if (u.glider) u.glider.visible = false;
      continue;
    }
    b.visible = true;
    if (Math.hypot(n.x - b.position.x, n.z - b.position.z) > 10) {
      b.position.set(n.x, n.y, n.z);
      b.rotation.y = n.yaw;
    } else {
      b.position.x += (n.x - b.position.x) * k;
      b.position.y += (n.y - b.position.y) * k;
      b.position.z += (n.z - b.position.z) * k;
      b.rotation.y += wrap(n.yaw - b.rotation.y) * k;
    }
    u.flT = (u.flT || 0) - dt;
    u.fl.visible = u.flT > 0 && !u.dead && ds === 3;
    if (u.dead) {
      animDead(b, dt);
    } else if (ds === 1) {
      equipActorWeapon(b, 'm16', true);
      if (u.glider) u.glider.visible = false;
      animSkydive(b, dt, 0, 1);
    } else if (ds === 2) {
      equipActorWeapon(b, 'm16', true);
      if (u.glider) u.glider.visible = true;
      animGlide(b, dt, 0);
    } else {
      if (u.glider) u.glider.visible = false;
      equipActorWeapon(b, 'm16', false);
      animate(b, dt, { fwd: n.fwd, side: n.side, spd: n.spd, wade: false, walk: n.walk, shoot: n.shoot, pitch: n.pitch, ground: true, land: 0, reload: 0 });
    }
  }
}
