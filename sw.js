const CACHE = "agenda-v40";
const FILES = [
  "./",
  "./index.html",
  "./css/app.css?v=32",
  "./js/app.js?v=40",
  "./js/keys.js",
  "./js/icons.js?v=28",
  "./js/google.js?v=40",
  "./js/sync.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/calendar-180.png",
  "./icons/calendar-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request, { cache: "reload" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html")))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const url = new URL("./", self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(data.title || "Family Calendar", {
    body: data.body || "An urgent plan is coming up.",
    tag: data.tag || "urgent",
    icon: "./icons/calendar-180.png",
    data: { url }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || new URL("./", self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const client of list) {
      if ("focus" in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
    return undefined;
  }));
});
