/* 情侣课表 Service Worker：静态资源预缓存 + 离线可用（纯前端，无后端） */
const CACHE = 'couple-schedule-v2';
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

  // 统一的"缓存优先 + 后台更新"：第二次打开几乎瞬间出画面（弱网/海外线路尤其明显），
  // 同时后台悄悄拉新版，下次打开就是最新的。
  const staleWhileRevalidate = fallback =>
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const cp = res.clone();
          caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
        }
        return res;
      }).catch(() => hit || (fallback ? caches.match(fallback) : undefined));
      return hit || net;
    });

  if (url.origin !== location.origin) {
    e.respondWith(staleWhileRevalidate());          // CDN 的 xlsx / ical.js
    return;
  }
  e.respondWith(staleWhileRevalidate('./index.html'));   // 同源页面与图标
});
