/* Toxic Fishing service worker.
 *
 * Strategy: stale-while-revalidate over a versioned precache. Everything the
 * game needs is same-origin and immutable within a release, so the cache is
 * authoritative for speed and offline play, while a background fetch picks up
 * a new deploy for the next launch.
 *
 * Bump CACHE on every deploy. The activate step deletes every other cache, so
 * a stale build can never outlive its version.
 */

const CACHE = 'toxic-fishing-v2';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/three.min.js',
  './assets/fonts/fonts.css',
  './assets/fonts/chakra-petch-latin-400-normal.woff2',
  './assets/fonts/chakra-petch-latin-600-normal.woff2',
  './assets/fonts/chakra-petch-latin-700-normal.woff2',
  './assets/fonts/share-tech-mono-latin-400-normal.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-16.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; add individually so one 404 can't stop the
      // install and leave the app with no offline copy at all.
      .then(cache => Promise.all(
        PRECACHE.map(url => cache.add(url).catch(err => {
          console.warn('[sw] precache skipped', url, err);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the cached shell immediately, refresh behind it.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached => {
        const fresh = fetch(req).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
