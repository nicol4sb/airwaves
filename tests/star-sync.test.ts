import "fake-indexeddb/auto";
import { openDB } from "idb";
import { expect, it, vi } from "vitest";
import { database, progress, setStar as storeServerStar, stars } from "../server/db";
import type { Episode } from "../shared/types";

const episode: Episode = {
  id: "saved-episode", podcastId: "show", podcastTitle: "A Show", title: "An Episode",
  audio: "https://example.org/episode.mp3", art: "", description: "",
  date: 1, duration: 120, position: 42, played: 0, updated: 10, cached: "none",
};

it("migrates local stars and retries a newer offline unstar after an in-flight add", async () => {
  const previous = await openDB("airwave", 1, {
    upgrade(db) {
      for (const name of ["meta", "audio", "progress"]) db.createObjectStore(name);
    },
  });
  await previous.put("meta", [episode], "starred");
  previous.close();
  const { setStar, starredEpisodes, sync } = await import("../client/storage");
  const server = database(":memory:");
  const remoteLibrary = () => ({ podcasts: [], episodes: [], queue: [], stars: stars(server) });
  let notifySending!: () => void;
  const sending = new Promise<void>(resolve => { notifySending = resolve; });
  let finishSending!: () => void;
  const continueSending = new Promise<void>(resolve => { finishSending = resolve; });
  let offline = true;
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    if (offline) throw Error("Server offline");
    if (url.endsWith("/library")) return Response.json(remoteLibrary());
    const change = { id: episode.id, ...JSON.parse(String(options.body)) };
    if (change.episode) {
      notifySending();
      await continueSending;
    }
    return Response.json(storeServerStar(server, change));
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    expect(await starredEpisodes()).toEqual([episode]);
    await expect(sync()).rejects.toThrow("Server offline");
    expect(await starredEpisodes()).toEqual([episode]);

    offline = false;
    const pending = sync();
    await sending;
    await setStar(episode, false);
    finishSending();
    await pending;
    expect(stars(server)[0].episode?.title).toBe(episode.title);
    expect(await starredEpisodes()).toEqual([]);

    await sync();
    expect(stars(server)[0].episode).toBeNull();
    const mutations = fetcher.mock.calls.filter(([, options]) => options.method === "PUT");
    expect(mutations.map(([, options]) => JSON.parse(String(options.body)).episode)).toEqual([episode, null]);
    await sync();
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "PUT")).toHaveLength(2);

    storeServerStar(server, { id: episode.id, episode, updated: stars(server)[0].updated + 1 });
    await sync();
    expect(await starredEpisodes()).toEqual([episode]);
  } finally {
    vi.unstubAllGlobals();
    server.close();
  }
});

it("keeps archived star snapshots and rejects older edits without changing listening history", () => {
  const db = database(":memory:");
  try {
    storeServerStar(db, { id: episode.id, episode, updated: 20 });
    progress(db, episode.id, 50, false, 30, 30);
    progress(db, episode.id, 50, true, 40, 0);
    progress(db, episode.id, 45, false, 35, 35);
    expect(stars(db)[0].episode).toMatchObject({ position: 50, played: 1, updated: 40, listenedAt: 35 });
    storeServerStar(db, { id: episode.id, episode: null, updated: 60 });
    const retry = storeServerStar(db, { id: episode.id, episode, updated: 20 });
    expect(retry).toEqual({ id: episode.id, episode: null, updated: 60 });
  } finally {
    db.close();
  }
});
