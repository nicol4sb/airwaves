import type { RadioStation } from "./types";

export const stations: RadioStation[] = [
  ["franceinter", "France Inter", "franceinter-midfi"],
  ["franceinfo", "franceinfo", "franceinfo-midfi"],
  ["franceculture", "France Culture", "franceculture-lofi"],
  ["francemusique", "France Musique", "francemusique-midfi"],
  ["fip", "FIP", "fip-midfi"],
  ["mouv", "Mouv’", "mouv-midfi"],
].map(([id, name, stream]) => ({
  id, name, url: "https://icecast.radiofrance.fr/" + stream + ".mp3", art: "", group: "Radio France",
}));

const directory = "https://de1.api.radio-browser.info/json/stations/";

export function radioEntry(value: unknown): RadioStation | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (typeof row.stationuuid !== "string" || !/^[\da-f-]{36}$/i.test(row.stationuuid)
    || typeof row.name !== "string" || !row.name.trim()
    || typeof row.url_resolved !== "string" || row.hls === 1
    || !["MP3", "AAC", "AAC+"].includes(String(row.codec).toUpperCase())) return;
  try {
    const url = new URL(row.url_resolved);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return;
    return {
      id: row.stationuuid, name: row.name.trim(), url: url.href,
      art: typeof row.favicon === "string" && row.favicon.startsWith("https://") ? row.favicon : "",
      group: typeof row.country === "string" ? row.country : "",
    };
  } catch {
    return;
  }
}

export async function searchRadio(name: string, signal: AbortSignal) {
  const params = new URLSearchParams({ name, hidebroken: "true", is_https: "true", order: "votes", reverse: "true", limit: "60" });
  const response = await fetch(directory + "search?" + params, { signal });
  if (!response.ok) throw Error("Radio directory unavailable");
  const rows: unknown[] = await response.json();
  return rows.flatMap((row) => radioEntry(row) ?? []);
}

export async function radioById(id: string): Promise<RadioStation> {
  const builtIn = stations.find((station) => station.id === id);
  if (builtIn) return builtIn;
  if (!/^[\da-f-]{36}$/i.test(id)) throw Error("Unknown radio station");
  const response = await fetch(directory + "byuuid/" + id, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error("Radio directory unavailable");
  const rows: unknown[] = await response.json();
  const station = radioEntry(rows[0]);
  if (!station) throw Error("Radio stream unavailable");
  return station;
}
