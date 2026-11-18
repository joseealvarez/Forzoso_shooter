// Procedural WebAudio sound engine for Isla Battle
import { SETTINGS } from './state.js';

let ctx = null;
let noiseBuf = null;
let engineOsc = null;
let engineGain = null;
let engineFilter = null;
let windSrc = null;
let windFilter = null;
let windGain = null;

function ensureCtx() {
  if (SETTINGS.muted || SETTINGS.volume <= 0.01) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const len = ctx.sampleRate * 1.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch (_) {
    return null;
  }
}

export function unlockAudio() {
  ensureCtx();
}

function gainVal(base) {
  return Math.max(0, Math.min(1, base * (SETTINGS.muted ? 0 : SETTINGS.volume)));
}

export function playShot(weaponId = 'm16', dist = 0) {
  const c = ensureCtx();
  if (!c) return;
  const atten = Math.max(0.04, 1 - dist / 95);
  const baseVol = weaponId === 'shotgun' ? 0.36 : weaponId === 'smg' ? 0.22 : 0.28;
  const vol = gainVal(baseVol * atten);
  if (vol <= 0.005) return;

  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(weaponId === 'shotgun' ? 540 : weaponId === 'smg' ? 1680 : 1120, now);
  bp.frequency.exponentialRampToValueAtTime(weaponId === 'shotgun' ? 190 : 340, now + (weaponId === 'shotgun' ? 0.2 : 0.1));
  bp.Q.value = weaponId === 'shotgun' ? 0.9 : 1.5;

  const g = c.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + (weaponId === 'shotgun' ? 0.22 : weaponId === 'smg' ? 0.075 : 0.11));

  src.connect(bp);
  bp.connect(g);
  g.connect(c.destination);
  src.start(now);
  src.stop(now + 0.24);

  const osc = c.createOscillator();
  const og = c.createGain();
  osc.type = weaponId === 'smg' ? 'square' : 'triangle';
  osc.frequency.setValueAtTime(weaponId === 'shotgun' ? 120 : weaponId === 'smg' ? 240 : 190, now);
  osc.frequency.exponentialRampToValueAtTime(weaponId === 'shotgun' ? 38 : 52, now + 0.09);
  og.gain.setValueAtTime(vol * (weaponId === 'shotgun' ? 0.9 : 0.65), now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc.connect(og);
  og.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.11);

  // Subtle pump rack sound for Shotgun
  if (weaponId === 'shotgun' && dist < 8) {
    const cl = c.createOscillator();
    const cg = c.createGain();
    cl.type = 'triangle';
    cl.frequency.setValueAtTime(620, now + 0.24);
    cl.frequency.setValueAtTime(840, now + 0.31);
    cg.gain.setValueAtTime(vol * 0.28, now + 0.24);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.37);
    cl.connect(cg);
    cg.connect(c.destination);
    cl.start(now + 0.24);
    cl.stop(now + 0.38);
  }
}

export function playReload() {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(0.18);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  [0, 0.45, 1.15].forEach((offset, idx) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(idx === 2 ? 780 : 520 + idx * 110, now + offset);
    g.gain.setValueAtTime(vol, now + offset);
    g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.055);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.06);
  });
}

export function playHitmarker(kill = false) {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(kill ? 0.28 : 0.2);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(kill ? 1480 : 1120, now);
  osc.frequency.exponentialRampToValueAtTime(kill ? 880 : 620, now + 0.07);
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.09);
}

export function playHurt() {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(0.25);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(135, now);
  osc.frequency.exponentialRampToValueAtTime(52, now + 0.14);
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}

export function playExplosion(dist = 0) {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(Math.max(0.05, Math.min(1, 1.2 - dist / 80)) * 0.75);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(560, now);
  lp.frequency.exponentialRampToValueAtTime(90, now + 0.85);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
  src.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  src.start(now);
  src.stop(now + 0.92);
}

export function playSplash(dist = 0) {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(0.16 * Math.max(0.05, 1 - dist / 65));
  if (vol <= 0.005) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1600, now);
  bp.frequency.exponentialRampToValueAtTime(500, now + 0.25);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
  src.connect(bp);
  bp.connect(g);
  g.connect(c.destination);
  src.start(now);
  src.stop(now + 0.27);
}

export function playFootstep(biomeName) {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(biomeName === 'Mar' ? 0.12 : 0.07);
  if (vol <= 0.004) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = biomeName === 'Mar' ? 'bandpass' : 'lowpass';
  f.frequency.value = biomeName === 'Nieve' ? 1800 : biomeName === 'Playa' ? 950 : biomeName === 'Mar' ? 1250 : 620;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(now);
  src.stop(now + 0.08);
}

export function playPickup() {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(0.2);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  [520, 780].forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + i * 0.06);
    g.gain.setValueAtTime(vol, now + i * 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.12);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(now + i * 0.06);
    osc.stop(now + i * 0.06 + 0.13);
  });
}

export function playShieldSip() {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(0.14);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(290, now);
  osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}

export function playShieldComplete() {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(0.22);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  [587.33, 880, 1174.66].forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + i * 0.055);
    g.gain.setValueAtTime(vol, now + i * 0.055);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.35);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(now + i * 0.055);
    osc.stop(now + i * 0.055 + 0.36);
  });
}

export function playGliderOpen() {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(0.24);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(320, now);
  bp.frequency.exponentialRampToValueAtTime(980, now + 0.18);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  src.connect(bp);
  bp.connect(g);
  g.connect(c.destination);
  src.start(now);
  src.stop(now + 0.26);
}

export function updateWindSound(active, intensity = 0.5, isBus = false) {
  if (!active || SETTINGS.muted || SETTINGS.volume <= 0.01) {
    if (windGain && ctx) windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    return;
  }
  const c = ensureCtx();
  if (!c) return;
  if (!windSrc) {
    windSrc = c.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    windFilter = c.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 1.1;
    windGain = c.createGain();
    windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(c.destination);
    windSrc.start();
  }
  const freq = isBus ? 180 : 280 + intensity * 620;
  const v = gainVal(isBus ? 0.065 : 0.04 + intensity * 0.1);
  windFilter.frequency.setTargetAtTime(freq, c.currentTime, 0.08);
  windGain.gain.setTargetAtTime(v, c.currentTime, 0.08);
}

export function playVictoryFanfare() {
  const c = ensureCtx();
  if (!c) return;
  const vol = gainVal(0.26);
  if (vol <= 0.005) return;
  const now = c.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + i * 0.12);
    g.gain.setValueAtTime(vol, now + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.55);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(now + i * 0.12);
    osc.stop(now + i * 0.12 + 0.56);
  });
}

export function updateEngineSound(active, speedAbs, isBike = false, isMoto = false) {
  if (!active || isBike || SETTINGS.muted || SETTINGS.volume <= 0.01) {
    if (engineGain && ctx) {
      engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    }
    return;
  }
  const c = ensureCtx();
  if (!c) return;
  if (!engineOsc) {
    engineOsc = c.createOscillator();
    engineFilter = c.createBiquadFilter();
    engineGain = c.createGain();
    engineOsc.type = 'sawtooth';
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 260;
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(c.destination);
    engineOsc.start();
  }
  const norm = Math.min(1, speedAbs / 35);
  const baseHz = isMoto ? 64 : 44;
  engineOsc.frequency.setTargetAtTime(baseHz + norm * (isMoto ? 115 : 75), c.currentTime, 0.06);
  engineFilter.frequency.setTargetAtTime(220 + norm * 480, c.currentTime, 0.06);
  engineGain.gain.setTargetAtTime(gainVal(0.045 + norm * 0.075), c.currentTime, 0.06);
}
