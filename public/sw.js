// Diamond-Quant Live — Service Worker
// Cache-first for static assets, network-first for HTML + API.
// Bumps the version → invalidates old cache.

const VERSION = "dq-v3";
const RUNTIME = `dq-runtime-${VERSION}`;

const PRECACHE_URLS = ["/", "/track-record", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(RUNTIME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith("dq-") && k !== RUNTIME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isApi = url.pathname.startsWith("/api/");
  const isHtml = request.mode === "navigate" || request.destination === "document";

  // Network-first for fresh data, cache fallback for offline shell
  if (isApi || isHtml) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match("/")))
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});

// Web push handler
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title ?? "Diamond Quant", {
        body: data.body ?? "",
        icon: "/apple-icon",
        badge: "/apple-icon",
        tag: data.tag ?? "dq-alert",
        data: { url: data.url ?? "/" },
      })
    );
  } catch {}
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.openWindow(url));
});
