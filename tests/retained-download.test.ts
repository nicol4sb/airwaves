import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { download, downloadedEpisodes, downloads, drop, put, sync } from "../client/storage";
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
