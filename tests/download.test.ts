import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { database, ingest, library } from "../server/db";
import { AudioCache } from "../server/cache";
import { openExternal } from "../server/network";
vi.mock("../server/network", async (original) => ({
  ...(await original<typeof import("../server/network")>()),
  openExternal: vi.fn(),
}));
it("shares concurrent downloads, cleans partial files and can retry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "airwave-"));
  const db = database(":memory:");
  try {
    ingest(
      db,
      readFileSync("server/starter.xml", "utf8"),
      "https://example.org/feed",
    );
    const e = library(db).episodes[0];
    const cache = new AudioCache(db, dir, 100);
    const stream = (complete: boolean) =>
      Object.assign(Readable.from([Buffer.from("episode")]), {
        headers: {},
        complete,
      });
    vi.mocked(openExternal)
      .mockResolvedValueOnce(stream(false) as any)
      .mockResolvedValueOnce(stream(true) as any);
    await expect(cache.ensure(e.id)).rejects.toThrow("Incomplete");
    expect(existsSync(cache.path(e.id) + ".part")).toBe(false);
    await Promise.all([cache.ensure(e.id), cache.ensure(e.id)]);
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(library(db).episodes[0].cached).toBe("ready");
    expect(readFileSync(cache.path(e.id), "utf8")).toBe("episode");
    cache.remove(e.id);
    expect(existsSync(cache.path(e.id))).toBe(false);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
