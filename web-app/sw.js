// Rosca app shell: cached so the app opens instantly and offline. Chain data always comes from the network.
const CACHE = "rosca-shell-v1";
const SHELL = ["/", "/css/base.css", "/css/glass.css", "/css/wallet.css", "/css/ring.css", "/css/app.css", "/js/app.js",
  "/fonts/inter-400.woff2", "/fonts/inter-500.woff2", "/fonts/inter-600.woff2", "/fonts/inter-700.woff2", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Shell: network first (so a new deploy shows up), cache as the fallback. Never touch /api or other origins.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))),
  );
});
