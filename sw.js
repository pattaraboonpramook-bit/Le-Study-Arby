// sw.js — Recall service worker
// App-shell caching so the app launches offline. Never caches /api/* (those
// always need the network) or Supabase requests. Static assets: stale-while-
// revalidate. Navigations: network-first, falling back to the cached shell.
const VERSION = "recall-v9";
const CORE = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "store.js",
  "local.js",
  "supabase.js",
  "ai.js",
  "ai-config.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // API + Supabase: always go to the network, never cache.
  if (url.pathname.startsWith("/api/") || url.hostname.endsWith("supabase.co")) return;

  // Navigations: network first, fall back to the cached shell (offline launch).
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(() => caches.match("index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((resp) => {
            if (resp && resp.status === 200) {
              const copy = resp.clone();
              caches.open(VERSION).then((c) => c.put(request, copy));
            }
            return resp;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (fonts, CDN modules): cache-first, fall back to network.
  e.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request)
        .then((resp) => {
          if (resp && (resp.status === 200 || resp.type === "opaque")) {
            const copy = resp.clone();
            caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached)
    )
  );
});
