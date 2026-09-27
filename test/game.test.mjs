// The match machine: whose turn, what the rules refuse, and who ends up forced onto the poison.
// Illegal input must not count — that is the contract line this suite exists for.
// Run: node test/game.test.mjs

import { test, run, ok, eq, fail } from '../tools/harness.mjs';
import {
  SEATS, aiTurn, biteFootprint, classifyNow, hintAt, perfectLine, playBite, playerBite, startMatch, undoRound,
} from '../js/core/game.js';
import { bookMap, derive, verifyLot } from '../js/core/library.js';
import { applyBite, area, encodeShape, isTerminal, legalBites } from '../js/core/shapes.js';
import { solvePosition } from '../js/core/solve.js';
import { BOOK, LOTS } from '../js/data/lots.js';
import { decodeBook } from '../js/core/book.js';

const BOOK_P = BOOK.p;

const map = bookMap();

// ---------------------------------------------------------------- setup
test('startMatch 交给玩家先手，根局面就是关卡形状', () => {
  for (const lot of LOTS) {
    const st = startMatch(lot);
    eq(st.shape, lot.shape, lot.id + ' shape');
    eq(st.root, lot.shape, lot.id + ' root');
    eq(st.turn, 'you', lot.id + ' 先手是玩家');
    eq(st.status, 'playing');
    eq(st.plies, 0);
    eq(st.history, []);
    ok(/必胜首口/.test(st.line), st.line);
  }
});

test('startMatch 拒绝非法关卡', () => {
  for (const bad of [[], [1, 3], [0], ['2']]) {
    try {
      startMatch({ id: 'x', shape: bad });
      fail('应拒绝 ' + JSON.stringify(bad));
    } catch (err) {
      ok(/startMatch/.test(err.message), err.message);
    }
  }
});

test('classifyNow 印的判定与棋书/独立求解三方一致', () => {
  for (const lot of LOTS) {
    const st = startMatch(lot);
    const c = classifyNow(map, st);
    eq(c.n, true, lot.id + ' 每一关开局都是 N');
    eq(c.verdict, '必胜', lot.id);
    eq(c.winner, '你', lot.id + ' 先手是玩家，所以必胜的是玩家');
    eq(solvePosition(lot.shape).winner, '先手', lot.id);
  }
});

// ---------------------------------------------------------------- illegal input
test('非法点击不计数：毒格、空位、越界都不改变局面', () => {
  const lot = LOTS[0];
  let st = startMatch(lot);
  const probes = [[0, 0], [9, 0], [0, 99], [lot.shape.length - 1, lot.shape[lot.shape.length - 1]], ['x'], null, [1.5, 0]];
  for (const m of probes) {
    const before = JSON.stringify({ shape: st.shape, plies: st.plies, you: st.youBites });
    const r = playBite(map, st, m, 'you');
    ok(r.rejected, `${JSON.stringify(m)} 应当被拒`);
    eq(JSON.stringify({ shape: r.state.shape, plies: r.state.plies, you: r.state.youBites }), before, `${JSON.stringify(m)} 之后状态不变`);
  }
});

test('毒格的拒绝是一句话，不是沉默', () => {
  const st = startMatch(LOTS[0]);
  const r = playBite(map, st, [0, 0], 'you');
  eq(r.rejected, '毒格不能主动咬');
  ok(/不能这样咬/.test(r.state.line), r.state.line);
});

test('咬过的位置再点一次不计数（空位判定）', () => {
  let st = startMatch(LOTS[2]); // [3,3]
  const r = playBite(map, st, [1, 2], 'you');
  st = r.state;
  eq(encodeShape(st.shape), '3.2', '咬完剩 3.2');
  const before = JSON.stringify(st.shape);
  // 第二行第 4 列已经不在了
  const bad = playBite(map, st, [1, 3], 'ai');
  eq(bad.rejected, '那一格早已被咬空');
  eq(JSON.stringify(bad.state.shape), before);
});

test('轮次守卫：不该你走的时候走不了', () => {
  const st = startMatch(LOTS[0]);
  const r = playBite(map, st, [1, 3], 'ai');
  eq(r.rejected, '还没轮到对手');
  eq(JSON.stringify(r.state.shape), JSON.stringify(st.shape), '局面没动');
  eq(r.state.plies, 0, '轮次守卫也不计数');
  ok(/还没轮到对手/.test(r.state.line), r.state.line);
  const over = playBite(map, { ...st, status: 'won' }, [1, 3], 'you');
  eq(over.rejected, '本局已结束');
  ok(/已结束/.test(over.state.line), over.state.line);
});

// ---------------------------------------------------------------- legal play
test('合法一口：右下方整块消失，步数与历史各加一', () => {
  const lot = LOTS[0]; // [4,4]，胜口 (1,3)
  const st = startMatch(lot);
  const r = playBite(map, st, [1, 3], 'you');
  eq(r.rejected, null);
  eq(r.state.shape, [4, 3], '剩下阶梯');
  eq(r.state.plies, 1);
  eq(r.state.youBites, 1);
  eq(r.state.aiBites, 0);
  eq(r.state.turn, 'ai', '交棒给对手');
  eq(r.state.history.length, 1);
  eq(r.state.history[0].seat, 'you');
  eq(r.state.history[0].left, area([4, 3]));
  eq(biteFootprint(st, [1, 3]), 1, '这一口只带走一格');
});

test('每一关的认证线路走到终点都是玩家胜（与印着的 先手 一致）', () => {
  for (const lot of LOTS) {
    const { state } = perfectLine(map, lot);
    eq(state.status, 'won', lot.id + ' 完美打法必须赢');
    eq(state.loser, 'ai', lot.id + ' 被迫咬毒的是对手');
    eq(isTerminal(state.shape), true, lot.id + ' 终局只剩毒格');
    eq(state.turn, 'ai', lot.id + ' 轮到输的人');
    ok(/被迫咬下毒格/.test(state.line), state.line);
    ok(state.youBites >= 1 && state.youBites >= state.aiBites, lot.id + ' 玩家先动，口数不少于对手');
    eq(state.plies, state.youBites + state.aiBites, lot.id + ' 步数守恒');
  }
});

test('对手的回答永远来自表：它把玩家交回来的每个局面都判成必胜', () => {
  for (const lot of LOTS) {
    let st = startMatch(lot);
    for (const m of legalBites(lot.shape)) {
      if (m[0] === 0 && m[1] === 0) continue;
      const played = playBite(map, st, m, 'you');
      if (played.rejected) continue;
      let after = played.state;
      if (after.status === 'playing') {
        const answered = aiTurn(map, after);
        eq(answered.rejected, null, `${lot.id} 对手必须答得出`);
        after = answered.state;
        // 玩家这一口不是胜口 -> 对手用表把它送回必败局（这就是"交给已证明必胜的对手"）。
        const winning = derive(lot).winningMoves.some((w) => w[0] === m[0] && w[1] === m[1]);
        if (!winning && after.status === 'playing') {
          eq(classifyNow(map, after).n, false, `${lot.id} 走 ${m} 之后玩家必须面对必败局`);
        }
        if (winning && after.status === 'playing') {
          // 对手在必败局里，它交回来的必然又是必胜局 —— 这正是"必败"的定义。
          eq(classifyNow(map, after).n, true, `${lot.id} 胜口之后对手回送的局面`);
        }
      }
    }
  }
});

test('点错一口就交给已证明必胜的对手：非胜口的首口一律输', () => {
  let wrongFirsts = 0;
  for (const lot of LOTS) {
    const winning = derive(lot).winningMoves;
    for (const m of legalBites(lot.shape)) {
      if (winning.some((w) => w[0] === m[0] && w[1] === m[1])) continue;
      wrongFirsts++;
      // 玩家之后每一步都按表的建议走（已经是必败局，建议只是最顽强的抵抗）。
      let st = playBite(map, startMatch(lot), m, 'you').state;
      let guard = 0;
      while (st.status === 'playing' && guard++ < 100) {
        const answered = aiTurn(map, st);
        st = answered.state;
        if (st.status !== 'playing') break;
        const hint = hintAt(map, st);
        ok(hint.winning === false, `${lot.id} 首口 ${m} 之后玩家已是必败`);
        const played = playBite(map, st, hint.move || legalBites(st.shape)[0], 'you');
        eq(played.rejected, null, `${lot.id} 必败局也得走得动`);
        st = played.state;
      }
      eq(st.status, 'lost', `${lot.id} 首口 ${m} 的结局`);
      eq(st.loser, 'you', `${lot.id} 首口 ${m} 的输家`);
      ok(guard < 100, '循环有上限');
    }
  }
  ok(wrongFirsts >= 40, '试过的错误首口数 ' + wrongFirsts);
});

test('AI 执先时每口都落在必败局集合里（关卡表逐条，不抽样）', () => {
  for (const lot of LOTS) {
    const m = aiTurn(map, { ...startMatch(lot), turn: 'ai' });
    eq(m.rejected, null, lot.id + ' 对手答得出');
    const shape = m.state.shape;
    if (isTerminal(shape)) continue; // 直接把玩家送到毒格：也是必胜着法
    eq(solvePosition(shape).n, false, `${lot.id} 对手的首口 ${JSON.stringify(m.state.history[0].move)} 应交出必败局`);
  }
});

test('终局判定：只剩毒格的那一刻就分出胜负，之后再点一律不计数', () => {
  const lot = LOTS[LOTS.length - 1];
  const { state } = perfectLine(map, lot);
  eq(state.status, 'won');
  eq(isTerminal(state.shape), true);
  const after = playBite(map, state, [0, 0], 'you');
  eq(after.rejected, '本局已结束');
  eq(after.state.status, 'won', '已经结束的比赛不会被动回来');
});

test('只剩毒格时主动咬毒就是认输（forced 分支，不静默）', () => {
  const forced = { ...startMatch(LOTS[0]), shape: [1], turn: 'you', status: 'playing' };
  const r = playBite(map, forced, [0, 0], 'you');
  eq(r.rejected, null, '这一步是被迫的，不算非法');
  eq(r.state.status, 'lost');
  eq(r.state.loser, 'you');
  ok(/只剩毒格/.test(r.state.line), r.state.line);
  const other = playBite(map, forced, [0, 0], 'ai');
  eq(other.rejected, '还没轮到对手');
});

// ---------------------------------------------------------------- hints & undo
test('提示只说真话：必胜局给胜口，必败局直说没救', () => {
  const lot = LOTS.find((l) => l.k >= 2) || LOTS[0];
  let st = startMatch(lot);
  const h = hintAt(map, st);
  eq(h.winning, true, lot.id);
  eq(h.k, lot.k, '提示数出来的胜口 == 卡面印的 k');
  ok(legalBites(st.shape).some((m) => m[0] === h.move[0] && m[1] === h.move[1]), '提示的口是合法的');
  const handed = playBite(map, st, h.move, 'you').state;
  if (handed.status === 'playing') eq(classifyNow(map, handed).n, false, '按提示走之后对手面对必败局');
  else eq(handed.status, 'won');
  // 按提示走之后对手在必败局里，它交回来的还是必胜局：玩家一路正确就一路有口。
  const answered = aiTurn(map, handed);
  if (answered.state.status === 'playing') {
    eq(classifyNow(map, answered.state).n, true, lot.id + ' 正确打法下玩家始终握有胜口');
  }
});

test('提示在必败局里直说没救：棋书里 36 个必败局面逐条不谎报', () => {
  const rows = decodeBook(BOOK);
  let checked = 0;
  for (const [key, hit] of rows) {
    if (hit.n) continue;
    const st = { ...startMatch(LOTS[0]), shape: hit.shape, turn: 'you', status: 'playing' };
    const h = hintAt(map, st);
    eq(h.winning, false, key);
    eq(h.k, 0, key);
    eq(h.move, null, key);
    ok(/必败/.test(h.line), key + ' ' + h.line);
    checked++;
  }
  eq(checked, BOOK_P, '全部必败局面');
});

test('提示对越出棋书的局面抛异常，而不是现场搜索', () => {
  const st = { ...startMatch(LOTS[0]), shape: [12, 12] };
  try {
    hintAt(map, st);
    fail('应抛');
  } catch (err) {
    ok(/不在棋书里/.test(err.message), err.message);
  }
});

test('撤销回到玩家上一口之前，历史与步数一起退', () => {
  const lot = LOTS[0];
  let st = startMatch(lot);
  const r = playerBite(map, st, [1, 3]);
  st = r.state;
  const plies = st.plies;
  ok(plies >= 2, '一口下去至少两步：' + plies);
  const back = undoRound(st);
  eq(back.rejected, null, '撤销不报错');
  eq(back.state.shape, lot.shape, '回到根局面');
  eq(back.state.plies, 0);
  eq(back.state.turn, 'you');
  eq(back.state.history, []);
  eq(back.state.snapshots, []);
  const none = undoRound(back.state);
  eq(none.rejected, '没有可撤销的着法');
});

test('撤销不改动被撤销的状态（纯函数）', () => {
  const st = playerBite(map, startMatch(LOTS[1]), derive(LOTS[1]).winningMoves[0]).state;
  const before = JSON.stringify(st);
  undoRound(st);
  eq(JSON.stringify(st), before, '原状态一个字没变');
});

test('playBite 不改入参：状态对象是新建的', () => {
  const st = startMatch(LOTS[2]);
  const before = JSON.stringify(st);
  playBite(map, st, derive(LOTS[2]).winningMoves[0], 'you');
  eq(JSON.stringify(st), before, 'state');
  eq(before.includes('"snapshots":[]'), true, '开局没有快照');
});

test('SEATS 与 aiTurn 的守卫', () => {
  eq(SEATS.you, '你');
  eq(SEATS.ai, '对手');
  const st = startMatch(LOTS[0]);
  eq(aiTurn(map, st).rejected, '不该对手走', '玩家的回合 AI 不能动');
  const ended = { ...st, status: 'won' };
  eq(aiTurn(map, ended).rejected, '不该对手走');
});

test('biteFootprint 与 applyBite 的差值一致（画面上咬掉的格数就是真的格数）', () => {
  for (const lot of LOTS.slice(0, 8)) {
    for (const m of legalBites(lot.shape)) {
      const st = startMatch(lot);
      eq(biteFootprint(st, m), area(st.shape) - area(applyBite(st.shape, m)), `${lot.id} ${m}`);
      ok(biteFootprint(st, m) >= 1, '每一口至少带走一格');
    }
  }
});

test('认证线路上的每个中间局面都在棋书里（浏览器点得到的，表就答得出）', () => {
  for (const lot of LOTS) {
    const { line } = perfectLine(map, lot);
    let st = startMatch(lot);
    for (const step of line) {
      eq(verifyLot(lot), [], lot.id);
      ok(step.move === null || legalBites(st.shape).some((m) => m[0] === step.move[0] && m[1] === step.move[1]), `${lot.id} 线路上的着法合法`);
      st = step.seat === 'you' ? playBite(map, st, step.move, 'you').state : aiTurn(map, st).state;
      classifyNow(map, st); // 会抛就说明越界
    }
    ok(st.status !== 'playing', lot.id + ' 线路走完必须分出胜负');
  }
});

run();
