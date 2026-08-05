const CACHE_VERSION = 'point-rain-pwa-v1.3.0';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => ![APP_CACHE, RUNTIME_CACHE].includes(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.hostname.endsWith('workers.dev') || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (url.origin === self.location.origin || url.hostname === 'unpkg.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch (_) {
    return (await caches.match('./index.html')) || (await caches.match('./offline.html'));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}
