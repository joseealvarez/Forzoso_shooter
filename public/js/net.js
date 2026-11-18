// Multiplayer module: WebRTC P2P star topology via PeerJS 1.5.4,
// synced Battle Bus drop phase, 3D weapon display, host-controlled bot count, ping/RTT, and kill feed sync.

import { G, r2, wrap, cleanName } from './state.js';
import {
  buildAthlete, buildWeaponSet, attachGlider, equipActorWeapon,
  mkState, animate, animDead, animSkydive, animGlide, hurt, respawn, disableShowcaseLights,
} from './player.js';
import { waterJet, waterSplash, spawnRemoteGrenade, placePot, endDrink, POT_RESPAWN, resetInventory, spawnLootDrops } from './weapons.js';
import { mountRider, dismountRider, ridePose, updateCarTransform, crankUpdate, applyVehHp, placeVehicles, vehDamage, toggleCar, forceDismount } from './vehicles.js';
import { botsFor, spawnBot, botsBroadcast, applyBotKill, netBotDamage, ensureBotPool } from './bots.js';
import { brStart, brStop, brTime, brCheckWin, triggerVictoryFx, startDropPhase } from './battle-royale.js';

const PFX = 'islabattle-';
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PEER_URLS = [
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
];
const TINTS = [0xffb09a, 0x9ac8ff, 0xa6ff9a, 0xffe49a, 0xd29aff, 0x9affe4, 0xff9ad8, 0xc8c8c8];
const WEAPON_IDS = ['m16', 'shotgun', 'smg'];
const DROP_PHASES = { bus: 0, freefall: 1, glider: 2, landed: 3 };

const peerOpts = () => Object.assign({ debug: 0 }, window.PEER_OPTS || {});

let uiHooks = {};
export function bindNetHooks(h) {
  uiHooks = h;
}

export function loadPeerLib() {
  if (window.Peer) return Promise.resolve();
  return PEER_URLS.reduce(
    (p, url) =>
      p.catch(
        () =>
          new Promise((ok, ko) => {
            const s = document.createElement('script');
            s.src = url;
            s.onload = () => (window.Peer ? ok() : ko(new Error('peer')));
            s.onerror = () => { s.remove(); ko(new Error('net')); };
            document.head.appendChild(s);
          })
      ),
    Promise.reject()
  );
}

const genCode = () => {
  const a = new Uint8Array(5);
  (window.crypto || { getRandomValues: x => x.forEach((_, i) => (x[i] = Math.random() * 256)) }).getRandomValues(a);
  return Array.from(a, x => ALPH[x % ALPH.length]).join('');
};

export function resolveOnlineBotCount(playerCount) {
  const pref = G.NET.botPref;
  if (pref === 'auto' || pref === undefined || pref === null) return botsFor(playerCount);
  const n = Math.max(0, Math.min(12, Number(pref) | 0));
  return n;
}

export function setHostBotPref(pref) {
  G.NET.botPref = pref;
  if (G.NET.host) {
    G.NET.nb = resolveOnlineBotCount(Object.keys(G.NET.players).length);
    netSend({ t: 'cfg', botPref: pref, nb: G.NET.nb });
    if (uiHooks.renderLobby) uiHooks.renderLobby();
  }
}

export function pickSpawn(pts) {
  const sc = s => Math.min(...pts.map(p => Math.hypot(s[0] - p[0], s[1] - p[1])));
  const arr = G.SPAWNS.slice().sort((a, b) => sc(b) - sc(a));
  return arr[Math.floor(Math.random() * Math.min(3, arr.length))];
}

export function netSpawn() {
  if (G.NET.nextSpawn) {
    const s = G.NET.nextSpawn;
    G.NET.nextSpawn = null;
    return s;
  }
  const pts = Object.values(G.RMS).filter(r => r.ready).map(r => [r.x, r.z]);
  return pts.length ? pickSpawn(pts) : G.SPAWN;
}

export function addRemote(id, name) {
  if (G.RMS[id]) { G.RMS[id].name = name; return G.RMS[id]; }
  const root = buildAthlete();
  root.visible = false;
  if (root.userData.mat) root.userData.mat.color.setHex(TINTS[id % TINTS.length]);
  const hb = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2.6, 0.8),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hb.position.y = 1.3;
  hb.userData.root = root;
  root.userData.rid = id;
  root.add(hb);

  buildWeaponSet(root);
  attachGlider(root);
  const fl = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffd070 })
  );
  fl.visible = false;
  root.userData.rifle.userData.mz.add(fl);
  root.userData.fl = fl;
  G.scene.add(root);

  const tag = document.createElement('div');
  tag.className = 'rtag';
  const tn = document.createElement('span');
  const bar = document.createElement('i');
  const th = document.createElement('u');
  const td = document.createElement('span');
  bar.appendChild(th);
  tag.append(tn, bar, td);
  document.body.appendChild(tag);
  tn.textContent = name;

  return (G.RMS[id] = {
    id, name, root, hb, tag, th, td, tn,
    ready: false, dead: false, inCar: false, carT: null,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
    tx: 0, ty: 0, tz: 0, tyaw: 0, tpitch: 0,
    fwd: 0, side: 0, spd: 0, wade: false, ground: true,
    hp: 100, sh: 0, vs: 0, shootT: 0, wid: 0, ds: 3,
  });
}

export function dropRemote(id) {
  const r = G.RMS[id];
  if (r) {
    dismountRider(r.root);
    if (r.inCar && r.carT) {
      const c = G.CARS[r.carT.i];
      if (c && !(G.inCar && G.curCar === c)) {
        c.st.x = r.carT.x;
        c.st.z = r.carT.z;
        c.st.yaw = r.carT.yaw;
        c.st.speed = 0;
        updateCarTransform(c);
      }
    }
    G.scene.remove(r.root);
    r.tag.remove();
    delete G.RMS[id];
  }
  delete G.NET.players[id];
}

export const carDrivenRemote = i => Object.values(G.RMS).some(r => r.inCar && r.carT && r.carT.i === i);

export function netTargets() {
  const a = Object.values(G.RMS).filter(r => r.ready && !r.dead && r.root.visible).map(r => r.hb);
  for (const h of G.bots) {
    const rt = h.userData.root, u = rt.userData;
    if (u.bi < (G.NET.nb | 0) && !u.dead && rt.visible) a.push(h);
  }
  return a;
}

export function netSend(o) {
  o.i = G.NET.id;
  try {
    if (G.NET.host) {
      for (const c of G.NET.conns.values()) if (c.open) c.send(o);
    } else if (G.NET.conn && G.NET.conn.open) {
      G.NET.conn.send(o);
    }
  } catch (_) {}
}

export function netSendTo(id, o) {
  o.i = G.NET.id;
  o.to = id;
  try {
    const c = G.NET.host ? G.NET.conns.get(id) : G.NET.conn;
    if (c && c.open) c.send(o);
  } catch (_) {}
}

function relay(m, from, only) {
  for (const [id, c] of G.NET.conns) {
    if (id !== from && c.open && (only === undefined || only === id)) {
      try { c.send(m); } catch (_) {}
    }
  }
}

export function netTick() {
  if (!G.ONLINE) return;
  const now = performance.now();
  if (G.NET.host) {
    for (const [id, c] of G.NET.conns) {
      if (now - (c.lastRx || now) > 20000) dropGuest(id);
    }
  } else if (now - G.NET.lastRx > 20000) {
    leaveOnline('Se ha perdido la conexión con el anfitrión.');
    return;
  }

  if (!G.NET.host && now - (G.NET.pingTimer || 0) > 1500) {
    G.NET.pingTimer = now;
    netSendTo(0, { t: 'ping', ts: now });
  }

  const my = G.NET.my;
  const P = G.P;
  const wid = Math.max(0, WEAPON_IDS.indexOf(P.weaponId || 'm16'));
  const ds = DROP_PHASES[G.DROP.phase] !== undefined ? DROP_PHASES[G.DROP.phase] : 3;

  netSend({
    t: 's',
    x: r2(P.x), y: r2(P.y), z: r2(P.z),
    a: Math.round(P.yaw * 1000) / 1000,
    p: Math.round(P.pitch * 1000) / 1000,
    f: r2(my.fwd), s: r2(my.side), v: r2(my.spd),
    w: my.wade ? 1 : 0, g: P.ground ? 1 : 0,
    h: Math.round(P.hp), q: Math.round(P.sh),
    d: P.dead ? 1 : 0,
    wi: wid,
    ds,
    c: G.inCar ? 1 : 0,
    cy: Math.round(G.V.yaw * 1000) / 1000,
    ci: G.inCar && G.curCar ? G.curCar.idx : 0,
    vs: G.inCar ? r2(G.V.speed) : 0,
  });

  if (G.NET.host && (G.NET.nb | 0) > 0) botsBroadcast(netSend);
}

function netRecvState(m, r) {
  const u = r.root.userData;
  r.tx = +m.x || 0; r.ty = +m.y || 0; r.tz = +m.z || 0;
  r.tyaw = +m.a || 0; r.tpitch = +m.p || 0;
  r.fwd = +m.f || 0; r.side = +m.s || 0; r.spd = +m.v || 0;
  r.wade = !!m.w; r.ground = !!m.g; r.hp = +m.h; r.sh = +m.q || 0; r.vs = +m.vs || 0;
  r.wid = m.wi | 0;
  r.ds = m.ds !== undefined ? (m.ds | 0) : 3;
  const snap = () => { r.x = r.tx; r.y = r.ty; r.z = r.tz; r.yaw = r.tyaw; r.pitch = r.tpitch; };
  if (!r.ready) { snap(); r.ready = true; }
  const dead = !!m.d;
  if (dead && !r.dead) { r.dead = true; u.t = 0; }
  else if (!dead && r.dead) {
    r.dead = false; u.t = 0; u.st = mkState();
    snap();
  }
  if (m.c && !(performance.now() < (G.NET.vt || 0))) {
    r.carT = { x: r.tx, z: r.tz, yaw: +m.cy || 0, i: (+m.ci | 0) };
    if (!r.inCar) {
      r.inCar = true;
      if (G.inCar && G.curCar && G.curCar.idx === r.carT.i && G.NET.id > r.id) {
        toggleCar(true, { onToast: uiHooks.toast });
        if (uiHooks.toast) uiHooks.toast(r.name + ' ha cogido el vehículo antes');
      }
    }
  } else if (r.inCar) {
    r.inCar = false;
    if (r.carT) {
      const c = G.CARS[r.carT.i];
      if (c && !(G.inCar && G.curCar === c)) {
        c.st.x = r.carT.x; c.st.z = r.carT.z; c.st.yaw = r.carT.yaw; c.st.speed = 0;
        updateCarTransform(c);
      }
    }
  }
}

export function netFrame(dt, fwd, side, spd, wade) {
  const my = G.NET.my;
  my.fwd = fwd; my.side = side; my.spd = spd; my.wade = wade;
  if (!G.ONLINE) return;
  const k = Math.min(1, dt * 14);
  for (const id in G.RMS) {
    const r = G.RMS[id], u = r.root.userData;
    if (!r.ready) { r.root.visible = false; continue; }
    if (Math.hypot(r.tx - r.x, r.tz - r.z) > 10) {
      r.x = r.tx; r.y = r.ty; r.z = r.tz; r.yaw = r.tyaw;
    } else {
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; r.yaw += wrap(r.tyaw - r.yaw) * k;
    }
    r.pitch += (r.tpitch - r.pitch) * k;

    const weaponId = WEAPON_IDS[r.wid] || 'm16';
    const ds = r.ds !== undefined ? r.ds : 3;

    if (ds === 0 && !r.dead) {
      r.root.visible = false;
      if (u.glider) u.glider.visible = false;
      continue;
    }

    const mc = r.inCar && r.carT && r.carT.i >= 4 && !r.dead ? G.CARS[r.carT.i] : null;
    if (mc && mc.root) {
      if (u.mounted !== mc) mountRider(r.root, mc);
      r.root.visible = true;
    } else {
      if (u.mounted) dismountRider(r.root);
      r.root.visible = !r.inCar;
      r.root.position.set(r.x, r.y, r.z);
      r.root.rotation.y = r.yaw;
    }
    r.shootT -= dt;

    if (r.dead) {
      animDead(r.root, dt);
      u.fl.visible = false;
    } else if (u.mounted) {
      u.fl.visible = false;
      equipActorWeapon(r.root, weaponId, true);
      if (u.glider) u.glider.visible = false;
      ridePose(r.root, u.mounted);
    } else if (ds === 1) {
      u.fl.visible = false;
      equipActorWeapon(r.root, weaponId, true);
      if (u.glider) u.glider.visible = false;
      animSkydive(r.root, dt, 0, 1);
    } else if (ds === 2) {
      u.fl.visible = false;
      equipActorWeapon(r.root, weaponId, true);
      if (u.glider) u.glider.visible = true;
      animGlide(r.root, dt, 0);
    } else {
      if (u.glider) u.glider.visible = false;
      equipActorWeapon(r.root, weaponId, false);
      if (u.rifle && u.rifle.userData.mz && u.fl.parent !== u.rifle.userData.mz) {
        u.rifle.userData.mz.add(u.fl);
      }
      u.fl.visible = r.shootT > 0.17;
      animate(r.root, dt, { fwd: r.fwd, side: r.side, spd: r.spd, wade: r.wade, walk: false, shoot: r.shootT > 0, pitch: r.pitch, ground: r.ground, land: 0, reload: 0 });
    }

    if (r.inCar && r.carT) {
      const t = r.carT, car = G.CARS[t.i];
      if (car && !(G.inCar && G.curCar === car)) {
        const w = car.st;
        if (Math.hypot(t.x - w.x, t.z - w.z) > 10) { w.x = t.x; w.z = t.z; w.yaw = t.yaw; }
        else { w.x += (t.x - w.x) * k; w.z += (t.z - w.z) * k; w.yaw += wrap(t.yaw - w.yaw) * k; }
        w.speed = 0;
        updateCarTransform(car);
        crankUpdate(car, r.vs || 0, dt, (r.vs || 0) > 0.5);
      }
    }
  }
}

const _mv = new THREE.Vector3();
export function netMarker() {
  let camOk = false;
  for (const id in G.RMS) {
    const r = G.RMS[id], tag = r.tag;
    if (!G.ONLINE || !r.ready || r.dead || G.MENU_OPEN || r.ds === 0) { tag.style.display = 'none'; continue; }
    if (!camOk) { G.cam.updateMatrixWorld(); camOk = true; }
    _mv.set(r.x, r.y + 3.1, r.z).project(G.cam);
    let x = _mv.x, y = _mv.y;
    if (_mv.z > 1) { x = -x; y = -y; if (Math.hypot(x, y) < 0.3) y = -1; }
    const e = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86, 1);
    x /= e; y /= e;
    tag.style.display = 'block';
    tag.style.left = ((x * 0.5 + 0.5) * 100).toFixed(2) + '%';
    tag.style.top = ((0.5 - y * 0.5) * 100).toFixed(2) + '%';
    if (r.tn.textContent !== r.name) r.tn.textContent = r.name;
    r.th.style.width = Math.max(0, Math.min(100, r.hp)) + '%';
    r.td.textContent = Math.round(Math.hypot(r.x - G.P.x, r.z - G.P.z)) + ' m';
  }
}

export function netShot(end, waterHit, hitRoot, dmg = 25) {
  netSend({ t: 'shot', e: [r2(end.x), r2(end.y), r2(end.z)], w: waterHit ? 1 : 0 });
  if (hitRoot && hitRoot.userData.bi !== undefined) {
    const bi = hitRoot.userData.bi;
    G.P.damageDealt += dmg;
    if (G.NET.host) {
      netBotDamage(bi, dmg, G.NET.id, {
        onKillsChanged: uiHooks.onKillsChanged,
        onNetBotKilled: (by, botName) => {
          netSend({ t: 'bk', by });
          const killer = G.NET.players[by] ? G.NET.players[by].name : 'Jugador';
          broadcastKillFeed(killer, botName || 'Bot');
        },
      });
    } else {
      netSendTo(0, { t: 'bh', b: bi, d: dmg });
    }
    if (hitRoot.userData.mat) {
      hitRoot.userData.mat.emissive.setHex(0x884422);
      setTimeout(() => { if (hitRoot.userData.mat) hitRoot.userData.mat.emissive.setHex(0); }, 70);
    }
  } else if (hitRoot && hitRoot.userData.rid !== undefined && G.RMS[hitRoot.userData.rid]) {
    G.P.damageDealt += dmg;
    netSendTo(hitRoot.userData.rid, { t: 'hit', d: dmg });
    if (hitRoot.userData.mat) {
      hitRoot.userData.mat.emissive.setHex(0x884422);
      setTimeout(() => { if (hitRoot.userData.mat) hitRoot.userData.mat.emissive.setHex(0); }, 70);
    }
  }
}

export function netDied(by) {
  if (!G.ONLINE) return;
  const b = typeof by === 'number' && by >= 0 && G.NET.players[by] ? by : -1;
  netSend({ t: 'died', by: b });
  applyDied(G.NET.id, b);
}

function broadcastKillFeed(killer, victim) {
  if (uiHooks.addKillFeed) uiHooks.addKillFeed(killer, victim);
  if (G.NET.host) netSend({ t: 'kf', k: killer, v: victim });
}

export function applyDied(victim, by) {
  if (G.NET.ended) return;
  const v = G.NET.players[victim], k = by >= 0 ? G.NET.players[by] : null;
  if (v) { v.d++; v.dead = true; v.out = ++G.NET.outN; }
  if (k) k.k++;
  if (by === G.NET.id && k) {
    G.P.kills = k.k;
    if (!G.P.dead) G.P.hp = Math.min(100, G.P.hp + 50);
  }
  if (v && uiHooks.addKillFeed) {
    uiHooks.addKillFeed(k ? k.name : 'Tormenta', v.name);
  }
  if (uiHooks.updateNetHud) uiHooks.updateNetHud();
  if (uiHooks.onKillsChanged) uiHooks.onKillsChanged();
  brCheckWin({ onHostWin: hostWin });
}

export function hostWin(id) {
  if (G.NET.ended) return;
  G.NET.ended = true;
  netSend({ t: 'end', w: id });
  if (id === G.NET.id) triggerVictoryFx();
  else G.VICTORY_STATE = 'loss';
  if (uiHooks.showOnlineEnd) uiHooks.showOnlineEnd(id);
}

function guestJoined(id, name) {
  name = cleanName(name) || 'Jugador';
  G.NET.players[id] = { id, name, k: 0, d: 0 };
  addRemote(id, name);
  if (G.NET.host) G.NET.nb = resolveOnlineBotCount(Object.keys(G.NET.players).length);
  if (G.ONLINE) {
    if (uiHooks.updateNetHud) uiHooks.updateNetHud();
    if (uiHooks.toast) uiHooks.toast(name + ' se ha unido');
  } else if (uiHooks.renderLobby) {
    uiHooks.renderLobby();
  }
}

function guestLeft(id) {
  const p = G.NET.players[id];
  dropRemote(id);
  if (G.NET.host) G.NET.nb = resolveOnlineBotCount(Object.keys(G.NET.players).length);
  if (G.ONLINE) {
    if (uiHooks.updateNetHud) uiHooks.updateNetHud();
    if (p && uiHooks.toast) uiHooks.toast(p.name + ' se ha ido');
    brCheckWin({ onHostWin: hostWin });
  } else if (uiHooks.renderLobby) {
    uiHooks.renderLobby();
  }
}

function dropGuest(id) {
  const c = G.NET.conns.get(id);
  G.NET.conns.delete(id);
  try { c && c.close(); } catch (_) {}
  guestLeft(id);
  relay({ t: 'leave', id, i: 0 }, id);
}

const rateLog = new Map();
function allowHitFrom(senderId) {
  const now = performance.now();
  const rec = rateLog.get(senderId) || { t: now, count: 0 };
  if (now - rec.t > 1000) { rec.t = now; rec.count = 0; }
  rec.count++;
  rateLog.set(senderId, rec);
  return rec.count <= 28;
}

function onNetMsg(m, from) {
  if (!m || typeof m !== 'object') return;
  if (G.NET.host) m.i = from;
  else G.NET.lastRx = performance.now();
  const r = G.RMS[m.i];
  const arr3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);

  if (G.NET.host && ['s', 'shot', 'g', 'pot', 'died'].includes(m.t)) {
    relay(m, from);
  }

  switch (m.t) {
    case 'ping':
      if (G.NET.host) netSendTo(from, { t: 'pong', ts: m.ts });
      break;
    case 'pong':
      if (!G.NET.host && typeof m.ts === 'number') {
        G.NET.pingMs = Math.max(1, Math.round(performance.now() - m.ts));
      }
      break;
    case 'cfg':
      if (!G.NET.host) {
        G.NET.botPref = m.botPref;
        G.NET.nb = m.nb | 0;
        if (uiHooks.renderLobby) uiHooks.renderLobby();
      }
      break;
    case 'welcome':
      if (G.NET.host) break;
      clearTimeout(G.NET.to);
      G.NET.el = +m.el || 0;
      G.NET.id = m.id | 0;
      G.NET.seed = m.seed | 0;
      G.NET.target = (m.target | 0) || 10;
      G.NET.botPref = m.botPref !== undefined ? m.botPref : 'auto';
      G.NET.nb = m.nb | 0;
      G.NET.players = {};
      for (const p of (m.players || [])) {
        const nm = cleanName(p.name) || 'Jugador';
        G.NET.players[p.id | 0] = { id: p.id | 0, name: nm, k: p.k | 0, d: p.d | 0, dead: !!p.dead, out: p.out === undefined ? undefined : (p.out | 0) };
        if ((p.id | 0) !== G.NET.id) addRemote(p.id | 0, nm);
      }
      if (!G.NET.players[G.NET.id]) G.NET.players[G.NET.id] = { id: G.NET.id, name: G.NET.name, k: 0, d: 0 };
      if (m.started) {
        G.NET.late = true;
        startMatch();
        applyVehHp(m.vh);
      } else if (uiHooks.onJoinedLobby) {
        uiHooks.onJoinedLobby();
      }
      break;
    case 'full':
      if (!G.NET.host && uiHooks.onFail) fail('La sala está llena.');
      break;
    case 'join':
      if (!G.NET.host && m.id !== G.NET.id) guestJoined(m.id | 0, m.name);
      break;
    case 'leave':
      if (!G.NET.host && (m.id | 0) !== G.NET.id) guestLeft(m.id | 0);
      break;
    case 'start':
      if (!G.NET.host) {
        G.NET.seed = m.seed | 0;
        G.NET.nb = m.nb | 0;
        G.NET.el = 0;
        startMatch();
      }
      break;
    case 'b':
      if (G.ONLINE && !G.NET.host && Array.isArray(m.a)) {
        for (const e of m.a) {
          const h = G.bots[e[0] | 0];
          if (!h || e.length < 11) continue;
          const b = h.userData.root, u = b.userData, first = !u.nt;
          const flags = e[9] | 0;
          u.nt = {
            x: +e[1] || 0, y: +e[2] || 0, z: +e[3] || 0, yaw: +e[4] || 0, pitch: +e[5] || 0,
            fwd: +e[6] || 0, side: +e[7] || 0, spd: +e[8] || 0,
            walk: !!(flags & 2), shoot: !!(flags & 4), ds: (flags >> 3) & 3,
          };
          if (first) {
            b.position.set(u.nt.x, u.nt.y, u.nt.z);
            b.rotation.y = u.nt.yaw;
            b.visible = u.nt.ds !== 0;
          }
          const dead = !!(flags & 1);
          if (dead && !u.dead) { u.dead = true; u.t = 0; }
          else if (!dead && u.dead) {
            u.dead = false; u.t = 0; u.st = mkState();
          }
          u.hp = +e[10] || 0;
        }
      }
      break;
    case 'bf':
      if (G.ONLINE && !G.NET.host && arr3(m.e)) {
        const h = G.bots[m.b | 0];
        if (h && h.userData.root.userData.rifle) {
          const u = h.userData.root.userData, fromV = new THREE.Vector3();
          u.rifle.userData.mz.getWorldPosition(fromV);
          u.flT = 0.06;
          waterJet(fromV, new THREE.Vector3().fromArray(m.e), 0xff7a5a);
        }
      }
      break;
    case 'bk':
      if (G.ONLINE && !G.NET.host) applyBotKill(m.by | 0, { onKillsChanged: uiHooks.onKillsChanged });
      break;
    case 'kf':
      if (G.ONLINE && !G.NET.host && uiHooks.addKillFeed) uiHooks.addKillFeed(m.k, m.v);
      break;
    case 'bh':
      if (G.ONLINE && G.NET.host && allowHitFrom(from)) {
        netBotDamage(m.b | 0, Math.max(0, Math.min(150, +m.d || 0)), from, {
          onKillsChanged: uiHooks.onKillsChanged,
          onNetBotKilled: (by, botName) => {
            netSend({ t: 'bk', by });
            const killer = G.NET.players[by] ? G.NET.players[by].name : 'Jugador';
            broadcastKillFeed(killer, botName || 'Bot');
          },
        });
      }
      break;
    case 'vh':
      if (G.ONLINE && G.NET.host && allowHitFrom(from)) {
        vehDamage(G.CARS[m.c | 0], Math.max(0, Math.min(250, +m.d || 0)), {
          onNetVehHp: (idx, hp) => netSend({ t: 'vhp', c: idx, hp }),
          onToast: uiHooks.toast,
        });
      }
      break;
    case 'vhp': {
      const c = G.CARS[m.c | 0];
      if (G.ONLINE && !G.NET.host && c && +m.hp < c.hp) {
        c.hp = Math.max(0, +m.hp);
        if (c.hp <= 0) vehDamage(c, 9999);
      }
      break;
    }
    case 's':
      if (G.ONLINE && r) netRecvState(m, r);
      break;
    case 'shot':
      if (G.ONLINE && r && r.ready && arr3(m.e)) {
        r.shootT = 0.25;
        const fromV = new THREE.Vector3(), end = new THREE.Vector3().fromArray(m.e);
        r.root.userData.rifle.userData.mz.getWorldPosition(fromV);
        waterJet(fromV, end);
        if (m.w) waterSplash(end);
      }
      break;
    case 'hit':
      if ((m.to | 0) === G.NET.id) {
        if (G.ONLINE && !G.NET.ended) {
          hurt(Math.max(0, Math.min(40, +m.d || 0)), m.bot ? -1 : m.i, false, {
            onNetDied: netDied,
            onDismount: forceDismount,
            onPlayerDied: uiHooks.onPlayerDied,
            onDamageIndicator: uiHooks.onDamageIndicator,
          });
        }
      } else if (G.NET.host && allowHitFrom(from)) {
        relay(m, from, m.to | 0);
      }
      break;
    case 'g':
      if (G.ONLINE && r && arr3(m.o) && arr3(m.v)) spawnRemoteGrenade(m.o, m.v, m.i);
      break;
    case 'pot': {
      const p = G.POT[m.i2 | 0];
      if (G.ONLINE && p && p.on) { p.on = false; p.root.visible = false; p.wait = POT_RESPAWN; }
      break;
    }
    case 'died':
      if (G.ONLINE && r) applyDied(m.i, (m.by | 0) === m.by ? m.by : -1);
      break;
    case 'win':
      if (G.NET.host && G.ONLINE) hostWin(m.i);
      break;
    case 'end':
      if (!G.NET.host && G.ONLINE && !G.NET.ended) {
        G.NET.ended = true;
        if ((m.w | 0) === G.NET.id) triggerVictoryFx();
        else G.VICTORY_STATE = 'loss';
        if (uiHooks.showOnlineEnd) uiHooks.showOnlineEnd(m.w | 0);
      }
      break;
  }
}

export function startMatch() {
  ensureBotPool(Math.max(12, G.NET.nb | 0));
  G.ONLINE = true;
  G.MENU_OPEN = false;
  G.GAME_ACTIVE = true;
  G.NET.started = true;
  G.NET.ended = false;
  G.VICTORY_STATE = null;
  disableShowcaseLights();

  if (!G.NET.late) {
    for (const p of Object.values(G.NET.players)) {
      p.k = 0; p.d = 0; p.dead = false;
      delete p.out;
    }
  }
  if (!G.NET.iv) G.NET.iv = setInterval(netTick, 50);

  for (const h of G.bots) {
    const b = h.userData.root;
    b.userData.dead = true;
    b.userData.nt = null;
    b.visible = false;
  }
  for (const g of G.grens) G.scene.remove(g.m);
  G.grens.length = 0;
  endDrink();
  resetInventory();
  G.POT.forEach((p, i) => { p.gen = 0; placePot(p, i < 3); });
  spawnLootDrops(G.NET.seed);

  const ready = Object.values(G.RMS).filter(r => r.ready).map(r => [r.x, r.z]);
  G.NET.nextSpawn = G.NET.late && ready.length
    ? pickSpawn(ready)
    : G.SPAWNS[Math.round(G.NET.id * G.SPAWNS.length / G.NET.max) % G.SPAWNS.length];

  const me = G.NET.players[G.NET.id];
  G.P.kills = G.NET.late && me ? me.k : 0;
  G.P.deaths = G.NET.late && me ? me.d : 0;
  const elapsed = G.NET.el || 0;
  G.NET.late = false;
  respawn({ netSpawn, onDismount: forceDismount });

  for (const id in G.RMS) { G.RMS[id].inCar = false; G.RMS[id].carT = null; }
  G.NET.vt = performance.now() + 1500;
  G.NET.outN = 0;
  brStart(G.NET.seed, elapsed);
  startDropPhase(G.NET.seed, elapsed);
  G.NET.el = 0;
  placeVehicles(G.NET.seed);

  if (G.NET.host) {
    G.bots.forEach((h, i) => {
      if (i < (G.NET.nb | 0)) spawnBot(h.userData.root, true);
    });
  }

  if (uiHooks.onMatchStarted) uiHooks.onMatchStarted();
}

export function leaveOnline(msg = '') {
  brStop();
  clearTimeout(G.NET.to);
  clearInterval(G.NET.iv);
  G.NET.iv = 0;
  const cs = [...G.NET.conns.values(), G.NET.conn], p = G.NET.peer;
  G.NET.conn = G.NET.peer = null;
  G.NET.conns.clear();
  G.ONLINE = false;
  G.GAME_ACTIVE = false;
  G.NET.started = false;
  G.NET.ended = false;
  G.NET.pingMs = 0;
  for (const c of cs) try { c && c.close(); } catch (_) {}
  try { p && p.destroy(); } catch (_) {}
  for (const id of Object.keys(G.RMS)) dropRemote(id);
  G.NET.players = {}; G.NET.id = 0; G.NET.nextId = 1; G.NET.host = false;

  for (const g of G.grens) G.scene.remove(g.m);
  G.grens.length = 0;
  endDrink();
  forceDismount();
  G.NET.nextSpawn = null;
  G.P.kills = 0; G.P.deaths = 0;
  respawn({ onDismount: forceDismount });
  G.POT.forEach((q, i) => placePot(q, i < 3));
  G.NET.nb = 0;
  G.bots.forEach(h => spawnBot(h.userData.root));
  if (uiHooks.onLeftOnline) uiHooks.onLeftOnline(msg);
}

export function fail(msg) {
  clearTimeout(G.NET.to);
  const cs = [...G.NET.conns.values(), G.NET.conn], p = G.NET.peer;
  G.NET.conn = G.NET.peer = null;
  G.NET.conns.clear();
  for (const c of cs) try { c && c.close(); } catch (_) {}
  try { p && p.destroy(); } catch (_) {}
  for (const id of Object.keys(G.RMS)) dropRemote(id);
  G.NET.players = {}; G.NET.host = false; G.NET.id = 0; G.NET.nextId = 1;
  if (uiHooks.onFail) uiHooks.onFail(msg);
}

function wireHost(c) {
  c.on('data', m => {
    c.lastRx = performance.now();
    if (c.pid === undefined) {
      if (!m || m.t !== 'hello') return;
      if (G.NET.conns.size + 1 >= G.NET.max) {
        try { c.send({ t: 'full' }); } catch (_) {}
        setTimeout(() => { try { c.close(); } catch (_) {} }, 300);
        return;
      }
      const id = (c.pid = G.NET.nextId++), name = cleanName(m.name) || 'Jugador';
      G.NET.conns.set(id, c);
      G.NET.players[id] = { id, name, k: 0, d: 0 };
      addRemote(id, name);
      G.NET.nb = resolveOnlineBotCount(Object.keys(G.NET.players).length);
      c.send({
        t: 'welcome',
        el: G.BR.on ? brTime() : 0,
        id,
        seed: G.NET.seed,
        target: G.NET.target,
        started: G.NET.started,
        botPref: G.NET.botPref,
        nb: G.NET.nb | 0,
        vh: G.CARS.map(car => (car ? Math.round(car.hp) : -1)),
        i: 0,
        players: Object.values(G.NET.players),
      });
      relay({ t: 'join', id, name, i: 0 }, id);
      if (G.ONLINE) {
        if (uiHooks.updateNetHud) uiHooks.updateNetHud();
        if (uiHooks.toast) uiHooks.toast(name + ' se ha unido');
      } else if (uiHooks.renderLobby) {
        uiHooks.renderLobby();
      }
      return;
    }
    onNetMsg(m, c.pid);
  });
  const gone = () => { if (c.pid !== undefined && G.NET.conns.get(c.pid) === c) dropGuest(c.pid); };
  c.on('close', gone);
  c.on('error', gone);
}

function wireGuest(c) {
  c.on('open', () => {
    G.NET.lastRx = performance.now();
    c.send({ t: 'hello', name: G.NET.name });
  });
  c.on('data', m => onNetMsg(m, 0));
  const gone = () => {
    if (c === G.NET.conn) {
      if (G.ONLINE || G.NET.players[G.NET.id]) leaveOnline('El anfitrión ha cerrado la sala o se ha perdido la conexión.');
      else fail('No se pudo establecer la conexión con la sala.');
    }
  };
  c.on('close', gone);
  c.on('error', gone);
}

export async function hostRoom(n = 0) {
  if (uiHooks.onBusy) uiHooks.onBusy(true, 'Creando sala P2P…');
  try { await loadPeerLib(); }
  catch (_) { return fail('No se pudo cargar PeerJS. ¿Tienes conexión a internet?'); }

  G.NET.host = true; G.NET.id = 0; G.NET.nextId = 1;
  G.NET.code = genCode();
  G.NET.seed = (Math.random() * 1e9) | 0;
  G.NET.players = { 0: { id: 0, name: G.NET.name, k: 0, d: 0 } };
  G.NET.nb = resolveOnlineBotCount(1);

  const peer = (G.NET.peer = new Peer(PFX + G.NET.code, peerOpts()));
  peer.on('open', () => {
    if (uiHooks.onRoomHosted) uiHooks.onRoomHosted();
  });
  peer.on('connection', wireHost);
  peer.on('error', e => {
    if (e.type === 'unavailable-id' && n < 5) {
      G.NET.peer = null;
      try { peer.destroy(); } catch (_) {}
      hostRoom(n + 1);
    } else if (!G.ONLINE && peer === G.NET.peer) {
      fail('No se pudo crear la sala (' + e.type + ').');
    }
  });
  peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (_) {} });
}

export async function joinRoom(code) {
  if (uiHooks.onBusy) uiHooks.onBusy(true, 'Conectando con la sala ' + code + '…');
  try { await loadPeerLib(); }
  catch (_) { return fail('No se pudo cargar PeerJS. ¿Tienes conexión a internet?'); }

  G.NET.host = false;
  G.NET.code = code;
  G.NET.players = {};
  const peer = (G.NET.peer = new Peer(undefined, peerOpts()));
  G.NET.to = setTimeout(() => {
    if (!G.ONLINE && !G.NET.players[G.NET.id]) fail('No se ha podido conectar con la sala. Revisa el código o inténtalo de nuevo.');
  }, 20000);
  peer.on('open', () => {
    const c = (G.NET.conn = peer.connect(PFX + code, { reliable: true, serialization: 'json' }));
    wireGuest(c);
  });
  peer.on('error', e => {
    if (!G.ONLINE && peer === G.NET.peer) {
      fail(e.type === 'peer-unavailable' ? 'No existe ninguna sala con ese código.' : 'Error de conexión (' + e.type + ').');
    }
  });
}

export function hostStartOnlineMatch() {
  if (!G.NET.host || Object.keys(G.NET.players).length < 2) return;
  G.NET.seed = (Math.random() * 1e9) | 0;
  G.NET.nb = resolveOnlineBotCount(Object.keys(G.NET.players).length);
  netSend({ t: 'start', seed: G.NET.seed, nb: G.NET.nb });
  startMatch();
}
