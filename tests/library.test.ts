import { describe, it, expect, afterEach, vi } from "vitest";
import { database, ingest, library, progress } from "../server/db";
import { parseFeed } from "../server/rss";
import { externalURL, publicAddress } from "../server/network";
import { LocalSonos, MockSonos, clock, envelope } from "../sonos/adapter";
import { readFileSync } from "node:fs";
const feed = "https://example.org/feed.xml";
const xml = readFileSync("server/starter.xml", "utf8");
describe("library", () => {
  it("imports real metadata, deduplicates repeats and keeps playback updates", () => {
    const db = database(":memory:");
    const id = ingest(db, xml, feed);
    const original = library(db);
    const e = original.episodes[0];
    expect(original.podcasts[0].title).toBe("99% Invisible");
    expect(e.duration).toBeGreaterThan(0);
    progress(db, e.id, 90, false, 20);
    progress(db, e.id, 5, false, 10);
    ingest(db, xml, feed);
    expect(library(db).episodes).toHaveLength(original.episodes.length);
    expect(library(db).episodes[0].position).toBe(90);
    db.prepare("INSERT INTO queue VALUES(?,0)").run(e.id);
    db.prepare("DELETE FROM podcasts WHERE id=?").run(id);
    expect(library(db)).toEqual({ podcasts: [], episodes: [], queue: [] });
    db.close();
  });
  it("rejects malformed XML without changing subscriptions", () => {
    const db = database(":memory:");
    expect(() => ingest(db, "<rss>", feed)).toThrow();
    expect(library(db).podcasts).toEqual([]);
    db.close();
  });
  it("rejects internal destination addresses and credentialed URLs", () => {
    for (const ip of [
      "127.0.0.1",
      "192.168.1.10",
      "169.254.1.1",
      "::1",
      "::ffff:10.0.0.1",
    ])
      expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
    expect(() => externalURL("http://user@example.org")).toThrow();
    expect(() => parseFeed("<!DOCTYPE rss><rss/>", feed)).toThrow();
  });
});
describe("Sonos", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("escapes publisher query parameters and builds absolute time seeks", () => {
    expect(
      envelope("AVTransport", "AddURIToQueue", {
        EnqueuedURI: "https://example.org/?a=1&b=2",
      }),
    ).toContain("a=1&amp;b=2");
    expect(clock(3723.9)).toBe("01:02:03");
  });
  it("propagates SOAP faults and addresses commands to the coordinator", async () => {
    const s = new LocalSonos();
    (s as any).devices.set("member", { host: "192.168.1.9" });
    const group =
      '&lt;ZoneGroups&gt;&lt;ZoneGroup Coordinator="coord"&gt;&lt;ZoneGroupMember UUID="member"/&gt;&lt;ZoneGroupMember UUID="coord" Location="http://192.168.1.4:1400/xml/device_description.xml"/&gt;&lt;/ZoneGroup&gt;&lt;/ZoneGroups&gt;';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          "<s:Envelope><s:Body><u:GetZoneGroupStateResponse><ZoneGroupState>" +
            group +
            "</ZoneGroupState></u:GetZoneGroupStateResponse></s:Body></s:Envelope>",
        ),
      )
      .mockResolvedValueOnce(
        new Response("<Envelope><Body><Fault/></Body></Envelope>", {
          status: 500,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(s.control("member", "pause", 0)).rejects.toThrow(
      "Sonos Pause failed",
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "http://192.168.1.4:1400/MediaRenderer/AVTransport/Control",
    );
  });
  it("supports mock transfer and pause", async () => {
    const m = new MockSonos();
    await m.start("mock", ["https://example.org/episode.mp3"], 123);
    expect((await m.status()).position).toBe(123);
    await m.control("mock", "pause", 0);
    expect((await m.status()).playing).toBe(false);
  });
});
