const CACHE_NAME = "pgh-static-v2-6-2-print-ios-v31";
const APP_ROOT_URL = new URL("./", self.location.href);
const APP_ROOT_PATH = APP_ROOT_URL.pathname;
const APP_INDEX_PATH = new URL("index.html", APP_ROOT_URL).pathname;
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline-storage.js",
  "./app.js",
  "./history-migration-worker.js",
  "./setup.html",
  "./manifest.webmanifest",
  "./vendor/react.production.min.js",
  "./vendor/react-dom.production.min.js",
  "./vendor/jsQR.js",
  "./vendor/qrcode.js",
  "./vendor/qrcode_UTF8.js",
  "./vendor/html2pdf.bundle-0.10.1.min.js",
  "./icons/favicon.png",
  "./icons/apple-touch-icon.png",
].map(path => new URL(path, APP_ROOT_URL).pathname);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith("pgh-static-") && key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(APP_ROOT_PATH) || url.pathname.includes("/api/")) return;
  // Luôn kiểm tra bản mới trên mạng cho HTML và app.js; nếu mất mạng thì dùng bản đã lưu.
  const isAppScript = url.pathname === new URL("./app.js", APP_ROOT_URL).pathname;
  if (request.mode === "navigate" || isAppScript) {
    const cacheKey = isAppScript ? new URL("./app.js", APP_ROOT_URL).href : APP_INDEX_PATH;
    event.respondWith(fetch(request, { cache: "no-cache" }).then(response => {
      if (response.ok && response.type === "basic") {
        caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, response.clone()));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(cacheKey, { ignoreSearch: true });
      return cached || (request.mode === "navigate" ? await caches.match(APP_ROOT_PATH) : Response.error());
    }));
    return;
  }
  event.respondWith(caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok && response.type === "basic") caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    });
  }));
});
