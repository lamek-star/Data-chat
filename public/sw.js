// Offline shell cache: lets DataChat open with no internet (in the browser
// and in the Android app, which loads this site). Only the app's own static
// files are cached: never API responses, never other sites, never errors.
// Private data (records, messages) is kept by the app itself in IndexedDB and
// erased on sign-out; this cache holds no member data. Bumping CACHE deletes
// older caches on activate.
const CACHE = "datachat-shell-v3";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/assets/datachat-transfer-ad.png", "/assets/datachat-logo.png"];
// On a slow connection, don't keep the member staring at a blank screen:
// after this long, open the saved copy (the fresh one still updates the cache).
const NAVIGATION_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(SHELL.map((path) => cache.add(path).catch(() => {}))))
      .then(() => self.skipWaiting()),
  ),
);

self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  ),
);

const cacheable = (request, url) =>
  request.method === "GET" &&
  url.origin === self.location.origin &&
  !url.pathname.startsWith("/api/") &&
  !url.pathname.startsWith("/.well-known/") &&
  !url.pathname.startsWith("/admin");

// Vite gives built files content hashes (app-AbC123.js): they never change,
// so the saved copy is always right and needs no network.
const immutable = (url) => /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(url.pathname);

const save = (request, response) => {
  if (response.ok && response.type === "basic") {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
};

/** Saves the built files the newest app page uses, so it also opens offline. */
async function refreshShell(html) {
  const cache = await caches.open(CACHE);
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await Promise.all(files.map((file) => cache.match(file).then((hit) => hit || cache.add(file).catch(() => {}))));
}

function navigation(event) {
  const network = fetch(event.request).then((response) => {
    if (response.ok && response.type === "basic") {
      const forIndex = response.clone();
      const forRequest = response.clone();
      const forScan = response.clone();
      caches.open(CACHE).then((cache) => {
        cache.put("/index.html", forIndex);
        cache.put(event.request, forRequest);
      });
      forScan.text().then(refreshShell).catch(() => {});
    }
    return response;
  });
  const saved = () => caches.match(event.request).then((hit) => hit || caches.match("/index.html"));
  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS)).then(saved);
  event.waitUntil(network.catch(() => {}));
  return Promise.race([network.catch(saved), timeout.then((hit) => hit || network)]).then(
    (response) => response || saved().then((hit) => hit || Response.error()),
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!cacheable(event.request, url)) return; // browser handles it normally
  if (event.request.mode === "navigate") return event.respondWith(navigation(event));
  if (immutable(url)) {
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((r) => save(event.request, r))));
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => save(event.request, response))
      .catch(() => caches.match(event.request).then((hit) => hit || Response.error())),
  );
});
