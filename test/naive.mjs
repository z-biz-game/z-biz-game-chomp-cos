// A SECOND, deliberately independent solver, written to not share a line of logic with
// js/core/solve.js: its own move rule, its own enumeration of the position set (all
// non-increasing triples by area, bottom-up), its own classification loop. The reason it
// exists is the contract's demand for evidence that the search is not grading itself: when two
// implementations written differently agree on every position in the universe, a shared bug is
// much harder to hide.
//
// Not exported to the game. Tests only.

// The move rule, re-typed on purpose: biting (r,c) leaves rows above r untouched and clips
// every row from r down to c columns; rows clipped to 0 disappear. (0,0) is the poison and may
// not be bitten.
function biteAt(rows, r, c) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const len = i < r ? rows[i] : Math.min(rows[i], c);
    if (len > 0) out.push(len);
  }
  return out;
}

function options(rows) {
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const from = r === 0 ? 1 : 0;
    for (let c = from; c < rows[r]; c++) {
      const next = biteAt(rows, r, c);
      if (next.length) out.push(next);
    }
  }
  return out;
}

const key = (rows) => rows.join('.');

// Every bar with at most `rows` rows, longest row at most `width`, and area at most `cap`.
export function allBars({ rows = 3, width = 9, cap = 12 } = {}) {
  const bag = [];
  for (let a = 1; a <= width; a++) {
    bag.push([[a]]);
    for (let b = 1; b <= Math.min(a, width); b++) {
      if (a + b > cap) continue;
      bag.push([[a, b]]);
      for (let c = 1; c <= Math.min(b, width); c++) {
        if (a + b + c > cap) continue;
        bag.push([[a, b, c]]);
      }
    }
  }
  const seen = new Map();
  for (const group of bag) for (const s of group) seen.set(key(s), s);
  return [...seen.values()].sort((x, y) => x.reduce((a, b) => a + b, 0) - y.reduce((a, b) => a + b, 0));
}

// Bottom-up classification over a position set that is closed under `options`.
export function naiveTable(bound) {
  const bars = allBars(bound);
  const win = new Map();
  let skipped = 0;
  for (const rows of bars) {
    let n = false;
    for (const next of options(rows)) {
      const k = key(next);
      if (!win.has(k)) {
        skipped++;
        continue; // left the declared universe; counted so the caller can notice
      }
      if (!win.get(k)) {
        n = true;
        break;
      }
    }
    win.set(key(rows), n);
  }
  if (skipped) throw new Error('naiveTable: ' + skipped + ' 个后继跑到了宇宙外');
  return win;
}

// Brute-force recursion with NO memo at all, for the handful of positions where the game tree
// is small enough to walk: the answer is "can the mover reach a position the opponent cannot".
export function bruteWin(rows, depth = 0) {
  if (depth > 64) throw new Error('bruteWin: 递归过深');
  for (const next of options(rows)) {
    if (!bruteWin(next, depth + 1)) return true;
  }
  return false;
}
