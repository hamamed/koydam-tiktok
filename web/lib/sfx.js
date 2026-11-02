'use client';
/**
 * Sound effects made with the Web Audio API (no files to load, works offline in OBS).
 * In OBS tick «Control audio via OBS» on the browser source to hear them in the stream.
 */
let ctx = null; let master = null;
function ac(volume) {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  master.gain.value = Math.max(0, Math.min(1, volume ?? 0.6));
  return ctx;
}
function tone(c, { f = 440, f2, t = 0, d = 0.2, type = 'sine', v = 0.3, at = 0.005 }) {
  const o = c.createOscillator(); const g = c.createGain(); const s = c.currentTime + t;
  o.type = type; o.frequency.setValueAtTime(f, s); if (f2) o.frequency.exponentialRampToValueAtTime(f2, s + d);
  g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(v, s + at); g.gain.exponentialRampToValueAtTime(0.0001, s + d);
  o.connect(g); g.connect(master); o.start(s); o.stop(s + d + 0.05);
}
function noise(c, { t = 0, d = 0.3, v = 0.25, hp = 800, lp = 6000 }) {
  const n = Math.floor(c.sampleRate * d); const buf = c.createBuffer(1, n, c.sampleRate); const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf; const g = c.createGain(); g.gain.value = v;
  const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; const l = c.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp;
  src.connect(h); h.connect(l); l.connect(g); g.connect(master); src.start(c.currentTime + t);
}
const SOUNDS = {
  coin: (c) => { tone(c, { f: 988, d: 0.08, type: 'square', v: 0.12 }); tone(c, { f: 1319, t: 0.07, d: 0.18, type: 'square', v: 0.12 }); },
  chime: (c) => [784, 988, 1175, 1568].forEach((f, i) => tone(c, { f, t: i * 0.07, d: 0.35, type: 'triangle', v: 0.22 })),
  drum: (c) => { [0, 0.14, 0.28].forEach((t) => { tone(c, { f: 120, f2: 50, t, d: 0.25, v: 0.6 }); noise(c, { t, d: 0.08, v: 0.15, hp: 1500 }); }); tone(c, { f: 523, t: 0.42, d: 0.4, type: 'sawtooth', v: 0.12 }); },
  whistle: (c) => { tone(c, { f: 2600, d: 0.25, v: 0.18 }); tone(c, { f: 2600, t: 0.32, d: 0.55, v: 0.18 }); },
  goal: (c) => { noise(c, { d: 1.6, v: 0.35, hp: 300, lp: 3000 }); [523, 659, 784, 1047].forEach((f, i) => tone(c, { f, t: 0.1 + i * 0.12, d: 0.4, type: 'sawtooth', v: 0.12 })); },
  fanfare: (c) => [[523, 0], [523, 0.15], [523, 0.3], [698, 0.45], [880, 0.75], [1047, 1.05]].forEach(([f, t]) => tone(c, { f, t, d: t > 0.9 ? 0.9 : 0.22, type: 'sawtooth', v: 0.14 })),
  sweep: (c) => { tone(c, { f: 200, f2: 1600, d: 0.9, type: 'sawtooth', v: 0.12 }); tone(c, { f: 1600, t: 0.9, d: 0.5, type: 'triangle', v: 0.2 }); },
  ding: (c) => { tone(c, { f: 1047, d: 0.6, type: 'triangle', v: 0.25 }); tone(c, { f: 1568, t: 0.02, d: 0.5, v: 0.1 }); },
  success: (c) => [659, 784, 1047].forEach((f, i) => tone(c, { f, t: i * 0.1, d: 0.3, type: 'triangle', v: 0.22 })),
  hit: (c) => { tone(c, { f: 180, f2: 60, d: 0.18, type: 'square', v: 0.25 }); noise(c, { d: 0.1, v: 0.2, hp: 1000 }); },
};
export function playSfx(name, volume) {
  const c = ac(volume); const fn = SOUNDS[name]; if (!c || !fn) return;
  try { fn(c); } catch { /* ignore */ }
}
export const SFX_NAMES = Object.keys(SOUNDS);
