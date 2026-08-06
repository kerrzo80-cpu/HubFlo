/* Field offline shell — cache app shell + static assets; API still uses outbox. */
const CACHE = "ewg-field-shell-v1";
const PRECACHE = [
  "/field",
  "/field/",
  "/ewg-logo.png",
  "/manifest-field.json",
  "/api/manifest/field",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE && key.startsWith("ewg-field-shell")).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API mutations/data — outbox handles offline writes.
  if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/manifest/")) {
    return;
  }

  // Field shell + static: cache-first, network fallback.
  if (
    url.pathname.startsWith("/field") ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/app-icons/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/ewg-logo.png" ||
    url.pathname === "/ewg-mark.png"
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) {
          event.waitUntil(
            fetch(request)
              .then((response) => {
                if (response && response.ok) cache.put(request, response.clone());
              })
              .catch(() => undefined),
          );
          return cached;
        }
        try {
          const response = await fetch(request);
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          if (url.pathname.startsWith("/field")) {
            const fallback = await cache.match("/field") || await cache.match("/field/");
            if (fallback) return fallback;
          }
          return new Response("Offline — open Field again when you have signal.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      }),
    );
  }
});
