// Offline support: app files are served from cache and refreshed in the background.
// Bump VERSION when you change the app so phones pick up the new files.
const VERSION = "wordring-v2";
const SHELL = ["./", "index.html", "style.css", "app.js", "firebase-config.js", "manifest.webmanifest", "icon.svg", "icons/icon-192.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const cacheable = url.origin === location.origin
    || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"
    || (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
  if (!cacheable) return; // Firestore / login traffic goes straight to the network
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: url.origin === location.origin });
    const net = fetch(e.request).then(res => { if (res.ok || res.type === "opaque") cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
