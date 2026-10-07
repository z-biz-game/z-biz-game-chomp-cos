# 毒格巧克力 · CHOMP

网格巧克力，**左上角那一格有毒**：两人轮流咬，每一口选中一格，连同它**右下方**的全部格子一起带走；
被迫咬到毒格的人输。这个仓交付的是这一条规则的完整实现 + 一张**穷举出来的判定表**：
屏幕上印的「必胜/必败」「首口 k 个」「随机一口赢率」「局面数」全部是
`js/core/solve.js` 在可达局面集（序理想）上跑穷举 + 记忆化 minimax 量出来的读数，
对手（`js/core/book.js`）查的也是同一张表，查不到就抛异常而不是现场搜索。
出货的每一关都还额外被一条**独立路线**（该关自己从零重建的表）复算过一遍才写进
`js/data/lots.js`（`tools/bake.mjs:89-101`）。

规则的**出处**这一栏，本仓给不出这一族常见的「日英双源」：玩法四条（毒格在左上、咬右下方整块、
轮流、被迫咬毒者输）在 `index.html:8`（meta description 一句写完）、`index.html:81`（画布下那句操作说明，
含「骷髅格不能主动咬」）、`js/core/shapes.js:1-19`、`js/core/game.js:6-11`、`DESIGN.md:20-28`
里全是**仓内自述**，全仓被点名引用的外部结论只有一处 —— 两行情形的必败刻画，
写在 `test/fixture.mjs:112-113`（"the classical Chomp result for 2×n bars (Tweed 1908)"）与
`js/core/solve.js:219-223`（"Tweed's theorem, the classical textbook result"）。
**没有 URL、没有页码、没有日文源**；但它不是装饰：那条刻画以字面量形式钉在
`test/fixture.mjs:114`，被 `test/anchor.test.mjs` 逐位对账（见 §三）。

本文只写**本轮复跑量出来的事实**：命令是 `npm test`（= `npm run check` + `npm run unit` + `npm run doctest`，`package.json:14`），
机器 Darwin 25.6.0 arm64、15 核、node v26.8.1、macOS 26.6.2。
**墙钟数字不进本文**：这台机器上同时跑着别的代理的闸，毫秒读数复跑不出同一个值，写死它就是一条注定过期的承诺 —— 只有整数计数当事实写，凡是要说成本的地方一律引那条**上限断言**。量不到的事一律进 §七「不承诺」，不写成承诺。

---


- 上线：https://z-biz-game.github.io/z-biz-game-chomp-cos/（Pages 的项目站点。tools/deploy-set.mjs 的 R7 拿这一句当尺子：og:image 的前缀必须是它。）
## 一、承诺表：每一条都是一条真会红的命令

| 承诺 | 哪条命令判它 | 判的是什么 | 本轮交回 |
| --- | --- | --- | --- |
| 每一关印着的 `winner / k / winningMoves / legal / chance / states` 都能从序列化形状独立复算，手改一位就红 | `node test/library.test.mjs` | `verifyPool()` 必须返回空列表；9 个**篡改探针**（改 winner、k+1、清空胜口、cells+3、legal+2、chance=0.99、states 越界、假档位、五行形状）逐个必须被 `verifyLot` 点名（`js/core/library.js:53-81`） | `rows: 17 fail: 0` |
| 判定表与公开刻画逐位对齐：两行必败局恰好是阶梯 `(k,k-1)`、单行 1..9 只有裸毒格必败、方阵与全部非退化矩形先手必胜 | `node test/anchor.test.mjs` | 期望值是**手写在 `test/fixture.mjs:114` 与 `test/fixture.mjs:117` 的字面量**，不是从实现读回来的；含反方向逐条（45 个两行局减 8 条阶梯 = 37 个必胜，`test/anchor.test.mjs:53`）与 12 条手算 fixture（`test/anchor.test.mjs:156-165`） | `rows: 43 fail: 0` |
| 对手只查表：越出棋书的局面**抛异常**，不 fallback 到求解器 | `node test/book.test.mjs` | `lookup/classify/winningBitesOf` 三个入口对 `[11,1]` 全部必须抛（`js/core/book.js:58-65` 与 `js/core/book.js:89-100`）；棋书重烘之后与发货文件**逐字节相同**（`test/book.test.mjs:54-61`） | `rows: 13 fail: 0` |
| 规则机：非法一口一律不计数，交出 `[1]` 的那一瞬间就判负；**点错一口就交给已证明必胜的对手** | `node test/game.test.mjs` | 对 32 关**全部 296 个错误首口**（每关每个非胜口，不抽样）逐条把整局走到底，结局必须 `status='lost'` 且 `loser='you'`（`test/game.test.mjs:155-181`） | `rows: 23 fail: 0` |
| 位置模型的物理不变式：非增行长向量（序理想），悬空的格子不存在 | `node test/model.test.mjs` | `validateShape` 的四组负例（空向量 / 非增 / 0 与负长度 / 非整数与非数组，`test/model.test.mjs:23-44`）+ `applyBite` 对宇宙逐口仍产出合法形状（下限断言 `n > 500` 条边在 `test/model.test.mjs:171`，实测到的边数只在失败时打印）+ 闭包数 == 序理想计数 == 矩形闭式 `C(r+w,r)-1`（`test/model.test.mjs:158-188`） | `rows: 25 fail: 0` |
| 求解器自洽，且**三条独立路线**给出同一张判定表 | `node test/solve.test.mjs` | 每关独立表 vs 全宇宙自底向上 vs `test/naive.mjs` 那份独立重写的枚举，419 个局面逐点一致（`test/solve.test.mjs:110-138`）；反证：去掉毒格规则后整张表翻成全 N | `rows: 16 fail: 0` |
| 每日一题与分享链接在任何设备上落同一根巧克力 | `node test/rng.test.mjs` | `hashSeed` 是纯函数、是 FNV-1a **派生**的两轮 UTF-16 混合（对 6 个 ASCII 种子逐个证明与教科书 FNV-1a 不同，`test/rng.test.mjs:57-66`）；日期→种子→池内下标链路跨进程一致 | `rows: 13 fail: 0` |
| 存档的两条单调性，且「被拒绝的存储」不许长得像「空存档」 | `node test/storage.test.mjs` | `best` 只降不升、`unlocked` 只升不降、坏 JSON 降级、`setItem` 抛异常时仍 playable 但 `persistent()===false`；`requireBackend()`（`js/core/storage.js:21-25`）必须**抛** `StorageError` 而不是回 `null` | `rows: 15 fail: 0` |
| 屏幕上的动效与刷新率无关：30/60/120 Hz 喂同一段秒表，末态逐字段一致 | `node test/anim.test.mjs` | 对齐单位是**步数**不是虚拟秒（272 步 = 68/136/272 帧）；比较的是每粒粒子的 6 个字段，不是「粒子数」这种能被空数组骗过去的量；反证开关 `CHOMP_ANIM=<mutant>` 打在 `js/core/anim.js:79` 那句唯一吃帧 dt 的 `a.accumulator += elapsed` 上 —— 冻结成常数之后必须红（本轮实测红 2 行：`[136,136,136]` 与 `2 ≠ 20`）。**换成变异 per-particle 的 `p.x += p.vx * s` 则六行全绿**，这正是规范 §6 说的假红目标，写在这里是为了让下一轮别再去撞 | `rows: 6 fail: 0` |
| 发货的每张图都能从仓里的脚本重算出来，图不是手画的、也不是占位符 | `python3 assets/gen/make_art.py --check` | 不自绘、不下载：`assets/gen/make_art.py` 是**唯一**的图源，`--check` 拿 `png_dims`（`assets/gen/make_art.py:383`）读盘上每张图的 IHDR 宽高并与期望表对账；同种子（`SEED_GRAIN = 20260930`）重跑得到同一个 `sha256[:12] = 3f8bac3be94a`。**本机没有 Pillow**（`python3 -c "import PIL"` 报 ModuleNotFoundError），所以这条 `python3` 命令本轮跑不起来 —— 这一格的四项读数与指纹是 `node tools/doctest.mjs` 的 D7 组在 node 里读 IHDR 现量交回的（读 `make_art.py` 的期望表 + 对 `assets/` 逐张 sha256），不是引用旧文档；把这条命令补成能跑不在本轮的可动范围里，写在这里是缺陷而不是省略 | 应存在 18 张 / 缺失 0 / 0字节 0 / 边长≥180 9 张，指纹 `sha256[:12] = 3f8bac3be94a` |
| 35 个源文件（.js/.mjs/.cjs）全部语法可解析 | `npm run check` | `for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check`（`package.json:12`），本轮实测展开成 **35 个文件**；`.github/workflows/ci.yml:29` 不再抄这份 glob，Syntax/Suites 两步直接调 `npm run check` / `npm run unit`（钉这条的断言在 `tools/doctest.mjs` 的 D4） | 打印 `OK`，rc=0 |
| 文档里印出来的**每一个数字**都等于现在从代码量出来的那个值（十三组：census、宇宙、九套条数、接线、发货读数、行号引用、逐字文案、场景静态点数、墙钟纪律、unpin 清单、台账对账、自数、锚点） | `node tools/doctest.mjs` | 三处文档（README / DESIGN / deliverable）的每一张表先数行数再逐格比现算；行号引用逐条 `lineOf` 回数，**带名字的**那几处还要回数被指的那几行里真有这个名字（现推锚点 20 条，由 D13 从文档自己推出来，不是手抄清单；这一族覆盖不到什么见 §七 第 14 条）；`npm run check` 的 glob 真展开、九套 node 套件真跑一遍读它们自己交回的 `rows:` | `rows: 380 fail: 0` |
| 每一类谎都真的能把上面那道闸打红，而且是**点名**红（不是"反正红了"） | `node tools/sabotage.mjs` | 十五把刀，一组一把（D3 三把：少派生一套、版本被抄成字面量、某套的断言条数被抄少一行，是三条不同的谎），每把只做一个最小扰动、且只落在 workspace 里的**临时副本**上（`rsync` 一份不含 `.git` 的树）；一把算过的条件是 rc≠0 **且**输出里有一条 FAIL 行同时点名那一组和那一条断言；跑完拿不带刀的整副本复跑必须 rc=0，台账末列那个 rc 由脚本从子进程读回来 | 见 §四「破坏试验台账」，末列是实测 rc |
| 页面跑的就是这套引擎，真鼠标落得下口 | `bash tools/verify.sh`（本机 2026-10-04 两条腿都跑绿；**原样**跑会被这台机器上一台不属于本仓的孤儿 Chrome 拒，那一轮绿是显式给了 `ALLOW_ORPHAN_CHROME=1` 才开工的，见 §七第 1 条） | 真 headless Chrome + 裸 CDP：5 套场景（`@boot @play @routes @save @pointer`），任何一行红、或 console 出现 `[EXCEPTION]/[error]/[log:error]/[warning]` 就 `FAILED=1`（`tools/verify.sh:203` 的 `sys.exit(1 if d.get("fail") else 0)` 与 `tools/verify.sh:207-210` 的 console 断言） | `=== ALL GREEN ===`，rc=0，正常路径 91 行（逐套读数带日期，见 §四 与 §七第 1 条） |

一条命令跑全部 node 侧：

```
npm test          # = npm run check && npm run unit && npm run doctest
```

本轮原样结论行（九套各打一行，`tools/harness.mjs:41`）：

```
rows: 43 fail: 0     # anchor
rows: 6 fail: 0      # anim
rows: 13 fail: 0     # book
rows: 23 fail: 0     # game
rows: 17 fail: 0     # library
rows: 25 fail: 0     # model
rows: 13 fail: 0     # rng
rows: 16 fail: 0     # solve
rows: 15 fail: 0     # storage
```

**171 是把上面九行加起来的和**（本轮之前是八行 165，`deliverable.md:16,102,152` 记的就是那个
165 —— 那是上一轮有人手加之后抄进记录行的，不是判据）。这一条缺口本轮**补上了**：
`tools/verify.sh:31` 的 `MIN_LOGIC_ROWS`（现值 171）是逻辑腿的地板，交回的条数低于它就 `FAILED=1`，
所以「少跑一套」「某套少写一半断言」都会红，而不是安静地少几条；`node tools/doctest.mjs` 的 D3 组
再把每一套自己交回的 `rows: N fail: M` 与这张表**逐套**比一次（改一套的条数而不改文档就是红），
D12 组再把这道闸自己这一次的条数钉住：**本次实发 380 项**，与它自己最后那行 `rows: 380` 必须是同一个数，
`tools/verify.sh:34` 的 `DOCTEST_ROWS_WANT` 又把这个数复钉一遍 —— 三处任一处对不上就红。
仓里印这个总数的命令就是文档闸自己（`npm run doctest`，`tools/verify.sh:64` 派生它的那一行）。
值得一提：那八行与 `deliverable.md:103-110` 记录的那八行**逐字符相同**；每条数字归属哪个套件，
是由 `node --test` 那份带文件名的输出确认的（`✔ test/anchor.test.mjs` 紧跟它的 `rows: 43`，
往下 anim 6 / book 13 / game 23 / library 17 / model 25 / rng 13 / solve 16 / storage 15）。
跑法是 `node --test` 后面接**由 `test/` 目录派生的那九支文件名**，不是 `--test test/`。这里刻意
**不钉聚合读数**：`ℹ tests N` 那个数跟着 node 的版本漂 —— 同一棵树，本机 v24 把 `--test test/` 展开成
九支文件（`tests 9 / pass 9 / fail 0`），CI 的 v22 却把它当一个条目跑（`tests 1 / pass 0 / fail 1`），
钉住它等于把闸交给运行时版本。D3 判的是与版本无关的三件事：rc 0、九套各交回一行 `rows: … fail: 0`、
聚合 `fail 0`；`tests` 读数只作为观测印在当轮日志的行尾，不进本文（§一 那条墙钟纪律的同一种处理）。

---

## 二、怎么跑：`package.json` 的 scripts 逐条

`dependencies` 与 `devDependencies` 都是 `{}`（`package.json:34-35`），零运行时依赖，不需要 `npm install`；
本轮实测仓内也确实没有 `node_modules/`。

| 命令 | 实际跑的是什么 | 本轮状态 |
| --- | --- | --- |
| `npm test` | `npm run check && npm run unit && npm run doctest`（`package.json:14`） | **跑过**，见 §一 与下面两道新闸 |
| `npm run check` | `for f in js/*.js js/*/*.js server.cjs electron/main.cjs tools/*.mjs test/*.mjs; do node --check "$f" \|\| exit 1; done && echo OK`（`package.json:12`）—— 就是 §一 那条循环，本轮实测展开 35 个文件 | **跑过**，`OK` |
| `npm run unit` | `for f in test/*.test.mjs; do node "$f" \|\| exit 1; done`（`package.json:13`），九个文件按字母序，任一非零立即中止 | **跑过**，九行 `rows: N fail: 0` |
| `npm run doctest` | `node tools/doctest.mjs`（`package.json:16`）：文档数字闸，十三组，内部把九套真跑一遍再逐处比文档 | **跑过**，`rows: 380 fail: 0` |
| `npm run sabotage` | `node tools/sabotage.mjs`（`package.json:17`）：破坏试验台账，十五把刀各打一份临时副本 | **跑过**，台账见 §四 |
| `npm run deploy-set` | `node tools/deploy-set.mjs`（`package.json:18`）：部署集闸，按 `tools/assemble-site.sh` 那份清单真拷一遍产物，再对拷出来的东西提要求 | **跑过**，`rows: 68 fail: 0`（42 条引用 / 6 张位图尺寸核对） |
| `npm run deploy-set:selftest` | `node tools/deploy-set-selftest.mjs`（`package.json:19`）：上面那两颗钉的阳性证明，每一类断言当场被打红一次 | **跑过**，`rc=0`，X1–X12 逐把点名（X13 打 SKIP：这一仓的位图都是文件，那一类由 X7 证） |
| `npm start` | `node server.cjs`（`package.json:8`），端口取 `argv[2] || process.env.PORT || 5201`（`server.cjs:60`） | 未起服务（浏览器闸本轮禁跑）；端口号是从源码读的 |
| `npm run dev` | `node server.cjs 5201`（`package.json:9`）—— 与 `start` **同一个端口**，只是把号写死在 argv 上 | 未跑 |
| `npm run verify` | `bash tools/verify.sh`（`package.json:15`）：node 九套 + 文档闸 + 破坏试验台账 + 真 Chrome 五场景 | 本轮两条腿都跑过（逐套读数见 §四 末段）；原样重跑的预检代价见 §七第 1 条 |
| `npm run bake` | `node tools/bake.mjs`（`package.json:11`）：全宇宙判定 + 逐关独立建表 + 两路对账，然后**覆写 `js/data/lots.js`**（`tools/bake.mjs:221`） | **本轮未跑**：它会改写发货文件，改 `js/data/lots.js` 不在文档轮的可动范围内。它的结构量由只读路线复现（§五） |
| `npm run electron` | `electron .`（`package.json:10`），入口 `electron/main.cjs`，它用 `startServer({port: 0})` 自己挑一个临时口（`electron/main.cjs:7-8`） | **跑不了**：`electron` 不在两个依赖表里，仓内也没有 `node_modules/`。本轮未尝试执行 |

单独跑其中一套是可以的，文件名就是命令：`node test/anchor.test.mjs`、`node test/book.test.mjs` ……
每个套件自己 `process.exit(fail 数 > 0 ? 1 : 0)`（`tools/harness.mjs:42`）。

---

## 三、规则与判定：逐条能从源码指出来

真值审计器是 `js/core/solve.js` 建出来的那张 P/N 表，玩家的每一次判定走
`js/core/game.js:classifyNow`（`js/core/game.js:59-69`）→ `js/core/book.js:lookup`，
UI 里没有任何第二套「合法」的定义。

| # | 规则 | 源码对应处 | 违反时系统说的话（本轮由测试逐字断言） |
| --- | --- | --- | --- |
| 1 | 局面是一张**非增**的行长向量 `[s0>=s1>=…>=1]`，`(0,0)` 是毒格 | `js/core/shapes.js:5-13`（口径写在文件头）、校验器 `js/core/shapes.js:50-63`（`validateShape`） | `第 1 行长度 3 大于上一行 2：序理想不允许悬空的格子`、`shape 为空（毒格也已被咬掉，不是可行动的局面）`（`js/core/shapes.js:52,59`） |
| 2 | 一口咬掉 `(r,c)` 连同**所有 `r'>=r` 且 `c'>=c`** 的格子；上面的行原样，下面的行被裁到 `c` 列，裁成 0 的行整行消失 | `js/core/shapes.js:143-153`（`applyBite`），几何侧 `js/view.js:476-483`（`goneSquares`） | `applyBite([4,4],[0,2]) = [2,2]`、`applyBite([5,4,3],[2,0]) = [5,4]` 都是断言在 `test/model.test.mjs:140-147` |
| 3 | **毒格不能主动咬**：`(0,0)` 永远不在合法口里；但 `(r>=1, 0)` 是合法的（它只削掉下面几行的第一列） | `js/core/shapes.js:104-114`（`legalBites`；列起点那一行是 `js/core/shapes.js:111`，上面 110-111 的注释就在说这件事）、`js/core/shapes.js:116-124`（`isLegalBite`） | `毒格不能主动咬` / 只剩毒格时 `只剩毒格：咬下去即输`（同一行的三元式，`js/core/shapes.js:133`），`biteReason` 六句拒绝各钉一条（`test/model.test.mjs:124-132` 逐句 `eq`） |
| 4 | **被迫咬到毒格的人输**：交出 `[1]` 的那一瞬间比赛就结束了 —— 造出 `[1]` 的人赢，接手的人输 | `js/core/game.js:101`（`isTerminal(next) → finish`）、终局约定写在 `js/core/game.js:6-11` | 结束后任何一口 `rejected='本局已结束'`，状态一格不动（`test/game.test.mjs:193-201`）；被 `@pointer` 用真鼠标复验（`tools/playtest.mjs:338-341`） |
| 5 | 只剩毒格时**主动**点毒格是认输，不是空转：这一步 `rejected=null`，直接判负 | `js/core/game.js:80-88` 的 `forced` 分支 | `test/game.test.mjs:203-212` |

除上面这几条之外没有别的约束：**没有平局** —— 状态机只有 `playing | won | lost` 三态
（`js/core/game.js:36`），「平局规则」在 `DESIGN.md:125` 的「已知不做」里被点名，
没有全局连通性、没有对称性、没有白格规则。玩家的三个动作是咬、撤销、提示：撤销退的是**一整轮**
（你那一口 + 它引出来的回答），不是半步（`js/core/game.js:161-184`）；提示在必胜局报出胜口坐标，
在必败局直说没救（`js/core/game.js:145-155`），而「必败局不许谎报有胜口」是对棋书里全部 36 个
必败局面**逐条**数的（`test/game.test.mjs:232-246`，断言 `checked === BOOK.p`）。

非法输入一律**不计费**：`playBite` 在拒绝时返回同一个状态、只换 `line`（`js/core/game.js:88`），
所以「点了没反应」和「点了被拒绝」在屏幕上是可区分的，而且 `plies` 不会漂。
本轮实测两类非法探针（毒格、行越界、列越界、非整数坐标、`null`）都满足「形状与步数一字不变」
（`test/game.test.mjs:56-66`）。

---

## 四、门禁清单：`tools/` 里到底有什么

`tools/` 是九个东西，其中**没有一套是独立的测试套件** —— 九套 node 测试在 `test/`（条数见 §一）：

| 文件 | 判什么 | 本轮条数 / 状态 |
| --- | --- | --- |
| `tools/bake.mjs`（228 行） | **构建期**门：全宇宙判定 → 逐关独立建表 → 两路必须同判定同胜口 → 可达集必须等于序理想计数 → 写盘前 `encodeBook/decodeBook` 往返必须逐位回来。任何一步不一致直接 `throw`，不落文件（`tools/bake.mjs:46-57,89-105`） | **本轮未执行**（它会覆写 `js/data/lots.js`）。它的前四条对账由只读路线复现：`node test/book.test.mjs` 13/0、`node test/solve.test.mjs` 16/0 |
| `tools/doctest.mjs`（802 行） | **文档数字闸**：README / DESIGN / deliverable 里印出来的每一个数字都对着代码现算一遍，十三组（D1 census、D2 宇宙与棋书、D3 九套真跑、D4 接线、D5 发货读数、D6 行号引用、D7 逐字文案与文件规格、D8 场景静态点数、D9 墙钟纪律、D10 unpinned 清单、D11 台账对账、D12 自数、D13 锚点）。每一组都先数行数再逐格比，正则一条不命中就是红而不是空转 | `rows: 380 fail: 0`（本次实发 380 项，见 §一） |
| `tools/harness.mjs`（43 行） | 微型框架：`test()` 排队、`run()` 顺序 await，被拒的 async 测试记成 FAIL 而不是 unhandled rejection（`tools/harness.mjs:12-21,37-43`） | 不自报条数；node 与浏览器两套都靠它输出同形的 `rows: N fail: M` |
| `tools/playtest.mjs`（592 行） | 裸 CDP 驱动（node 全局 `WebSocket`/`fetch`，无 Playwright）+ 五套页内场景：`@boot @play @routes @save` 四套是页面里跑的 JS，`@pointer` 是唯一一套**必须由真鼠标驱动**的（`tools/playtest.mjs:180-344`，注释在 177-179 说清了为什么页面自己跑不了它） | 见下面「静态点数」段 |
| `tools/sabotage.mjs`（237 行） | **破坏试验台账**：十五把刀，一组一把（D3 三把：少派生一套、版本被抄成字面量、某套的断言条数被抄少一行，是三条不同的谎），每把只做一个最小扰动，且只落在 workspace 里的临时副本上（`rsync` 不含 `.git`）；一把算过的条件是闸 rc≠0 **且**有一条 FAIL 行同时点名那一组和那一条断言；脏的工作树直接拒（rc 2），跑完按字节比回靶文件，最后拿不带刀的整副本复跑必须 rc=0 | 台账在本节末尾，末列是脚本读回来的实测 rc |
| `tools/assemble-site.sh`（31 行） | **上线文件的唯一清单**：`index.html` + `manifest.webmanifest` + `sw.js` + `cp -r css js`，位图目录按存在与否收（本仓是 `assets/`）。以前这几行手抄在 `pages.yml` 的 `run:` 里，清单落后于页面时线上 404 自己的文件而本地全绿 | CI 的 deploy 与本地闸调同一支脚本；`X1` 那把刀砍它必须让闸点名红 |
| `tools/deploy-set.mjs`（347 行） | **部署集闸**：对拷出来的产物提三组要求——W 清单与页面同源、R 引用可达（从 `index.html` 走模块图 / CSS `url()` / manifest 的 icons/shortcuts / SW 注册点）、P 位图不谎报（声明的 `sizes` == PNG IHDR 真宽高）。引用条数与断言条数钉在文件顶部那对常量里 | 本轮 `rows: 68 fail: 0`，42 条引用 / 6 张位图核对 |
| `tools/deploy-set-selftest.mjs`（316 行） | 上面那两颗钉的**阳性证明**：把仓复制到临时目录，每一类断言当场被打红一次（X1 清单不收位图目录 … X13 内联位图谎报尺寸），并要求闸**点名**吃掉那一刀；X10 是阴性对照——注释里的假路径不许被算成引用 | 本轮 `rc=0`，X1–X12 各点名变红、X13 因这一仓没有内联位图打 SKIP |
| `tools/verify.sh`（241 行） | 生命周期 + 两条腿的**计数复钉**：端口/孤儿 Chrome 预检（`exit 6/7/8`）、找 Chrome（`exit 2`）、`/json/version` 与 web 根**双就绪轮询**（`exit 3/4`）、`window.chomp.state.id` 轮询（`exit 5`）、逐场景收花括号计数的 JSON、console 干净性。逻辑腿自己判三件事：`MIN_LOGIC_ROWS` 地板（`tools/verify.sh:31`）、文档闸的条数复钉 `DOCTEST_ROWS_WANT`（`tools/verify.sh:34`）、台账的刀数复钉 `SABOTAGE_KNIVES_WANT`（`tools/verify.sh:38`），两道新闸各只派生一次（`tools/verify.sh:64`、`tools/verify.sh:81`），收尾在结论横幅之前跑部署集双闸（`tools/verify.sh:237-239`）——这一段只在**默认那条路**上跑：`LOGIC_ONLY=1` 的捷径在它之前就 exit，那条路的绿不含部署集（CI 走的是默认那条，见下表）；
浏览器判据本身仍然只有「有没有 fail 行」 | 本轮两条腿都跑过；浏览器腿的复跑代价见 §七第 1 条 |

五套浏览器场景的**条数**：`tools/verify.sh:200` 只打印 `rows: len(rows)` 并判 `fail`，**没有任何一处写着期望条数**。
所以本轮改用静态计数：按 `rec()` 的调用点数，`@boot` 21、`@play` 20、`@save` 12、`@routes` 14 个调用点
（其中一套在 `for (const tier of …)` 四档循环里 ⇒ 正常路径 17 行）、`@pointer` 25 个调用点
（两条是循环内「走不通才报」的失败行、两对是 `if/else` 二选一 ⇒ 正常路径 21 行），
合计**正常路径 91 行**。与 `deliverable.md:17,112-116` 记录的 2026-09-27 那一次
`@boot 15 / @play 20 / @routes 17 / @save 12 / @pointer 21` 相比只有 `@boot` 动了，15 → 21 分两跳：
本轮发货了真位图，旧的「一个图片请求都不许有 + favicon 必须是内联 SVG」两行与新事实矛盾，
被换成四行新契约（见 §六，15 → 17）；`5f634d2` 让首访先立规则卡，于是补了四行首访契约
（卡在、卡在前递口被拒且不计费、关掉卡把盘交回来、`seenTutorial` 落进盘上那份档，17 → 21）。
其余四套逐场景仍然对得上。
静态点数本轮**被真跑对上了**：浏览器腿交回 `@boot 21 / @play 20 / @routes 17 / @save 12 / @pointer 21`
（本机 2026-10-04 的一次观测，`bash tools/verify.sh` → `=== ALL GREEN ===`，console 干净；逐套读数与 10-03 那次一字不差）。
`@routes` 那 14 → 17、`@pointer` 那 25 → 21 是上面说好的循环与分支差，另外三套调用点数与行数一字不差。

`test/` 九套的条数是本轮实测交回的（§一那张表），逐套内容：
`anchor 43`（外部锚点）、`book 13`（棋书完整性 + 范围守卫 + 完美性普查 419 全覆盖）、
`game 23`（状态机、296 个错误首口全量）、`library 17`（发货文件逐关重解 + daily/random 纯度）、
`model 25`（形状代数与负例）、`anim 6`（固定步长与帧率无关，含反证）、`rng 13`（确定性）、`solve 16`（三条路线 + 反证）、`storage 15`（存档单调性）。


### 破坏试验台账（15 把刀）

一份全绿的文档闸只说明「这一轮文档与代码对得上」，它没有说明**闸会不会红**。所以十三组各配一把刀（D3 三把），
每把只做一个最小扰动，而且只落在 workspace 里的**临时副本**上（`rsync -a --exclude .git` 一份树，
跑完即删；仓里的文件一个字都不动，落刀前后各比一次 `git status`，还要按字节比回落刀前存的那份）。
一把算过的条件是 **rc≠0 并且输出里有一条 FAIL 行同时点名那一组和那一条断言**——换个说法不算点名。
针必须在目标文件的**台账行之外**恰好命中一次（命中 0 次或多次都是 ERROR 并停）；工作树脏就直接拒
（rc 2），所以台账只在提交之后跑。末列那个 rc 由 `tools/sabotage.mjs` 自己从子进程读回来写进这张表，
人不许抄；十五把都红过之后它再拿一份**不带刀**的整副本复跑同一条命令，必须 rc=0（对照），
证明红是那一个扰动造成的而不是环境。`tools/verify.sh:38` 复钉刀数：少一把就是红，不是快一轮。

| 刀 | 这一刀模拟的是 | 打哪个文件 | 针（台账行之外唯一命中） | 改成 | 必须点名的那条断言 | 实测 rc |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | 文档档位表里那一格的候选数被手改了一位 | `README.md` | `\| 2 / 4 / 8，≥3 格 \| 14 \|` | `\| 2 / 4 / 8，≥3 格 \| 15 \|` | D1 档位表这一格的候选数 == candidates() 现数 | 1 |
| S2 | 代码改了上限常数、文档与棋书还是旧值 | `js/core/make.js` | `export const MAX_STATES = 419;` | `export const MAX_STATES = 418;` | D2 make.js 的 MAX_STATES == 现算宇宙大小 | 1 |
| S3 | 承诺表把某套的断言条数抄少了一行 | `README.md` | `\| `rows: 43 fail: 0` \|` | `\| `rows: 42 fail: 0` \|` | D3 承诺表这一行的 rows/fail 与本轮真跑相同 | 1 |
| S4 | 看门狗预算被改了、文档还写着 420 | `tools/verify.sh` | `WD_TIMEOUT:-420}` | `WD_TIMEOUT:-421}` | D4 verify.sh 的看门狗预算 == 文档写的 420 s | 1 |
| S5 | 发货合计被改了一个位（340 → 341） | `README.md` | `合计 **340 个合法首口` | `合计 **341 个合法首口` | D5 32 关 / 340 合法首口 / 44 胜口 / 296 错误首口 / 372 格 == 发货文件逐行加总 | 1 |
| S6 | 代码上面加了一行，文档的行号引用没跟着改 | `README.md` | `js/core/shapes.js:20-22` | `js/core/shapes.js:20-21` | D6 文档引用的那一行号仍指回原来那段代码 | 1 |
| S7 | 文档抄的存储键名与源码不同串了 | `README.md` | `只有一个 localStorage 键 `chomp.save.v1`` | `只有一个 localStorage 键 `chomp.save.v2`` | D7 存档键名文档与源码同串 | 1 |
| S8 | 场景调用点的静态计数被改了一个（21 → 22） | `README.md` | `boot 21 / play 20 / routes 14 / save 12 / pointer 25 个调用点` | `boot 22 / play 20 / routes 14 / save 12 / pointer 25 个调用点` | D8 场景的 rec() 调用点数 == 文档写的数 | 1 |
| S9 | 毫秒读数被摘掉了出处（"出处见 §6"没了） | `DESIGN.md` | `耗时 0.03 s——那是读数，出处见 §6 计时量` | `耗时 0.03 s` | D9 DESIGN 前三节里每一处 0.0x s 读数都挂着「出处见 §6」 | 1 |
| S10 | 钉不住的那句话被从文档里删掉了 | `README.md` | `机器 Darwin 25.6.0 arm64、15 核、node v26.8.1、macOS 26.6.2。` | `''` | D10 unpinned 清单里的那句话还在文档里 | 1 |
| S11 | 刀被改名，台账与刀谱不再是同一批 | `tools/sabotage.mjs` | `  { id: 'S6',` | `  { id: 'S6x',` | D11a README 台账的把数与 sabotage.mjs 的刀数相同 | 1 |
| S12 | 闸自己的组数地板被调低（13 → 12） | `tools/doctest.mjs` | `emitted.size === 13` | `emitted.size === 12` | D12a 这道闸自己是十三组 | 1 |
| S13 | `node --test` 少派生一套（九支文件名被削成八支） | `tools/doctest.mjs` | `...SUITE_FILES.map((f) =>` | `...SUITE_FILES.slice(0, 8).map((f) =>` | D3 node --test 跑 SUITE_FILES 派生的那九支 | 1 |
| S14 | 壳层版本被抄成字面量塞回场景（VERSION 抬到 2 那一次就是它红了三天） | `tools/playtest.mjs` | `c.version === Number('${SHELL_VERSION}')` | `c.version === 1` | D3 @boot 的壳层版本仍从 js/main.js 的常数派生 | 1 |
| S15 | 文档把拒绝时改写的字段名写成 `lines`，行号仍指在原处 | `README.md` | `只换 `line`（`js/core/game.js:88`）` | `只换 `lines`（`js/core/game.js:88`）` | D13 从文档现推的每一个锚点都坐在被指的那几行里 | 1 |

---

## 五、难度与量纲：本仓没有 `balance`，量的是博弈论价值

先说清一件事：**这里没有「最短解步数」可量**。这是双人 impartial 博弈，"多少步"取决于对手怎么走。
所以屏幕上那四个数各自对应一个可复算的量，一个字符串标签（`difficulty: 'hard'` 之类）都没有：

| 印在屏幕上的 | 来自 | 判它的命令 |
| --- | --- | --- |
| `当前判定 必胜/必败` | 棋书对该形状的 `n` 位（`js/core/book.js:76-79`），随 `turn` 换算成「对你是胜还是败」（`js/core/game.js:59-69`） | `node test/book.test.mjs` 的完美性普查：419 个局面逐条要求「N 的建议通向 P，P 的每一口都只能交出 N」 |
| `首口 k 个` | 同一张表里「咬完之后判为 P」的合法口数（`js/core/book.js:104-118`） | `node test/book.test.mjs` 把 `k` 与 `winningMoves` 对独立求解逐关比 |
| `随机一口赢率 = k / legal` | 上面那个数直接除（`js/core/book.js:114`），发货存 6 位小数、复核时两边落到同一个 6 位网格（`js/core/library.js:75,100-102`） | `node test/library.test.mjs` 的 `chance` 篡改负例 |
| `局面数（本关表）` | 该关可达集大小 = 非空子序理想数（`js/core/solve.js:261-275`） | `node test/solve.test.mjs` 要求「闭包 BFS」「序理想计数」「矩形闭式 `C(r+w,r)-1`」三个数对同一形状相等 |

那四行字由证明抽屉末尾的 `el.proofmore` 收尾，它印给玩家的是**复现命令本身**而不是第五个数字：
「复现：node tools/bake.mjs 重烘并重验；npm run unit 复算这些数。」（`js/main.js:125`）。这句话住在页面上，
所以它也是一条会被 D7 逐字比的文案 —— 它曾经是 `node --test test/`，而那条命令在 CI 的 node 22 上会把
九套塌成一条失败项（§一 那一整段说的就是这件事），印在屏幕上等于对玩家说谎，故换成 `npm run unit`。
另外提醒：`node tools/bake.mjs` 会**覆写 `js/data/lots.js`**（`tools/bake.mjs:221`），所以它不是一条只读复跑。

**宇宙**是 4 行 / 10 列 / 18 格以内的一切合法巧克力条（`js/core/shapes.js:20-22`），
本轮只读复测：`solveUniverse()` 交出 **419 个局面、36 个 P、383 个 N**，
`universeShapes()` 同样数出 419，`js/data/lots.js` 里发货的 `BOOK` 也是 `states 419 / p 36 / n 383 / rows 419`
（本轮只读脚本直接对 `solveUniverse()`、`universeShapes()`、发货 `BOOK` 三处取数，
与 `test/book.test.mjs`、`test/solve.test.mjs:124` 的断言值一致）。
宇宙里两行局面共 **53** 个，其中 **8** 个是必败局 —— 恰好是 `(2,1)…(9,8)` 那八条阶梯。
「全宇宙穷举很快」这句话在本仓不是读数，是判据：`test/solve.test.mjs:177-189` 对 32 关逐关重建表，
断言 `worstStates <= 419`（`test/solve.test.mjs:188`）**且** 最贵一次建表 `<= 50 ms`（`test/solve.test.mjs:189`），本轮这两条是绿的。
具体多少毫秒本文不写 —— 它随同机负载漂，写死就成了一条别人复跑必红的承诺。
所以「玩家点击时不搜索」不是性能妥协，是没有必要。

**档位的 census 是精确分数，不是抽样**：`js/core/make.js:candidates()` 把一个档位里的**所有**形状枚举一遍，
`eligibility()` 逐个判（`js/core/make.js:71-82`）。下表是本轮**重跑的只读 census**
（临时脚本导入 `candidates/buildTable/eligibility`，不写盘），
结构量与 `DESIGN.md:73-78`、`deliverable.md:52-55` 记录的 2026-09-27 那一次**逐格相同**
（候选数、通过门槛数、两类拒绝计数都对得上；最右两列口径不同，见下表下的说明）：

| 档位 | 上限（行/列/面积，最少格） | 候选 census | 通过门槛 | 拒绝原因 | 合格集的 k / states 区间 | 本档发货 |
| --- | --- | --- | --- | --- | --- | --- |
| `shoal` 浅咬 | 2 / 4 / 8，≥3 格 | 14 | 8（57.1%） | p-position 4、too-small 2 | k 1–1 / states 3–14 | 8 |
| `linked` 连排 | 2 / 8 / 16，≥4 格 | 44 | 33（75.0%） | p-position 8、too-small 3 | k 1–1 / states 4–44 | 8 |
| `twined` 三缕 | 3 / 6 / 12，≥5 格 | 67 | 47（70.1%） | p-position 12、too-small 8 | k 1–3 / states 5–47 | 8 |
| `master` 满盘 | 4 / 8 / 18，≥8 格 | 325 | 264（81.2%） | p-position 32、too-small 29 | k 1–3 / states 8–209 | 8 |

两个百分比别混用：**75.0% 那类是 `合格 / census`**（生成器口径），
**18.2% 那类是 `发货 / census`**（`PER_BAND=8` 的策展上限压出来的，不是求解器拒绝，
`js/data/lots.js` 的 `TIERS_META.acceptPct` 印的是后者：57.1 / 18.2 / 11.9 / 2.5）。
拒绝原因只有 `p-position`（必败局不出题）与 `too-small` 两类出现，
`no-winning-move` 与 `too-many-states` 本轮 census 里计数为 0（一个 N 局面按定义至少有一口，
而单关可达集是 419 的子集，`js/core/make.js:86` 的 `MAX_STATES` 就钉在这个数上）。

**发货表上量的东西**（本轮按 `js/data/lots.js` 逐行加总，非引用旧文档）：32 关、
合计 **340 个合法首口、44 个胜口、296 个错误首口**、总格数 372，`states` 跨 3–209，
`chance` 跨 **0.058824–0.6**（即面板上的 5.9–60.0%，面板那个写法出自 `js/core/library.js:100-102`
的 `printChance`）。三个数都独立对过：
`legal` 之和与 `legalBites()` 现算的 340 相同。
`test/game.test.mjs:155-180` 那个循环遍历每一关 `legalBites()` 里所有非胜口 —— 也就是上面这 296 个 ——
**每个都走完整局**（对手按表走、玩家按 `hintAt` 走），每步都要求玩家已判必败、结局 `status === 'lost'`；
它自己钉的下限只有 `wrongFirsts >= 40`（`test/game.test.mjs:180`），296 是循环实际跑到的数。

难度读数（本轮，全部从发货文件 `js/data/lots.js` 逐行排序数出，无抽样）：
**最薄的是 `master-01` `[8,5,3,2]`、`master-02` `[8,6,3,1]`、`master-03` `[8,5,4,1]` 三关并列** ——
17 个合法首口里只有 1 口赢，`chance` 都是 0.058824；
第四薄才是两行档的 `linked-01` `[8,8]`（15 口里 1 口，0.066667，覆盖 44 个局面）。
最厚的是 `twined-08` `[3,2,1]`（5 口里 3 口，0.6）。
可达集最大的一关同样是 `master-01`：**209** 局面 / **2044** 条边（本轮 census 逐关重跑 `buildTable()` 复现，`states` 与 `bites` 两个字段；`test/solve.test.mjs:185-188` 那条 `worstStates` 就是它）。
两行档的 `k` **恒为 1**（`test/book.test.mjs:164-180` 对 53 个两行局面逐条数过，
本轮按同一组合式子独立数出的也是 53），所以「阶梯 (k,k-1) 就在旁边」是这仓最硬的形状，
不是形容词。

**唯一一处不在博弈论口径上的屏幕数字**：结算卡片上的星星。
`par = Math.max(1, Math.ceil(Math.log2(lot.cells)))`（`js/main.js:161`）是一个纯几何式，
不是表里的量，也没有任何一条断言读它的值（`@pointer` 只把 `stars.textContent` 当 detail 打印，
`tools/playtest.mjs:244`）。见 §七。

---

## 六、目录结构（真实列出来的）

```
index.html                 单 <canvas> 页面 + 面板 + HUD；图标是盘上真 PNG（favicon / apple-touch-icon /
                           manifest 三处引用同一批文件），另挂 og 与 twitter 卡片、theme-color、manifest 链接
manifest.webmanifest       可安装描述（27 行 / 1,440 B）：5 个 icons 全部指向 assets/icons/*.png，
                           id / start_url ./ / scope ./ / display standalone / display_override / orientation /
                           lang / 颜色 / categories / 2 个 shortcuts
sw.js                      同名带版本缓存 chomp-cos-v2（92 行）：同源子资源**网络优先**（缓存优先 + 手写
                           版本号会把旧 JS 永久钉死），activate 删掉一切非当前版本的缓存，离线时导航退回 index.html
js/pwa.js                  注册器（31 行）：file:// 与非浏览器环境静默跳过并回报理由，不抛未捕获异常
css/game.css               样式（207 行 / 8,941 B）：safe-area env() 内缩、button 44×44 命中区、
                           暂停幕布、模态、kbd，以及真的 @media (prefers-reduced-motion: reduce)
js/main.js                 装配层：DOM、路由、存档、暂停/静音/全屏/教学/键盘光标，`window.chomp` 那张闸用的脸
js/view.js                 canvas 绘制 + 手势几何 + rAF 外壳（cellPoint / pointAt / clampToBar / goneSquares /
                           start / stop / setPaused / spriteReport）
js/core/anim.js            固定步长模拟（150 行）：SIM_STEP=1/120、MAX_STEPS=20、种子 LCG；`advance` 是 dt 唯一入口
js/core/audio.js           WebAudio 音色表与**真静音**：静音走 suspend/resume，且在每个 create* 之前判 muted
js/core/shapes.js          位置模型：序理想向量、validateShape、legalBites、applyBite、可达集闭包
js/core/solve.js           穷举 + 记忆化 minimax、全宇宙自底向上表、三条闭式
js/core/book.js            棋书编解码；lookup 越界**抛异常**；report/winningBitesOf 纯查表
js/core/game.js            对局状态机：轮次、非法一口不计数、交出 [1] 即判负、撤销、认证线路
js/core/make.js            四个档位、候选 census、出题门槛与拒绝原因
js/core/library.js         池 API：verifyLot/verifyPool、derive、#/daily、#/random
js/core/rng.js             hashSeed（FNV-1a 派生的两轮 UTF-16 混合）+ mulberry32
js/core/storage.js         一个 localStorage 键（含 settings 段：muted / seenTutorial / motionOverride）；
                           唯一被允许提 window 的 core 模块，requireBackend 会抛
assets/gen/make_art.py     **唯一图源**（448 行 / 19,039 B，python3 + Pillow）：母题图标 13 张、
                           游戏内 cocoa / foil / skull / crumb 4 张、og 卡 1 张；`--check` 读 IHDR 对账
assets/icons/ assets/textures/ assets/og/   上面那支脚本产出的 18 张真 PNG（无一张 0 字节、无 SVG 冒充）
js/data/lots.js            生成物：BOOK（419 行）+ 32 关 + TIERS_META + DAILY_IDS（本轮实测 15,266 B，
                           BAKED_AT 2026-09-27T10:19:32.740Z，SCHEMA chomp-lots-v1）
server.cjs                 零依赖静态服务（5201，root 形态）；CommonJS，Electron 的 main 也 require 它；
                           本轮补 `.webmanifest → application/manifest+json`，缺它装不上
electron/main.cjs          桌面壳（34 行，port 0 自挑）；`electron` 未列为依赖，故本机跑不起来
tools/harness.mjs          微型框架（node 与浏览器同形输出）
tools/bake.mjs             构建期出题 + 两条路线对账 + 写盘前 round-trip（会覆写 js/data/lots.js）
tools/playtest.mjs         裸 CDP 驱动 + 四套页内场景 + 一套真鼠标场景（592 行 / 38,193 B）
tools/verify.sh            浏览器闸的生命周期（判据只有「有没有 fail 行」与「console 干不干净」）
test/*.test.mjs            九套 node 套件（anchor anim book game library model rng solve storage）
test/fixture.mjs           手算期望值（12 条 fixture + 两行阶梯 + 单行向量），被 anchor/solve 引用
test/naive.mjs             第三份独立实现的枚举与无记忆化暴力递归，测试专用
.github/workflows/ci.yml   unit + browser 两个 job（browser 跑 SKIP_UNIT=1 / WD_TIMEOUT=240）
.github/workflows/pages.yml 组装 _site 并**当场对账**：index.html 与 manifest 指到的每条路径必须在产物里，
                           产物里 ≥11 张非空 PNG；assets/gen（构建期脚本）不进产物
DESIGN.md / deliverable.md README.md LICENSE .gitignore
```

没有 `tests/` 这个目录（是 `test/`），也没有构建产物目录。资源目录 `assets/` 是本轮新增的，
但它不是"手工塞进来的图"：唯一的图源是 `assets/gen/make_art.py`，18 张 PNG 全部由它算出来，
`--check` 读 IHDR 与期望表对账（读数见 §一最后一行）。canvas 上仍然是程序绘制为主 ——
贴图只是在解码成功时叠一层颗粒与箔纹，`sprites.skull.ready` 为假就走 `skull()` 那条手绘路径，
所以拔掉 `assets/` 页面照样能画，只是不好看了。
`@boot` 里读 `performance.getEntriesByType('resource')` 的那两条断言已随本轮改写：旧的那条要求
"一个图片请求都不许有、favicon 必须是内联 `data:image/svg+xml`"，那是**没有美术的口径**；
现在钉的是新口径 —— 每个位图请求都必须是同源 `/assets/` 下的 `.png`、一个 webfont/音频/SVG
光栅请求都不许有、三处 icon `<link>` 都指向盘上真 PNG 且含 180px 那张、四张贴图在页面里
必须报 `ready` 而不是退回程序绘制（`tools/playtest.mjs:398-409`，本机 2026-10-04 那次跑绿，见 §四 末段与 §七第 1 条）。

---

## 七、这个仓**不承诺**什么

1. **不承诺浏览器闸在每个回合都复跑得到。** 本机 2026-10-03 与 2026-10-04 那两次都是绿的：五套场景 91 行、
   `=== ALL GREEN ===`、console 干净（逐套读数在 §四 末段，两次一字不差）。但那都是**带日期的观测**，
   不是一条每轮都成立的承诺 —— 同一台机器上**原样**跑 `bash tools/verify.sh` 会被自己的预检拒绝开工：
   `rc=8`，日志点名这台机器上已有一个带 `--remote-debugging-port=9373` 的 headless Chrome
   （`--user-data-dir=/tmp/sky-chrome-profile`，**不是本仓的**），并且**一个子进程都没派生** ——
   跑完之后 `:5201` 与 `:9361` 上仍然没人听。这一条就是 §八 那句「占号就当红，不借用」的实现证据。
   那一次绿是显式给了 `ALLOW_ORPHAN_CHROME=1 CDP_PORT=9361`（先确认 9361 与 5201 没人听）才开工的，
   预检本身一个字都没放宽：台架纪律写在 `DESIGN.md` 第十节，预检在 `tools/verify.sh:100` 起
   （`exit 6/7/8` 三种抢口各一种）。10-03 那一份日志把这台 Chrome 念成了「10 个」——一个浏览器的每个
   renderer helper 的 argv 里都重复着同一个 `--remote-debugging-port`；现在那一行按**浏览器主进程**计数，
   并把抢口那台的 pid／存活时长／`--user-data-dir` 一起打出来，好让人判断它是不是自己的（拒绝开工的条件没变）。
   每轮都复跑得到的只有 node 侧（D3 那九套真跑）与 §四 的静态调用点计数
   （boot 21 / play 20 / routes 14 / save 12 / pointer 25 个调用点，按 `tools/playtest.mjs:347`
   起的场景分段数的，D8 把它与文档逐字比）。本轮两者恰好对上了；**上一轮对不上**：
   `5f634d2` 把壳层版本抬到 2 却留下场景里写死的 `c.version === 1`，`@boot` 因此连红三天，
   而首访规则卡让后四套场景的每一口都被「已暂停」拒掉 —— 这两处现在各有一条断言与一把刀盯着
   （D3 那两行 + S13/S14），浏览器腿的读数才第一次可信。
2. **不承诺「断言的内容有意义」，只承诺「条数少不掉」。** 条数这一半本轮已经钉上了三层：
   `tools/verify.sh:31` 的 `MIN_LOGIC_ROWS`（现值 171，就是九套真跑交回的条数之和，文档闸的 D3
   拿它当现值比，把地板调低就是那条红）、`tools/doctest.mjs:794` 的 `EXPECT_ROWS` 与
   `tools/verify.sh:34` 的 `DOCTEST_ROWS_WANT`（两道把闸自己的条数钉死，少发一条断言就红，
   含那条自数）、`tools/verify.sh:38` 的 `SABOTAGE_KNIVES_WANT`（刀被删一把就是 verify 红）。
   「少跑一套」也红：文档闸 D3d 断言 `test/` 下恰好九个文件，且九行逐套 `rows:` 要与 §一 承诺表一致。
   **还钉不住的**是两条：`tools/harness.mjs:42` 的退出码只认 `bad.length`，把一条真比较换成
   `ok(true)` 时条数一字不变；`tools/verify.sh:200` 那行也只**打印**浏览器腿的 `rows:`，
   判红看的是 `fail`（`tools/verify.sh:203`）与那一行的 `sys.exit`。这一族别的仓按腿钉死单套条数
   （`yajilin` 的 `tools/check.mjs` 读套件自报的 `RESULT … checks= fails=`，`norinori` 的
   `tools/verify.sh:186` 那条 `want_checks`），本仓只在**逻辑腿的总和 + 文档逐套清单**上钉，
   浏览器五套本轮只钉了静态调用点数（本节第 1 条与 §四）。
3. **不承诺难度梯子在档位之间单调。** 没有任何一条断言说「master 比 twined 难」。
   本轮从发货表数的 `chance` 区间是 `shoal 14.3–50.0% / linked 6.7–10.0% / twined 9.1–60.0% / master 5.9–17.6%`
   —— 按「随机一口就赢」这个本仓自己的口径，`twined-08` `[3,2,1]`（60%）比**整个 linked 档**都容易，
   而各档发货的 `states` 也不成序（3–14 / 29–44 / 13–47 / 182–209：`twined` 的 13 就在 `linked` 的 29 之下）——
   它量的是这张表要证多大一片，不是难度。
   档位是按行数与面积分的，不是按可证的难度序分的。
4. **不承诺结算星级的口径。** 星星来自 `Math.ceil(Math.log2(cells))` 这个几何式（`js/main.js:161`），
   不在棋书里，也不在任何断言里；它是屏幕上唯一一个复算不出「博弈论价值」的数字。
   上一版 README 没提这一点，现在明确：它就是个装饰性评分，别引用成难度。
5. **不承诺规则出处。** 玩法四条是仓内自述，没有任何出版物或网页被钉住；
   唯一的外部结论是两行阶梯刻画（`test/fixture.mjs:112` 的 "Tweed 1908"），
   连它都没有给出可核对的文献条目 —— 但它是**当期望值用的**，不是当装饰用的：
   本轮 43 条锚点断言全部通过，其中反方向要求「45 个两行局里除 8 条阶梯外全部必胜」（37 条）。
6. **不承诺 4 行 / 10 列 / 18 格以外还能玩。** 越界的查表**抛异常**（`js/core/book.js:58-65`，
   `test/book.test.mjs:64-93`、`@play` 里 `c.classify('12.12')` 也必须抛）。
   上限不是随手写的：可达集是序理想，矩形就到 `C(r+w,r)-1`（`js/core/solve.js:255-257` 的 `rectangleIdealCount`），
   再大就是组合爆炸，而且本仓没有新的可证的量可印（`DESIGN.md:124-125`）。
7. **不承诺必败题、换位、让子、自适应。** 出货门槛硬性要求 `winner==='先手'`
   （`js/core/library.js:56` 与 `js/core/make.js:77`），所以 32 关全是先手必胜；
   表里那 36 个必败局面只被用来当判定的分母（`test/game.test.mjs:232-246`），没做成模式。
   没有平局规则（本博弈无平局）、没有启发式 AI（对手只查表）。
8. **不承诺存档跨设备。** 只有一个 localStorage 键 `chomp.save.v1`（`js/core/storage.js:15`）：
   通关次数、`best` 只降不升、`unlocked` 只升不降、每日一题打卡。
   没有成就、排行、签到、云存档、内购；分享只带题目路由。
   被拒绝的存储（隐私窗、配额）会被 `persistent()` 明确报成 `false` 而不是「空档」
   （`js/core/storage.js:248-256`），但这一条只有 node 侧的假后端测过（`test/storage.test.mjs`），
   **真浏览器里的隐私窗本轮未测**。
9. **不承诺 `npm run bake` 的可复现性被本轮重验。** 它是唯一能证明「发货文件是被算出来的」的命令，
   但它覆写 `js/data/lots.js`，而那个文件不在文档轮的可动范围里。可用的替代证据是它的**只读等价物**：
   `node test/book.test.mjs` 会重新 `solveUniverse()`、重新 `encodeBook`，并要求与发货的那份
   `JSON.stringify` 逐字节相同（`test/book.test.mjs:54-61`）—— 本轮这条是绿的，
   所以「发货棋书 == 现算棋书」这件事成立；至于**再跑一次 bake 是否还会写出同一个文件**，
   本轮没有证据（`BAKED_AT` 那一行本来就会随时间变，`tools/bake.mjs:197`）。
10. **不承诺 `npm run electron` 能跑。** `electron` 既不在 `dependencies` 也不在 `devDependencies`
    （两处都是 `{}`），仓内也没有 `node_modules/`，`build` 那段配置也没有任何 CI 读它。
    本轮没有尝试执行它。桌面壳是代码存在，不是被验证过的交付物。
11. **不承诺线上站点可读。** `pages.yml` 只拷 `index.html css js`（`.github/workflows/pages.yml:29-31`），
    本仓 README 与 DESIGN 里也没有写出发布 URL 的那一行；`deliverable.md:149-161` 记录了
    主代理 2026-09-27 抓到的 `/` 200 / 4,091 B 等读数（与本仓 `index.html` 的实测字节一致），
    但那是**别人的那一次**，本轮没有做网络复核，本文也没有把任何 URL 写成仓内事实。
12. **不承诺界面对手感与美术。** 浏览器闸只认三类证据：DOM 矩形/文本、画布像素采样、真指针事件读数。
    `.hidden`、类名、注释里的意图一概不算证据（`tools/playtest.mjs:372-381` 用像素采样判断「巧克力真的画出来了」，
    用 `getBoundingClientRect` 判断控件存在，别的一律不读）。
13. **发货的棋书就是答案表，这是故意的。** `pages.yml` 会连 `js/data/lots.js` 一起发出去，
    因为页面要靠它实时印「当前判定」。任何人 `F12` 读 419 行里的 `1/0` 就能知道每一口之后是胜是败。
    本仓不承诺「答案不可查」；它承诺的是「答案不是猜的」。
14. **不承诺每一处行号引用都担保了「那一行写的是什么」。** 三份文档里印了 158 处 `path:NN` 引用，
    其中不带名字的**裸引用 134 处**：D13 那根锚点腿一条都不核它们，它们只过 D6 的范围检查
    （那一行落在真实文件的行数里），把行号往旁边挪两行仍然绿。锚点腿管的是**带名字**的那一族——
    名字由引用现推，两种写法都认：行号与名字各占一个反引号段、中间只隔「的」或一个括号；
    以及把行号和名字装在同一个反引号里的那种。现推锚点 20 条，逐条回数
    被指的那几行里真有这个名字，比对**按整词认**——`EXPECT` 坐在 `EXPECTS` 里不算命中，
    名字少抄一个字母就是漂。这条收紧当场红了一处真写法：文档里指「矩形序理想那三行」的那处引用，
    前面挨着的是数学记号 C(r+w,r)-1，现推的名字被读成了单个 C，而那几行里并没有 C 这个符号——
    那是记号不是符号，本就没有担保；文档现在把两头写全（记号后面补上真的函数名），锚点腿核的是那个
    函数真坐在被指的三行里。台账里的 S15 就是打在这上面的刀，它**只改名字、不改行号**，
    所以范围腿与手抄清单都看不见它，只有锚点腿认得。剩下的 134 处没有担保：读它们的时候，
    「那一行到底是不是文档说的那样」是要自己打开文件确认的事，不是文档已经替你核对过的事。
    这三个数（158 处引用 / 134 处裸引用 / 20 条锚点）也不是抄完就算：D13c 拿这一次真的推出来的
    条数与处数复比对账，删掉其中任何一个数字都会红。

---

## 八、端口与 URL 形态

三个号写死在源码里：**web 5201**（`server.cjs:49,60`、`tools/verify.sh:24`、`package.json:9`）、
**CDP 9361**（`tools/verify.sh:23`、`tools/playtest.mjs:20`）、以及 `verify.sh` 自己那一串退出码
（`2` 找不到 Chrome / `3` devtools 没绑上 / `4` 静态服务没答 / `5` `window.chomp` 始终没出现 /
`6` `9361` 已被别的孤儿 Chrome 占 / `7` `5201` 已被占 / `8` 机器上还有别的带 remote-debugging-port 的
headless Chrome）。占号就当红，不借用：借来的端口会发出另一个应用的 `index.html`，
而「页面加载成功了」分不清这件事。兄弟仓的号（gridlock 5180/9340、nine-rings 5181/9341、
tango 5191/9351）写在 `tools/verify.sh:6-7` 与 `DESIGN.md:130-131`，本仓刻意错开。
`SHOTS_DIR` 默认落在 `/tmp/chomp-shots`（`tools/verify.sh:26`），看门狗预算 `WD_TIMEOUT` 默认 420 s，
CI 的 browser job 压到 240 s（`tools/verify.sh:147`、`.github/workflows/ci.yml:57`）。

URL 形态：**浏览器闸默认只跑一种** —— root 形态 `http://127.0.0.1:5201/`，仓库自己就是文档根
（`tools/verify.sh:25` 的 `BASE=${BASE_URL:-http://127.0.0.1:$WEB_PORT/}`）。
`BASE_URL` 可以整体替换（对着线上那一跑读同一个闸），但要注意两件事：脚本在 `BASE_URL` 被覆盖时
**仍然会另起本地 `server.cjs`**（`tools/verify.sh:133` 无条件执行），而就绪轮询与页面都打在 `$BASE` 上；
`tools/playtest.mjs:23-24` 的 `isOurs` 只按 `new URL(BASE).origin` 匹配页签。
**本仓没有第二形态**：没有 Pages 前缀那个端口，也没有 `SHAPES=root|prefix|mobile` 那种多腿循环
（那是同族另两个仓的东西，本仓 `tools/verify.sh` 里 grep 不到 `SHAPES`，也 grep 不到任何
「每场景该交回几条断言」的 need 列表）。路由是 hash 段的四种，与 `js/main.js:46-65` 逐条对应：
`#/c/<n>`（战役第 n 关，越界钳到 1..32）、`#/lot/<id>`（认不到的 id 回落战役首关而不是白屏）、
`#/daily`（`mulberry32(hashSeed('chomp-daily:' + YYYY-MM-DD)).int(DAILY_IDS.length)` 选题，
`js/core/library.js:106-127`，任何设备同一天同一根巧克力）、`#/random/<tier>/<seed>`
（种子串 `chomp-random:<tier>:<seed>`；裸 `#/random` 会把生成的 token 写回地址栏以便分享，
`js/main.js:61`）。`file://` 打不开：ES module 需要 origin，`server.cjs` 与 `electron/main.cjs`
存在的理由都在这句话上。

MIT。

## 上线的到底是哪一批文件

这个仓没有打包器：站点=一次文件拷贝。以前「拷哪些」写在 `pages.yml` 的 `run:` 里（手抄的几行
`cp`）。本地 `index.html` 直读仓库根，永远自洽；线上却按那份清单拷，于是页面后来引用的
`manifest.webmanifest`、`sw.js`、`icons/*` 可能一个都没上去——线上 404，而仓里的引擎测试与
真浏览器闸全绿，因为它们跑的都是仓库根，没有任何一步在「按清单拷」的那个环境下加载过页面。

现在清单只有一份，住在 `tools/assemble-site.sh`：CI 调它拷 `_site`，本地闸调它拷临时目录，
然后**对拷出来的产物**提要求（`tools/deploy-set.mjs`）：

- **W 清单与页面同源**：`pages.yml` 里必须真有 `run: bash tools/assemble-site.sh <dir>` 这一行，
  `ci.yml` 里必须真有 `run: node tools/deploy-set.mjs`。认的是调用那一行，不是文件里出现过这个
  路径——注释里本来就会写它，只 grep 字符串会被一句散文喂绿。
- **R 引用可达**：引用不靠手打名单。从 `index.html` 的 `href/src` 出发，凡解析出来是 `.js`/`.css`
  的就把那一站也扫一遍（CSS 的 `url()`、JS 去掉注释后的 `'./…'` 字面量、`new URL(x, base)` 的两种
  基、`navigator.serviceWorker.register`、`scope`），`manifest` 的 icons/screenshots/shortcuts 各自
  的 `src` 也算引用。取径上读不到的那一站本身就是红（读不到＝这一站根本没扫）。每条引用都必须在
  产物里且非 0 字节；绝对路径单列一条红，因为 Pages 挂在 `/<repo>/` 前缀下会跳出去。
- **P 位图不许说谎**：`manifest` 声明的 `sizes` 必须等于 PNG IHDR 的真实宽高——文件图标读文件头，
  内联成 base64 的图标先解码再读同一段。后一条不是可选项：图标可以住在文件里，也可以被内联进清单
  （fleet 里就有仓禁发任何二进制文件，图标于是只能住在清单里）；如果 P 段只按"是不是 .png 文件"筛，
  内联那一路的谎——声明 512、真图 192——就永远没人核。
- **钉住两个数**：R 段实际检查的路径条数（`42`）与这一次跑的断言条数（`68`），两个数
  都钉在 `tools/deploy-set.mjs` 顶部的那对常量里。没改页面却掉了，说明解析断了；删掉一张图标会同时
  少一条 R10 与那张的 P1/P2，所以两个数一起钉，断言条数能漂就是闸在缩水的信号。这一节故意只写数值、
  不写那对常量的名字：本仓原有的文档闸会拿"文档里出现过的同名标识号"回数它自己的条数（skyscraper
  别仓的文档编号闸就是这种钉法），两道闸共用一个名字就互相打红。

`tools/deploy-set-selftest.mjs` 是这两颗钉的阳性证明：它把仓库复制到临时目录，照着每一类断言
各下一刀（X1 清单不收位图目录 / X2 模块边改名 / X3 CSS 写绝对路径 / X4 `start_url` 绝对 /
X5 删光 >=512 图标 / X6 少一个必填字段 / X7 声明尺寸与真图不符 / X8 workflow 不调脚本 /
X9 CI 不跑闸 / X10 是阴性对照——往入口 JS 追加一行只写在注释里的假路径，闸必须仍然绿、条数仍然
`42`、断言仍然 `68`；X11 og:image 退回相对路径 / X12 og:image 的前缀指向别的 slug /
X13 内联位图谎报尺寸——只在有靶子时下：X11/X12 要页面上那句 og:image，X13 要清单里真有一段 base64
图标，没有就打印 SKIP；反过来 X1 没有位图目录可砍时改砍 css，P 段一位都不核时台架直接报靶子不够），
要求每一刀都让闸**点名**变红。靶子从 `DEPLOY_SET_DUMP=1`
的出处表现挑（取径真的会读的那支 JS / 那一张 CSS，不写死某一个仓的入口名），所以页面改了、仓与仓
不同，台架跟着走。

`node tools/deploy-set.mjs` 与 `node tools/deploy-set-selftest.mjs` 就是 CI 跑的那两条命令本身
（package.json 里的 `deploy-set` / `deploy-set:selftest` 只是同一支脚本的 npm 入口）；本仓的整闸在 `tools/verify.sh` 的 `=== deploy-set ===` 那一段也各跑一次。它们红的时候并进本仓那条出口的退出码——这一条是这么证的：
把 ci.yml 里那行 `run: node tools/deploy-set.mjs` 砍掉，本仓整闸必须点名红且退出码非 0。
所以「本地全绿、线上 404 自己的 manifest / sw.js / 图标」这一类坏法在本地就会红。
