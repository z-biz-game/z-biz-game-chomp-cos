// The match. A pure state machine over positions: it knows the rules, whose turn it is, and
// when somebody is forced onto the poison. It does NOT draw anything and does NOT decide
// legality of pixels — that is js/view.js — and it does not search: every answer the opponent
// gives comes from the book passed in as `map` (see js/core/book.js).
//
// Terminal convention, stated once here because the win/loss claims depend on it:
//   a position is [1] exactly when the only square left is the poisoned one. The player to move
//   then has no legal bite, and biting the poison is losing by definition, so the match ENDS
//   the moment [1] is handed over: the mover who produced it wins, the receiver loses. This is
//   Chomp's own rule ("whoever is forced to take the poison loses") rather than a shortcut, and
//   test/game.test.mjs checks it against the classification printed on the lot card.
//
// Because the player always sits 先手 and every shipped lot is an N-position, "won" means
// "found one of the k winning first bites and never erred again" — a property of the table, not
// of luck.

import { area, encodeShape, isTerminal, legalBites, applyBite, biteReason, validateShape } from './shapes.js';
import { bookMove, lookup, winningBitesOf } from './book.js';

export const SEATS = { you: '你', ai: '对手' };

export function startMatch(lot) {
  const err = validateShape(lot.shape);
  if (err) throw new Error('startMatch: ' + err);
  return {
    lotId: lot.id,
    tier: lot.tier,
    root: lot.shape.slice(),
    shape: lot.shape.slice(),
    turn: 'you',
    plies: 0,
    youBites: 0,
    aiBites: 0,
    history: [],
    line: '你先咬。这一局的必胜首口有 ' + (lot.k ?? null) + ' 个。',
    status: 'playing', // playing | won | lost
    loser: null,
    snapshots: [],
  };
}

function snapshot(st) {
  return {
    shape: st.shape.slice(),
    turn: st.turn,
    plies: st.plies,
    youBites: st.youBites,
    aiBites: st.aiBites,
    status: st.status,
    loser: st.loser,
  };
}
// Number of squares a bite removes from the CURRENT bar (the view shades exactly this).
export function biteFootprint(st, m) {
  const next = applyBite(st.shape, m);
  return area(st.shape) - area(next);
}

export function classifyNow(map, st) {
  const hit = lookup(map, st.shape);
  return {
    shape: encodeShape(st.shape),
    n: hit.n,
    forSeat: SEATS[st.turn],
    verdict: hit.n ? '必胜' : '必败',
    // Who wins if BOTH sides keep playing the table from here.
    winner: hit.n ? (st.turn === 'you' ? '你' : '对手') : (st.turn === 'you' ? '对手' : '你'),
  };
}

// Apply one bite by a seat. Returns { state, rejected } — `rejected` carries the reason the
// rules gave (poison / already-empty / off-bar / over), and the state is untouched in that case,
// which is what "非法点击不计数" means concretely for the tests.
export function playBite(map, state, m, seat) {
  if (state.status !== 'playing') return { state: speak(state, '本局已结束，这一口不算'), rejected: '本局已结束' };
  const who = seat || state.turn;
  if (who !== state.turn) {
    return { state: speak(state, `还没轮到${SEATS[who]}：现在是${SEATS[state.turn]}的口`), rejected: '还没轮到' + SEATS[who] };
  }
  const forced = isTerminal(state.shape);
  const reason = biteReason(state.shape, m, { poisonless: false });
  if (reason) {
    // The bare poisoned square is the one case where "click the poison" is what actually loses:
    // there is nothing else to bite. Report it as the forced finish rather than as a no-op.
    if (forced && Array.isArray(m) && m[0] === 0 && m[1] === 0) {
      return finish({ ...state, line: '只剩毒格：咬下去就是输' }, who);
    }
    return { state: { ...state, line: '不能这样咬：' + reason }, rejected: reason };
  }
  const prev = snapshot(state);
  const next = applyBite(state.shape, m);
  const st = {
    ...state,
    shape: next,
    snapshots: state.snapshots.concat([prev]),
    plies: state.plies + 1,
    youBites: state.youBites + (who === 'you' ? 1 : 0),
    aiBites: state.aiBites + (who === 'ai' ? 1 : 0),
    history: state.history.concat([{ seat: who, move: [m[0], m[1]], shape: encodeShape(state.shape), left: area(next) }]),
  };
  if (isTerminal(next)) return finish(st, who === 'you' ? 'ai' : 'you');
  st.turn = who === 'you' ? 'ai' : 'you';
  st.line = `${SEATS[who]}咬了 ${m[0] + 1} 行 ${m[1] + 1} 列，剩 ${area(next)} 格`;
  return { state: st, rejected: null };
}

// Every refusal says why: the shell prints `line` and a silent no-op is indistinguishable from
// a dropped click on screen.
function speak(state, line) {
  return { ...state, line };
}

function finish(st, loserSeat) {
  return {
    state: {
      ...st,
      status: loserSeat === 'you' ? 'lost' : 'won',
      loser: loserSeat,
      turn: loserSeat,
      line: `只剩毒格：${SEATS[loserSeat]}被迫咬下毒格`,
    },
    rejected: null,
  };
}

// The opponent's turn, entirely from the book: one map lookup plus (at most) one legality
// re-check. No search, ever.
export function aiTurn(map, state) {
  if (state.status !== 'playing' || state.turn !== 'ai') return { state, rejected: '不该对手走' };
  const m = bookMove(map, state.shape);
  if (!m) return finish(state, 'ai');
  return playBite(map, state, m, 'ai');
}

// The player's bite followed by the opponent's answer, as one gesture for the shell.
export function playerBite(map, state, m) {
  const first = playBite(map, state, m, 'you');
  if (first.rejected || first.state.status !== 'playing') return first;
  return aiTurn(map, first.state);
}

// The hint: the table's own move for the position the player is in. If the position is a loss
// the honest answer is that there is no winning bite — the hint says so instead of inventing a
// plausibly-looking square.
export function hintAt(map, state) {
  const hit = lookup(map, state.shape);
  if (!hit.n) return { winning: false, move: null, k: 0, line: '这一步已经必败：对手有解，随便咬只是拖延' };
  const winning = winningBitesOf(map, state.shape);
  return {
    winning: true,
    move: winning[0] ? [winning[0][0], winning[0][1]] : null,
    k: winning.length,
    line: `必胜口 ${winning.length} 个，例如第 ${winning[0][0] + 1} 行第 ${winning[0][1] + 1} 列`,
  };
}

// Step back to the position before the player's most recent bite — i.e. undo one full round
// (your bite and the answer it drew). `snapshots` holds one entry per move taken, recording the
// state BEFORE it, so the last entry with turn 'you' is exactly "before your last bite".
// Pure: it returns a new state and never touches the one it was given.
export function undoRound(state) {
  const snaps = state.snapshots;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].turn !== 'you') continue;
    const t = snaps[i];
    return {
      state: {
        ...state,
        shape: t.shape.slice(),
        turn: 'you',
        plies: t.plies,
        youBites: t.youBites,
        aiBites: t.aiBites,
        snapshots: snaps.slice(0, i),
        history: state.history.slice(0, i),
        status: 'playing',
        loser: null,
        line: `撤销回你第 ${t.youBites + 1} 口之前：剩 ${area(t.shape)} 格`,
      },
      rejected: null,
    };
  }
  return { state, rejected: '没有可撤销的着法' };
}

// Replay the whole match with the table on both seats: the player answers the root with one of
// its k winning bites, the opponent answers with `bookMove`. For an N-position root this line
// must end with the opponent forced onto the poison — the certified line the browser suite and
// test/game.test.mjs both walk to the end.
export function perfectLine(map, lot) {
  let st = startMatch(lot);
  const line = [];
  let guard = 0;
  while (st.status === 'playing' && guard++ < 200) {
    if (st.turn !== 'you') throw new Error('perfectLine: 轮到对手却停在玩家手上');
    const winning = winningBitesOf(map, st.shape);
    if (!winning.length) break; // the mover is already lost: the table refuses to pretend
    const r = playBite(map, st, winning[0], 'you');
    if (r.rejected) throw new Error('perfectLine: ' + r.rejected);
    line.push({ seat: 'you', move: winning[0], left: area(r.state.shape) });
    st = r.state;
    if (st.status !== 'playing') break;
    const a = aiTurn(map, st);
    if (a.rejected) throw new Error('perfectLine: ' + a.rejected);
    line.push({ seat: 'ai', move: bookMove(map, st.shape), left: area(a.state.shape) });
    st = a.state;
  }
  return { state: st, line, plies: st.plies };
}
