// 输入通路：pointer 优先 + touchstart/mousedown 回落，跑在 test/domstub.mjs 的桩里。
//
// 规范 §2 要的是「pointerdown 优先 + touchstart/mousedown 回落」，而本仓原先只有 pointer 一条
// 路：`el.board.addEventListener('pointerdown', …)`。在没有 Pointer Events 的引擎上（iOS Safari
// < 13、一部分应用内 webview）这根手指落在画布上什么也不会发生 —— 清单照样打勾，因为 grep
// 'pointerdown' 命中了。这里把两条通路都当成行为来量：
//   ① 有 PointerEvent 时只许绑 pointer 一族（同时绑两族会被一次手势咬两口：现代引擎里
//      pointer 会合成 mouse/touch）；
//   ② 没有 PointerEvent 时 touch 与 mouse 两条回落都要能把口咬下去，且 touch 必须
//      preventDefault —— 不然页面跟着手指滚，抬手处就是另一格；
//   ③ 坐标换算真按 rect 走：把画布在页面上挪到 (120, 80) 再打，落点仍然命中那一格。
//      「点 A 打 B」这一类 bug 的直接测法就是偏移之后再看 preview 落在哪。
//
// 读数取 `state.preview`（按住拖动时高亮的那一格），因为它就是换算的结果；末态取
// cells/plies 的增减，因为它就是这一口真进账了。
//
//   node test/input.test.mjs

import { test, ok, eq, run } from '../tools/harness.mjs';
import { boot, byId, click, key, listeners, mouse, pump, resetDom, setPointerSupport, setRect, touch } from './domstub.mjs';

const BIG = '#/lot/shoal-01';

/** 把局面摆成可测的活棋盘：收掉引导、必要时换一张大点的牌。 */
function arm(c) {
  if (!byId('tutorial').hidden) click('tut-close');
  c.load(BIG);
  pump(2);
  const legal = c.legal();
  ok(legal.length >= 3, `回落要两格不同的落点才测得出来，${BIG} 只有 ${JSON.stringify(legal)}`);
  return legal;
}

/** 从合法口里挑一对：先按左上那格，再拖到更靠右下的一格。 */
function pair(legal) {
  const a = legal[0];
  const b = legal.find(([r, cc]) => r !== a[0] || cc !== a[1]);
  ok(b, `找不到第二个落点：${JSON.stringify(legal)}`);
  return [a, b];
}

// ---- ① 现代引擎：pointer 独占 ---------------------------------------------------
// 两次 boot 必须写在 test 体里：tools/harness.mjs 是把 test 排队、最后 run() 才逐个跑，
// 放在模块顶层的话 resetDom() 会抢在第一发断言之前把元素桩换掉，读数就全成 0 了。
let cA = null;
let cB = null;

test('有 PointerEvent：只绑 pointer 一族，touch/mouse 一支都不许多绑', async () => {
  setPointerSupport(true);
  cA = await boot(20);
  ok(cA, 'window.chomp 没挂出来');
  eq(listeners('board', 'pointerdown'), 1, 'pointerdown 应当恰好一支');
  eq(listeners('board', 'pointermove'), 1, 'pointermove 应当恰好一支');
  eq(listeners('board', 'pointerup'), 1, 'pointerup 应当恰好一支');
  eq(listeners('board', 'pointercancel'), 1, 'pointercancel 应当恰好一支');
  eq(listeners('board', 'touchstart'), 0, '现代引擎里 pointerdown 会合成 touchstart，再绑一支就是咬两口');
  eq(listeners('board', 'mousedown'), 0, '同上，mousedown 也不许并存');
});

test('pointer 通路真能咬：按下-拖动-抬手，preview 跟着走、cells 进账', () => {
  const c = cA;
  const legal = arm(c);
  const [a, b] = pair(legal);
  const before = c.state.cells, plies0 = c.state.plies;
  const pa = c.cellPoint(a[0], a[1]), pb = c.cellPoint(b[0], b[1]);
  byId('board').dispatch('pointerdown', { clientX: pa.x, clientY: pa.y, pointerId: 1 });
  eq(c.state.preview && [c.state.preview.r, c.state.preview.c], a, '按下那一格就该是高亮');
  byId('board').dispatch('pointermove', { clientX: pb.x, clientY: pb.y, pointerId: 1 });
  eq(c.state.preview && [c.state.preview.r, c.state.preview.c], b, '拖动没带走高亮');
  byId('board').dispatch('pointerup', { clientX: pb.x, clientY: pb.y, pointerId: 1 });
  ok(c.state.cells < before, `cells 没减：${before} → ${c.state.cells}`);
  ok(c.state.plies > plies0, `plies 没进账：${plies0} → ${c.state.plies}`);
  eq(c.state.preview, null, '抬手之后预览必须清空');
});

// ---- ② 没有 PointerEvent：两条回落都要活 ---------------------------------------

test('没有 PointerEvent：pointer 一支不绑，touch 四支 + mouse 三支补位', async () => {
  resetDom();
  setPointerSupport(false);
  cB = await boot(21);
  eq('PointerEvent' in globalThis.window, false, '桩没关掉 PointerEvent，这一发测的是主路');
  eq(listeners('board', 'pointerdown'), 0, '不该有 pointer 监听');
  for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    eq(listeners('board', t), 1, `${t} 回落没绑上`);
  }
  eq(listeners('board', 'mousedown'), 1, 'mousedown 回落没绑上');
});

test('touch 回落真能咬，且每一支都 preventDefault（页面不许跟着手指滚）', () => {
  const c = cB;
  const legal = arm(c);
  const [a, b] = pair(legal);
  const before = c.state.cells, plies0 = c.state.plies;
  const pa = c.cellPoint(a[0], a[1]), pb = c.cellPoint(b[0], b[1]);
  const down = touch('board', 'touchstart', pa.x, pa.y);
  eq(down.defaultPrevented, true, 'touchstart 没吞默认动作，ghost click 会再咬一口');
  eq(c.state.preview && [c.state.preview.r, c.state.preview.c], a, '手指按下的那一格没成为锚点');
  const move = touch('board', 'touchmove', pb.x, pb.y);
  eq(move.defaultPrevented, true, 'touchmove 没吞默认动作，拖动会把页面滚走');
  eq(c.state.preview && [c.state.preview.r, c.state.preview.c], b, '手指拖到哪，高亮就该跟到哪');
  const up = touch('board', 'touchend', pb.x, pb.y);
  eq(up.defaultPrevented, true, 'touchend 没吞默认动作');
  ok(c.state.cells < before, `cells 没减：${before} → ${c.state.cells}`);
  ok(c.state.plies > plies0, `plies 没进账：${plies0} → ${c.state.plies}`);
});

test('mouse 回落：按下在画布、抬手在窗口外，那一口照样进账', () => {
  const c = cB;
  const legal = arm(c);
  const [a, b] = pair(legal);
  const before = c.state.cells, plies0 = c.state.plies;
  const pa = c.cellPoint(a[0], a[1]), pb = c.cellPoint(b[0], b[1]);
  mouse('board', 'mousedown', pa.x, pa.y);
  eq(c.state.preview && [c.state.preview.r, c.state.preview.c], a, 'mousedown 没落进同一套状态机');
  mouse(null, 'mousemove', pb.x, pb.y);
  eq(c.state.preview && [c.state.preview.r, c.state.preview.c], b, '窗口上的 mousemove 没接到');
  mouse(null, 'mouseup', pb.x, pb.y);
  ok(c.state.cells < before, `cells 没减：${before} → ${c.state.cells}`);
  ok(c.state.plies > plies0, `plies 没进账：${plies0} → ${c.state.plies}`);
});

test('右键与空 touch 不算一口：button=2 与 touches=[] 都必须原地不动', () => {
  const c = cB;
  arm(c);
  const before = c.state.cells, plies0 = c.state.plies;
  const p = c.cellPoint(...c.legal()[0]);
  mouse('board', 'mousedown', p.x, p.y, 2);
  eq(c.state.preview, null, '右键把锚点立起来了');
  const empty = byId('board').dispatch('touchstart', { touches: [], changedTouches: [], target: byId('board') });
  eq(empty.defaultPrevented, false, '没有触点的 touch 不该吞默认动作');
  eq(c.state.cells, before, '这两发里有一发把口咬了');
  eq(c.state.plies, plies0);
});

// ---- ③ 坐标换算按 rect 走 -------------------------------------------------------

test('画布在页面上挪过位置：落点仍然命中那一格（点 A 不许打 B）', () => {
  const c = cB;
  const legal = arm(c);
  const [a, b] = pair(legal);
  setRect({ left: 120, top: 80 });
  c.view.resize();
  const pa = c.cellPoint(a[0], a[1]), pb = c.cellPoint(b[0], b[1]);
  ok(pa.x > 120 && pa.y > 80, `cellPoint 没带上 rect 偏移：${JSON.stringify(pa)}`);
  touch('board', 'touchstart', pa.x, pa.y);
  eq(c.state.preview && [c.state.preview.r, c.state.preview.c], a, '偏移后的按下落到别的格去了');
  touch('board', 'touchmove', pb.x, pb.y);
  eq(c.state.preview && [c.state.preview.r, c.state.preview.c], b, '偏移后的拖动落到别的格去了');
  touch('board', 'touchend', pb.x, pb.y);
  setRect({ left: 0, top: 0 });
  c.view.resize();
});

test('反证·尺不是空跑：同一发落在偏移后画布之外，必须一格都不咬', () => {
  const c = cB;
  arm(c);
  setRect({ left: 300, top: 200 });
  c.view.resize();
  const legal = c.legal();
  const p = c.cellPoint(...legal[0]);
  const before = c.state.cells, plies0 = c.state.plies;
  // 同一组坐标，画布却整体在 (300,200)：拿"不减 rect.left"的那套算法去解，会解进有效格。
  const naive = { x: p.x - 300, y: p.y - 200 };
  touch('board', 'touchstart', naive.x, naive.y);
  const hit = c.pointAt(naive.x, naive.y);
  eq(hit, null, `换算漏了：画布外的坐标解出了 ${JSON.stringify(hit)}`);
  eq(c.state.preview, null, '画布外的一发立起了锚点');
  eq(c.state.cells, before, '画布外的一发把口咬了');
  eq(c.state.plies, plies0);
  setRect({ left: 0, top: 0 });
  c.view.resize();
});

test('回落不吞键盘：R 重开、M 静音、P 暂停在 touch 通路里照样成立', () => {
  const c = cB;
  const legal = arm(c);
  const p0 = c.cellPoint(...legal[0]);
  const cellsFull = c.state.cells;
  touch('board', 'touchstart', p0.x, p0.y);
  touch('board', 'touchend', p0.x, p0.y);
  ok(c.state.plies > 0, '这一口没进账，后面的 R 就无从复位');
  ok(c.state.youBites > 0);
  key('r');
  eq(c.state.plies, 0, 'R 之后口数没归零');
  eq(c.state.youBites, 0, 'R 之后玩家口数没归零');
  eq(c.state.cells, cellsFull, 'R 之后巧克力没长回来');
  eq(c.state.paused, false, 'R 不该顺手暂停');
  key('p');
  eq(c.state.paused, true, 'P 没暂停');
  const p = c.cellPoint(...c.legal()[0]);
  const before = c.state.cells;
  touch('board', 'touchstart', p.x, p.y);
  touch('board', 'touchend', p.x, p.y);
  eq(c.state.cells, before, '暂停态下 touch 回落居然咬了');
  key('p');
  eq(c.state.paused, false, 'P 没解暂停');
  key('m');
  eq(c.state.muted, true, 'M 没静音');
  key('m');
  eq(c.state.muted, false, 'M 没解除静音');
});

await run();
