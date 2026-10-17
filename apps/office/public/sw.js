// Fame Fleet service worker (web build only): shows a push notification and
// opens the app on its link. No caching: a redeploy is never stale.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Fame Fleet";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/" },
    // Phase 7 (§4): the driver's photo and the vehicle's, when the push carries them (Chrome on Windows and Android).
    icon: data.icon || "/icons/icon-192.png",
    image: data.image || undefined,
    badge: "/icons/badge-96.png",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      // The open Fame Fleet window goes to the link (the page's router hears the message).
      client.postMessage({ type: "navigate", url: target });
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow(target);
  }));
});
