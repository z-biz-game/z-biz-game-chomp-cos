// reduceMotion 是真分支还是注释：量「咬一口出来几只碎屑」，而不是 grep 'prefers-reduced-motion'。
//
// 规范 §2 那一行写得很直白：`matchMedia('(prefers-reduced-motion: reduce)')` 要有真分支，
// 关掉的是粒子/涟漪/抖动。本仓的分支住在三处：js/main.js 的 motionWanted()（系统偏好 + 存档
// 覆盖）、js/core/anim.js 的 `if (a.reducedMotion) return 0`（emitBite 与 rejectKick 都不许
// 出库）、js/view.js 的呼吸项 `anim.reducedMotion ? 0 : sin(...)`。三处都要读数，缺一处就是
// "字符串命中而行为不成立"。
//
// 还有一条本单实测出来的缺口：`store.setMotionOverride()`（js/core/storage.js:155）自落地起
// 就没有任何 UI 能碰到 —— 存档里有这个字段、解码里有校验、motionWanted() 里读它，玩家手上却
// 只有跟着 OS 走的那个默认值。所以 HUD 上加了 #motion 三态按钮（跟随系统 → 强制完整 → 强制
// 减弱），下面第 5 发行量的就是它：文案、aria-pressed、存档、行为四样必须一起动。
//
// 顺序有意义：第 1 发行开机的那一支实例被后面几行复用，第 6/7/8 行各自 resetDom + 重新开机。
//
//   node test/motion.test.mjs

import { test, ok, eq, run } from '../tools/harness.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { boot, byId, click, pump, resetDom, saveRaw, setMedia, setMotionPreference } from './domstub.mjs';

const MOTION_Q = '(prefers-reduced-motion: reduce)';
const BIG = '#/lot/shoal-01';
let inst = null;

/** 每次都从同一张大牌起咬：开机那张战役第一关太小，一口下去局就结算了，后面几行无从下口。 */
function bite(c) {
  if (!byId('tutorial').hidden) click('tut-close');
  c.load(BIG);
  pump(1);
  const legal = c.legal();
  ok(legal.length >= 3, `${BIG} 只给出 ${JSON.stringify(legal)}，这一发测不到碎屑`);
  const before = c.state.anim;
  c.tap(legal[0][0], legal[0][1]);
  pump(2);
  return { before, after: c.state.anim };
}

/** 走 UI 那条链路：写存档 + 立刻同步分支（#motion 按钮就是这么做的）。 */
function setOverride(c, which) {
  c.store.setMotionOverride(which);
  c.syncMotion();
  return c.state.reducedMotion;
}

test('系统偏好 reduce 开机：碎屑一只都不出库，抖动恒为 0', async () => {
  resetDom();
  setMedia(MOTION_Q, true);
  inst = await boot(40);
  eq(inst.state.reducedMotion, true, 'motionWanted() 没听系统偏好');
  const { before, after } = bite(inst);
  eq(after.emitted - before.emitted, 0, `减弱态下出库了 ${after.emitted - before.emitted} 只碎屑`);
  eq(after.particles, 0, `减弱态下场上还剩 ${after.particles} 只碎屑`);
  eq(after.shake, 0, '减弱态下棋盘还在抖');
});

test('对照·把偏好拧回完整：同一支实例再咬一口，碎屑必须出得来', () => {
  setOverride(inst, 'full');
  const { before, after } = bite(inst);
  ok(after.emitted - before.emitted > 0, '改成完整动效还是没有碎屑 ⇒ 上面那发 0 是粒子系统坏了，不是分支');
  ok(after.particles > 0, `出库 ${after.emitted - before.emitted} 只却一只都不在场上`);
  eq(after.reducedMotion, false);
});

test('存档压得过系统偏好：override=reduce 而系统是 full，出库读数立刻归零', () => {
  setMedia(MOTION_Q, false);
  eq(setOverride(inst, 'reduce'), true, 'override=reduce 没压过系统偏好');
  const { before, after } = bite(inst);
  eq(after.emitted - before.emitted, 0, 'override 只改了标志位，没改行为');
  eq(setOverride(inst, 'full'), false, 'override=full 也没压过系统偏好');
  const again = bite(inst);
  ok(again.after.emitted > again.before.emitted, 'full 那一支没把碎屑放回来');
});

test('#motion 按钮三态循环：文案、aria-pressed、存档、行为四样一起动', () => {
  const c = inst;
  setOverride(c, null);
  click('motion');                      // 跟随系统 -> 强制完整
  eq(byId('motion').textContent, '动效 全', '第一档应当是强制完整');
  eq(c.state.reducedMotion, false);
  click('motion');                      // -> 强制减弱
  eq(byId('motion').textContent, '动效 减弱');
  eq(byId('motion').getAttribute('aria-pressed'), 'true', '减弱档没标 aria-pressed');
  eq(c.state.reducedMotion, true, '按钮没真的翻分支');
  eq(JSON.parse(saveRaw()).settings.motionOverride, 'reduce', '按钮的选择没写进存档');
  const { before, after } = bite(c);
  eq(after.emitted - before.emitted, 0, '减弱档还在出库');
  click('motion');                      // -> 跟随系统（系统是 full）
  eq(byId('motion').textContent, '动效 自动', '第三档没回到跟随系统');
  eq(JSON.parse(saveRaw()).settings.motionOverride, null);
  eq(c.state.reducedMotion, false, '回到自动后应当跟着系统（full）走');
});

test('OS 偏好中途变化会立刻改分支（MediaQueryList 上那支监听）', () => {
  const c = inst;
  setMedia(MOTION_Q, false);
  setOverride(c, null);
  eq(c.state.reducedMotion, false);
  setMotionPreference(true);
  eq(c.state.reducedMotion, true, 'change 监听没接上，玩家拧系统开关要重开页面才生效');
  const { before, after } = bite(c);
  eq(after.emitted - before.emitted, 0, '接上了标志位却没接上行为');
  setMotionPreference(false);
  eq(c.state.reducedMotion, false, '拧回去也要成立');
});

test('减弱动效不等于冻住游戏：偏好 reduce 时仿真步数照样推进', async () => {
  resetDom();
  setMedia(MOTION_Q, true);
  const c = await boot(43);
  if (!byId('tutorial').hidden) click('tut-close');
  const s0 = c.state.anim;
  pump(30);
  const s1 = c.state.anim;
  ok(s1.simSteps > s0.simSteps, `simSteps 没走：${s0.simSteps} → ${s1.simSteps}`);
  ok(s1.clock > s0.clock, `时钟没走：${s0.clock} → ${s1.clock}`);
  eq(s1.reducedMotion, true);
  eq(s1.particles, 0);
});

test('开机就照存档画文案：静态的「动效 自动」不许盖过存下来的强制减弱', async () => {
  resetDom();
  setMedia(MOTION_Q, false);
  const first = await boot(41);
  first.store.setMotionOverride('reduce');
  resetDom();
  const c = await boot(42);
  eq(byId('motion').textContent, '动效 减弱', '回访时按钮还在撒谎');
  eq(c.state.reducedMotion, true);
  eq(byId('motion').getAttribute('aria-pressed'), 'true');
  c.store.setMotionOverride(null);
});

test('CSS 那条 reduce 块是真规则，且 #motion 落在 44px 命中区下限里', () => {
  const src = readFileSync(fileURLToPath(new URL('../css/game.css', import.meta.url)), 'utf8');
  const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(src);
  ok(block, 'CSS 里没有 prefers-reduced-motion 块');
  ok(/animation-duration: *0\.001ms !important/.test(block[1]), '块里没真的掐掉 animation');
  ok(/transition-duration: *0\.001ms !important/.test(block[1]), '块里没真的掐掉 transition');
  ok(/button \{[^}]*min-height: 44px[^}]*min-width: 44px/.test(src), '44px 下限不是打在 button 通选上，新增的 #motion 未必吃得到');
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  ok(/id="motion"/.test(html), '#motion 不在盘上的 index.html 里，main.js 拿到的是 null');
  ok(/viewport-fit=cover/.test(html) && /env\(safe-area-inset-top\)/.test(src), 'safe-area 那一对断了');
});

test('反证·没有 matchMedia 的引擎：开机不抛，且默认走完整动效', async () => {
  resetDom();
  const real = globalThis.window.matchMedia;
  Object.defineProperty(globalThis.window, 'matchMedia', { value: undefined, writable: true, configurable: true });
  let threw = null;
  let c = null;
  try {
    c = await boot(45);
  } catch (err) {
    threw = String((err && err.message) || err);
  }
  Object.defineProperty(globalThis.window, 'matchMedia', { value: real, writable: true, configurable: true });
  eq(threw, null, '没有 matchMedia 就抛了未捕获异常');
  eq(c.state.reducedMotion, false, '取不到偏好应当退回完整动效，而不是反过来没收玩家的碎屑');
  const { before, after } = bite(c);
  ok(after.emitted > before.emitted, '退回的那一支没有行为');
});

await run();
