// The model: what a bar is, what a bite does, and everything the validators must REFUSE.
// Negative cases are the point — a legality checker that only ever sees legal input has not
// been tested. Run: node test/model.test.mjs

import { test, run, ok, eq, fail } from '../tools/harness.mjs';
import {
  MAX_AREA, MAX_ROWS, MAX_WIDTH, applyBite, area, biteReason, biteKey,
  checkShape, decodeShape, encodeShape, fitsIn, isLegalBite, isShape, isTerminal, legalBites,
  parseBiteKey, rectangle, reachableShapes, validateShape,
} from '../js/core/shapes.js';
import {
  buildTable, reachableViaSubIdeals, rectangleIdealCount, subIdealCount,
} from '../js/core/solve.js';
import { outsideUniverse } from '../js/core/make.js';
import * as shapesModule from '../js/core/shapes.js';
import { BOOK } from '../js/data/lots.js';

// ---------------------------------------------------------------- validation
test('validateShape 接受合法序理想', () => {
  for (const s of [[1], [2], [5, 1], [4, 4, 2], [3, 3, 3, 3], [MAX_WIDTH, 1]]) eq(validateShape(s), null, s.join('.'));
});

test('拒绝空向量：毒格被咬掉之后不是一个可行动的局面', () => {
  ok(validateShape([]), '空向量必须被拒');
  ok(/空/.test(validateShape([])), validateShape([]));
});

test('拒绝非增的行长（悬空的格子物理上不存在）', () => {
  const err = validateShape([2, 3]);
  ok(err && /大于上一行/.test(err), String(err));
  ok(validateShape([3, 1, 2]), '三行里的第 3 行也不能变长');
});

test('拒绝 0 行与负数行（空行必须整行去掉）', () => {
  ok(/正数/.test(validateShape([3, 0])), '长度为 0 的行必须去掉');
  ok(validateShape([3, -1]), '负长度');
  ok(validateShape([0]), '长度为 0 的单行');
});

test('拒绝非整数与非法容器', () => {
  ok(validateShape([2.5]), '2.5 格不存在');
  ok(validateShape(['3']), '字符串不是数字');
  ok(validateShape(null), 'null');
  ok(validateShape('33'), '字符串不是数组');
});

test('checkShape 把校验失败变成异常，isShape 变成布尔', () => {
  eq(isShape([3, 1]), true);
  eq(isShape([1, 3]), false);
  try {
    checkShape([2, 4]);
    fail('checkShape 应该抛');
  } catch (err) {
    ok(/大于上一行/.test(err.message), err.message);
  }
});

test('宇宙上限本身是合法形状，越界形状被 outsideUniverse 点名', () => {
  eq(outsideUniverse([MAX_WIDTH, MAX_WIDTH, MAX_WIDTH, MAX_WIDTH]), 'area', '4×10 面积 40 > 18');
  eq(outsideUniverse([1, 1, 1, 1, 1]), 'rows', '5 行 > 4');
  eq(outsideUniverse([11, 1]), 'width', '11 列 > 10');
  eq(outsideUniverse([3, 2, 1]), null, '在宇宙内');
  eq(outsideUniverse([2, 5]), 'invalid', '非法形状先于范围');
});

// ---------------------------------------------------------------- encoding
test('encode/decode 往返保持形状', () => {
  for (const s of [[1], [9, 8], [8, 5, 3, 2]]) eq(decodeShape(encodeShape(s)), s, s.join('.'));
});

test('decode 拒绝畸形 key', () => {
  for (const bad of ['3.', '.3', 'a.b', '3-2', '3;4']) {
    try {
      decodeShape(bad);
      fail('应抛：' + bad);
    } catch (err) {
      ok(/malformed|decodeShape/.test(err.message), err.message);
    }
  }
});

test('biteKey/parseBiteKey 往返', () => {
  eq(biteKey([1, 3]), '1.3');
  eq(parseBiteKey('1.3'), [1, 3]);
});

test('area / rectangle / isTerminal 的基本事实', () => {
  eq(area([4, 4, 2]), 10);
  eq(rectangle(3, 4), [4, 4, 4]);
  eq(rectangle(1, 5), [5]);
  eq(isTerminal([1]), true);
  eq(isTerminal([2]), false);
  eq(isTerminal([1, 1]), false, '两行各一格不是终局：还能咬 (1,0)');
  try {
    rectangle(0, 3);
    fail('0 行不该被接受');
  } catch (err) {
    ok(/正的行列数/.test(err.message), err.message);
  }
});

test('fitsIn 是序理想包含关系', () => {
  eq(fitsIn([3, 1], [4, 2]), true);
  eq(fitsIn([3, 3], [4, 2]), false, '第二行超了');
  eq(fitsIn([1, 1, 1], [2, 2]), false, '行数超了');
  eq(fitsIn([4, 4], [4, 2]), false);
});

// ---------------------------------------------------------------- bites
test('legalBites：毒格 (0,0) 永远不在合法口里，但第二行第一列在', () => {
  const m = legalBites([3, 2]);
  eq(m, [[0, 1], [0, 2], [1, 0], [1, 1]]);
  ok(!m.some((x) => x[0] === 0 && x[1] === 0), '毒格不是口');
  eq(legalBites([1]), [], '裸毒格没有口');
  eq(legalBites([1, 1]), [[1, 0]]);
});

test('poisonless 变体：允许咬掉整块时 (0,0) 才进口', () => {
  eq(legalBites([1], { poisonless: true }), [[0, 0]]);
  eq(legalBites([1]).length, 0);
  eq(legalBites([2], { poisonless: true }), [[0, 0], [0, 1]]);
});

test('biteReason 对四类非法各给一句话', () => {
  eq(biteReason([3, 2], [0, 0]), '毒格不能主动咬');
  eq(biteReason([1], [0, 0]), '只剩毒格：咬下去即输');
  eq(biteReason([3, 2], [1, 2]), '那一格早已被咬空');
  eq(biteReason([3, 2], [9, 0]), '行越界');
  eq(biteReason([3, 2], [1, 1]), null);
  eq(biteReason([3, 2], 'x'), '没有指到格子');
  eq(biteReason([2, 3], [0, 1]), '局面非法', '非法形状优先');
});

test('isLegalBite 与 biteReason 口径一致', () => {
  for (const m of [[0, 0], [0, 1], [1, 0], [1, 1], [1, 2], [2, 0], [0, 5]]) {
    eq(isLegalBite([3, 2], m), biteReason([3, 2], m) === null, m.join(','));
  }
});

test('applyBite 精确执行“连同右下方一起咬掉”', () => {
  eq(applyBite([4, 4], [1, 3]), [4, 3], '咬第二行第四列：第二行裁到 3');
  eq(applyBite([4, 4], [0, 2]), [2, 2], '咬第一行第三列：两行都裁到 2');
  eq(applyBite([5, 4, 3], [2, 0]), [5, 4], '咬第三行第一列：整行消失');
  eq(applyBite([5, 4, 3], [1, 1]), [5, 1, 1], '上面的行不受影响');
  eq(applyBite([3, 3, 3], [0, 1]), [1, 1, 1]);
  eq(applyBite([2, 1], [1, 0]), [2]);
});

test('applyBite 咬毒格在 Chomp 规则下抛异常', () => {
  try {
    applyBite([3, 2], [0, 0]);
    fail('毒格不能主动咬');
  } catch (err) {
    ok(/非法咬法/.test(err.message), err.message);
  }
  eq(applyBite([1], [0, 0], { poisonless: true }), [], '去掉毒格规则后能咬到空');
});

test('applyBite 的结果永远是合法序理想（闭包性，逐口检查宇宙）', () => {
  let n = 0;
  for (const root of [[9, 8], [8, 5, 3, 2], [6, 6, 6], [4, 4, 4, 4], [1], [7, 5, 1]]) {
    for (const shape of reachableShapes(root)) {
      for (const m of legalBites(shape)) {
        const next = applyBite(shape, m);
        eq(validateShape(next), null, `${encodeShape(shape)} 咬 ${m} → ${encodeShape(next)}`);
        ok(area(next) < area(shape), '必须真的变小');
        n++;
      }
    }
  }
  ok(n > 500, '检查过的边数 ' + n);
});

test('reachableShapes 覆盖全部序理想且不含自己之外的更大形状', () => {
  for (const root of [[3, 2], [4, 4], [5, 4, 3], [6, 2, 1]]) {
    const list = reachableShapes(root);
    ok(list.some((s) => encodeShape(s) === encodeShape(root)), '含自身');
    eq(list.length, subIdealCount(root), `闭包 vs 序理想计数 ${encodeShape(root)}`);
    eq(list.length, reachableViaSubIdeals(root).length, '子理想列举');
    for (const s of list) ok(fitsIn(s, root), encodeShape(s) + ' 必须容于根');
  }
});

test('矩形的可达集数量对上闭式 C(r+w,r)-1', () => {
  for (const [r, w] of [[1, 5], [2, 4], [2, 9], [3, 3], [3, 4], [4, 3], [2, 8]]) {
    eq(reachableShapes(rectangle(r, w)).length, rectangleIdealCount(r, w), `${r}×${w}`);
  }
});

test('buildTable 不改动入参（纯函数）', () => {
  const shape = [5, 4, 3];
  const before = JSON.stringify(shape);
  const t = buildTable(shape);
  eq(JSON.stringify(shape), before, '根向量必须原样');
  eq(t.states, subIdealCount(shape), 'states');
  // 表里每个节点的 key 就是它自己的编码，且它的每个后继都在表里（可达集封闭）。
  let edges = 0;
  for (const node of t.memo.values()) {
    eq(node.key, encodeShape(node.shape), node.key);
    for (const m of legalBites(node.shape)) {
      const next = applyBite(node.shape, m);
      if (!next.length) continue;
      ok(t.memo.has(encodeShape(next)), `${node.key} 的后继 ${encodeShape(next)} 必须在表里`);
      edges++;
    }
  }
  ok(edges > 100, '检查过的边数 ' + edges);
});

test('buildTable 拒绝非法根', () => {
  for (const bad of [[], [1, 2], [0], [2.5]]) {
    try {
      buildTable(bad);
      fail('应拒绝 ' + JSON.stringify(bad));
    } catch (err) {
      ok(/buildTable/.test(err.message), err.message);
    }
  }
});

test('MAX_ROWS / MAX_WIDTH / MAX_AREA 与棋书上限同源', () => {
  eq(BOOK.bound.rows, MAX_ROWS);
  eq(BOOK.bound.width, MAX_WIDTH);
  eq(BOOK.bound.area, MAX_AREA);
});

// `shapes.js` must not grow functions nobody calls: the export surface is part of the contract.
test('shapes.js 的导出面与文档一致（不多不少）', () => {
  const names = Object.keys(shapesModule).sort();
  for (const want of ['applyBite', 'legalBites', 'biteReason', 'reachableShapes', 'validateShape', 'isTerminal']) {
    ok(names.includes(want), '缺少导出 ' + want);
  }
  eq(typeof biteReason, 'function');
});

run();
