import { openDB } from "idb";
import type { Library, Episode } from "../shared/types";
import { apiPath, profile } from "./profile";
// Nic keeps the original store, including downloads and unsynced progress.
const db = openDB(profile === "nic" ? "airwave" : "airwave-" + profile, 1, {
  upgrade(db) {
    for (const key of ["meta", "audio", "progress"]) db.createObjectStore(key);
  },
});
export async function get<T>(key: string): Promise<T | undefined> {
  return (await db).get("meta", key);
}
export async function put(key: string, value: unknown) {
  await (await db).put("meta", value, key);
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(apiPath(path), {
    method,
    signal: signal ?? AbortSignal.timeout(8000),
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Airwave": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("login-needed"));
    throw Error(
      (await res.json().catch(() => ({}))).error || "Server unavailable",
    );
  }
  return res.json();
}
export type Progress = {
  id: string;
  position: number;
  played: boolean;
  updated: number;
};
export async function saveProgress(p: Progress) {
  const tx = (await db).transaction(["meta", "progress"], "readwrite");
  const meta = tx.objectStore("meta");
  const saved: Episode | undefined = await meta.get("saved:" + p.id);
  if (saved && p.updated >= saved.updated)
    await meta.put({ ...saved, position: p.position, updated: p.updated, played: +p.played }, "saved:" + p.id);
  await tx.objectStore("progress").put(p, p.id);
  await tx.done;
}
export async function rememberDownloads(episodes: Episode[], podcasts: Library["podcasts"]) {
  const tx = (await db).transaction(["audio", "meta"], "readwrite");
  const ids = new Set(await tx.objectStore("audio").getAllKeys());
  const titles = new Map(podcasts.map(podcast => [podcast.id, podcast.title]));
  const meta = tx.objectStore("meta");
  for (const episode of episodes) {
    if (!ids.has(episode.id)) continue;
    const key = "saved:" + episode.id;
    const stored: Episode | undefined = await meta.get(key);
    if (!stored || stored.updated <= episode.updated)
      await meta.put({ ...episode, podcastTitle: titles.get(episode.podcastId) }, key);
  }
  await tx.done;
}
export async function downloadedEpisodes(ids: string[]): Promise<Episode[]> {
  const entries = await Promise.all(ids.map(id => get<Episode>("saved:" + id)));
  return entries.filter((episode): episode is Episode => !!episode);
}
export function mergeProgress(lib: Library, items: Progress[]): Library {
  const pending = new Map(items.map((p) => [p.id, p]));
  return {
    ...lib,
    episodes: lib.episodes.map((e) => {
      const p = pending.get(e.id);
      return p && p.updated >= e.updated
        ? { ...e, position: p.position, played: +p.played, updated: p.updated }
        : e;
    }),
  };
}
export async function localLibrary() {
  const d = await db;
  const lib = await get<Library>("library");
  if (!lib) return;
  return mergeProgress(lib, await d.getAll("progress"));
}
let syncTask: Promise<Library> | undefined;
export async function sync(afterMutation = false): Promise<Library> {
  if (afterMutation) await syncTask?.catch(() => {});
  return (syncTask ??= synchronize().finally(() => (syncTask = undefined)));
}
async function synchronize() {
  const d = await db;
  const pending = (await d.getAll("progress")) as Progress[];
  for (const p of pending) {
    await request("progress/" + p.id, "PUT", p);
  }
  const fresh = await request<Library>("library");
  const previous = await localLibrary();
  if (previous) await rememberDownloads(previous.episodes, previous.podcasts);
  const tx = d.transaction(["meta", "progress"], "readwrite");
  await tx.objectStore("meta").put(fresh, "library");
  for (const p of pending) {
    const s = tx.objectStore("progress");
    if ((await s.get(p.id))?.updated === p.updated) await s.delete(p.id);
  }
  await tx.done;
  return (await localLibrary())!;
}
const localAudioURLs = new Map<string, string>();
export function localAudioURL(id: string) {
  return localAudioURLs.get(id);
}
function rememberAudio(id: string, value: Blob) {
  const existing = localAudioURLs.get(id);
  if (existing) URL.revokeObjectURL(existing);
  localAudioURLs.set(id, URL.createObjectURL(value));
}
export async function downloads(): Promise<string[]> {
  const keys = (await (await db).getAllKeys("audio")).map(String);
  const active = new Set(keys);
  for (const [id, url] of localAudioURLs) {
    if (!active.has(id)) { URL.revokeObjectURL(url); localAudioURLs.delete(id); }
  }
  await Promise.all(keys.filter(id => !localAudioURLs.has(id)).map(async id => {
    const audio = await (await db).get("audio", id);
    if (audio instanceof Blob) rememberAudio(id, audio);
  }));
  return keys;
}
export async function drop(id: string) {
  const tx = (await db).transaction(["audio", "meta"], "readwrite");
  await tx.objectStore("audio").delete(id);
  await tx.objectStore("meta").delete("saved:" + id);
  await tx.done;
  const url = localAudioURLs.get(id);
  if (url) URL.revokeObjectURL(url);
  localAudioURLs.delete(id);
}
export async function blob(id: string): Promise<Blob | undefined> {
  return (await db).get("audio", id);
}
export async function download(
  e: Episode,
  report: (n: number) => void,
  manual: boolean,
  serverAvailable = true,
) {
  const sources = serverAvailable
    ? e.cached === "ready" ? [apiPath("download/" + e.id), e.audio] : [e.audio, apiPath("download/" + e.id)]
    : [e.audio];
  let res: Response | undefined;
  for (const source of sources) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), source === e.audio ? 3500 : 10000);
    try {
      const response = await fetch(source, { signal: controller.signal });
      if (response.ok && response.body) {
        res = response;
        break;
      }
      await response.body?.cancel();
    } catch {
      // Publisher downloads can require CORS. Try the server's streaming route.
    } finally {
      clearTimeout(timer);
    }
  }
  if (!res?.body) throw Error("Download unavailable. This publisher may require the home server.");
  const total = Number(res.headers.get("Content-Length"));
  const reader = res.body.getReader();
  let size = 0;
  const parts: ArrayBuffer[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value.slice().buffer);
    size += value.length;
    report(total ? Math.round((100 * size) / total) : 0);
  }
  if (!size || (total && size !== total)) throw Error("Incomplete download");
  const d = await db;
  const tx = d.transaction(["audio", "meta"], "readwrite");
  const audio = new Blob(parts, { type: res.headers.get("Content-Type") || "audio/mpeg" });
  await tx.objectStore("audio").put(audio, e.id);
  await tx.objectStore("meta").put(e, "saved:" + e.id);
  if (manual) await tx.objectStore("meta").put(true, "pin:" + e.id);
  await tx.done;
  rememberAudio(e.id, audio);
}
export function automaticIds(lib: Library, n: number) {
  return lib.podcasts.flatMap((p) =>
    lib.episodes
      .filter((e) => e.podcastId === p.id && !e.played)
      .slice(0, n)
      .map((e) => e.id),
  );
}
