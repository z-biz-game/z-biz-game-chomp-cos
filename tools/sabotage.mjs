// 破坏试验台账：把每一类谎各写回一份**临时副本**里一遍，看文档闸会不会**点名**变红。
//
//   node tools/sabotage.mjs            跑 README「破坏试验台账」里的全部十二把刀
//   node tools/sabotage.mjs S1 S4      只跑点名的几把（调试用；子集跑不回写台账）
//
// 为什么要有这个文件：一份全绿的 doctest 只证明"这一轮文档与代码对得上"，它没有说**闸会不会红**。
// 十二把刀一组一把，各自必须把闸打红**并且**点名它吃掉的那条断言；FAIL 行的原文进日志工件，
// 台账末列那个 rc 由脚本从子进程读回来，人不许抄。
//
// 四条硬规矩（与 kurotto/ferry 同机制）：
//   1. 刀**只改临时副本**（rsync 一份不含 .git 的树），仓里的真文件一个字都不动；副本与日志都落在
//      workspace 根目录（`_tmp-chomp-sab-*`），跑完即删。开工前后各比一次 git status，树上多出
//      东西就是这把刀打错了地方，立刻停 —— 恢复永远不走 git checkout/restore/reset。
//   2. 针必须在目标文件里唯一命中（README 的台账行与刀谱自己都会把针原样抄一遍，那些命中不算）：
//      命中 0 次或 >1 次都是 ERROR 并停 —— "打不中却一声不响跑完"是台账最坏的失败。
//   3. rc != 0 **且**输出里有一条 FAIL 行点名了它那一条断言才算红；语法炸了也是 rc != 0，但那不是闸红。
//   4. 全部刀红过之后才回写 rc，然后拿一份**不带刀**的整副本跑同一条命令，必须 rc=0 ——
//      证明红是那一个扰动造成的，不是环境。回写是幂等的：对着已回写的树再跑一遍，README 一字不变。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = join(ROOT, '..'); // 副本与日志工件都放这里，不进仓
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const die = (msg) => { console.log(`  ERROR ${msg}`); process.exit(2); };
const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: opts.cwd || ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 600000 });
  if (r.error) die(`${cmd} 起不来：${r.error.message}`);
  return { rc: r.status === null ? -1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const gitStatus = () => sh('git', ['status', '--porcelain']).out.trim();

// ---- 刀谱：十二把，一组一把，每把只做一个最小扰动 ----
const KNIVES = [
  { id: 'S1', group: 'D1 census', where: '文档档位表里那一格的候选数被手改了一位', file: 'README.md',
    needle: '| 2 / 4 / 8，≥3 格 | 14 |', repl: '| 2 / 4 / 8，≥3 格 | 15 |',
    expect: 'D1 档位表这一格的候选数 == candidates() 现数' },
  { id: 'S2', group: 'D2 宇宙', where: '代码改了上限常数、文档与棋书还是旧值', file: 'js/core/make.js',
    needle: 'export const MAX_STATES = 419;', repl: 'export const MAX_STATES = 418;',
    expect: 'D2 make.js 的 MAX_STATES == 现算宇宙大小' },
  { id: 'S3', group: 'D3 套件', where: '承诺表把某套的断言条数抄少了一行', file: 'README.md',
    needle: '| `rows: 43 fail: 0` |', repl: '| `rows: 42 fail: 0` |',
    expect: 'D3 承诺表这一行的 rows/fail 与本轮真跑相同' },
  { id: 'S4', group: 'D4 接线', where: '看门狗预算被改了、文档还写着 420', file: 'tools/verify.sh',
    needle: 'WD_TIMEOUT:-420}', repl: 'WD_TIMEOUT:-421}',
    expect: 'D4 verify.sh 的看门狗预算 == 文档写的 420 s' },
  { id: 'S5', group: 'D5 发货读数', where: '发货合计被改了一个位（340 → 341）', file: 'README.md',
    needle: '合计 **340 个合法首口', repl: '合计 **341 个合法首口',
    expect: 'D5 32 关 / 340 合法首口 / 44 胜口 / 296 错误首口 / 372 格 == 发货文件逐行加总' },
  { id: 'S6', group: 'D6 行号引用', where: '代码上面加了一行，文档的行号引用没跟着改', file: 'README.md',
    needle: 'js/core/shapes.js:20-22', repl: 'js/core/shapes.js:20-21',
    expect: 'D6 文档引用的那一行号仍指回原来那段代码' },
  { id: 'S7', group: 'D7 逐字文案', where: '文档抄的存储键名与源码不同串了', file: 'README.md',
    needle: '只有一个 localStorage 键 `chomp.save.v1`', repl: '只有一个 localStorage 键 `chomp.save.v2`',
    expect: 'D7 存档键名文档与源码同串' },
  { id: 'S8', group: 'D8 浏览器静态点数', where: '场景调用点的静态计数被改了一个（17 → 18）', file: 'README.md',
    needle: 'boot 17 / play 20 / routes 14 / save 12 / pointer 25 个调用点', repl: 'boot 18 / play 20 / routes 14 / save 12 / pointer 25 个调用点',
    expect: 'D8 场景的 rec() 调用点数 == 文档写的数' },
  { id: 'S9', group: 'D9 墙钟纪律', where: '毫秒读数被摘掉了出处（"出处见 §6"没了）', file: 'DESIGN.md',
    needle: '耗时 0.03 s——那是读数，出处见 §6 计时量', repl: '耗时 0.03 s',
    expect: 'D9 DESIGN 前三节里每一处 0.0x s 读数都挂着「出处见 §6」' },
  { id: 'S10', group: 'D10 unpinned', where: '钉不住的那句话被从文档里删掉了', file: 'README.md',
    needle: '机器 Darwin 25.6.0 arm64、15 核、node v26.8.1、macOS 26.6.2。', repl: '',
    expect: 'D10 unpinned 清单里的那句话还在文档里' },
  { id: 'S11', group: 'D11 台账对账', where: '刀被改名，台账与刀谱不再是同一批', file: 'tools/sabotage.mjs',
    needle: "  { id: 'S6',", repl: "  { id: 'S6x',",
    expect: 'D11a README 台账的把数与 sabotage.mjs 的刀数相同' },
  { id: 'S12', group: 'D12 自数', where: '闸自己的组数地板被调低（12 → 11）', file: 'tools/doctest.mjs',
    needle: 'emitted.size === 12', repl: 'emitted.size === 11',
    expect: 'D12a 这道闸自己是十二组' },
];

const only = process.argv.slice(2);
const picked = only.length ? KNIVES.filter((k) => only.includes(k.id)) : KNIVES;
if (only.length && picked.length !== only.length) die(`点名的刀有几把不在刀谱上：${only.filter((x) => !picked.some((k) => k.id === x)).join(' ')}`);
if (!picked.length) die('一把刀都没选中');

// ---- 预检：针唯一命中（引用性的命中不算）、期望点名的那条断言得真的写在闸里 ----
// 两处「引用」要排掉，否则针永远命中不止一次、台账就成了自己锁死自己：
//   * README 的台账行逐字抄着每一把的针（D11 要求逐字相同），那些命中不是「文档在主张这句话」；
//   * 刀谱 KNIVES 字面量里就写着自己的 needle 串——S11 打的正是这张表，不排掉它的话
//     `  { id: 'S6',` 在它自己的定义行上再命中一次，任何一把打在刀谱上的刀都无法存在。
// 与 tools/doctest.mjs 的 stripLedger 是同一条规则的两端。
const target = (src, needle, file) => {
  const lines = src.split('\n');
  const ledger = lines.map((l, i) => (/^\| S\d+ \| /.test(l) ? i : -1)).filter((i) => i >= 0);
  const quoted = [];
  if (file === 'tools/sabotage.mjs') {
    const a = src.indexOf('const KNIVES = [');
    const b = src.indexOf('\n];', a + 1);
    if (a < 0 || b < 0) die('找不到 KNIVES 字面量的边界，无法判断哪些命中是刀谱自己的引用');
    quoted.push([a, b]);
  }
  const isQuoted = (pos) => {
    if (quoted.some(([p, q]) => pos >= p && pos < q)) return true;
    let up = 0;
    for (let i = 0; i < lines.length; i++) { up += lines[i].length + 1; if (up > pos) return ledger.includes(i); }
    return false;
  };
  const at = [];
  for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) if (!isQuoted(i)) at.push(i);
  return at;
};
// 标签里带 ${…} 槽的量（现值、行号）不能进比对，所以只认「最长连续原样命中」：
// 期望的那一条里必须有一段 >=10 个字原样写在闸里，否则就是断言被改名或被删掉了。
const longestIn = (hay, want) => {
  let best = 0;
  for (let i = 0; i + 8 <= want.length; i++) {
    let j = i + 8;
    while (j <= want.length && hay.includes(want.slice(i, j))) j += 1;
    best = Math.max(best, j - 1 - i);
  }
  return best;
};
const DOCTEST = read('tools/doctest.mjs');
for (const k of picked) {
  let src;
  try { src = read(k.file); } catch { die(`${k.id} 的文件不存在：${k.file}`); }
  const hits = target(src, k.needle, k.file).length;
  if (hits !== 1) die(`${k.id} 的针在 ${k.file} 的台账行之外命中 ${hits} 次（必须恰好 1 次；打不中或打多了都不许跑）`);
  if (k.repl === k.needle) die(`${k.id} 的「改成」与针相同，这一刀不会改变任何东西`);
  const run = longestIn(DOCTEST, k.expect);
  if (run < 10) die(`${k.id} 期望点名的「${k.expect}」在 doctest.mjs 里最长只连续命中 ${run} 个字（断言被改名或删掉了）`);
  console.log(`  预检 ${k.id} · ${k.group} · ${k.file} 针唯一命中 · 期望点名「${k.expect}」`);
}

const tree0 = gitStatus();
// 台账要往 README 回写实测 rc，还要拿整棵树做副本：脏树上跑会把**别人**的改动一起算进这一版的
// 读数里， rc 也就成了对一份不存在的树的记账。所以脏就拒（rc 2），拒在落第一刀之前。
if (tree0) die(`工作树不是干净的，台账拒绝开工（先提交或在干净的 checkout 上跑）：\n${tree0}`);
// 落刀前把每个靶文件的**字节**存进内存，跑完逐个字比回来。上一版这里写的是「改动串是否还在仓里」，
// 可 S9 的改动串（`耗时 0.03 s`）本来就是针的前缀、干净树里永远命中，于是那一把要么永远不能存在、
// 要么每次都被误判成"刀打到了仓里"。按字节比才是「仓里一个字都没动」的真正口径，而且更强。
const pristine = new Map(picked.map((k) => [k.file, readFileSync(join(ROOT, k.file))]));
const stamp = `${Date.now()}`;
const copies = [];
const makeCopy = (id) => {
  const dst = join(WORKSPACE, `_tmp-chomp-sab-${id}-${stamp}`);
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  const r = sh('rsync', ['-a', '--exclude', '.git', '--exclude', '_tmp*', `${ROOT}/`, `${dst}/`], { timeout: 180000 });
  if (r.rc !== 0) die(`副本建不起来：${r.out.slice(0, 200)}`);
  copies.push(dst);
  return dst;
};

const results = [];
for (const k of picked) {
  const dst = makeCopy(k.id);
  const file = join(dst, k.file);
  const src = readFileSync(file, 'utf8');
  const at = target(src, k.needle, k.file);
  if (at.length !== 1) die(`${k.id} 落刀前在副本里命中 ${at.length} 次（副本与仓不同步？）`);
  writeFileSync(file, src.slice(0, at[0]) + k.repl + src.slice(at[0] + k.needle.length));
  const t0 = Date.now();
  const r = sh(process.execPath, ['tools/doctest.mjs'], { cwd: dst, timeout: 600000 });
  const secs = +(((Date.now() - t0) / 1000).toFixed(1));
  const named = r.out.split('\n').filter((l) => l.includes(k.expect) && /FAIL/.test(l));
  const log = join(WORKSPACE, `_tmp-chomp-sab-${k.id}.log`);
  writeFileSync(log, `（临时副本 ${dst}）\nnode tools/doctest.mjs\nGATE_RC=${r.rc} 点名 ${named.length} 行 用时 ${secs}s\n${'='.repeat(60)}\n${r.out}`);
  const okKnife = r.rc !== 0 && named.length > 0;
  results.push({ id: k.id, rc: r.rc, named: named.length, secs, ok: okKnife });
  console.log(`  ${okKnife ? '红得住' : '没红/没点名'} ${k.id} · ${k.group} · rc=${r.rc} 点名 ${named.length} 行 · ${secs}s · ${log.replace(`${WORKSPACE}/`, '')}`);
  for (const l of named.slice(0, 2)) console.log(`      ${l.trim().slice(0, 160)}`);
  rmSync(dst, { recursive: true, force: true });
}

// ---- 仓里的真文件一个字都没动过 ----
const tree1 = gitStatus();
if (tree1 !== tree0) die(`刀跑完之后工作树变了（刀不许碰仓里的文件）：\n--- before ---\n${tree0}\n--- after ---\n${tree1}`);
for (const [f, buf] of pristine) {
  if (!readFileSync(join(ROOT, f)).equals(buf)) die(`${f} 在刀跑完之后字节与落刀前存的那份不同——刀打到了仓里`);
}

// ---- 每一把都必须既红又点到自己那一条 ----
const bad = results.filter((x) => !x.ok);
if (bad.length) die(`有 ${bad.length} 把刀没红或没点名（${bad.map((x) => x.id).join(' ')}）：README 台账保持原样，不回写任何 rc`);
console.log(`\n${results.length} 把刀全部红得住并点到了名：`);
for (const r of results) console.log(`  ${r.id} rc=${r.rc} 点名 ${r.named} 行 · ${r.secs}s`);

// ---- 回写实测 rc：台账末列那个数只能由脚本自己填，人不许抄 ----
// 子集跑（只点名几把刀）不回写：台账的前提是整跑一遍。
const subset = only.length > 0;
let written = 0;
if (!subset) {
  const lines = read('README.md').split('\n');
  for (const k of picked) {
    const i = lines.findIndex((l) => l.startsWith(`| ${k.id} | `));
    if (i < 0) die(`回写时找不到台账里 ${k.id} 那一行`);
    const rc = results.find((x) => x.id === k.id).rc;
    const next = lines[i].replace(/\| (\?|\d+) \|$/, `| ${rc} |`);
    if (next === lines[i] && !lines[i].endsWith(`| ${rc} |`)) die(`${k.id} 那一行末尾既不是「? |」也不是数字，不知道该怎么回写：${lines[i].slice(-40)}`);
    if (next !== lines[i]) { lines[i] = next; written += 1; }
  }
  writeFileSync(join(ROOT, 'README.md'), lines.join('\n'));
  writeFileSync(join(WORKSPACE, '_tmp-chomp-sab-writeback.log'),
    `README 台账回写\nGATE_RC=0\n回写行数=${written}\n${lines.filter((l) => /^\| S\d+ \| /.test(l)).join('\n')}\n`);
  console.log(`  回写 ${written} 行的实测 rc（末列由脚本自己填；已经是同一个数时一字不改，所以可重复跑）`);
}

// ---- 对照：不带刀的整副本跑同一条命令必须 rc=0（证明红是那一个扰动造成的，不是环境） ----
const ctrl = makeCopy('control');
const c = sh(process.execPath, ['tools/doctest.mjs'], { cwd: ctrl, timeout: 600000 });
writeFileSync(join(WORKSPACE, '_tmp-chomp-sab-control.log'), `node tools/doctest.mjs（无刀副本）\nGATE_RC=${c.rc}\n${'='.repeat(60)}\n${c.out}`);
if (c.rc !== 0) {
  rmSync(ctrl, { recursive: true, force: true });
  die(`不带刀整跑时 doctest 竟然红了（rc=${c.rc}）：先看 _tmp-chomp-sab-control.log`);
}
console.log('  对照 doctest · rc=0（刀没留在树上，闸本来是绿的）');

rmSync(ctrl, { recursive: true, force: true });
for (const p of copies) rmSync(p, { recursive: true, force: true });
const residue = spawnSync('bash', ['-c', `find '${WORKSPACE}' -maxdepth 1 -type d -name '_tmp-chomp-sab-*' | wc -l | tr -d ' '`], { encoding: 'utf8' });
const tree2 = gitStatus();
// 收尾对账：从开工到收工，树上**多出来**的路径只允许是 README 的那次回写，而且只允许在
// 这一版真的写了数的时候出现（写了 0 行 = 台账本来就已经是本版了，那就必须一个字节都不多）。
// 上一版在这里比的是「git status 字符串全等」，可回写 README 是台账**自己的**动作，
// 全等就等价于"第一次跑必然死"——只有已经盖章的那一版才跑得过去。
const paths = (x) => x.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
const dirt = [...new Set(paths(tree2).filter((f) => !paths(tree0).includes(f)))].sort();
const want = written ? ['README.md'] : [];
if (dirt.join(',') !== want.join(',')) {
  die(`收尾对账不过：从开工到收工树上多出了 ${dirt.join(' ') || '（无）'}，本该只多出 ${want.join(' ') || '（无，因为这一版一字未写）'}。\n${tree2}`);
}
console.log(`  副本清干净了：还剩 ${String(residue.stdout || '?').trim()} 个临时副本目录（日志工件按 _tmp-chomp-sab-*.log 留在 workspace 根，那是证据不是残留）`);
console.log(`  工作树：落刀前后 git status 一致；收尾只允许多出台账自己的回写（${written ? 'README 末列 ' + written + ' 行' : '一个字节都没多，这一版台账已是盖章版'}）`);
if (subset) console.log('\n子集跑：没有回写台账（台账要的是整跑一遍）。');
