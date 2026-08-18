/* Field offline shell — scoped to /field/ only. Network-first for pages so
 * deploys never leave Ask Blake / Hours on stale JS (no Connect / Talk).
 */
const CACHE = "ewg-field-shell-v6";
const PRECACHE = [
  "/ewg-logo.png",
  "/api/manifest/field",
  "/field",
  "/field/ask",
  "/field/time-check",
];

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

  // Document / App Router navigations only — do not treat every /field/* fetch as HTML.
  const isDocument =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html") ||
    url.pathname === "/field" ||
    url.pathname === "/field/" ||
    url.pathname.startsWith("/field/ask") ||
    url.pathname.startsWith("/field/time-check") ||
    url.pathname.startsWith("/field/jobs");

  if (isDocument) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response && response.ok && request.mode === "navigate") {
            const cache = await caches.open(CACHE);
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          const cached =
            (await cache.match(request)) ||
            (await cache.match("/field")) ||
            (await cache.match("/field/")) ||
            (await cache.match("/field/ask")) ||
            (await cache.match("/field/time-check"));
          return (
            cached ||
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
