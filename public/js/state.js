// Shared game state, constants, and math utilities for Isla Battle

export const R = 170;
export const SIZE = 440;
export const SEG = 176;
export const VOLC = { x: 6, z: 59, R: 18, rim: 11, floorY: 35.6, lavaY: 36.8, lavaR: 7.6 };

export const sm = (a, b, x) => {
  x = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

export const rnd = (a, b) => a + Math.random() * (b - a);
export const r2 = v => Math.round(v * 100) / 100;
export const r1 = v => Math.round(v * 10) / 10;
export const wrap = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

export function mulberry(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cleanName(s) {
  return String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14);
}

export function b2a(s) {
  const b = atob(s);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
}

export function b64f(s) {
  return new Float32Array(b2a(s));
}

// Persistent user settings & customization
export const SETTINGS = {
  quality: 'high', // 'low' | 'medium' | 'high'
  sensitivity: 1.0,
  fov: 70,
  volume: 0.7,
  muted: false,
  soloBots: 12,
  onlineBotsMode: 'auto', // 'auto' | 0..12
};

export const CUSTOM = {
  suitColor: '#2563eb',
  accentColor: '#38bdf8',
  visorColor: '#67e8f9',
  pose: 'idle', // 'idle' | 'aim' | 'run' | 'jump' | 'victory'
};

export function loadSavedPrefs() {
  try {
    const s = localStorage.getItem('ib_settings_v2');
    if (s) Object.assign(SETTINGS, JSON.parse(s));
    const c = localStorage.getItem('ib_custom_v2');
    if (c) Object.assign(CUSTOM, JSON.parse(c));
  } catch (_) {}
}

export function savePrefs() {
  try {
    localStorage.setItem('ib_settings_v2', JSON.stringify(SETTINGS));
    localStorage.setItem('ib_custom_v2', JSON.stringify(CUSTOM));
  } catch (_) {}
}

// Shared runtime registry (populated by modules during init)
export const G = {
  // Core mode flags
  ONLINE: false,
  MENU_OPEN: true,
  MENU_PANEL: 'main', // 'main' | 'solo' | 'online' | 'wait' | 'custom' | 'settings'
  GAME_ACTIVE: false,
  MAP_OPEN: false,
  VICTORY_STATE: null, // null | 'win' | 'loss'
  VICTORY_TIMER: 0,

  // Battle Bus & Skydiving drop state
  DROP: {
    phase: 'landed', // 'bus' | 'freefall' | 'glider' | 'landed'
    busElapsed: 0,
    busDur: 24,
    startX: -195,
    startZ: -120,
    endX: 195,
    endZ: 120,
    busX: 0,
    busY: 128,
    busZ: 0,
    busYaw: 0,
    vSpeed: 0,
    hSpeed: 0,
    bank: 0,
    gliderOpen: false,
    spaceLatch: false,
  },

  // Three.js core
  renderer: null,
  scene: null,
  cam: null,
  sun: null,
  hemi: null,

  // Player state
  P: {
    x: 0, y: 0, z: 0, vy: 0,
    yaw: 0, pitch: -0.15,
    hp: 100, maxHp: 100, sh: 0,
    ammo: 30, reload: 0, fire: 0,
    weaponId: 'm16',
    kills: 0, deaths: 0,
    ground: true, land: 0, rec: 0, dead: false,
    damageDealt: 0,
  },
  SPAWN: [0, 0, 0],
  SPAWNS: [],

  // Vehicle driving state
  V: { x: 0, z: 0, yaw: 0, speed: 0 },
  inCar: false,
  curCar: null,
  carRoot: null,
  carObs: null,
  carReady: false,
  CARS: [],

  // Battle Royale state
  BR: { on: false, over: false, t0: 0, off: 0, Z: [], acc: 0, bAcc: 0, key: '', winnerId: -1 },
  ZPT: null,

  // Multiplayer state
  NET: {
    host: false, id: 0, nextId: 1, max: 6,
    peer: null, conn: null, conns: new Map(),
    code: '', seed: 1, target: 10, name: 'Jugador',
    players: {}, started: false, ended: false, late: false,
    iv: 0, to: 0, nb: 0, botPref: 'auto',
    pingMs: 0, pingSentAt: 0, pingTimer: 0,
    my: { fwd: 0, side: 0, spd: 0, wade: false },
  },
  RMS: {},

  // Input flags
  keys: {},
  AIM: 0,
  rmb: false,
  mouse: false,
  locked: false,
  free: false,

  // Entity references
  player: null,
  rifle: null,
  weapons: {},
  muzzle: null,
  flash: null,
  bots: [],
  activeBotCount: 8,
  POT: [],
  grens: [],
  loots: [],
};
