import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { download, downloadedEpisodes, downloads, drop, put, setStar, starredEpisodes, sync } from "../client/storage";
import type { Episode, Library } from "../shared/types";

it("retains downloaded audio and its episode metadata after an unsubscribe sync", async () => {
  const episode: Episode = {
    id: "e", podcastId: "p", title: "Episode", audio: "https://example.org/episode.mp3",
    art: "", description: "", date: 1, duration: 60, position: 4, played: 0, updated: 1, cached: "none",
  };
  const lib: Library = {
    podcasts: [{ id: "p", title: "Show", art: "", url: "https://example.org/feed", error: "" }],
    episodes: [episode], queue: [],
  };
  const none: Library = { podcasts: [], episodes: [], queue: [] };
  const network = vi.fn().mockResolvedValueOnce(new Response("audio")).mockResolvedValueOnce(Response.json(none));
  vi.stubGlobal("fetch", network);
  try {
    await put("library", lib);
    await download(episode, () => {}, false);
    expect(await sync()).toEqual(none);
    expect(await downloadedEpisodes(await downloads())).toEqual([{ ...episode, podcastTitle: "Show" }]);
    await drop(episode.id);
    expect(await downloads()).toEqual([]);
    expect(await downloadedEpisodes([episode.id])).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps starred audio through automatic cleanup until it is unstarred or explicitly deleted", async () => {
  const episode: Episode = {
    id: "favorite", podcastId: "p", podcastTitle: "Show", title: "A favorite",
    audio: "https://example.org/favorite.mp3", art: "", description: "",
    date: 1, duration: 60, position: 60, played: 1, updated: 1, cached: "none",
  };
  const fetchAudio = vi.fn(async () => new Response("audio"));
  vi.stubGlobal("fetch", fetchAudio);
  try {
    await setStar(episode, true);
    expect(await starredEpisodes()).toEqual([episode]);
    expect(await downloads()).not.toContain(episode.id);
    await download(episode, () => {}, false);
    await drop(episode.id, { automatic: true });
    expect(await downloads()).toContain(episode.id);

    await setStar(episode, false);
    expect(await downloads()).toContain(episode.id);
    await drop(episode.id, { automatic: true });
    expect(await downloads()).not.toContain(episode.id);

    await download(episode, () => {}, false);
    await setStar(episode, true);
    await drop(episode.id);
    expect(await starredEpisodes()).toEqual([]);
    expect(await downloads()).not.toContain(episode.id);
  } finally {
    vi.unstubAllGlobals();
  }
});
