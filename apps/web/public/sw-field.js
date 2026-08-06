/* Legacy root-scoped Field SW — uninstalls itself and clears bad caches.
 * Phase 3 briefly registered this at scope "/", which could serve stale
 * /_next chunks and break Ask Blake / Hours after deploys.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("ewg-field-shell")).map((key) => caches.delete(key)),
      );
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        if ("navigate" in client && typeof client.navigate === "function") {
          try {
            await client.navigate(client.url);
          } catch {
            // Ignore navigation failures; next reload is enough.
          }
        }
      }
    })(),
  );
});
