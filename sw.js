const CACHE='chess-v1';
const ASSETS=[
  '/',
  '/index.html',
  '/manifest.json',
  '/fairystockfish/chess.min.js',
  '/fairystockfish/fairystockfish.js',
  '/fairystockfish/fairystockfish.wasm',
  '/assets/legalmove.png',
  '/assets/icon.png',
  '/assets/pieces/pw.png',
  '/assets/pieces/pb.png',
  '/assets/pieces/rw.png',
  '/assets/pieces/rb.png',
  '/assets/pieces/nw.png',
  '/assets/pieces/nb.png',
  '/assets/pieces/bw.png',
  '/assets/pieces/bb.png',
  '/assets/pieces/qw.png',
  '/assets/pieces/qb.png',
  '/assets/pieces/kw.png',
  '/assets/pieces/kb.png'
];

self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    )).then(()=>clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
      const clone=res.clone();
      caches.open(CACHE).then(c=>c.put(e.request,clone));
      return res;
    }))
  );
});