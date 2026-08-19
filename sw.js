/**
 * FITTED service worker — offline shell + data cache.
 *
 * The app is "mobile-web PWA first" but shipped with no manifest and no SW,
 * so it could not be installed and a subway ride killed it (110-expert eval,
 * mobile-UX + QA panels). Strategy:
 *   - app shell + static chunks: stale-while-revalidate
 *   - /data/*.json (catalog, taxonomy, embeddings): cache-first, refreshed in
 *     the background — these are big and change only on redeploy
 *   - never cache retailer product images (they're on other origins and huge)
 */
// 20260818212728 is replaced at build time. Without it the cache name never
// changed between deploys, so returning users kept getting the OLD app —
// caught by driving the deployed site after a fix and seeing stale output.
const VERSION = "fitted-20260818212728";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll([`${BASE}/`, `${BASE}/manifest.json`])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // retailer images: straight to network

  // Data bundle: cache-first, revalidate in background.
  if (url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
    e.respondWith(
      caches.open(DATA).then(async (cache) => {
        const hit = await cache.match(request);
        const net = fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
    return;
  }

  // Navigations: network-first so a redeploy is picked up, shell as fallback.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(() => caches.match(`${BASE}/`).then((r) => r || Response.error()))
    );
    return;
  }

  // Everything else same-origin: stale-while-revalidate.
  e.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(request);
      const net = fetch(request).then((res) => {
        if (res.ok) cache.put(request, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
