import { readdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const files = readdirSync("dist", { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && e.name !== "sw.js")
  .map((e) => e.parentPath.replace(/^dist/, "") + "/" + e.name);
const version = createHash("sha256");
for (const f of files) version.update(readFileSync("dist" + f));
writeFileSync(
  "dist/sw.js",
  `const cacheName='airwave-${version.digest("hex").slice(0, 12)}'
self.addEventListener('install',event=>event.waitUntil(caches.open(cacheName).then(c=>c.addAll(${JSON.stringify(files)})).then(()=>self.skipWaiting())))
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('airwave-')&&k!==cacheName).map(k=>caches.delete(k)))).then(()=>self.clients.claim())))
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
event.respondWith(caches.open(cacheName).then(async c=>await c.match(event.request.mode==='navigate'?'/index.html':event.request)||fetch(event.request)))})`,
);
