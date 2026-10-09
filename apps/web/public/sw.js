/*
 * Munch Mate service worker: web push only. No fetch handler and no caching on purpose (no offline mode yet),
 * so every request keeps going to the network exactly as without a service worker.
 *
 * Registered at scope "/" only when someone turns notifications on (lib/push.ts). Served with
 * Cache-Control: no-cache (next.config.ts) so a new version is picked up on the next registration check.
 *
 * Payload (PushNotification in @app/types): { title, body, url, tag }. `url` is a same-origin path.
 */

self.addEventListener("install", () => {
  // Nothing to precache: take over right away.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Parses the push payload; a malformed one still shows a generic notification (userVisibleOnly). */
function readPayload(event) {
  const fallback = { title: "Munch Mate", body: "", url: "/", tag: "munch-mate" };
  if (!event.data) return fallback;
  try {
    const data = event.data.json();
    return {
      title: typeof data.title === "string" && data.title ? data.title : fallback.title,
      body: typeof data.body === "string" ? data.body : "",
      url: typeof data.url === "string" ? data.url : "/",
      tag: typeof data.tag === "string" && data.tag ? data.tag : fallback.tag,
    };
  } catch {
    return { ...fallback, body: event.data.text() };
  }
}

/** Only same-origin targets: a notification must never send the user to another site. */
function safeUrl(raw) {
  try {
    const url = new URL(raw, self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + "/";
  } catch {
    return self.location.origin + "/";
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      // Same tag replaces the previous notification; renotify makes the replacement ring again.
      renotify: true,
      data: { url: safeUrl(payload.url) },
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      lang: "es-CL",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || self.location.origin + "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // A tab already on that page (tracking URLs differ only in the #fragment, so compare the full URL).
      const same = windows.find((client) => client.url === target);
      if (same) return same.focus();
      // Never navigate another tab of the app away: it could hold a half-edited form.
      return self.clients.openWindow(target);
    })(),
  );
});
