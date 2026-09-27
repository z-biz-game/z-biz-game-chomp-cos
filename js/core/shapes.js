// The position model. No DOM, no window, no randomness, no solver — just the shape algebra
// Chomp is played on, so `node --test` can import it directly.
//
// A position is a chocolate bar whose remaining squares form an ORDER IDEAL of the grid:
// written as the non-increasing vector of row lengths
//
//     shape = [s0, s1, ..., s(r-1)],   s0 >= s1 >= ... >= s(r-1) >= 1
//
// Row 0 is the top row and (0,0) — the first square of the first row — is the poisoned one.
// "Non-increasing" is not a convention, it is the physical invariant: a bite takes a square
// together with everything below-and-right of it, so a bar can never have a square floating
// to the right of a gap. Every assertion about legality in this repo ultimately rests on
// `validateShape` below refusing exactly the vectors that break it.
//
// Two invariants the rest of the code is allowed to rely on (test/model.test.mjs打负例 for
// each of them):
//   * biting any legal square yields a vector that is still non-increasing;
//   * the set of positions reachable from a shape is closed under biting (no surprises).

export const MAX_ROWS = 4;
export const MAX_WIDTH = 10;
export const MAX_AREA = 18;

// A bite is a coordinate pair: the square at row `r`, column `c` (0-based, column 0 is the
// poisoned edge). Everything at (r' >= r, c' >= c) goes with it.
export function biteKey(m) {
  return m[0] + '.' + m[1];
}

export function parseBiteKey(key) {
  const [r, c] = String(key).split('.').map(Number);
  return [r, c];
}

// Positions are stored and compared by key, never by array identity.
export function encodeShape(shape) {
  if (!Array.isArray(shape)) throw new TypeError('encodeShape: not an array');
  return shape.join('.');
}

export function decodeShape(key) {
  const s = String(key);
  if (s === '') return [];
  if (!/^\d+(\.\d+)*$/.test(s)) throw new TypeError(`decodeShape: malformed key ${JSON.stringify(s)}`);
  return s.split('.').map(Number);
}
// `null` when the vector really is a chocolate bar, otherwise a message that says which
// invariant broke. This is the guard every other entry point runs first: the solver, the
// generator, the view and the shipped data all refuse on it.
export function validateShape(shape) {
  if (!Array.isArray(shape)) return 'shape 不是数组';
  if (shape.length === 0) return 'shape 为空（毒格也已被咬掉，不是可行动的局面）';
  if (!Number.isInteger(shape.length)) return 'shape 长度不是整数';
  for (let i = 0; i < shape.length; i++) {
    const v = shape[i];
    if (typeof v !== 'number' || !Number.isInteger(v)) return `第 ${i} 行长度不是整数`;
    if (v <= 0) return `第 ${i} 行长度 ${v} 应为正数（空行必须整行去掉）`;
    if (i > 0 && shape[i] > shape[i - 1]) {
      return `第 ${i} 行长度 ${shape[i]} 大于上一行 ${shape[i - 1]}：序理想不允许悬空的格子`;
    }
  }
  return null;
}

export function checkShape(shape) {
  const err = validateShape(shape);
  if (err) throw new Error(err);
  return shape;
}

export function isShape(shape) {
  return validateShape(shape) === null;
}

// Is `a` a bar that physically fits inside `b` (an order ideal of it)? Used to prove that the
// reachable set of a lot never leaves the baked table.
export function fitsIn(a, b) {
  if (validateShape(a) || validateShape(b)) return false;
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] > b[i]) return false;
  return true;
}

export function area(shape) {
  checkShape(shape);
  let n = 0;
  for (const v of shape) n += v;
  return n;
}
export function isTerminal(shape) {
  checkShape(shape);
  return shape.length === 1 && shape[0] === 1;
}

// The legal bites of a position, in a canonical order (row-major, ascending column).
//
// Two rule sets share this function, because the ONLY difference between them is whether
// (0,0) may be bitten:
//   * Chomp (default): the poisoned square may not be taken voluntarily. Biting (0,0) would
//     eat the whole bar including the poison, which loses on the spot, so it is not an option.
//   * `poisonless: true` — the counter-factual used by test/solve.test.mjs: remove that rule
//     and the last square wins. If the poison rule is what decides the game, then the bare
//     bar [1] must flip from 必败 to 必胜 under this flag, and it does.
export function legalBites(shape, opts = {}) {
  checkShape(shape);
  const allowPoison = opts.poisonless === true;
  const out = [];
  for (let r = 0; r < shape.length; r++) {
    // Column 0 below the top row is legal (it shortens the bar without touching the poison);
    // only (0,0) is the poisoned square itself.
    for (let c = (r === 0 && !allowPoison) ? 1 : 0; c < shape[r]; c++) out.push([r, c]);
  }
  return out;
}

export function isLegalBite(shape, m, opts) {
  if (!Array.isArray(m) || m.length !== 2) return false;
  const [r, c] = m;
  if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
  if (r < 0 || r >= shape.length) return false;
  if (c < 0 || c >= shape[r]) return false;
  if (r === 0 && c === 0 && !(opts && opts.poisonless === true)) return false;
  return validateShape(shape) === null;
}

export function biteReason(shape, m, opts = {}) {
  if (validateShape(shape)) return '局面非法';
  if (!Array.isArray(m) || m.length !== 2 || !Number.isInteger(m[0]) || !Number.isInteger(m[1])) return '没有指到格子';
  const [r, c] = m;
  if (r < 0 || r >= shape.length) return '行越界';
  if (c < 0 || c >= shape[r]) return '那一格早已被咬空';
  if (r === 0 && c === 0 && !(opts.poisonless === true)) {
    return isTerminal(shape) ? '只剩毒格：咬下去即输' : '毒格不能主动咬';
  }
  return null;
}

// Apply a bite. Returns a NEW vector; the input is never mutated (purity is asserted in
// test/solve.test.mjs by diffing a deep copy before and after a full table build).
//
// Rows above `r` keep their lengths; rows from `r` down are clipped to `c` columns; the rows
// clipped to 0 drop off the bar. The result is empty only for the poison bite (0,0).
export function applyBite(shape, m, opts = {}) {
  const reason = biteReason(shape, m, opts);
  if (reason) throw new Error('非法咬法：' + reason);
  const [r, c] = m;
  const next = [];
  for (let i = 0; i < shape.length; i++) {
    const len = i < r ? shape[i] : Math.min(shape[i], c);
    if (len > 0) next.push(len);
  }
  return next;
}

// Every position that can ever appear on the screen for this lot, including the lot itself.
// This is the reachable set: the closure of `shape` under legal bites, and it is exactly the
// set of non-empty order ideals contained in `shape` (test/solve.test.mjs proves the two
// characterisations agree on every baked lot, which is the non-trivial part of the claim).
export function reachableShapes(shape, opts = {}) {
  checkShape(shape);
  const seen = new Map();
  const queue = [shape];
  seen.set(encodeShape(shape), shape);
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const m of legalBites(cur, opts)) {
      const next = applyBite(cur, m, opts);
      if (next.length === 0) continue; // poison taken: not a position the next player acts on
      const k = encodeShape(next);
      if (!seen.has(k)) {
        seen.set(k, next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()].sort((a, b) => (area(a) - area(b)) || (a.length - b.length) || (a[0] - b[0]) || (a[1] || 0) - (b[1] || 0));
}

// A rectangle, the shape Chomp is usually stated on: `rows` identical rows of `cols` squares.
export function rectangle(rows, cols) {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError('rectangle: 需要正的行列数');
  }
  return Array.from({ length: rows }, () => cols);
}


