// The solver itself: table shape, purity, determinism, the two independent build routes, and
// the counter-factual that proves the poison rule (not the geometry) is what decides the game.
// Run: node test/solve.test.mjs

import { test, run, ok, eq, fail } from '../tools/harness.mjs';
import {
  binomial, buildTable, isN, isP, rectangleIdealCount, singleRowIsN, solvePosition, solveUniverse,
  subIdealCount, twoRowIsP, universeShapes, winningBites,
} from '../js/core/solve.js';
import { applyBite, area, encodeShape, legalBites, reachableShapes } from '../js/core/shapes.js';
import { LOTS } from '../js/data/lots.js';
import { naiveTable } from './naive.mjs';
import { HAND } from './fixture.mjs';

// ---------------------------------------------------------------- the counter-proof
test('反证：去掉毒格规则后 [1] 从必败变必胜（毒格约束真的在决定胜负）', () => {
  eq(solvePosition([1]).n, false, 'Chomp 规则下 [1] 是 P');
  eq(solvePosition([1], { poisonless: true }).n, true, '去掉毒格后 [1] 是 N');
  eq(solvePosition([1]).k, 0);
  eq(solvePosition([1], { poisonless: true }).k, 1, '唯一的口就是整块吞掉');
});

test('反证：去掉毒格规则后整张表变成全 N（毒格约束就是胜负的来源）', () => {
  const chomp = buildTable([4, 3]);
  const free = buildTable([4, 3], { poisonless: true });
  eq(chomp.states, free.states, '可达集不因规则而变');
  const pNodes = [...chomp.memo.values()].filter((x) => !x.n).map((x) => x.key).sort();
  // 手算：[4,3] 的可达集里的必败局恰好是它自己包含的那几条阶梯 —— [1]、[2,1]、[3,2]、[4,3]。
  eq(pNodes, ['1', '2.1', '3.2', '4.3'], 'Chomp 表里的 P 局面');
  for (const key of pNodes) eq(free.memo.get(key).n, true, key + ' 在没有毒格规则时变 N');
  let flips = 0;
  for (const [key, node] of chomp.memo) if (node.n !== free.memo.get(key).n) flips++;
  eq(flips, pNodes.length, '翻转的局面恰好就是全部 P 局面：去掉毒格后人人必胜');
  let allN = 0;
  for (const node of free.memo.values()) if (node.n) allN++;
  eq(allN, free.states, 'poisonless 表全 N');
});

// ---------------------------------------------------------------- table shape
test('buildTable 覆盖全部可达局面，且 states 与两种独立计数一致', () => {
  for (const root of [[[9, 8]], [[8, 8]], [[6, 4, 2]], [[5, 5, 5]], [[4, 4, 4, 2]], [[1]]]) {
    const shape = root[0];
    const t = buildTable(shape);
    eq(t.states, reachableShapes(shape).length, `闭包 ${encodeShape(shape)}`);
    eq(t.states, subIdealCount(shape), `序理想计数 ${encodeShape(shape)}`);
    if (shape.length === 1) eq(t.states, rectangleIdealCount(1, shape[0]), '单行闭式');
    // bites 的定义：表里每个局面的每个合法口都被评估一次 —— 与 legalBites 的总和逐位相等。
    const edgeSum = reachableShapes(shape).reduce((a, x) => a + legalBites(x).length, 0);
    eq(t.bites, edgeSum, `边数 ${encodeShape(shape)}`);
  }
});

test('同一个形状建两次表，判定与着法逐位相同（无隐藏状态、无随机）', () => {
  for (const shape of [[7, 5], [5, 4, 3], [8, 4, 3, 3], [4]]) {
    const a = buildTable(shape);
    const b = buildTable(shape);
    eq(a.states, b.states, 'states');
    eq(a.bites, b.bites, 'bites');
    for (const [key, node] of a.memo) {
      const other = b.memo.get(key);
      eq(other.n, node.n, key + ' 判定');
      eq(other.move, node.move, key + ' 着法');
      eq(other.winning, node.winning, key + ' 必胜口');
    }
  }
});

test('求解不改入参：整表构建前后根向量与所有可达形状逐字节相同', () => {
  const shape = [6, 4, 2];
  const snapshot = JSON.stringify(shape);
  const others = reachableShapes(shape).map((s) => JSON.stringify(s));
  buildTable(shape);
  solvePosition(shape);
  winningBites(shape);
  eq(JSON.stringify(shape), snapshot, '根');
  eq(reachableShapes(shape).map((s) => JSON.stringify(s)), others, '可达集顺序与内容');
});

test('表里每个 N 局面的着法通向 P，每个 P 局面的全部后继都是 N（DP 的自洽性）', () => {
  for (const shape of [[9, 8], [8, 6], [6, 5, 3], [8, 5, 3, 2], [7, 7, 1]]) {
    const t = buildTable(shape);
    for (const node of t.memo.values()) {
      if (node.n) {
        ok(node.winning.length >= 1, `${node.key} N 却没口`);
        ok(node.move && node.winning.some((m) => m[0] === node.move[0] && m[1] === node.move[1]), `${node.key} 的建议不在必胜口里`);
        eq(applyBite(node.shape, node.move).length > 0, true, '不会咬到空');
        ok(!t.memo.get(encodeShape(applyBite(node.shape, node.move))).n, `${node.key} 的建议没通向 P`);
      } else {
        eq(node.winning, [], `${node.key} 是 P 却有必胜口`);
        for (const m of legalBites(node.shape)) {
          const next = applyBite(node.shape, m);
          if (!next.length) continue;
          ok(t.memo.get(encodeShape(next)).n, `${node.key} 的每个后继都该是 N`);
        }
      }
    }
  }
});

test('终局 [1] 在每张表里都是 P 且没有着法', () => {
  for (const shape of [[9, 8], [5, 4, 3], [8, 5, 3, 2]]) {
    const node = buildTable(shape).memo.get('1');
    eq(node.n, false, encodeShape(shape));
    eq(node.move, null);
    eq(node.winning, []);
  }
});

// ---------------------------------------------------------------- routes agree
test('两条构建路（每关独立表 vs 全宇宙自底向上）在全宇宙逐点一致', () => {
  const uni = solveUniverse();
  eq(uni.shapes, universeShapes().length, '宇宙大小');
  eq(uni.shapes, uni.memo.size);
  let checked = 0;
  for (const shape of universeShapes()) {
    const key = encodeShape(shape);
    const fromUniverse = uni.memo.get(key);
    const perLot = buildTable(shape).memo.get(key);
    eq(fromUniverse.n, perLot.n, key + ' 判定');
    eq(fromUniverse.move, perLot.move, key + ' 着法');
    eq(fromUniverse.winning, perLot.winning, key + ' 必胜口');
    checked++;
  }
  eq(checked, 419, '宇宙里的每个局面');
});

test('第三条路（naive 独立枚举）在三行面积<=12 上与宇宙判定一致', () => {
  const naive = naiveTable({ rows: 3, width: 8, cap: 12 });
  const uni = solveUniverse();
  let checked = 0;
  for (const [key, want] of naive) {
    const node = uni.memo.get(key);
    ok(node, key + ' 应在宇宙里');
    eq(node.n, !!want, key);
    checked++;
  }
  ok(checked >= 80, 'naive 三行面积<=12 的检查数 ' + checked);
});

test('isN / isP 与 solvePosition 同口径，且对全部手算 fixture 成立', () => {
  for (const h of HAND) {
    eq(isN(h.shape), h.n, encodeShape(h.shape) + ' isN');
    eq(isP(h.shape), !h.n, encodeShape(h.shape) + ' isP');
  }
});

test('闭式辅助函数对非法输入返回 null 而不是猜测', () => {
  eq(twoRowIsP(1, 2), null, 'a<b 不是两行序理想');
  eq(twoRowIsP(0, 1), null);
  eq(twoRowIsP(3.5, 2), null);
  eq(singleRowIsN(0), null);
  eq(twoRowIsP(2, 1), true);
  eq(twoRowIsP(3, 1), false);
});

test('binomial 已知值（闭式的闭式）', () => {
  eq(binomial(5, 2), 10);
  eq(binomial(10, 0), 1);
  eq(binomial(12, 6), 924);
  eq(rectangleIdealCount(2, 9), binomial(11, 2) - 1);
  eq(rectangleIdealCount(4, 10), binomial(14, 4) - 1);
});

test('胜口的枚举与 legalBites 一致：k <= legal，且胜口都在合法口里', () => {
  for (const lot of LOTS) {
    const r = solvePosition(lot.shape);
    const legal = legalBites(lot.shape);
    ok(r.k <= legal.length, `${lot.id} k>legal`);
    for (const m of r.winningMoves) {
      ok(legal.some((x) => x[0] === m[0] && x[1] === m[1]), `${lot.id} 胜口 ${m} 不在合法口里`);
      ok(m[0] !== 0 || m[1] !== 0, '毒格不是胜口');
    }
    ok(!('legal' in r), 'solvePosition 不打印 legal（那是 book.report 的字段）');
  }
});

test('穷举规模有实测上限：master 档最贵的形状也在毫秒级（现场搜索因此不必要）', () => {
  let worstStates = 0;
  let worstShape = '';
  let worstMs = 0;
  for (const lot of LOTS) {
    const t0 = Date.now();
    const t = buildTable(lot.shape);
    const took = Date.now() - t0;
    if (t.states > worstStates) { worstStates = t.states; worstShape = encodeShape(lot.shape); }
    if (took > worstMs) worstMs = took;
  }
  ok(worstStates <= 419, `最贵 ${worstShape} 有 ${worstStates} 个局面`);
  ok(worstMs <= 50, `最贵一次建表 ${worstMs}ms`);
  const uni = solveUniverse();
  eq(uni.p, 36, '宇宙 P 数');
});

test('非法输入进不了求解器', () => {
  for (const bad of [[], [1, 3], [0], [2, 0]]) {
    try {
      buildTable(bad);
      fail('buildTable 应拒绝 ' + JSON.stringify(bad));
    } catch (err) {
      ok(/buildTable/.test(err.message), err.message);
    }
    try {
      solvePosition(bad);
      fail('solvePosition 应拒绝 ' + JSON.stringify(bad));
    } catch (err) {
      ok(/buildTable/.test(err.message), err.message);
    }
  }
});

test('面积单调：咬一口之后严格变小，表里不存在环（这是 DP 终止的理由）', () => {
  const uni = solveUniverse();
  for (const node of uni.memo.values()) {
    for (const m of legalBites(node.shape)) {
      const next = applyBite(node.shape, m);
      if (!next.length) continue;
      ok(area(next) < area(node.shape), `${node.key} → ${encodeShape(next)}`);
    }
  }
});

run();
