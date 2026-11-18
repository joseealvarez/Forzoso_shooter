// Main entry point for Isla Battle: initializes modules, manages match lifecycle,
// Battle Bus drop phase, tactical map toggle, input controls, and primary rAF loop.

import { G, SETTINGS, loadSavedPrefs } from './state.js';
import { unlockAudio } from './audio.js';
import { initWorld, updateWorldEnvironment, RACE } from './world.js';
import {
  initPlayerSystem, applyCustomization, respawn,
  updatePlayerMovement, updateGameplayCamera, updateMenuShowcase,
  updateVictoryCamera, disableShowcaseLights, setHurtT, hurtT,
} from './player.js';
import {
  initWeaponsAndPickups, INVENTORY, getActiveWeaponDef, selectSlot,
  startReload, shoot, drink, potionsUpdate, spawnLootDrops, updateLoots,
  throwGrenade, grenadesUpdate, updateEffects, updateVictoryFx, placePot,
} from './weapons.js';
import {
  initVehicles, placeVehicles, toggleCar, updateVehicleDriving,
  forceDismount, vehHit, vehFx,
} from './vehicles.js';
import { initBots, ensureBotPool, spawnBot, botsUpdate, netBotDamage } from './bots.js';
import {
  initBattleRoyale, brStart, brStop, brZone, brUpdate, specTarget,
  renderMinimap, brTime, startDropPhase, jumpFromBus, toggleGlider,
  updateDropPhase, updateDropCamera,
} from './battle-royale.js';
import { bindNetHooks, netTargets, netShot, netSend, netSendTo, netTick, netFrame, netMarker, netDied, leaveOnline, carDrivenRemote } from './net.js';
import {
  initUI, setLoadProgress, hideLoading, showToast, showHitmarker,
  triggerDamageIndicator, addKillFeed, openMenuScreen, updateNetHud,
  updateZoneHud, showMatchEndScreen, hideEndScreens, updateHUDFrame, toggleMapModal,
} from './ui.js';

let ui = null;
let lastTime = performance.now();

function shootTargets() {
  const vehHbs = G.CARS.filter(c => c && !c.dead && !(G.inCar && G.curCar === c)).map(c => c.hb);
  if (G.ONLINE) return netTargets().concat(vehHbs);
  return G.bots.filter(h => h.userData.root.userData.bi < G.activeBotCount && !h.userData.root.userData.dead && h.userData.root.visible).concat(vehHbs);
}

const gameplayHooks = {
  shootTargets,
  onToast: showToast,
  onHitmarker: showHitmarker,
  onDamageIndicator: triggerDamageIndicator,
  onBotKilled: b => {
    const nm = b && b.userData ? b.userData.name : 'Bot';
    addKillFeed(G.NET.name || 'Tú', nm);
  },
  onVehHit: (car, dmg) => vehHit(car, dmg, {
    onToast: showToast,
    onNetVehHit: (idx, d) => netSendTo(0, { t: 'vh', c: idx, d }),
    onNetVehHp: (idx, hp) => netSend({ t: 'vhp', c: idx, hp }),
  }),
  onNetShot: (end, waterHit, hitRoot, dmg) => netShot(end, waterHit, hitRoot, dmg),
  onNetGrenade: (o, v) => netSend({ t: 'g', o: o.toArray(), v: v.toArray() }),
  onNetPot: idx => netSend({ t: 'pot', i2: idx }),
  onNetBotExplode: (bi, dm) => {
    G.P.damageDealt += dm;
    if (G.NET.host) {
      netBotDamage(bi, dm, G.NET.id, {
        onKillsChanged: () => updateNetHud(),
        onNetBotKilled: (by, botName) => {
          netSend({ t: 'bk', by });
          const killer = G.NET.players[by] ? G.NET.players[by].name : 'Jugador';
          addKillFeed(killer, botName || 'Bot');
          netSend({ t: 'kf', k: killer, v: botName || 'Bot' });
        },
      });
    } else {
      netSendTo(0, { t: 'bh', b: bi, d: dm });
    }
  },
  onNetBotFire: (bi, to) => netSend({ t: 'bf', b: bi, e: [Math.round(to.x * 100) / 100, Math.round(to.y * 100) / 100, Math.round(to.z * 100) / 100] }),
  onNetHitPlayer: (id, d) => netSendTo(id, { t: 'hit', d, bot: 1 }),
  onNetDied: by => netDied(by),
  onDismount: forceDismount,
  onPlayerDied: () => {
    if (G.ONLINE && document.pointerLockElement) {
      try { document.exitPointerLock(); } catch (_) {}
    }
  },
  onKillsChanged: () => updateNetHud(),
  onZoneHud: info => updateZoneHud(info),
  onSoloEnd: (won, remainingBots) => {
    showMatchEndScreen(won, {
      kills: G.P.kills,
      damage: G.P.damageDealt,
      duration: brTime(),
      remaining: remainingBots,
      title: won ? '¡VICTORIA ROYALE!' : 'ELIMINADO EN LA ISLA',
      subtitle: won ? 'Has derrotado a todos los rivales de Isla Battle' : `Quedaban ${remainingBots} supervivientes`,
    });
  },
};

function requestLock() {
  if (G.MENU_OPEN || G.VICTORY_STATE || G.P.dead || G.MAP_OPEN) return;
  try {
    document.body.requestPointerLock();
  } catch (_) {}
}

function syncPauseOverlay() {
  const overEl = document.getElementById('over');
  if (!overEl) return;
  const shouldPause = !G.MENU_OPEN && G.GAME_ACTIVE && !G.VICTORY_STATE && !G.locked && !G.P.dead && !G.MAP_OPEN && G.DROP.phase !== 'bus';
  overEl.style.display = shouldPause ? 'flex' : 'none';
}

export function startSoloMatch(botCount) {
  unlockAudio();
  hideEndScreens();
  G.ONLINE = false;
  G.MENU_OPEN = false;
  G.GAME_ACTIVE = true;
  G.MAP_OPEN = false;
  toggleMapModal(false);
  G.VICTORY_STATE = null;
  G.activeBotCount = Math.max(1, Math.min(24, botCount | 0));
  ensureBotPool(G.activeBotCount);
  disableShowcaseLights();

  for (const g of G.grens) G.scene.remove(g.m);
  G.grens.length = 0;
  forceDismount();
  G.P.kills = 0;
  G.P.deaths = 0;
  respawn({ onDismount: forceDismount });

  const seed = (Math.random() * 1e9) | 0;
  G.POT.forEach((p, i) => { p.gen = 0; placePot(p, i < 3); });
  spawnLootDrops(seed);
  placeVehicles(seed);

  brStart(seed, 0);
  startDropPhase(seed, 0);

  G.bots.forEach((h, i) => {
    const b = h.userData.root;
    if (i < G.activeBotCount) spawnBot(b, true);
    else { b.userData.dead = true; b.visible = false; }
  });

  if (RACE) RACE.stop();
  document.getElementById('killFeed').innerHTML = '';
  syncPauseOverlay();

  requestLock();
  showToast(`Autobús de Combate: Tú vs ${G.activeBotCount} bots · Pulsa [ESPACIO] para saltar`);
}

export function returnToMenu() {
  hideEndScreens();
  G.MAP_OPEN = false;
  toggleMapModal(false);
  if (document.pointerLockElement) {
    try { document.exitPointerLock(); } catch (_) {}
  }
  if (G.ONLINE) {
    leaveOnline();
  } else {
    brStop();
  }
  G.ONLINE = false;
  G.GAME_ACTIVE = false;
  G.MENU_OPEN = true;
  G.VICTORY_STATE = null;
  G.mouse = false;
  G.rmb = false;
  forceDismount();
  if (RACE) RACE.stop();
  G.bots.forEach(h => {
    h.userData.root.userData.dead = true;
    h.userData.root.visible = false;
  });
  syncPauseOverlay();
  openMenuScreen('main');
}

function bindInputs() {
  window.addEventListener('resize', () => {
    if (!G.renderer || !G.cam) return;
    G.cam.aspect = window.innerWidth / window.innerHeight;
    G.cam.updateProjectionMatrix();
    G.renderer.setSize(window.innerWidth, window.innerHeight);
  });

  document.addEventListener('pointerlockchange', () => {
    G.locked = document.pointerLockElement === document.body;
    if (!G.locked) {
      G.mouse = false;
      G.rmb = false;
    }
    syncPauseOverlay();
  });

  document.addEventListener('mousemove', e => {
    if (!G.locked || G.MENU_OPEN || G.VICTORY_STATE || G.MAP_OPEN) return;
    const sens = 0.0022 * (SETTINGS.sensitivity || 1.0) * (1 - 0.45 * G.AIM);
    G.P.yaw -= e.movementX * sens;
    G.P.pitch = Math.max(-1.05, Math.min(0.95, G.P.pitch - e.movementY * sens));
  });

  document.addEventListener('mousedown', e => {
    unlockAudio();
    if (G.MENU_OPEN || G.VICTORY_STATE || G.MAP_OPEN) return;
    if (e.target.closest('button, input, select, .inv-slot, #minimapFrame, #mapModal, #dropHud')) return;
    if (!G.locked) {
      requestLock();
      return;
    }
    if (G.DROP.phase !== 'landed') return;
    if (e.button === 0) G.mouse = true;
    if (e.button === 2) G.rmb = true;
  });

  document.addEventListener('mouseup', e => {
    if (e.button === 0) G.mouse = false;
    if (e.button === 2) G.rmb = false;
  });

  document.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('wheel', e => {
    if (G.MENU_OPEN || !G.GAME_ACTIVE || G.P.dead || G.MAP_OPEN) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    let next = (INVENTORY.activeSlot + dir + 4) % 4;
    for (let k = 0; k < 4; k++) {
      if (INVENTORY.slots[next] && INVENTORY.slots[next].type !== 'shield') {
        selectSlot(next, { onToast: showToast });
        break;
      }
      next = (next + dir + 4) % 4;
    }
  });

  document.addEventListener('keydown', e => {
    G.keys[e.code] = true;
    if (G.MENU_OPEN) return;

    if (e.code === 'Space' && G.GAME_ACTIVE && !G.VICTORY_STATE && !G.MAP_OPEN) {
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
        document.activeElement.blur();
      }
    }

    if (e.code === 'KeyM' && G.GAME_ACTIVE && !G.VICTORY_STATE) {
      e.preventDefault();
      toggleMapModal();
      return;
    }
    if (e.code === 'Escape' && G.MAP_OPEN) {
      toggleMapModal(false);
      return;
    }

    if (G.MAP_OPEN) return;

    const landed = G.DROP.phase === 'landed';
    if (e.code === 'KeyR' && landed && !G.inCar && !G.P.dead) startReload();
    if (e.code === 'KeyG' && landed && !G.inCar && !G.P.dead) throwGrenade(gameplayHooks);
    if (e.code === 'KeyE' && landed) toggleCar(false, { onToast: showToast, carDrivenRemote });
    if (e.code === 'Digit1') selectSlot(0, { onToast: showToast });
    if (e.code === 'Digit2') selectSlot(1, { onToast: showToast });
    if (e.code === 'Digit3') selectSlot(2, { onToast: showToast });
    if (e.code === 'Digit4') selectSlot(3, { onToast: showToast });
  });

  document.addEventListener('keyup', e => {
    G.keys[e.code] = false;
  });
}

function loop(nowMs) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (nowMs - lastTime) / 1000);
  lastTime = nowMs;
  const nowSec = nowMs * 0.001;

  updateWorldEnvironment(dt, nowMs);

  // 1. Fortnite-style 3D Menu Showcase
  if (G.MENU_OPEN) {
    updateMenuShowcase(dt, nowSec);
    G.renderer.render(G.scene, G.cam);
    return;
  }

  // 2. Victory Celebration Camera & Confetti
  if (G.VICTORY_STATE === 'win') {
    G.VICTORY_TIMER += dt;
    updateVictoryCamera(dt, nowSec);
    updateVictoryFx(dt);
    updateEffects(dt);
    grenadesUpdate(dt, gameplayHooks);
    G.renderer.render(G.scene, G.cam);
    return;
  }

  const P = G.P;

  // 3. Battle Bus / Freefall / Parachute phase update
  const prevDropPhase = G.DROP.phase;
  updateDropPhase(dt, gameplayHooks);
  if (prevDropPhase !== G.DROP.phase && G.DROP.phase === 'landed') {
    syncPauseOverlay();
  }
  const isDropped = G.DROP.phase === 'landed';

  // 4. Reloading, Recoil decay & ADS smoothing
  if (P.reload > 0) {
    P.reload -= dt;
    if (P.reload <= 0) {
      P.reload = 0;
      const def = getActiveWeaponDef();
      P.ammo = def.magSize;
      const sl = INVENTORY.slots[INVENTORY.activeSlot];
      if (sl && sl.type === 'weapon') sl.ammo = P.ammo;
    }
  }
  P.fire = Math.max(0, P.fire - dt);
  P.rec = Math.max(0, P.rec - dt * 5);
  if (G.flash) G.flash.intensity = Math.max(0, G.flash.intensity - dt * 20);
  G.AIM += ((isDropped && !G.MAP_OPEN && G.rmb && !P.dead && !G.inCar && !drink ? 1 : 0) - G.AIM) * Math.min(1, dt * 10);

  // 5. Shooting trigger
  if (isDropped && !G.MAP_OPEN && G.mouse && G.locked && !P.dead && !G.inCar && !drink && P.fire <= 0 && P.reload <= 0) {
    const slot = INVENTORY.slots[INVENTORY.activeSlot];
    if (slot && slot.type === 'grenade') {
      shoot(gameplayHooks);
      G.mouse = false;
    } else if (P.ammo > 0) {
      shoot(gameplayHooks);
      if (P.ammo <= 0) startReload();
    } else {
      startReload();
    }
  }

  // 6. Ground Movement or Vehicle Driving
  let mv = { fwd: 0, side: 0, spd: 0, inWater: false };
  if (isDropped) {
    if (G.inCar && !P.dead) {
      updateVehicleDriving(dt, gameplayHooks);
    } else {
      mv = updatePlayerMovement(dt, { ...gameplayHooks, isDrinking: !!drink });
    }
    if (RACE) RACE.update(P.x, P.z, P.y, !P.dead);
  }

  // 7. World pickups, grenades, particles, bots, net, battle royale storm
  potionsUpdate(dt, gameplayHooks);
  updateLoots(dt, gameplayHooks);
  grenadesUpdate(dt, gameplayHooks);
  updateEffects(dt);
  vehFx(dt);
  botsUpdate(dt, brZone, gameplayHooks);
  netFrame(dt, mv.fwd, mv.side, mv.spd, mv.inWater);
  brUpdate(dt, gameplayHooks);

  // 8. Camera + Minimap + HUD + Hurt vignette
  const spec = G.ONLINE && P.dead ? specTarget() : null;
  if (!isDropped && !spec) {
    updateDropCamera();
  } else {
    updateGameplayCamera(spec);
  }

  if (hurtT > 0) {
    setHurtT(Math.max(0, hurtT - dt));
  }
  const hurtDom = document.getElementById('hurtFx');
  if (hurtDom) hurtDom.style.opacity = String(Math.min(1, hurtT * 2.5));

  renderMinimap(document.getElementById('minimapCanvas'), false);
  updateHUDFrame(dt, spec);
  netMarker();

  G.renderer.render(G.scene, G.cam);
}

async function boot() {
  loadSavedPrefs();
  setLoadProgress(0.05, 'Preparando motor gráfico 3D…');

  await initWorld(setLoadProgress, showToast);
  await initPlayerSystem(setLoadProgress);
  await initWeaponsAndPickups(setLoadProgress);
  await initVehicles(setLoadProgress);
  initBots();
  initBattleRoyale();

  ui = initUI({
    onStartSolo: botCount => startSoloMatch(botCount),
    onResumeMatch: () => requestLock(),
    onReturnToMenu: () => returnToMenu(),
    onJumpBus: () => {
      jumpFromBus(gameplayHooks);
      requestLock();
    },
    onToggleGlider: () => {
      toggleGlider();
      requestLock();
    },
    onMapToggled: open => {
      if (open && document.pointerLockElement) {
        try { document.exitPointerLock(); } catch (_) {}
      } else if (!open && G.GAME_ACTIVE && !G.MENU_OPEN && !G.VICTORY_STATE) {
        requestLock();
      }
      syncPauseOverlay();
    },
  });

  bindNetHooks({
    ...ui,
    toast: showToast,
    addKillFeed,
    onKillsChanged: () => updateNetHud(),
    onDamageIndicator: triggerDamageIndicator,
    onPlayerDied: gameplayHooks.onPlayerDied,
    onMatchStarted: () => {
      hideEndScreens();
      G.MAP_OPEN = false;
      toggleMapModal(false);
      disableShowcaseLights();
      applyCustomization();
      document.getElementById('killFeed').innerHTML = '';
      updateNetHud();
      syncPauseOverlay();
      requestLock();
      showToast('¡Autobús de Combate listo! Pulsa [ESPACIO] para saltar');
    },
    onLeftOnline: msg => {
      returnToMenu();
      if (msg) ui.onFail(msg);
    },
    showOnlineEnd: winnerId => {
      const winner = G.NET.players[winnerId];
      const won = winnerId === G.NET.id;
      const aliveRemaining = Object.values(G.NET.players).filter(p => !p.dead).length;
      showMatchEndScreen(won, {
        kills: G.P.kills,
        damage: G.P.damageDealt,
        duration: brTime(),
        remaining: aliveRemaining,
        title: won ? '¡VICTORIA ROYALE ONLINE!' : `${winner ? winner.name : 'Un rival'} ha ganado`,
        subtitle: won ? 'Has dominado la sala multijugador' : 'Fin de la partida multijugador',
      });
    },
  });

  bindInputs();
  setLoadProgress(1.0, '¡Isla Battle lista!');
  hideLoading();
  requestAnimationFrame(loop);
}

boot().catch(err => {
  console.error('Boot error:', err);
  setLoadProgress(1, 'Error cargando recursos: ' + (err && err.message ? err.message : err));
});
