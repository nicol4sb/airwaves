import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export function publicAddress(ip: string) {
  return ipaddr.process(ip).range() === "unicast";
}
export function externalURL(value: string, base?: string) {
  const url = new URL(value, base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port))
  )
    throw Error("Use a public HTTP or HTTPS URL");
  return url;
}
export async function publicHost(url: URL) {
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw Error("Private network URLs are blocked");
  return addresses.find((a) => a.family === 4) ?? addresses[0];
}
export async function openExternal(value: string, timeout = 60000) {
  let url = externalURL(value);
  const signal = AbortSignal.timeout(timeout);
  for (let hop = 0; hop < 6; hop++) {
    const chosen = await publicHost(url);
    const response = await new Promise<http.IncomingMessage>(
      (resolve, reject) => {
        const req = (url.protocol === "https:" ? https : http).get(
          url,
          {
            agent: false,
            family: chosen.family,
            signal,
            headers: {
              "User-Agent": "Airwave/1.0",
              "Accept-Encoding": "identity",
            },
            lookup: (_host, _opts, cb) =>
              cb(null, chosen.address, chosen.family),
          },
          resolve,
        );
        req.on("error", reject);
      },
    );
    if (
      [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
      response.headers.location
    ) {
      response.destroy();
      url = externalURL(response.headers.location, url.href);
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw Error("Publisher returned HTTP " + response.statusCode);
    }
    return response;
  }
  throw Error("Too many publisher redirects");
}
export async function fetchXML(url: string, limit = 24 * 1024 ** 2) {
  const stream = await openExternal(url, 35000);
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > limit) throw Error("Publisher response exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
