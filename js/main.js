// The shell: DOM, router, save file, and the `window.chomp` hook the browser suite drives.
// It owns no game theory. Every verdict it prints comes from js/core/book.js (a table lookup)
// and every legality answer from js/core/game.js. If a number appears here that is not in
// those two files, it was not measured.

import { area, encodeShape, isTerminal, legalBites } from './core/shapes.js';
import { bookMap, dailyLot, derive, lotById, lots, poolStats, randomLot, tierKeys, verifyPool } from './core/library.js';
import { classifyNow, hintAt, playBite, startMatch, undoRound, aiTurn } from './core/game.js';
import { BOOK } from './data/lots.js';
import { buildTable, solvePosition, solveUniverse } from './core/solve.js';
import { countOutcomes, encodeBook } from './core/book.js';
import { persistent, store } from './core/storage.js';
import { todayKey } from './core/rng.js';
import { advance as advanceAnim, createAnim, emitBite, rejectKick, resetTransient, setReducedMotion, snapshot } from './core/anim.js';
import { audioState, isMuted, resumeContext, setMuted as setAudioMuted, sfx, suspendContext, unlockAudio } from './core/audio.js';
import { installWhenReady } from './pwa.js';
import { createView } from './view.js';

const VERSION = 2;
const el = {};
for (const id of ['board', 'hintline', 'curtain', 'stars', 'verdict', 'tally', 'again', 'next', 'crumbs', 'readout', 'hint', 'undo', 'restart', 'share', 'modes', 'totals', 'proof', 'proofcount', 'proofmore', 'wipe', 'toast', 'help', 'pause', 'mute', 'fullscreen', 'tutorial', 'tut-close', 'pausecard', 'pausesim', 'resume', 'pauserestart']) {
  el[id] = document.getElementById(id);
}

const map = bookMap();

// One animation world, shared by the view's rAF loop and every harness: `view.setAnim(anim)`
// below hands the same object over, so nobody is ever integrating a private copy.
const anim = createAnim({ seed: 20260930, reducedMotion: false });

const game = {
  lot: null,
  match: null,
  preview: null,
  dragging: false,
  hints: 0,
  mode: 'campaign',
  index: 1,
  paused: false,
  cursor: null,   // keyboard anchor: {r, c}, moved by the arrows and committed by Enter
};

let pwaStatus = { registered: false, reason: '注册尚未返回' };

// ------------------------------------------------------------------ routing
function routeTo(hash) {
  const h = String(hash || '').replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'daily') return dailyLot(todayKey());
  if (parts[0] === 'lot' && parts[1]) return lotById(parts[1]) || null;
  if (parts[0] === 'c') {
    const n = Number(parts[1]);
    const idx = !Number.isFinite(n) ? 1 : Math.max(1, Math.min(lots.length, Math.floor(n)));
    game.index = idx;
    return lots[idx - 1];
  }
  if (parts[0] === 'random') {
    const tier = tierKeys.includes(parts[1]) ? parts[1] : undefined;
    const seed = parts[2] || todayKey();
    const lot = randomLot(seed, tier);
    if (!parts[2]) location.hash = `#/random/${lot.tier}/${seed}`;
    return lot;
  }
  return null;
}

function load(hash, { push = true } = {}) {
  let lot = routeTo(hash);
  if (!lot) {
    // An unknown lot id / empty route falls back to the campaign rather than blanking the board.
    game.index = 1;
    lot = lots[0];
    if (push) location.hash = '#/c/1';
  }
  game.lot = lot;
  game.mode = lot.mode || 'campaign';
  if (game.mode === 'campaign') {
    const i = lots.findIndex((l) => l.id === lot.id);
    if (i >= 0) game.index = i + 1;
  }
  game.match = startMatch(lot);
  game.preview = null;
  game.hints = 0;
  game.settled = false;
  game.cursor = null;
  resetTransient(anim); // a new lot must not inherit the old one's crumbs or its half-frame debt
  // ONE exhaustive solve per lot, at load, for the proof drawer. A click re-reads `game.proof`;
  // it never re-solves (the contract's ban on search behind a tap is about this line).
  game.proof = solvePosition(lot.shape);
  view.layout();
  render();
  return game.lot;
}

// ------------------------------------------------------------------ rendering
function pct(v) {
  return (v * 100).toFixed(1) + '%';
}

function readout() {
  const lot = game.lot;
  const st = game.match;
  const cls = classifyNow(map, st);
  const rows = [
    ['局面', encodeShape(st.shape) + '（根 ' + encodeShape(lot.shape) + '）'],
    ['当前判定', `${cls.verdict} · 对${cls.forSeat}`, cls.n ? 'win' : 'lose'],
    ['开局证明', `${lot.winner}必胜 · 首口 ${lot.k} 个`, 'poison'],
    ['随机一口赢率', pct(lot.chance)],
    ['局面数（本关表）', String(lot.states)],
    ['棋书覆盖', `${BOOK.states} 个局面 / ${BOOK.p} 个必败`],
    ['已用口数', `${st.plies}（你 ${st.youBites} · 对手 ${st.aiBites}）`],
    ['提示', String(game.hints)],
  ];
  el.readout.innerHTML = rows.map(([k, v, c]) => `<dt>${k}</dt><dd${c ? ` class="${c}"` : ''}>${v}</dd>`).join('');
  el.proofcount.textContent = `(${lot.states})`;
  const fresh = game.proof || solvePosition(lot.shape);
  const proof = [
    `这一关的可达集共 <code>${fresh.states}</code> 个局面，<code>js/core/solve.js</code> 穷举 + 记忆化 minimax 全部判完`,
    `判定：<b>${fresh.winner}</b>（${fresh.n ? 'N，轮到的人能赢' : 'P，轮到的人必败'}）`,
    `必胜首口 <b>${fresh.k}</b> 个：<code>${fresh.winningMoves.map((m) => `${m[0] + 1}行${m[1] + 1}列`).join('、') || '无'}</code>`,
    `棋书（宇宙 ${BOOK.states} 个局面）对同一个形状的判定：<b>${derive(lot).winner}</b>，胜口 <b>${derive(lot).k}</b> 个`,
    `两行情形的公开刻画：必败局恰好是阶梯 <code>(k, k-1)</code> —— 本关形状 ${encodeShape(lot.shape)} 落在这条线${lot.shape.length === 2 && lot.shape[0] === lot.shape[1] + 1 ? '上' : '外'}`,
  ];
  el.proof.innerHTML = proof.map((p) => `<li>${p}</li>`).join('');
  el.proofmore.textContent = `复现：node tools/bake.mjs 重烘并重验；npm run unit 复算这些数。`;
}

function totals() {
  const t = store.totals();
  const s = poolStats();
  el.totals.textContent = `通关 ${t.solved}/${s.lots} · 胜 ${t.wins} 负 ${t.losses} · 棋书 ${s.states} 局面`;
}

function render() {
  const lot = game.lot;
  const st = game.match;
  el.crumbs.innerHTML = `${lot.mode === 'daily' ? lot.label : lot.mode === 'random' ? `随机 · ${lot.tier}` : `第 ${game.index} 关 · ${lot.tier}`} · <b>${encodeShape(lot.shape)}</b>` +
    ` <span title="baked">（烘焙 ${String(BOOK.states)} 局面）</span>`;
  el.hintline.textContent = st.line;
  readout();
  view.layout();
  view.draw();
  paintCard();
  for (const b of el.modes.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === (lot.mode === 'random' ? 'random' : lot.mode === 'daily' ? 'daily' : 'campaign')));
  }
  totals();
  el.undo.disabled = st.snapshots.length === 0 || st.status !== 'playing';
  el.hint.disabled = st.status !== 'playing';
}

function paintCard() {
  const st = game.match;
  const lot = game.lot;
  const over = st.status !== 'playing';
  el.curtain.hidden = !over;
  el.next.hidden = (lot.mode || 'campaign') !== 'campaign' || !over;
  if (!over) return;
  const won = st.status === 'won';
  el.verdict.textContent = won ? '对手被迫咬下毒格' : '你被迫咬下毒格';
  const par = Math.max(1, Math.ceil(Math.log2(lot.cells)));
  el.stars.textContent = won ? (st.youBites <= par ? '★★★' : st.youBites <= par + 1 ? '★★☆' : '★☆☆') : '☆☆☆';
  el.tally.innerHTML = won
    ? `这一关的证明是 <b>${lot.winner}</b>必胜、首口 <b>${lot.k}</b> 个；你用了 <b>${st.youBites}</b> 口（对手 ${st.aiBites} 口）吃完它。局面数 <b>${lot.states}</b> 个，全部判过。`
    : `对手查的是同一张表：它把 ${encodeShape(lot.shape)} 判成 <b>${lot.winner}</b>必胜，而你交出去的那一口不在 <b>${lot.k}</b> 个必胜首口里。`;
}

// ------------------------------------------------------------------ input
// A bite is one anchor square; the removed region is the whole quadrant below-and-right of it,
// which is exactly what the preview shades. Press, drag, release: the anchor follows the finger
// and clamps to the bar, so a drag that runs off the edge still commits the boundary square.
// One gesture -> one bite. `playBite` refuses illegal anchors and returns the SAME state with a
// spoken reason, so a rejected click never bills a ply.
function commit(anchor) {
  if (game.paused) return { rejected: '已暂停', plies: game.match.plies, paused: true };
  const before = game.match;
  const res = playBite(map, before, [anchor.r, anchor.c], 'you');
  game.preview = null;
  game.match = res.state;
  if (res.rejected) {
    el.hintline.textContent = res.state.line;
    flash(res.rejected);
    rejectKick(anim);
    sfx('refuse');
    view.invalidate();
    view.draw();
    totals();
    return { rejected: res.rejected, plies: res.state.plies };
  }
  const gone = view.goneSquares(before.shape, anchor.r, anchor.c);
  game.match = { ...game.match, lastBite: { seat: 'you', move: [anchor.r, anchor.c], gone } };
  // The crumbs come out of the same footprint the rules just billed, so the particle count is
  // evidence about the move rather than decoration laid on top of it.
  emitBite(anim, gone, view.squareRect, { strength: 1 });
  sfx('bite');
  afterMove();
  return { rejected: null, plies: game.match.plies };
}

function afterMove() {
  const st = game.match;
  if (st.status === 'playing' && st.turn === 'ai') {
    // The opponent's answer is ONE map read (js/core/book.js) — nothing searches here.
    const before = st.shape;
    const move = aiTurn(map, st);
    const answered = move.state;
    const last = answered.history[answered.history.length - 1];
    game.match = {
      ...answered,
      lastBite: last && last.seat === 'ai'
        ? { seat: 'ai', move: last.move, gone: view.goneSquares(before, last.move[0], last.move[1]) }
        : game.match.lastBite,
    };
  }
  if (game.match.status !== 'playing') settle();
  render();
}

function settle() {
  if (game.settled) return; // one match writes the save exactly once
  game.settled = true;
  const st = game.match;
  const lot = game.lot;
  const won = st.status === 'won';
  store.finish(lot.id, { won, plies: st.plies, hints: game.hints });
  if (won) {
    const i = lots.findIndex((l) => l.id === lot.id);
    if (i >= 0) store.unlock(i + 2);
  }
  if (lot.mode === 'daily') store.markDaily(lot.day, lot.id, { won });
  sfx(won ? 'win' : 'lose');
}

let toastTimer = 0;
function flash(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1600);
}

function onPointerDown(ev) {
  if (game.paused) return; // a paused board takes no bites at all — see setPaused()
  if (game.match.status !== 'playing') return;
  unlockAudio(); // the gesture is the only chance to open the context; it is silent until a voice needs it
  const hit = view.pointAt(ev.clientX, ev.clientY);
  if (!hit) return; // dead canvas space: not a control at all, so nothing is even attempted
  const shape = game.match.shape;
  const alive = hit.r < shape.length && hit.c < shape[hit.r];
  if (!alive) {
    // Pressing the poison square or an already-bitten one is refused out loud and bills nothing
    // (js/core/game.js gives the reason). Do NOT start a drag from it: a refused tap must not
    // turn into a bite just because the finger happened to move.
    commit(hit);
    return;
  }
  game.dragging = true;
  game.preview = { r: hit.r, c: hit.c };
  view.draw();
  if (ev.pointerId !== undefined && typeof el.board.setPointerCapture === 'function') el.board.setPointerCapture(ev.pointerId);
}

function onPointerMove(ev) {
  if (!game.dragging || game.match.status !== 'playing') return;
  const hit = view.pointAt(ev.clientX, ev.clientY);
  if (!hit) return; // still dragging: keep the last legal anchor rather than dropping the gesture
  game.preview = view.clampToBar(ev.clientX, ev.clientY);
  view.draw();
}

function onPointerUp(ev) {
  if (!game.dragging) return;
  game.dragging = false;
  const anchor = game.preview || view.clampToBar(ev.clientX, ev.clientY);
  commit(anchor);
}

// The view is built before the first `load()`, and `resize()` measures and paints immediately,
// so the accessor has to answer with the campaign's opening bar rather than crash on a null
// match. That is boot order, not a game rule: `load()` overwrites both fields a few lines later.
const bootLot = lots[0];
if (!game.lot) { game.lot = bootLot; game.match = startMatch(bootLot); game.proof = null; }

const view = createView(el.board, () => ({
  shape: game.match.shape,
  root: game.match.root,
  preview: game.preview,
  lastBite: game.match.lastBite || null,
  status: game.match.status,
}));

el.board.addEventListener('pointerdown', onPointerDown);
el.board.addEventListener('pointermove', onPointerMove);
el.board.addEventListener('pointerup', onPointerUp);
el.board.addEventListener('pointercancel', () => { game.dragging = false; game.preview = null; view.draw(); });
window.addEventListener('resize', () => view.resize());

view.setAnim(anim);
view.start();

// ------------------------------------------------------------------ system controls
// Pause is a gate on the simulation, not a dimming layer: with it on, `advance()` is never
// called, so the crumb field freezes mid-air and the poison stops breathing. The step count the
// card prints is the proof — it is the same number before and after the pause.
function setPaused(on) {
  game.paused = !!on;
  view.setPaused(game.paused);
  el.pause.setAttribute('aria-pressed', String(game.paused));
  el.pause.textContent = game.paused ? '继续' : '暂停';
  el.pausecard.hidden = !game.paused;
  if (game.paused) {
    el.pausesim.textContent = String(anim.simSteps);
    // Audio in a paused game is a bug, not an ambience: the context itself is parked.
    if (!isMuted()) suspendContext();
  } else if (!isMuted()) {
    resumeContext();
  }
  render();
  return game.paused;
}

el.pause.addEventListener('click', () => { unlockAudio(); setPaused(!game.paused); sfx('ui'); });
el.resume.addEventListener('click', () => setPaused(false));
el.pauserestart.addEventListener('click', () => { setPaused(false); el.restart.click(); });

// Mute goes through js/core/audio.js, which suspends the AudioContext and refuses to build a
// single oscillator while it is on. The label and `aria-pressed` both move, so the state is
// readable without opening the console.
function applyMute(on, { persist = true } = {}) {
  setAudioMuted(on);
  if (persist) store.setMuted(on);
  el.mute.setAttribute('aria-pressed', String(!!on));
  el.mute.textContent = on ? '音效 关' : '音效 开';
  return on;
}

function toggleMute() {
  unlockAudio();
  const next = !isMuted();
  applyMute(next);
  if (!next) sfx('ui'); // unmuting answers with one click so the player knows it came back
  return next;
}

el.mute.addEventListener('click', toggleMute);

// Fullscreen on the document element — the id it is bound to (#fullscreen) exists in index.html,
// which is the failure mode this line is written against.
function toggleFullscreen() {
  const root = document.documentElement;
  const active = !!document.fullscreenElement;
  if (!active && typeof root.requestFullscreen === 'function') {
    root.requestFullscreen({ navigationUI: 'hide' }).then(
      () => setFullscreenPressed(true),
      () => flash('这个浏览器不允许全屏'),
    );
    return true;
  }
  if (active && typeof document.exitFullscreen === 'function') {
    document.exitFullscreen().then(() => setFullscreenPressed(false), () => {});
  }
  return false;
}

function setFullscreenPressed(on) {
  el.fullscreen.setAttribute('aria-pressed', String(!!on));
  el.fullscreen.textContent = on ? '退出全屏' : '全屏';
}

el.fullscreen.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => setFullscreenPressed(!!document.fullscreenElement));

// The tutorial: openable at any time with H or ?, and shown once per device because the save
// file remembers. A player who has already bitten something never gets it pushed at them again.
function openTutorial(on) {
  el.tutorial.hidden = !on;
  if (on) {
    el['tut-close'].focus();
    setPaused(true); // the board waits while the rules are on screen
  } else {
    store.markTutorialSeen();
    if (game.paused) setPaused(false);
  }
  return on;
}

el.help.addEventListener('click', () => openTutorial(el.tutorial.hidden));
el['tut-close'].addEventListener('click', () => openTutorial(false));
el.tutorial.addEventListener('click', (ev) => { if (ev.target === el.tutorial) openTutorial(false); });

// ------------------------------------------------------------------ reduced motion
// Two inputs, one answer: the OS preference is the default and the save file can override it
// (some players want the crumbs, some players get motion sick on a train). The branch is not
// cosmetic — it stops particles from ever being spawned and freezes the pulse, see anim.js.
const motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

function motionWanted() {
  const override = store.settings.motionOverride;
  if (override === 'reduce') return true;
  if (override === 'full') return false;
  return !!(motionQuery && motionQuery.matches);
}

function syncMotion() {
  const on = motionWanted();
  setReducedMotion(anim, on);
  view.setReducedMotion(on);
  return on;
}

if (motionQuery) {
  const onChange = () => { syncMotion(); render(); };
  if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onChange);
  else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(onChange);
}

el.hint.addEventListener('click', () => {
  const st = game.match;
  if (st.status !== 'playing') return;
  const h = hintAt(map, st);
  game.hints += 1;
  store.hint(game.lot.id);
  if (h.winning) {
    game.preview = { r: h.move[0], c: h.move[1] };
    flash(`第 ${h.move[0] + 1} 行第 ${h.move[1] + 1} 列（必胜口 ${h.k} 个）`);
  } else {
    game.preview = null;
    flash('这个局面已经没有胜口');
  }
  el.hintline.textContent = h.line;
  render();
});

el.undo.addEventListener('click', () => {
  const r = undoRound(game.match);
  if (r.rejected) { flash(r.rejected); return; }
  game.match = { ...r.state, lastBite: null };
  game.preview = null;
  render();
});

el.restart.addEventListener('click', () => {
  const cleared = resetTransient(anim);
  game.match = startMatch(game.lot);
  game.preview = null;
  game.cursor = null;
  game.hints = 0;
  game.settled = false;
  flash(`重开：清掉 ${cleared.particles} 粒碎屑、抖动 ${cleared.shake.toFixed(1)}px、累加器 ${(cleared.accumulator * 1000).toFixed(1)}ms`);
  render();
});

el.again.addEventListener('click', () => el.restart.click());
el.next.addEventListener('click', () => {
  location.hash = '#/c/' + Math.min(lots.length, game.index + 1);
});
el.wipe.addEventListener('click', () => {
  if (el.wipe.dataset.armed !== '1') {
    el.wipe.dataset.armed = '1';
    el.wipe.textContent = '再点一次确认清空';
    setTimeout(() => { el.wipe.dataset.armed = ''; el.wipe.textContent = '清空存档'; }, 4000);
    return;
  }
  store.reset();
  el.wipe.dataset.armed = '';
  el.wipe.textContent = '清空存档';
  flash('存档已清空');
  render();
});
el.share.addEventListener('click', async () => {
  const url = location.href.split('#')[0] + '#/' + (game.lot.mode === 'campaign' ? `lot/${game.lot.id}` : game.lot.mode === 'daily' ? 'daily' : `random/${game.lot.tier}/${game.lot.sourceId}`);
  try {
    await navigator.clipboard.writeText(url);
    flash('链接已复制');
  } catch {
    flash(url);
  }
});
for (const b of el.modes.querySelectorAll('button')) {
  b.addEventListener('click', () => {
    const m = b.dataset.mode;
    location.hash = m === 'daily' ? '#/daily' : m === 'random' ? `#/random/${tierKeys[0]}/${todayKey()}` : '#/c/1';
  });
}
window.addEventListener('hashchange', () => load(location.hash, { push: false }));

// ------------------------------------------------------------------ keyboard
// The cursor is a real anchor, not a decoration: it is clamped to squares the rules still allow
// and it feeds the same `commit()` a finger does, so every legality and every refusal reason a
// pointer gets, the keyboard gets. The preview highlight is reused to show it.
function ensureCursor() {
  const shape = game.match.shape;
  const legal = (r, c) => r >= 0 && c >= 0 && r < shape.length && c < shape[r] && !(r === 0 && c === 0);
  if (game.cursor && legal(game.cursor.r, game.cursor.c)) {
    game.preview = { ...game.cursor };
    return game.cursor;
  }
  for (const [r, c] of legalBites(shape)) {
    game.cursor = { r, c };
    game.preview = { r, c };
    view.invalidate();
    view.draw();
    return game.cursor;
  }
  game.cursor = null;
  return null; // no legal bite left: the board is finished, and Enter will be refused out loud
}

function stepCursor(dr, dc) {
  const shape = game.match.shape;
  const cur = game.cursor || { r: 0, c: 1 };
  let r = cur.r, c = cur.c;
  for (let i = 0; i < 64; i++) {
    r += dr; c += dc;
    if (r < 0 || c < 0 || r >= shape.length || c >= shape[r]) { r -= dr; c -= dc; break; }
  }
  if (r === 0 && c === 0) c = shape[0] > 1 ? 1 : 0; // the cursor never parks on the poison
  if (r >= shape.length || c >= (shape[r] || 0)) { r = 0; c = (shape[0] || 1) > 1 ? 1 : 0; }
  game.cursor = { r, c };
  game.preview = { r, c };
  view.invalidate();
  view.draw();
  return game.cursor;
}

function onKeyDown(ev) {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key;
  const onButton = ev.target && ev.target.tagName === 'BUTTON';
  // A focused button already answers Space/Enter with its own click; firing the board action too
  // would bite twice from one press.
  if (onButton && (k === ' ' || k === 'Spacebar' || k === 'Enter')) return;
  switch (k) {
    case 'ArrowUp': stepCursor(-1, 0); ev.preventDefault(); break;
    case 'ArrowDown': stepCursor(1, 0); ev.preventDefault(); break;
    case 'ArrowLeft': stepCursor(0, -1); ev.preventDefault(); break;
    case 'ArrowRight': stepCursor(0, 1); ev.preventDefault(); break;
    case 'Enter':
    case ' ':
    case 'Spacebar': {
      if (!el.tutorial.hidden) { openTutorial(false); break; }
      const anchor = ensureCursor();
      commit(anchor ? { ...anchor } : { r: 0, c: 0 });
      ev.preventDefault();
      break;
    }
    case 'p': case 'P': setPaused(!game.paused); break;
    case 'r': case 'R': el.restart.click(); break;
    case 'm': case 'M': toggleMute(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'h': case 'H': case '?': openTutorial(el.tutorial.hidden); break;
    case 'u': case 'U': el.undo.click(); break;
    case 'Escape':
      if (!el.tutorial.hidden) openTutorial(false);
      else if (game.paused) setPaused(false);
      break;
    default: break;
  }
}

window.addEventListener('keydown', onKeyDown);

// ------------------------------------------------------------------ boot
// Three states come back from the save file before the first paint: the mute switch, the motion
// preference, and whether this device has ever been shown the rules.
applyMute(store.settings.muted, { persist: false });
syncMotion();
if (!store.settings.seenTutorial) openTutorial(true);
installWhenReady().then((r) => { pwaStatus = r; });

// ------------------------------------------------------------------ test hook
window.chomp = {
  version: VERSION,
  get state() {
    const st = game.match;
    const cls = classifyNow(map, st);
    return {
      id: game.lot.id,
      mode: game.lot.mode || 'campaign',
      tier: game.lot.tier,
      label: game.lot.label || game.lot.id,
      day: game.lot.day || null,
      index: game.index,
      shape: st.shape.slice(),
      shapeKey: encodeShape(st.shape),
      root: st.root.slice(),
      turn: st.turn,
      status: st.status,
      won: st.status === 'won',
      done: st.status !== 'playing',
      plies: st.plies,
      youBites: st.youBites,
      aiBites: st.aiBites,
      hints: game.hints,
      line: st.line,
      k: game.lot.k,
      winner: game.lot.winner,
      states: game.lot.states,
      chance: game.lot.chance,
      cells: area(st.shape),
      preview: game.preview ? { ...game.preview } : null,
      verdict: cls.verdict,
      n: cls.n,
      persist: persistent(),
      lastBite: st.lastBite || null,
      paused: game.paused,
      cursor: game.cursor ? { ...game.cursor } : null,
      muted: isMuted(),
      reducedMotion: !!anim.reducedMotion,
      anim: snapshot(anim),
      audio: audioState(),
      sprites: view.spriteReport(),
      pwa: pwaStatus,
    };
  },
  setPaused,
  toggleMute,
  openTutorial,
  syncMotion,
  anim,
  // Drive the simulation by hand: the frame-rate harness feeds 30/60/120 Hz through exactly this
  // line, so what it measures is the same code path the rAF loop runs.
  advance: (elapsed) => ({ steps: advanceAnim(anim, elapsed), state: snapshot(anim) }),
  pool: poolStats(),
  tiers: Object.keys(poolStats().byTier).map((key) => ({ key, lots: poolStats().byTier[key] })),
  book: { states: BOOK.states, p: BOOK.p, n: BOOK.n, bound: BOOK.bound },
  store,
  view,
  load,
  lot: () => ({ ...game.lot }),
  legal: () => legalBites(game.match.shape),
  isTerminal: () => isTerminal(game.match.shape),
  cellPoint: (r, c) => view.cellPoint(r, c),
  pointAt: (x, y) => view.pointAt(x, y),
  clampToBar: (x, y) => view.clampToBar(x, y),
  previewPoint: () => view.previewPoint(),
  // Programmatic gesture equivalents, for the DOM-less parts of a suite. The @pointer suite uses
  // real mouse events; these exist so a route can be settled without a canvas hit test.
  tap: (r, c) => commit({ r, c }),
  dragTo: (r, c) => { game.dragging = true; game.preview = { r, c }; view.draw(); },
  dragRelease: () => (game.preview ? commit(game.preview) : { rejected: '没有按住任何格子' }),
  hintMove: () => {
    const h = hintAt(map, game.match);
    return { winning: h.winning, move: h.move, k: h.k, line: h.line, exact: h.winning };
  },
  hintOnce: () => { el.hint.click(); return hintAt(map, game.match); },
  undo: () => { el.undo.click(); return game.match; },
  restart: () => { el.restart.click(); return game.match; },
  // Walk the certified line to the end through the same code path a click takes.
  autoWin: () => {
    game.match = startMatch(game.lot);
    game.settled = false;
    let guard = 0;
    while (game.match.status === 'playing' && guard++ < 60) {
      const h = hintAt(map, game.match);
      if (!h.winning) break;
      commit({ r: h.move[0], c: h.move[1] });
    }
    return { plies: game.match.plies, status: game.match.status, won: game.match.status === 'won', youBites: game.match.youBites };
  },
  // Audit the shipped file from inside the browser: re-solve the universe, re-encode the book,
  // and compare with what was served. Nothing here is cached from the build.
  recomputeBook: () => {
    const again = encodeBook(solveUniverse());
    return {
      same: JSON.stringify(again) === JSON.stringify(BOOK),
      rows: again.rows.length,
      shipped: BOOK.rows.length,
      p: again.p,
      n: again.n,
      decoded: countOutcomes(BOOK),
    };
  },
  verifyShipped: () => verifyPool(),
  solve: (key) => solvePosition(String(key).split('.').map(Number)),
  classify: (key) => classifyNow(map, { shape: String(key).split('.').map(Number), turn: 'you' }),
  tableOf: (key) => {
    const t = buildTable(String(key).split('.').map(Number));
    return { states: t.states, bites: t.bites };
  },
};

load(location.hash || '#/c/1', { push: false });
view.resize();
if (!location.hash) location.hash = '#/c/1';
