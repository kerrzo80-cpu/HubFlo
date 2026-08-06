/* Field offline shell — scoped to /field/ only. Network-first for pages so
 * deploys never leave Ask Blake / Hours on stale JS. Soft-cache icons/manifest.
 */
const CACHE = "ewg-field-shell-v2";
const PRECACHE = ["/ewg-logo.png", "/manifest-field.json", "/api/manifest/field"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("ewg-field-shell") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept Next bundles, APIs (except manifest), or non-Field routes.
  if (url.pathname.startsWith("/_next/")) return;
  if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/manifest/")) return;
  if (!url.pathname.startsWith("/field") && url.pathname !== "/ewg-logo.png" && url.pathname !== "/manifest-field.json") {
    return;
  }

  const isDocument =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html") ||
    url.pathname === "/field" ||
    url.pathname === "/field/" ||
    url.pathname.startsWith("/field/ask") ||
    url.pathname.startsWith("/field/time-check") ||
    url.pathname.startsWith("/field/jobs");

  if (isDocument) {
    // Network-first so tab routes always get the current deploy.
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match("/field")) ||
            (await cache.match("/field/")) ||
            new Response("Offline — open Field again when you have signal.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }),
    );
    return;
  }

  // Static Field assets: cache-first.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        return new Response("Offline", { status: 503 });
      }
    }),
  );
});
