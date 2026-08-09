const CACHE_NAME = 'gamedev-console-v1';
const ASSETS = [
  '/',
  '/index.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never intercept API requests
  if (['api.openai.com', 'api.anthropic.com', 'api.github.com'].includes(url.hostname)) {
    return;
  }
  
  // Cache-first strategy for app shell
  if (event.request.mode === 'navigate' || ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request);
      })
    );
  }
});