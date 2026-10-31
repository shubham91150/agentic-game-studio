/* Agentic Game Studio — offline service worker (no build step).
 * App shell precache + runtime cache-first for games/uploads.
 * Same-origin only, GET only. No external URLs (CSP-safe). */
var CACHE = "ags-studio-v1";

var APP_SHELL = [
  "/",
  "/studio/",
  "/studio/app.css",
  "/studio/studio.js",
  "/studio/manifest.webmanifest",
  "/studio/icon.svg",
  "/studio/fonts/fonts.css",
  "/studio/fonts/inter-latin-400-normal.woff2",
  "/studio/fonts/inter-latin-500-normal.woff2",
  "/studio/fonts/inter-latin-600-normal.woff2",
  "/studio/fonts/inter-latin-700-normal.woff2",
  "/studio/fonts/jetbrains-mono-latin-400-normal.woff2",
  "/studio/vendor/three.min.js",
];

var RUNTIME_PREFIXES = [
  "/studio/games/",
  "/studio/uploads/",
  "/storage/.uploads/",
  "/studio/live-preview/",
  "/studio/vendor/",
  "/studio/fonts/",
  "/studio/assets/",
];

function isRuntimePath(path) {
  for (var i = 0; i < RUNTIME_PREFIXES.length; i++) {
    if (path.indexOf(RUNTIME_PREFIXES[i]) === 0) return true;
  }
  return false;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(function (cache) {
        return cache.addAll(APP_SHELL);
      })
      .then(function () {
        return self.skipWaiting();
      })
      .catch(function () {
        /* offline-first install is best-effort */
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            if (name !== CACHE && name.indexOf("ags-studio-") === 0) {
              return caches.delete(name);
            }
            return null;
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  var path = url.pathname;
  var shell = APP_SHELL.indexOf(path) !== -1;
  if (!shell && !isRuntimePath(path)) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      });
    }),
  );
});
