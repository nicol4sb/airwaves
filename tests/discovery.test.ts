import { afterEach, expect, it, vi } from "vitest";
import { LocalSonos } from "../sonos/adapter";
import { discoverIPs, SonosRecords } from "../sonos/discovery";

vi.mock("../sonos/discovery", async (original) => ({
  ...(await original<typeof import("../sonos/discovery")>()),
  discoverIPs: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("resolves every Sonos service across split, reordered Bonjour replies", () => {
  const records = new SonosRecords();
  const hosts = new Set<string>();
  const type = "_sonos._tcp.local";
  const first = "Studio." + type;
  const second = "Kitchen." + type;
  records.receive([
    { type: "PTR", name: type, data: first },
    { type: "PTR", name: type, data: second },
    { type: "A", name: "unrelated.local", data: "192.168.7.30" },
    { type: "A", name: "older.local", data: "192.168.7.10" },
  ]);
  expect(records.resolve(hosts)).toEqual([
    { type: "SRV", name: first.toLowerCase() },
    { type: "SRV", name: second.toLowerCase() },
  ]);
  records.receive([
    { type: "SRV", name: first, data: { target: "Older.local.", port: 1443 } },
    { type: "SRV", name: second, data: { target: "newer.local", port: 1443 } },
  ]);
  expect(records.resolve(hosts)).toEqual([{ type: "A", name: "newer.local" }]);
  records.receive([
    { type: "A", name: "newer.local", data: "192.168.7.20" },
    { type: "A", name: "newer.local", data: "192.168.7.20" },
    { type: "A", name: "newer.local", data: "127.0.0.1" },
    { type: "A", name: "newer.local", data: "192.168.7.99", ttl: 0 },
  ]);
  expect(records.resolve(hosts)).toEqual([]);
  expect([...hosts].sort()).toEqual(["192.168.7.10", "192.168.7.20"]);
});

it("coalesces scans, deduplicates device IDs and drops unreachable rooms on rescan", async () => {
  const addresses = ["192.168.7.10", "192.168.7.11", "192.168.7.20"];
  vi.mocked(discoverIPs).mockResolvedValue(addresses);
  const offline = new Set<string>();
  vi.stubGlobal("fetch", async (url: string) => {
    const host = new URL(url).hostname;
    if (offline.has(host)) throw Error("unreachable");
    const legacy = host !== addresses[2];
    const room = legacy ? "Studio" : "Kitchen";
    return new Response(
      `<root><device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><UDN>uuid:RINCON_${room}</UDN><roomName>${room}</roomName><swGen>${legacy ? 1 : 2}</swGen></device></root>`,
    );
  });
  const adapter = new LocalSonos();
  const [first, concurrent] = await Promise.all([
    adapter.discover(),
    adapter.discover(),
  ]);
  expect(first).toEqual(concurrent);
  expect(discoverIPs).toHaveBeenCalledTimes(1);
  expect(first.map((room) => [room.name, room.system])).toEqual([
    ["Kitchen", "S2"],
    ["Studio", "S1"],
  ]);
  offline.add(addresses[2]);
  expect((await adapter.discover()).map((room) => room.name)).toEqual([
    "Studio",
  ]);
  expect(vi.mocked(discoverIPs).mock.calls[1][0]).toContain(addresses[2]);
});
