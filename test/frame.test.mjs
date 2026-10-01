// 关卡内的帧率对拍，兼本机判据的复验入口。
//
// 为什么还要再来一个套件：test/anim.test.mjs 量的是 anim 模块自己，而官方量具
// cos_frame_probe.js 用 vm 顺序执行 index.html 里的 `<script src>`，读不了本仓的 ESM —— 它对本仓
// 只会输出「结论：无法比对（SyntaxError: Cannot use import statement outside a module）」。
// 那条判语既不算绿也不算红，等于没人量过。这里补的就是这一格：不依赖浏览器、不依赖官方探针，
// 直接把真实发盘的关卡（startMatch + playerBite + 对手按谱回口）和粒子模拟合在一起跑三档帧率。
//
//   node test/frame.test.mjs                  # 全绿（对拍 + 两发尺子自检）
//   node test/frame.test.mjs selfcheck        # 只跑对拍：自检 spawn 变异体时用的就是这一档
//
// 自检（规范 §6）打在真正吃帧 dt 的那一行上：`advance` 里的 `accumulator += elapsed`。定步长改造
// 完成之后，逐粒子的 `x += v*s` 拿常量去变异也照样绿，那是结构性质不是尺子空跑；所以这里按两把
// 尺分开取数，并且把「变异体必须红、真模块必须绿」两个方向都当成断言 —— 只报一边的绿不值得信。

import { test, run, ok, eq } from '../tools/harness.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REAL_ANIM = HERE + '../js/core/anim.js';
const MOD = process.env.CHOMP_ANIM
  ? pathToFileURL(process.env.CHOMP_ANIM).href
  : new URL('../js/core/anim.js', import.meta.url).href;

const A = await import(MOD);
const { createAnim, advance, emitBite, resetTransient, snapshot, SIM_STEP } = A;
const { startMatch, playerBite } = await import('../js/core/game.js');
const { bookMap, lots } = await import('../js/core/library.js');
const { winningBitesOf } = await import('../js/core/book.js');
const { legalBites, area } = await import('../js/core/shapes.js');

const SEED = Number(process.env.CHOMP_SEED || 20260930);
const TARGET = 272;                       // 2.266667 虚拟秒，也是 4 的倍数
const BITE_EVERY = 32;                    // 0.2667s < 最短粒子寿命 0.42s ⇒ 碎屑不会断档
const CELL = 96, PAD = 40;
const geom = (r, c) => ({ x: PAD + c * CELL, y: PAD + r * CELL, w: CELL - 8, h: CELL - 8 });
// 只用面积最大的两档开局：一局要撑十几口才分胜负，否则取数点早就落到结算画面上，
// 量到的就不是「关卡内」而是「结算后」——那是 §3 点名的静止快照假绿。
const POOL = lots.filter((l) => l.tier === 'master' || l.tier === 'twined');
const FIELDS = ['clock', 'simSteps', 'accumulator', 'particles', 'emitted', 'shake', 'pulse'];

function vanished(before, after) {
  const out = [];
  for (let r = 0; r < before.length; r++) {
    for (let c = 0; c < before[r]; c++) if (c >= (after[r] ?? 0)) out.push([r, c]);
  }
  return out;
}

// 一局正在打的巧克力：每一口都从谱里的必胜口挑（局才打得长、打得真），打完换下一张牌续上。
// stopOn='steps' 按 sim 步号收（绕开 1000/60 的浮点亏损凭空判红那一步），
// stopOn='seconds' 按喂进去的帧时长收（这一把才藏不住步数错配）。
function runLevel(hz, stopOn, limit, { onNewMatch = false } = {}) {
  ok(POOL.length >= 4, '关卡池不能空，否则整个套件在空数组上互相相等');
  const map = bookMap();
  let idx = 0;
  let match = startMatch(POOL[0]);
  eq(match.status, 'playing', `${POOL[0].id} 开局必须是进行中`);
  const a = createAnim({ seed: SEED });
  const frame = 1 / hz;
  let bites = 0, squares = 0, rounds = 1, next = 0, frames = 0, fed = 0, refused = 0;
  const stop = stopOn === 'steps' ? () => a.simSteps < limit && frames < 100000
    : () => fed < limit - 1e-12 && frames < 100000;
  while (stop()) {
    if (a.simSteps >= (next + 1) * BITE_EVERY) {
      next += 1;
      if (match.status !== 'playing') {
        idx = (idx + 1) % POOL.length;
        match = startMatch(POOL[idx]);
        rounds += 1;
        if (onNewMatch) resetTransient(a);   // 换局即重开：该清的暂态真清
      }
      const menu = winningBitesOf(map, match.shape);
      const legal = menu.length ? menu : legalBites(match.shape);
      ok(legal.length > 0, `第 ${a.simSteps} 步无可着法：关卡提前跑完了，取数点得往前挪`);
      const before = match.shape.slice();
      const m = legal[(SEED >> (next % 24)) % legal.length];
      const r = playerBite(map, match, m);
      if (r.rejected) refused += 1;          // 非法口被规则挡下也要记数：它不该静默
      else {
        const gone = vanished(before, r.state.shape);
        squares += gone.length;
        bites += 1;
        emitBite(a, gone, geom, { strength: 1 });
        match = r.state;                     // playerBite 已含对手的回口
      }
    }
    advance(a, frame);
    fed += frame;
    frames += 1;
  }
  const cloud = a.particles.map((p) => [p.x, p.y, p.vx, p.vy, p.rot, p.life, p.size, p.tone]);
  return {
    hz, frames, bites, squares, rounds, refused, playing: match.status === 'playing',
    plies: match.plies, cells: area(match.shape), snap: snapshot(a), cloud,
  };
}

const near = (x, y) => Math.abs(x - y) <= 1e-12;
const maxDev = (g, b) => {
  let m = 0;
  for (let k = 0; k < Math.min(g.cloud.length, b.cloud.length); k++) {
    for (let j = 0; j < g.cloud[k].length; j++) m = Math.max(m, Math.abs(g.cloud[k][j] - b.cloud[k][j]));
  }
  return m;
};

function inLevelReports(rs) {
  return rs.map((r) => `${r.hz}Hz: bites=${r.bites} squares=${r.squares} rounds=${r.rounds} plies=${r.plies} particles=${r.snap.particles}`).join('\n    ');
}

// 'selfcheck' 模式是给变异体子进程跑的：对拍判据照常注册（它红的就是这几格），
// 只有下面那两格自检 spawn 不再注册 —— 否则子进程又会生孙子，一路递归下去。
const SELF = process.argv[2] === 'selfcheck';

// 对拍判据恒注册：父进程跑一遍，变异体子进程也跑一遍（自检等的就是它红）。
function registerProbes() {
  test('关卡内·步号对齐：30/60/120Hz 打完同一段棋，末态逐字段一致（含每粒碎屑 8 字段）', () => {
    const rs = [30, 60, 120].map((hz) => runLevel(hz, 'steps', TARGET));
    ok(rs.every((r) => r.playing), '取数点必须还在关卡内：\n    ' + inLevelReports(rs));
    ok(rs.every((r) => r.bites >= 5), '至少咬出 5 口，否则是在空跑循环：\n    ' + inLevelReports(rs));
    ok(rs[0].cloud.length >= 6, '场上要有在飞的碎屑，不能拿三个空数组比全等：\n    ' + inLevelReports(rs));
    eq(new Set(rs.map((r) => r.frames)).size, 3, '三档各自烧掉的帧数必须不同 —— 一致不是喂同样帧数换来的');
    for (const k of FIELDS) {
      const v = rs.map((r) => r.snap[k]);
      if (Number.isInteger(v[0])) eq(v[1], v[0], `整数字段 ${k} 必须严格相等`);
      else ok(near(Math.max(...v), Math.min(...v)), `浮点字段 ${k} 分叉：${v.join(' vs ')}`);
    }
    for (const g of rs.slice(1)) {
      eq(g.cloud.length, rs[0].cloud.length, `${g.hz}Hz 碎屑数分叉`);
      ok(maxDev(g, rs[0]) <= 1e-12, `${g.hz}Hz 逐粒子轨迹分叉，最大偏差 ${maxDev(g, rs[0])}`);
    }
    // 关卡侧也必须同局：三档要是各自走了不同的棋，动画一致也说明不了什么
    for (const k of ['plies', 'bites', 'squares', 'rounds', 'cells']) {
      eq(new Set(rs.map((r) => r[k])).size, 1, `关卡字段 ${k} 三档不一致：\n    ` + inLevelReports(rs));
    }
  });

  test('关卡内·定游玩时长：2.2667s 的真实帧喂三档，推进的步数与帧率无关', () => {
    const rs = [30, 60, 120].map((hz) => runLevel(hz, 'seconds', TARGET * SIM_STEP));
    const steps = rs.map((r) => r.snap.simSteps);
    ok(Math.max(...steps) - Math.min(...steps) <= 1, `三档步数错开 ${steps.join('/')}（累加器行吃了帧 dt 就会被这样抓到）`);
    ok(rs.every((r) => r.playing && r.bites >= 5), '取数点仍在关卡内：\n    ' + inLevelReports(rs));
    eq(new Set(rs.map((r) => r.snap.particles)).size, 1, '同一时长下的在飞碎屑数与帧率无关');
  });

  test('活性测定：把时长从 2.27s 缩到 1s / 0.5s，状态必须变（排除静止快照假绿）', () => {
    const runs = [60, 120, TARGET].map((t) => runLevel(60, 'steps', t));
    const moved = FIELDS.filter((k) => !near(runs[0].snap[k], runs[2].snap[k]));
    ok(moved.length >= 4, `随时长推进的字段太少（${moved.join(', ') || '无'}）——尺子可能落在静止态上`);
    ok(JSON.stringify(runs[0].cloud) !== JSON.stringify(runs[2].cloud), '碎屑云随时长不变，说明比较的是静止态');
    ok(runs.every((r) => r.playing), '三个时长都要落在关卡内');
    ok(runs[2].snap.emitted > runs[0].snap.emitted, '单调见证 emitted 随时长增长：循环真的在消费 dt');
  });

  test('重开复位实测：打到一半换局，anim 暂态与关卡状态一起归零，单调见证留下', () => {
    const a = createAnim({ seed: SEED });
    const map = bookMap();
    let match = startMatch(POOL[0]);
    for (let round = 0; round < 3; round++) {
      const menu = winningBitesOf(map, match.shape);
      const r = playerBite(map, match, menu[round % menu.length]);
      ok(!r.rejected, '必胜口不该被规则拒绝：' + r.rejected);
      match = r.state;
      emitBite(a, [[0, 1 + round], [1, 1 + round]], geom, { strength: 1 });
    }
    for (let i = 0; i < 20; i++) advance(a, 1 / 60);   // 0.333 虚拟秒：抖已衰减，碎屑还在飞（寿命 0.42~0.88s）
    const before = snapshot(a);
    ok(before.particles > 0 && before.shake > 0, '复位前场上要有东西，否则"清干净"是句空话');
    const cleared = resetTransient(a);
    const after = snapshot(a);
    eq(after.particles, 0, '在飞碎屑必须清空');
    eq(after.shake, 0, '屏幕抖动必须清空');
    eq(after.pulse, 0, '毒格呼吸相位必须归零');
    ok(after.accumulator < SIM_STEP, '半帧余量不能留成下一局的雪崩本金');
    ok(cleared.particles === before.particles && cleared.shake === before.shake, '返回值要说清楚清掉了什么');
    ok(after.emitted === before.emitted && after.simSteps >= before.simSteps, 'clock/simSteps/emitted 是单调见证，不能假装倒带');
    const fresh = startMatch(POOL[0]);
    eq(fresh.shape, POOL[0].shape.slice(), '重开后棋盘回到这张牌的初始形状');
    eq([fresh.plies, fresh.youBites, fresh.aiBites, fresh.turn, fresh.status], [0, 0, 0, 'you', 'playing'], '手数、双方口数、行棋方、结算态全部复位');
    eq(fresh.history.length, 0, 'history 不能留上局的着法');
    eq(fresh.snapshots.length, 0, '撤销栈不能跨局');
  });
}

// ---------------------------------------------------------------- 尺子自检
registerProbes();

// 变异打在 `advance` 里唯一吃帧 dt 的那一行，并且两个方向都断言：真模块全绿、变异体必须红。
// 只验「红」不验「绿」的话，一次让套件整体崩掉的改动也会被当成"尺子有效"。
const MUTANT_LINE = ['  a.accumulator += elapsed;', '  a.accumulator += 1 / 60;'];

function writeMutant(path, [from, to] = MUTANT_LINE) {
  const src = readFileSync(REAL_ANIM, 'utf8');
  ok(src.includes(from), `找不到被变异的那一行：${from.trim()}\n    （anim.js 的累加器行改写法了，得同步更新这里的靶子；尺子不能悄悄空跑）`);
  writeFileSync(path, src.replace(from, to));
}

function runSelf(label, env, expectExit) {
  const r = spawnSync(process.execPath, [join(HERE, 'frame.test.mjs'), 'selfcheck'], {
    env: { ...process.env, ...env }, encoding: 'utf8',
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const failed = out.match(/^  FAIL (.+)$/gm) || [];
  eq(r.status, expectExit, `${label}：退出码 ${r.status}，期望 ${expectExit}\n    ${failed.slice(0, 3).join('\n    ')}`);
  return failed;
}

if (!SELF) {
  test('尺子自检：把 accumulator += elapsed 冻成常数，本套件必须红（真模块必须绿）', () => {
    const p = join(tmpdir(), `chomp-anim-mutant-${SEED}.js`);
    writeMutant(p);
    const failed = runSelf('变异体', { CHOMP_ANIM: p }, 1);
    ok(failed.length >= 1, '变异体一个 FAIL 都没有 —— 尺子空跑，红是假红，绿也是假绿');
    ok(failed.some((l) => /步数|帧率|一致/.test(l)), `变异体红的不是帧率判据：\n    ${failed.join('\n    ')}`);
    runSelf('真模块', {}, 0);
  });

  test('尺子自检·第二发：丢掉 catch-up（每帧最多一步）也必须红', () => {
    const p = join(tmpdir(), `chomp-anim-mutant2-${SEED}.js`);
    writeMutant(p, ['  while (a.accumulator >= SIM_STEP && steps < MAX_STEPS) {',
      '  while (a.accumulator >= SIM_STEP && steps < 1) {']);
    const failed = runSelf('每帧一步', { CHOMP_ANIM: p }, 1);
    ok(failed.length >= 1, '这一发没让尺子变红，说明它量不到 catch-up 策略');
  });
}

run();
