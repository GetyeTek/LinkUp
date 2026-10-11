// ==============================================================================
// LINKUP ASSET CACHE-FIRST GUARDIAN (OFFLINE DATA-SAVER)
// ==============================================================================
// To force all students' devices to discard and re-fetch fresh assets, bump this version:
const CACHE_NAME = 'linkup-book-assets-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key.startsWith('linkup-book-assets-') && key !== CACHE_NAME) {
            console.log('[SW:Cache] 🧹 Discarding obsolete asset cache:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Admin Developer Command Listener (window.purgeBookCache)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'FORCE_PURGE_ASSETS') {
    event.waitUntil(
      caches.delete(CACHE_NAME).then(() => {
        console.log('[SW:Cache] 🧹 Force purge executed for:', CACHE_NAME);
      })
    );
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Strictly target book covers, diagrams, SVG graphics, and internal textbook assets
  const isTargetAsset = 
    url.pathname.includes('/book-assets/') || 
    url.pathname.includes('/covers/') ||
    url.href.includes('book-assets');

  if (!isTargetAsset || event.request.method !== 'GET') {
    return;
  }

  // Bypass cache if developer/gateway passes explicit bypass parameters
  const hasBypassParam = 
    url.searchParams.has('nocache') || 
    url.searchParams.has('purge') || 
    url.searchParams.has('cb');

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      if (!hasBypassParam) {
        // Cache-First: Deliver immediately from local disk storage
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }
      }

      // Initial Fetch: Fetch fresh from the network and lock into storage
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200) {
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        // Offline failsafe fallback
        const fallbackMatch = await cache.match(event.request);
        if (fallbackMatch) return fallbackMatch;
        throw err;
      }
    })
  );
});