// 系统控制状态机：暂停 / 静音 / 首启引导 / 键盘，跑在 test/domstub.mjs 的 DOM 桩里。
//
// 这一层原先只有 tools/verify.sh 的浏览器套件覆盖，而浏览器套件一次要占一台 headless Chrome，
// 于是"改 main.js 的状态机，unit job 看不见"。本套件的直接起因是实测到的两发真缺陷：
//   ① 玩家主动按 P 暂停后，按 H 再看一次规则、关掉浮层 —— 暂停被偷偷解除，棋盘自己跑起来了；
//   ② 引导浮层开着时按 P，会在盖住棋盘的浮层底下把仿真恢复。
// 两条都在下面的行里钉死，且各自带一发"改坏就必须红"的反证。
//
// 顺序有意义：同一进程里装两份 main.js 实例（第一份=首次到访，第二份=回访），
// 中间只 resetDom()，localStorage 与 js/core/audio.js 的模块态跨实例存活 —— 这正好是浏览器里
// "换页不换盘"的语义。所以静音那几行读的是增量，不是绝对值。
import { test, run, ok, eq } from '../tools/harness.mjs';
import { boot, resetDom, byId, key, click, pump, oscillators, saveRaw } from './domstub.mjs';

const steps = (c) => c.state.anim.simSteps;
const bite = (c) => { c.load('#/lot/shoal-01'); const r = c.tap(1, 1); return r && r.rejected ? r.rejected : `bit:${c.state.plies}`; };
let c = null;
let oscAfterUnlock = 0;

test('boot#1 装进桩环境：window.chomp 挂出完整控制面、引导浮层可见、paused=true', async () => {
  resetDom();
  ok(byId('tutorial'), 'index.html 里没有 #tutorial');
  c = await boot(1);
  ok(c, 'window.chomp 没挂上，状态机无从观测');
  const need = ['state', 'setPaused', 'openTutorial', 'toggleMute', 'load', 'tap', 'advance', 'anim', 'store'];
  eq(need.filter((k) => c[k] === undefined), [], 'window.chomp 少了一截可观测面');
  eq(c.state.paused, true, '引导开着时棋盘应当停住');
  eq(byId('tutorial').hidden, false, '首启应当弹出玩法说明');
});

test('暂停期间喂 30 帧：仿真步数一格不涨（累加器连 elapsed 都拿不到）', () => {
  const before = steps(c);
  pump(30);
  eq(steps(c), before, '暂停期间仿真推进了');
  eq(bite(c), '已暂停', '暂停中不该吃得下口');
});

test('关掉引导：棋盘活了，再喂 30 帧步数必须涨', () => {
  click('tut-close');
  eq(c.state.paused, false, '关掉引导应当恢复');
  eq(byId('tutorial').hidden, true, '引导应当收起');
  const before = steps(c);
  pump(30);
  ok(steps(c) > before, `恢复后仿真没推进：${before} -> ${steps(c)}`);
  eq(bite(c), 'bit:2', '活棋盘应当吃得下合法的一口');
});

test('反证·核心：主动暂停 → 按 H 看规则 → 关浮层，那次暂停必须原样还回来', () => {
  c.load('#/lot/shoal-01');
  key('p');
  eq(c.state.paused, true, 'P 应当暂停');
  key('h');
  eq(byId('tutorial').hidden, false, 'H 应当打开规则');
  eq(c.state.paused, true, '看规则时当然还是停着');
  click('tut-close');
  eq(c.state.paused, true, '关完规则就把玩家的暂停解除 —— 这正是被修掉的那发缺陷');
  eq(bite(c), '已暂停', '暂停被吞掉的话，这里会吃得下口');
});

test('引导开着按 P：不许在盖住棋盘的浮层底下把仿真恢复', () => {
  key('h');
  eq(byId('tutorial').hidden, false, '引导应当开着');
  eq(c.state.paused, true, '引导开着时棋盘是停住的');
  const before = steps(c);
  key('p');
  eq(c.state.paused, true, '浮层底下按 P 把棋盘恢复了');
  pump(30);
  eq(steps(c), before, '浮层底下仿真推进了');
  click('tut-close');
  eq(c.state.paused, true, '关掉浮层后仍应停在玩家设定的那一档');
  key('p');
  eq(c.state.paused, false, '玩家自己按 P 才应当恢复');
  eq(bite(c), 'bit:2', '恢复后应当能下口');
});

test('静音是真停 AudioContext：静音后连按 5 次音效，振荡器一只都不许多建', () => {
  click('mute'); // 第一次手势才建 context（浏览器策略），随后立刻静音
  const built0 = c.state.audio.built;
  const osc0 = oscillators();
  eq(c.state.muted, true, 'M 应当静音');
  eq(c.state.audio.context, 'suspended', '静音必须是 suspend()，不是 gain=0');
  for (let i = 0; i < 5; i++) { bite(c); key('u'); }
  eq(c.state.audio.built, built0, '静音态下还在新建振荡器 = 假静音');
  eq(oscillators(), osc0, '桩侧计数：静音态下真的建出了节点');
  oscAfterUnlock = osc0;
});

test('解除静音：下一口重新建节点，context 回到 running', () => {
  click('mute');
  eq(c.state.muted, false, '再按一次应当恢复音效');
  eq(c.state.audio.context, 'running', '解除静音必须 resume()');
  bite(c);
  ok(c.state.audio.built > 0 && oscillators() > oscAfterUnlock,
    `解除静音后不建节点说明声音根本没接回去：built=${c.state.audio.built} osc=${oscillators()}`);
});

test('键盘覆盖：R 重开清掉暂态，Enter 能咬下，? 打开规则，Esc 收掉', () => {
  key('r');
  eq(c.state.plies, 0, 'R 应当重开');
  const crumbsBefore = c.state.anim.particles;
  key('h');
  eq(byId('tutorial').hidden, false, '? / H 应当打开规则');
  key('Escape');
  eq(byId('tutorial').hidden, true, 'Esc 应当收掉规则');
  eq(c.state.paused, false, '从活棋盘进规则、再关掉，应当回到活棋盘');
  key('Enter');
  ok(c.state.plies > 0 || c.state.line, 'Enter 应当在准星处咬下');
  ok(crumbsBefore >= 0);
});

test('存档落盘：seenTutorial 写进了 localStorage 的那一个键', () => {
  const raw = saveRaw();
  ok(raw && /"seenTutorial":\s*true/.test(raw), `存档里没记住引导已看过：${String(raw).slice(0, 120)}`);
});

test('套件前置顺序有意义：先收浮层、再清档（收浮层会往存档里写 seenTutorial）', () => {
  c.openTutorial(true);
  eq(c.state.paused, true, '打开规则应当停住棋盘');
  c.store.reset();
  eq(saveRaw(), null, '清档应当把这个键整个拿掉');
  click('tut-close');
  ok(saveRaw() !== null, '清档之后再关浮层，seenTutorial 又被写回去了 —— 套件必须按"先关、再清"走');
  c.store.reset();
  eq(saveRaw(), null, '按正确顺序收尾后存档应当是空的');
  eq(c.state.paused, false, '走完前置，棋盘应当是活的');
  eq(bite(c), 'bit:2');
});

test('boot#2 回访：不再弹引导，开机就是活棋盘', async () => {
  c.store.markTutorialSeen(); // 前置自己种，不蹭前面那几行留下的存档
  resetDom();
  c = await boot(2);
  eq(byId('tutorial').hidden, true, '回访不该再被推一次玩法说明');
  eq(c.state.paused, false, '回访开机不该停在暂停态');
  const before = steps(c);
  pump(30);
  ok(steps(c) > before, `活棋盘不推进仿真：${before} -> ${steps(c)}`);
  eq(bite(c), 'bit:2', '回访开机应当立刻能下口');
});

test('回访同样保住主动暂停：P → H → 关浮层 ⇒ 仍是暂停', () => {
  key('p');
  key('h');
  eq(byId('tutorial').hidden, false, 'H 应当打开规则');
  click('tut-close');
  eq(c.state.paused, true, '回访路径上又把暂停吞了');
  eq(bite(c), '已暂停');
  key('p');
  eq(bite(c), 'bit:2', '玩家自己按 P 之后才恢复');
});

test('反证·桩不是空跑：把暂停态直接改掉，上面那些断言读得到差异', () => {
  c.setPaused(true);
  eq(bite(c), '已暂停');
  const before = steps(c);
  pump(20);
  eq(steps(c), before, 'setPaused(true) 之后还在推进，说明帧回调没接到桩上');
  c.setPaused(false);
  pump(20);
  ok(steps(c) > before, '解除暂停后仍不推进，说明 pump 根本没喂到 rAF');
});

await run();
