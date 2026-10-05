// Build injects only versioned static asset URLs. No auth, snapshots or APIs.
const PRECACHE = ['/', '/index.html', '/icon.svg', '/manifest.webmanifest'];
const CACHE = 'four-colors-shell-dev';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('four-colors-shell-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    ['/api/', '/auth/', '/rest/', '/functions/'].some((prefix) => url.pathname.startsWith(prefix))
  )
    return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.open(CACHE).then((cache) => cache.match('/index.html'))),
    );
    return;
  }
  if (PRECACHE.includes(url.pathname))
    event.respondWith(
      caches
        .open(CACHE)
        // Static files are identical for every Origin; Vite's Vary: Origin
        // would otherwise make the precached module miss during offline reload.
        .then(
          async (cache) =>
            (await cache.match(url.pathname, { ignoreVary: true })) || fetch(request),
        ),
    );
});
