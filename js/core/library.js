// The pool API: everything the shell asks about "which lot is this / what does its card print
// / is the shipped number still true". Pure — it reads js/data/lots.js and the book, and never
// searches (the re-derivation in `verifyLot` is book lookups only, which is what lets the
// browser run the same audit the build did).

import { LOTS, TIERS_META, BOOK, DAILY_IDS, BAKED_AT, SCHEMA } from '../data/lots.js';
import { area, encodeShape, validateShape } from './shapes.js';
import { decodeBook, report, countOutcomes } from './book.js';
import { hashSeed, mulberry32 } from './rng.js';

let map = null;

export function bookMap() {
  if (!map) map = decodeBook(BOOK);
  return map;
}

export const SCHEMA_ID = SCHEMA;
export const BAKED_AT_ISO = BAKED_AT;

export const lots = LOTS;
export const tiers = TIERS_META;
export const tierKeys = TIERS_META.map((t) => t.key);

export function lotById(id) {
  return LOTS.find((l) => l.id === id) || null;
}

export function lotsByTier(key) {
  return LOTS.filter((l) => l.tier === key);
}

export function poolStats() {
  return {
    lots: LOTS.length,
    byTier: Object.fromEntries(TIERS_META.map((t) => [t.key, lotsByTier(t.key).length])),
    states: BOOK.states,
    p: BOOK.p,
    n: BOOK.n,
    bound: BOOK.bound,
    bakedAt: BAKED_AT,
    schema: SCHEMA,
  };
}

// The numbers a lot card prints, re-derived from the SERIALISED shape by table lookups. Used
// by the shell (so a card can never print a number that disagrees with the book) and by
// test/library.test.mjs (so a hand-edited js/data/lots.js fails).
export function derive(lot) {
  return report(bookMap(), lot.shape);
}

export function verifyLot(lot) {
  const bad = [];
  if (validateShape(lot.shape)) bad.push('shape 非法：' + validateShape(lot.shape));
  if (lot.winner !== '先手') bad.push('winner 必须是先手（本仓只出先手必胜的题）');
  if (lot.cells !== area(lot.shape)) bad.push(`cells ${lot.cells} != area ${area(lot.shape)}`);
  if (!TIERS_META.some((t) => t.key === lot.tier)) bad.push('未知档位 ' + lot.tier);
  let r;
  try {
    r = derive(lot);
  } catch (err) {
    bad.push('棋书无法判定这关：' + err.message);
    return bad;
  }
  if (r.winner !== lot.winner) bad.push(`印着的 winner=${lot.winner} 与棋书 ${r.winner} 不一致`);
  if (r.k !== lot.k) bad.push(`印着的 k=${lot.k} 与棋书 ${r.k} 不一致`);
  if (encodeShape(lot.shape) !== r.shape) bad.push('shape 与棋书 key 不一致');
  const a = JSON.stringify(lot.winningMoves);
  const b = JSON.stringify(r.winningMoves);
  if (a !== b) bad.push(`winningMoves ${a} != 棋书 ${b}`);
  if (lot.legal !== r.legal) bad.push(`legal ${lot.legal} != 棋书 ${r.legal}`);
  // `chance` is shipped rounded to 6 decimals (see tools/bake.mjs); compare on the same grid
  // instead of against full precision, which no serialised number can ever hit.
  if (lot.chance !== Number(r.chance.toFixed(6))) bad.push(`chance ${lot.chance} != 棋书 ${Number(r.chance.toFixed(6))}`);
  // `states` is the size of THIS lot's own reachable set, so the book can only bound it from
  // above; the equality itself is re-checked against a fresh exhaustive solve in
  // test/library.test.mjs, which is the anti-hand-edit gate.
  if (!(lot.states >= 1) || lot.states > BOOK.states) bad.push(`states ${lot.states} 不在 1..${BOOK.states} 里`);
  return bad;
}

export function verifyPool() {
  const problems = [];
  const seen = new Set();
  for (const lot of LOTS) {
    if (seen.has(lot.id)) problems.push(`重复 id ${lot.id}`);
    seen.add(lot.id);
    for (const p of verifyLot(lot)) problems.push(`${lot.id}: ${p}`);
  }
  const book = countOutcomes(BOOK);
  if (book.states !== BOOK.states) problems.push(`book rows ${book.states} != declared ${BOOK.states}`);
  if (book.p !== BOOK.p) problems.push(`book P rows ${book.p} != declared ${BOOK.p}`);
  if (book.n !== BOOK.n) problems.push(`book N rows ${book.n} != declared ${BOOK.n}`);
  return problems;
}

// The chance grid the bake ships on: six decimals, so a derived lot and a baked lot print the
// same number and `verifyLot` can compare them exactly instead of with a tolerance.
export function printChance(chance) {
  return Number(chance.toFixed(6));
}

// `#/daily`: the date string is the seed, so every device on the same calendar day gets the
// same bar. Selection is a bounded index into a baked list — no generation, no search.
export function dailyLot(dateKey) {
  const key = String(dateKey || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new RangeError('dailyLot: 需要 YYYY-MM-DD，收到 ' + JSON.stringify(key));
  const ids = DAILY_IDS.length ? DAILY_IDS : LOTS.map((l) => l.id);
  const h = hashSeed('chomp-daily:' + key);
  const rng = mulberry32(h);
  const id = ids[rng.int(ids.length)];
  const base = lotById(id);
  if (!base) throw new Error('daily 指向了一个不存在的题 ' + id);
  const r = derive(base);
  return {
    ...base,
    id: `daily-${key}`,
    sourceId: base.id,
    mode: 'daily',
    day: key,
    label: `每日毒格 · ${key}`,
    k: r.k,
    winningMoves: r.winningMoves,
    chance: printChance(r.chance),
  };
}

// `#/random/<tier>/<seed>`: a stable puzzle per (tier, seed) inside the baked pool.
export function randomLot(seed, tierKey) {
  const pool = tierKey && tierKeys.includes(tierKey) ? lotsByTier(tierKey) : LOTS;
  const rng = mulberry32(hashSeed(`chomp-random:${tierKey || 'any'}:${String(seed)}`));
  const base = pool[rng.int(pool.length)];
  const r = derive(base);
  return { ...base, id: `random-${tierKey || 'any'}-${String(seed)}`, sourceId: base.id, mode: 'random', k: r.k, winningMoves: r.winningMoves, chance: printChance(r.chance) };
}

export function tierMeta(key) {
  return TIERS_META.find((t) => t.key === key) || null;
}
