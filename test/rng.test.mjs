// Determinism. The daily puzzle and a shared link must land on the same bar on every device,
// and that only holds if the seed mixer is a pure function of its string.
//
// ABOUT `hashSeed`: it is an FNV-1a DERIVED two-round UTF-16 mixer, not textbook FNV-1a — each
// code unit is xored by its low byte, multiplied, then xored by its high byte and multiplied
// again. So its output is NOT comparable to any published FNV-1a vector, and this suite does
// not pretend otherwise: what it asserts is (1) self-consistency, (2) the exact structure of
// the mixer, re-implemented here from the comment in js/core/rng.js, and (3) that the result
// really differs from textbook FNV-1a (which is the whole reason the name is not "fnv1a").
// Run: node test/rng.test.mjs

import { test, run, ok, eq } from '../tools/harness.mjs';
import { hashSeed, mulberry32, rngFrom, todayKey } from '../js/core/rng.js';

// Textbook FNV-1a (32-bit), written out here so the difference is a measured fact and not a
// sentence in a README.
function textbookFnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

test('hashSeed 同种子两次调用相等（纯函数）', () => {
  for (const s of ['a', '', '2026-09-27', 'chomp-daily:2026-09-27', '巧克力的毒', 'shoal-01']) {
    eq(hashSeed(s), hashSeed(s), s);
  }
});

test('hashSeed 落在 32 位无符号区间', () => {
  for (const s of ['', 'a', 'ab', '2026-09-27', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
    const h = hashSeed(s);
    ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, s + ' → ' + h);
  }
});

test('hashSeed 结构可复算：两轮 UTF-16 混合，本地重写一遍逐位相同', () => {
  // The two-round mixer, re-typed independently from the documented rule.
  const replica = (str) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      h ^= code & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (code >> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  for (const s of ['', 'a', 'ab', 'abc', '2026-09-27', '每日毒格 · 2026-09-27', '巧', '𝄞x']) {
    eq(hashSeed(s), replica(s), s);
  }
});

test('hashSeed 确实不是教科书 FNV-1a（ASCII 段就分家）', () => {
  let differs = 0;
  for (const s of ['a', 'ab', 'abc', '2026-09-27', 'shoal-01', 'chomp-daily:2026-09-27']) {
    if (hashSeed(s) !== textbookFnv1a(s)) differs++;
  }
  eq(differs, 6, '每个 ASCII 种子都和教科书不同');
  ok(hashSeed('a') !== 3826002220, '教科书写着 3826002220，这里不是它');
  // 只有空串还同源（没有轮次可差），所以不拿它当反例。
  eq(hashSeed(''), textbookFnv1a(''));
});

test('种子分布散得开：512 个互不相同的种子几乎全不同值', () => {
  const seen = new Set();
  for (let i = 0; i < 512; i++) seen.add(hashSeed('chomp-daily:seed-' + i));
  ok(seen.size >= 500, '唯一值 ' + seen.size);
  const buckets = [0, 0, 0, 0];
  for (const h of seen) buckets[Math.floor(h / 0x100000000 * 4)]++;
  eq(buckets.reduce((a, b) => a + b, 0), seen.size, '四分桶求和');
  ok(buckets.every((b) => b >= 1), '每个象限都有落点：' + JSON.stringify(buckets));
});

test('相邻日期不产生相邻种子（否则每日一题会连号）', () => {
  const a = hashSeed('chomp-daily:2026-09-26');
  const b = hashSeed('chomp-daily:2026-09-27');
  ok(Math.abs(a - b) > 1000, `${a} vs ${b}`);
});

test('mulberry32 同种子同序列，不同种子不同序列', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  eq(seqA, seqB, '同种子');
  const c = mulberry32(999);
  ok(JSON.stringify([c(), c(), c(), c(), c()]) !== JSON.stringify(seqA), '不同种子');
  for (const v of seqA) ok(v >= 0 && v < 1, '落在 [0,1)：' + v);
});

test('rng 的四个派生方法在同一个实例上同步推进', () => {
  const mk = () => {
    const r = mulberry32(hashSeed('seed-A'));
    return [r.int(10), r.range(1, 6), r.pick(['a', 'b', 'c']), r.chance(0.5), r()];
  };
  eq(mk(), mk(), '同种子全等');
  const other = () => {
    const r = mulberry32(hashSeed('seed-B'));
    return [r.int(10), r.range(1, 6), r.pick(['a', 'b', 'c']), r.chance(0.5), r()];
  };
  ok(JSON.stringify(mk()) !== JSON.stringify(other()), '换种子就该换着法');
});

test('int / range / pick 的取值范围守住', () => {
  const r = mulberry32(7);
  for (let i = 0; i < 200; i++) {
    const v = r.int(5);
    ok(v >= 0 && v < 5 && Number.isInteger(v), 'int(5) → ' + v);
    const w = r.range(3, 9);
    ok(w >= 3 && w <= 9 && Number.isInteger(w), 'range(3,9) → ' + w);
    const p = r.pick(['x', 'y', 'z']);
    ok(['x', 'y', 'z'].includes(p), 'pick → ' + p);
  }
});

test('shuffle 确定、原地且是个置换', () => {
  const a = mulberry32(42).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  const b = mulberry32(42).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  eq(a, b, '同种子同序');
  eq(a.slice().sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8], '元素不多不少');
  const c = mulberry32(43).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  ok(JSON.stringify(a) !== JSON.stringify(c), '换种子就该换个序');
});

test('rngFrom 三种入参都归一到同一个发生器', () => {
  eq(rngFrom('abc')(), rngFrom(hashSeed('abc'))(), '字符串 == 预散列数字');
  const direct = mulberry32(hashSeed('abc'));
  eq(rngFrom(direct) === direct, true, '已经是发生器就原样返回');
  const a = rngFrom('seed');
  const b = rngFrom('seed');
  eq([a(), a()], [b(), b()], '同种子同流');
});

test('todayKey 是 YYYY-MM-DD 补零格式', () => {
  eq(todayKey(new Date(2026, 8, 27)), '2026-09-27');
  eq(todayKey(new Date(2026, 0, 5)), '2026-01-05');
  eq(todayKey(new Date(1999, 11, 31)), '1999-12-31');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(todayKey()), '本机今天');
});

test('每日一题的选题链路：日期 -> 种子 -> 关卡，跨进程一致', async () => {
  const { dailyLot } = await import('../js/core/library.js');
  const d = '2026-09-27';
  const first = dailyLot(d);
  const second = dailyLot(d);
  eq(first.shape, second.shape, '同日同题');
  eq(first.id, second.id);
  // 选题只依赖 hashSeed：换个写法但同规则的种子串，得到同一道。
  const { mulberry32 } = await import('../js/core/rng.js');
  const { DAILY_IDS } = await import('../js/data/lots.js');
  const idx = mulberry32(hashSeed('chomp-daily:' + d)).int(DAILY_IDS.length);
  eq(first.sourceId, DAILY_IDS[idx], '种子决定选题');
});

run();
