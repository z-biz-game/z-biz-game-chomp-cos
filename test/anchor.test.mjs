// THE ANCHOR SUITE. Everything here is an external fact: the expectations are typed as literals
// in this file (or in test/fixture.mjs), never read back from js/core. If the solver and these
// rows disagree, the solver is wrong — that is the whole point of the file.
//
// Run: node test/anchor.test.mjs

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  buildTable, solvePosition, twoRowIsP, singleRowIsN, isRectangleStealable,
} from '../js/core/solve.js';
import { applyBite, encodeShape, legalBites } from '../js/core/shapes.js';
import { decodeBook } from '../js/core/book.js';
import { BOOK, LOTS } from '../js/data/lots.js';
import { HAND, TWO_ROW_P, SINGLE_ROW_N } from './fixture.mjs';
import { naiveTable, bruteWin } from './naive.mjs';

const map = decodeBook(BOOK);

// ---------------------------------------------------------------- anchor 1: two rows
// The published characterisation: for a 2-row bar the second-player wins are EXACTLY the
// staircase (k, k-1). Enumerated over the full range a <= 9 in this repo's terms.
test('两行情形的必败局恰好是阶梯 (k,k-1)，k=2..9 —— 与外部锚点逐位相同', () => {
  const got = [];
  for (let a = 2; a <= 9; a++) {
    for (let b = 1; b <= a; b++) {
      if (!solvePosition([a, b]).n) got.push([a, b]);
    }
  }
  eq(got, TWO_ROW_P, '两行必败局集合');
});

for (const [a, b] of TWO_ROW_P) {
  test(`阶梯 [${a},${b}] 是必败局（后手胜）`, () => {
    const r = solvePosition([a, b]);
    eq(r.winner, '后手', 'winner');
    eq(r.n, false, 'P');
    eq(r.k, 0, '没有必胜首口');
    eq(r.winningMoves, [], 'winningMoves 为空');
  });
}

test('阶梯之外、a<=9 的两行局没有一个是必败局（反方向逐条）', () => {
  const stair = new Set(TWO_ROW_P.map((s) => s.join('.')));
  let checked = 0;
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= a; b++) {
      if (stair.has(`${a}.${b}`)) continue;
      const r = solvePosition([a, b]);
      ok(r.n, `[${a},${b}] 应为必胜，实为 ${r.winner}`);
      checked++;
    }
  }
  eq(checked, 45 - 8, '两行范围内检查过的必胜局面数 = 45 个两行局 - 8 条阶梯');
});

test('两行闭式（Tweed 刻画）与穷举在 a<=9 全区间逐点一致', () => {
  for (let a = 1; a <= 9; a++) {
    for (let b = 1; b <= a; b++) {
      eq(twoRowIsP(a, b), !solvePosition([a, b]).n, `[${a},${b}]`);
    }
  }
});

// ---------------------------------------------------------------- anchor 2: one row
test('单行 1..9 的胜负向量逐位等于外部锚点', () => {
  const got = SINGLE_ROW_N.map((want, i) => solvePosition([i + 1]).n === true);
  eq(got, SINGLE_ROW_N, '单行向量');
});

for (let w = 1; w <= 9; w++) {
  test(`单行宽度 ${w}：${SINGLE_ROW_N[w - 1] ? '必胜' : '必败'}`, () => {
    const r = solvePosition([w]);
    eq(r.n, SINGLE_ROW_N[w - 1]);
    eq(singleRowIsN(w), SINGLE_ROW_N[w - 1], '闭式');
    if (w > 1) eq(r.winningMoves, [[0, 1]], '把长行咬到只剩毒格是唯一那一口');
    else eq(r.winningMoves, [], '裸毒格没有口');
  });
}

// ---------------------------------------------------------------- anchor 3: stealing
// Strategy stealing: no rectangle with at least two squares can be a second-player win. The
// classical proof is non-constructive, so the assertion is that the table agrees with it.
for (const n of [2, 3, 4, 5]) {
  test(`${n}×${n} 方阵先手必胜（策略窃取的可执行版本）`, () => {
    const shape = Array.from({ length: n }, () => n);
    const r = solvePosition(shape);
    eq(r.winner, '先手');
    ok(r.k >= 1, '至少一口');
    eq(isRectangleStealable(n, n), true, '闭式判定');
  });
}

test('策略窃取对全部非退化矩形成立（rows*cols>=2，逐条查表）', () => {
  for (let rows = 1; rows <= 4; rows++) {
    for (let cols = 1; cols <= 8; cols++) {
      if (rows * cols < 2) continue;
      const shape = Array.from({ length: rows }, () => cols);
      ok(solvePosition(shape).n, `${rows}×${cols} 应为必胜`);
    }
  }
});

// ---------------------------------------------------------------- other routes
test('第二条路：naive 自底向上枚举在两行全区间给出同一张判定表', () => {
  const win = naiveTable({ rows: 2, width: 9, cap: 17 });
  for (const [key, n] of win) {
    eq(!!n, solvePosition(key.split('.').map(Number)).n, `naive vs solve ${key}`);
  }
  ok(win.size >= 45, '两行宇宙至少 45 个局面');
});

test('第三条路：无记忆化暴力递归在手算 fixture 上复核', () => {
  let checked = 0;
  for (const h of HAND) {
    if (h.shape.reduce((a, b) => a + b, 0) > 9) continue;
    eq(bruteWin(h.shape), h.n, `bruteWin ${h.shape}`);
    checked++;
  }
  ok(checked >= 7, '小面积 fixture 全部走过：' + checked);
});

test('烘焙棋书自己复现阶梯锚点：宇宙里的两行必败局面恰好是那 8 条', () => {
  const pset = [];
  for (const line of BOOK.rows) {
    const [shape, verdict] = line.split(':');
    if (verdict[0] !== '0') continue;
    const parts = shape.split('.').map(Number);
    if (parts.length === 2) pset.push(parts);
  }
  eq(pset, TWO_ROW_P.filter(([a]) => a <= BOOK.bound.width));
  eq(pset.length, 8, '阶梯条数');
});

test('棋书里每个必败局面的每个后继都是必胜（P 的定义，逐条不抽样）', () => {
  eq(BOOK.p + BOOK.n, BOOK.states, 'P + N = states');
  eq(BOOK.p, 36, '宇宙 P 数');
  let pChecked = 0;
  let edges = 0;
  for (const [key, hit] of map) {
    if (hit.n) continue;
    pChecked++;
    for (const m of legalBites(hit.shape)) {
      const next = applyBite(hit.shape, m);
      if (!next.length) continue;
      const child = map.get(encodeShape(next));
      ok(child, `后继 ${encodeShape(next)} 必须在棋书里`);
      eq(child.n, true, `${key} 的后继 ${encodeShape(next)} 应为 N`);
      edges++;
    }
  }
  eq(pChecked, BOOK.p, 'P 局面全部检查');
  ok(edges > 100, '走过的 P 边数 ' + edges);
});

// ---------------------------------------------------------------- hand fixtures
for (const h of HAND) {
  test(`手算 fixture ${encodeShape(h.shape)}：${h.n ? '必胜' : '必败'}，k=${h.k}`, () => {
    const r = solvePosition(h.shape);
    eq(r.n, h.n, 'n');
    eq(r.winner, h.n ? '先手' : '后手', 'winner');
    eq(r.k, h.k, 'k');
    eq(r.winningMoves, h.winning, 'winningMoves');
    eq(r.states, h.states, 'states');
  });
}

test('关卡表里的每一关都是先手必胜（本仓不出必败题），且 k>=1', () => {
  ok(LOTS.length >= 24, '关卡数 ' + LOTS.length);
  for (const lot of LOTS) {
    const r = solvePosition(lot.shape);
    eq(r.winner, '先手', `${lot.id} winner`);
    ok(r.k >= 1, `${lot.id} k>=1`);
  }
});

run();
