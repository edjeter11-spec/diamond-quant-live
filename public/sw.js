// Quant Betting — Service Worker
// Cache-first for static assets, network-first for HTML + API.
// Bumps the version → invalidates old cache.

// Bump on every SW behaviour change — the activate handler deletes caches
// that don't match, which is what forces existing installs to drop stale
// entries instead of serving them indefinitely.
const VERSION = "dq-v5";
const RUNTIME = `dq-runtime-${VERSION}`;

// Only precache things that don't change per-deploy. HTML is deliberately NOT
// precached — a stale cached shell paired with fresh build chunks (or vice
// versa) produced hydration mismatches and ChunkLoadErrors after every deploy.
const PRECACHE_URLS = ["/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(RUNTIME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("dq-") && k !== RUNTIME)
            .map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isApi = url.pathname.startsWith("/api/");
  const isHtml =
    request.mode === "navigate" || request.destination === "document";

  // Never serve these from cache. They're the "everyone sees the same thing"
  // endpoints — a stale copy on one device (e.g. a phone on a flaky
  // connection falling back to a previous window's board) makes that device
  // disagree with every other one, which is worse than showing nothing.
  const isPinned =
    url.pathname.startsWith("/api/pinned-props") ||
    url.pathname.startsWith("/api/parlay-today");
  if (isPinned) {
    event.respondWith(fetch(request));
    return;
  }

  // Network-first for fresh data, cache fallback for offline shell
  if (isApi || isHtml) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(RUNTIME)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match("/"))),
    );
    return;
  }

  // Next.js build output (/_next/static/**) is content-hashed and changes on
  // every deploy. Serving it cache-first meant a freshly-deployed HTML doc
  // could request a chunk hash the SW had never seen while the SW kept
  // handing back stale chunks — the source of post-deploy ChunkLoadErrors
  // and hydration mismatches. Always go to network for build output, falling
  // back to cache only when genuinely offline.
  const isBuildAsset = url.pathname.startsWith("/_next/");
  if (isBuildAsset) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches
              .open(RUNTIME)
              .then((cache) => cache.put(request, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Cache-first for other static assets (icons, manifest, images)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches
            .open(RUNTIME)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return res;
      });
    }),
  );
});

// Web push handler
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title ?? "Quant Betting", {
        body: data.body ?? "",
        icon: "/apple-icon",
        badge: "/apple-icon",
        tag: data.tag ?? "dq-alert",
        data: { url: data.url ?? "/" },
      }),
    );
  } catch {}
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.openWindow(url));
});
