// The animation state: a fixed-step accumulator, so nothing on screen depends on the display
// refresh. `advance(a, elapsed)` is the ONLY place a frame delta enters the simulation; inside
// `step()` every term is `x += v * s` with s === SIM_STEP, which is why the same state comes out
// of 30, 60 and 120 Hz.
//
// It is a pure module — no canvas, no window, no DOM — so `node --test` can drive it directly
// (test/anim.test.mjs) and the browser can render from it without owning any of the maths. That
// suite is both the proof and the proof-of-the-proof: it feeds 30/60/120 Hz against one seeded
// LCG and diffs every field, and `CHOMP_ANIM=<mutant> node test/anim.test.mjs` must go red when
// the accumulator line below is frozen to a constant.

export const SIM_STEP = 1 / 120;   // 120 Hz fixed step: every display rate is a multiple-ish
export const MAX_STEPS = 20;       // a 168 ms hitch may not turn into a particle avalanche
export const GRAVITY = 1500;       // px/s^2, crumbs fall
export const CRUMB_DRAG = 0.86;    // per 1/60 s, applied as pow(k, s*60) so the rate is dt-true
export const SHAKE_DECAY = 0.88;   // per 1/60 s, same treatment
export const PULSE_HZ = 0.62;      // the poison square breathes at this rate

// Deterministic LCG (numerical recipes constants). `Math.random()` never decides a game or a
// particle value in this repo: a run has to be reproducible from its seed for the suites.
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createAnim({ seed = 20260930, reducedMotion = false } = {}) {
  return {
    seed: seed >>> 0,
    rng: makeRng(seed),
    clock: 0,          // virtual seconds of simulation actually run
    simSteps: 0,
    accumulator: 0,    // leftover frame time waiting for the next fixed step
    particles: [],
    shake: 0,          // px of screen shake, decays to 0
    pulse: 0,          // 0..1 breathing phase for the poison square
    emitted: 0,        // total crumbs ever spawned (a monotone witness for the harness)
    reducedMotion,
  };
}

export function setReducedMotion(a, on) {
  a.reducedMotion = !!on;
  if (a.reducedMotion) {
    a.particles.length = 0; // the switch takes effect immediately, not on the next bite
    a.shake = 0;
  }
  return a.reducedMotion;
}

// One fixed step. `s` is always SIM_STEP in production; it is a parameter so a test can prove
// the step itself is rate-agnostic without going through the accumulator.
export function step(a, s) {
  a.simSteps += 1;
  a.clock += s;
  if (!a.reducedMotion) {
    a.pulse = (a.pulse + s * PULSE_HZ) % 1;
    a.shake *= Math.pow(SHAKE_DECAY, s * 60);
    if (a.shake < 0.02) a.shake = 0;
    const live = [];
    for (const p of a.particles) {
      p.vy += GRAVITY * s;
      p.vx *= Math.pow(CRUMB_DRAG, s * 60);
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.rot += p.spin * s;
      p.life -= s;
      if (p.life > 0) live.push(p);
    }
    a.particles = live;
  }
}

// Frame entry point. Returns how many sim steps this frame ran — the harness aligns by step
// count rather than by wall clock, because 1000/60 does not divide exactly.
export function advance(a, elapsed) {
  a.accumulator += elapsed;
  let steps = 0;
  while (a.accumulator >= SIM_STEP && steps < MAX_STEPS) {
    a.accumulator -= SIM_STEP;
    step(a, SIM_STEP);
    steps += 1;
  }
  if (a.accumulator > SIM_STEP * MAX_STEPS) a.accumulator = 0; // dropped time is dropped out loud
  return steps;
}

// A bite throws crumbs out of every square that vanished. Positions are canvas CSS pixels —
// the view owns the geometry, this module only integrates it.
export function emitBite(a, squares, geom, { strength = 1 } = {}) {
  if (a.reducedMotion) return 0;
  let n = 0;
  for (const [r, c] of squares) {
    const q = geom(r, c);
    const count = 2 + Math.floor(a.rng() * 3);
    for (let i = 0; i < count; i++) {
      a.particles.push({
        x: q.x + a.rng() * q.w,
        y: q.y + a.rng() * q.h,
        vx: (a.rng() - 0.5) * 260 * strength,
        vy: (-120 - a.rng() * 240) * strength,
        rot: a.rng() * Math.PI,
        spin: (a.rng() - 0.5) * 9,
        size: 3 + a.rng() * 5,
        life: 0.42 + a.rng() * 0.46,
        tone: a.rng(),
      });
      n += 1;
    }
  }
  a.emitted += n;
  a.shake = Math.min(9, a.shake + 3.4 * strength + Math.log2(1 + squares.length));
  return n;
}

// The refused-tap puff: same integrator, no crumbs, just a shake so a rejected click is felt
// even with the sound off.
export function rejectKick(a) {
  if (a.reducedMotion) return 0;
  a.shake = Math.min(6, a.shake + 2.2);
  return a.shake;
}

// Everything a restart owes the player: live crumbs, the half-frame in the accumulator, the
// shake and the breathing phase. The monotone witnesses (clock, simSteps, emitted) deliberately
// survive — a harness uses them to tell "the loop is still honest" apart from "the loop was
// rewound to look clean".
export function resetTransient(a) {
  const cleared = { particles: a.particles.length, accumulator: a.accumulator, shake: a.shake, pulse: a.pulse };
  a.particles = [];
  a.accumulator = 0;
  a.shake = 0;
  a.pulse = 0;
  return cleared;
}

export function snapshot(a) {
  return {
    clock: a.clock,
    simSteps: a.simSteps,
    accumulator: a.accumulator,
    particles: a.particles.length,
    emitted: a.emitted,
    shake: a.shake,
    pulse: a.pulse,
    reducedMotion: a.reducedMotion,
  };
}
