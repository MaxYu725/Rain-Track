const CACHE_VERSION = 'point-rain-pwa-v1.6.4-pwa25';
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
  './css/settings-phase1a.css',
  './js/app.js',
  './js/api.js',
  './js/config.js',
  './js/forecast.js',
  './js/forecast-map-data.js',
  './js/forecast-map-swirls.js',
  './js/forecast-map-renderer.js',
  './js/forecast-map-canvas.js',
  './js/forecast-map-browser-canvas.js',
  './js/forecast-map-leaflet.js',
  './js/forecast-map-runtime.js',
  './js/forecast-map-spatial.js',
  './js/forecast-map-timeline.js',
  './js/forecast-map-timeline-core.js',
  './js/forecast-map-smoke.js',
  './js/rain-home.js',
  './js/rain-home-shell.js',
  './js/rain-map-quickviews.js',
  './js/rain-map-area-summary.js',
  './js/location.js',
  './js/map.js',
  './js/pwa.js',
  './js/radar.js',
  './js/rain-map-mode.js',
  './js/settings-segmented.js',
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

    for (const path of APP_SHELL) {
      const url = new URL(path, self.location.href).href;
      const request = new Request(url, { cache:'reload' });
      const response = await fetch(request);
      if (!response?.ok) throw new Error(`Unable to precache ${path}`);
      await cache.put(new Request(url), response.clone());
    }

    await Promise.allSettled(OPTIONAL_EXTERNAL.map(async url => {
      const request = new Request(url, { mode:'no-cors', cache:'reload' });
      const response = await fetch(request);
      if (response) await cache.put(request, response.clone());
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([APP_CACHE, RUNTIME_CACHE, TILE_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('point-rain-pwa-') && !keep.has(key))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
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
    event.respondWith(navigationFromCurrentShell(request));
    return;
  }

  if (url.hostname.endsWith('basemaps.cartocdn.com')) {
    event.respondWith(tileCacheFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(currentShellAsset(request));
    return;
  }

  if (url.hostname === 'unpkg.com') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function navigationFromCurrentShell(request) {
  const cache = await caches.open(APP_CACHE);
  const indexUrl = new URL('./index.html', self.location.href).href;
  const cached = await cache.match(indexUrl);
  if (cached) return cached;

  try {
    const response = await fetch(request, { cache:'no-store' });
    if (response?.ok) return response;
  } catch {}

  return (await cache.match(new URL('./offline.html', self.location.href).href)) || Response.error();
}

async function currentShellAsset(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request, { ignoreSearch:true });
  if (cached) return cached;

  try {
    const response = await fetch(request, { cache:'no-store' });
    if (response?.ok) return response;
  } catch {}

  return Response.error();
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
  await Promise.all(keys.slice(0, keys.length - maxEntries).map(key => caches.delete(key)));
}
