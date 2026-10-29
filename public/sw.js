// Reader's HUB — Lightweight Production PWA Service Worker
const CACHE_NAME = "readers-hub-v1";
// Books the reader explicitly saved for offline use (written by lib/reader-storage.ts). Never purged here.
const OFFLINE_BOOKS_CACHE = "readershub-offline-books-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/maskable-icon-192x192.png",
  "/icons/maskable-icon-512x512.png",
  "/icons/apple-touch-icon.png",
  "/images/logo.svg"
];

// Install: Cache critical PWA app shell assets and activate immediately
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("[PWA SW] Pre-caching notice:", err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: Claim clients and cleanup old cache generations
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== OFFLINE_BOOKS_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

async function serveOfflineBook(request) {
  let cached;
  try {
    const cache = await caches.open(OFFLINE_BOOKS_CACHE);
    cached = await cache.match(request.url);
  } catch (e) {
    cached = undefined;
  }
  if (!cached) {
    return fetch(request);
  }

  const range = request.headers.get("range");
  if (!range) {
    return cached;
  }

  // pdf.js streams large books with Range requests; answer them from the cached full copy
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  const blob = await cached.blob();
  const size = blob.size;
  if (!match || (match[1] === "" && match[2] === "")) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  return new Response(blob.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "application/pdf",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

// Fetch: Network-first for dynamic navigation and API routes; Cache-first for static icons/assets
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and external origins (Firebase, APIs, CDNs)
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Bypass service worker for Next.js API endpoints and dynamic auth routes
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Saved books: serve from the offline cache (with byte-range support for pdf.js), else network
  if (url.pathname.startsWith("/pdfs/")) {
    event.respondWith(serveOfflineBook(request));
    return;
  }

  // Static Assets (Icons, Images, Fonts, Manifest): Cache-first with Network Fallback
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/images/") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation & Page Requests: Network-first with Cache Fallback for robust offline support
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || caches.match("/");
          });
        })
    );
    return;
  }

  // Default: Network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

