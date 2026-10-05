// 可安装与离线：把「表写全了没有」从人眼对账变成会红的尺，并且真的把 sw.js 跑起来。
//
// 起因是实测到的一个真缺口：js/main.js 静态 `import './pwa.js'`，而 sw.js 的 SHELL 表里没有
// `js/pwa.js`。网络优先的 SW 在断网时只能回答缓存里有的东西，于是「离线首启」会在那一个模块上
// 拿到 503 的纯文本，整条模块图停在 main.js —— 玩家看到的是白屏，而 17 项清单照样打勾。
// 同一段表里还躺着 `js/core/make.js`：它只有 tools/bake.mjs 与 test 会 import，浏览器根本走不到，
// 属于「预缓存许愿单」。两头都是对账缺失，所以这里把方向都钉上。
//
// 三条判据分开站：
//   ① 集合对账：boot graph ∪ index.html 的本地引用 ∪ manifest 的 icons/shortcuts ⊆ SHELL，
//      并且 SHELL 的每一行盘上真有字节（反向对账，除 './' 这个隐式入口）。
//   ② 行为：把 sw.js 塞进 vm，用一套自制的 SW 作用域（caches / Request / Response / fetch）
//      真的派发 install / activate / fetch 三种事件，读它到底先问谁。字符串命中不算过。
//   ③ 端到端：断网状态下沿真实模块图逐个问 SW，13 个模块全拿到副本才叫「离线起得来」；
//      并把 SHELL 改坏一行做反证 —— 尺必须红，否则前两判据是空跑。
//
// 位图另有一条硬尺：manifest 声明的 sizes 要和 PNG IHDR 里的宽高一致。0 字节占位、SVG 冒充
// PNG、声明 512 实际 256，都会在这里红，而不是等部署后 iOS 拿不到图标才发现。
//
//   node test/pwa.test.mjs

import { test, ok, eq, run } from '../tools/harness.mjs';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const ORIGIN = 'https://chomp.test';

// ---- ① 三张清单 ---------------------------------------------------------------

const swSrc = read('sw.js');
const shell = [...swSrc.matchAll(/^\s*'([^']+)',\s*$/gm)].map((m) => m[1]);
const version = /const VERSION = '([^']+)'/.exec(swSrc)[1];
const html = read('index.html');
const manifest = JSON.parse(read('manifest.webmanifest'));

/** 从 js/main.js 出发按真实 `import` 走一遍，得到的就是浏览器为这一次开机必须拿到的字节。 */
function bootGraph(entry = 'js/main.js') {
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    const p = stack.pop();
    for (const m of read(p).matchAll(/from\s+'([^']+)'/g)) {
      const next = normalize(join(dirname(p), m[1]));
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return [...seen].sort();
}

const graph = bootGraph();
const htmlRefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|mailto:|#)/.test(u))
  .map((u) => u.replace(/^\.\//, ''))
  .filter((u) => !u.startsWith('sw.js'))            // sw.js 由注册器取，不是文档子资源
  .filter((u) => !u.includes('?'));
const iconRefs = [
  ...manifest.icons.map((i) => i.src),
  ...(manifest.shortcuts || []).flatMap((s) => (s.icons || []).map((i) => i.src)),
];

test(`boot graph 真数出来是 ${graph.length} 个模块，且每一个都在预缓存表里`, () => {
  eq(graph.includes('js/main.js'), true, '起点必须是自己');
  ok(graph.length >= 13, `模块图只有 ${graph.length} 个文件，数法八成漏了：${graph.join(' ')}`);
  const missing = graph.filter((m) => !shell.includes(m));
  eq(missing, [], `这些模块浏览器开机就要，表里却没有，断网必挂：${missing.join(' ')}`);
});

test('index.html 指向的本地字节全在表里（favicon、apple-touch-icon、样式、脚本、manifest）', () => {
  ok(htmlRefs.length >= 6, `index.html 只数出 ${htmlRefs.length} 条本地引用，正则八成太窄`);
  const missing = htmlRefs.filter((p) => !shell.includes(p));
  eq(missing, [], `页面引用但没进预缓存：${missing.join(' ')}`);
});

test('manifest 的 icons 与 shortcuts 全在表里，且盘上是真的 PNG', () => {
  const missing = iconRefs.filter((p) => !shell.includes(p));
  eq(missing, [], `清单图标没进预缓存：${missing.join(' ')}`);
  for (const p of iconRefs) {
    const b = readPng(p);
    ok(b.magic, `${p} 的 8 字节签名不是 PNG（0 字节或别的格式冒充）`);
    ok(b.bytes > 512, `${p} 只有 ${b.bytes} 字节，不像一张真图标`);
  }
});

test('声明的 sizes 与 PNG IHDR 的宽高逐条对齐（180/192/512/1024 不许虚报）', () => {
  const declared = [
    ...manifest.icons,
    ...(manifest.shortcuts || []).flatMap((s) => (s.icons || [])),
  ].filter((i) => i.sizes && /^\d+x\d+$/.test(i.sizes));
  ok(declared.length >= 6, `只数出 ${declared.length} 条带 sizes 的图标声明`);
  const bad = [];
  for (const i of declared) {
    const [w, h] = i.sizes.split('x').map(Number);
    const png = readPng(i.src);
    if (!png.magic || png.w !== w || png.h !== h) {
      bad.push(`${i.src} 声明 ${i.sizes}，IHDR 是 ${png.magic ? png.w + 'x' + png.h : '非 PNG'}`);
    }
  }
  eq(bad, [], bad.join('\n  '));
});

test('反向对账：表里每一行盘上都有字节，且没有浏览器走不到的死行', () => {
  const absent = shell.filter((p) => p !== './' && !existsSync(join(ROOT, p)));
  eq(absent, [], `预缓存表里这些行指向不存在的文件：${absent.join(' ')}`);
  const jsRefs = graph.flatMap((m) => [...read(m).matchAll(/['"]((?:assets|css)\/[^'"]+?)['"]/g)].map((x) => x[1]));
  const reachable = new Set([...graph, ...jsRefs, ...htmlRefs, ...iconRefs, 'manifest.webmanifest',
    'css/game.css', 'index.html', './']);
  const dead = shell.filter((p) => !reachable.has(p));
  eq(dead, [], `预缓存了浏览器拿不到的行（make.js 那类 build-time 文件）：${dead.join(' ')}`);
});

// ---- ② 把 sw.js 真的跑起来 -----------------------------------------------------

class Req {
  constructor(input, opts = {}) {
    this.url = typeof input === 'string' ? input : input.url;
    this.method = (typeof input === 'object' && input.method) || 'GET';
    this.mode = opts.mode || (typeof input === 'object' ? input.mode : undefined) || 'no-cors';
    this.cache = opts.cache;
    this.headers = new Headers();
  }
  clone() { return new Req(this.url, { mode: this.mode }); }
}
class Res {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status === undefined ? 200 : init.status;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = init.headers || {};
  }
  clone() { return new Res(this.body, { status: this.status, headers: this.headers }); }
}

/** 一套够小的 ServiceWorkerGlobalScope：caches / fetch / clients / 事件派发都留了读数。 */
function makeScope({ online = true, seedCache = true, preNames = [], src = swSrc } = {}) {
  const stores = new Map();            // cache 名 -> Map(url -> Res)
  for (const n of preNames) stores.set(n, new Map());
  const log = { opened: [], added: [], put: [], deleted: [], matched: [], respondWith: 0 };
  const handlers = {};

  function openCache(name) {
    if (!stores.has(name)) { stores.set(name, new Map()); log.opened.push(name); }
    const map = stores.get(name);
    return {
      async add(input) {
        const url = typeof input === 'string' ? input : input.url;
        log.added.push({ url, cache: input && input.cache });
        map.set(absUrl(url), new Res('cached:' + url));
      },
      async put(req, res) { log.put.push(absUrl(req.url)); map.set(absUrl(req.url), res); },
      async match(req) {
        const url = typeof req === 'string' ? absUrl(req) : absUrl(req.url);
        log.matched.push(url);
        return map.has(url) ? map.get(url) : undefined;
      },
      async keys() { return [...map.keys()].map((u) => new Req(u)); },
    };
  }
  const self = {
    addEventListener(type, cb) { (handlers[type] = handlers[type] || []).push(cb); },
    location: { origin: ORIGIN, href: ORIGIN + '/sw.js' },
    clients: { claim: async () => true },
    skipWaiting: async () => true,
  };
  const env = {
    self, console: { log() {}, warn() {}, error() {} },
    Request: Req, Response: Res, URL, TextEncoder, TextDecoder,
    Promise, setTimeout, clearTimeout, setInterval, clearInterval,
    Math, JSON, Set, Map, Array, Object, String, Number, Boolean, Error, TypeError, Date,
    caches: {
      open: async (n) => openCache(n),
      keys: async () => [...stores.keys()],
      delete: async (n) => { log.deleted.push(n); return stores.delete(n); },
      match: async (req) => {
        const url = absUrl(typeof req === 'string' ? req : req.url);
        for (const map of stores.values()) if (map.has(url)) { log.matched.push(url); return map.get(url); }
        log.matched.push(url);
        return undefined;
      },
    },
    async fetch(input) {
      if (!online) throw new TypeError('Failed to fetch（离线）');
      return new Res('network:' + input.url);
    },
  };
  env.globalThis = env;
  const ctx = vm.createContext(env);
  vm.runInContext(src, ctx, { filename: 'sw.js' });
  if (seedCache) {
    const map = stores.get(version) || new Map();
    for (const p of shell) map.set(absUrl(p), new Res('cached:' + p));
    stores.set(version, map);
  }
  const fire = async (type, ev = {}) => {
    const waiters = [];
    let responded = null;
    const event = { waitUntil: (p) => waiters.push(p), respondWith: (p) => { log.respondWith++; responded = p; }, ...ev };
    for (const cb of handlers[type] || []) cb(event);
    await Promise.all(waiters);
    return responded ? await responded : null;
  };
  return { self, fire, log, stores, version: () => version };
}

function absUrl(p) {
  if (/^https?:/.test(p)) return p;
  return new URL(p.replace(/^\.\//, ''), ORIGIN + '/').href;
}

test(`install 事件真跑：按表逐条 cache.add（带 cache:'reload'），cache 名就是 ${version}`, async () => {
  ok(/^chomp-cos-v\d+$/.test(version), `cache 名没带版本号：${version}`);
  const sc = makeScope({ seedCache: false });
  await sc.fire('install');
  eq(sc.log.added.length, shell.length, `cache.add 次数 ${sc.log.added.length} 与表长 ${shell.length} 不符`);
  ok(sc.log.added.every((a) => a.cache === 'reload'), '预热没有带 cache:"reload"，装的是上一版的陈旧字节');
  ok(sc.stores.has(version), `没有开以版本号命名的 cache（开了 ${sc.log.opened.join(',')}）`);
});

test('activate 事件真跑：只留当前版本号那一份，其余整批删掉', async () => {
  const sc = makeScope({ preNames: ['chomp-cos-v1', 'chomp-cos-v2', version] });
  await sc.fire('activate');
  eq(sc.log.deleted.sort(), ['chomp-cos-v1', 'chomp-cos-v2'], `删掉的旧 cache：${sc.log.deleted.join(',')}`);
  ok(sc.stores.has(version), '把当前版本也删了');
});

test('网络优先（行为）：联网时响应来自 fetch，并回写一份进当前 cache', async () => {
  const sc = makeScope({ online: true });
  const res = await sc.fire('fetch', { request: new Req(ORIGIN + '/js/main.js', { mode: 'cors' }) });
  ok(res, '同源 GET 没有被 respondWith');
  eq(res.body, 'network:' + ORIGIN + '/js/main.js', '联网时给的竟是缓存副本 —— 那就是被禁止的 cache-first');
  eq(sc.log.put, [ORIGIN + '/js/main.js'], '网络响应没回写，下次断网就没有救生筏');
});

test('反证·网络优先那把尺不空跑：把 SW 改成 cache-first，同一发必须变成命中缓存', async () => {
  const mutant = swSrc.replace(
    '      const fresh = await fetch(req);',
    '      const stale = await caches.match(req);\n      if (stale) return stale;\n      const fresh = await fetch(req);',
  );
  ok(mutant !== swSrc && /if \(stale\) return stale;/.test(mutant), '变异没打上，这一发白测');
  const sc = makeScope({ online: true, src: mutant });
  const res = await sc.fire('fetch', { request: new Req(ORIGIN + '/js/main.js', { mode: 'cors' }) });
  eq(res.body, 'cached:js/main.js', '改成 cache-first 而尺还说「响应来自 fetch」，那上面那行绿是假的');
});

test('断网时缓存才是救生筏：命中给副本，导航给 index.html，未命中的子资源给 503', async () => {
  const sc = makeScope({ online: false });
  const hit = await sc.fire('fetch', { request: new Req(ORIGIN + '/js/core/anim.js', { mode: 'cors' }) });
  eq(hit && hit.body, 'cached:js/core/anim.js', '表里的模块在断网时没答上来');
  const nav = await sc.fire('fetch', { request: Object.assign(new Req(ORIGIN + '/other', {}), { mode: 'navigate' }) });
  eq(nav && nav.body, 'cached:index.html', '导航请求没退到外壳');
  const miss = await sc.fire('fetch', { request: new Req(ORIGIN + '/nope.js', { mode: 'cors' }) });
  eq(miss && miss.status, 503, '未命中又不是导航时，应当明确报离线而不是假装成功');
});

test('跨源请求一律不代理（respondWith 一次都不许多调）', async () => {
  const sc = makeScope({ online: true });
  const res = await sc.fire('fetch', { request: new Req('https://someone-else.test/track.js') });
  eq(res, null, '把别人的字节塞进了本仓的缓存');
  eq(sc.log.respondWith, 0, `respondWith 被调了 ${sc.log.respondWith} 次`);
});

// ---- ③ 端到端：断网首启沿真实模块图走一遍 --------------------------------------

/** 断网 + 只有 SHELL 那份缓存，逐个模块问 SW；返回拿不到字节的那些。 */
async function offlineBoot(table, entry = 'js/main.js') {
  const sc = makeScope({ online: false, seedCache: false });
  const map = new Map();
  for (const p of table) map.set(absUrl(p), new Res('cached:' + p));
  sc.stores.set(version, map);
  const need = bootGraph(entry);
  const dead = [];
  for (const m of need) {
    const res = await sc.fire('fetch', { request: new Req(absUrl(m), { mode: 'cors' }) });
    if (!res || res.status !== 200) dead.push(m);
  }
  return { need: need.length, dead };
}

test('离线首启真跑：boot graph 的每个模块都从缓存拿得到副本', async () => {
  const { need, dead } = await offlineBoot(shell);
  eq(dead, [], `断网时这 ${dead.length} 个模块拿不到（${dead.join(' ')}），首启就是白屏`);
  ok(need >= 13, `模块图只走了 ${need} 个文件`);
});

test('反证·尺不是空跑：把 js/pwa.js 从表里删掉，离线首启必须断在它身上', async () => {
  const broken = shell.filter((p) => p !== 'js/pwa.js');
  ok(broken.length === shell.length - 1, '变异没删掉东西，这一发白测');
  const { dead } = await offlineBoot(broken);
  eq(dead, ['js/pwa.js'], `删了一行而尺只报 ${JSON.stringify(dead)} —— 说明这把握手是松的`);
});

test('file:// 下整段跳过注册且不抛；http(s) 下带 scope 注册（js/pwa.js 真在 vm 里跑）', async () => {
  const src = read('js/pwa.js').replace(/^export /gm, '');
  const out = {};
  for (const [proto, hasSw, expect] of [['file:', true, false], ['http:', false, false], ['https:', true, true]]) {
    const calls = [];
    const env = {
      console, Promise, Error, TypeError, String, Object, JSON,
      location: { protocol: proto, href: proto + '//x.test/index.html' },
      navigator: hasSw ? { serviceWorker: { register: (p, o) => { calls.push([p, o]); return Promise.resolve({ scope: 'registered:' + o.scope }); } } } : {},
      document: { readyState: 'complete' },
    };
    env.window = env; env.self = env;
    const ctx = vm.createContext(env);
    vm.runInContext(src, ctx, { filename: 'js/pwa.js' });
    out[proto + (hasSw ? '+sw' : '-sw')] = await env.installWhenReady().then(
      (r) => ({ ...r, calls }),
      (e) => ({ threw: String(e) }),
    );
  }
  eq(out['file:+sw'].registered, false, 'file:// 下居然去注册了 SW');
  ok(/不是 http\(s\)/.test(out['file:+sw'].reason || ''), `跳过没给理由：${JSON.stringify(out['file:+sw'])}`);
  eq(out['https:+sw'].registered, true, 'https 下应当注册');
  eq(out['https:+sw'].calls, [['sw.js', { scope: './' }]], '注册没带 scope，子路径部署下 SW 管不到自己');
  eq(out['http:-sw'].registered, false, '没有 navigator.serviceWorker 时不许抛');
  ok(!out['http:-sw'].threw, `抛了未捕获异常：${out['http:-sw'].threw}`);
});

// ---- 位图读数（PNG 签名 + IHDR，零依赖） ---------------------------------------

function readPng(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return { magic: false, bytes: 0, w: 0, h: 0 };
  const fd = readFileSync(p);
  const magic = fd.length > 24 && fd.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!magic) return { magic: false, bytes: fd.length, w: 0, h: 0 };
  const [w, h] = [fd.readUInt32BE(16), fd.readUInt32BE(20)];
  return { magic: true, bytes: fd.length, w, h, depth: fd[24], colorType: fd[25] };
}

test('盘上逐张位图（含未被引用的备用尺寸）都是真 PNG，没有 0 字节占位', () => {
  const onDisk = ['assets/icons', 'assets/textures', 'assets/og'].flatMap((d) =>
    readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.png')).map((f) => d + '/' + f));
  ok(onDisk.length >= 18, `盘上只有 ${onDisk.length} 张位图，母题清单缩了`);
  const bad = [];
  for (const p of onDisk) {
    const png = readPng(p);
    if (!png.magic) bad.push(`${p} 的签名不是 PNG`);
    else if (png.bytes < 512) bad.push(`${p} 只有 ${png.bytes} 字节`);
    else if (png.depth !== 8) bad.push(`${p} 位深 ${png.depth}，不是 8bit`);
  }
  eq(bad, [], bad.join('\n  '));
  const jsRefs = graph.flatMap((m) => [...read(m).matchAll(/['"](assets\/[^'"]+?)['"]/g)].map((x) => x[1]));
  const wanted = new Set([...shell, ...htmlRefs, ...iconRefs, ...jsRefs, 'assets/og/chomp-og.png']);
  const orphan = onDisk.filter((p) => !wanted.has(p));
  ok(orphan.length <= 5, `盘上多出 ${orphan.join(' ')}：既不发盘也不被引用，该删或该接上`);
});

test('游戏内纹理真的被 view.js 取用（资产不是躺在盘上的占位）', () => {
  const view = read('js/view.js');
  const used = ['cocoa-256', 'foil-256', 'skull-160', 'crumb-48'].filter((t) => view.includes(t));
  eq(used.length, 4, `view.js 只引用了 ${used.join(',')}`);
  ok(/createPattern|drawImage/.test(view), '纹理进了代码却没画，等于没画');
});

await run();
