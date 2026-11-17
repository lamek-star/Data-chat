// Offline shell cache. Only the app's own static files are cached: never API
// responses, never Supabase or other cross-origin data (messages, profiles),
// and never error responses. A shared phone must not keep private data in
// the cache after sign-out. Bumping CACHE deletes older caches on activate.
const CACHE = "datachat-shell-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/assets/datachat-transfer-ad.png"];

self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())),
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
  !url.pathname.startsWith("/admin");

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!cacheable(event.request, url)) return; // browser handles it normally
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((hit) => hit || (event.request.mode === "navigate" ? caches.match("/index.html") : Response.error())),
      ),
  );
});
