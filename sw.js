/* Hammering Assessment Tools — service worker
   Precaches the app shell so the app opens offline and qualifies as installable.
   Bump CACHE when any shell file changes. */

const CACHE = "hammer-selector-v6";

const SHELL = [
  "./index.html",
  "./recommend.html",
  "./exposure.html",
  "./styles.css",
  "./app.js",
  "./exposure.js",
  "./engine/recommend.js",
  "./engine/profiles.v1.json",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/logo-hammer.svg",
  "./icons/CISWP_SMYBOL_CMYK.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin GET: always try the network so the latest
// shell shows whenever online (incl. local dev), and refresh the cache with
// what we get. Fall back to cache only when the network is unavailable
// (offline) — navigations then fall back to the cached index.html.
// Cross-origin (e.g. Google Fonts) is left to the browser: cosmetic, fine to fail offline.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return resp;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) => cached || caches.match("./index.html")
        )
      )
  );
});
