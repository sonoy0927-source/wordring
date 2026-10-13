// Offline support: the app's own files are fetched fresh when online (so updates show up
// on the next open) and served from cache only when offline.
// Bump VERSION when you change the app.
const VERSION = "wordring-v4";
const SHELL = ["./", "index.html", "style.css", "app.js", "firebase-config.js", "manifest.webmanifest", "icon.svg", "icons/icon-192.png"];

self.addEventListener("install", e => {
  // cache: "reload" skips the browser's HTTP cache so we never store a stale copy.
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: "reload" }).then(r => r.ok && c.put(u, r)).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const own = url.origin === location.origin;
  const lib = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"
    || (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
  if (own) {
    // Network first, bypassing the HTTP cache; fall back to the saved copy offline.
    e.respondWith(caches.open(VERSION).then(cache =>
      fetch(e.request, { cache: "no-cache" })
        .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cache.match(e.request, { ignoreSearch: true }).then(hit => hit || cache.match("./")))));
  } else if (lib) {
    // Versioned libraries and fonts never change: cache first.
    e.respondWith(caches.open(VERSION).then(async cache => {
      const hit = await cache.match(e.request);
      return hit || fetch(e.request).then(res => { if (res.ok || res.type === "opaque") cache.put(e.request, res.clone()); return res; });
    }));
  }
  // Everything else (Firestore, login) goes straight to the network.
});
