// 一个够小的浏览器桩：只服务 test/shell.test.mjs 的"系统控制状态机"。
//
// 为什么要有它：本仓的系统控制（暂停 / 静音 / 首启引导 / 键盘）住在 js/main.js，那是唯一碰 DOM
// 的一层。之前只有 tools/verify.sh 的浏览器套件能跑到它，而浏览器线一次要占一台 headless
// Chrome —— 于是"改了 main.js 的状态机，CI 的 unit job 完全看不见"。这个桩把 main.js 真装进
// node（它自己是 ESM，不需要打包），换来一条零依赖、秒级、会红的回归尺。
//
// 它刻意不复现渲染：canvas 2d 是个吞掉一切的桩，帧回调由测试自己按虚拟时钟喂，
// 所以这里能证的是"状态机 + 推进/停住"，不是"画得好不好看"。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const IDS = new Set([...html.matchAll(/id\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
// index.html 上的裸 `hidden` 必须还原：`openTutorial(el.tutorial.hidden)` 读的就是它，
// 桩里若恒为 false，"再看一次规则"会被测成"关掉规则"，整段读数作废。
const HIDDEN = new Set();
for (const m of html.matchAll(/<(\w+)([^>]*\bid="([^"]+)"[^>]*)>/g)) {
  if (/(^|\s)hidden(\s|>|$)/.test(m[2])) HIDDEN.add(m[3]);
}

let winH = Object.create(null);
let docH = Object.create(null);
let cache = new Map();
let rafQueue = [];
let clock = 1000; // 沙箱时钟从 1000ms 起：从 0 起步会被 view.js 的 `lastTime === 0` 哨兵吃掉一帧
let osc = 0;
// 画布在页面上的位置与尺寸：input 那套件靠它证明「clientX 减掉 rect.left」这一步真的做了。
let RECT = { left: 0, top: 0, width: 800, height: 600 };
export const setRect = (patch = {}) => { RECT = { ...RECT, ...patch }; };
const rectOf = () => ({
  left: RECT.left, top: RECT.top, right: RECT.left + RECT.width, bottom: RECT.top + RECT.height,
  width: RECT.width, height: RECT.height, x: RECT.left, y: RECT.top,
});

const ctx2d = new Proxy({ canvas: null }, {
  get: (o, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 8 });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)) });
    if (typeof k === 'string' && ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'globalAlpha', 'shadowBlur',
      'shadowColor', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin'].includes(k)) return o[k] ?? '#000';
    if (k === 'canvas') return o.canvas;
    return () => {};
  },
  set: (o, k, v) => { o[k] = v; return true; },
});

function makeEl(id, tag = 'DIV') {
  const set = new Set();
  const el = {
    id, tagName: tag, hidden: HIDDEN.has(id), textContent: '', innerHTML: '', value: '1', checked: false,
    width: 800, height: 600, clientWidth: 800, clientHeight: 600, offsetWidth: 800, offsetHeight: 600,
    scrollTop: 0, scrollLeft: 0, children: [], childElementCount: 0, _attr: Object.create(null), _h: Object.create(null),
    classList: { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, f) => { const w = f === undefined ? !set.has(c) : !!f; w ? set.add(c) : set.delete(c); return w; },
      contains: (c) => set.has(c) },
    style: { setProperty() {}, getPropertyValue: () => '', removeProperty() {} },
    addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); },
    removeEventListener(t, f) { if (this._h[t]) this._h[t] = this._h[t].filter((x) => x !== f); },
    dispatch(t, extra = {}) { const ev = mkEvent(t, extra); for (const f of (this._h[t] || []).slice()) f.call(this, ev); return ev; },
    click() { return this.dispatch('click', { target: this }); },
    setAttribute(k, v) { this._attr[k] = String(v); }, getAttribute(k) { return k in this._attr ? this._attr[k] : null; },
    removeAttribute(k) { delete this._attr[k]; }, hasAttribute(k) { return k in this._attr; },
    focus() {}, blur() {}, select() {}, scrollIntoView() {}, closest() { return null; }, contains() { return false; },
    getBoundingClientRect: rectOf,
    getClientRects() { return []; },
    querySelector: () => makeEl('q'), querySelectorAll: () => [],
    append(...n) { this.children.push(...n); }, appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...n) { this.children = n; }, insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { return c; }, remove() {}, insertAdjacentHTML() {},
    getContext() { return ctx2d; }, putImageData() {}, drawImage() {},
    play() { return { then() {} }; }, pause() {}, load() {},
  };
  Object.defineProperty(el, 'parentElement', { get: () => null, configurable: true });
  Object.defineProperty(el, 'parentNode', { get: () => null, configurable: true });
  Object.defineProperty(el, 'firstElementChild', { get: () => el.children[0] || null, configurable: true });
  return el;
}

function mkEvent(type, extra = {}) {
  return { type, target: extra.target || null, currentTarget: extra.target || null,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
}

const ls = new Map();
const localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
  clear: () => ls.clear(),
  get length() { return ls.size; }, key: (i) => [...ls.keys()][i] ?? null,
};
const location = { href: 'http://127.0.0.1:5201/', protocol: 'http:', origin: 'http://127.0.0.1:5201',
  host: '127.0.0.1:5201', pathname: '/', hash: '', reload() {}, assign() {}, replace() {} };

const document = {
  readyState: 'complete', title: '', hidden: false, visibilityState: 'visible',
  getElementById: (i) => { if (!IDS.has(i)) return null; if (!cache.has(i)) cache.set(i, makeEl(i)); return cache.get(i); },
  querySelector: () => makeEl('q'), querySelectorAll: () => [],
  createElement: (t) => makeEl('c-' + t, String(t).toUpperCase()),
  createTextNode: (t) => ({ textContent: String(t) }), createDocumentFragment: () => makeEl('frag'),
  createEvent: () => ({ initEvent() {} }),
  addEventListener(t, f) { (docH[t] = docH[t] || []).push(f); },
  removeEventListener(t, f) { if (docH[t]) docH[t] = docH[t].filter((x) => x !== f); },
  body: makeEl('body'), documentElement: makeEl('html'), head: makeEl('head'),
  activeElement: null, fullscreenElement: null, exitFullscreen: () => Promise.resolve(),
  baseURI: location.href, fonts: { ready: Promise.resolve() },
};

function node() {
  const p = { value: 1, setValueAtTime: () => p, linearRampToValueAtTime: () => p,
    exponentialRampToValueAtTime: () => p, cancelScheduledValues: () => p };
  return { connect: () => node(), disconnect: () => node(), start: () => {}, stop: () => {},
    gain: p, frequency: p, playbackRate: p, type: 'sine', buffer: null, onended: null };
}
class AudioContextStub {
  constructor() { this.state = 'suspended'; this.destination = node(); this.sampleRate = 48000; this.currentTime = 0; }
  createGain() { return node(); } createOscillator() { osc++; return node(); }
  createBiquadFilter() { return node(); } createBufferSource() { return node(); }
  createDynamicsCompressor() { return node(); } createStereoPanner() { return node(); }
  createWaveShaper() { return node(); } createDelay() { return node(); }
  createBuffer(ch, len) { return { length: len, numberOfChannels: ch, sampleRate: 48000, getChannelData: () => new Float32Array(len) }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
class ImageStub {
  constructor() { this.width = 0; this.height = 0; this.complete = false; this.onload = null; this.onerror = null; }
  set src(v) {
    const abs = path.join(ROOT, String(v).replace(/^.\//, ''));
    if (fs.existsSync(abs)) { this.width = 256; this.height = 256; this.complete = true;
      queueMicrotask(() => { if (this.onload) this.onload({ type: 'load' }); }); }
    else if (this.onerror) queueMicrotask(() => this.onerror({ type: 'error' }));
  }
  get src() { return this._src || ''; }
}

const g = globalThis;
const env = {
  document, location, localStorage, devicePixelRatio: 2, innerWidth: 1040, innerHeight: 860,
  navigator: { userAgent: 'node-domstub', language: 'zh-CN', languages: ['zh-CN'], maxTouchPoints: 0,
    clipboard: { writeText: () => Promise.resolve() } },
  matchMedia: (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, onchange: null }),
  requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  addEventListener(t, f) { (winH[t] = winH[t] || []).push(f); },
  removeEventListener(t, f) { if (winH[t]) winH[t] = winH[t].filter((x) => x !== f); },
  dispatchEvent: (ev) => { for (const f of (winH[ev.type] || []).slice()) f(ev); return true; },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  AudioContext: AudioContextStub, webkitAudioContext: AudioContextStub, Image: ImageStub, Audio: ImageStub,
  PointerEvent: class PointerEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } },
  Path2D: class { addPath() {} moveTo() {} lineTo() {} arc() {} rect() {} closePath() {} },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  CustomEvent: class { constructor(t, o = {}) { this.type = t; this.detail = o.detail; } },
  Event: class { constructor(t) { this.type = t; } },
  alert() {}, confirm: () => true, CSS: { supports: () => false },
  history: { pushState() {}, replaceState() {}, forward() {}, back() {} },
};
for (const [k, v] of Object.entries(env)) {
  Object.defineProperty(g, k, { value: v, writable: true, configurable: true });
}
Object.defineProperty(g, 'window', { value: g, writable: true, configurable: true });
Object.defineProperty(g, 'self', { value: g, writable: true, configurable: true });
Object.defineProperty(g, 'global', { value: g, writable: true, configurable: true });

/** 清掉元素/事件桩，让下一次 boot 拿到干净的一套监听器（同一进程里装第二个 main.js 实例时用）。 */
export function resetDom() {
  winH = Object.create(null); docH = Object.create(null); cache = new Map(); rafQueue = [];
  RECT = { left: 0, top: 0, width: 800, height: 600 };
}
export const byId = (i) => document.getElementById(i);
/** 某个元素上挂了几支某类监听器 —— 「回落不许和 pointer 同时绑」就靠它取证。 */
export const listeners = (id, type) => ((byId(id)._h || {})[type] || []).length;
/** 关掉 PointerEvent 要用 delete：留一个 undefined 值的话 `'PointerEvent' in window` 仍为真。 */
export function setPointerSupport(on) {
  if (on) Object.defineProperty(g, 'PointerEvent', { value: env.PointerEvent, writable: true, configurable: true });
  else delete g.PointerEvent;
}
/** 派发一支真形状的 touch 事件：坐标在 touches[0] 上，抬手类走 changedTouches。 */
export function touch(id, type, x, y) {
  const e = byId(id);
  const t = { clientX: x, clientY: y, pageX: x, pageY: y, identifier: 1, target: e };
  const lifted = type === 'touchend' || type === 'touchcancel';
  return e.dispatch(type, { touches: lifted ? [] : [t], changedTouches: [t], target: e, type });
}
export function winDispatch(type, extra = {}) {
  const ev = mkEvent(type, extra);
  for (const f of (winH[type] || []).slice()) f(ev);
  return ev;
}
/** `id` 给 null 时打到 window 上（鼠标回落的 move/up 就绑在那儿）。 */
export function mouse(id, type, x, y, button = 0) {
  const extra = { clientX: x, clientY: y, button, type };
  if (id === null) return winDispatch(type, extra);
  const e = byId(id);
  return e.dispatch(type, { ...extra, target: e });
}
export function key(k, extra = {}) {
  const ev = mkEvent('keydown', { key: k, target: document.body, ...extra });
  for (const f of (winH.keydown || []).slice()) f(ev);
  return ev;
}
export function click(id) {
  const e = byId(id);
  if (!e) throw new Error(`#${id} 不在盘上的 index.html 里`);
  return e.dispatch('click', { target: e });
}
/** 按虚拟时钟喂 n 帧（默认 60Hz 的 16.7ms）。rAF 回调自己续帧，所以队列永远只有一支。 */
export function pump(n = 1, ms = 16.7) {
  for (let i = 0; i < n; i++) {
    clock += ms;
    const q = rafQueue.splice(0);
    for (const cb of q) cb(clock);
  }
}
export const oscillators = () => osc;
export const saveRaw = () => localStorage.getItem('chomp.save.v1');
/** 装一次 js/main.js。`?inst=` 只是绕开 ESM 缓存，让同一进程能装第二份。 */
export async function boot(inst = 1) {
  await import(`../js/main.js?inst=${inst}`);
  return g.chomp;
}
