// The save file: one localStorage key, plain JSON, versioned shape.
//
// This is the ONLY module under js/core that is allowed to mention `window`, and it is
// guarded: `node --test` imports this file with no window at all, and the browser may refuse
// storage (private window, blocked third-party context, quota). The rule the repo follows:
//   * reading degrades to an in-memory blank, so the game is always playable;
//   * asking whether the session really persists goes through `requireBackend()`, which
//     THROWS instead of returning null. A probe that answers "no storage" by handing back
//     `null` cannot tell a refused store apart from an empty one, and that difference is
//     exactly what the @save suite asserts.
//
// Two monotonicities are the whole design and test/storage.test.mjs writes them out of order
// to prove them: `best` only ever goes DOWN, `unlocked` only ever goes UP.

const KEY = 'chomp.save.v1';

export const SAVE_KEY = KEY;

export class StorageError extends Error {}

export function requireBackend() {
  if (typeof window === 'undefined') throw new StorageError('no window: node 进程里没有可持久化的存档');
  if (!window.localStorage) throw new StorageError('window.localStorage 不存在');
  return window.localStorage;
}

function backend() {
  try {
    return requireBackend();
  } catch (err) {
    return null; // memory-only session: the game still plays, it just forgets
  }
}

function count(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function flag(v) {
  return !!v;
}

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    stats: { plays: 0, wins: 0, losses: 0, plies: 0, hints: 0 },
    settings: { muted: false, seenTutorial: false, motionOverride: null },
  };
}

// One record at a time, never the whole file: a settings blob that arrived as `null` (an older
// writer, a hand-edited key, a truncated quota write) must cost the player that one field, not
// their whole save. Object.assign(defaults, parsed) is the shape that throws on exactly `null`
// and takes the whole game down with it, so nothing here merges blindly.
function decodeSettings(raw) {
  const base = blank().settings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const override = raw.motionOverride;
  return {
    muted: flag(raw.muted),
    seenTutorial: flag(raw.seenTutorial),
    motionOverride: override === 'reduce' || override === 'full' ? override : null,
  };
}

function decodeRecords(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, rec] of Object.entries(raw)) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue; // one corrupt record is dropped, the rest survive
    out[id] = rec;
  }
  return out;
}

function decodeDaily(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [day, rec] of Object.entries(raw)) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    out[day] = rec;
  }
  return out;
}

let cache = null;

function load() {
  if (cache) return cache;
  const ls = backend();
  const raw = ls ? window.localStorage.getItem(KEY) : null;
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        const s = (p.stats && typeof p.stats === 'object') ? p.stats : {};
        cache = {
          records: decodeRecords(p.records),
          daily: decodeDaily(p.daily),
          unlocked: count(p.unlocked) || base.unlocked,
          stats: {
            plays: count(s.plays),
            wins: count(s.wins),
            losses: count(s.losses),
            plies: count(s.plies),
            hints: count(s.hints),
          },
          settings: decodeSettings(p.settings),
        };
        return cache;
      }
    } catch (err) {
      // A corrupt save is not worth keeping: start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  if (!backend()) return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
    return true;
  } catch (err) {
    return false; // quota or a blocked store: the session simply stays in memory
  }
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  get unlocked() { return load().unlocked; },
  get settings() { return load().settings; },

  setMuted(on) {
    load().settings.muted = !!on;
    persist();
    return load().settings.muted;
  },

  markTutorialSeen() {
    load().settings.seenTutorial = true;
    persist();
    return true;
  },

  // 'reduce' | 'full' | null — null means "follow the OS", which is the default nobody should
  // have to opt into twice on every device they own.
  setMotionOverride(which) {
    load().settings.motionOverride = which === 'reduce' || which === 'full' ? which : null;
    persist();
    return load().settings.motionOverride;
  },

  record(id) {
    return load().records[id] || null;
  },

  // A finished match. `plies` counts both seats, which is the unit the lot card prints, so a
  // win "in n plies" is comparable with the record. A loss never overwrites an earlier win's
  // `best`, and `best` only moves down.
  finish(id, { won, plies, hints }) {
    const s = load();
    const prev = s.records[id] || null;
    const took = count(plies);
    const was = count(prev && prev.best);
    const best = won ? (was ? Math.min(was, took) : took) : was;
    const cur = {
      plays: count(prev && prev.plays) + 1,
      won: !!(prev && prev.won) || !!won,
      lastWon: !!won,
      lastPlies: took,
      ...(best ? { best } : {}),
      clean: !!(prev && prev.clean) || !!(won && !count(hints)),
    };
    s.records[id] = cur;
    s.stats.plays += 1;
    s.stats.plies += took;
    s.stats.wins += won ? 1 : 0;
    s.stats.losses += won ? 0 : 1;
    s.stats.hints += count(hints);
    persist();
    return cur;
  },

  hint(id) {
    const s = load();
    s.stats.hints += 1;
    const prev = s.records[id] || { plays: 0, won: false, lastWon: false, lastPlies: 0 };
    s.records[id] = { ...prev, hints: count(prev.hints) + 1 };
    persist();
    return s.records[id];
  },

  unlock(n) {
    const s = load();
    if (count(n) > s.unlocked) s.unlocked = count(n);
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id, { won } = {}) {
    const s = load();
    const prev = s.daily[dateKey];
    // Once a day is won it stays won: re-losing the daily must not erase the mark.
    if (prev && prev.won && !won) {
      s.daily[dateKey] = { id: prev.id, won: true, at: prev.at };
    } else {
      s.daily[dateKey] = { id, won: !!won, at: Date.now() };
    }
    persist();
    return s.daily[dateKey];
  },

  dailyDone(dateKey) {
    return load().daily[dateKey] || null;
  },

  totals() {
    const s = load();
    let solved = 0;
    for (const r of Object.values(s.records)) if (r && r.won) solved++;
    return { solved, plays: s.stats.plays, wins: s.stats.wins, losses: s.stats.losses, hints: s.stats.hints };
  },

  reset() {
    cache = blank();
    const ls = backend();
    if (ls) {
      try {
        ls.removeItem(KEY);
      } catch (err) {
        /* nothing was ever persisted */
      }
    }
    return cache;
  },
};

// Which backing store this session actually got. Goes through the throwing probe on purpose:
// `false` here means the store REFUSED, not that it happens to be empty.
export function persistent() {
  try {
    const ls = requireBackend();
    ls.setItem('chomp.probe', '1');
    ls.removeItem('chomp.probe');
    return true;
  } catch (err) {
    return false;
  }
}
