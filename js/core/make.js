// The bands and the eligibility rule — what a position has to be before it may become a lot.
//
// Chomp is an impartial two-player game, so there is no "shortest solution length" to print:
// the number that means something is the GAME-THEORY VALUE (P or N, from the exhaustive table)
// plus how many first bites actually realise the win. `k` is that count and it is the
// difficulty dial of this repo: k = 1 means exactly one square survives the search, k = 6 means
// the win is sloppy. The share of legal first bites that win, `chance = k / legal`, is printed
// on the lot card too, so "hard" is never a string.
//
// Size caps (see DESIGN for why they are not arbitrary): positions are order ideals, so an
// r × w rectangle reaches C(r+w, r) - 1 positions. Row/area caps below keep the whole universe
// inside a 419-position table that the bake classifies exhaustively in milliseconds.

import { MAX_AREA, MAX_ROWS, MAX_WIDTH, area, encodeShape, validateShape } from './shapes.js';

export const BANDS = [
  {
    key: 'shoal', label: '浅咬', rows: '2 行 · 最长 4 格',
    bounds: { rows: 2, width: 4, area: 8 },
    minCells: 3,
    blurb: '两行小块：完整刻画只有阶梯型必败局，先手要挑对唯一那一口',
  },
  {
    key: 'linked', label: '连排', rows: '2 行 · 最长 8 格',
    bounds: { rows: 2, width: 8, area: 16 },
    minCells: 4,
    blurb: '两行长条：必胜首口稀薄，阶梯 (k,k-1) 的陷阱就在旁边',
  },
  {
    key: 'twined', label: '三缕', rows: '3 行 · 面积 ≤ 12',
    bounds: { rows: 3, width: 6, area: 12 },
    minCells: 5,
    blurb: '三行：序理想开始分叉，表里的必败局面不再是阶梯',
  },
  {
    key: 'master', label: '满盘', rows: '3–4 行 · 面积 ≤ 18',
    bounds: { rows: 4, width: 8, area: 18 },
    minCells: 8,
    blurb: '本仓上限：面积 ≤ 18 的 3、4 行形状，穷举仍然逐位可复算',
  },
];
// Candidates: every legal bar inside a band, enumerated exhaustively (no sampling, so the
// acceptance figure below is a census rather than an estimate).
export function candidates(band) {
  const bound = band.bounds;
  const out = [];
  const walk = (prefix, maxLen, areaLeft) => {
    for (let v = Math.min(maxLen, areaLeft); v >= 1; v--) {
      prefix.push(v);
      emit(prefix);
      if (prefix.length < bound.rows) walk(prefix, v, areaLeft - v);
      prefix.pop();
    }
  };
  const emit = (prefix) => {
    const s = prefix.slice();
    if (s.length > bound.rows || s[0] > bound.width || area(s) > bound.area) return;
    out.push(s);
  };
  walk([], bound.width, bound.area);
  return out.sort((a, b) => (area(a) - area(b)) || (a.length - b.length) || encodeShape(a).localeCompare(encodeShape(b), 'en', { numeric: true }));
}

// A candidate becomes a lot only if:
//   * it is inside its band's caps (rows / width / area) — the table must cover it;
//   * it is a first-player win (winner 先手): a lot the player cannot win is not a puzzle;
//   * k >= 1, and per the spec the printed k is either 1 ("首口唯一") or an explicit count;
//   * it has at least `minCells` squares, so the bar is not just the poison plus one bite.
// `why` names the gate that rejected a candidate; the bake prints the tally, so the acceptance
// rate can be audited instead of believed.
export function eligibility(shape, analysis, band) {
  const v = validateShape(shape);
  if (v) return { ok: false, why: 'invalid' };
  if (shape.length > band.bounds.rows) return { ok: false, why: 'rows' };
  if (shape[0] > band.bounds.width) return { ok: false, why: 'width' };
  if (area(shape) > band.bounds.area) return { ok: false, why: 'area' };
  if (!analysis.n) return { ok: false, why: 'p-position' };
  if (analysis.k < 1) return { ok: false, why: 'no-winning-move' };
  if (area(shape) < band.minCells) return { ok: false, why: 'too-small' };
  if (analysis.states > MAX_STATES) return { ok: false, why: 'too-many-states' };
  return { ok: true };
}

// Hard ceiling on the table a single lot may print. Set from the measured universe size, not
// from a wish: the whole universe is 419 positions, and a lot's own reachable set is a subset.
export const MAX_STATES = 419;

export function outsideUniverse(shape, bound = { rows: MAX_ROWS, width: MAX_WIDTH, area: MAX_AREA }) {
  if (validateShape(shape)) return 'invalid';
  if (shape.length > bound.rows) return 'rows';
  if (shape[0] > bound.width) return 'width';
  if (area(shape) > bound.area) return 'area';
  return null;
}
