// The mobile website's service worker (O4 step 5), scope /m/. Three jobs, no caching of the app itself (a redeploy is never
// stale): (1) a page of the site opened with no connection gets offline.html ("No connection", Try again); (2) a push
// from the office's web push shows a notification, as the desktop site's /sw.js does; (3) a tap opens its place on the
// mobile website: an open window is told (the page maps the desktop link to its screen), else /m/?from=<link>.
// /m/offline, not /m/offline.html: Cloudflare Pages answers the .html address with a 308 to this one, and a page load never
// accepts a redirected answer (Chrome shows its own error instead), 21 October 2026.
const OFFLINE = "/m/offline";
const CACHE = "fame-fleet-m-offline-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fame-fleet-m-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});

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
    icon: data.icon || "/icons/icon-192.png",
    image: data.image || undefined,
    badge: "/icons/badge-96.png",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  const path = link.origin === self.location.origin ? link.pathname + link.search : "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      const u = new URL(client.url);
      if (u.origin !== self.location.origin || !u.pathname.startsWith("/m/")) continue;
      client.postMessage({ type: "navigate", url: path });
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow("/m/?from=" + encodeURIComponent(path));
  }));
});
