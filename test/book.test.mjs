// The shipped book: encoding integrity, the range guard that makes "no live search" a checkable
// claim, and the AI-perfection census the spec demands (every position, not a sample).
// Run: node test/book.test.mjs

import { test, run, ok, eq, fail } from '../tools/harness.mjs';
import {
  classify, countOutcomes, decodeBook, encodeBook, inBook, lookup, report, winningBitesOf, bookMove,
} from '../js/core/book.js';
import { solveUniverse, buildTable, solvePosition } from '../js/core/solve.js';
import { applyBite, area, encodeShape, legalBites } from '../js/core/shapes.js';
import { BOOK, LOTS } from '../js/data/lots.js';

const map = decodeBook(BOOK);

// ---------------------------------------------------------------- integrity
test('棋书行数 == 声明的 states，且没有重复局面', () => {
  eq(BOOK.rows.length, BOOK.states, 'rows 与 states');
  eq(map.size, BOOK.states, '解码后');
  eq(new Set(BOOK.rows).size, BOOK.rows.length, '行去重');
});

test('countOutcomes 从序列化的行重新数出 P/N，与头部声明一致', () => {
  const c = countOutcomes(BOOK);
  eq(c.p, BOOK.p, 'P');
  eq(c.n, BOOK.n, 'N');
  eq(c.states, BOOK.states, 'states');
  eq(c.missingMove, 1, '全宇宙只有裸毒格 [1] 没有着法');
});

test('手工构造的坏棋书一律被拒（防止把棋书当可信输入）', () => {
  const bad = [
    [{ rows: ['2.1:'], states: 1 }, '缺字段'],
    [{ rows: ['no-slash:0/1.0', 'x'], states: 1 }, '无法解析'],
    [{ rows: ['2.1:0/1.0', '2.1:1/0.1'], states: 2 }, '重复局面'],
    [{ rows: ['2.3:0/1.0'], states: 1 }, '非增形状'],
    [{ rows: ['1:0/-'], states: 5 }, 'states 对不上'],
  ];
  for (const [book, why] of bad) {
    try {
      decodeBook(book);
      fail('应拒：' + why);
    } catch (err) {
      ok(/book|rows/.test(err.message), why + ' → ' + err.message);
    }
  }
  try {
    decodeBook(null);
    fail('null 也要拒');
  } catch (err) {
    ok(/rows/.test(err.message), err.message);
  }
});

test('encodeBook/decodeBook 往返：重新烘焙的棋书与文件里逐字节相同', () => {
  const again = encodeBook(solveUniverse());
  eq(again.rows, BOOK.rows, 'rows 全等');
  eq(again.states, BOOK.states);
  eq(again.p, BOOK.p);
  eq(again.n, BOOK.n);
  eq(JSON.stringify(again), JSON.stringify(BOOK), '序列化稳定（构建可复现）');
});

// ---------------------------------------------------------------- the range guard
test('范围外的局面查表抛异常，而不是现场搜索', () => {
  const outside = [11, 1]; // 11 列 > 宇宙上限 10
  eq(inBook(map, outside), false);
  try {
    lookup(map, outside);
    fail('lookup 必须抛');
  } catch (err) {
    ok(/不在棋书里/.test(err.message), err.message);
  }
  try {
    classify(map, outside);
    fail('classify 也必须抛');
  } catch (err) {
    ok(/不在棋书里/.test(err.message), err.message);
  }
  try {
    winningBitesOf(map, outside);
    fail('winningBitesOf 也要抛');
  } catch (err) {
    ok(/不在棋书里/.test(err.message), err.message);
  }
  for (const bad of [[], [1, 2], [0]]) {
    try {
      lookup(map, bad);
      fail('非法形状要抛：' + JSON.stringify(bad));
    } catch (err) {
      ok(/lookup|非法|序理想|正数/.test(err.message), err.message);
    }
  }
});

test('棋书对宇宙里每个局面都答得出（覆盖率 100%，不抽样）', () => {
  const uni = solveUniverse();
  let hit = 0;
  for (const node of uni.memo.values()) {
    ok(inBook(map, node.shape), encodeShape(node.shape) + ' 应在书里');
    hit++;
  }
  eq(hit, BOOK.states);
});

// ---------------------------------------------------------------- AI perfection
test('完美性普查：棋书给出的每一口在 N 局面通向 P，在 P 局面仍是合法口', () => {
  let n = 0;
  let p = 0;
  for (const [key, node] of map) {
    if (node.n) {
      n++;
      const m = bookMove(map, node.shape);
      ok(m, key + ' N 局面必须有着法');
      ok(isLegal(node.shape, m), key + ' 着法非法');
      const next = applyBite(node.shape, m);
      eq(classify(map, next).n, false, `${key} --(${m})--> ${encodeShape(next)} 应是 P`);
    } else {
      p++;
      const m = bookMove(map, node.shape);
      if (encodeShape(node.shape) === '1') {
        eq(m, null, '裸毒格没有着法');
        continue;
      }
      ok(m && isLegal(node.shape, m), key + ' P 局面也要给出合法口（它只是必败，不是不能走）');
      const next = applyBite(node.shape, m);
      eq(classify(map, next).n, true, `${key} 的任何一口都只能交出 N：${encodeShape(next)}`);
    }
  }
  eq(n, BOOK.n, 'N 局面全覆盖');
  eq(p, BOOK.p, 'P 局面全覆盖');
});

function isLegal(shape, m) {
  if (!m) return false;
  return legalBites(shape).some((x) => x[0] === m[0] && x[1] === m[1]);
}

test('report() 的胜口列表与独立求解逐关相同（印在卡面上的 k 就是这么来的）', () => {
  for (const lot of LOTS) {
    const r = report(map, lot.shape);
    const s = solvePosition(lot.shape);
    eq(r.winner, s.winner, lot.id + ' winner');
    eq(r.k, s.k, lot.id + ' k');
    eq(r.winningMoves, s.winningMoves, lot.id + ' winningMoves');
    eq(r.legal, legalBites(lot.shape).length, lot.id + ' legal');
    eq(r.chance, r.k / r.legal, lot.id + ' chance');
    eq(r.cells, area(lot.shape), lot.id + ' cells');
    eq(r.cells, lot.cells, lot.id + ' 印面 cells');
    eq(r.shape, encodeShape(lot.shape), lot.id + ' key');
  }
});

test('report() 的胜口都是棋书认可的 P 后继（查表口径自洽）', () => {
  let checked = 0;
  for (const lot of LOTS) {
    for (const m of winningBitesOf(map, lot.shape)) {
      eq(classify(map, applyBite(lot.shape, m)).n, false, `${lot.id} ${m}`);
      checked++;
    }
  }
  ok(checked >= LOTS.length, '检查过的胜口数 ' + checked);
});

test('两行情形在棋书里的刻画：必胜口的数量恒为 1（难度可测的地方）', () => {
  let twoRow = 0;
  for (const [key, node] of map) {
    const shape = node.shape;
    if (shape.length !== 2) continue;
    twoRow++;
    if (!node.n) {
      eq(winningBitesOf(map, shape), [], key + ' P 局面没有胜口');
      continue;
    }
    eq(winningBitesOf(map, shape).length, 1, `${key} 的必胜口应当唯一`);
  }
  // 独立组合计数：宇宙里 (a,b) 需 a>=b>=1、a<=width、a+b<=area。
  let expect = 0;
  for (let a = 1; a <= BOOK.bound.width; a++) for (let b = 1; b <= a; b++) if (a + b <= BOOK.bound.area) expect++;
  eq(twoRow, expect, '两行局面数（组合计数）');
});

test('棋书着法与独立求解的着法一致（AI 用的表 == 印 winner 的表）', () => {
  const uni = solveUniverse();
  let checked = 0;
  for (const [key, node] of uni.memo) {
    eq(bookMove(map, node.shape), node.move, key);
    checked++;
  }
  eq(checked, BOOK.states);
});

test('buildTable 与棋书对同一局面的胜口集合相同（两条独立实现）', () => {
  for (const shape of [[8, 5, 3, 2], [6, 3, 2], [4, 4], [7, 4], [3, 2, 1]]) {
    const t = buildTable(shape).memo.get(encodeShape(shape));
    eq(t.winning.map((m) => [m[0], m[1]]), winningBitesOf(map, shape), encodeShape(shape));
    eq(t.n, classify(map, shape).n, encodeShape(shape) + ' 判定');
  }
});

test('胜口最多的一关在印面上说的就是最多（k 的可复核性）', () => {
  const maxK = Math.max(...LOTS.map((l) => l.k));
  ok(LOTS.some((l) => l.k === maxK), '有关卡达到最大 k');
  for (const lot of LOTS) {
    eq(lot.k, winningBitesOf(map, lot.shape).length, lot.id);
    eq(lot.winningMoves, winningBitesOf(map, lot.shape), lot.id);
  }
});

run();
