const CACHE_VERSION = 'point-rain-pwa-v1.6.5';
const APP_CACHE = `${CACHE_VERSION}-app`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const TILE_CACHE = `${CACHE_VERSION}-tiles`;
const OPTIONAL_EXTERNAL = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];
const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './css/settings-v165.css',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './js/forecast.js',
  './js/location.js',
  './js/map.js',
  './js/pwa.js',
  './js/radar.js',
  './js/state.js',
  './js/ui.js',
  './js/utils.js',
  './manifest.webmanifest',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_SHELL);
    await Promise.allSettled(OPTIONAL_EXTERNAL.map(async url => {
      const request = new Request(url, { mode:'no-cors' });
      const response = await fetch(request);
      if (response) await cache.put(request, response);
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => ![APP_CACHE, RUNTIME_CACHE, TILE_CACHE].includes(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
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
  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    event.respondWith(tileCacheFirst(request));
    return;
  }
  if (url.origin === self.location.origin || url.hostname === 'unpkg.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response?.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch {
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

async function tileCacheFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
      await trimCache(TILE_CACHE, 180);
    }
    return response;
  } catch {
    return Response.error();
  }
}

async function trimCache(name, maxEntries) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key)));
}