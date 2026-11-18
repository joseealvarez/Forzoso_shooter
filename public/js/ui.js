// UI module: Loading progress, Fortnite-style Cinematic Menu, Solo/Online Lobby,
// Character Customization, Settings, Next-Gen BR HUD with SVG weapon icons,
// Battle Bus Drop HUD, Shield Drink Progress HUD, and Expandable Tactical Map Modal.

import { G, SETTINGS, CUSTOM, savePrefs, cleanName, wrap } from './state.js';
import { H, biome, applyQualitySettings } from './world.js';
import { applyCustomization } from './player.js';
import { INVENTORY, WEAPON_DEFS, selectSlot, drink, getDrinkProgress } from './weapons.js';
import { VEH_ICON, nearestCar } from './vehicles.js';
import { MAX_SOLO_BOTS } from './bots.js';
import { fmtT, brTime, renderMinimap } from './battle-royale.js';
import { hostRoom, joinRoom, hostStartOnlineMatch, setHostBotPref, leaveOnline, resolveOnlineBotCount, carDrivenRemote } from './net.js';

let callbacks = {};
let activeScreen = 'main'; // 'main' | 'solo' | 'online' | 'wait' | 'custom' | 'settings'
let toastTimer = 0;
let hitmarkerTimer = 0;
let dmgIndTimer = 0;
let dmgSourceAngle = 0;
let compassTicksBuilt = false;

const el = id => document.getElementById(id);

const ITEM_SVGS = {
  m16: `<svg viewBox="0 0 64 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 11h10l3-3h17l3 3h16v3H42l-2 4h-4l1-4h-9l-3 7h-5l2-7H11l-4 3H4v-6z" fill="currentColor"/><rect x="21" y="5" width="11" height="2.5" rx="1" fill="#38bdf8"/><rect x="53" y="11.5" width="7" height="2" rx="1" fill="#7dd3fc"/></svg>`,
  shotgun: `<svg viewBox="0 0 64 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12h11l4-3h36v3H38l-3 3H25l-4 5h-5l3-5H9l-4 3v-6z" fill="currentColor"/><rect x="27" y="12.5" width="14" height="3.2" rx="1" fill="#38bdf8"/><rect x="19" y="7" width="35" height="2" rx="1" fill="#94a3b8"/></svg>`,
  smg: `<svg viewBox="0 0 64 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 10h8l2-2h18l2 2h11v4H40l-2 3h-5v5h-5v-5h-6l-3 4h-5l2-5h-6v-6z" fill="currentColor"/><rect x="24" y="5.5" width="9" height="2.2" rx="1" fill="#67e8f9"/><rect x="51" y="11" width="6" height="2" rx="1" fill="#bae6fd"/></svg>`,
  grenade: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="11" y="3" width="6" height="3" rx="1" fill="#facc15"/><path d="M17 4l4 2-1.5 2-2.5-1.5V4z" fill="#cbd5e1"/><circle cx="14" cy="16" r="8" fill="currentColor"/><path d="M8.5 14h11M8.5 18h11M14 8v16" stroke="#09111f" stroke-width="1.4"/></svg>`,
  shield: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="10.5" y="3" width="7" height="3.5" rx="1" fill="#bae6fd"/><path d="M8 9.5C8 8.1 9.1 7 10.5 7h7C18.9 7 20 8.1 20 9.5V21a3 3 0 0 1-3 3h-6a3 3 0 0 1-3-3V9.5z" fill="currentColor"/><path d="M14 11.5l3.5 1.8v2.7c0 2.3-1.5 4.2-3.5 5-2-.8-3.5-2.7-3.5-5v-2.7l3.5-1.8z" fill="#e0f2fe"/></svg>`,
  empty: `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="12.5" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.28"/></svg>`,
};

export function setLoadProgress(pct, msg) {
  const bar = el('loadBar');
  const txt = el('loadMsg');
  const pctEl = el('loadPct');
  const clamped = Math.max(0, Math.min(100, Math.round(pct * 100)));
  if (bar) bar.style.width = clamped + '%';
  if (txt && msg) txt.textContent = msg;
  if (pctEl) pctEl.textContent = clamped + '%';
}

export function hideLoading() {
  const scr = el('loadScreen');
  if (!scr) return;
  scr.classList.add('fade-out');
  setTimeout(() => { scr.style.display = 'none'; }, 420);
}

export function showToast(msg) {
  const t = el('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function showHitmarker(kill = false) {
  const hm = el('hitmarker');
  if (!hm) return;
  hm.classList.remove('kill', 'show');
  void hm.offsetWidth;
  if (kill) hm.classList.add('kill');
  hm.classList.add('show');
  clearTimeout(hitmarkerTimer);
  hitmarkerTimer = setTimeout(() => hm.classList.remove('show', 'kill'), 180);
}

export function triggerDamageIndicator(attackerId) {
  const ind = el('dmgInd');
  if (!ind) return;
  const r = typeof attackerId === 'number' && attackerId >= 0 ? G.RMS[attackerId] : null;
  if (r) {
    dmgSourceAngle = Math.atan2(r.x - G.P.x, r.z - G.P.z);
  } else {
    dmgSourceAngle = G.P.yaw + Math.PI;
  }
  dmgIndTimer = 0.75;
  ind.style.opacity = '1';
}

export function addKillFeed(killer, victim) {
  const kf = el('killFeed');
  if (!kf) return;
  const item = document.createElement('div');
  item.className = 'kf-item';
  const kSpan = document.createElement('span');
  kSpan.className = 'kf-killer';
  kSpan.textContent = killer || 'Tormenta';
  const mid = document.createElement('span');
  mid.className = 'kf-verb';
  mid.textContent = ' eliminó a ';
  const vSpan = document.createElement('span');
  vSpan.className = 'kf-victim';
  vSpan.textContent = victim || 'Superviviente';
  item.append(kSpan, mid, vSpan);
  kf.prepend(item);
  while (kf.children.length > 5) kf.lastElementChild.remove();
  setTimeout(() => {
    item.classList.add('fade');
    setTimeout(() => item.remove(), 350);
  }, 5500);
}

export function openMenuScreen(screen = 'main') {
  activeScreen = screen;
  G.MENU_PANEL = screen;
  const menu = el('mainMenu');
  if (menu) menu.style.display = G.MENU_OPEN ? 'flex' : 'none';
  document.querySelectorAll('.menu-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.panel === screen);
  });
  const nav = el('menuHeroLayout');
  if (nav) nav.classList.toggle('sub-open', screen !== 'main');
}

export function toggleMapModal(force = null) {
  const next = force !== null ? !!force : !G.MAP_OPEN;
  if (G.MENU_OPEN || !G.GAME_ACTIVE || G.VICTORY_STATE) {
    G.MAP_OPEN = false;
  } else {
    G.MAP_OPEN = next;
  }
  const modal = el('mapModal');
  if (modal) modal.style.display = G.MAP_OPEN ? 'flex' : 'none';
  if (G.MAP_OPEN) {
    renderMinimap(el('fullMapCanvas'), true);
  }
  if (callbacks.onMapToggled) callbacks.onMapToggled(G.MAP_OPEN);
}

function setBusy(busy, msg = '') {
  const st = el('onlineStatus');
  if (st) st.textContent = msg;
  document.querySelectorAll('.online-act-btn').forEach(b => { b.disabled = !!busy; });
}

export function renderLobby() {
  const codeEl = el('wCode');
  if (codeEl) codeEl.textContent = G.NET.code || '-----';

  const players = Object.values(G.NET.players);
  const countEl = el('wCount');
  if (countEl) countEl.textContent = `${players.length}/${G.NET.max}`;

  const list = el('wList');
  if (list) {
    list.innerHTML = '';
    players.sort((a, b) => a.id - b.id).forEach(p => {
      const li = document.createElement('div');
      li.className = 'lobby-player' + (p.id === G.NET.id ? ' me' : '');
      const nm = document.createElement('span');
      nm.textContent = p.name + (p.id === 0 ? ' (Anfitrión)' : '') + (p.id === G.NET.id ? ' · Tú' : '');
      const badge = document.createElement('span');
      badge.className = 'lp-badge';
      badge.textContent = 'LISTO';
      li.append(nm, badge);
      list.appendChild(li);
    });
  }

  const resolvedBots = resolveOnlineBotCount(players.length);
  const summaryEl = el('wParticipants');
  if (summaryEl) {
    summaryEl.textContent = `${players.length} ${players.length === 1 ? 'jugador' : 'jugadores'} + ${resolvedBots} bots = ${players.length + resolvedBots} participantes`;
  }

  const botSelect = el('onlineBotPref');
  if (botSelect) {
    botSelect.value = String(G.NET.botPref);
    botSelect.disabled = !G.NET.host;
  }
  const hostNote = el('onlineBotHostNote');
  if (hostNote) {
    hostNote.textContent = G.NET.host ? 'Controlado por ti (anfitrión)' : 'Controlado por el anfitrión';
  }

  const startBtn = el('bStartOnline');
  const waitMsg = el('wMsg');
  if (startBtn) {
    startBtn.style.display = G.NET.host ? 'inline-flex' : 'none';
    startBtn.disabled = players.length < 2;
  }
  if (waitMsg) {
    waitMsg.textContent = G.NET.host
      ? (players.length < 2 ? 'Comparte el código para que se una al menos 1 jugador…' : '¡Sala lista! Pulsa EMPEZAR PARTIDA cuando quieras.')
      : 'Esperando a que el anfitrión inicie la partida…';
  }
}

export function updateNetHud() {
  const lb = el('onlineBoard');
  const lbList = el('lbList');
  if (!lb || !lbList) return;
  if (!G.ONLINE || G.MENU_OPEN) {
    lb.style.display = 'none';
    return;
  }
  lb.style.display = 'block';
  const rows = Object.values(G.NET.players).slice().sort((a, b) => (a.dead ? 1 : 0) - (b.dead ? 1 : 0) || b.k - a.k || a.id - b.id);
  lbList.innerHTML = '';
  rows.forEach(p => {
    const row = document.createElement('div');
    row.className = 'lb-row' + (p.id === G.NET.id ? ' me' : '') + (p.dead ? ' dead' : '');
    const nm = document.createElement('span');
    nm.textContent = (p.dead ? '✕ ' : '● ') + p.name;
    const sc = document.createElement('span');
    sc.textContent = `${p.k} K`;
    row.append(nm, sc);
    lbList.appendChild(row);
  });
}

export function updateZoneHud({ z, out, dist, aliveTotal, totalPhases }) {
  const phaseEl = el('hudPhase');
  const timerEl = el('hudTimer');
  const aliveEl = el('hudAlive');
  const stateEl = el('hudZoneState');
  const dmgEl = el('hudStormDmg');
  if (phaseEl) phaseEl.textContent = `FASE ${z.ph}/${totalPhases}`;
  if (timerEl) timerEl.textContent = z.st === 2 ? 'FINAL' : fmtT(z.left);
  if (aliveEl) aliveEl.textContent = String(aliveTotal);
  if (dmgEl) dmgEl.textContent = `${z.d}/s`;
  if (stateEl) {
    if (out) {
      stateEl.textContent = `EN LA TORMENTA (${Math.ceil(dist)} m)`;
      stateEl.className = 'zone-pill danger';
    } else if (z.st === 1) {
      stateEl.textContent = 'TORMENTA CERRÁNDOSE';
      stateEl.className = 'zone-pill warn';
    } else {
      stateEl.textContent = 'ZONA SEGURA';
      stateEl.className = 'zone-pill safe';
    }
  }
}

export function showMatchEndScreen(won, stats = {}) {
  if (document.pointerLockElement) {
    try { document.exitPointerLock(); } catch (_) {}
  }
  G.mouse = false;
  G.rmb = false;
  G.MAP_OPEN = false;
  const mapModal = el('mapModal');
  if (mapModal) mapModal.style.display = 'none';

  const overEl = el('over');
  if (overEl) overEl.style.display = 'none';

  const vic = el('victoryScreen');
  const def = el('defeatScreen');

  const timeStr = fmtT(stats.duration || brTime());
  const kills = stats.kills ?? G.P.kills;
  const dmg = Math.round(stats.damage ?? G.P.damageDealt);
  const rank = won ? '#1' : stats.rank || `#${Math.max(2, (stats.remaining || 1) + 1)}`;

  if (won) {
    if (def) def.style.display = 'none';
    if (vic) {
      el('vicTitle').textContent = stats.title || '¡VICTORIA ROYALE!';
      el('vicSub').textContent = stats.subtitle || 'Último superviviente de Isla Battle';
      el('vicKills').textContent = String(kills);
      el('vicDmg').textContent = String(dmg);
      el('vicTime').textContent = timeStr;
      el('vicRank').textContent = rank;
      el('vicRematch').style.display = G.ONLINE ? 'none' : 'inline-flex';
      vic.style.display = 'flex';
    }
  } else {
    if (vic) vic.style.display = 'none';
    if (def) {
      el('defTitle').textContent = stats.title || 'HAS SIDO ELIMINADO';
      el('defSub').textContent = stats.subtitle || 'Mejor suerte en la próxima caída en Isla Battle';
      el('defKills').textContent = String(kills);
      el('defDmg').textContent = String(dmg);
      el('defTime').textContent = timeStr;
      el('defRank').textContent = rank;
      el('defRematch').style.display = G.ONLINE ? 'none' : 'inline-flex';
      def.style.display = 'flex';
    }
  }
}

export function hideEndScreens() {
  const vic = el('victoryScreen');
  const def = el('defeatScreen');
  if (vic) vic.style.display = 'none';
  if (def) def.style.display = 'none';
}

function buildCompassTicks() {
  const track = el('compassTrack');
  if (!track || compassTicksBuilt) return;
  compassTicksBuilt = true;
  const marks = ['N', '15', '30', 'NE', '60', '75', 'E', '105', '120', 'SE', '150', '165', 'S', '195', '210', 'SW', '240', '255', 'W', '285', '300', 'NW', '330', '345'];
  const wrapEl = document.createElement('div');
  wrapEl.className = 'compass-strip';
  for (let rep = -1; rep <= 1; rep++) {
    marks.forEach((lbl, idx) => {
      const deg = rep * 360 + idx * 15;
      const tick = document.createElement('div');
      const isCard = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].includes(lbl);
      tick.className = 'c-tick' + (isCard ? ' card' : '');
      tick.style.left = (deg * 2.4) + 'px';
      tick.innerHTML = `<i></i><span>${lbl}</span>`;
      wrapEl.appendChild(tick);
    });
  }
  track.appendChild(wrapEl);
}

export function updateHUDFrame(dt, specTarget) {
  const hud = el('hudRoot');
  const menu = el('mainMenu');
  if (menu) menu.style.display = G.MENU_OPEN ? 'flex' : 'none';
  if (hud) hud.style.display = G.MENU_OPEN ? 'none' : 'block';
  if (G.MENU_OPEN) return;

  const P = G.P;
  const dropPhase = G.DROP.phase;
  const isDropping = dropPhase !== 'landed';

  // Health & Shield bars
  const hpPct = Math.max(0, Math.min(100, (P.hp / P.maxHp) * 100));
  const shPct = Math.max(0, Math.min(100, P.sh));
  const hpFill = el('hpFill');
  const shFill = el('shFill');
  if (hpFill) {
    hpFill.style.width = hpPct + '%';
    hpFill.style.background = P.hp > 50 ? 'linear-gradient(90deg, #22c55e, #4ade80)' : P.hp > 25 ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' : 'linear-gradient(90deg, #ef4444, #f87171)';
  }
  if (shFill) shFill.style.width = shPct + '%';
  const hpVal = el('hpVal');
  const shVal = el('shVal');
  if (hpVal) hpVal.textContent = String(Math.ceil(P.hp));
  if (shVal) shVal.textContent = String(Math.ceil(P.sh));

  // Kills, Biome, Ping
  const kEl = el('hudKills');
  if (kEl) kEl.textContent = String(P.kills);
  const bEl = el('hudBiome');
  if (bEl) bEl.textContent = isDropping ? 'Sobrevolando' : biome(P.x, P.z);

  const pingWrap = el('hudPingWrap');
  const pingVal = el('hudPing');
  if (pingWrap && pingVal) {
    if (G.ONLINE) {
      pingWrap.style.display = 'flex';
      pingVal.textContent = G.NET.host ? 'HOST' : (G.NET.pingMs ? `${G.NET.pingMs} ms` : '…');
      pingVal.className = 'ping-val ' + (G.NET.host || G.NET.pingMs < 90 ? 'good' : G.NET.pingMs < 180 ? 'ok' : 'bad');
    } else {
      pingWrap.style.display = 'none';
    }
  }

  // Battle Bus & Drop HUD
  const dropHud = el('dropHud');
  if (dropHud) {
    if (isDropping && !P.dead && !G.VICTORY_STATE) {
      dropHud.style.display = 'flex';
      const gnd = Math.max(0, H(P.x, P.z));
      const altM = Math.max(0, Math.round(P.y - gnd));
      const spdKmh = dropPhase === 'bus' ? 130 : Math.round(Math.hypot(G.DROP.hSpeed, G.DROP.vSpeed) * 3.6);
      const lblEl = el('dropPhaseLabel');
      const altEl = el('dropAlt');
      const spdEl = el('dropSpeed');
      const btnJump = el('btnJumpBus');
      if (lblEl) {
        lblEl.textContent = dropPhase === 'bus' ? 'AUTOBÚS DE COMBATE' : dropPhase === 'glider' ? 'ALA DELTA DESPLEGADA' : 'CAÍDA LIBRE';
      }
      if (altEl) altEl.textContent = `${altM} m`;
      if (spdEl) spdEl.textContent = `${spdKmh} km/h`;
      if (btnJump) {
        if (dropPhase === 'bus') {
          btnJump.textContent = 'SALTAR DEL AUTOBÚS [ESPACIO]';
          btnJump.className = 'drop-btn gold';
          btnJump.disabled = false;
        } else if (dropPhase === 'freefall') {
          btnJump.textContent = 'ABRIR ALA DELTA [ESPACIO]';
          btnJump.className = 'drop-btn sky';
          btnJump.disabled = false;
        } else {
          btnJump.textContent = altM < 26 ? 'ATERRIZANDO… (WASD para dirigir)' : 'PLEGAR ALA DELTA [ESPACIO]';
          btnJump.className = 'drop-btn glider';
          btnJump.disabled = altM < 26;
        }
      }
    } else {
      dropHud.style.display = 'none';
    }
  }

  // Shield Drink Progress Bar HUD
  const drinkHud = el('drinkHud');
  const dp = getDrinkProgress();
  if (drinkHud) {
    if (dp && !P.dead && !isDropping && !G.VICTORY_STATE) {
      drinkHud.style.display = 'flex';
      const dFill = el('drinkFill');
      const dPct = el('drinkPct');
      const dLbl = el('drinkLabel');
      if (dFill) dFill.style.width = dp.pct + '%';
      if (dPct) dPct.textContent = dp.pct + '%';
      if (dLbl) dLbl.textContent = dp.given ? '¡ESCUDO ACTIVADO +50!' : 'BEBIENDO ESCUDO PORTÁTIL…';
    } else {
      drinkHud.style.display = 'none';
    }
  }

  // Weapon & Ammo + SVG Icons
  const activeSlotObj = INVENTORY.slots[INVENTORY.activeSlot];
  const weaponEl = el('hudWeaponName');
  const ammoEl = el('hudAmmo');
  const reloadEl = el('hudReload');
  const weaponIconEl = el('hudWeaponIcon');
  const hudBr = document.querySelector('.hud-br');
  if (hudBr) hudBr.style.opacity = dropPhase === 'bus' ? '0.45' : '1';

  if (activeSlotObj && activeSlotObj.type === 'grenade') {
    if (weaponEl) weaponEl.textContent = 'Granadas Galleta';
    if (ammoEl) ammoEl.textContent = `${activeSlotObj.count} / 10`;
    if (weaponIconEl) weaponIconEl.innerHTML = ITEM_SVGS.grenade;
    if (reloadEl) reloadEl.style.display = 'none';
  } else {
    const wid = (activeSlotObj && activeSlotObj.id) || G.P.weaponId || 'm16';
    const def = WEAPON_DEFS[wid] || WEAPON_DEFS.m16;
    if (weaponEl) weaponEl.textContent = def.name;
    if (ammoEl) ammoEl.textContent = `${P.ammo} / ${def.magSize}`;
    if (weaponIconEl) weaponIconEl.innerHTML = ITEM_SVGS[def.id] || ITEM_SVGS.m16;
    if (reloadEl) {
      if (P.reload > 0) {
        reloadEl.style.display = 'block';
        reloadEl.textContent = `RECARGANDO ${P.reload.toFixed(1)}s`;
      } else if (drink) {
        reloadEl.style.display = 'block';
        reloadEl.textContent = 'BEBIENDO ESCUDO…';
      } else {
        reloadEl.style.display = 'none';
      }
    }
  }

  // 4-Slot Inventory Bar with SVG weapon/item icons
  for (let i = 0; i < 4; i++) {
    const slotDom = el('invSlot' + i);
    const s = INVENTORY.slots[i];
    if (!slotDom) continue;
    slotDom.classList.toggle('active', INVENTORY.activeSlot === i);
    slotDom.classList.toggle('empty', !s);
    const iconDom = slotDom.querySelector('.inv-icon');
    const nameDom = slotDom.querySelector('.inv-name');
    const countDom = slotDom.querySelector('.inv-count');
    if (!s) {
      if (iconDom) iconDom.innerHTML = ITEM_SVGS.empty;
      if (nameDom) nameDom.textContent = 'Vacío';
      if (countDom) countDom.textContent = '-';
    } else if (s.type === 'weapon') {
      const def = WEAPON_DEFS[s.id] || WEAPON_DEFS.m16;
      if (iconDom) iconDom.innerHTML = ITEM_SVGS[def.id] || ITEM_SVGS.m16;
      if (nameDom) nameDom.textContent = def.short;
      if (countDom) countDom.textContent = `${INVENTORY.activeSlot === i ? P.ammo : s.ammo}/${def.magSize}`;
    } else {
      if (iconDom) iconDom.innerHTML = ITEM_SVGS[s.type] || ITEM_SVGS.empty;
      if (nameDom) nameDom.textContent = s.type === 'grenade' ? 'Granada' : 'Escudo';
      if (countDom) countDom.textContent = `x${s.count}`;
    }
  }

  // Compass strip & icons
  const strip = document.querySelector('#compassTrack .compass-strip');
  if (strip) {
    const heading = (((-P.yaw * 180) / Math.PI) % 360 + 360) % 360;
    const centerPx = el('compassTrack').clientWidth * 0.5;
    strip.style.transform = `translateX(${(centerPx - heading * 2.4).toFixed(1)}px)`;
  }

  const iconsEl = el('compassIcons');
  if (iconsEl) {
    const w = iconsEl.clientWidth;
    let html = '';
    const projectRel = (tx, tz) => {
      const ang = Math.atan2(-(tx - P.x), -(tz - P.z));
      const rel = wrap(P.yaw - ang);
      const px = w * 0.5 + (rel * 180 / Math.PI) * 2.4;
      return px >= 8 && px <= w - 8 ? px : null;
    };
    G.CARS.forEach((c, idx) => {
      if (!c || c.dead || (G.inCar && G.curCar === c)) return;
      const px = projectRel(c.st.x, c.st.z);
      if (px !== null) html += `<span class="c-poi" style="left:${px.toFixed(1)}px">${VEH_ICON[idx] || '🚗'}</span>`;
    });
    if (G.ZPT) {
      const px = projectRel(G.ZPT.x, G.ZPT.z);
      if (px !== null) html += `<span class="c-poi zone" style="left:${px.toFixed(1)}px">🌀</span>`;
    }
    iconsEl.innerHTML = html;
  }

  // Dynamic crosshair visibility & spread
  const ch = el('crosshair');
  if (ch) {
    const spreadPx = Math.round((1 - 0.55 * G.AIM) * 9 + P.rec * 10);
    ch.style.setProperty('--spread', spreadPx + 'px');
    ch.style.opacity = isDropping || G.inCar || P.dead || G.VICTORY_STATE || G.MAP_OPEN ? '0' : '1';
  }

  // Damage directional indicator fade
  const dmgEl = el('dmgInd');
  if (dmgEl) {
    if (dmgIndTimer > 0) {
      dmgIndTimer = Math.max(0, dmgIndTimer - dt);
      const rel = wrap(dmgSourceAngle - P.yaw);
      dmgEl.style.transform = `translate(-50%, -50%) rotate(${Math.round((-rel * 180) / Math.PI)}deg)`;
      dmgEl.style.opacity = String(Math.min(1, dmgIndTimer * 1.4));
    } else {
      dmgEl.style.opacity = '0';
    }
  }

  // Vehicle Prompt & Vehicle HUD
  const promptEl = el('carPrompt');
  const carHud = el('carHud');
  if (G.inCar && G.curCar) {
    if (promptEl) promptEl.style.display = 'none';
    if (carHud) {
      carHud.style.display = 'flex';
      el('carName').textContent = G.curCar.name;
      el('carSpeed').textContent = Math.abs(Math.round(G.V.speed * 3.6)) + ' km/h';
      el('carHpFill').style.width = Math.max(0, Math.round((G.curCar.hp / G.curCar.max) * 100)) + '%';
    }
  } else {
    if (carHud) carHud.style.display = 'none';
    const nc = !isDropping ? nearestCar() : null;
    if (promptEl && nc && !P.dead && !G.VICTORY_STATE) {
      const taken = G.ONLINE && carDrivenRemote(nc.idx);
      promptEl.textContent = taken ? `${nc.name} ocupado por otro jugador` : `Pulsa [E] para subir ${nc.to}`;
      promptEl.style.display = 'block';
    } else if (promptEl) {
      promptEl.style.display = 'none';
    }
  }

  // Online dead/spectate banner
  const deadEl = el('dead');
  if (deadEl) {
    if (G.ONLINE && P.dead && !G.VICTORY_STATE) {
      deadEl.style.display = 'block';
      deadEl.textContent = specTarget ? `Espectador: ${specTarget.name} · Pulsa [ESPACIO] para cambiar` : 'Has sido eliminado · Esperando fin de ronda…';
    } else {
      deadEl.style.display = 'none';
    }
  }

  // Live update Expanded Map Modal when open
  if (G.MAP_OPEN) {
    renderMinimap(el('fullMapCanvas'), true);
  }
}

export function initUI(cbs) {
  callbacks = cbs;
  buildCompassTicks();

  // Main menu buttons
  el('btnMenuSolo')?.addEventListener('click', () => openMenuScreen('solo'));
  el('btnMenuOnline')?.addEventListener('click', () => openMenuScreen('online'));
  el('btnMenuCustom')?.addEventListener('click', () => openMenuScreen('custom'));
  el('btnMenuSettings')?.addEventListener('click', () => openMenuScreen('settings'));
  document.querySelectorAll('.btn-back-main').forEach(b => {
    b.addEventListener('click', () => openMenuScreen('main'));
  });

  // Pose selector buttons on Main Menu & Customization
  const syncPoseBtns = () => {
    document.querySelectorAll('[data-pose]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pose === CUSTOM.pose);
    });
  };
  document.querySelectorAll('[data-pose]').forEach(btn => {
    btn.addEventListener('click', () => {
      CUSTOM.pose = btn.dataset.pose;
      savePrefs();
      syncPoseBtns();
    });
  });
  syncPoseBtns();

  // Solo configuration (real bot count selector 1..24)
  const soloSlider = el('soloBotRange');
  const syncSoloUi = val => {
    const n = Math.max(1, Math.min(MAX_SOLO_BOTS, val | 0));
    SETTINGS.soloBots = n;
    if (soloSlider) soloSlider.value = String(n);
    if (el('soloBotCountVal')) el('soloBotCountVal').textContent = String(n);
    if (el('soloTotalPlayers')) el('soloTotalPlayers').textContent = `${n + 1} participantes (Tú + ${n} bots)`;
    document.querySelectorAll('[data-solo-preset]').forEach(p => {
      p.classList.toggle('active', Number(p.dataset.soloPreset) === n);
    });
    savePrefs();
  };
  soloSlider?.addEventListener('input', e => syncSoloUi(Number(e.target.value)));
  document.querySelectorAll('[data-solo-preset]').forEach(btn => {
    btn.addEventListener('click', () => syncSoloUi(Number(btn.dataset.soloPreset)));
  });
  syncSoloUi(SETTINGS.soloBots || 12);

  el('btnStartSolo')?.addEventListener('click', () => {
    if (callbacks.onStartSolo) callbacks.onStartSolo(SETTINGS.soloBots);
  });

  // Online configuration & P2P Lobby
  const nameIn = el('pName');
  if (nameIn) {
    try { nameIn.value = localStorage.getItem('ib_name') || 'Jugador'; } catch (_) {}
    nameIn.addEventListener('input', () => {
      try { localStorage.setItem('ib_name', nameIn.value); } catch (_) {}
    });
  }
  const getPlayerName = () => {
    const nm = cleanName(nameIn ? nameIn.value : '') || 'Jugador';
    if (nameIn) nameIn.value = nm;
    G.NET.name = nm;
    return nm;
  };

  el('bHost')?.addEventListener('click', () => {
    getPlayerName();
    setHostBotPref(el('onlineBotPref') ? el('onlineBotPref').value : SETTINGS.onlineBotsMode || 'auto');
    hostRoom();
  });

  const doJoin = () => {
    const code = (el('rCode')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      setBusy(false, 'Introduce un código de sala válido (5 caracteres).');
      return;
    }
    if (el('rCode')) el('rCode').value = code;
    getPlayerName();
    joinRoom(code);
  };
  el('bJoin')?.addEventListener('click', doJoin);
  el('rCode')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); doJoin(); }
  });

  el('onlineBotPref')?.addEventListener('change', e => {
    SETTINGS.onlineBotsMode = e.target.value;
    savePrefs();
    setHostBotPref(e.target.value);
  });

  el('wCopy')?.addEventListener('click', () => {
    if (!G.NET.code) return;
    navigator.clipboard?.writeText(G.NET.code).catch(() => {});
    showToast('Código copiado: ' + G.NET.code);
  });
  el('wCopyLink')?.addEventListener('click', () => {
    if (!G.NET.code) return;
    const url = location.href.split('#')[0] + '#sala=' + G.NET.code;
    navigator.clipboard?.writeText(url).catch(() => {});
    showToast('Enlace de invitación copiado');
  });

  el('bStartOnline')?.addEventListener('click', () => hostStartOnlineMatch());
  el('wCancel')?.addEventListener('click', () => {
    leaveOnline();
    openMenuScreen('online');
  });

  // Customization swatches
  const bindSwatches = (containerId, key) => {
    const wrapNode = el(containerId);
    if (!wrapNode) return;
    const sync = () => {
      wrapNode.querySelectorAll('[data-color]').forEach(b => {
        b.classList.toggle('active', b.dataset.color.toLowerCase() === (CUSTOM[key] || '').toLowerCase());
      });
    };
    wrapNode.querySelectorAll('[data-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        CUSTOM[key] = btn.dataset.color;
        applyCustomization();
        savePrefs();
        sync();
      });
    });
    sync();
  };
  bindSwatches('suitSwatches', 'suitColor');
  bindSwatches('accentSwatches', 'accentColor');
  bindSwatches('visorSwatches', 'visorColor');

  el('btnResetCustom')?.addEventListener('click', () => {
    CUSTOM.suitColor = '#2563eb';
    CUSTOM.accentColor = '#38bdf8';
    CUSTOM.visorColor = '#67e8f9';
    CUSTOM.pose = 'idle';
    applyCustomization();
    savePrefs();
    syncPoseBtns();
    bindSwatches('suitSwatches', 'suitColor');
    bindSwatches('accentSwatches', 'accentColor');
    bindSwatches('visorSwatches', 'visorColor');
    showToast('Aspecto restablecido');
  });

  // Settings panel
  const syncSettingsUi = () => {
    document.querySelectorAll('[data-quality]').forEach(b => {
      b.classList.toggle('active', b.dataset.quality === SETTINGS.quality);
    });
    if (el('setSens')) el('setSens').value = String(SETTINGS.sensitivity);
    if (el('setSensVal')) el('setSensVal').textContent = SETTINGS.sensitivity.toFixed(2) + 'x';
    if (el('setFov')) el('setFov').value = String(SETTINGS.fov);
    if (el('setFovVal')) el('setFovVal').textContent = SETTINGS.fov + '°';
    if (el('setVol')) el('setVol').value = String(Math.round(SETTINGS.volume * 100));
    if (el('setVolVal')) el('setVolVal').textContent = Math.round(SETTINGS.volume * 100) + '%';
    if (el('setMute')) el('setMute').textContent = SETTINGS.muted ? 'Audio: SILENCIADO' : 'Audio: ACTIVADO';
  };
  document.querySelectorAll('[data-quality]').forEach(btn => {
    btn.addEventListener('click', () => {
      SETTINGS.quality = btn.dataset.quality;
      applyQualitySettings();
      savePrefs();
      syncSettingsUi();
    });
  });
  el('setSens')?.addEventListener('input', e => {
    SETTINGS.sensitivity = parseFloat(e.target.value);
    savePrefs();
    syncSettingsUi();
  });
  el('setFov')?.addEventListener('input', e => {
    SETTINGS.fov = parseInt(e.target.value, 10);
    savePrefs();
    syncSettingsUi();
  });
  el('setVol')?.addEventListener('input', e => {
    SETTINGS.volume = parseInt(e.target.value, 10) / 100;
    savePrefs();
    syncSettingsUi();
  });
  el('setMute')?.addEventListener('click', () => {
    SETTINGS.muted = !SETTINGS.muted;
    savePrefs();
    syncSettingsUi();
  });
  el('btnResetSettings')?.addEventListener('click', () => {
    SETTINGS.quality = 'high';
    SETTINGS.sensitivity = 1.0;
    SETTINGS.fov = 70;
    SETTINGS.volume = 0.7;
    SETTINGS.muted = false;
    applyQualitySettings();
    savePrefs();
    syncSettingsUi();
    showToast('Ajustes restablecidos');
  });
  syncSettingsUi();

  // Inventory clickable slots
  for (let i = 0; i < 4; i++) {
    el('invSlot' + i)?.addEventListener('click', () => selectSlot(i, { onToast: showToast }));
  }

  // Battle Bus Jump / Glider action button
  el('btnJumpBus')?.addEventListener('click', () => {
    if (G.DROP.phase === 'bus') callbacks.onJumpBus?.();
    else callbacks.onToggleGlider?.();
  });

  // Expandable Map controls
  el('btnExpandMap')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleMapModal();
  });
  el('minimapFrame')?.addEventListener('click', () => toggleMapModal());
  el('btnCloseMap')?.addEventListener('click', () => toggleMapModal(false));
  el('mapModal')?.addEventListener('click', e => {
    if (e.target.id === 'mapModal') toggleMapModal(false);
  });

  // Pause overlay buttons
  el('btnResume')?.addEventListener('click', () => {
    if (callbacks.onResumeMatch) callbacks.onResumeMatch();
  });
  el('btnExitToMenu')?.addEventListener('click', () => {
    if (callbacks.onReturnToMenu) callbacks.onReturnToMenu();
  });

  // Victory / Defeat overlay buttons
  el('vicRematch')?.addEventListener('click', () => {
    hideEndScreens();
    if (callbacks.onStartSolo) callbacks.onStartSolo(G.activeBotCount);
  });
  el('defRematch')?.addEventListener('click', () => {
    hideEndScreens();
    if (callbacks.onStartSolo) callbacks.onStartSolo(G.activeBotCount);
  });
  el('vicMenu')?.addEventListener('click', () => {
    hideEndScreens();
    if (callbacks.onReturnToMenu) callbacks.onReturnToMenu();
  });
  el('defMenu')?.addEventListener('click', () => {
    hideEndScreens();
    if (callbacks.onReturnToMenu) callbacks.onReturnToMenu();
  });

  // Support #sala=CODE invite link
  const m = location.hash.match(/sala=([A-Z0-9]{4,8})/i);
  if (m && el('rCode')) {
    el('rCode').value = m[1].toUpperCase();
    openMenuScreen('online');
  } else {
    openMenuScreen('main');
  }

  return {
    setBusy,
    onRoomHosted: () => {
      setBusy(false, '');
      openMenuScreen('wait');
      renderLobby();
    },
    onJoinedLobby: () => {
      setBusy(false, '');
      openMenuScreen('wait');
      renderLobby();
    },
    onFail: msg => {
      setBusy(false, msg);
      openMenuScreen('online');
    },
    renderLobby,
    updateNetHud,
    updateZoneHud,
    toggleMapModal,
  };
}
