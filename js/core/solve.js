// The solver: exhaustive, memoised minimax over the reachable position set. This file owns
// every number the game prints.
//
// Why exhaustive is affordable here (and why it is NOT a live search behind a tap):
// Chomp positions are order ideals of a grid, and the reachable set of a bar with r rows and
// w squares in the top row is the set of sub-ideals of it — at most C(r+w, r) for a rectangle.
// For the shipped bands that is tens to low thousands of positions, so the WHOLE table is
// built in milliseconds at build time, serialised into js/data/lots.js, and looked up in the
// browser. `solvePosition` is never called from an input handler; js/core/book.js is.
//
// The recursion is on area: biting always strictly shrinks the bar, so a memoised depth-first
// pass terminates without an explicit visited set and without a depth limit. Every position in
// the reachable set is visited exactly once — `table.states` counts them and the tests compare
// that count against an independent closed form.
//
// Outcome convention (this is the whole game-theory content of the repo):
//   N (必胜, "先手") — the player to move can force a win.
//   P (必败, "后手") — under perfect play the player to move LOSES; the previous player wins.
//   [1] (只有毒格) is P: the mover has no non-suicidal bite, so they must take the poison.

import {
  MAX_AREA, MAX_ROWS, MAX_WIDTH, area, checkShape, encodeShape,
  fitsIn, legalBites, applyBite, validateShape,
} from './shapes.js';

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

// Build the full minimax table for everything reachable from `root`.
//
// Returns { root, memo, states, bites, poisonless } where
//   memo: Map<shapeKey, { shape, n /* true = N */, move, winning /* legal winning bites */,
//                         replies /* successors */, children }>
//   states: memo.size, i.e. the size of the reachable position set — the printed proof number
//   bites: how many (position, bite) edges the DP evaluated — the work the search really did
export function buildTable(root, opts = {}) {
  const err = validateShape(root);
  if (err) throw new Error('buildTable: ' + err);
  const poisonless = opts.poisonless === true;
  const memo = new Map();
  let bites = 0;

  function enter(shape) {
    const key = encodeShape(shape);
    const hit = memo.get(key);
    if (hit) return hit;
    const node = { shape, key, n: false, move: null, winning: [], replies: [], children: [] };
    memo.set(key, node);
    // Every bite shrinks the bar, so the recursive calls below always terminate.
    let wins = false;
    for (const m of legalBites(shape, { poisonless })) {
      bites++;
      const next = applyBite(shape, m, { poisonless });
      if (next.length === 0) {
        // Only reachable under `poisonless`: taking the last square wins, so the mover's
        // position is N. Under Chomp rules the poison bite is not a legal move at all.
        if (poisonless) {
          wins = true;
          node.winning.push(m);
        }
        continue;
      }
      const child = enter(next);
      node.children.push(child.key);
      node.replies.push({ move: m, key: child.key, n: child.n });
      if (!child.n) {
        wins = true;
        node.winning.push(m);
      }
    }
    if (node.winning.length) node.replies.sort((a, b) => (a.n === b.n ? 0 : a.n ? -1 : 1));
    node.n = wins;
    node.move = node.winning.length ? chooseWinning(node, opts) : chooseResisting(node, opts);
    return node;
  }

  enter(root);
  return { root: encodeShape(root), memo, states: memo.size, bites, poisonless };
}

// Among the winning bites, prefer the one that leaves the opponent the most bar: a longer
// game is a harder game, and it makes the AI's certificate "the opponent is lost AND will
// sweat about it" rather than an arbitrary tie-break. Deterministic: largest remaining area,
// then the lexicographically first bite among ties.
function chooseWinning(node, opts = {}) {
  const tie = opts.tieBreak || 'longest';
  let best = null;
  for (const m of node.winning) {
    const next = applyBite(node.shape, m, opts);
    // An empty result only happens under `poisonless`, where it is the immediate win.
    const score = next.length ? (tie === 'shortest' ? -area(next) : area(next)) : -1;
    if (!best || score > best.score || (score === best.score && biteKeyLess(m, best.m))) {
      best = { m, score };
    }
  }
  return best ? best.m : null;
}

// Already lost: no bite can change the value, so the table picks the one that keeps the most
// chocolate on the bar (maximum resistance). The value claim does not depend on this choice —
// from a P position every successor is N, which test/book.test.mjs checks exhaustively.
function chooseResisting(node, opts = {}) {
  const legal = legalBites(node.shape, opts);
  let best = null;
  for (const m of legal) {
    const next = applyBite(node.shape, m, opts);
    const score = next.length ? area(next) : -1;
    if (!best || score > best.score || (score === best.score && biteKeyLess(m, best.m))) {
      best = { m, score };
    }
  }
  return best ? best.m : null;
}

function biteKeyLess(a, b) {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
}

// One-shot classification of a single position. Still exhaustive over its own reachable set,
// so it is a solver call, not a table lookup: build time and tests only.
export function solvePosition(shape, opts) {
  const table = buildTable(shape, opts);
  const node = table.memo.get(encodeShape(shape));
  return {
    shape: encodeShape(shape),
    n: node.n,
    winner: node.n ? '先手' : '后手',
    move: node.move,
    winningMoves: node.winning.map((m) => [m[0], m[1]]),
    k: node.winning.length,
    states: table.states,
    bites: table.bites,
  };
}

export function isN(shape, opts) {
  return solvePosition(shape, opts).n === true;
}

export function isP(shape, opts) {
  return solvePosition(shape, opts).n === false;
}

// Every winning first bite of a position, as [row, col] pairs in the canonical order the
// generator and the tests compare against.
export function winningBites(shape, opts) {
  return solvePosition(shape, opts).winningMoves;
}
// ---------------------------------------------------------------------------
// the universe
// ---------------------------------------------------------------------------

// Every bar the game is allowed to show: at most MAX_ROWS rows, at most MAX_WIDTH columns, at
// most MAX_AREA squares, with the bands of js/core/make.js sitting strictly inside it. Because
// biting only ever shrinks a bar, the universe is closed under the move relation, which is
// what lets a SINGLE global table answer every question the screen can ask.
export function universeShapes(bound = {}) {
  const maxRows = bound.rows || MAX_ROWS;
  const maxWidth = bound.width || MAX_WIDTH;
  const maxArea = bound.area || MAX_AREA;
  const out = [];
  const grow = (prefix, maxLen, remainingRows, remainingArea) => {
    if (remainingRows === 0) {
      if (prefix.length) out.push(prefix.slice());
      return;
    }
    const hi = Math.min(maxLen, remainingArea);
    for (let v = 1; v <= hi; v++) {
      prefix.push(v);
      grow(prefix, v, remainingRows - 1, remainingArea - v);
      prefix.pop();
    }
    if (prefix.length) {
      out.push(prefix.slice());
      return;
    }
  };
  grow([], maxWidth, maxRows, maxArea);
  // `grow` emits each vector once per choice of where to stop; de-dup defensively and order by
  // (area, rows, width) so the serialised table is byte-stable across runs.
  const seen = new Map();
  for (const s of out) {
    if (s.length && s.length <= maxRows && s[0] <= maxWidth && area(s) <= maxArea) seen.set(encodeShape(s), s);
  }
  return [...seen.values()].sort((a, b) => (area(a) - area(b)) || (a.length - b.length) || encodeShape(a).localeCompare(encodeShape(b), 'en', { numeric: true }));
}

// The one table the shipped book is generated from: P/N for every position in the universe,
// plus the bite the perfect player would choose there.
export function solveUniverse(bound = {}) {
  const shapes = universeShapes(bound);
  const memo = new Map();
  // Bottom-up by area: a bite always reduces the area, so by the time a shape is classified
  // all of its successors already are. No recursion, no depth limit, and the classification is
  // identical to the memoised minimax above (test/book.test.mjs cross-checks the two routes).
  for (const shape of shapes) {
    const node = { shape, key: encodeShape(shape), n: false, move: null, winning: [] };
    for (const m of legalBites(shape)) {
      const next = applyBite(shape, m);
      if (!next.length) continue;
      const child = memo.get(encodeShape(next));
      if (!child) throw new Error('solveUniverse: successor left the universe — ' + encodeShape(next));
      if (!child.n) node.winning.push(m);
    }
    node.n = node.winning.length > 0;
    node.move = node.n ? chooseWinning(node) : chooseResisting(node);
    memo.set(node.key, node);
  }
  let p = 0;
  for (const node of memo.values()) if (!node.n) p++;
  return { shapes: memo.size, p, n: memo.size - p, memo, bound: { rows: bound.rows || MAX_ROWS, width: bound.width || MAX_WIDTH, area: bound.area || MAX_AREA } };
}

// ---------------------------------------------------------------------------
// closed forms: the independent routes the anchors are checked against
// ---------------------------------------------------------------------------

// Chomp on two rows (Tweed's theorem, the classical textbook result): the position [a, b] with
// a >= b >= 1 is a second-player win EXACTLY when a = b + 1. This is an external fact, not
// something this repo derived — test/anchor.test.mjs compares it square by square against the
// exhaustive DP over the whole 2-row range, which is what makes it evidence rather than a
// comment.
export function twoRowIsP(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1 || a < b) return null;
  return a === b + 1;
}

// A single row of w squares: the mover bites down to [1] and hands over a bare poisoned
// square, so every w >= 2 is N and w = 1 is P. Same role as above: an independently provable
// statement the DP must agree with.
export function singleRowIsN(w) {
  if (!Number.isInteger(w) || w < 1) return null;
  return w !== 1;
}

// Strategy stealing: no non-trivial rectangle can be a second-player win. The constructive
// certificate the tests look for is the bite that leaves a single column of the right height —
// for the shipped bound we verify by table instead of by prose.
export function isRectangleStealable(rows, cols) {
  if (rows * cols < 2) return false;
  const shape = Array.from({ length: rows }, () => cols);
  return solvePosition(shape).n === true;
}

// The number of order ideals of an r × w rectangle (including the empty one) is the binomial
// C(r+w, r). The reachable set of a rectangular lot is that count minus the empty ideal, so
// `states` has an independent closed form the tests check against.
export function binomial(n, k) {
  let acc = 1;
  for (let i = 1; i <= k; i++) acc = (acc * (n - k + i)) / i;
  return Math.round(acc);
}

export function rectangleIdealCount(rows, cols) {
  return binomial(rows + cols, rows) - 1;
}

// Reachable-set cross-check for an arbitrary (possibly non-rectangular) root: enumerate the
// sub-ideals directly instead of closing the move relation, and compare.
export function subIdealCount(root) {
  checkShape(root);
  let n = 0;
  const walk = (i, maxLen) => {
    if (i === root.length) {
      n++;
      return;
    }
    for (let v = Math.min(root[i], maxLen); v >= 1; v--) walk(i + 1, v);
    walk(i + 1, 0); // this row and every row below it are absent
  };
  // `walk` counts the all-absent vector too, which is not a position.
  walk(0, root[0]);
  return n - 1;
}

export function reachableViaSubIdeals(root) {
  checkShape(root);
  const out = [];
  const walk = (i, maxLen, prefix) => {
    if (i === root.length) {
      if (prefix.length) out.push(prefix.slice());
      return;
    }
    for (let v = Math.min(root[i], maxLen); v >= 1; v--) {
      prefix.push(v);
      walk(i + 1, v, prefix);
      prefix.pop();
    }
    walk(i + 1, 0, prefix);
  };
  walk(0, root[0], []);
  return out.filter((s) => fitsIn(s, root));
}
