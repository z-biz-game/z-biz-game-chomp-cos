// The shipped data: every printed number must be re-derivable from the serialised row, per
// band, and the daily/random routes must be pure functions of their seed. This is the file that
// fails if somebody hand-edits js/data/lots.js. Run: node test/library.test.mjs

import { test, run, ok, eq, fail } from '../tools/harness.mjs';
import {
  BAKED_AT_ISO, SCHEMA_ID, bookMap, dailyLot, derive, lotById, lots, lotsByTier, poolStats,
  randomLot, tierKeys, tierMeta, verifyLot, verifyPool,
} from '../js/core/library.js';
import { solvePosition } from '../js/core/solve.js';
import { area, encodeShape, legalBites, validateShape } from '../js/core/shapes.js';
import { outsideUniverse, BANDS } from '../js/core/make.js';
import { BOOK, LOTS, TIERS_META, DAILY_IDS } from '../js/data/lots.js';
import { hashSeed, mulberry32 } from '../js/core/rng.js';

// ---------------------------------------------------------------- the re-derivation gate
test('verifyPool() 对整个发货文件返回空列表（每一关都重解过）', () => {
  eq(verifyPool(), [], '不一致清单');
  eq(lots.length, LOTS.length, 'library 与 data 是同一份');
});

test('每一关的 states 由一次独立穷举复现（印着的局面数不是抄来的）', () => {
  for (const lot of LOTS) {
    const fresh = solvePosition(lot.shape);
    eq(fresh.states, lot.states, `${lot.id} states`);
    eq(fresh.k, lot.k, `${lot.id} k`);
    eq(fresh.winner, lot.winner, `${lot.id} winner`);
    eq(fresh.winningMoves, lot.winningMoves, `${lot.id} winningMoves`);
  }
});

test('每档至少一关，且卡面上的 winner/k/winningMoves 由棋书重导复现', () => {
  for (const band of BANDS) {
    const mine = lotsByTier(band.key);
    ok(mine.length >= 1, band.key + ' 至少要有一关');
    for (const lot of mine) {
      const d = derive(lot);
      eq(d.winner, lot.winner, lot.id);
      eq(d.k, lot.k, lot.id);
      eq(d.winningMoves, lot.winningMoves, lot.id);
      eq(verifyLot(lot), [], lot.id + ' 的复核');
    }
  }
});

test('序列化之后再解一遍：先 JSON 往返，再判定，结果不变（防手改产物）', () => {
  for (const lot of LOTS) {
    const copy = JSON.parse(JSON.stringify(lot));
    const a = solvePosition(lot.shape);
    const b = solvePosition(copy.shape);
    eq(a, b, lot.id);
    eq(copy, lot, lot.id + ' 往返');
  }
});

test('篡改印面数字会被 verifyLot 抓到（每条各一个负例）', () => {
  const base = LOTS[0];
  const mk = (patch) => JSON.parse(JSON.stringify({ ...base, ...patch }));
  const probes = [
    ['winner', { winner: '后手' }],
    ['k', { k: base.k + 1 }],
    ['winningMoves', { winningMoves: [] }],
    ['cells', { cells: base.cells + 3 }],
    ['legal', { legal: base.legal + 2 }],
    ['chance', { chance: 0.99 }],
    ['states', { states: BOOK.states + 5 }],
    ['tier', { tier: 'not-a-band' }],
    ['shape', { shape: [9, 9, 9, 9, 9] }],
  ];
  for (const [what, patch] of probes) {
    const bad = mk(patch);
    ok(verifyLot(bad).length >= 1, `${what} 的篡改必须被点名`);
  }
  ok(verifyLot(JSON.parse(JSON.stringify(base))).length === 0, '原样必须通过');
});

test('关卡形状全在烘焙宇宙内，且行/列/面积不超过档位上限', () => {
  for (const lot of LOTS) {
    eq(outsideUniverse(lot.shape), null, `${lot.id} 越出宇宙`);
    const band = BANDS.find((b) => b.key === lot.tier);
    ok(lot.shape.length <= band.bounds.rows, lot.id + ' 行数');
    ok(lot.shape[0] <= band.bounds.width, lot.id + ' 列数');
    ok(area(lot.shape) <= band.bounds.area, lot.id + ' 面积');
    eq(validateShape(lot.shape), null, lot.id + ' 形状');
    ok(area(lot.shape) >= band.minCells, lot.id + ' 至少要够吃');
  }
});

test('每一关都是先手必胜且首口数印在卡面上（本仓不出必败题）', () => {
  for (const lot of LOTS) {
    eq(lot.winner, '先手', lot.id);
    ok(lot.k >= 1 && lot.k <= lot.legal, lot.id + ' k 的范围');
    eq(lot.chance, Number((lot.k / lot.legal).toFixed(6)), lot.id + ' chance 是量出来的');
  }
});

test('关卡 id 唯一、按档位成对编号、没有重题', () => {
  const ids = LOTS.map((l) => l.id);
  eq(new Set(ids).size, ids.length, 'id 唯一');
  const shapes = LOTS.map((l) => encodeShape(l.shape));
  eq(new Set(shapes).size, shapes.length, '同一形状不重复出题');
  for (const key of tierKeys) {
    const mine = lotsByTier(key);
    eq(mine.map((l) => l.id), mine.map((_, i) => `${key}-${String(i + 1).padStart(2, '0')}`), key + ' 编号连续');
  }
});

test('TIERS_META 的区间就是实际发货区间（bands 不许自我表扬）', () => {
  for (const meta of TIERS_META) {
    const mine = lotsByTier(meta.key);
    eq(mine.length, meta.lots, meta.key + ' lots');
    eq(Math.min(...mine.map((l) => l.k)), meta.kMin, meta.key + ' kMin');
    eq(Math.max(...mine.map((l) => l.k)), meta.kMax, meta.key + ' kMax');
    eq(Math.min(...mine.map((l) => l.states)), meta.statesMin, meta.key + ' statesMin');
    eq(Math.max(...mine.map((l) => l.states)), meta.statesMax, meta.key + ' statesMax');
    eq(Number(Math.min(...mine.map((l) => l.chance)).toFixed(6)), meta.chanceMin, meta.key + ' chanceMin');
    ok(meta.acceptPct > 0 && meta.acceptPct <= 100, meta.key + ' 接受率在 0..100');
    eq(tierMeta(meta.key), meta, meta.key + ' tierMeta');
  }
  eq(tierMeta('不存在'), null);
});

// ---------------------------------------------------------------- pool stats
test('poolStats 报的是文件里真实存在的量', () => {
  const s = poolStats();
  eq(s.lots, LOTS.length);
  eq(s.states, BOOK.states);
  eq(s.p + s.n, BOOK.states);
  eq(s.schema, SCHEMA_ID, 'schema 标签');
  ok(/^\d{4}-\d{2}-\d{2}T/.test(s.bakedAt) && s.bakedAt === BAKED_AT_ISO, '烘焙时间戳');
  eq(Object.values(s.byTier).reduce((a, b) => a + b, 0), LOTS.length, '分档求和');
  eq(tierKeys.length, BANDS.length, '档位齐');
});

// ---------------------------------------------------------------- daily & random
test('#/daily 同一天同一题：连续两次、跨 library 实例都相同', () => {
  const a = dailyLot('2026-09-27');
  const b = dailyLot('2026-09-27');
  eq(a.shape, b.shape, '形状');
  eq(a.id, b.id, 'id');
  eq(a.k, b.k, 'k');
  eq(a.winningMoves, b.winningMoves, '胜口');
  eq(a.label, '每日毒格 · 2026-09-27', '标签带日期');
  eq(a.mode, 'daily');
  ok(DAILY_IDS.includes(a.sourceId), '来源在每日池里');
  // 选择规则写在 README 里：mulberry32(hashSeed('chomp-daily:<date>')) 决定池内下标。
  const idx = DAILY_IDS.indexOf(a.sourceId);
  eq(mulberry32(hashSeed('chomp-daily:2026-09-27')).int(DAILY_IDS.length), idx, '种子直接决定选题');
});

test('不同日期给不同题（连续 30 天里至少 12 个不同形状）', () => {
  const set = new Set();
  for (let d = 1; d <= 30; d++) {
    const key = `2026-10-${String(d).padStart(2, '0')}`;
    set.add(encodeShape(dailyLot(key).shape));
  }
  ok(set.size >= 12, '不同形状数 ' + set.size);
});

test('daily 的日期格式被守住，非法输入抛而不是猜', () => {
  for (const bad of ['2026-9-7', '', 'yesterday', '2026-09-3', '2026/09-07']) {
    try {
      dailyLot(bad);
      fail('应拒绝 ' + bad);
    } catch (err) {
      ok(/YYYY-MM-DD/.test(err.message), err.message);
    }
  }
});

test('daily 的题面数字来自棋书查表，与它引用的关卡一致', () => {
  for (const key of ['2026-01-01', '2026-06-15', '2026-12-31']) {
    const d = dailyLot(key);
    const src = lotById(d.sourceId);
    eq(d.shape, src.shape, key);
    eq(d.tier, src.tier, key);
    eq(d.k, derive(src).k, key);
    eq(verifyLot({ ...d, id: d.id }), [], key + ' 复核');
  }
});

test('#/random/<tier>/<seed> 稳定，且落在指定档位', () => {
  for (const tier of tierKeys) {
    const a = randomLot('seed-A', tier);
    const b = randomLot('seed-A', tier);
    eq(a.shape, b.shape, tier + ' 同种子同题');
    eq(a.tier, tier, tier + ' 落在档内');
    const c = randomLot('seed-B', tier);
    ok(typeof c.shape.length === 'number', tier + ' 另一个种子也答得出');
  }
  const any = randomLot('x', undefined);
  ok(lots.some((l) => l.id === any.sourceId), '不限档位时也在关卡表里');
});

test('lotById 找得到每一关，也认得陌生 id', () => {
  for (const lot of LOTS) eq(lotById(lot.id).id, lot.id);
  eq(lotById('shoal-99'), null);
  eq(lotById(''), null);
});

test('bookMap() 是棋书的唯一解码入口，重复取用同一个 Map', () => {
  eq(bookMap(), bookMap(), '同一份');
  eq(bookMap().size, BOOK.states);
});

run();
