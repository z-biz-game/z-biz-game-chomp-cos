'use strict';
// Offline shell for 毒格巧克力 CHOMP.
//
// Network-first, always. The temptation is to serve the cache first because it is fast, and that
// is the trap: a hand-written VERSION string plus cache-first pins js/css to whatever the first
// visit cached, so a new index.html ships against old modules and the game enters states nobody
// wrote. Here the network answers whenever it can and the cache is only the life raft — which is
// exactly what "works on the subway" means and what "never serves a mismatched pair" means.
//
// The cache name carries the version, and `activate` deletes every other cache name, so bumping
// VERSION is the one and only eviction step.

const VERSION = 'chomp-cos-v2';
const SHELL = [
  './',
  'index.html',
  'css/game.css',
  'js/main.js',
  'js/view.js',
  'js/core/shapes.js',
  'js/core/game.js',
  'js/core/book.js',
  'js/core/library.js',
  'js/core/make.js',
  'js/core/rng.js',
  'js/core/solve.js',
  'js/core/storage.js',
  'js/core/anim.js',
  'js/core/audio.js',
  'js/data/lots.js',
  'manifest.webmanifest',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/apple-touch-icon.png',
  'assets/textures/cocoa-256.png',
  'assets/textures/foil-256.png',
  'assets/textures/skull-160.png',
  'assets/textures/crumb-48.png',
];

self.addEventListener('install', (e) => {
  // Warm the shell, but never let a missing icon fail the install: the game is 20 modules and a
  // board, and a 404 on a texture must not cost the player their offline copy.
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return; // never proxy a third party's bytes

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(VERSION);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      return new Response('离线且没有缓存副本：{ ' + url.pathname + ' }', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
