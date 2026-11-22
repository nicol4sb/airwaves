import { discoverIPs, lan } from "./discovery";
import { XMLParser } from "fast-xml-parser";
import type { Speaker, Status } from "../shared/types";
export interface SonosAdapter {
  discover(): Promise<Speaker[]>;
  start(id: string, tracks: string[], position: number): Promise<void>;
  control(
    id: string,
    action: "resume" | "pause" | "seek" | "volume",
    value: number,
  ): Promise<void>;
  status(id: string): Promise<Status>;
}
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
});
const services = {
  AVTransport: ["MediaRenderer", "AVTransport"],
  RenderingControl: ["MediaRenderer", "RenderingControl"],
  ZoneGroupTopology: ["", "ZoneGroupTopology"],
} as const;
type Service = keyof typeof services;
export const escapeXML = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function envelope(
  service: Service,
  action: string,
  args: Record<string, string | number>,
) {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">${Object.entries(
    args,
  )
    .map(([k, v]) => `<${k}>${escapeXML(String(v))}</${k}>`)
    .join("")}</u:${action}></s:Body></s:Envelope>`;
}
async function soap(
  host: string,
  s: Service,
  a: string,
  args: Record<string, string | number> = {},
) {
  const path = [...services[s], "Control"].filter(Boolean).join("/");
  const res = await fetch("http://" + host + ":1400/" + path, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(6000),
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"urn:schemas-upnp-org:service:' + s + ":1#" + a + '"',
    },
    body: envelope(s, a, args),
  });
  const body = parser.parse(await res.text()).Envelope?.Body;
  if (!res.ok || body?.Fault)
    throw Error(
      "Sonos " +
        a +
        " failed (" +
        (body?.Fault?.detail?.UPnPError?.errorCode ?? res.status) +
        ")",
    );
  return body?.[a + "Response"] ?? {};
}
const list = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
async function groups(host: string) {
  const result = await soap(host, "ZoneGroupTopology", "GetZoneGroupState");
  const state = parser.parse(result.ZoneGroupState);
  return list((state.ZoneGroupState?.ZoneGroups ?? state.ZoneGroups).ZoneGroup);
}
export const clock = (n: number) =>
  [Math.floor(n / 3600), Math.floor(n / 60) % 60, Math.floor(n) % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
export class LocalSonos implements SonosAdapter {
  private devices = new Map<
    string,
    { host: string; name: string; system: string }
  >();
  private scanning?: Promise<Speaker[]>;
  private scannedAt = 0;

  discover() {
    const age = Date.now() - this.scannedAt;
    if (age < 30_000 && this.scannedAt) {
      if (!this.scanning)
        this.scanning = this.scan().finally(() => {
          this.scanning = undefined;
        });
      return Promise.resolve(this.list());
    }
    if (this.scanning) return this.scanning;
    return (this.scanning = this.scan().finally(() => {
      this.scanning = undefined;
    }));
  }

  private list() {
    return [...this.devices]
      .map(([id, { name, system }]) => ({ id, name, system }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  private async scan() {
    const previous = [...this.devices.values()].map((device) => device.host);
    const found = new Map<
      string,
      { host: string; name: string; system: string }
    >();
    await Promise.allSettled(
      (await discoverIPs(previous)).map(async (host) => {
        const res = await fetch(
          "http://" + host + ":1400/xml/device_description.xml",
          { signal: AbortSignal.timeout(3500), redirect: "error" },
        );
        if (!res.ok) return;
        const d = parser.parse(await res.text()).root?.device;
        if (d?.deviceType !== "urn:schemas-upnp-org:device:ZonePlayer:1")
          return;
        const id = String(d.UDN).replace(/^uuid:/, "");
        if (!id.startsWith("RINCON_")) return;
        found.set(id, {
          host,
          name: d.roomName || d.friendlyName || host,
          system:
            d.swGen === "2"
              ? "S2"
              : d.swGen === "1" || d.displayVersion?.startsWith("11.")
                ? "S1"
                : d.modelName || "Sonos",
        });
      }),
    );
    this.devices = found;
    this.scannedAt = Date.now();
    return this.list();
  }
  private async target(id: string) {
    if (!this.devices.has(id)) await this.discover();
    const member = this.devices.get(id);
    if (!member) throw Error("Speaker unavailable. Scan again.");
    const group = (await groups(member.host)).find((g) =>
      list(g.ZoneGroupMember).some((m) => m["@_UUID"] === id),
    );
    if (!group) throw Error("Sonos group unavailable");
    const coordinator = list(group.ZoneGroupMember).find(
      (m) => m["@_UUID"] === group["@_Coordinator"],
    );
    const host = new URL(coordinator["@_Location"]).hostname;
    if (!lan(host)) throw Error("Invalid coordinator address");
    return { member: member.host, host, id: group["@_Coordinator"] };
  }
  async start(id: string, tracks: string[], position: number) {
    const t = await this.target(id);
    const cmd = (a: string, args: Record<string, string | number>) =>
      soap(t.host, "AVTransport", a, { InstanceID: 0, ...args });
    let first = 0;
    try {
      for (const url of tracks) {
        const added = await cmd("AddURIToQueue", {
          EnqueuedURI: url,
          EnqueuedURIMetaData: "",
          DesiredFirstTrackNumberEnqueued: 0,
          EnqueueAsNext: 0,
        });
        if (!first) first = Number(added.FirstTrackNumberEnqueued);
      }
    } catch (error) {
      if (
        first ||
        !(error instanceof Error) ||
        !error.message.includes("(401)")
      )
        throw error;
      await cmd("SetAVTransportURI", {
        CurrentURI: tracks[0],
        CurrentURIMetaData: "",
      });
      await cmd("Play", { Speed: 1 });
      if (position >= 1)
        await cmd("Seek", { Unit: "REL_TIME", Target: clock(position) });
      return;
    }
    await cmd("SetAVTransportURI", {
      CurrentURI: "x-rincon-queue:" + t.id + "#0",
      CurrentURIMetaData: "",
    });
    await cmd("SetPlayMode", { NewPlayMode: "NORMAL" });
    await cmd("Seek", { Unit: "TRACK_NR", Target: first });
    await cmd("Play", { Speed: 1 });
    if (position >= 1)
      await cmd("Seek", { Unit: "REL_TIME", Target: clock(position) });
  }
  async control(
    id: string,
    action: "resume" | "pause" | "seek" | "volume",
    value: number,
  ) {
    const t = await this.target(id);
    if (action === "volume")
      await soap(t.member, "RenderingControl", "SetVolume", {
        InstanceID: 0,
        Channel: "Master",
        DesiredVolume: Math.round(value),
      });
    else if (action === "seek")
      await soap(t.host, "AVTransport", "Seek", {
        InstanceID: 0,
        Unit: "REL_TIME",
        Target: clock(value),
      });
    else
      await soap(
        t.host,
        "AVTransport",
        action === "resume" ? "Play" : "Pause",
        action === "resume" ? { InstanceID: 0, Speed: 1 } : { InstanceID: 0 },
      );
  }
  async status(id: string) {
    const t = await this.target(id);
    const [p, s, v] = await Promise.all([
      soap(t.host, "AVTransport", "GetPositionInfo", { InstanceID: 0 }),
      soap(t.host, "AVTransport", "GetTransportInfo", { InstanceID: 0 }),
      soap(t.member, "RenderingControl", "GetVolume", {
        InstanceID: 0,
        Channel: "Master",
      }),
    ]);
    return {
      audio: String(p.TrackURI),
      position:
        String(p.RelTime)
          .split(":")
          .reduce((a, b) => a * 60 + Number(b), 0) || 0,
      playing: s.CurrentTransportState === "PLAYING",
      volume: Number(v.CurrentVolume),
    };
  }
}
export class MockSonos implements SonosAdapter {
  state: Status = { audio: "", playing: false, position: 0, volume: 30 };
  async discover() {
    return [{ id: "mock", name: "Studio (mock)", system: "Mock" }];
  }
  async start(_id: string, tracks: string[], position: number) {
    Object.assign(this.state, { audio: tracks[0], position, playing: true });
  }
  async status() {
    return this.state;
  }
  async control(_id: string, a: string, v: number) {
    if (a === "volume") this.state.volume = v;
    else if (a === "seek") this.state.position = v;
    else this.state.playing = a === "resume";
  }
}
