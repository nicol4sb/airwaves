import { useEffect, useState } from "react";
import type { Episode } from "../shared/types";
import { get, put, request } from "./storage";

function transcriptText(raw: string, type: string): string {
  if (type === "text/plain") return raw.trim();
  if (type === "text/html") {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    doc.querySelectorAll("script, style, nav, header, footer").forEach(node => node.remove());
    return (doc.querySelector("article") ?? doc.body).textContent?.trim() ?? "";
  }
  if (type === "application/json") {
    const segments: { speaker?: string; body?: string }[] = JSON.parse(raw).segments ?? [];
    let previous: string | undefined;
    return segments.map(({ speaker, body }) => {
      const label = speaker && speaker !== previous ? "\n\n" + speaker + ": " : "";
      previous = speaker;
      return label + (typeof body === "string" ? body.trim() + " " : "");
    }).join("").trim();
  }
  return raw.replace(/^\uFEFF/, "").replace(/^WEBVTT[^\n]*\s*/, "").split(/\r?\n\s*\r?\n/).flatMap(cue => {
    const lines = cue.split(/\r?\n/);
    const timestamp = lines.findIndex(line => line.includes(" --> "));
    return timestamp < 0 ? [] : [lines.slice(timestamp + 1).join(" ")
      .replace(/<v ([^>]+)>/g, "$1: ").replace(/<[^>]+>/g, "")];
  }).join("\n\n").trim();
}

export default function EpisodeDetails({ episode }: { episode: Episode }) {
  const [result, setResult] = useState("");
  const source = episode.transcript;
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    const key = "transcript:" + episode.id;
    const show = (text: string) => { if (!controller.signal.aborted) setResult(text); };
    void (async () => {
      const stored = await get<{ url: string; text: string }>(key);
      if (stored?.url === source.url) return show(stored.text);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
      let text: string;
      try {
        ({ text } = await request<{ text: string }>("transcript/" + episode.id, "GET", undefined, signal));
      } catch (error) {
        if (controller.signal.aborted) throw error;
        const response = await fetch(source.url, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw error;
        text = await response.text();
      }
      const formatted = transcriptText(text, source.type);
      if (!formatted) throw Error("Empty transcript");
      show(formatted);
      await put(key, { url: source.url, text: formatted });
    })().catch(() => show("The transcript couldn’t be loaded. Try again when the server is reachable."));
    return () => controller.abort();
  }, [episode.id, source?.url, source?.type]);

  return (
    <div className="episode-details">
      {episode.description && <p>{episode.description}</p>}
      <h3>Transcript</h3>
      {source ? <div className="transcript">{result || "Loading transcript…"}</div>
        : <p>No transcript was provided in this episode’s feed.</p>}
    </div>
  );
}
