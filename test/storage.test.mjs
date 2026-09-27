// The save file. Node has no window, so the memory fallback is the DEFAULT path here; the
// persistent path is exercised against a fake localStorage installed on globalThis.
// Run: node test/storage.test.mjs

import { test, run, ok, eq } from '../tools/harness.mjs';
import { SAVE_KEY, StorageError, requireBackend, store, persistent } from '../js/core/storage.js';

async function freshStore() {
  // A query string busts the module cache, so each scenario gets a clean `cache` inside the
  // module — the same isolation a browser reload gives.
  // A query string busts the module cache: each scenario gets its own `cache` inside the
  // module, which is what a browser reload gives you. Math.random only picks a cache key here,
  // never a game value, so the suite stays reproducible.
  return import('../js/core/storage.js?fresh=' + (counter++));
}

let counter = 0;

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

// ---------------------------------------------------------------- no window
test('没有 window 时不炸：存档退化成内存', async () => {
  eq(typeof globalThis.window, 'undefined', 'node 里本就没有 window');
  const s = await freshStore();
  eq(Object.keys(s.store.records).length, 0, '空档');
  eq(s.store.unlocked, 1, '从第一关开始');
  eq(s.persistent(), false, '这个会话不持久');
});

test('requireBackend 在没有 window 时抛异常，而不是回一个 null', async () => {
  const s = await freshStore();
  try {
    s.requireBackend();
    ok(false, '必须抛');
  } catch (err) {
    ok(err instanceof s.StorageError, '抛的是 StorageError：' + err.constructor.name);
    ok(/no window/.test(err.message), err.message);
  }
});

test('内存模式里 finish() 照常记账，只是关掉页面就没了', async () => {
  const s = await freshStore();
  const rec = s.store.finish('shoal-01', { won: true, plies: 5, hints: 0 });
  eq(rec.won, true);
  eq(rec.best, 5);
  eq(s.store.record('shoal-01').best, 5);
  eq(s.store.stats.plays, 1);
  eq(s.persistent(), false);
});

// ---------------------------------------------------------------- with a fake backend
test('有 localStorage 时写盘真的发生', async () => {
  const ls = fakeStorage();
  globalThis.window = { localStorage: ls };
  const s = await freshStore();
  eq(s.persistent(), true, '这个会话能持久');
  s.store.finish('shoal-01', { won: true, plies: 4, hints: 0 });
  const raw = ls.data.get(SAVE_KEY);
  ok(raw, '盘上有东西');
  const parsed = JSON.parse(raw);
  eq(parsed.records['shoal-01'].best, 4);
  eq(parsed.stats.wins, 1);
  delete globalThis.window;
});

test('存档跨模块实例读得回来（真的持久，不是内存幻觉）', async () => {
  const ls = fakeStorage();
  globalThis.window = { localStorage: ls };
  const a = await freshStore();
  a.store.finish('linked-02', { won: true, plies: 7, hints: 1 });
  a.store.unlock(4);
  const b = await freshStore();
  eq(b.store.record('linked-02').best, 7, '另一个实例读同一份盘');
  eq(b.store.unlocked, 4);
  eq(b.store.stats.hints, 1);
  delete globalThis.window;
});

test('best 只降不升：写坏一次也回不去', async () => {
  const s = await freshStore();
  s.store.finish('shoal-03', { won: true, plies: 6 });
  s.store.finish('shoal-03', { won: true, plies: 9 });
  eq(s.store.record('shoal-03').best, 6, '更差的覆盖不了更好的');
  s.store.finish('shoal-03', { won: true, plies: 2 });
  eq(s.store.record('shoal-03').best, 2);
  s.store.finish('shoal-03', { won: false, plies: 30 });
  eq(s.store.record('shoal-03').best, 2, '输了不改写纪录');
  eq(s.store.record('shoal-03').won, true, '赢过就还算赢过');
  eq(s.store.record('shoal-03').plays, 4);
});

test('unlock 只升不降', async () => {
  const s = await freshStore();
  eq(s.store.unlock(5), 5);
  eq(s.store.unlock(2), 5, '回放到早期关卡不能藏掉后面的');
  eq(s.store.unlocked, 5);
  eq(s.store.unlock(9), 9);
});

test('清档真的清空：内存与盘上都没了', async () => {
  const ls = fakeStorage();
  globalThis.window = { localStorage: ls };
  const s = await freshStore();
  s.store.finish('twined-01', { won: true, plies: 3 });
  s.store.unlock(6);
  s.store.markDaily('2026-09-27', 'daily-2026-09-27', { won: true });
  ok(ls.data.get(SAVE_KEY), '先写上了');
  s.store.reset();
  eq(Object.keys(s.store.records).length, 0, '内存');
  eq(s.store.unlocked, 1, '解锁指针回到 1');
  eq(s.store.stats.plays, 0);
  eq(ls.data.get(SAVE_KEY) ?? null, null, '盘上也没了');
  const again = await freshStore();
  eq(Object.keys(again.store.records).length, 0, '重开也读不出东西');
  delete globalThis.window;
});

test('每日日志：赢了才算，之后输一次不能抹掉', async () => {
  const s = await freshStore();
  eq(s.store.dailyDone('2026-09-27'), null, '没记过');
  s.store.markDaily('2026-09-27', 'daily-2026-09-27', { won: false });
  eq(s.store.dailyDone('2026-09-27').won, false);
  s.store.markDaily('2026-09-27', 'daily-2026-09-27', { won: true });
  eq(s.store.dailyDone('2026-09-27').won, true);
  s.store.markDaily('2026-09-27', 'daily-2026-09-27', { won: false });
  eq(s.store.dailyDone('2026-09-27').won, true, '赢过的日子不会被后来的输覆盖');
  eq(s.store.dailyDone('1999-01-01'), null, '别的日子还是空的');
});

test('坏存档不会让开局崩掉：半截 JSON、脏字段、类型胡来一律降级', async () => {
  const ls = fakeStorage();
  ls.data.set(SAVE_KEY, '{ not json');
  globalThis.window = { localStorage: ls };
  const a = await freshStore();
  eq(Object.keys(a.store.records).length, 0, '坏 JSON 当空档');
  eq(a.store.unlocked, 1);

  ls.data.set(SAVE_KEY, JSON.stringify({ records: { x: { best: 'abc', plays: null } }, unlocked: -3, stats: 'nope' }));
  const b = await freshStore();
  eq(b.store.unlocked, 1, '负数解锁不采信');
  eq(b.store.stats.plays, 0, 'stats 不是对象就当空');
  eq(typeof b.store.record('x').best, 'string', '记录本体照原样留着，不做无谓改写');
  b.store.finish('x', { won: true, plies: 4 });
  eq(b.store.record('x').plays, 1, '脏 plays 被当成 0 而不是 NaN');
  delete globalThis.window;
});

test('被拒绝的 localStorage（setItem 抛异常）只影响持久，不影响 playable', async () => {
  const ls = fakeStorage();
  ls.setItem = () => { throw new Error('QuotaExceeded'); };
  globalThis.window = { localStorage: ls };
  const s = await freshStore();
  eq(s.persistent(), false, 'probe 也抛，所以判为不持久');
  const rec = s.store.finish('shoal-05', { won: true, plies: 3 });
  eq(rec.best, 3, '本局照样记得住');
  eq(s.store.stats.wins, 1);
  delete globalThis.window;
});

test('requireBackend 在有 window 但没有 localStorage 时也说清楚原因', async () => {
  globalThis.window = {};
  try {
    requireBackend();
    ok(false, '应抛');
  } catch (err) {
    ok(err instanceof StorageError, '类型');
    ok(/localStorage/.test(err.message), err.message);
  }
  eq(persistent(), false);
  delete globalThis.window;
});

test('totals() 报的是真实存在的关卡数', async () => {
  const s = await freshStore();
  s.store.finish('shoal-01', { won: true, plies: 3 });
  s.store.finish('shoal-02', { won: false, plies: 4 });
  const t = s.store.totals();
  eq(t.solved, 1, '只数赢过的');
  eq(t.plays, 2);
  eq(t.wins, 1);
  eq(t.losses, 1);
  eq(t.plies, undefined, 'totals 不报 plies（那是 stats 的事）');
});

test('hint() 单独计数，不影响 best', async () => {
  const s = await freshStore();
  s.store.finish('shoal-06', { won: true, plies: 5 });
  s.store.hint('shoal-06');
  s.store.hint('shoal-06');
  eq(s.store.record('shoal-06').hints, 2);
  eq(s.store.record('shoal-06').best, 5, '提示不改纪录');
  eq(s.store.stats.hints, 2);
  s.store.finish('shoal-06', { won: true, plies: 4, hints: 2 });
  // `clean` is a lifetime claim ("这一关有过一次不靠提示的通关"), so it sticks once earned.
  eq(s.store.record('shoal-06').clean, true, '有过一次干净通关就一直算');
  eq(s.store.record('shoal-06').best, 4);
  s.store.finish('shoal-07', { won: true, plies: 4, hints: 3 });
  eq(s.store.record('shoal-07').clean, false, '全程靠提示就不算干净');
  s.store.finish('shoal-07', { won: true, plies: 5, hints: 0 });
  eq(s.store.record('shoal-07').clean, true, '后来一次不用提示就挣到了');
});

test('SAVE_KEY 与版本前缀对得上（换版本要能认出来）', async () => {
  eq(SAVE_KEY, 'chomp.save.v1');
  ok(/^chomp\.save\.v\d+$/.test(SAVE_KEY), SAVE_KEY);
});

run();
