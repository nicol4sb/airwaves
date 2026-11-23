import { openDB } from "idb";
import type { Library, Episode, RadioStation, StarChange } from "../shared/types";
import { lastListened, withProgress, type Progress } from "./listening";
import { apiPath, profile } from "./profile";
type LocalStar = StarChange & { pending: boolean };

// Nic keeps the original store, including downloads and unsynced progress.
const db = openDB(profile === "nic" ? "airwave" : "airwave-" + profile, 2, {
  async upgrade(db, oldVersion, _newVersion, tx) {
    if (oldVersion === 0)
      for (const key of ["meta", "audio", "progress"]) db.createObjectStore(key);
    const stars = db.createObjectStore("stars", { keyPath: "id" });
    if (oldVersion === 1) {
      const meta = tx.objectStore("meta");
      try {
        const entries: Episode[] = (await meta.get("starred")) ?? [];
        for (const episode of entries) {
          await stars.put({ id: episode.id, episode, updated: 0, pending: true } satisfies LocalStar);
        }
        await meta.delete("starred");
      } catch {
        tx.abort();
      }
    }
  },
});
export async function get<T>(key: string): Promise<T | undefined> {
  return (await db).get("meta", key);
}
export async function put(key: string, value: unknown) {
  await (await db).put("meta", value, key);
}
export async function setStationHidden(station: RadioStation, hidden: boolean): Promise<RadioStation[]> {
  const tx = (await db).transaction("meta", "readwrite");
  const stations: RadioStation[] = (await tx.store.get("hidden-stations")) ?? [];
  const next = stations.filter(entry => entry.id !== station.id);
  if (hidden) next.push(station);
  await tx.store.put(next, "hidden-stations");
  await tx.done;
  return next;
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
export async function saveProgress(p: Progress) {
  const tx = (await db).transaction(["meta", "progress", "stars"], "readwrite");
  const meta = tx.objectStore("meta");
  const progress = tx.objectStore("progress");
  const stars = tx.objectStore("stars");
  const saved: Episode | undefined = await meta.get("saved:" + p.id);
  if (saved) await meta.put(withProgress(saved, p), "saved:" + p.id);
  const star: LocalStar | undefined = await stars.get(p.id);
  if (star?.episode) await stars.put({ ...star, episode: withProgress(star.episode, p) });
  const previous: Progress | undefined = await progress.get(p.id);
  await progress.put(previous ? {
    ...(previous.updated > p.updated ? previous : p),
    listenedAt: Math.max(lastListened(previous), lastListened(p)),
  } : p, p.id);
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
export async function starredEpisodes(): Promise<Episode[]> {
  const stars: LocalStar[] = await (await db).getAll("stars");
  return stars.flatMap(({ episode }) => episode ? [episode] : []);
}
function starChange(id: string, episode: Episode | null, previous?: LocalStar): LocalStar {
  return { id, episode, updated: Math.max(Date.now(), (previous?.updated ?? 0) + 1), pending: true };
}
export async function setStar(episode: Episode, starred: boolean) {
  const tx = (await db).transaction("stars", "readwrite");
  const previous: LocalStar | undefined = await tx.store.get(episode.id);
  await tx.store.put(starChange(episode.id, starred ? episode : null, previous));
  await tx.done;
}
export function mergeProgress(lib: Library, items: Progress[]): Library {
  const pending = new Map(items.map((p) => [p.id, p]));
  return {
    ...lib,
    episodes: lib.episodes.map((e) => {
      const p = pending.get(e.id);
      return p ? withProgress(e, p) : e;
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
  const { stars, ...fresh } = await request<Library>("library");
  const previous = await localLibrary();
  if (previous) await rememberDownloads(previous.episodes, previous.podcasts);
  const tx = d.transaction(["meta", "progress"], "readwrite");
  await tx.objectStore("meta").put(fresh, "library");
  for (const p of pending) {
    const s = tx.objectStore("progress");
    const current: Progress | undefined = await s.get(p.id);
    if (current?.updated === p.updated && current.position === p.position &&
      current.played === p.played && current.listenedAt === p.listenedAt) await s.delete(p.id);
  }
  await tx.done;
  if (stars) await synchronizeStars(stars);
  return (await localLibrary())!;
}
async function synchronizeStars(remote: StarChange[]) {
  const d = await db;
  const changes = new Map(remote.map(entry => [entry.id, entry]));
  const sent = new Map<string, number>();
  const local: LocalStar[] = await d.getAll("stars");
  for (const change of local) {
    if (!change.pending) continue;
    const { id, updated, episode } = change;
    try {
      const confirmed = await request<StarChange>("stars/" + encodeURIComponent(id), "PUT", {
        updated,
        episode: episode && {
          ...episode, description: episode.description.slice(0, 4000), title: episode.title.slice(0, 500),
          podcastTitle: episode.podcastTitle?.slice(0, 300),
        },
      });
      changes.set(id, confirmed);
      sent.set(id, updated);
    } catch {
      // Keep unacknowledged changes for the next sync.
      break;
    }
  }
  const tx = d.transaction("stars", "readwrite");
  for (const change of changes.values()) {
    const existing: LocalStar | undefined = await tx.store.get(change.id);
    if (existing && (existing.updated > change.updated ||
      (existing.pending && sent.get(change.id) !== existing.updated))) continue;
    const snapshot = existing?.updated === change.updated && existing.episode && change.episode
      ? withProgress(existing.episode, { ...change.episode, played: !!change.episode.played })
      : change.episode;
    await tx.store.put({ ...change, episode: snapshot, pending: false } satisfies LocalStar);
  }
  await tx.done;
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
export async function drop(id: string, { automatic = false } = {}) {
  const tx = (await db).transaction(["audio", "meta", "stars"], "readwrite");
  const meta = tx.objectStore("meta");
  const stars = tx.objectStore("stars");
  const starred: LocalStar | undefined = await stars.get(id);
  if (automatic && (starred?.episode || await meta.get("pin:" + id))) {
    await tx.done;
    return;
  }
  await tx.objectStore("audio").delete(id);
  await meta.delete("saved:" + id);
  if (!automatic) {
    if (starred?.episode) await stars.put(starChange(id, null, starred));
    await meta.delete("pin:" + id);
    await meta.put(true, "skip:" + id);
  }
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
