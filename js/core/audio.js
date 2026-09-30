// Sound, and the mute switch that really stops it.
//
// The contract this file exists to satisfy (and the one most "mute buttons" in the wild break):
//   * muting calls `suspend()` on the AudioContext — the graph stops running, the clock stops;
//   * while muted, NOT ONE oscillator or buffer source is ever created. The gate is the first
//     line of `voice()`, before any `create*` call, so a muted session costs zero nodes. Setting
//     a gain to 0 and keeping the oscillators alive is a fake mute and this repo does not do it.
//   * unmuting calls `resume()`, and the very next bite builds its nodes from scratch.
//
// Node-safety: `js/core/*` is imported by `node --test`, where no AudioContext exists. Every
// entry point degrades to a no-op and reports `available: false` rather than throwing.

let ctx = null;
let master = null;
let muted = false;
let built = 0;    // oscillators ever created — the mute test asserts this stops growing

function AudioCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export function audioAvailable() {
  return AudioCtor() !== null;
}

// Browsers refuse to start audio before a gesture, so the context is built on the first one.
export function unlockAudio() {
  const Ctor = AudioCtor();
  if (!Ctor) return false;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch (err) {
      ctx = null;
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (muted) {
    // Stay asleep: a muted session must not be running a context at all.
    if (ctx.state === 'running' && typeof ctx.suspend === 'function') ctx.suspend().catch(() => {});
  } else if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    ctx.resume().catch(() => {});
  }
  return true;
}

export function setMuted(on) {
  muted = !!on;
  if (muted) suspendContext();
  else resumeContext();
  return muted;
}

export function isMuted() {
  return muted;
}

// Pause and mute share one mechanism — the context is parked, not turned down — but they are
// separate reasons, so a paused-and-muted session resumes into silence rather than into sound.
export function suspendContext() {
  if (!ctx || typeof ctx.suspend !== 'function' || ctx.state !== 'running') return ctx ? ctx.state : 'none';
  ctx.suspend().catch(() => {});
  return ctx.state;
}

export function resumeContext() {
  if (!ctx || typeof ctx.resume !== 'function' || ctx.state === 'closed') return ctx ? ctx.state : 'none';
  ctx.resume().catch(() => {});
  return ctx.state;
}

export function audioState() {
  return {
    available: audioAvailable(),
    muted,
    built,
    context: ctx ? ctx.state : 'none',   // none | suspended | running | closed
    time: ctx ? Math.round(ctx.currentTime * 1000) / 1000 : 0,
  };
}

// The single gate every sound goes through. Returns null when there is nothing to play into —
// and note the order: the mute check is BEFORE any node is created, which is the whole point.
function voice({ type = 'triangle', from, to, dur = 0.12, peak = 0.5, at = 0 }) {
  if (muted) return null;
  if (!ctx) unlockAudio();
  if (!ctx || ctx.state !== 'running') return null;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.3));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  built += 1;
  return osc;
}

function noise({ dur = 0.09, peak = 0.28, at = 0, cutoff = 1200 }) {
  if (muted) return null;
  if (!ctx) unlockAudio();
  if (!ctx || ctx.state !== 'running') return null;
  const t0 = ctx.currentTime + at;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // xorshift32, seeded from the frame count: the same bite always sounds the same.
  let z = (Math.imul(frames + 1, 2654435761) ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < frames; i++) {
    z ^= (z << 13) >>> 0; z >>>= 0;
    z ^= z >> 17;
    z ^= z << 5; z >>>= 0;
    data[i] = ((z / 4294967296) - 0.5) * 2 * (1 - i / frames);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt);
  filt.connect(gain);
  gain.connect(master);
  src.start(t0);
  built += 1;
  return src;
}

// One word per event the player can hear. Nothing here is a loop or an ambient bed: the game is
// a board, and a board should not hum.
const VOICES = {
  bite: () => { noise({ dur: 0.11, peak: 0.34, cutoff: 2400 }); voice({ type: 'square', from: 210, to: 96, dur: 0.13, peak: 0.16 }); },
  refuse: () => { voice({ type: 'sawtooth', from: 132, to: 84, dur: 0.16, peak: 0.2 }); },
  hint: () => { voice({ type: 'sine', from: 880, to: 1320, dur: 0.14, peak: 0.16 }); },
  undo: () => { voice({ type: 'sine', from: 520, to: 320, dur: 0.12, peak: 0.14 }); },
  win: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => voice({ type: 'triangle', from: f, dur: 0.2, peak: 0.2, at: i * 0.09 }));
  },
  lose: () => {
    [392, 311.13, 233.08].forEach((f, i) => voice({ type: 'triangle', from: f, to: f * 0.92, dur: 0.26, peak: 0.2, at: i * 0.13 }));
  },
  ui: () => { voice({ type: 'sine', from: 660, dur: 0.05, peak: 0.09 }); },
};

export function sfx(name) {
  const v = VOICES[name];
  if (!v) return false;
  v();
  return true;
}

export function resetAudioForTest() {
  // The suites import this module repeatedly in one process; without a reset the `built`
  // counter from an earlier scenario would be read as evidence by a later one.
  if (ctx && typeof ctx.close === 'function') { try { ctx.close(); } catch (err) { /* already closed */ } }
  ctx = null;
  master = null;
  built = 0;
  muted = false;
}
