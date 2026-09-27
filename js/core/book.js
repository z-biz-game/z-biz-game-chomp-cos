// The opening book: the serialised form of the exhaustive table, and the ONLY thing the
// browser consults while playing.
//
// Shape of the shipped payload:
//   { bound: {rows,width,area}, states, p, n, rows: [ "9.8:0/1.0", ... ] }
// Each row is `<shape>:<outcome>/<bite>` — outcome 1 = N (the mover wins), 0 = P (the mover
// loses), bite is the move the perfect player chooses there ('-' for the bare poisoned square,
// where no legal bite exists). One row per position of the universe; the universe contains
// every bar the game can display and is closed under biting, so a lookup can never miss.
//
// Why this file has no solver import: the claim of the repo is "the opponent is proven, not
// guessed", and that claim dies the moment an input handler may search. Everything here is a
// Map.get plus at most `area` map lookups of ALREADY-CLASSIFIED successors — bounded by 18
// with no recursion, no memo and no possibility of a miss. test/book.test.mjs asserts a
// position outside the book THROWS rather than triggering a search.

import { area, encodeShape, legalBites, applyBite, validateShape } from './shapes.js';

export function encodeBook(universe) {
  const rows = [];
  for (const node of universe.memo.values()) {
    const m = node.move;
    rows.push(`${node.key}:${node.n ? 1 : 0}/${m ? m[0] + '.' + m[1] : '-'}`);
  }
  rows.sort();
  return {
    bound: universe.bound,
    states: universe.shapes,
    p: universe.p,
    n: universe.n,
    rows,
  };
}

export function decodeBook(book) {
  if (!book || !Array.isArray(book.rows)) throw new TypeError('book.rows 缺失：棋书未烘焙');
  const map = new Map();
  for (const line of book.rows) {
    const hit = /^([0-9.]+):([01])\/([0-9.-]+)$/.exec(line);
    if (!hit) throw new Error('book: 无法解析的行 ' + JSON.stringify(line));
    const shape = hit[1].split('.').map(Number);
    if (validateShape(shape)) throw new Error('book: 行携带非法 shape ' + line);
    const move = hit[3] === '-' ? null : hit[3].split('.').map(Number);
    if (map.has(hit[1])) throw new Error('book: 重复的局面 ' + hit[1]);
    map.set(hit[1], { shape, n: hit[2] === '1', move });
  }
  if (map.size !== book.states) {
    throw new Error(`book: 行数 ${map.size} 与声明的 states ${book.states} 不一致`);
  }
  return map;
}

class MissError extends Error {}

// Look a position up. Throws on a miss — deliberately: a silent fall-back to `solvePosition`
// would turn "the AI never searches live" from a checkable claim into a habit that cannot be
// falsified.
export function lookup(map, shape) {
  const err = validateShape(shape);
  if (err) throw new RangeError('lookup: ' + err);
  const key = encodeShape(shape);
  const hit = map.get(key);
  if (!hit) throw new MissError(`book: 局面 ${key} 不在棋书里（越出烘焙范围，拒绝现场搜索）`);
  return hit;
}

export function inBook(map, shape) {
  try {
    return map.has(encodeShape(shape));
  } catch {
    return false;
  }
}

// Classify a position from the table alone.
export function classify(map, shape) {
  const hit = lookup(map, shape);
  return { shape: encodeShape(shape), n: hit.n, winner: hit.n ? '先手' : '后手' };
}

// The perfect player's answer in this position, straight out of the table.
export function bookMove(map, shape) {
  const hit = lookup(map, shape);
  return hit.move ? [hit.move[0], hit.move[1]] : null;
}

// Every winning bite of a position, by looking each successor up. `map` already classifies
// them, so this is one pass over at most area(shape) candidates — no recursion.
export function winningBitesOf(map, shape) {
  lookup(map, shape); // range check on the input itself
  const out = [];
  for (const m of legalBites(shape)) {
    const next = applyBite(shape, m);
    if (!next.length) continue;
    const hit = map.get(encodeShape(next));
    if (hit === undefined) throw new MissError(`book: 后继 ${encodeShape(next)} 不在棋书里`);
    if (!hit.n) out.push([m[0], m[1]]);
  }
  return out;
}

// The full printed record for a position: who wins, how many first bites win, which ones, and
// how many positions the proof covers. Used by the hint button and by the re-derivation test.
export function report(map, shape) {
  const winning = winningBitesOf(map, shape);
  const c = classify(map, shape);
  return {
    shape: encodeShape(shape),
    winner: c.winner,
    n: c.n,
    k: winning.length,
    winningMoves: winning,
    legal: legalBites(shape).length,
    chance: winning.length / Math.max(1, legalBites(shape).length),
    cells: area(shape),
    move: bookMove(map, shape),
  };
}

// Number of positions in the book whose classification says "the mover is lost". Recomputed
// from the serialised rows so the headline `p` count is checkable after decode, not only in
// the solver that produced it.
export function countOutcomes(book) {
  const map = decodeBook(book);
  let p = 0;
  let n = 0;
  let missingMove = 0;
  for (const hit of map.values()) {
    if (hit.n) n++;
    else p++;
    if (!hit.move) missingMove++;
  }
  return { states: map.size, p, n, missingMove };
}
