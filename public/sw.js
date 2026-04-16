// Diamond-Quant Live — Service Worker for Push Notifications
const CACHE_NAME = "dq-live-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// Handle push notifications
self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || "Diamond-Quant Live";
  const options = {
    body: data.body || "New pick available",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "dq-notification",
    data: { url: data.url || "/" },
    vibrate: [100, 50, 100],
    actions: data.actions || [
      { action: "view", title: "View Pick" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
