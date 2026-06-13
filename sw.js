const CACHE = 'chess-v1';
const ASSETS = [
  './',
  './index.html',
  './chess.min.js',
  './stockfish.js',
  './stockfish.wasm',
  './pw.png','./pb.png',
  './nw.png','./nb.png',
  './bw.png','./bb.png',
  './rw.png','./rb.png',
  './qw.png','./qb.png',
  './kw.png','./kb.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
