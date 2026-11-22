import { openDB } from "idb";
import type { Library, Episode } from "../shared/types";
const db = openDB("airwave", 1, {
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
): Promise<T> {
  const res = await fetch("/api/" + path, {
    method,
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
  await (await db).put("progress", p, p.id);
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
  return {
    ...mergeProgress(lib, await d.getAll("progress")),
    queue: (await get<string[]>("queue")) ?? lib.queue,
  };
}
let syncTask: Promise<Library> | undefined;
export function sync() {
  return (syncTask ??= synchronize().finally(() => (syncTask = undefined)));
}
async function synchronize() {
  const d = await db;
  const pending = (await d.getAll("progress")) as Progress[];
  for (const p of pending) {
    await request("progress/" + p.id, "PUT", p);
  }
  const q = await get<string[]>("queue");
  if (q) await request("queue", "PUT", { ids: q });
  const fresh = await request<Library>("library");
  const tx = d.transaction(["meta", "progress"], "readwrite");
  await tx.objectStore("meta").put(fresh, "library");
  if (
    q &&
    JSON.stringify(await tx.objectStore("meta").get("queue")) ===
      JSON.stringify(q)
  )
    await tx.objectStore("meta").delete("queue");
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
export async function loadDownloadedAudio() {
  const d = await db;
  const tx = d.transaction("audio");
  for await (const cursor of tx.store) {
    if (cursor.value instanceof Blob) rememberAudio(String(cursor.key), cursor.value);
  }
  await tx.done;
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
  await (await db).delete("audio", id);
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
) {
  const res = await fetch("/api/audio/" + e.id);
  if (!res.ok || !res.body)
    throw Error("Audio download unavailable. Try again when connected.");
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
  await tx
    .objectStore("audio")
    .put(
      new Blob(parts, {
        type: res.headers.get("Content-Type") || "audio/mpeg",
      }),
      e.id,
    );
  await tx.objectStore("meta").put(manual, "pin:" + e.id);
  await tx.done;
  rememberAudio(e.id, new Blob(parts, { type: res.headers.get("Content-Type") || "audio/mpeg" }));
}
export function automaticIds(lib: Library, n: number) {
  return lib.podcasts.flatMap((p) =>
    lib.episodes
      .filter((e) => e.podcastId === p.id && !e.played)
      .slice(0, n)
      .map((e) => e.id),
  );
}
