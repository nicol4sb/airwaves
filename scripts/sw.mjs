import { readdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const files = readdirSync("dist", { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name !== "sw.js")
  .map((e) => e.parentPath.replace(/^dist/, "") + "/" + e.name);
const version = createHash("sha256");
for (const f of files) version.update(readFileSync("dist" + f));
writeFileSync(
  "dist/sw.js",
  `const cacheName = 'airwave-${version.digest("hex").slice(0, 12)}';
const artworkCache = 'airwave-artwork-v1';
const artworkRequests = new Map();
self.addEventListener('install', event => {
  const requests = ${JSON.stringify(files)}.map(path => new Request(path, { cache: 'reload' }));
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(requests)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('airwave-') && key !== cacheName && key !== artworkCache)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (typeof event.data?.failedArtwork === 'string') {
    event.waitUntil(caches.open(artworkCache).then(cache => cache.delete(event.data.failedArtwork)));
  }
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname === '/health' || url.pathname.startsWith('/api/')) return;
  if (request.destination === 'image' && /^https?:$/.test(url.protocol)) {
    let pending = artworkRequests.get(request.url);
    if (!pending) {
      pending = readArtwork(request).finally(() => artworkRequests.delete(request.url));
      artworkRequests.set(request.url, pending);
    }
    event.respondWith(pending.then(response => response.clone()));
    return;
  }
  if (url.origin !== location.origin) return;
  event.respondWith(caches.open(cacheName).then(async cache =>
    await cache.match(request.mode === 'navigate' ? '/index.html' : request) || fetch(request)
  ));
});
async function readArtwork(request) {
  const bundled = await caches.open(cacheName);
  const local = await bundled.match(request);
  if (local) return local;
  const cache = await caches.open(artworkCache);
  const stored = await cache.match(request);
  if (stored) return stored;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    try {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - 96)).map(key => cache.delete(key)));
    } catch {
      // Artwork still renders if the browser cannot allocate cache space.
    }
  }
  return response;
}`,
);
