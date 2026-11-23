import express from "express";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { database, ingest, library, progress, setStar, stars, transaction } from "./db";
import { DEFAULT_FEED, hash } from "./rss";
import { externalURL, fetchXML, openExternal, publicHost } from "./network";
import { pipeline } from "node:stream/promises";
import { radioById } from "../shared/radio";
import { AudioCache } from "./cache";
import type { SonosAdapter } from "../sonos/adapter";
import type { Episode } from "../shared/types";

function starSnapshot(id: string, value: unknown): Episode {
  if (!value || typeof value !== "object") throw Error("Invalid starred episode");
  const e = value as Episode;
  const listenedAt = e.listenedAt ?? (e.position > 0 ? e.updated : 0);
  if (typeof e.podcastId !== "string" || !e.podcastId || e.podcastId.length > 128 ||
    typeof e.title !== "string" || typeof e.audio !== "string" ||
    !Number.isFinite(e.date) || !Number.isFinite(e.duration) ||
    !Number.isFinite(e.position) || e.position < 0 || (e.played !== 0 && e.played !== 1) ||
    !Number.isSafeInteger(e.updated) || e.updated < 0 ||
    !Number.isSafeInteger(listenedAt) || listenedAt < 0) throw Error("Invalid starred episode");
  const art = typeof e.art === "string" && e.art
    ? /^\/art\/[a-f\d]{16}\.jpg$/.test(e.art) ? e.art : externalURL(e.art).href
    : "";
  const transcript = typeof e.transcript?.url === "string" && typeof e.transcript.type === "string"
    ? { url: externalURL(e.transcript.url).href, type: e.transcript.type.slice(0, 100) }
    : null;
  return {
    id, podcastId: e.podcastId, podcastTitle: typeof e.podcastTitle === "string" ? e.podcastTitle.slice(0, 300) : undefined,
    title: e.title.slice(0, 500), art, transcript, audio: externalURL(e.audio).href,
    description: typeof e.description === "string" ? e.description.slice(0, 4000) : "",
    date: e.date, duration: e.duration, position: e.position, played: e.played, updated: e.updated,
    listenedAt, cached: "none",
  };
}

export function openProfile(dir: string, audioDir: string, seedStarter: boolean, sonos: SonosAdapter) {
  mkdirSync(dir, { recursive: true });
  const db = database(join(dir, "library.sqlite"));
  if (seedStarter && !db.prepare("SELECT 1 FROM settings WHERE key='seed'").get()) {
    ingest(db, readFileSync("server/starter.xml", "utf8"), DEFAULT_FEED);
    db.prepare("INSERT INTO settings VALUES('seed','1')").run();
  }
  const cache = new AudioCache(db, audioDir);
  const router = express.Router();
  router.get("/library", (_q, r) => r.json({ ...library(db), stars: stars(db) }));
  router.put("/stars/:id", (q, r) => {
    const { id } = q.params;
    const { updated, episode } = q.body ?? {};
    if (!/^[\w-]{1,128}$/.test(id) || !Number.isSafeInteger(updated) ||
      updated < 0 || updated > Date.now() + 300000) throw Error("Invalid star change");
    r.json(setStar(db, { id, updated, episode: episode === null ? null : starSnapshot(id, episode) }));
  });
  const feedImports = new Map<string, Promise<void>>();
  function importFeed(id: string, url: string) {
    const current = feedImports.get(id);
    if (current) return current;
    db.prepare("UPDATE podcasts SET error='' WHERE id=? AND importPending=1").run(id);
    const task = fetchXML(url).then((xml) => {
      if (db.prepare("SELECT 1 FROM podcasts WHERE id=?").get(id)) ingest(db, xml, url);
    }).catch((error) => {
      db.prepare("UPDATE podcasts SET error=? WHERE id=?").run(String(error), id);
    }).finally(() => feedImports.delete(id));
    feedImports.set(id, task);
    return task;
  }
  router.post("/podcasts", (q, r) => {
    const url = externalURL(q.body.url).href;
    const id = hash(url);
    const title = typeof q.body.title === "string" ? q.body.title.slice(0, 300) : "Loading podcast…";
    const art = typeof q.body.art === "string" ? q.body.art : "";
    db.prepare("INSERT INTO podcasts(id,url,title,art,importPending) VALUES(?,?,?,?,1) ON CONFLICT(id) DO NOTHING")
      .run(id, url, title, art);
    void importFeed(id, url).then(drain).catch((error) => console.warn("Audio download:", error));
    r.json({ id, podcast: db.prepare("SELECT * FROM podcasts WHERE id=?").get(id) });
  });
  router.delete("/podcasts/:id", (q, r) => {
    for (const e of db
      .prepare("SELECT id FROM episodes WHERE podcastId=?")
      .all(q.params.id))
      cache.remove(String(e.id));
    db.prepare("DELETE FROM podcasts WHERE id=?").run(q.params.id);
    r.json({ ok: true });
  });
  router.put("/progress/:id", (q, r) => {
    const { position, played, updated, listenedAt } = q.body;
    if (
      !Number.isFinite(position) ||
      position < 0 ||
      typeof played !== "boolean" ||
      !Number.isSafeInteger(updated) ||
      updated > Date.now() + 300000 ||
      (listenedAt !== undefined && (!Number.isSafeInteger(listenedAt) || listenedAt < 0 || listenedAt > updated))
    )
      throw Error("Invalid playback progress");
    progress(db, q.params.id, position, played, updated, listenedAt);
    r.json({ ok: true });
  });
  router.put("/queue", (q, r) => {
    const ids = q.body.ids;
    if (
      !Array.isArray(ids) ||
      ids.length > 500 ||
      ids.some((id) => typeof id !== "string") ||
      new Set(ids).size !== ids.length
    )
      throw Error("Invalid queue");
    transaction(db, () => {
      db.exec("DELETE FROM queue");
      ids.forEach((id, i) =>
        db
          .prepare("INSERT INTO queue SELECT id,? FROM episodes WHERE id=?")
          .run(i, id),
      );
    });
    r.json({ ok: true });
  });
  router.get("/transcript/:id", async (q, r) => {
    const row = db.prepare("SELECT transcript FROM episodes WHERE id=?").get(q.params.id);
    if (!row?.transcript) return r.status(404).json({ error: "No publisher transcript" });
    const { url } = JSON.parse(String(row.transcript));
    r.json({ text: await fetchXML(url, 3 * 1024 ** 2) });
  });
  router.get("/download/:id", async (q, r) => {
    const id = q.params.id;
    const row = db.prepare("SELECT audio,cached,mime FROM episodes WHERE id=?").get(id);
    const source = row ?? db.prepare(`SELECT json_extract(episode, '$.audio') AS audio
      FROM stars WHERE id=? AND episode IS NOT NULL`).get(id);
    if (!source?.audio) return r.status(404).json({ error: "Episode unavailable" });
    if (row?.cached === "ready" && existsSync(cache.path(id))) {
      r.type(String(row.mime)).sendFile(cache.path(id), { cacheControl: false });
      return;
    }
    // Interactive downloads stream immediately, independently of the Pi’s cache worker.
    const upstream = await openExternal(String(source.audio), 600_000);
    if (r.destroyed) { upstream.destroy(); return; }
    r.type(String(upstream.headers["content-type"] ?? "audio/mpeg"));
    if (upstream.headers["content-length"]) r.set("Content-Length", upstream.headers["content-length"]);
    await pipeline(upstream, r);
  });
  router.get("/audio/:id", async (q, r) => {
    const id = q.params.id;
    await cache.ensure(id);
    const mime = String(
      db.prepare("SELECT mime FROM episodes WHERE id=?").get(id)?.mime,
    );
    r.type(mime.startsWith("audio/") ? mime : "audio/mpeg").sendFile(
      cache.path(id),
      { cacheControl: false },
    );
  });
  router.post("/speakers/:id", async (q, r) => {
    const { action, value = 0, ids, stationId } = q.body;
    if (!Number.isFinite(value) || value < 0)
      throw Error("Invalid position or volume");
    if (action === "radio" && typeof stationId === "string") {
      const station = await radioById(stationId);
      await publicHost(externalURL(station.url));
      await sonos.playRadio(q.params.id, station.url, station.name);
    } else if (action === "start") {
      if (!Array.isArray(ids) || !ids.length || ids.length > 500)
        throw Error("Invalid tracks");
      const tracks = ids.map((id) => {
        const row = db.prepare("SELECT audio FROM episodes WHERE id=?").get(id);
        if (!row) throw Error("Unknown episode");
        return String(row.audio);
      });
      await sonos.start(q.params.id, tracks, value);
    } else if (
      ["pause", "resume", "seek", "volume"].includes(action) &&
      !(action === "volume" && value > 100)
    )
      await sonos.control(q.params.id, action, value);
    else throw Error("Invalid command");
    r.json({ ok: true });
  });
  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (const row of db
        .prepare(
          "SELECT id FROM episodes WHERE cached='pending' ORDER BY date DESC",
        )
        .all()) {
        try {
          await cache.ensure(String(row.id));
        } catch (e) {
          console.warn("Audio download:", String(e));
        }
      }
    } finally {
      draining = false;
    }
  }
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      for (const p of db.prepare("SELECT id,url FROM podcasts ORDER BY importPending DESC").all())
        await importFeed(String(p.id), String(p.url));
      db.exec("UPDATE episodes SET cached='pending' WHERE cached='failed'");
      cache.prune();
      await drain();
    } finally {
      refreshing = false;
    }
  }
  return { router, refresh, db };
}
