import { XMLParser, XMLValidator } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { externalURL } from "./network";
export const DEFAULT_FEED = "https://feeds.simplecast.com/BqbsxVfO";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  isArray: (name) => name === "item",
});
const transcriptTypes = ["text/plain", "text/vtt", "application/x-subrip", "application/json", "text/html"];
const str = (v: unknown): string =>
  typeof v === "string"
    ? v
    : typeof v === "object" && v !== null
      ? str((v as Record<string, unknown>)["#text"])
      : "";
function url(s: string, base: string) {
  try {
    return s ? externalURL(s, base).href : "";
  } catch {
    return "";
  }
}
function artwork(s: string, base: string) {
  const path = "/art/" + hash(s).slice(0, 16) + ".jpg";
  return existsSync("client/public" + path) || existsSync("dist" + path)
    ? path
    : url(s, base);
}
export function parseFeed(xml: string, feed: string) {
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw Error("Invalid RSS XML");
  const channel = parser.parse(xml).rss?.channel;
  if (!channel || !str(channel.title))
    throw Error("An RSS podcast channel is required");
  const id = hash(feed);
  const art = artwork(
    channel.image?.url || channel["itunes:image"]?.["@_href"] || "",
    feed,
  );
  const podcast = { id, url: feed, title: str(channel.title), art, error: "" };
  const episodes = (channel.item ?? []).flatMap((item: any) => {
    const enc = [item.enclosure]
      .flat()
      .find(
        (e) =>
          e?.["@_url"] &&
          (!e["@_type"] || String(e["@_type"]).startsWith("audio/")),
      );
    const audio = url(enc?.["@_url"], feed);
    if (!audio) return [];
    const transcripts = [item["podcast:transcript"]].flat().flatMap((entry) => {
      const link = url(entry?.["@_url"], feed);
      const type = String(entry?.["@_type"] ?? "").split(";")[0].toLowerCase();
      return link && transcriptTypes.includes(type) ? [{ url: link, type }] : [];
    });
    const time = str(item["itunes:duration"])
      .split(":")
      .reduce((t, v) => t * 60 + Number(v), 0);
    return [
      {
        id: hash(id + "\n" + (str(item.guid) || audio)),
        podcastId: id,
        title: str(item.title) || "Untitled episode",
        audio,
        transcript: transcripts.find((entry) => entry.type !== "text/html") ?? transcripts[0] ?? null,
        art:
          artwork(
            item["media:thumbnail"]?.["@_url"] ||
              item["itunes:image"]?.["@_href"] ||
              "",
            feed,
          ) || art,
        description: str(item.description)
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
        date: Date.parse(str(item.pubDate)) || 0,
        duration: Number.isFinite(time) ? time : 0,
      },
    ];
  });
  return { podcast, episodes };
}
