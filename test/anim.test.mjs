// 帧率无关性的正面证据，同时自带反证开关。
//
// 常规跑法：`node test/anim.test.mjs` —— 全绿。
// 反证跑法（规范 §6：变异必须打在真正吃帧 dt 的那一行上，也就是 advance 里的
// `accumulator += elapsed`；迁移到固定步长之后，per-particle 的 `x += v*s` 本来就与帧率
// 无关，拿它做变异只会得到假红，那种绿不值得信）：
//
//   sed 's/a\.accumulator += elapsed;/a.accumulator += 1 \/ 60;/' js/core/anim.js > /tmp/anim_mutant.js
//   CHOMP_ANIM=/tmp/anim_mutant.js node test/anim.test.mjs   # 必须变红
//
// CHOMP_ANIM 只换被测试的模块，不换断言：同一段期望，真模块过、常数增量模块不过，
// 这才说明断言量的是帧率无关性，而不是量了个恒真的东西。

import { test, run, ok, eq } from '../tools/harness.mjs';
import { pathToFileURL } from 'node:url';

const MOD = process.env.CHOMP_ANIM
  ? pathToFileURL(process.env.CHOMP_ANIM).href
  : new URL('../js/core/anim.js', import.meta.url).href;
const A = await import(MOD);
const { SIM_STEP, MAX_STEPS, createAnim, advance, step, emitBite, rejectKick, setReducedMotion, resetTransient, snapshot } = A;

// 咬四口的时机按「已推进的步数」对齐，且都是 4 的倍数：1/30、1/60、1/120 相对 SIM_STEP
// (1/120) 分别是 4、2、1 步，整除，所以三种 cadence 在同一帧边界上触发，不会因取整错开。
// TARGET_STEPS=272 也是 4 的倍数，而且落在最后一次咬块（252 步）之后 20 步 —— 粒子寿命
// 0.42~0.88s 即 50~105 步，所以比较的一定是「还在飞的粒子」，不是三个空数组互相等。
const EMIT_AT = [4, 120, 252];
const TARGET_STEPS = 272;
const BITTEN = [[0, 1], [1, 1], [0, 2], [1, 2]];

const geom = (r, c) => ({ x: 40 + c * 96, y: 40 + r * 96, w: 88, h: 88 });

function drive(hz, { emitAt = EMIT_AT.slice(), target = TARGET_STEPS } = {}) {
  const a = createAnim({ seed: 20260930 });
  const frame = 1 / hz;
  let next = 0;
  let frames = 0;
  while (a.simSteps < target && frames < 20000) {
    if (next < emitAt.length && a.simSteps >= emitAt[next]) {
      emitBite(a, BITTEN, geom, { strength: 1 });
      next += 1;
    }
    advance(a, frame);
    frames += 1;
  }
  return { a, frames, detail: a.particles.map((p) => [p.x, p.y, p.vx, p.vy, p.rot, p.life]) };
}

// 浮点只比到 1e-12：三条路径的运算顺序完全相同，理应是位级相等，容差只是留给未来的
// 一次合法重排，不给真正的偏差留后门。唯一会用上容差的地方是 accumulator —— 累加 1/30
// 再逐次减 1/120 会留下 1e-17 量级的余数（实测 30Hz 那一跑是 1.04e-17），那是减法本身的
// 残渣，不是帧率依赖；整数与布尔字段仍然严格相等，容差不给它们留位置。
function near(x, y) {
  return Math.abs(x - y) <= 1e-12;
}

function sameSnap(got, want, label) {
  for (const k of ['simSteps', 'particles', 'emitted', 'reducedMotion']) {
    eq(got[k], want[k], `${label}：${k} 必须严格相等`);
  }
  for (const k of ['clock', 'accumulator', 'shake', 'pulse']) {
    ok(near(got[k], want[k]), `${label}：${k} 分叉 ${got[k]} vs ${want[k]}`);
  }
}

test('30/60/120 Hz 喂同一段秒表：末态逐字段一致，连每粒粒子的坐标都一致', () => {
  const runs = [30, 60, 120].map((hz) => drive(hz));
  const base = runs[0];
  eq(base.a.simSteps, TARGET_STEPS, '对齐单位是步数，不是虚拟秒');
  eq(base.detail.length >= 6, true, '场上确实有活粒子，比较的不是空数组');
  for (let i = 1; i < runs.length; i++) {
    const r = runs[i];
    sameSnap(snapshot(r.a), snapshot(base.a), `${[30, 60, 120][i]}Hz 对 30Hz`);
    eq(r.detail.length, base.detail.length, `${[30, 60, 120][i]}Hz 粒子数一致`);
    for (let k = 0; k < base.detail.length; k++) {
      ok(near(r.detail[k][0], base.detail[k][0]) && near(r.detail[k][1], base.detail[k][1])
        && near(r.detail[k][2], base.detail[k][2]) && near(r.detail[k][3], base.detail[k][3])
        && near(r.detail[k][4], base.detail[k][4]) && near(r.detail[k][5], base.detail[k][5]),
      `${[30, 60, 120][i]}Hz 第 ${k} 粒粒子轨迹分叉`);
    }
  }
  // 三种 cadence 各自烧掉的真实帧数不同，这正说明「一致」不是靠喂同样的帧数作弊来的
  eq(runs.map((r) => r.frames), [68, 136, 272], '272 步：30Hz 走 68 帧，60Hz 走 136 帧，120Hz 走 272 帧');
});

test('advance 是 dt 唯一的入口：直接按步推进得到同一状态', () => {
  const viaAccum = drive(60);
  const direct = createAnim({ seed: 20260930 });
  let next = 0;
  for (let s = 0; s < TARGET_STEPS; s++) {
    if (next < EMIT_AT.length && s >= EMIT_AT[next]) {
      emitBite(direct, BITTEN, geom, { strength: 1 });
      next += 1;
    }
    step(direct, SIM_STEP);
  }
  eq(snapshot(direct), snapshot(viaAccum.a), '累加器路径与逐步路径不可区分');
  eq(direct.particles.length, viaAccum.a.particles.length);
});

test('卡帧：0.5s 的巨型 elapsed 最多跑 MAX_STEPS 步，溢出累加器被丢而不是欠一屁股债', () => {
  const a = createAnim({ seed: 7 });
  const steps = advance(a, 0.5);
  eq(steps, MAX_STEPS, '一帧封顶 MAX_STEPS 步');
  eq(a.simSteps, MAX_STEPS);
  eq(a.accumulator, 0, '补不回来的时间明确丢弃，不留成下一帧的雪崩本金');
  eq(a.clock, MAX_STEPS * SIM_STEP, '虚拟时钟只走了真正模拟过的那点');
});

test('reduceMotion 分支：开启后不吃 dt —— 再跑一秒，状态一字不变', () => {
  const a = createAnim({ seed: 20260930 });
  advance(a, 1 / 60);
  emitBite(a, [[0, 1]], geom, { strength: 1 });
  rejectKick(a);
  ok(a.particles.length > 0, '先让场上有东西');
  ok(a.shake > 0, '先让屏幕在抖');
  setReducedMotion(a, true);
  eq(a.particles.length, 0, '开关一按，粒子立刻清掉，不等下一口');
  eq(a.shake, 0);
  const before = snapshot(a);
  for (let i = 0; i < 120; i++) advance(a, 1 / 30);
  const after = snapshot(a);
  eq(after.particles, before.particles);
  eq(after.shake, before.shake);
  eq(after.pulse, before.pulse);
  ok(after.simSteps > before.simSteps, '但循环本身没停：步数照走，只是不消费 dt 去动画面');
  eq(emitBite(a, BITTEN, geom, {}), 0, '降级态下一口也不产生粒子');
  eq(a.emitted, before.emitted, 'emitted 是单调见证：不能被偷偷回拨，也不能被加进来');
});

test('确定性：同种子重放全等，换种子必须不等（否则随机是假的）', () => {
  const a = drive(60).a;
  const b = drive(60).a;
  eq(snapshot(b), snapshot(a), '同种子重放');
  eq(JSON.stringify(b.particles), JSON.stringify(a.particles), '逐字段全等');
  const other = createAnim({ seed: 20260931 });
  const frame = 1 / 60;
  let next = 0;
  while (other.simSteps < TARGET_STEPS) {
    if (next < EMIT_AT.length && other.simSteps >= EMIT_AT[next]) {
      emitBite(other, BITTEN, geom, { strength: 1 });
      next += 1;
    }
    advance(other, frame);
  }
  ok(JSON.stringify(other.particles) !== JSON.stringify(a.particles), '换种子之后在飞的粒子云就不一样了');
  ok(snapshot(other).pulse !== 0, '呼吸相位非零，比较的不是零值');
});

test('resetTransient 清暂态、留见证：重开一局不该把时钟假装倒带', () => {
  const a = drive(60, { target: 140 }).a;
  const cleared = resetTransient(a);
  const s = snapshot(a);
  eq(s.particles, 0);
  eq(s.accumulator, 0);
  eq(s.shake, 0);
  eq(s.pulse, 0);
  eq(cleared.particles > 0, true, '返回值说清楚清掉了什么');
  ok(s.simSteps >= 140, 'clock/simSteps/emitted 是单调见证，必须活过 reset');
  ok(s.emitted > 0, '同上：emitted 不能被抹平');
});

run();
