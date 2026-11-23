import express from "express";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { ingest, library } from "../server/db";
import { fetchXML, openExternal } from "../server/network";
import { openProfile } from "../server/profile";
import { MockSonos } from "../sonos/adapter";

vi.mock("../server/network", async (original) => ({
  ...(await original<typeof import("../server/network")>()),
  fetchXML: vi.fn(),
  openExternal: vi.fn(),
}));

it("reads the publisher transcript and starts the download before the publisher finishes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "airwave-media-"));
  const { router, db } = openProfile(dir, join(dir, "audio"), false, new MockSonos());
  const podcast = ingest(db, `<rss xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>A show</title>
    <item><title>Episode</title><enclosure url="https://example.org/episode.mp3"/>
    <podcast:transcript url="https://example.org/episode.vtt" type="text/vtt"/></item>
  </channel></rss>`, "https://example.org/feed");
  const [episode] = library(db).episodes;
  expect(episode.transcript?.url).toBe("https://example.org/episode.vtt");

  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test port");
  const base = "http://127.0.0.1:" + address.port;
  const publisher = Object.assign(new PassThrough(), {
    headers: { "content-type": "audio/mpeg", "content-length": "10" },
  });
  try {
    vi.mocked(fetchXML).mockResolvedValueOnce("WEBVTT");
    expect(await (await fetch(base + "/transcript/" + episode.id)).json()).toEqual({ text: "WEBVTT" });

    vi.mocked(openExternal).mockResolvedValueOnce(publisher as never);
    publisher.write("first");
    const download = await fetch(base + "/download/" + episode.id, { signal: AbortSignal.timeout(2000) });
    const reader = download.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("first");
    publisher.end(" last");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(" last");
    expect((await reader.read()).done).toBe(true);

    const setStar = (snapshot: typeof episode | null, updated: number) =>
      fetch(base + "/stars/" + episode.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episode: snapshot, updated }),
      });
    expect((await setStar(episode, 1)).ok).toBe(true);
    expect((await fetch(base + "/podcasts/" + podcast, { method: "DELETE" })).ok).toBe(true);
    expect(library(db).episodes).toEqual([]);

    const archived = Object.assign(new PassThrough(), { headers: { "content-type": "audio/mpeg" } });
    archived.end("archived audio");
    vi.mocked(openExternal).mockResolvedValueOnce(archived as never);
    expect(await (await fetch(base + "/download/" + episode.id)).text()).toBe("archived audio");
    expect(openExternal).toHaveBeenLastCalledWith(episode.audio, 600_000);

    expect((await setStar(null, 2)).ok).toBe(true);
    expect((await fetch(base + "/download/" + episode.id)).status).toBe(404);
  } finally {
    publisher.destroy();
    server.closeAllConnections();
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
