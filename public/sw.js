// Flow's service worker (the web version only): the app itself opens without a
// connection. Pages are asked from the network first and kept for when it is
// not there; the app's own files (/assets/, named after their content, so they
// never change) come from the cache. Requests to the server (/api/) are never
// kept here: the app keeps its own copies of boards (src/lib/offline.ts), and
// removes them when someone logs out.

const CACHE = "flow-app-v1";

/** The page, and the files it loads */
async function keepApp() {
  const cache = await caches.open(CACHE);
  const res = await fetch("/", { cache: "no-cache" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put("/", res);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await cache.addAll(assets);
}

self.addEventListener("install", (e) => {
  e.waitUntil(keepApp().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // A page (any address of the app is the same page): the network, else the kept one
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
