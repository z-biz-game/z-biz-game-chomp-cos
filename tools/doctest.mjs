// 文档数字闸：README / DESIGN / deliverable 里印出来的每一个数字，都必须等于"现在从代码或真实
// 运行里量出来的那个值"。钉不住的一律进 D10 的 unpinned 清单，并各带一根针——把那句话从文档里
// 删掉，这道闸必须变红，而不是安静地少一条断言。
//
//   node tools/doctest.mjs              跑全部十三组（本地与 CI 是同一条命令）
//   node tools/doctest.mjs | head       调试时可分页，判据仍是最后那行 rows/fail
//
// 为什么每一处表格解析都带一条"解析到几行"的断言：正则一条都不命中时，逐格比较循环根本不会
// 转，闸会绿着通过——那是最坏的假绿。所以每组先数行数，行数不对就是红。
//
// 墙钟数字（本仓纪律，见 README §一 与 DESIGN §6）：这道闸只钉"某个测试里写着 <= 50 ms"这件事
// 的**出处**与文档引用方向，绝不重新计时，也绝不把新的毫秒数写进文档。实测读数留在日志工件里。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const cache = new Map();
const src = (p) => {
  if (!cache.has(p)) { try { cache.set(p, read(p).split('\n')); } catch { cache.set(p, null); } }
  return cache.get(p);
};
const lineOf = (p, re) => { const s = src(p); return s ? s.findIndex((l) => re.test(l)) + 1 : 0; };
const wc = (p) => (src(p) ? src(p).length - 1 : -1); // 与 wc -l 同口径
const bytes = (p) => statSync(join(ROOT, p)).size;
const exists = (p) => !!src(p);
// 段落在文档里都是"某一行开头"，所以两个边界一律按多行匹配；忘了 m 标志会让整段解析成空串，
// 而空串配不上任何一行 —— 那是最安静的一种假绿，下面的行数断言就是为了让它现形。
const multiline = (re) => new RegExp(re.source, re.flags.includes('m') ? re.flags : `${re.flags}m`);
const between = (text, a, b) => {
  const i = text.search(multiline(a));
  if (i < 0) return '';
  const rest = text.slice(i);
  const j = b ? rest.search(multiline(b)) : -1;
  return j < 0 ? rest : rest.slice(0, j);
};
const all = (s, re) => [...s.matchAll(re)];

const stripLedger = (t) => t.split('\n').filter((l) => !/^\| S\d+ \| /.test(l)).join('\n');
// 破坏试验台账那一张表会把每一把刀的**针**与**正文原句**逐字抄进 README（D11 要求逐字相同），
// 那些行是**引用**不是**主张**：闸若把它们当主张读，S6/S7/S8/S10 这类刀砍掉了正文里的原句，
// 台账行还留着同一串字，D6/D7/D8/D10 就一条也不会红——那是台账自己造的假绿。所以正文一律按
// 剥掉台账行之后的 README 读，只有 D11 那一组去数台账行本身。与 tools/sabotage.mjs 的 target()
// 是同一条排除规则。
const README_RAW = read('README.md');
const README = stripLedger(README_RAW);
const DESIGN = read('DESIGN.md');
const DELIV = read('deliverable.md');
const DOCS = { 'README.md': README, 'DESIGN.md': DESIGN, 'deliverable.md': DELIV };
const DOCTEXT = README + '\n' + DESIGN + '\n' + DELIV;

let rows = 0;
const emitted = new Set();
const fail = [];
// 标签一律是**静态字符串**（破坏试验台账要按标签点名它吃掉了哪一条断言，标签里带槽就点不中了），
// 会变的那一部分（档名、行号、现值）放进 detail。
const ok = (cond, label, detail) => {
  rows += 1;
  emitted.add(label.match(/^D\d+/)[0]);
  if (!cond) fail.push(label);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` · ${detail}` : ''}`);
};
const eq = (got, want, label, tag) => ok(String(got) === String(want), label, `${tag ? `${tag} · ` : ''}现算 ${got} / 文档 ${want}`);

// ---------------------------------------------------------------- 代码侧的真值（全部现算）
const { LOTS, TIERS_META, BOOK, DAILY_IDS, SCHEMA, BAKED_AT } = await import(join(ROOT, 'js/data/lots.js'));
const M = await import(join(ROOT, 'js/core/make.js'));
const S = await import(join(ROOT, 'js/core/solve.js'));
const SH = await import(join(ROOT, 'js/core/shapes.js'));
const BK = await import(join(ROOT, 'js/core/book.js'));
const FX = await import(join(ROOT, 'test/fixture.mjs'));
const TIERS = ['shoal', 'linked', 'twined', 'master'];

const uni = S.solveUniverse();
const rebaked = BK.encodeBook(uni);
const universeN = uni.shapes;
const bookP = rebaked.p;
const bookN = rebaked.n;
const bookKey = (r) => r.split(':')[0];
const bookIsP = (r) => r.split(':')[1].startsWith('0/');
const twoRowKeys = BOOK.rows.map(bookKey).filter((k) => k.split('.').length === 2);
const twoRowP = BOOK.rows.filter((r) => bookKey(r).split('.').length === 2 && bookIsP(r)).map(bookKey);
const allP = BOOK.rows.filter(bookIsP).length;

// 每档 census：候选全集 → 逐形状独立建表 → 出题门槛（与 tools/bake.mjs 同一条路线，只是不落盘）
const census = {};
for (const band of M.BANDS) {
  const cands = M.candidates(band);
  const reasons = {};
  const eligible = [];
  for (const shape of cands) {
    const table = S.buildTable(shape);
    const node = table.memo.get(SH.encodeShape(shape));
    const a = { n: node.n, k: node.winning.length, states: table.states, bites: table.bites };
    const gate = M.eligibility(shape, a, band);
    if (!gate.ok) reasons[gate.why] = (reasons[gate.why] || 0) + 1;
    else eligible.push(a);
  }
  const rng = (xs) => `${Math.min(...xs)}-${Math.max(...xs)}`;
  census[band.key] = {
    band,
    cands: cands.length,
    eligible: eligible.length,
    pct: (eligible.length / cands.length * 100).toFixed(1),
    reasons,
    k: rng(eligible.map((e) => e.k)),
    states: rng(eligible.map((e) => e.states)),
    bounds: band.bounds,
    minCells: band.minCells,
    shipped: LOTS.filter((l) => l.tier === band.key).length,
  };
}
const meta = Object.fromEntries(TIERS_META.map((m) => [m.key, m]));
const bandStats = {};
for (const t of TIERS) {
  const ls = LOTS.filter((l) => l.tier === t);
  const c = ls.map((l) => l.chance);
  bandStats[t] = {
    lots: ls.length,
    states: `${Math.min(...ls.map((l) => l.states))}-${Math.max(...ls.map((l) => l.states))}`,
    chance: `${Math.min(...c)}-${Math.max(...c)}`,
    pct: `${(Math.min(...c) * 100).toFixed(1)}-${(Math.max(...c) * 100).toFixed(1)}`,
    acceptPct: (ls.length / census[t].cands * 100).toFixed(1) * 1,
  };
}
const sum = (f) => LOTS.reduce((a, l) => a + f(l), 0);
const SHIPPED = {
  lots: LOTS.length,
  legal: sum((l) => l.legal),
  k: sum((l) => l.k),
  wrong: sum((l) => l.legal - l.k),
  cells: sum((l) => l.cells),
  statesLo: Math.min(...LOTS.map((l) => l.states)),
  statesHi: Math.max(...LOTS.map((l) => l.states)),
  chanceLo: Math.min(...LOTS.map((l) => l.chance)),
  chanceHi: Math.max(...LOTS.map((l) => l.chance)),
};
const legalNow = sum((l) => SH.legalBites(l.shape).length);
const kNow = sum((l) => BK.winningBitesOf(BK.decodeBook(BOOK), l.shape).length);
const statesNow = sum((l) => S.buildTable(l.shape).states);
const byId = Object.fromEntries(LOTS.map((l) => [l.id, l]));
const worst = LOTS.slice().sort((a, b) => b.states - a.states)[0];
const worstTable = S.buildTable(worst.shape);

// node 套件：真跑一遍，条数从它们自己嘴里读
const SUITE_FILES = readdirSync(join(ROOT, 'test')).filter((f) => f.endsWith('.test.mjs')).sort();
const measured = {};
let suiteFailTotal = 0;
for (const f of SUITE_FILES) {
  const r = spawnSync(process.execPath, [`test/${f}`], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const m = /rows: (\d+) fail: (\d+)/.exec(r.stdout || '');
  measured[f.replace('.test.mjs', '')] = m ? { rows: +m[1], fail: +m[2], rc: r.status } : { rows: -1, fail: -1, rc: r.status };
  suiteFailTotal += m ? +m[2] : 1;
}
const LOGIC_TOTAL = TIERS.length ? Object.values(measured).reduce((a, x) => a + x.rows, 0) : 0;

// 浏览器场景：静态点数（本轮不跑 Chrome，所以钉的是"调用点在哪、有几处"这件可复算的事）
const PT = read('tools/playtest.mjs');
const scenarioBody = (name) => {
  if (name === 'pointer') {
    const a = PT.indexOf('async function pointerScenario');
    const b = PT.indexOf('\nconst SCENARIOS = {');
    return PT.slice(a, b);
  }
  // 四套页内场景都是 `NAME: \`(async () => { … })()\``，终止符是行首两空格那一行的 `` })()` `` ——
  // 从**开引号之后**开始数花括号会一路数到 SCENARIOS 的收尾，五段就互相重叠了（原来 boot 数到 63）。
  const a = PT.indexOf(`\n  ${name}: \``);
  if (a < 0) return '';
  const open = a + 1 + `  ${name}: `.length;
  const close = PT.indexOf('`,\n', open);
  return PT.slice(open, close < 0 ? PT.length : close + 1);
};
const recOf = (name) => (scenarioBody(name).match(/\brec\(/g) || []).length;
const REC = Object.fromEntries(['boot', 'play', 'routes', 'save', 'pointer'].map((n) => [n, recOf(n)]));
const pointerBody = scenarioBody('pointer');
const POINTER_LOOP_FAILS = (pointerBody.match(/if \(!h\) \{ rec\(/g) || []).length + (pointerBody.match(/if \(now\.plies === 0\) \{ rec\(/g) || []).length;
const POINTER_ELSE_PAIRS = (pointerBody.match(/\} else \{/g) || []).length;
const ROUTES_LOOP_RECS = (scenarioBody('routes').match(/for \(const tier of Object\.keys\(c\.pool\.byTier\)\) \{[\s\S]*?\n      rec\(/g) || []).length;
const NORMAL = {
  boot: REC.boot,
  play: REC.play,
  routes: REC.routes - ROUTES_LOOP_RECS + TIERS.length,
  save: REC.save,
  pointer: REC.pointer - POINTER_LOOP_FAILS - POINTER_ELSE_PAIRS,
};
const NORMAL_TOTAL = Object.values(NORMAL).reduce((a, x) => a + x, 0);

// 资产对账：把 make_art.py 的期望表读进来，用 IHDR 在 node 里量（Pillow 不在，见 D10 那条）
const PY = read('assets/gen/make_art.py');
const ICON_SIZES = JSON.parse(PY.match(/ICON_SIZES = (\[.*?\])/)[1]);
const WANT = [
  ...ICON_SIZES.map((s) => `assets/icons/icon-${s}.png`),
  'assets/icons/favicon-32.png', 'assets/icons/apple-touch-icon.png', 'assets/icons/maskable-512.png',
  'assets/textures/cocoa-256.png', 'assets/textures/foil-256.png', 'assets/textures/skull-160.png',
  'assets/textures/crumb-48.png', 'assets/og/chomp-og.png',
];
const dims = (p) => { const buf = readFileSync(join(ROOT, p)); return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; };
const ASSET = (() => {
  const missing = WANT.filter((p) => !exists(p) || p.startsWith('assets/') === false).length;
  const zero = WANT.filter((p) => bytes(p) === 0).length;
  const big = WANT.filter((p) => Math.min(...dims(p)) >= 180).length;
  const h = createHash('sha256');
  (function walk(d) {
    const dirs = readdirSync(d).filter((e) => statSync(join(d, e)).isDirectory() && e !== 'gen').sort();
    const files = readdirSync(d).filter((e) => statSync(join(d, e)).isFile()).sort();
    for (const f of files) if (f.endsWith('.png')) { h.update(Buffer.from(f)); h.update(readFileSync(join(d, f))); }
    for (const e of dirs) walk(join(d, e));
  })(join(ROOT, 'assets'));
  return { want: WANT.length, missing: WANT.filter((p) => { try { statSync(join(ROOT, p)); return false; } catch { return true; } }).length, zero, big, digest: h.digest('hex').slice(0, 12) };
})();

// verify.sh / ci.yml / package.json 的接线
const VS = read('tools/verify.sh');
const CI = read('.github/workflows/ci.yml');
const PG = JSON.parse(read('package.json'));
const MIN_LOGIC = Number((VS.match(/MIN_LOGIC_ROWS=\$\{MIN_LOGIC_ROWS:-(\d+)\}/) || [])[1]);
const CHECK_GLOB = PG.scripts.check.match(/for f in (.+?); do/)[1];
const CI_CALLS_LEGS = /- name: Syntax\n\s+run: npm run check\b/.test(CI) && /- name: Suites\n\s+run: npm run unit\b/.test(CI);
const checkRun = spawnSync('/bin/bash', ['-c', `for f in ${CHECK_GLOB}; do node --check "$f" || exit 1; done && echo OK`], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
const CHECK_FILES = spawnSync('/bin/bash', ['-c', `for f in ${CHECK_GLOB}; do echo "$f"; done`], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().split('\n').length;

// ================================================================ D1 三处文档的档位 census
const readmeCensus = all(between(README, /^## 五、/, /^---$/), /^\| `(\w+)`[^|]*\|([^|]*)\| (\d+) \| (\d+)（([\d.]+)%） \| (.+?) \| k (\d+)–(\d+) \/ states (\d+)–(\d+) \| (\d+) \|$/gm);
ok(readmeCensus.length === 4, 'D1a README 五 的档位表解析到 4 行（解析不到不等于通过）', `${readmeCensus.length} 行`);
for (const r of readmeCensus) {
  const t = r[1];
  const c = census[t];
  ok(!!c, 'D1 档位名在代码里的 BANDS 中还存在', t);
  eq(`${c.bounds.rows} / ${c.bounds.width} / ${c.bounds.area}，≥${c.minCells} 格`, r[2].trim(), 'D1 档位表的上限格 == make.js 的 BANDS 现值', t);
  eq(c.cands, r[3], 'D1 档位表这一格的候选数 == candidates() 现数', t);
  eq(`${c.eligible}（${c.pct}%）`, `${r[4]}（${r[5]}%）`, 'D1 档位表的通过门槛与合格率 == eligibility() 现数', t);
  eq(`p-position ${c.reasons['p-position'] || 0}、too-small ${c.reasons['too-small'] || 0}`, r[6], 'D1 档位表的拒绝原因计数 == 现数', t);
  eq(`k ${c.k.replace('-', '–')} / states ${c.states.replace('-', '–')}`, `k ${r[7]}–${r[8]} / states ${r[9]}–${r[10]}`, 'D1 档位表的合格集 k / states 区间 == 现数', t);
  eq(bandStats[t].lots, r[11], 'D1 档位表的本档发货数 == js/data/lots.js 现数', t);
}
ok(TIERS.every((t) => !['no-winning-move', 'too-many-states'].some((w) => (census[t].reasons[w] || 0) > 0)),
  'D1b 拒绝原因只出现 p-position 与 too-small 两类（README 那句话）', Object.values(census).map((c) => Object.keys(c.reasons).join('+')).join(' / '));

const designCensus = all(between(DESIGN, /^## 6\./, /^## 7\./), /^\| (\w+) [^|]*\| (\d+) \| (\d+) \(([\d.]+)%\) \| (\d+) \| p-position (\d+), too-small (\d+) \| (\d+)–(\d+) \| (\d+)–(\d+) \|$/gm);
ok(designCensus.length === 4, 'D1c DESIGN 六 的 census 表解析到 4 行', `${designCensus.length} 行`);
for (const r of designCensus) {
  const t = r[1];
  const c = census[t];
  const m = meta[t];
  const good = c.cands === +r[2] && c.eligible === +r[3] && +c.pct === +r[4] && +r[5] === m.lots
    && +r[6] === (c.reasons['p-position'] || 0) && +r[7] === (c.reasons['too-small'] || 0)
    && `${m.kMin}–${m.kMax}` === `${r[8]}–${r[9]}` && `${m.statesMin}–${m.statesMax}` === `${r[10]}–${r[11]}`;
  ok(good, 'D1 DESIGN census 表整行的结构量 == 现算 census 与发货 TIERS_META',
    `${t} 候选 ${r[2]}/${c.cands} 门槛 ${r[3]}(${r[4]}%)/${c.eligible}(${c.pct}%) 发货 ${r[5]}/${m.lots} 拒因 ${r[6]},${r[7]}/${c.reasons['p-position'] || 0},${c.reasons['too-small'] || 0} k ${r[8]}–${r[9]}/${m.kMin}–${m.kMax} states ${r[10]}–${r[11]}/${m.statesMin}–${m.statesMax}`);
}

const delivCensus = all(between(DELIV, /^## 数字从哪来/, /^\*\*接受率/), /^(shoal|linked|twined|master): candidates (\d+) \(full census\) · N-eligible (\d+) \(([\d.]+)%\) · shipped (\d+) \(accept ([\d.]+)%\) · reject \{"p-position":(\d+),"too-small":(\d+)\} · k (\d+)-(\d+) · states (\d+)-(\d+) ·/gm);
ok(delivCensus.length === 4, 'D1d deliverable 的 bake 统计行解析到 4 档（结构量可钉，毫秒不可）', `${delivCensus.length} 档`);
for (const r of delivCensus) {
  const t = r[1];
  const c = census[t];
  const m = meta[t];
  const good = c.cands === +r[2] && c.eligible === +r[3] && +c.pct === +r[4] && +r[5] === m.lots && m.acceptPct === +r[6]
    && +r[7] === (c.reasons['p-position'] || 0) && +r[8] === (c.reasons['too-small'] || 0)
    && `${m.kMin}-${m.kMax}` === `${r[9]}-${r[10]}` && `${m.statesMin}-${m.statesMax}` === `${r[11]}-${r[12]}`;
  ok(good, 'D1 deliverable 的 bake 统计行里的结构量 == 现算',
    `${t} 候选 ${r[2]}/${c.cands} 门槛 ${r[3]}(${r[4]}%)/${c.eligible}(${c.pct}%) 发货 ${r[5]}/${m.lots} accept ${r[6]}/${m.acceptPct} states ${r[11]}-${r[12]}/${m.statesMin}-${m.statesMax}`);
}
eq(readmeCensus.map((r) => r[3]).join(','), designCensus.map((r) => r[2]).join(','), 'D1e 两份文档的候选 census 逐档相同');

// ================================================================ D2 宇宙、棋书、上限
const uniClaim = README.match(/交出 \*\*(\d+) 个局面、(\d+) 个 P、(\d+) 个 N\*\*/);
ok(!!uniClaim, 'D2a README 那句「solveUniverse() 交出 …」解析到了（解析不到就是表格被改了形状）', uniClaim ? uniClaim[0].slice(0, 40) : '解析不到');
eq(`${uni.shapes} / ${bookP} / ${bookN}`, uniClaim ? `${uniClaim[1]} / ${uniClaim[2]} / ${uniClaim[3]}` : '?', 'D2 现算宇宙 == README 印的三行数');
eq(S.universeShapes().length, uni.shapes, 'D2 universeShapes() 与 solveUniverse() 数出同一个宇宙');
eq(`${BOOK.states} / ${BOOK.p} / ${BOOK.n} / ${BOOK.rows.length}`, `${uni.shapes} / ${bookP} / ${bookN} / ${uni.shapes}`, 'D2 发货 BOOK == 现算宇宙（四格一起对）');
eq(JSON.stringify(rebaked) === JSON.stringify(BOOK), true, 'D2 重烘棋书与发货文件逐字节相同（README §五 那句话）');
eq(M.MAX_STATES, uni.shapes, 'D2 make.js 的 MAX_STATES == 现算宇宙大小');
eq(`${SH.MAX_ROWS} / ${SH.MAX_WIDTH} / ${SH.MAX_AREA}`, JSON.stringify(BOOK.bound).match(/\d+/g).slice(0, 3).join(' / '), 'D2 shapes.js 的三个上限 == BOOK.bound');
ok(/宇宙\*\*是 (\d+) 行 \/ (\d+) 列 \/ (\d+) 格以内/.test(README) && [SH.MAX_ROWS, SH.MAX_WIDTH, SH.MAX_AREA].join('|') === RegExp.$1 + '|' + RegExp.$2 + '|' + RegExp.$3,
  'D2 README §五 写的宇宙口径 == shapes.js 的三个常数', `${SH.MAX_ROWS} 行 / ${SH.MAX_WIDTH} 列 / ${SH.MAX_AREA} 格`);
const twoRowClaim = README.match(/两行局面共 \*\*(\d+)\*\* 个，其中 \*\*(\d+)\*\* 个是必败局/);
ok(!!twoRowClaim, 'D2b README 那句两行局面的计数解析到了', twoRowClaim ? twoRowClaim[0] : '解析不到');
eq(`${twoRowKeys.length} / ${twoRowP.length}`, `${twoRowClaim?.[1]} / ${twoRowClaim?.[2]}`, 'D2 棋书里两行局面的总数与其中的必败数 == README 印的两个数');
eq(allP, bookP, 'D2 棋书里 P 的行数 == 重烘棋书数出的 P 数（两行那一格的分母就是它）');
const numKey = (a, b) => +b.split('.')[0] - +a.split('.')[0] || +b.split('.')[1] - +a.split('.')[1];
eq(FX.TWO_ROW_P.map(([a, b]) => `${a}.${b}`).sort(numKey).join(','), twoRowP.slice().sort(numKey).join(','), 'D2 手写的阶梯期望集合 == 棋书里两行 P 的集合（逐字符）');
eq(FX.TWO_ROW_P.length, twoRowP.length, 'D2 阶梯条数 == 两行 P 数（fixture 是期望值，不是从实现读回来的）');
eq(FX.SINGLE_ROW_N.length, 9, 'D2 单行向量宽度 1..9 == fixture 长度');
eq(S.singleRowIsN(1), false, 'D2 单行只有裸毒格必败（闭式那边）');
eq(BK.countOutcomes(BOOK).missingMove, 1, 'D2 全宇宙恰好一个局面没有着法（就是 [1]）');
eq(BK.decodeBook(BOOK).size, uni.shapes, 'D2 decodeBook 往返不丢行');

// ================================================================ D3 九套 node 套件：真跑
const readmePromise = all(between(README, /^## 一、/, /^\n一条命令跑全部/), /^\| .*\| `node (test\/(\w+)\.test\.mjs)` \| .*\| `rows: (\d+) fail: (\d+)` \|$/gm);
ok(readmePromise.length === 9, 'D3a README 一 的承诺表解析到 9 行套件（少一行就是台账被改了）', `${readmePromise.length} 行`);
for (const r of readmePromise) {
  const m = measured[r[2]];
  ok(!!m && m.rows === +r[3] && m.fail === +r[4] && m.rc === 0, 'D3 承诺表这一行的 rows/fail 与本轮真跑相同',
    `${r[2]} · 现跑 rows: ${m?.rows} fail: ${m?.fail} rc: ${m?.rc} / 文档 rows: ${r[3]} fail: ${r[4]}`);
}
const readmeBlock = all(between(README, /^本轮原样结论行/, /^\*\*(\d+) 是把上面九行/), /^rows: (\d+) fail: (\d+)\s+# (\w+)$/gm);
ok(readmeBlock.length === 9, 'D3b README 一 那段原样结论行解析到 9 行', `${readmeBlock.length} 行`);
ok(readmeBlock.every((r) => measured[r[3]] && measured[r[3]].rows === +r[1] && measured[r[3]].fail === +r[2]),
  'D3 那段原样结论行逐套 == 本轮真跑的输出', readmeBlock.map((r) => `${r[3]} ${r[1]}`).join(' '));
const readmeFour = all(between(README, /^`test\/` 九套的条数是本轮实测交回的/, /^\n---/), /`(\w+) (\d+)`（/g);
ok(readmeFour.length === 9, 'D3c README 四 那份逐套条数清单解析到 9 项', `${readmeFour.length} 项`);
ok(readmeFour.every((r) => measured[r[1]] && measured[r[1]].rows === +r[2]), 'D3 四 那份清单的逐套条数 == 本轮真跑', readmeFour.map((r) => `${r[1]}:${r[2]}`).join(' '));
const totalClaim = (README.match(/\*\*(\d+) 是把上面九行加起来的和\*\*/) || [])[1];
eq(LOGIC_TOTAL, totalClaim, 'D3 九行之和 == README 写的那个总数');
eq(LOGIC_TOTAL, MIN_LOGIC, 'D3 九行之和 == verify.sh 里的地板 MIN_LOGIC_ROWS（调低地板就是这条红）', `地板 ${MIN_LOGIC}`);
eq(SUITE_FILES.length, 9, 'D3d test 目录下就是九套（少一个文件循环就少转一圈，这里点名）');
ok(/九套 node 测试/.test(README) && /九套 node 套件/.test(README), 'D3 README 两处「九套」的措辞还在（改套件数必须同步改文档）', 'README 四 + 六');
const nodeTest = spawnSync(process.execPath, ['--test', ...SUITE_FILES.map((f) => `test/${f}`)], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
// 聚合读数（tests/pass/fail）跟着 node 的版本漂：CI 的 v22 把 `--test test/` 当成一个条目跑，交回
// tests 1 / fail 1，本机 v24 才把目录展开成九支文件。所以参数由 SUITE_FILES 派生，判定只取与版本
// 无关的三件事（rc、每套交回的那一行 rows:、聚合 fail 0），tests 只作观测印在日志里。
const ntOut = nodeTest.stdout || '';
const ntAgg = /tests (\d+)[\s\S]*?pass (\d+)[\s\S]*?fail (\d+)/.exec(ntOut);
// runner 会把子进程的 stdout 挂上它自己的框架（v22 加缩进、v24 原样），所以不比行首，只取那九个
// 数字本身，并要求它们与上面逐套直跑交回的**多重集合**相同 —— 少一套、多一套、数字漂了都会红。
const ntNums = (ntOut.match(/rows: (\d+) fail: \d+/g) || []).map((x) => +/^rows: (\d+)/.exec(x)[1]).sort((a, b) => a - b);
const directNums = SUITE_FILES.map((f) => measured[f.replace('.test.mjs', '')].rows).sort((a, b) => a - b);
ok(nodeTest.status === 0 && ntNums.length === SUITE_FILES.length && ntNums.join() === directNums.join() && !!ntAgg && +ntAgg[3] === 0,
  'D3 node --test 跑 SUITE_FILES 派生的那九支：rc 0、九行 rows: 的数字与逐套直跑相同、聚合 fail 0',
  `node ${process.version} · rc=${nodeTest.status} · rows 行 ${ntNums.length}/${SUITE_FILES.length} · ${ntNums.join() === directNums.join() ? '数字与直跑同' : `漂：runner ${ntNums.join()} vs 直跑 ${directNums.join()}`} · 观测聚合 ${ntAgg ? ntAgg.slice(1, 4).join('/') : '解析不到'}`);
// 壳层版本号是 js/main.js 里的一个常数，不是抄进场景的字面量：VERSION 从 1 抬到 2 那一次，
// @boot 写死的 `c.version === 1` 红了三天而应用无恙。这里钉的就是「它仍由源码派生」。
const mainVersion = Number((read('js/main.js').match(/const VERSION = (\d+);/) || [])[1]);
ok(Number.isFinite(mainVersion) && /const VERSION = \(\\d\+\);/.test(PT) && /c\.version === Number\('\$\{SHELL_VERSION\}'\)/.test(PT)
  && !/c\.version === \d/.test(PT),
  'D3 @boot 的壳层版本仍从 js/main.js 的常数派生（写死一个字面量就是这条红）',
  `main.js VERSION=${mainVersion} · playtest 读它=${/const VERSION = \(\\d\+\);/.test(PT)} · 场景里还留着写死的数字=${/c\.version === \d/.test(PT)}`);
eq(suiteFailTotal, 0, 'D3 九套本轮 0 失败');
const HARNESS_ROWS_LINE = lineOf('tools/harness.mjs', /console\.log\(`rows: \$\{rows\.length\} fail/);
const HARNESS_EXIT_LINE = lineOf('tools/harness.mjs', /process\.exit\(bad\.length/);
ok(README.includes(`\`tools/harness.mjs:${HARNESS_ROWS_LINE}\``) && README.includes(`\`tools/harness.mjs:${HARNESS_EXIT_LINE}\``)
  && HARNESS_ROWS_LINE < HARNESS_EXIT_LINE,
  'D3 README 引用的 harness 两行（自报 rows、按 fail 数退出）现在仍指得到那一行', `harness.mjs:${HARNESS_ROWS_LINE},${HARNESS_EXIT_LINE}`);

// ================================================================ D4 接线：verify.sh / ci.yml / package.json
eq(wc('tools/verify.sh'), Number((README.match(/`tools\/verify\.sh`（(\d+) 行）/) || [])[1]), 'D4a README §四 写的 verify.sh 行数 == 现在盘上的 verify.sh');
eq(wc('tools/playtest.mjs'), Number((README.match(/`tools\/playtest\.mjs`（(\d+) 行）/) || [])[1]), 'D4 README §四 写的 playtest 行数 == 盘上');
eq(wc('tools/bake.mjs'), Number((README.match(/`tools\/bake\.mjs`（(\d+) 行）/) || [])[1]), 'D4 README §四 写的 bake 行数 == 盘上');
eq(wc('tools/harness.mjs'), Number((README.match(/`tools\/harness\.mjs`（(\d+) 行）/) || [])[1]), 'D4 README §四 写的 harness 行数 == 盘上');
eq(wc('tools/doctest.mjs'), Number((README.match(/`tools\/doctest\.mjs`（(\d+) 行）/) || [])[1]), 'D4 README §四 写的 doctest 行数 == 盘上（这道闸自己也在台账上）');
eq(wc('tools/sabotage.mjs'), Number((README.match(/`tools\/sabotage\.mjs`（(\d+) 行）/) || [])[1]), 'D4 README §四 写的 sabotage 行数 == 盘上');
eq(wc('tools/assemble-site.sh'), Number((README.match(/`tools\/assemble-site\.sh`（(\d+) 行）/) || [])[1]), 'D4 README §四 写的 assemble 清单行数 == 盘上');
eq(wc('tools/deploy-set.mjs'), Number((README.match(/`tools\/deploy-set\.mjs`（(\d+) 行）/) || [])[1]), 'D4 README §四 写的部署集闸行数 == 盘上');
eq(wc('tools/deploy-set-selftest.mjs'), Number((README.match(/`tools\/deploy-set-selftest\.mjs`（(\d+) 行）/) || [])[1]), 'D4 README §四 写的部署集台架行数 == 盘上');
const toolsRows = all(between(README, /^\`tools\/\` 是九个东西/, /^\n五套浏览器场景/), /^\| `tools\/([\w.-]+)`（(\d+) 行）/gm);
ok(toolsRows.length === 9, 'D4b README §四 的 tools 清单解析到 9 件（改了 tools/ 就必须同步改这一段）', `${toolsRows.length} 件`);
ok(readdirSync(join(ROOT, 'tools')).sort().join(',')
  === toolsRows.map((r) => r[1]).sort().join(','), 'D4 tools/ 目录里就是这九件，一件不多一件不少', readdirSync(join(ROOT, 'tools')).join(','));
eq(`${/CDP_PORT=\$\{CDP_PORT:-(\d+)\}/.exec(VS)?.[1]} ${/WEB_PORT=\$\{WEB_PORT:-(\d+)\}/.exec(VS)?.[1]}`, '9361 5201', 'D4 verify.sh 的默认端口还是 9361 / 5201');
ok(/三个号写死在源码里：\*\*web 5201\*\*.*\*\*CDP 9361\*\*/s.test(README), 'D4 README §八 那两个端口号仍在（换成别的数就是文档自己漂了）', '§八 端口与 URL 形态');
eq([2, 3, 4, 5, 6, 7, 8].map((n) => new RegExp(`exit ${n}\\b`).test(VS)).join(','), 'true,true,true,true,true,true,true', 'D4 verify.sh 的七个退出码 2/3/4/5/6/7/8 逐个还在源码里');
eq(`${/WD_TIMEOUT:-(\d+)/.exec(VS)?.[1]}`, '420', 'D4 verify.sh 的看门狗预算 == 文档写的 420 s');
eq(`${/WD_TIMEOUT: (\d+)/.exec(CI)?.[1]}`, '240', 'D4 ci.yml 的 browser job 把看门狗压到 240 s');
eq(/SHOTS_DIR:-(\S+)\}/.exec(VS)?.[1], (README.match(/`SHOTS_DIR` 默认落在 `([^`\n]+)`/) || [])[1], 'D4 verify.sh 的 SHOTS_DIR 默认值 == README 写的那个路径');
ok(/LOGIC_ONLY/.test(VS) && /DOCS=\$\(node tools\/doctest\.mjs/.test(VS), 'D4 verify.sh 真的把文档闸接进了逻辑腿（LOGIC_ONLY 那条腿也跑它）', `doctest 接线在 verify.sh:${lineOf('tools/verify.sh', /DOCS=\$\(node tools\/doctest\.mjs/)}`);
eq((VS.match(/\$\(node tools\/doctest\.mjs/g) || []).length, 1, 'D4 verify.sh 只派生文档闸一次（两处调用就是两份真相）');
const ciDoctest = lineOf('.github/workflows/ci.yml', /run: node tools\/doctest\.mjs/);
const ciSabotage = lineOf('.github/workflows/ci.yml', /node tools\/sabotage\.mjs/);
ok(ciDoctest > 0 && ciSabotage > 0 && /"doctest": "node tools\/doctest\.mjs"/.test(read('package.json'))
  && /"sabotage": "node tools\/sabotage\.mjs"/.test(read('package.json')),
  'D4 CI、npm 脚本与 verify.sh 跑的是同一条命令（两道新闸都在 ci.yml 的 unit job 里）', `ci.yml:${ciDoctest}+${ciSabotage}`);
const scriptRows = all(between(README, /^`dependencies` 与/, /^\n单独跑其中一套/), /^\| `npm (?:run |)([\w:-]+)` \| .{0,60}?`([^`]+)`/gm);
ok(scriptRows.length >= 12, 'D4c README 二 的 scripts 表解析到至少 12 行', `${scriptRows.length} 行`);
for (const r of scriptRows) {
  const key = r[1];
  const docCmd = r[2].replace(/\\\|/g, '|');
  ok(!!PG.scripts[key] && PG.scripts[key] === docCmd, 'D4 npm 脚本的实际命令与 README 抄的逐字相同', `${key} · package.json 里是 ${JSON.stringify(PG.scripts[key])}`);
}
eq(Object.keys(PG.scripts).length, scriptRows.length, 'D4 README 那张表覆盖 package.json 的每一条 script（加一条脚本就要多一行表）', `${Object.keys(PG.scripts).length} 条 script / 表里 ${scriptRows.length} 条`);
ok(CI_CALLS_LEGS, 'D4 ci.yml 的 Syntax/Suites 两步直接调 `npm run check` / `npm run unit`（抄一份 inline glob 就是第二份真相：leg 改了 CI 不会跟着红）', `ci.yml:${lineOf('.github/workflows/ci.yml', /run: npm run check/)}+${lineOf('.github/workflows/ci.yml', /run: npm run unit/)}`);
eq(CHECK_FILES, Number((README.match(/本轮实测展开成 \*\*(\d+) 个文件\*\*/) || [])[1]), 'D4 check 的 glob 现在展开成多少个文件 == README 写的数');
eq(`${checkRun.status} ${/OK/.test(checkRun.stdout || '')}`, '0 true', 'D4 真跑一遍那条 node --check 循环：rc=0 且打印 OK');
eq(JSON.stringify([PG.dependencies, PG.devDependencies]), '[{},{}]', 'D4 两个依赖表都还是 {}（零依赖这条承诺）');
ok(/"doctest": "node tools\/doctest\.mjs"/.test(read('package.json')) && /"sabotage": "node tools\/sabotage\.mjs"/.test(read('package.json')), 'D4 package.json 里有 doctest 与 sabotage 两条脚本', 'scripts 段');

// ================================================================ D5 发货 32 关的读数
const ship5 = README.match(/(\d+) 关、\n合计 \*\*(\d+) 个合法首口、(\d+) 个胜口、(\d+) 个错误首口\*\*、总格数 (\d+)/);
ok(!!ship5, 'D5a README §五 那句发货合计解析到了（解析不到就是那句话被删了）', ship5 ? ship5[0].replace(/\n/g, '⏎').slice(0, 60) : '解析不到');
const shipSum = +ship5?.[1] === SHIPPED.lots && +ship5[2] === SHIPPED.legal && +ship5[3] === SHIPPED.k && +ship5[4] === SHIPPED.wrong && +ship5[5] === SHIPPED.cells;
ok(shipSum, 'D5 32 关 / 340 合法首口 / 44 胜口 / 296 错误首口 / 372 格 == 发货文件逐行加总',
  `文档 ${ship5?.slice(1, 6).join('/')} vs 现算 ${[SHIPPED.lots, SHIPPED.legal, SHIPPED.k, SHIPPED.wrong, SHIPPED.cells].join('/')}`);
eq(legalNow, SHIPPED.legal, 'D5 legal 之和与 legalBites() 现算的相同（README 说这三个数独立对过）');
eq(kNow, SHIPPED.k, 'D5 k 之和与 winningBitesOf() 现算的相同');
eq(statesNow, sum((l) => l.states), 'D5 states 之和与逐关 buildTable() 现算的相同');
eq(SHIPPED.legal - SHIPPED.k, SHIPPED.wrong, 'D5 错误首口 == 合法首口减胜口，且就是文档印的那个数');
const chanceRange = README.match(/`chance` 跨 \*\*([\d.]+)–([\d.]+)\*\*（即面板上的 ([\d.]+)–([\d.]+)%/);
eq(`${chanceRange?.[1]}–${chanceRange?.[2]}`, `${SHIPPED.chanceLo}–${SHIPPED.chanceHi}`, 'D5 文档的 chance 区间 == 发货表现算的最值');
eq(chanceRange ? `${chanceRange[3]}–${chanceRange[4]}` : '?', `${(SHIPPED.chanceLo * 100).toFixed(1)}–${(SHIPPED.chanceHi * 100).toFixed(1)}`, 'D5 面板上那两个百分数是同一个数的另一种写法');
const statesRange = README.match(/`states` 跨 (\d+)–(\d+)/);
eq(`${statesRange?.[1]}–${statesRange?.[2]}`, `${SHIPPED.statesLo}–${SHIPPED.statesHi}`, 'D5 文档的 states 区间 == 发货表现算的最值');
const designShip = DESIGN.match(/(\d+) 关合计 (\d+) 个合法首口、(\d+) 个胜口[\s\S]*?错误首口/);
eq(designShip ? `${designShip[1]}/${designShip[2]}/${designShip[3]}` : '?', `${SHIPPED.lots}/${SHIPPED.legal}/${SHIPPED.k}`, 'D5 DESIGN §6 那份合计与 README、发货文件三方一致');
const tierPct = (README.match(/`chance` 区间是 `shoal ([\d.]+)–([\d.]+)% \/ linked ([\d.]+)–([\d.]+)% \/ twined ([\d.]+)–([\d.]+)% \/ master ([\d.]+)–([\d.]+)%`/) || []).slice(1);
ok(TIERS.every((t, i) => bandStats[t].pct === `${tierPct[i * 2]}-${tierPct[i * 2 + 1]}`), 'D5 四档发货的赢率区间 == 发货表现算', `${tierPct.join('-')} vs ${TIERS.map((t) => bandStats[t].pct).join(' / ')}`);
const tierStates = (README.match(/各档发货的 `states` 也不成序（([\d–]+) \/ ([\d–]+) \/ ([\d–]+) \/ ([\d–]+)[^）]*）/) || []).slice(1);
ok(TIERS.every((t, i) => bandStats[t].states.replace('-', '–') === tierStates[i]), 'D5 各档发货的 states 区间 == 现算（文档用它论证档位不等于难度）', `${tierStates.join(' ')} vs ${TIERS.map((t) => bandStats[t].states).join(' ')}`);
const thin = README.match(/最薄的是 `master-01` `(\[[\d,]+\])`、`master-02` `(\[[\d,]+\])`、`master-03` `(\[[\d,]+\])` 三关并列\*\* ——\n(\d+) 个合法首口里只有 (\d+) 口赢，`chance` 都是 ([\d.]+)/);
ok(!!thin, 'D5c README 那三关并列最薄解析到了', thin ? `${thin[1]} ${thin[4]}/${thin[5]}` : '解析不到');
ok(['master-01', 'master-02', 'master-03'].every((id, i) => JSON.stringify(byId[id].shape) === thin[1 + i].replace(/(\d+),(\d+)/g, '$1,$2')), 'D5 三关的形状逐字 == 发货文件', ['master-01', 'master-02', 'master-03'].map((id) => JSON.stringify(byId[id].shape)).join(' '));
ok([1, 2, 3].every(() => byId['master-01'].legal === +thin[4] && byId['master-01'].k === +thin[5] && byId['master-01'].chance === +thin[6])
  && byId['master-02'].chance === +thin[6] && byId['master-03'].chance === +thin[6], 'D5 三关的 legal/k/chance == 文档印的（1 口赢 17 口，0.058824）', `现算 ${byId['master-01'].k}/${byId['master-01'].legal}=${byId['master-01'].chance}`);
const fourth = README.match(/`linked-01` `(\[[\d,]+\])`（(\d+) 口里 (\d+) 口，([\d.]+)，覆盖 (\d+) 个局面）/);
ok(fourth && JSON.stringify(byId['linked-01'].shape) === `[${fourth[1].slice(1, -1)}]` && +fourth[2] === byId['linked-01'].legal && +fourth[3] === byId['linked-01'].k
  && +fourth[4] === byId['linked-01'].chance && +fourth[5] === byId['linked-01'].states, 'D5 第四薄 linked-01 那一行的五个数 == 发货文件', `现算 ${JSON.stringify(byId['linked-01'].shape)} ${byId['linked-01'].legal}/${byId['linked-01'].k}=${byId['linked-01'].chance} states ${byId['linked-01'].states}`);
const thickest = README.match(/最厚的是 `twined-08` `(\[[\d,]+\])`（(\d+) 口里 (\d+) 口，([\d.]+)）/);
ok(thickest && JSON.stringify(byId['twined-08'].shape) === `[${thickest[1].slice(1, -1)}]` && +thickest[2] === byId['twined-08'].legal && +thickest[3] === byId['twined-08'].k && +thickest[4] === byId['twined-08'].chance,
  'D5 最厚那关 twined-08 == 发货文件（5 口里 3 口，0.6）', `现算 ${byId['twined-08'].legal}/${byId['twined-08'].k}=${byId['twined-08'].chance}`);
const worstClaim = README.match(/可达集最大的一关同样是 `([\w-]+)`：\*\*(\d+)\*\* 局面 \/ \*\*(\d+)\*\* 条边/);
ok(worstClaim && worstClaim[1] === worst.id && +worstClaim[2] === worstTable.states && +worstClaim[3] === worstTable.bites,
  'D5 可达集最大的一关与其 states/bites == 本轮逐关重建表的结果', `现算 ${worst.id} ${worstTable.states}/${worstTable.bites} vs 文档 ${worstClaim?.slice(1, 4).join(' ')}`);
eq(byId['master-01'].states, worst.states, 'D5 §五 里 master-01 的 states 与"最贵那关"是同一个数');
ok(TIERS.every((t) => meta[t].acceptPct === bandStats[t].acceptPct * 1 || Math.abs(meta[t].acceptPct - bandStats[t].acceptPct) < 0.05),
  'D5 TIERS_META.acceptPct == 发货数 / 候选数（README 特别警告过的那个口径）', TIERS.map((t) => `${meta[t].acceptPct}/${bandStats[t].acceptPct}`).join(' '));
ok(TIERS.every((t) => meta[t].cands === census[t].cands && meta[t].lots === bandStats[t].lots && meta[t].statesCap === M.MAX_STATES),
  'D5 TIERS_META 的 cands / lots / statesCap 三列 == 现算', TIERS.map((t) => `${meta[t].cands}/${meta[t].lots}`).join(' '));
ok(DAILY_IDS.length === LOTS.length && LOTS.length === 32 && TIERS.every((t) => bandStats[t].lots === 8), 'D5 每日池就是发货的 32 关，每档 8 关', `${DAILY_IDS.length}/${LOTS.length}`);
const wrongFloor = Number((src('test/game.test.mjs').find((l) => /ok\(wrongFirsts >= (\d+)/.test(l)) || '').match(/>= (\d+)/)?.[1]);
ok(SHIPPED.wrong > wrongFloor && /它自己钉的下限只有 `wrongFirsts >= (\d+)`/.test(README) && +RegExp.$1 === wrongFloor,
  'D5 那条 wrongFirsts 地板 == 测试源码里的数，且发货的 296 远过地板（文档写的是循环真跑到的数）', `地板 ${wrongFloor} / 实测 ${SHIPPED.wrong}`);
ok(TIERS.every((t) => LOTS.filter((l) => l.shape.length === 2 && l.tier === t).every((l) => l.k === 1)) && FX.TWO_ROW_P.length === 8,
  'D5 两行发货关的 k 恒为 1（阶梯就在旁边那句话的证据）', LOTS.filter((l) => l.shape.length === 2).map((l) => l.k).join(','));

// ================================================================ D6 行号引用：逐条找到那一行
const CITES = [
  ['tools/bake.mjs', /Cross-check the two independent routes/, 'tools/bake.mjs:89-101'],
  ['tools/bake.mjs', /const roundTrip = decodeBook\(book\)/, 'tools/bake.mjs:46-57'],
  ['tools/bake.mjs', /export const BAKED_AT/, 'tools/bake.mjs:197'],
  ['tools/bake.mjs', /writeFileSync\(outPath/, 'tools/bake.mjs:221'],
  ['js/core/shapes.js', /export function validateShape/, 'js/core/shapes.js:50-63'],
  ['js/core/shapes.js', /if \(shape\.length === 0\)/, 'js/core/shapes.js:52'],
  ['js/core/shapes.js', /export function legalBites/, 'js/core/shapes.js:104-114'],
  ['js/core/shapes.js', /for \(let c = \(r === 0/, 'js/core/shapes.js:111'],
  ['js/core/shapes.js', /export function isLegalBite/, 'js/core/shapes.js:116-124'],
  ['js/core/shapes.js', /return isTerminal\(shape\) \? '只剩毒格/, 'js/core/shapes.js:133'],
  ['js/core/shapes.js', /export const MAX_ROWS = 4/, 'js/core/shapes.js:20-22'],
  ['js/view.js', /function goneSquares/, 'js/view.js:476-483'],
  ['js/core/game.js', /Terminal convention/, 'js/core/game.js:6-11'],
  ['js/core/game.js', /status: 'playing', \/\/ playing \| won \| lost/, 'js/core/game.js:36'],
  ['js/core/game.js', /export function classifyNow/, 'js/core/game.js:59-69'],
  ['js/core/game.js', /const forced = isTerminal/, 'js/core/game.js:80-88'],
  ['js/core/game.js', /return \{ state: \{ \.\.\.state, line: '不能这样咬/, 'js/core/game.js:88'],
  ['js/core/game.js', /if \(isTerminal\(next\)\) return finish/, 'js/core/game.js:101'],
  ['js/core/game.js', /export function hintAt/, 'js/core/game.js:145-155'],
  ['js/core/game.js', /export function undoRound/, 'js/core/game.js:161-184'],
  ['js/core/book.js', /export function lookup/, 'js/core/book.js:58-65'],
  ['js/core/book.js', /export function classify\(/, 'js/core/book.js:76-79'],
  ['js/core/book.js', /export function winningBitesOf/, 'js/core/book.js:89-100'],
  ['js/core/book.js', /export function report/, 'js/core/book.js:104-118'],
  ['js/core/book.js', /chance: winning\.length/, 'js/core/book.js:114'],
  ['js/core/library.js', /export function verifyLot/, 'js/core/library.js:53-81'],
  ['js/core/library.js', /if \(lot\.winner !== '先手'\)/, 'js/core/library.js:56'],
  ['js/core/library.js', /if \(lot\.chance !== Number/, 'js/core/library.js:75'],
  ['js/core/library.js', /export function printChance/, 'js/core/library.js:100-102'],
  ['js/core/library.js', /export function dailyLot/, 'js/core/library.js:106-127'],
  ['js/core/make.js', /export function eligibility/, 'js/core/make.js:71-82'],
  ['js/core/make.js', /why: 'p-position'/, 'js/core/make.js:77'],
  ['js/core/make.js', /export const MAX_STATES/, 'js/core/make.js:86'],
  ['js/core/solve.js', /Tweed's theorem/, 'js/core/solve.js:219-223'],
  ['js/core/solve.js', /export function rectangleIdealCount/, 'js/core/solve.js:255-257'],
  ['js/core/solve.js', /export function subIdealCount/, 'js/core/solve.js:261-275'],
  ['js/core/storage.js', /const KEY = 'chomp\.save\.v1'/, 'js/core/storage.js:15'],
  ['js/core/storage.js', /export function requireBackend/, 'js/core/storage.js:21-25'],
  ['js/core/storage.js', /export function persistent/, 'js/core/storage.js:248-256'],
  ['js/core/anim.js', /a\.accumulator \+= elapsed/, 'js/core/anim.js:79'],
  ['js/main.js', /function routeTo/, 'js/main.js:46-65'],
  ['js/main.js', /location\.hash = `#\/random/, 'js/main.js:61'],
  ['js/main.js', /npm run unit 复算这些数/, 'js/main.js:125'],
  ['js/main.js', /const par = Math\.max\(1, Math\.ceil\(Math\.log2\(lot\.cells\)\)\)/, 'js/main.js:161'],
  ['index.html', /name="description"/, 'index.html:8'],
  ['index.html', /class="legend"/, 'index.html:81'],
  ['server.cjs', /function startServer\(\{ port = 5201/, 'server.cjs:49'],
  ['server.cjs', /Number\(process\.argv\[2\]\)/, 'server.cjs:60'],
  ['package.json', /"check": "for f in/, 'package.json:12'],
  ['package.json', /"dependencies": \{\}/, 'package.json:34-35'],
  ['electron/main.cjs', /startServer\(\{ port: 0 \}\)/, 'electron/main.cjs:7-8'],
  ['assets/gen/make_art.py', /def png_dims/, 'assets/gen/make_art.py:383'],
  ['tools/playtest.mjs', /process\.env\.CDP_PORT \|\| 9361/, 'tools/playtest.mjs:20'],
  ['tools/playtest.mjs', /const ORIGIN = new URL\(BASE\)\.origin/, 'tools/playtest.mjs:23-24'],
  ['tools/playtest.mjs', /async function pointerScenario/, 'tools/playtest.mjs:180-344'],
  ['tools/playtest.mjs', /stars: await runJS/, 'tools/playtest.mjs:244'],
  ['tools/playtest.mjs', /const SCENARIOS = \{/, 'tools/playtest.mjs:347'],
  ['tools/playtest.mjs', /the canvas has real pixels/, 'tools/playtest.mjs:372-381'],
  ['tools/playtest.mjs', /getEntriesByType\('resource'\)/, 'tools/playtest.mjs:398-409'],
  ['tools/playtest.mjs', /结束后真点击一律不计数/, 'tools/playtest.mjs:338-341'],
  ['tools/harness.mjs', /export function test\(/, 'tools/harness.mjs:12-21'],
  ['tools/verify.sh', /CDP_PORT=\$\{CDP_PORT:-9361\}/, 'tools/verify.sh:23'],
  ['tools/verify.sh', /---- pre-flight/, 'tools/verify.sh:100'],
  ['tools/verify.sh', /MIN_LOGIC_ROWS=\$\{MIN_LOGIC_ROWS/, 'tools/verify.sh:31'],
  ['tools/verify.sh', /DOCS=\$\(node tools\/doctest\.mjs/, 'tools/verify.sh:64'],
  ['tools/verify.sh', /SAB=\$\(node tools\/sabotage\.mjs/, 'tools/verify.sh:81'],
  ['tools/verify.sh', /DOCTEST_ROWS_WANT=\$\{DOCTEST_ROWS_WANT:/, 'tools/verify.sh:34'],
  ['tools/verify.sh', /SABOTAGE_KNIVES_WANT=\$\{SABOTAGE_KNIVES_WANT:/, 'tools/verify.sh:38'],
  ['tools/doctest.mjs', /^const EXPECT_ROWS = \d+;/, 'tools/doctest.mjs:794'],
  ['tools/verify.sh', /print\("rows:"/, 'tools/verify.sh:200'],
  ['tools/verify.sh', /sys\.exit\(1 if d\.get\("fail"\)/, 'tools/verify.sh:203'],
  ['test/fixture.mjs', /Source: the classical Chomp result/, 'test/fixture.mjs:112-113'],
  ['test/fixture.mjs', /export const TWO_ROW_P/, 'test/fixture.mjs:114'],
  ['test/fixture.mjs', /export const SINGLE_ROW_N/, 'test/fixture.mjs:117'],
  ['test/anchor.test.mjs', /45 - 8/, 'test/anchor.test.mjs:53'],
  ['test/anchor.test.mjs', /^for \(const h of HAND\)/, 'test/anchor.test.mjs:156-165'],
  ['test/model.test.mjs', /ok\(n > 500/, 'test/model.test.mjs:171'],
  ['test/solve.test.mjs', /eq\(checked, 419/, 'test/solve.test.mjs:124'],
  ['test/solve.test.mjs', /worstStates <= 419/, 'test/solve.test.mjs:188'],
  ['test/solve.test.mjs', /worstMs <= 50/, 'test/solve.test.mjs:189'],
  ['test/book.test.mjs', /两行情形在棋书里的刻画/, 'test/book.test.mjs:164-180'],
];
const citeBad = [];
for (const [f, re, token] of CITES) {
  const want = Number(token.split(':')[1].match(/^\d+/)[0]);
  const got = lineOf(f, re);
  const ref = token.split(':')[1];
  const inDoc = Object.entries(DOCS).some(([, t]) => t.includes(`${f}:${ref}`));
  if (got !== want || !inDoc) citeBad.push(`${token} → 现在在 :${got}${inDoc ? '' : '（文档已不引用它）'}`);
  ok(got === want && inDoc, 'D6 文档引用的那一行号仍指回原来那段代码', `${f}:${ref} → 现在数到 :${got}${inDoc ? '' : '，且文档里已找不到这个引用'}`);
}
ok(citeBad.length === 0, 'D6a 上面那张引用清单里没有被改动过的行号', citeBad.join(' / ') || '全部命中');
const rangeBad = [];
let citeTotal = 0;
for (const [name, text] of Object.entries(DOCS)) {
  for (const m of all(text, /`?([A-Za-z0-9_./-]+\.(?:js|mjs|cjs|sh|py|html|json|yml|md|webmanifest))`?:([0-9]+)(?:-([0-9]+))?/g)) {
    citeTotal += 1;
    const f = m[1];
    const n = Number(m[2]);
    const e2 = Number(m[3] || m[2]);
    const s = src(f === name ? name : f);
    if (!s) { rangeBad.push(`${name} 里引用了仓外的 ${f}:${m[2]}`); continue; }
    if (e2 > s.length - 1) rangeBad.push(`${f}:${m[2]}-${e2} 越界（${f} 只有 ${s.length - 1} 行）`);
  }
}
ok(citeTotal >= 110, `D6b 三份文档共有 ${citeTotal} 处行号引用，全部纳入范围校验（少一批就是引用被成段删了）`, `${citeTotal} 处`);
ok(rangeBad.length === 0, 'D6c 每一处行号引用都还在文件长度之内，且没有指向仓外的路径', rangeBad.slice(0, 6).join(' / ') || '无越界');

// ================================================================ D7 逐字文案、常量与文件规格
const msgs = [
  [SH.validateShape([]), 'shape 为空（毒格也已被咬掉，不是可行动的局面）'],
  [SH.validateShape([2, 3]), '第 1 行长度 3 大于上一行 2：序理想不允许悬空的格子'],
  [SH.biteReason([3, 2], [0, 0]), '毒格不能主动咬'],
  [SH.biteReason([1], [0, 0]), '只剩毒格：咬下去即输'],
];
for (const [got, want] of msgs) ok(README.includes(want) && got === want, `D7 README 抄的那句拒绝文案 == 现在真抛出来的`, `${got}`);
// 「不在棋书里」这句在 DESIGN §4 里被当成交付语义引用（deliverable.md 从未引它），「本局已结束」在
// README §三 的拒绝文案那一格里——两句都必须是源码里真抛的那句，否则文档引用的是不存在的措辞。
ok(DESIGN.includes('不在棋书里') && /不在棋书里/.test(read('js/core/book.js'))
  && README.includes('本局已结束') && /本局已结束/.test(read('js/core/game.js')),
  'D7 文档里引的两条系统措辞（不在棋书里 / 本局已结束）确实写在源码里', 'DESIGN 四 + README 三 · book.js / game.js');
eq(SH.applyBite([4, 4], [0, 2]).join(','), '2,2', 'D7 README §三 印的 applyBite([4,4],[0,2]) = [2,2] 是真结果');
eq(SH.applyBite([5, 4, 3], [2, 0]).join(','), '5,4', 'D7 README §三 印的 applyBite([5,4,3],[2,0]) = [5,4] 是真结果');
ok(README.includes('`par = Math.max(1, Math.ceil(Math.log2(lot.cells)))`') && src('js/main.js')[160].includes('Math.max(1, Math.ceil(Math.log2(lot.cells)))'),
  'D7 文档抄的 stars 公式与 main.js 里那句逐字相同', `main.js:${lineOf('js/main.js', /const par = /)}`);
eq(Math.max(1, Math.ceil(Math.log2(byId['master-01'].cells))), Math.ceil(Math.log2(18)), 'D7 星星那条式子对 master-01（18 格）算得出 5');
ok(README.includes("hashSeed('chomp-daily:' + YYYY-MM-DD)") || /chomp-daily:/.test(README), 'D7 每日一题的种子串在文档里写对了', `library.js:${lineOf('js/core/library.js', /chomp-daily:/)}`);
ok(/chomp-random:&lt;tier&gt;:&lt;seed|chomp-random:<tier>:<seed>/.test(README) && src('js/core/library.js')[131].includes('chomp-random:'),
  'D7 随机题的种子串 chomp-random:<tier>:<seed> == library.js 现值', `library.js:${lineOf('js/core/library.js', /chomp-random:/)}`);
ok(README.includes('`chomp.save.v1`') && src('js/core/storage.js')[14].includes("'chomp.save.v1'"), 'D7 存档键名文档与源码同串', 'storage.js:15');
ok(README.includes('chomp-cos-v2') && /chomp-cos-v2/.test(read('sw.js')), 'D7 service worker 版本号文档与源码同串', `sw.js:${lineOf('sw.js', /chomp-cos-v2/)}`);
ok(README.includes('chomp-lots-v1') && SCHEMA === 'chomp-lots-v1', 'D7 发货棋书的 SCHEMA 文档与 lots.js 同串', SCHEMA);
ok(README.includes('2026-09-27T10:19:32.740Z') && BAKED_AT === '2026-09-27T10:19:32.740Z', 'D7 BAKED_AT 文档抄的就是 lots.js 里那个时间戳', BAKED_AT);
ok(/SIM_STEP=1\/120/.test(README) && /export const SIM_STEP = 1 \/ 120/.test(read('js/core/anim.js')), 'D7 anim 的 SIM_STEP 文档写 1/120 == 源码', 'anim.js:12');
ok(/MAX_STEPS=20/.test(README) && /export const MAX_STEPS = 20/.test(read('js/core/anim.js')), 'D7 anim 的 MAX_STEPS 文档写 20 == 源码', 'anim.js:13');
// 证明抽屉末尾那一行印给玩家的是**命令**而不是数字：本轮就是因为它留着一句在 CI 的 node 22 上必红的
// `node --test test/` 才换成 `npm run unit`。同一句话住在两处（页面与文档），所以逐字比而不但比文档。
ok(/npm run unit 复算这些数/.test(README) && /npm run unit 复算这些数/.test(read('js/main.js')),
  'D7 证明抽屉末尾那句复现命令：文档抄的与 js/main.js 印给玩家的逐字同一句', `main.js:${lineOf('js/main.js', /npm run unit 复算这些数/)}`);
const fileFacts = [
  ['manifest.webmanifest', /（27 行 \/ 1,440 B）/, 27, 1440],
  ['sw.js', /同名带版本缓存 chomp-cos-v2（92 行）/, 92, null],
  ['js/pwa.js', /注册器（31 行）/, 31, null],
  ['css/game.css', /样式（207 行 \/ 8,941 B）/, 207, 8941],
  ['js/core/anim.js', /固定步长模拟（150 行）/, 150, null],
  ['assets/gen/make_art.py', /（448 行 \/ 19,039 B/, 448, 19039],
  ['tools/playtest.mjs', /（592 行 \/ 38,193 B）/, 592, 38193],
  ['tools/sabotage.mjs', /（237 行）/, 237, null],
  ['js/data/lots.js', /（本轮实测 15,266 B/, null, 15266],
];
for (const [f, re, wantL, wantB] of fileFacts) {
  ok(re.test(README) && (wantL === null || wc(f) === wantL) && (wantB === null || bytes(f) === wantB), `D7 §六 里 ${f} 标称的行数／字节数 == 盘上现值`, `${wc(f)} 行 / ${bytes(f)} B`);
}
eq(Math.round(bytes('js/data/lots.js') / 1024 * 10) / 10, 14.9, 'D7 DESIGN §7 说发货文件 14.9 kB == lots.js 现在的大小');
eq(`${(bytes('js/data/lots.js') / 1024).toFixed(1)}`, (DESIGN.match(/发货文件 ([\d.]+) kB/) || [])[1], 'D7 DESIGN 那句 kB 与 README 的字节数是同一个数');
const mf = JSON.parse(read('manifest.webmanifest'));
const mfClaims = all(between(README, /^manifest\.webmanifest /, /^sw\.js /), /(\d+) 个 (icons|shortcuts)/g);
ok(mfClaims.length === 2 && mf.icons.length === +mfClaims[0][1] && mf.shortcuts.length === +mfClaims[1][1], 'D7 manifest 的 icons／shortcuts 个数 == 文件里的 JSON', `icons ${mf.icons.length} shortcuts ${mf.shortcuts.length}`);
ok(mf.display === 'standalone' && mf.start_url === './' && mf.scope === './' && mf.display_override.length === 2 && mf.orientation === 'any' && mf.lang === 'zh-CN',
  'D7 README 列的那几个 manifest 字段 == manifest.webmanifest 现值', `${mf.display}/${mf.start_url}/${mf.display_override.length} override/${mf.lang}`);
const legend = src('index.html').filter((l) => /class="legend"|class="tut-keys"/.test(l));
ok(legend.length === 2, 'D7 页面上那两段键盘说明解析到 2 行（键位只有这两处印出来）', `${legend.length} 行`);
const kbds = [...new Set(legend.flatMap((l) => [...l.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1])))];
// onKeyDown 那一段要按**行**取（read() 给的是整篇字符串，slice 会切成字符），窗口从函数那一行到
// switch 的收尾，全部 case 都在里面；取完必须 join 回字符串，否则 `.test(数组)` 是按逗号拼接、
// `KEYS.split` 直接炸——那是闸自己坏了，不是文档坏了。
const KEYS_START = lineOf('js/main.js', /function onKeyDown/);
const KEYS = src('js/main.js').slice(KEYS_START - 1, KEYS_START + 33).join('\n');
// 页面上印的是**键名**，`switch` 里比的是 `event.key` 的**取值**：空格那枚标准值是 `' '`
// （旧 WebKit 叫 `'Spacebar'`），方向键是四枚 `Arrow*`。对不上这层别名，`<kbd>Space</kbd>`
// 就永远指不到一个真存在的 case——那是闸读错了页面，不是页面写错了键。
const KEY_ALIASES = { '方向键': ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], 'Space': [' ', 'Spacebar'] };
const handled = (s) => (KEY_ALIASES[s] || [s]).every((v) => KEYS.split('\n').some((l) => l.includes(`case '${v}'`)));
ok(kbds.length >= 8 && kbds.every(handled), `D7 页面印的每个键位（${kbds.length} 个）都真在 onKeyDown 的 switch 里`, kbds.join(' '));
ok(/Enter/.test(KEYS) && /' '/.test(KEYS) && /Spacebar/.test(KEYS), 'D7 Enter／Space 两个咬击键都在源码里（文档写了 Space）', 'main.js onKeyDown');
ok((README.match(/18 张真 PNG（无一张 0 字节、无 SVG 冒充）/) || []).length === 1, 'D7 §六 那句「18 张真 PNG」还在（拔掉一句就少一条判据）', 'README §六');
eq(`${ASSET.want} / ${ASSET.missing} / ${ASSET.zero} / ${ASSET.big}`, (README.match(/应存在 (\d+) 张 \/ 缺失 (\d+) \/ 0字节 (\d+) \/ 边长≥180 (\d+) 张/) || []).slice(1).join(' / '),
  'D7 资产四项读数（把 make_art.py 的期望表读进来，用 IHDR 现量）== README 那一格');
eq(ASSET.digest, (README.match(/sha256\[:12\] = (\w{12})/) || [])[1], 'D7 盘上资产指纹 == 文档写的那个 sha256[:12]（重跑重烘也是它）');
eq(ICON_SIZES.length, 10, 'D7 make_art.py 的 ICON_SIZES 是 10 档（README 说 13 张母题图标 = 10 + 3）');
eq(`${ICON_SIZES.length + 3}+4+1`, `${readdirSync(join(ROOT, 'assets/icons')).length}+${readdirSync(join(ROOT, 'assets/textures')).length}+${readdirSync(join(ROOT, 'assets/og')).length}`, 'D7 图标 13 + 贴图 4 + og 1 == 盘上三个目录');
eq(`${/SEED_GRAIN = (\d+)/.exec(PY)?.[1]}`, (README.match(/`SEED_GRAIN = (\d+)`/) || [])[1], 'D7 文档写的固定种子 == make_art.py 现值');
ok(/C\(r\+w, ?r\) ?- ?1/.test(DESIGN) && /C\(r\+w,r\)-1/.test(README.replace(/\n/g, '')) && S.rectangleIdealCount(2, 8) === 44,
  'D7 文档引用的矩形闭式 C(r+w,r)-1 == solve.js 现在算出来的（linked-01 的 44 个局面）', `C(10,2)-1 = ${S.rectangleIdealCount(2, 8)}`);

// ================================================================ D8 浏览器场景的静态点数
const recClaim = README.match(/boot (\d+) \/ play (\d+) \/ routes (\d+) \/ save (\d+) \/ pointer (\d+) 个调用点/);
ok(!!recClaim, 'D8a README §七 那句五个场景的调用点计数解析到了', recClaim ? recClaim[0].slice(0, 50) : '解析不到');
const recWant = recClaim ? { boot: +recClaim[1], play: +recClaim[2], routes: +recClaim[3], save: +recClaim[4], pointer: +recClaim[5] } : {};
for (const s of ['boot', 'play', 'routes', 'save', 'pointer']) eq(REC[s], recWant[s], 'D8 场景的 rec() 调用点数 == 文档写的数', `@${s}`);
const normalClaims = [...README.matchAll(/⇒ 正常路径 (\d+) 行/g)].map((m) => m[1]);
eq(NORMAL.routes, normalClaims[0], 'D8 routes 的正常路径 = 调用点 - 循环内那条 + 档数 == 文档写的数');
eq(NORMAL.pointer, normalClaims[1], 'D8 pointer 的正常路径 = 调用点 - 两条循环内失败行 - 两对 else == 文档写的数');
eq(NORMAL_TOTAL, (README.match(/合计\*\*正常路径 (\d+) 行\*\*/) || [])[1], 'D8 五套场景正常路径合计 == 文档写的那个数');
eq(POINTER_LOOP_FAILS + POINTER_ELSE_PAIRS, 4, 'D8 @pointer 那 4 条非正常路径的行仍能按源码结构数出来（2 条 while + 2 对 else）', `${POINTER_LOOP_FAILS} + ${POINTER_ELSE_PAIRS}`);
eq(ROUTES_LOOP_RECS, 1, 'D8 @routes 循环里的那一条 rec() 仍然只有一条（多一条就得重算正常路径）', `${ROUTES_LOOP_RECS}`);
eq(Object.values(REC).reduce((a, x) => a + x, 0), (PT.match(/\brec\(/g) || []).length, 'D8 五段切分互不重叠：逐段点数之和 == 全文 rec() 数');
ok(/四套是页面里跑的 JS/.test(README) && /真鼠标/.test(README), 'D8 「四套页内 + 一套真鼠标」的分工措辞还在', 'README §四');

// ================================================================ D9 墙钟：只钉出处与方向，绝不重测
ok(README.includes('**墙钟数字不进本文**'), 'D9 文档纪律那句「墙钟数字不进本文」还在（删掉它就是允许下轮再写毫秒）', 'README 一');
const readmeMs = all(README, /(\d+(?:\.\d+)?) ?ms\b/g).map((m) => m[1]);
eq(readmeMs.join(','), '50', 'D9 README 里出现的毫秒数字只有 solve.test 的那条门线（写进新读数就是这条红）', readmeMs.join(','));
eq(`${/worstMs <= (\d+)/.exec(read('test/solve.test.mjs'))?.[1]}`, readmeMs[0], 'D9 那条 ms 门线的出处确实在 solve.test.mjs 里（方向：断言在那儿，文档只引用）');
eq(`${/worstStates <= (\d+)/.exec(read('test/solve.test.mjs'))?.[1]}`, M.MAX_STATES, 'D9 那条 states 门线与 make.js 的 MAX_STATES 是同一个数（文档引用的方向）');
const designHead = DESIGN.slice(0, DESIGN.search(/^## 6\./m));
const designReadings = src('DESIGN.md').slice(0, wc('DESIGN.md')).filter((l) => designHead.includes(l) && /0\.\d+ ?s/.test(l));
ok(designReadings.length >= 3 && designReadings.every((l) => l.includes('出处见 §6')),
  'D9 DESIGN 前三节里每一处 0.0x s 读数都挂着「出处见 §6」', `${designReadings.length} 行读数：${designReadings.map((l) => l.slice(0, 18)).join(' / ')}`);
ok(DESIGN.includes('数字来自 2026-09-27 本机那一次 `node tools/bake.mjs`'), 'D9 DESIGN 六 的标题那句出处声明还在（换日期必须换这句）', 'DESIGN §6 标题');
ok(DELIV.includes('（本机 2026-09-27）') && DELIV.includes('主代理 2026-09-27 实抓'), 'D9 deliverable 的两块墙钟读数都挂着「那一次」的出处', '2026-09-27 标注 ×2');

// ================================================================ D10 unpinned：钉不住，但也不许被删
const UNPINNED = [
  ['deliverable 摘要行：2026-09-27 那一次的浏览器 85 行 / @boot 15', 'deliverable.md', /85 行，0 失败（@boot 15 \/ @play 20 \/ @routes 17 \/ @save 12 \/ @pointer 21）/],
  ['deliverable 摘要行：同一轮记的 node 165 行 / tests 8', 'deliverable.md', /165 行，0 失败（`node --test test\/` → tests 8 \/ pass 8 \/ fail 0）/],
  ['deliverable 验收结论那整块转录（含 boot lot 与 ALL GREEN）', 'deliverable.md', /^boot lot: shoal-01$/m],
  ['deliverable 的 bake 原样输出（毫秒与 per-shape solve 行）', 'deliverable.md', /book: 419 positions \(36 P \/ 383 N\) in 0\.029s/],
  ['deliverable 的线上抓包字节表（4,091 / 17,550 / 4,582）', 'deliverable.md', /\| `\/` \| 200 \/ 4,091 B \|/],
  ['deliverable 记录的发布 sha 与 CI trigger', 'deliverable.md', /发布 sha `cb80ee9`，CI trigger `6929c2f`/],
  ['deliverable 的改动表（八条历史缺陷记录，逐条都是那一次的事实）', 'deliverable.md', /fixture 里 `\[4,3\]` 的 `states` 手算成 11/],
  ['deliverable 那句浏览器跑了 3 次的诚实说明', 'deliverable.md', /`tools\/verify\.sh` 跑了 3 次/],
  ['README 一 的机器规格（Darwin／核数／node 版本）', 'README.md', /机器 Darwin [\d.]+ \w+、\d+ 核、node v[\d.]+/],
  ['README 七.1 那一轮 verify.sh 被自己的预检拒了（rc=8 与那台孤儿 Chrome）', 'README.md', /`rc=8`，日志点名这台机器上已有一个带 `--remote-debugging-port=\d+`/],
  ['README 四 末段那一轮浏览器腿的逐套实测读数（跑过才写得出来，闸不复跑 Chrome 所以不重言）', 'README.md', /@boot 21 \/ @play 20 \/ @routes 17 \/ @save 12 \/ @pointer 21`\n（本机 2026-10-04/],
  ['README 一 anim 那一格的变异体读数（要临时改文件才能复现）', 'README.md', /本轮实测红 2 行：`\[136,136,136\]` 与 `2 ≠ 20`/],
  ['README 一 anim 那一格的「假红目标」读数（六行全绿）', 'README.md', /则六行全绿/],
  ['README 里「本轮之前是八行 165」这句历史说明', 'README.md', /本轮之前是八行 165/],
  ['README 一 资产那一格：本机没有 Pillow，所以那条 python3 命令本轮跑不起来（缺陷，不是省略）', 'README.md', /本机没有 Pillow/],
  ['README 六 那句「拔掉 assets 页面照样能画」', 'README.md', /拔掉 `assets\/` 页面照样能画/],
  ['DESIGN 三 的 0.03 s 出处句（墙钟读数，只引不测）', 'DESIGN.md', /穷举完它耗时 0\.03 s——那是读数，出处见 §6 计时量/],
  ['DESIGN 四 表格里的 ms／s 读数（同一轮 bake 的记账）', 'DESIGN.md', /实测最贵 0\.02 s，出处见 §6 计时量/],
  ['deliverable 未实现清单那一条（2026-09-27 那轮记的是「音效／动画过渡／贴图素材一律没有」；本轮已经发货了真位图与 WebAudio，所以那句话只能作为**那一轮**的事实留在记录里，不许当成现状引用）', 'deliverable.md', /音效、动画过渡、巧克力块的贴图素材：一律没有/],
];
for (const [what, file, re] of UNPINNED) ok(re.test(DOCS[file]), 'D10 unpinned 清单里的那句话还在文档里', `${file} · ${what}`);
ok(UNPINNED.length >= 14, 'D10a unpinned 清单登记了不少于 14 处墙钟与一次性读数', `${UNPINNED.length} 处`);
ok(/不承诺浏览器闸在每个回合都复跑得到/.test(README), 'D10b README 七.1 仍写着浏览器读数**是带日期的一次观测**（一次绿不等于每轮绿）', 'README 七.1');

// ================================================================ D11 破坏试验台账 == sabotage.mjs
const SAB = read('tools/sabotage.mjs');
const ledger = all(between(README_RAW, /^### 破坏试验台账/, /^\n### |^\n---$/), /^\| (S\d+) \| (.+?) \| `([^`]+)` \| `(.+?)` \| `(.+?)` \| (.+?) \| (\?|\d+) \|$/gm);
const knifeIds = all(SAB, /^  \{ id: '(S\d+)'/gm).map((m) => m[1]);
ok(ledger.length >= 4 && ledger.length === knifeIds.length, 'D11a README 台账的把数与 sabotage.mjs 的刀数相同（解析不到不等于通过）',
  `台账 ${ledger.length} / 脚本 ${knifeIds.length}`);
const headCount = Number((README_RAW.match(/### 破坏试验台账（(\d+) 把刀）/) || [])[1]);
ok(!!headCount && headCount === knifeIds.length, 'D11b 台账标题那句「N 把刀」等于脚本里的刀数', `标题 ${headCount} / 脚本 ${knifeIds.length}`);
for (const r of ledger) {
  const row = SAB.match(new RegExp(`\\{ id: '${r[1]}'[\\s\\S]*?\\n  \\}`));
  ok(!!row, 'D11 台账里这一把在脚本里还在', `${r[1]} · ${r[2]}`);
  ok(exists(r[3]), 'D11 台账里这一把打的文件还在树里', `${r[1]} · ${r[3]}`);
  const fields = [r[4].replace(/\\\|/g, '|'), r[5].replace(/\\\|/g, '|'), r[6]];
  ok(fields.every((v) => SAB.includes(v)), 'D11 台账的针／改动／点名三列与脚本里那一把逐字相同', `${r[1]} · ${fields.map((v) => v.slice(0, 20)).join(' | ')}`);
  ok(/^\d+$/.test(r[7]), 'D11 台账末列那个 rc 是脚本读回来的数字', `${r[1]} · rc=${r[7]}（? 表示这一版台账还没整跑过）`);
}

// ---------------------------------------------------------------- D13 锚点：那句「第几行有什么名字」坐得对不对
// 范围那条腿只问「这个行号在不在文件里」——把 `x.js:21-25` 写成 `x.js:23-27` 它照绿，因为两行
// 都存在。可文档里相当一部分引用是带名字的（「`x.js:21-25` 的 `foo()`」），名字在不在那几行里
// 才是那句话的真值。这一组不加手抄清单，直接从文档现推：反引号里的 `path:NN[-MM]` 是一张引用，
// 紧挨着它的那个反引号段就是被指的名字（往后看一段，或往前看一段，中间只许隔「的」「（」这一类
// 连接符）。锚点的单位是 (文件, 起行, 止行, 名字)：同一处被两份文档各写一次只算一条，重复提及
// 另计。拿不到名字的裸 `path:NN` 这一组一条都不核，那部分仍只过范围检查——这条腿没覆盖什么写在
// README §七，不在这段注释里含糊过去。
const ANCHOR_CITE = /^([\w./-]+\.(?:js|mjs|cjs|sh|json|html|yml|css)):(\d+)(?:-(\d+))?$/;
// 还有一种写法把行号和名字装在同一个反引号里（`x.js:82 的 EXPECTS`），它也是一张锚点。
const ANCHOR_INLINE = /^([\w./-]+\.(?:js|mjs|cjs|sh|json|html|yml|css)):(\d+)(?:-(\d+))?\s*(?:的|::)\s*([^`]+)$/;
const IDENT = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const anchorTok = (body) => {
  const seg = body.includes('::') ? body.slice(body.lastIndexOf('::') + 2) : body;
  if (seg.includes('/')) return '';
  const head = seg.split('(')[0].trim();
  if (IDENT.test(head)) return head;
  const lhs = head.split(/[=:]\s/)[0].trim();
  return IDENT.test(lhs) ? lhs : '';
};
const deriveAnchors = (text) => {
  const spans = [...text.matchAll(/`([^`\n]+)`/g)];
  const out = [];
  const seen = new Set();
  let mentions = 0;
  for (let i = 0; i < spans.length; i += 1) {
    const plain = ANCHOR_CITE.exec(spans[i][1]);
    const inline = plain ? null : ANCHOR_INLINE.exec(spans[i][1]);
    const c = plain || inline;
    if (!c) continue;
    let name = inline ? anchorTok(inline[4].trim()) : '';
    const nxt = spans[i + 1];
    if (nxt) {
      const gap = text.slice(spans[i].index + spans[i][0].length, nxt.index);
      const g = gap.trim();
      if (gap.length <= 4 && !gap.includes('\n') && (g === '的' || /^[（(]$/.test(g))) name = anchorTok(nxt[1]);
    }
    if (!name && i > 0) {
      const prv = spans[i - 1];
      const gap = text.slice(prv.index + prv[0].length, spans[i].index);
      const g = gap.trim();
      if (gap.length <= 4 && !gap.includes('\n') && !/\s/.test(prv[1]) && /^[（(]/.test(g)) name = anchorTok(prv[1]);
    }
    if (!name) continue;
    mentions += 1;
    const from = +c[2];
    const to = +(c[3] || c[2]);
    const key = `${c[1]}:${from}-${to}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: c[1], from, to, name, label: `${c[1]}:${from}${c[3] ? `-${c[3]}` : ''}` });
  }
  return { anchors: out, mentions };
};
const anchorDrift = (list) => list.filter((d) => {
  const s = src(d.file);
  if (!s) return true;
  if (d.from < 1 || d.to > s.length) return true;
  const body = s.slice(d.from - 1, d.to).join('\n');
  // 整词认：`EXPECT` 坐在 `EXPECTS` 里不算命中，名字少抄一个字母也是漂。
  return !new RegExp(`(^|[^A-Za-z0-9_$])${d.name.replace(/[$.]/g, '\\$&')}($|[^A-Za-z0-9_$])`).test(body);
});
const derived = deriveAnchors(DOCTEXT);
const drift = anchorDrift(derived.anchors);
ok(drift.length === 0, 'D13 从文档现推的每一个锚点都坐在被指的那几行里（行号往旁边挪两行仍然在文件里，范围那条腿看不见这件事）',
  drift.length ? `漂 ${drift.length} 处：${drift.slice(0, 8).map((d) => `${d.label} 里找不到 ${d.name}`).join('，')}`
               : `现推 ${derived.anchors.length} 条（另有 ${derived.mentions - derived.anchors.length} 次是同一处的重复提及），全部落回原处；最窄的八条 ${[...derived.anchors].sort((a, b) => (a.to - a.from) - (b.to - b.from)).slice(0, 8).map((d) => `${d.label}=${d.name}`).join(' ')}`);
ok(derived.anchors.length >= 18, 'D13a 现推锚点的条数地板（引用格式改了、或带名字的写法被删光，这一条先红，不给后面变成空转绿）',
  `现推 ${derived.anchors.length} 条 / 文档一共 ${citeTotal} 处 ` +
  `path:NN 引用，其中 ${citeTotal - derived.mentions} 处是不带名字的裸引用`);
// 阳性对照下在内存里：把一处带名字引用的行号整体往下挪两行，同一套比较必须认它漂。
// 挑不出可挪的那一处（文件太短、或锚点全落在同一行）也算红——那说明这段只是在重抄文档。
const citeKeyText = (d) => `${d.file}:${d.from}${d.to !== d.from ? `-${d.to}` : ''}`;
const shiftedOf = (d) => `${d.file}:${d.from + 2}${d.to !== d.from ? `-${d.to + 2}` : ''}`;
const movable = [...derived.anchors]
  .sort((a, b) => (a.to - a.from) - (b.to - b.from))
  .find((d) => {
    const text = DOCTEXT.replace(citeKeyText(d), shiftedOf(d));
    return text !== DOCTEXT && anchorDrift(deriveAnchors(text).anchors).length >= 1;
  });
ok(!!movable, 'D13b 内存阳性对照：挑一处带名字的引用把行号往下挪两行，这一套比较必须认它漂（挑不出可挪的就红）',
  movable ? `挪的是 ${citeKeyText(movable)} 的 ${movable.name} → ${shiftedOf(movable)}，漂 ${anchorDrift(deriveAnchors(DOCTEXT.replace(citeKeyText(movable), shiftedOf(movable))).anchors).length} 处`
          : '一处都挪不动：要么锚点太少，要么这一格已经不会红了');
const anchorClaim = all(README, /现推锚点 (\d+) 条/g).map((m) => +m[1]);
const bareClaim = all(README, /裸引用 (\d+) 处/g).map((m) => +m[1]);
const citeClaim = all(README, /印了 (\d+) 处 `path:NN` 引用/g).map((m) => +m[1]);
const bareNow = citeTotal - derived.mentions;
ok(anchorClaim.length >= 1 && anchorClaim.every((v) => v === derived.anchors.length)
   && bareClaim.length >= 1 && bareClaim.every((v) => v === bareNow)
   && citeClaim.length >= 1 && citeClaim.every((v) => v === citeTotal),
  'D13c 文档抄的那三句「印了 N 处 path:NN 引用」「裸引用 M 处」「现推锚点 K 条」等于这一次真的推出来的数（每一处都得对，删掉其中一个数字同样算红）',
  `文档 ${citeClaim.join('/') || '（解析不到）'} 处引用 / ${bareClaim.join('/') || '（解析不到）'} 处裸引用 / ${anchorClaim.join('/') || '（解析不到）'} 条锚点 vs 现推 ${citeTotal} / ${bareNow} / ${derived.anchors.length}`);

// ================================================================ D12 自数：这道闸自己发多少项
// 文档点到 D12，而本组的编号要等它自己第一条 ok() 之后才进 `emitted`——"这一组在不在跑"这件事
// 只能由"正在跑这一组的代码"来自证。先把自己登记上不是放宽：删掉本组任何一条，D12a 那条
// 组数地板、D12b/D12c 的条数与 D12d 的 EXPECT_ROWS 会一起红。
emitted.add('D12');
const dMentions = [...new Set(all(DOCTEXT, /(?<![A-Za-z0-9_])D\d+/g).map((x) => x[0]))].map((x) => +x.slice(1));
ok(dMentions.every((v) => emitted.has(`D${v}`)), 'D12 文档点名的每个 D 编号这一次都真的跑了（删掉一组就会红）', `文档点到 ${dMentions.sort((a, b) => a - b).join(',')} / 其中这一轮没发出：${dMentions.filter((v) => !emitted.has(`D${v}`)).join(',') || '无'}`);
ok(emitted.size === 13, 'D12a 这道闸自己是十三组：本次发出的 D 标签数必须等于 13', `${emitted.size} 组`);
// 最后这三条自己也要被算进文档印的那个总数里，所以先按「发完这三条之后的总数」来比：
// ok() 的比较发生在 rows 自增**之前**，故 rows + 3 == 印出来的 rows。
const FINAL = rows + 3;
const selfClaim = (README.match(/本次实发 (\d+) 项/) || [])[1];
ok(!!selfClaim && +selfClaim === FINAL, 'D12b README 写的「本次实发 N 项」等于本闸这一次实际发出的项数', `文档 ${selfClaim || '（解析不到）'} vs 本次合计 ${FINAL} 项`);
const promiseRow = (README.match(/\| `node tools\/doctest\.mjs`[^\n]*?`rows: (\d+) fail: 0` \|/) || [])[1];
ok(!!promiseRow && +promiseRow === FINAL, 'D12c README 承诺表里这道闸自报的 rows 等于本次实际条数', `文档 ${promiseRow || '（解析不到）'} vs 本次 ${FINAL}`);
// 自数钉（组织纪律：闸不许靠「少一条断言」变绿）。这一条的比较同样发生在自增之前，
// 所以常量等于**印出来的总条数**，含这一条自己。verify.sh 再用 DOCTEST_ROWS_WANT 复钉一次。
const EXPECT_ROWS = 380;
ok(rows + 1 === EXPECT_ROWS, 'D12d 本闸条数 == 文件里钉死的 EXPECT_ROWS（少一条断言就红，含这一条自己）', `EXPECT_ROWS=${EXPECT_ROWS} / 印出来的 rows 必须是它`);

console.log(`\n合计 ${rows} 项，${fail.length} 项失败`);
console.log(`rows: ${rows} fail: ${fail.length}`);
if (fail.length) {
  for (const f of fail) console.log(`  未过：${f}`);
  process.exit(1);
}
