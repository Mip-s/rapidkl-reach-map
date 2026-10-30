// Offline support. Bump VERSION when the precache list changes.
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const TILES = "tiles";
const TILE_LIMIT = 400;
const PRECACHE = [
  "./", "index.html", "style.css", "app.js", "data/network.json", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png",
  "vendor/leaflet.js", "vendor/leaflet.css", "vendor/images/layers.png", "vendor/images/layers-2x.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - TILE_LIMIT))) await c.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "tile.openstreetmap.org") {
    // Only tiles the user has already viewed are kept; no bulk downloading.
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((r) => { if (r.ok) { c.put(req, r.clone()); trimTiles(); } return r; }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  if (url.origin === location.origin) {
    // Network first so new deploys show up; fall back to the stored copy offline.
    e.respondWith(
      fetch(req)
        .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); } return r; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
    );
  }
});
