// The content pipeline: everything the game prints is measured here, once, at build time.
//
// Two artefacts are written into js/data/lots.js:
//   1. BOOK — the exhaustive minimax table of the whole position universe (every bar with at
//      most 4 rows, at most 10 columns and at most 18 squares). One row per position:
//      `<shape>:<P/N>/<perfect move>`. The browser only ever looks things up in it, which is
//      how "the opponent is proven, not guessed" survives contact with a tap handler.
//   2. LOTS — the campaign. A shape only becomes a lot if a FRESH solve of it (its own
//      reachable set, built independently of the universe table) agrees with the BOOK on
//      winner / k / winningMoves, and if it clears the band gates in js/core/make.js.
//
// Every number in the summary line below is a measurement this script performs, including the
// acceptance rate: candidates are a full census of the band, not a sample, so `accept` is the
// exact fraction and not an estimate.
//
//   node tools/bake.mjs
//   PER_BAND=10 node tools/bake.mjs
//
// Re-running must be reproducible for everything except BAKED_AT: no Math.random, no
// iteration-order dependence (everything is sorted before it is compared or written).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BANDS, candidates, eligibility, MAX_STATES } from '../js/core/make.js';
import { area, encodeShape } from '../js/core/shapes.js';
import { buildTable, solveUniverse, rectangleIdealCount, subIdealCount } from '../js/core/solve.js';
import { encodeBook, decodeBook, report } from '../js/core/book.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PER_BAND = Number(process.env.PER_BAND || 8);
const SCHEMA = 'chomp-lots-v1';

const t0 = Date.now();
const ms = (a, b) => Number(((b - a) / 1000).toFixed(3));

// ---------------------------------------------------------------- the book
const uStart = Date.now();
const universe = solveUniverse();
const universeMs = ms(uStart, Date.now());
const book = encodeBook(universe);
// Round-trip the encoding before anything depends on it: a book that does not survive
// serialisation would print a different verdict in the browser than in the build.
const roundTrip = decodeBook(book);
if (roundTrip.size !== universe.shapes) {
  throw new Error(`bake: 棋书编码往返丢行 ${roundTrip.size} != ${universe.shapes}`);
}
for (const [key, hit] of roundTrip) {
  const node = universe.memo.get(key);
  if (!node) throw new Error('bake: 棋书里出现了宇宙外的局面 ' + key);
  if (!!hit.n !== !!node.n) throw new Error(`bake: 棋书与求解器对 ${key} 的判定相反`);
  if (JSON.stringify(hit.move) !== JSON.stringify(node.move)) {
    throw new Error(`bake: 棋书与求解器给 ${key} 的建议着法不同`);
  }
}
console.log(`book: ${book.states} positions (${book.p} P / ${book.n} N) in ${universeMs}s · bound ${JSON.stringify(book.bound)}`);

// ---------------------------------------------------------------- the lots
const lots = [];
const report_rows = [];

for (const band of BANDS) {
  const cands = candidates(band);
  const reasons = {};
  const eligible = [];
  let solveMs = 0;
  let worstMs = 0;
  let worstStates = 0;
  let worstBites = 0;
  for (const shape of cands) {
    // The lot's OWN table: built from scratch, not by slicing the universe, so the shipped
    // numbers do not inherit the book's assumptions.
    const s = Date.now();
    const table = buildTable(shape);
    const took = (Date.now() - s) / 1000;
    solveMs += took;
    if (took > worstMs) worstMs = took;
    const node = table.memo.get(encodeShape(shape));
    const analysis = { n: node.n, k: node.winning.length, states: table.states, bites: table.bites };
    if (analysis.states > worstStates) worstStates = analysis.states;
    if (table.bites > worstBites) worstBites = table.bites;
    const gate = eligibility(shape, analysis, band);
    if (!gate.ok) {
      reasons[gate.why] = (reasons[gate.why] || 0) + 1;
      continue;
    }
    // Cross-check the two independent routes before trusting either: the fresh per-lot table
    // and the universe book must classify this shape identically, and its reachable set must
    // match the closed forms for order ideals.
    const fromBook = report(roundTrip, shape);
    if (fromBook.winner !== (node.n ? '先手' : '后手')) {
      throw new Error(`bake: ${encodeShape(shape)} 棋书判定 ${fromBook.winner} != 独立求解 ${node.n ? '先手' : '后手'}`);
    }
    if (JSON.stringify(fromBook.winningMoves) !== JSON.stringify(node.winning)) {
      throw new Error(`bake: ${encodeShape(shape)} 两路求解给出的必胜口不同`);
    }
    if (table.states !== subIdealCount(shape)) {
      throw new Error(`bake: ${encodeShape(shape)} 可达集 ${table.states} != 序理想计数 ${subIdealCount(shape)}`);
    }
    if (shape.length === 1) {
      const closed = rectangleIdealCount(1, shape[0]);
      if (table.states !== closed) throw new Error(`bake: 单行 ${encodeShape(shape)} 可达集 != 闭式 ${closed}`);
    }
    eligible.push({
      id: '',
      tier: band.key,
      shape,
      cells: area(shape),
      winner: node.n ? '先手' : '后手',
      k: node.winning.length,
      winningMoves: node.winning.map((m) => [m[0], m[1]]),
      legal: fromBook.legal,
      chance: Number(fromBook.chance.toFixed(6)),
      states: table.states,
      bites: table.bites,
      ms: Number(took.toFixed(4)),
      label: `${shape.length}×${shape[0]} ${shape.length === 1 ? '单行' : ''}`.trim(),
    });
  }

  if (!eligible.length) throw new Error(`bake: 档位 ${band.key} 一题都不合格，参数写错了`);

  // A band is played as a curve, so spread it over k (the difficulty dial) first and take the
  // bigger table inside each k. Deterministic: sorted before picking, no randomness anywhere.
  const byK = new Map();
  for (const lot of eligible) {
    if (!byK.has(lot.k)) byK.set(lot.k, []);
    byK.get(lot.k).push(lot);
  }
  for (const list of byK.values()) {
    list.sort((a, b) => (b.states - a.states) || (b.cells - a.cells) || encodeShape(a.shape).localeCompare(encodeShape(b.shape), 'en', { numeric: true }));
  }
  const kKeys = [...byK.keys()].sort((a, b) => a - b);
  const picked = [];
  for (let round = 0; picked.length < PER_BAND && round < 40; round++) {
    for (const k of kKeys) {
      if (byK.get(k)[round]) {
        picked.push(byK.get(k)[round]);
        if (picked.length >= PER_BAND) break;
      }
    }
  }
  picked.sort((a, b) => (a.k - b.k) || (b.states - a.states));
  picked.forEach((lot, i) => {
    lot.id = `${band.key}-${String(i + 1).padStart(2, '0')}`;
  });
  lots.push(...picked);

  const accept = picked.length / cands.length;
  const rated = eligible.length / cands.length;
  report_rows.push({
    band: band.key,
    label: band.label,
    cands: cands.length,
    eligible: eligible.length,
    rated: Number((rated * 100).toFixed(1)),
    shipped: picked.length,
    accept: Number((accept * 100).toFixed(1)),
    reasons,
    kRange: [Math.min(...picked.map((l) => l.k)), Math.max(...picked.map((l) => l.k))],
    statesRange: [Math.min(...picked.map((l) => l.states)), Math.max(...picked.map((l) => l.states))],
    solveMs: Number(solveMs.toFixed(3)),
    worstMs: Number(worstMs.toFixed(3)),
    worstStates,
    worstBites,
  });
}

// ---------------------------------------------------------------- the file
const meta = BANDS.map((band) => {
  const mine = lots.filter((l) => l.tier === band.key);
  const row = report_rows.find((r) => r.band === band.key);
  return {
    key: band.key,
    label: band.label,
    rows: band.rows,
    bounds: band.bounds,
    blurb: band.blurb,
    lots: mine.length,
    cands: row.cands,
    acceptPct: row.accept,
    kMin: Math.min(...mine.map((l) => l.k)),
    kMax: Math.max(...mine.map((l) => l.k)),
    statesMin: Math.min(...mine.map((l) => l.states)),
    statesMax: Math.max(...mine.map((l) => l.states)),
    chanceMin: Math.min(...mine.map((l) => l.chance)),
    chanceMax: Math.max(...mine.map((l) => l.chance)),
    statesCap: MAX_STATES,
  };
});

const lines = [
  '// Generated by tools/bake.mjs — the numbers in this game are measurements, not opinions.',
  'export const SCHEMA = ' + JSON.stringify(SCHEMA) + ';',
  'export const BAKED_AT = ' + JSON.stringify(new Date().toISOString()) + ';',
  '// BOOK: the exhaustive minimax table of the whole position universe, one row per position:',
  '// `<shape>:<1 if the mover wins else 0>/<the perfect player\'s bite>`. js/core/book.js looks',
  '// things up here; nothing in the browser solves. Re-derive it with `node tools/bake.mjs` and',
  '// audit it with `node test/book.test.mjs`.',
  'export const BOOK = ' + JSON.stringify(book) + ';',
  '// Per-band census: how many shapes the band contains, how many passed the gates, and the',
  '// rejection tally. `acceptPct` is an exact fraction of a full enumeration — see DESIGN.',
  'export const TIERS_META = ' + JSON.stringify(meta) + ';',
  '// LOTS: one row per puzzle. `winner`/`k`/`winningMoves` come from a fresh exhaustive solve',
  '// of the row\'s own reachable set (`states` positions, `bites` edges, `ms` build seconds)',
  '// and are cross-checked against BOOK before writing. `chance` = k / legal: the exact',
  '// probability that a uniformly random first bite wins, which is what "hard" means here.',
  'export const LOTS = [',
  ...lots.map((l) => '  ' + JSON.stringify(l) + ','),
  '];',
  '// The `#/daily` draw pool: ids the date seed may pick. Kept explicit so a re-bake that',
  '// changes the pool changes the daily for everybody, loudly.',
  'export const DAILY_IDS = ' + JSON.stringify(lots.map((l) => l.id)) + ';',
  '',
];
const body = lines.join('\n');
const outPath = join(root, 'js', 'data', 'lots.js');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, body);

const total = (Date.now() - t0) / 1000;
console.log(`wrote ${lots.length} lots (${report_rows.map((r) => `${r.band}:${r.shipped}`).join(' ')}) -> js/data/lots.js in ${total.toFixed(2)}s`);
for (const r of report_rows) {
  console.log(`${r.band}: candidates ${r.cands} (full census) · N-eligible ${r.eligible} (${r.rated}%) · shipped ${r.shipped} (accept ${r.accept}%) · reject ${JSON.stringify(r.reasons)} · k ${r.kRange.join('-')} · states ${r.statesRange.join('-')} · per-shape solve ${r.solveMs}s total, worst ${r.worstMs}s / ${r.worstStates} states / ${r.worstBites} edges`);
}
console.log(`file: ${(Buffer.byteLength(body) / 1024).toFixed(1)} kB`);
