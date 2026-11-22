import "fake-indexeddb/auto";
import { it, expect, vi } from "vitest";
import { put, saveProgress, sync, localLibrary } from "../client/storage";
import type { Library } from "../shared/types";
it("retains offline progress and syncs it without replaying an old queue", async () => {
  const lib = {
    podcasts: [],
    queue: [],
    episodes: [{ id: "a", position: 0, updated: 0, played: 0 }],
  } as unknown as Library;
  await put("library", lib);
  await put("queue", ["a"]);
  await saveProgress({ id: "a", position: 42, updated: 20, played: false });
  const fetcher = vi.fn().mockRejectedValue(Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  try {
    await expect(sync()).rejects.toThrow("offline");
    expect((await localLibrary())?.episodes[0].position).toBe(42);
    fetcher.mockImplementation(async (url, opts) => {
      if (url.endsWith("/progress/a"))
        Object.assign(lib.episodes[0], JSON.parse(opts.body));
      return Response.json(url.endsWith("/library") ? lib : { ok: true });
    });
    const fresh = await sync();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/profiles/nic/progress/a", "/api/profiles/nic/progress/a", "/api/profiles/nic/library",
    ]);
    expect(fresh.episodes[0].position).toBe(42);
  } finally {
    vi.unstubAllGlobals();
  }
});
