/* MONETA — service worker
 * Stratégie : les données financières ne sont JAMAIS mises en cache (toujours fraîches).
 * Seuls les fichiers statiques (/_next/static, icônes) sont mis en cache ; page hors ligne en secours. */
const STATIC_CACHE = "moneta-static-v1";
const OFFLINE_URL = "/hors-ligne";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll([OFFLINE_URL, "/icon.svg", "/manifest.webmanifest"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.open(STATIC_CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "MONETA", body: "", url: "/" };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: data.url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => { for (const c of list) { if ("focus" in c) { c.navigate(url); return c.focus(); } } return self.clients.openWindow(url); }));
});
