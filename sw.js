/* 情侣课表 Service Worker：静态资源预缓存 + 离线可用（纯前端，无后端） */
const CACHE = 'couple-schedule-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))   // 个别文件缺失不影响安装
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    // CDN（SheetJS / ical.js）走"缓存优先 + 后台更新"
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => {
          const cp = res.clone();
          caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }
  // 同源页面：网络优先，失败回落缓存（保证更新及时 + 离线可用）
  e.respondWith(
    fetch(req).then(res => {
      const cp = res.clone();
      caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
