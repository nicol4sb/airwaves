import dgram from "node:dgram";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import multicastDNS from "multicast-dns";
import type { Answer, Question } from "dns-packet";
import ipaddr from "ipaddr.js";

export const lan = (ip: string) =>
  isIPv4(ip) && ["private", "linkLocal"].includes(ipaddr.parse(ip).range());

const service = "_sonos._tcp.local";
const dnsName = (name: string) => name.toLowerCase().replace(/\.$/, "");

export class SonosRecords {
  private instances = new Set<string>();
  private targets = new Map<string, string>();
  private addresses = new Map<string, Set<string>>();

  receive(records: Answer[]) {
    for (const record of records) {
      if ("ttl" in record && record.ttl === 0) continue;
      const name = dnsName(record.name);
      if (record.type === "PTR" && name === service)
        this.instances.add(dnsName(record.data));
      if (record.type === "SRV" && name.endsWith("." + service))
        this.targets.set(name, dnsName(record.data.target));
      if (record.type === "A" && lan(record.data)) {
        const values = this.addresses.get(name) ?? new Set<string>();
        values.add(record.data);
        this.addresses.set(name, values);
      }
    }
  }

  resolve(hosts: Set<string>): Question[] {
    const questions: Question[] = [];
    for (const instance of this.instances) {
      const target = this.targets.get(instance);
      if (!target) {
        questions.push({ name: instance, type: "SRV" });
        continue;
      }
      const addresses = this.addresses.get(target);
      if (!addresses) questions.push({ name: target, type: "A" });
      else for (const address of addresses) hosts.add(address);
    }
    return questions;
  }
}

async function browseBonjour(address: string, hosts: Set<string>) {
  const dns = multicastDNS({ interface: address, bind: "0.0.0.0" });
  const records = new SonosRecords();
  const requested = new Set<string>();
  dns.on("error", (err) => console.warn("Sonos Bonjour:", err.message));
  function resolve() {
    const pending = records.resolve(hosts).filter(({ name, type }) => {
      const key = type + ":" + name;
      if (requested.has(key)) return false;
      requested.add(key);
      return true;
    });
    if (pending.length) dns.query(pending);
  }
  dns.on("response", (packet) => {
    records.receive([...packet.answers, ...packet.additionals]);
    resolve();
  });
  try {
    dns.query(service, "PTR");
    await delay(1000);
    requested.clear();
    dns.query(service, "PTR");
    resolve();
    await delay(2200);
  } finally {
    dns.destroy();
  }
}

async function browseSSDP(address: string, hosts: Set<string>) {
  const socket = dgram.createSocket("udp4");
  socket.on("error", (err) => console.warn("Sonos SSDP:", err.message));
  socket.on("message", (msg, peer) => {
    if (lan(peer.address) && /zoneplayer|rincon/i.test(msg.toString()))
      hosts.add(peer.address);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, address, () => {
        socket.off("error", reject);
        resolve();
      });
    });
    socket.setMulticastInterface(address);
    const message = [
      "M-SEARCH * HTTP/1.1",
      "HOST: 239.255.255.250:1900",
      'MAN: "ssdp:discover"',
      "MX: 2",
      "ST: urn:schemas-upnp-org:device:ZonePlayer:1",
      "",
      "",
    ].join("\r\n");
    socket.send(message, 1900, "239.255.255.250");
    await delay(1000);
    socket.send(message, 1900, "239.255.255.250");
    await delay(2200);
  } finally {
    socket.close();
  }
}

export async function discoverIPs(previous: string[]) {
  const hosts = new Set(
    [...previous, ...(process.env.SONOS_HOSTS ?? "").split(",")]
      .map((s) => s.trim())
      .filter(lan),
  );
  const interfaces = Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && !net.internal && lan(net.address));
  const scans = interfaces.flatMap((net) => [
    browseSSDP(net!.address, hosts),
    browseBonjour(net!.address, hosts),
  ]);
  for (const result of await Promise.allSettled(scans))
    if (result.status === "rejected")
      console.warn("Sonos discovery:", result.reason);
  return [...hosts];
}
