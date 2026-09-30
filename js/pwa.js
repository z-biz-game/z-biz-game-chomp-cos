// Service-worker registration, and the rule that keeps it out of trouble: it is a progressive
// enhancement, so anywhere it cannot live (file://, a sandboxed iframe without the right
// permission, an old Safari, a page served over plain http on a LAN address) the whole thing is
// skipped in silence. A red "Failed to construct 'URL'" in the console on first open is a bug
// this repo already paid for once.

export function registerServiceWorker(path = 'sw.js') {
  if (typeof navigator === 'undefined' || typeof location === 'undefined') {
    return Promise.resolve({ registered: false, reason: 'no navigator（node 进程）' });
  }
  const proto = location.protocol;
  if (proto !== 'http:' && proto !== 'https:') {
    return Promise.resolve({ registered: false, reason: proto + ' 不是 http(s)：SW 在这个协议下不存在' });
  }
  if (!('serviceWorker' in navigator)) {
    return Promise.resolve({ registered: false, reason: 'navigator.serviceWorker 不存在' });
  }
  return navigator.serviceWorker.register(path, { scope: './' })
    .then((reg) => ({ registered: true, scope: reg.scope, reason: 'ok' }))
    .catch((err) => ({ registered: false, reason: String(err && err.message ? err.message : err) }));
}

// Called from the load event so it never races the first paint, and never throws.
export function installWhenReady() {
  if (typeof window === 'undefined') return Promise.resolve({ registered: false, reason: 'no window' });
  const go = () => registerServiceWorker().catch((err) => ({ registered: false, reason: String(err) }));
  if (document.readyState === 'complete') return go();
  return new Promise((resolve) => {
    window.addEventListener('load', () => resolve(go()), { once: true });
  });
}
