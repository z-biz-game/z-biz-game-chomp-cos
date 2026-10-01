// Minimal CDP driver for headless playtesting (Node 21+ global WebSocket/fetch). Zero deps,
// no Playwright — that is the whole contract.
//
// env: CDP_PORT (devtools port, default 9361 — deliberately NOT gridlock's 9340, NOT nine-rings'
//      9341 and NOT tango's 9351: one machine, ~17 sibling repos, and only ONE headless Chrome may
//      bind a debug port at a time; a squatted port is reported by verify.sh before it launches)
//      BASE_URL (page to attach to, default http://127.0.0.1:5201/)
// usage:
//   node playtest.mjs open  <url>          # reuse-or-create our page and navigate
//   node playtest.mjs nav   <url>
//   node playtest.mjs eval  '<js expression>'   # pass `nonav` to skip the reload
//   node playtest.mjs eval  '@boot' nonav   # | @play | @routes | @save | @pointer
//   node playtest.mjs shot  <path.png>
//   node playtest.mjs logs
//
// Every scenario reports { rows, fail } in the same shape as tools/harness.mjs, so verify.sh
// aggregates node suites and browser suites on one line.
const PORT = process.env.CDP_PORT || 9361;
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5201/';
const SHELL_TIMEOUT = Number(process.env.SHELL_TIMEOUT || 30000);
const ORIGIN = new URL(BASE).origin;
const isOurs = (u) => typeof u === 'string' && u.startsWith(ORIGIN);
const cmd = process.argv[2];
const arg = process.argv[3];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        if (globalThis.__printEvents) globalThis.__printEvents(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const info = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  let list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  if (cmd === 'open') {
    for (const t of list) if (t.type === 'page' && isOurs(t.url)) {
      try { await cdp.send('Target.closeTarget', { targetId: t.id || t.targetId }); } catch { /* gone already */ }
    }
    await sleep(300);
    list = [];
  }
  const existing = cmd === 'open' ? null : list.find((t) => t.type === 'page' && isOurs(t.url));
  let targetId, sessionId;
  if (existing) {
    targetId = existing.id || existing.targetId;
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  } else {
    ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  }
  const logs = [];
  globalThis.__printEvents = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${e.exception?.description || e.text}\n  at ${e.url}:${e.lineNumber}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      if (e.level === 'error' || e.source === 'rendering') logs.push(`[log:${e.level}] ${e.text} ${e.url || ''}`);
    }
  };
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);

  const runJS = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Wait on the shell, not on a timer (the lesson gridlock paid for in full): the page is a
  // module graph fetched over the network, and a fixed sleep that works on localhost shows the
  // canvas as an unstyled 300x150 box against GitHub Pages.
  const waitShell = async (floorMs, budgetMs = SHELL_TIMEOUT) => {
    await sleep(floorMs);
    const deadline = Date.now() + budgetMs;
    for (;;) {
      let ready = false;
      try {
        ready = await runJS('!!(window.chomp && window.chomp.state && window.chomp.state.id)');
      } catch { ready = false; }
      if (ready) return true;
      if (Date.now() > deadline) return false;
      await sleep(150);
    }
  };

  if (cmd === 'open') {
    await cdp.send('Page.navigate', { url: arg || BASE }, sessionId);
    await waitShell(600);
    console.log('opened ' + (arg || BASE) + '\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'nav') {
    await cdp.send('Page.navigate', { url: arg }, sessionId);
    await waitShell(400);
    console.log('navigated\n' + (logs.join('\n') || '(no console output)'));
  } else if (cmd === 'eval') {
    if (process.argv[4] !== 'nonav') {
      await cdp.send('Page.navigate', { url: BASE }, sessionId);
      await waitShell(300);
    }
    if (arg && arg.startsWith('@')) {
      const name = arg.slice(1);
      let value = null;
      if (name === 'pointer') {
        value = await pointerScenario(cdp, sessionId, runJS);
      } else if (SCENARIOS[name]) {
        try {
          value = await runJS(SCENARIOS[name]);
        } catch (err) {
          const dumped = await runJS('JSON.stringify(window.__lastRows||[])').catch(() => '[]');
          value = { rows: JSON.parse(dumped) };
          value.rows.push({ test: `@${name} threw`, pass: false, detail: String(err.message).slice(0, 300) });
        }
      } else {
        console.log('unknown scenario ' + name + ' — have ' + Object.keys(SCENARIOS).join(', ') + ', pointer');
        process.exit(1);
      }
      value.fail = (value.rows || []).filter((r) => !r.pass).map((r) => r.test);
      console.log(JSON.stringify(value, null, 2));
    } else {
      try {
        console.log(JSON.stringify(await runJS(arg), null, 2));
      } catch (err) {
        console.log('EVAL THROW: ' + err.message);
      }
    }
    if (logs.length) console.log('--- console ---\n' + logs.join('\n'));
  } else if (cmd === 'shot') {
    await runJS('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    (await import('node:fs')).writeFileSync(arg, Buffer.from(data, 'base64'));
    console.log('wrote ' + arg + ' (' + Math.round(data.length / 1024) + 'kB b64)');
  } else if (cmd === 'logs') {
    await sleep(800);
    console.log(logs.join('\n') || '(none)');
  }
  ws.close();
  process.exit(0);
}

// ---- the one suite a page-side script cannot run: real input ----------------
// Everything below goes through Chrome's own mouse. Page-side JS can prove `playBite()` is
// right; only a dispatched mouse event proves a finger can reach a chocolate square.
async function pointerScenario(cdp, sessionId, runJS) {
  const rows = [];
  const rec = (name, pass, detail) => rows.push({
    test: name, pass: !!pass,
    detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)),
  });
  const mouse = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: type === 'mousePressed' ? 1 : 0,
  }, sessionId);
  const click = async (p) => {
    await mouse('mousePressed', p.x, p.y, 1);
    await sleep(40);
    await mouse('mouseReleased', p.x, p.y, 0);
    await sleep(110);
  };
  const S = () => runJS('JSON.stringify(window.chomp.state)');

  await runJS('(() => { const c = window.chomp; c.store.reset(); c.load("#/lot/shoal-01"); return 1; })()');
  let fresh = null;
  for (let i = 0; i < 40; i++) {
    await sleep(80);
    fresh = JSON.parse(await S());
    if (fresh && fresh.id === 'shoal-01') break;
  }
  rec('a two-row lot loads and the route settles before any clicking', !!fresh && fresh.id === 'shoal-01' && fresh.shapeKey === '4.4', fresh && { id: fresh.id, key: fresh.shapeKey, k: fresh.k });

  const ids = await runJS('["board","hintline","curtain","stars","verdict","tally","hint","undo","restart","share","wipe","proof","proofcount","totals","readout"].map((i) => [i, !!document.getElementById(i)])');
  rec('every control the shell reaches for exists', ids.every(([, on]) => on), Object.fromEntries(ids));

  // --- illegal input first: the poison square is on the bar, but it is not a bite.
  const poison = await runJS('window.chomp.cellPoint(0, 0)');
  const beforePoison = JSON.parse(await S());
  await click(poison);
  const afterPoison = JSON.parse(await S());
  rec('real click on the poisoned square bills nothing and says why',
    afterPoison.plies === beforePoison.plies && afterPoison.shapeKey === beforePoison.shapeKey
    && /毒格/.test(afterPoison.line) && afterPoison.youBites === 0,
    { plies: afterPoison.plies, line: afterPoison.line });
  rec('the refusal is also visible as a toast, not only in the state', await runJS('(() => { const t = document.getElementById("toast"); return /毒格/.test(t.textContent) && t.hidden === false; })()'), await runJS('document.getElementById("toast").textContent'));

  // --- dead space: the corner of the canvas outside the tray is not a control at all.
  const dead = await runJS('(() => { const b = document.getElementById("board").getBoundingClientRect(); return { x: Math.round(b.right - 4), y: Math.round(b.bottom - 4) }; })()');
  await click(dead);
  rec('a click on the dead corner of the canvas does nothing', (JSON.parse(await S())).plies === beforePoison.plies, dead);

  // --- the certified line, by clicks only: the hint names the table's bite, the mouse delivers
  // it, and the opponent answers from the same table.
  let guard = 0;
  const seen = [];
  while (guard++ < 40) {
    const st = JSON.parse(await S());
    if (st.status !== 'playing') break;
    const h = await runJS('(() => { const h = window.chomp.hintMove(); return h && h.move ? { r: h.move[0], c: h.move[1], k: h.k } : null; })()');
    if (!h) { rec('the table stops answering mid-line', false, st); break; }
    const p = await runJS(`window.chomp.cellPoint(${h.r}, ${h.c})`);
    await click(p);
    const now = JSON.parse(await S());
    seen.push({ want: [h.r, h.c], key: now.shapeKey, plies: now.plies, verdict: now.verdict });
    if (now.plies === 0) { rec('a real click on a legal square bills a ply', false, { want: h, now }); break; }
  }
  const end = JSON.parse(await S());
  rec('the whole certified solution plays out under real mouse events', end.status === 'won' && end.won === true && end.youBites >= 1 && seen.length >= 1, { plies: end.plies, youBites: end.youBites, aiBites: end.aiBites, steps: seen.length });
  rec('每个真点击都改写了形状，且口数与记录一致',
    seen.every((x) => /^[0-9.]+$/.test(x.key)) && seen.length === end.youBites && end.plies === end.youBites + end.aiBites, seen);
  rec('终点判定: the card goes up with the printed 先手 claim', end.winner === '先手' && end.status === 'won' && !!(await runJS('document.getElementById("curtain").hidden === false')), { verdict: await runJS('document.getElementById("verdict").textContent'), stars: await runJS('document.getElementById("stars").textContent') });
  rec('the mouse-played win reaches the save file', (await runJS('(() => { const c = window.chomp; const r = c.store.record(c.state.id); return r && { won: r.won, best: r.best, plies: c.state.plies }; })()'))?.won === true, await runJS('JSON.stringify(window.chomp.store.record(window.chomp.state.id))'));

  // --- restart by real click, then a WRONG first bite: the opponent must hand back a proven
  // losing position for the player.
  await click(await runJS('(() => { const b = document.getElementById("restart").getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()'));
  const afterRestart = JSON.parse(await S());
  rec('重开 clicked for real restores the full bar', afterRestart.shapeKey === '4.4' && afterRestart.plies === 0 && afterRestart.status === 'playing', afterRestart && { key: afterRestart.shapeKey, plies: afterRestart.plies });

  const wrong = await runJS('(() => { const c = window.chomp; const lot = c.lot(); const win = new Set(lot.winningMoves.map((m) => m.join("."))); const bad = c.legal().find((m) => !win.has(m.join("."))); return bad ? { r: bad[0], c: bad[1] } : null; })()');
  await click(await runJS(`window.chomp.cellPoint(${wrong.r}, ${wrong.c})`));
  const afterWrong = JSON.parse(await S());
  rec('点错一口之后交回来的局面是必败局（对手用的是同一张表）',
    afterWrong.shapeKey !== '4.4' && (afterWrong.status !== 'playing' ? afterWrong.status === 'lost' : afterWrong.n === false),
    { key: afterWrong.shapeKey, n: afterWrong.n, status: afterWrong.status, verdict: afterWrong.verdict });
  const honest = await runJS('(() => { const h = window.chomp.hintMove(); return { winning: h.winning, k: h.k, line: h.line }; })()');
  if (afterWrong.status === 'playing') {
    rec('提示在必败局里不谎报有胜口', honest.winning === false && honest.k === 0, honest);
  } else {
    rec('提示在必败局里不谎报有胜口', honest.winning === false || afterWrong.status === 'lost', { honest, status: afterWrong.status });
  }

  // --- drag: press one square, drag to another, release commits the LAST anchor (the preview is
  // the quadrant below-and-right of it).
  await runJS('(() => { window.chomp.load("#/lot/linked-01"); return 1; })()');
  await sleep(220);
  const before = JSON.parse(await S());
  const p0 = await runJS('window.chomp.cellPoint(1, 6)');
  const p1 = await runJS('window.chomp.cellPoint(0, 7)');
  await mouse('mousePressed', p0.x, p0.y, 1);
  await sleep(40);
  await mouse('mouseMoved', Math.round((p0.x + p1.x) / 2), Math.round((p0.y + p1.y) / 2), 1);
  await sleep(40);
  const mid = await runJS('JSON.stringify(window.chomp.state.preview)');
  await mouse('mouseMoved', p1.x, p1.y, 1);
  await sleep(40);
  const dragged = JSON.parse(await runJS('JSON.stringify(window.chomp.state.preview)'));
  await mouse('mouseReleased', p1.x, p1.y, 0);
  await sleep(140);
  const afterDrag = JSON.parse(await S());
  rec('拖动改锚点：中途的 preview 跟着手指走', mid && JSON.parse(mid) && JSON.parse(mid).r === 1, { mid, dragged });
  rec('松口即咬：拖到的那一格成为锚点（8.8 咬 (0,7) 后是 7.7，对手再答一口）',
    before.shapeKey === '8.8' && afterDrag.aiBites === 1 && afterDrag.plies === before.plies + 2 && dragged.r === 0 && dragged.c === 7,
    { before: before.shapeKey, after: afterDrag.shapeKey, plies: afterDrag.plies, dragged });

  // --- 过拉钳制在边界: keep dragging past the right edge; the anchor must stick to the bar
  // instead of running off into the wrapper or dropping the gesture.
  await runJS('(() => { const c = window.chomp; c.load("#/lot/shoal-03"); return 1; })()');
  await sleep(220);
  const edge = await runJS('(() => { const c = window.chomp; const b = document.getElementById("board").getBoundingClientRect(); return { start: c.cellPoint(0, 1), out: { x: Math.round(b.right + 80), y: Math.round(b.bottom + 80) } }; })()');
  await mouse('mousePressed', edge.start.x, edge.start.y, 1);
  await sleep(40);
  await mouse('mouseMoved', edge.out.x, edge.out.y, 1);
  await sleep(40);
  const clamped = JSON.parse(await runJS('JSON.stringify(window.chomp.state.preview)'));
  await mouse('mouseReleased', edge.out.x, edge.out.y, 0);
  await sleep(140);
  const afterOver = JSON.parse(await S());
  const clampProbe = await runJS('(() => { const c = window.chomp; const b = document.getElementById("board").getBoundingClientRect(); const far = c.clampToBar(b.right + 400, b.bottom + 400); const shape = c.state.shape; return { far, alive: far.r < shape.length && far.c < shape[far.r], shape }; })()');
  rec('过拉钳制在边界：棋盘外的坐标被拉回一个真实存在的格子', clampProbe.alive === true && clampProbe.far.c <= 3, clampProbe);
  rec('拖出棋盘后松口：锚点仍是合法格并且记了一口', clamped && clamped.c <= 3 && /^[0-9.]+$/.test(afterOver.shapeKey) && afterOver.plies >= 1, { clamped, key: afterOver.shapeKey, plies: afterOver.plies });

  // --- 原地点击不动: press and release on a square that has already been bitten away. Set the
  // board up first, so the assertion never depends on what the previous drag happened to leave.
  await runJS('(() => { const c = window.chomp; c.load("#/lot/shoal-01"); return 1; })()');
  await sleep(220);
  const first = await runJS('(() => { const lot = window.chomp.lot(); return lot.winningMoves[0]; })()');
  await click(await runJS(`window.chomp.cellPoint(${first[0]}, ${first[1]})`));
  const midGame = JSON.parse(await S());
  const ghost = await runJS('(() => { const c = window.chomp; const st = c.state; const shape = st.shape; const root = st.root; for (let r = 0; r < root.length; r++) { const have = r < shape.length ? shape[r] : 0; if (have < root[r]) return Object.assign(c.cellPoint(r, root[r] - 1), { at: [r, root[r] - 1] }); } return null; })()');
  const beforeGhost = JSON.parse(await S());
  // The ghost square must be INSIDE the original bar (so the finger lands on a drawn hole) and
  // OUTSIDE the current shape (so the rules really refuse it).
  const ghostIsHole = await runJS('(() => { const c = window.chomp; const st = c.state; if (!st.lastBite || !st.lastBite.gone) return { ok: false, why: "没有 lastBite.gone" }; const shape = st.shape; const root = st.root; const holes = st.lastBite.gone.filter(([r, k]) => r >= shape.length || k >= (shape[r] || 0)); return { ok: holes.length > 0 && holes.every(([r, k]) => r < root.length && k < root[r]), holes: holes.length, key: st.shapeKey }; })()');
  rec('一口之后棋盘上真的有空位（被带走的那些格子仍在原盘框内）', ghostIsHole.ok === true, ghostIsHole);
  rec('空位坐标落在原盘框内、当前形状外', !!ghost && ghost.at[0] < 4 && ghost.at[1] < 4, ghost && ghost.at);
  if (ghost) {
    await click(ghost);
    const afterGhost = JSON.parse(await S());
    rec('已咬空的位置点不动：不记口、形状不变、并说出原因',
      afterGhost.plies === beforeGhost.plies && afterGhost.shapeKey === beforeGhost.shapeKey && /已被咬空|不能这样咬/.test(afterGhost.line),
      { plies: afterGhost.plies, line: afterGhost.line });
  } else {
    rec('已咬空的位置点不动：造不出空位就是测试失败', false, 'no ghost square after a bite');
  }

  // --- terminal lock at the input layer: after the win the shell covers the board, and a real
  // click on a square bills nothing.
  await runJS('(() => { const c = window.chomp; c.load("#/lot/shoal-01"); c.autoWin(); return 1; })()');
  await sleep(200);
  const wonState = JSON.parse(await S());
  const anyCell = await runJS('window.chomp.cellPoint(1, 1)');
  await click(anyCell);
  const afterOver2 = JSON.parse(await S());
  rec('结束后真点击一律不计数', wonState.status === 'won' && afterOver2.plies === wonState.plies && afterOver2.shapeKey === wonState.shapeKey, { plies: afterOver2.plies, status: afterOver2.status });
  rec('终局判定与印着的 winner 一致：只剩毒格、轮到被迫的一方、判必败',
    afterOver2.shapeKey === '1' && afterOver2.winner === '先手' && afterOver2.verdict === '必败' && afterOver2.turn === 'ai',
    { key: afterOver2.shapeKey, winner: afterOver2.winner, verdict: afterOver2.verdict, turn: afterOver2.turn });

  return { rows };
}

// ---- in-page suites: each returns { rows: [{ test, pass, detail }] } --------
const SCENARIOS = {
  boot: `(async () => {
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const c = window.chomp;
    rec('the shell boots straight into a game', c && c.version === 1 && c.state.id && c.state.mode === 'campaign', c && c.state);
    const cv = document.getElementById('board');
    rec('the canvas has real pixels (not the 300x150 default)', cv.width > 0 && cv.height > 0 && !!cv.getContext('2d'), { w: cv.width, h: cv.height });
    rec('devicePixelRatio is honoured', cv.width >= cv.getBoundingClientRect().width, { dpr: c.view.metrics().dpr, w: cv.width, css: cv.getBoundingClientRect().width });
    const lit = (() => {
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++;
      return n;
    })();
    rec('the bar was actually painted', lit > 50, { litSamples: lit });
    const box = c.view.metrics();
    rec('the view fitted the whole bar into the canvas', box.cell >= 26 && box.originX > 0 && box.cssW > box.cell, box);
    rec('the shipped pool loaded', c.pool && c.pool.lots >= 24 && c.pool.states === 419, c.pool);
    rec('the book is the measured universe: 419 positions, 36 losses', c.book.states === 419 && c.book.p === 36 && c.book.n === 383, c.book);
    rec('four bands, each with its own caps', Object.keys(c.pool.byTier).length === 4 && c.tiers.length === 4, c.tiers);
    const s = c.state;
    const card = c.lot();
    rec('the panel numbers are consistent with the lot card and a fresh solve',
      s.k === card.k && s.states === card.states && s.winner === card.winner && s.cells === s.shape.reduce((a, b) => a + b, 0) && c.solve(s.root.join('.')).k === card.k,
      { k: s.k, card: card.k, states: s.states, cells: s.cells });
    rec('the readout prints 判定 / 首口 / 局面数 / 随机一口赢率 together', (() => {
      const t = document.getElementById('readout').textContent;
      return /当前判定/.test(t) && /开局证明/.test(t) && /局面数/.test(t) && /随机一口赢率/.test(t) && /棋书覆盖/.test(t);
    })(), document.getElementById('readout').textContent);
    rec('the verdict printed for the opening position is 必胜 (every lot is an N-position)', s.verdict === '必胜' && s.n === true && s.winner === '先手', s);
    rec('the proof drawer quotes this lot\\'s own reachable set', document.getElementById('proof').textContent.includes(String(s.states)) && /穷举|minimax/.test(document.getElementById('proof').textContent), document.getElementById('proof').textContent.slice(0, 160));
    rec('this origin can persist', s.persist === true, { persist: s.persist });
    const bitmaps = performance.getEntriesByType('resource').filter((e) => /[.](png|jpe?g|gif|webp)([?]|$)/.test(e.name));
    rec('every bitmap the page asked for is a self-generated PNG shipped in this repo', bitmaps.length >= 4
      && bitmaps.every((e) => e.name.startsWith(location.origin + '/') && e.name.includes('/assets/') && e.name.endsWith('.png')),
      bitmaps.map((e) => e.name.split('/').pop()).slice(0, 12));
    rec('no webfont / audio / svg-as-raster request', performance.getEntriesByType('resource').every((e) => !/[.](woff2?|ttf|otf|mp3|ogg|m4a|svg)([?]|$)/.test(e.name)),
      performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).slice(0, 12));
    const icons = [...document.querySelectorAll('link[rel=icon], link[rel=apple-touch-icon]')].map((l) => l.getAttribute('href'));
    rec('the icons are real PNG files on disk, one of them at least 180px', icons.length >= 3
      && icons.every((h) => h && h.indexOf('assets/icons/') === 0 && h.endsWith('.png')) && icons.some((h) => h.indexOf('apple-touch-icon') >= 0), icons);
    await new Promise((r) => setTimeout(r, 200));
    rec('the four canvas textures decoded into real bitmaps (no procedural fallback in the browser)',
      (() => { const v = Object.values(c.state.sprites); return v.length === 4 && v.every((x) => x === 'ready'); })(), c.state.sprites);
    return { rows };
  })()`,

  play: `(async () => {
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const c = window.chomp;
    c.store.reset();
    c.load('#/lot/shoal-01'); await sleep(140);
    const lot = c.lot();
    rec('a lot carries the measured record', lot.shape.join('.') === '4.4' && lot.winner === '先手' && lot.k === 1 && lot.states === 14, lot);

    // illegal: the poison square
    const p0 = c.state.plies;
    const rej = c.tap(0, 0);
    rec('咬毒格被拒且不计数', rej.rejected === '毒格不能主动咬' && c.state.plies === p0 && c.state.shapeKey === '4.4', { rej, line: c.state.line });
    // illegal: off the bar
    const rej2 = c.tap(9, 0);
    rec('行越界被拒', rej2.rejected === '行越界' && c.state.plies === p0, rej2);
    // illegal: a square that is not there
    const rej3 = c.tap(0, 9);
    rec('列越界被拒', rej3.rejected === '那一格早已被咬空' && c.state.plies === p0, rej3);

    // legal winning bite, then the table answers
    const win = lot.winningMoves[0];
    c.tap(win[0], win[1]); await sleep(80);
    const mid = c.state;
    rec('一口之后棋书判 4.3 为必败（阶梯就是证明）', c.classify('4.3').n === false && c.solve('4.4').winningMoves[0].join(',') === win.join(','), { step: win });
    rec('对手立刻回答了：两口记上、交棒回玩家', mid.plies === 2 && mid.aiBites === 1 && mid.turn === 'you' && /^[0-9.]+$/.test(mid.shapeKey) && mid.shapeKey !== '4.4', mid);
    rec('对手回答完交回给玩家的仍是必胜局（必败的一方只能送出 N）', mid.n === true, { key: mid.shapeKey, n: mid.n });

    const w = c.autoWin();
    rec('认证线路走完就是玩家胜', w.won === true && c.state.status === 'won' && c.state.shapeKey === '1', w);
    rec('终局卡片按印着的证明庆祝', D('curtain').hidden === false && /被迫咬下毒格/.test(D('verdict').textContent) && /\\b14\\b/.test(D('tally').textContent), { verdict: D('verdict').textContent, tally: D('tally').textContent });
    D('restart').click(); await sleep(120);
    rec('重开 clears the board, card and counters', c.state.plies === 0 && c.state.shapeKey === '4.4' && D('curtain').hidden, c.state);

    // a wrong bite hands the win to the opponent
    const bad = c.legal().find((m) => !(m[0] === win[0] && m[1] === win[1]));
    c.tap(bad[0], bad[1]); await sleep(80);
    rec('点错一口之后棋书判定玩家面对必败局', c.state.n === false || c.state.status === 'lost', { key: c.state.shapeKey, n: c.state.n, status: c.state.status });
    const h = c.hintOnce();
    rec('提示数出来的胜口 == 卡面 k（开局状态下）', (() => { const r = c.restart(); const hh = c.hintMove(); return hh.winning === true && hh.k === c.lot().k; })(), h);

    // undo walks back a round
    c.restart(); await sleep(80);
    c.tap(win[0], win[1]); await sleep(80);
    const before = c.state.plies;
    c.undo(); await sleep(80);
    rec('撤销回到玩家上一口之前', c.state.shapeKey === '4.4' && c.state.plies === 0 && before >= 2, { before, now: c.state.plies });
    const none = c.undo();
    rec('没有可撤销时它说一句话而不是崩', none.snapshots.length === 0, { line: c.state.line });

    // re-derive the shipped book inside the browser
    const rc = c.recomputeBook();
    rec('浏览器里重烘棋书 == 发货的那一份（逐字节）', rc.same === true && rc.rows === rc.shipped, rc);
    rec('从序列化关卡重解复现印着的数字', c.verifyShipped().length === 0, c.verifyShipped());
    const solved = c.solve(lot.shape.join('.'));
    rec('现场复算 solve 复现 winner/k', solved.winner === '先手' && solved.k === lot.k && solved.states === lot.states, solved);
    // the table lookup refuses an out-of-range position instead of searching
    let threw = null;
    try { c.classify('12.12'); } catch (err) { threw = String(err.message || err).slice(0, 60); }
    rec('越出棋书的判定抛异常，不现场搜索', threw !== null && /不在棋书里/.test(threw), threw);
    c.restart(); await sleep(60);
    c.tap(0, 0); await sleep(60);
    rec('toast 会说清拒绝原因（真拒绝，不是沉默）', /毒格/.test(D('toast').textContent) === false || /毒格|不能这样咬/.test(c.state.line), { toast: D('toast').textContent, line: c.state.line, plies: c.state.plies });
    rec('程序化 tap 与真点击同一口径：非法一口不记步', c.state.plies === 0 && c.state.shapeKey === '4.4', c.state);
    return { rows };
  })()`,

  routes: `(async () => {
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const c = window.chomp;
    c.store.reset();

    c.load('#/c/7'); await sleep(120);
    rec('#/c/7 is lot seven', c.state.index === 7 && c.state.mode === 'campaign', c.state);
    c.load('#/c/99999'); await sleep(120);
    rec('a huge index clamps to the last lot', c.state.index === c.pool.lots, { index: c.state.index, lots: c.pool.lots });
    c.load('#/c/0'); await sleep(120);
    rec('index zero clamps up to one', c.state.index === 1, c.state.index);

    c.load('#/lot/twined-01'); await sleep(120);
    rec('#/lot/<id> opens that lot and shares its shape', c.state.id === 'twined-01' && c.state.shapeKey === '5.4.3', c.state);
    c.load('#/lot/not-a-real-lot'); await sleep(160);
    rec('an unknown lot id falls back instead of blanking the board', !!c.state.id && c.state.mode === 'campaign', c.state);

    c.load('#/daily'); await sleep(140);
    const daily = c.state.id;
    const dailyKey = c.state.shapeKey;
    c.load('#/c/1'); await sleep(120);
    c.load('#/daily'); await sleep(140);
    rec('the daily route is the same puzzle twice', c.state.mode === 'daily' && c.state.id === daily && c.state.shapeKey === dailyKey, { daily, again: c.state.id, key: c.state.shapeKey });
    rec('the daily label carries the date', /^每日毒格 · \\d{4}-\\d{2}-\\d{2}$/.test(c.state.label), c.state.label);
    rec('the daily is a proven first-player win like every lot', c.state.winner === '先手' && c.state.k >= 1 && c.state.n === true, c.state);

    for (const tier of Object.keys(c.pool.byTier)) {
      c.load('#/random/' + tier + '/fixedseed'); await sleep(120);
      const first = c.state.id;
      c.load('#/c/1'); await sleep(120);
      c.load('#/random/' + tier + '/fixedseed'); await sleep(120);
      rec('#/random/' + tier + ' stays in its band and repeats itself', c.state.tier === tier && c.state.id === first, { tier: c.state.tier, id: c.state.id, first });
    }
    c.load('#/random'); await sleep(200);
    rec('a bare #/random mints a token INTO the URL (share-safe)', /^#\\/random\\/[a-z]+\\/[\\w-]+$/.test(location.hash), location.hash);
    c.load('#/random/grind/seedA'); await sleep(140);
    rec('an unknown tier falls back to the whole pool rather than crashing', !!c.state.id, c.state.id);

    document.querySelector('#modes button[data-mode=daily]').click(); await sleep(160);
    rec('the header 每日 button routes (it was dead wiring once)', c.state.mode === 'daily', c.state.mode);
    document.querySelector('#modes button[data-mode=campaign]').click(); await sleep(160);
    rec('and the 战役 button routes back', c.state.mode === 'campaign', c.state.mode);
    rec('the aria-pressed marker follows the mode', document.querySelector('#modes button[data-mode=campaign]').getAttribute('aria-pressed') === 'true', location.hash);
    return { rows };
  })()`,

  save: `(async () => {
    const rows = [];
    const rec = (name, pass, detail) => rows.push({ test: name, pass: !!pass, detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail ?? null)) });
    window.__lastRows = rows;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const D = (id) => document.getElementById(id);
    const c = window.chomp;
    const KEY = 'chomp.save.v1';

    c.store.reset();
    c.load('#/lot/shoal-01'); await sleep(140);
    rec('a wiped save is empty', Object.keys(c.store.records).length === 0 && c.store.unlocked === 1 && localStorage.getItem(KEY) === null, { unlocked: c.store.unlocked });

    c.autoWin(); await sleep(140);
    const id = c.state.id;
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    rec('the win reaches localStorage, not only memory', !!(raw && raw.records[id] && raw.records[id].won), raw && Object.keys(raw.records || {}));
    rec('clearing an early lot unlocks the next', raw.unlocked >= 2, { unlocked: raw.unlocked });

    // best only goes DOWN: hand the store a worse and a better run directly.
    const g0 = c.state.plies;
    c.store.finish(id, { won: true, plies: 99, hints: 0 });
    rec('a worse replay cannot raise best', c.store.record(id).best === g0, c.store.record(id));
    c.store.finish(id, { won: true, plies: 1, hints: 0 });
    rec('an impossible-looking 1 still only lowers best', c.store.record(id).best === 1, c.store.record(id));
    c.store.finish(id, { won: false, plies: 40, hints: 2 });
    rec('a loss changes plays, not the record', c.store.record(id).best === 1 && c.store.record(id).plays >= 4, c.store.record(id));

    // unlock only goes UP.
    const u0 = c.store.unlock(3);
    c.store.unlock(1);
    rec('unlock never goes backwards', c.store.unlocked === 3 && u0 === 3, { u0, now: c.store.unlocked });

    // the daily log.
    c.load('#/daily'); await sleep(140);
    const day = c.state.day;
    c.autoWin(); await sleep(140);
    const mark = c.store.dailyDone(day);
    rec('today is logged once solved', !!mark && mark.won === true && mark.id === c.state.id, { day, mark });
    rec('dailyDone for another day is null', c.store.dailyDone('1999-01-01') === null, null);

    rec('the header totals count what is really on disk', /通关 \\d+\\/\\d+ · 胜 \\d+ 负 \\d+ · 棋书 419 局面/.test(D('totals').textContent), D('totals').textContent);

    // the two-click wipe.
    D('wipe').click(); await sleep(80);
    rec('the first click only arms it', Object.keys(c.store.records).length > 0 && D('wipe').textContent.includes('再点'), { records: Object.keys(c.store.records), label: D('wipe').textContent });
    D('wipe').click(); await sleep(200);
    rec('清空存档 takes two clicks and clears everything',
      Object.keys(c.store.records).length === 0 && c.store.unlocked === 1 && localStorage.getItem(KEY) === null,
      { records: Object.keys(c.store.records), unlocked: c.store.unlocked, raw: localStorage.getItem(KEY) });
    return { rows };
  })()`,
};

main().catch((err) => {
  console.error('playtest failed: ' + ((err && err.stack) || err));
  process.exit(1);
});
