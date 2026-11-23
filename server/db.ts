import { DatabaseSync } from "node:sqlite";
import { parseFeed } from "./rss";
import type { Episode, Podcast, Library, StarChange } from "../shared/types";
export function database(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS podcasts(id TEXT PRIMARY KEY,url TEXT UNIQUE,title TEXT,art TEXT,error TEXT DEFAULT '');
 CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY,podcastId TEXT REFERENCES podcasts ON DELETE CASCADE,title TEXT,audio TEXT,art TEXT,description TEXT,date INTEGER,duration REAL,position REAL DEFAULT 0, played INTEGER DEFAULT 0,updated INTEGER DEFAULT 0,cached TEXT DEFAULT 'none',stored INTEGER DEFAULT 0,mime TEXT DEFAULT 'audio/mpeg');
 CREATE INDEX IF NOT EXISTS dates ON episodes(date DESC);
 CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY REFERENCES episodes ON DELETE CASCADE,rank INTEGER);
 CREATE TABLE IF NOT EXISTS stars(id TEXT PRIMARY KEY,updated INTEGER NOT NULL,episode TEXT);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);`);
  if (!db.prepare("PRAGMA table_info(podcasts)").all().some((column) => column.name === "importPending"))
    db.exec("ALTER TABLE podcasts ADD COLUMN importPending INTEGER NOT NULL DEFAULT 0");
  if (!db.prepare("PRAGMA table_info(episodes)").all().some((column) => column.name === "transcript"))
    db.exec("ALTER TABLE episodes ADD COLUMN transcript TEXT");
  if (!db.prepare("PRAGMA table_info(episodes)").all().some((column) => column.name === "listenedAt"))
    transaction(db, () => {
      db.exec("ALTER TABLE episodes ADD COLUMN listenedAt INTEGER NOT NULL DEFAULT 0");
      db.exec("UPDATE episodes SET listenedAt=updated WHERE position>0");
    });
  return db;
}
export type DB = ReturnType<typeof database>;
export function transaction(db: DB, fn: () => void) {
  db.exec("BEGIN IMMEDIATE");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function ingest(db: DB, xml: string, url: string) {
  const { podcast: p, episodes } = parseFeed(xml, url);
  transaction(db, () => {
    db.prepare(
      "INSERT INTO podcasts(id,url,title,art) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,art=excluded.art,error='',importPending=0",
    ).run(p.id, p.url, p.title, p.art);
    const old = db
      .prepare("SELECT MAX(date) AS newest FROM episodes WHERE podcastId=?")
      .get(p.id);
    const latest = new Set(
      episodes
        .slice()
        .sort((a: any, b: any) => b.date - a.date)
        .slice(0, Number(process.env.INITIAL_DOWNLOADS ?? 1))
        .map((e: any) => e.id),
    );
    const insert = db.prepare(
      `INSERT INTO episodes(id,podcastId,title,audio,art,description,date,duration,transcript,cached) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,audio=excluded.audio,art=excluded.art,description=excluded.description,date=excluded.date,duration=excluded.duration,transcript=excluded.transcript`,
    );
    for (const e of episodes)
      insert.run(
        e.id,
        p.id,
        e.title,
        e.audio,
        e.art,
        e.description,
        e.date,
        e.duration,
        e.transcript && JSON.stringify(e.transcript),
        (old?.newest != null ? e.date > Number(old.newest) : latest.has(e.id))
          ? "pending"
          : "none",
      );
  });
  return p.id;
}
export function library(db: DB): Library {
  return {
    podcasts: db
      .prepare("SELECT * FROM podcasts ORDER BY title")
      .all() as unknown as Podcast[],
    episodes: db
      .prepare("SELECT * FROM episodes ORDER BY date DESC")
      .all().map(({ transcript, ...row }) => ({
        ...row,
        transcript: transcript ? JSON.parse(String(transcript)) : null,
      })) as Episode[],
    queue: db
      .prepare("SELECT id FROM queue ORDER BY rank")
      .all()
      .map((r) => String(r.id)),
  };
}
export function progress(
  db: DB,
  id: string,
  position: number,
  played: boolean,
  updated: number,
  listenedAt = position > 0 ? updated : 0,
) {
  db.prepare(`UPDATE episodes SET
    position=CASE WHEN updated<=? THEN ? ELSE position END,
    played=CASE WHEN updated<=? THEN ? ELSE played END,
    updated=MAX(updated,?),listenedAt=MAX(listenedAt,?) WHERE id=?`
  ).run(updated, position, updated, +played, updated, listenedAt, id);
  db.prepare(`UPDATE stars SET episode=json_set(episode,
    '$.position', CASE WHEN json_extract(episode,'$.updated')<=? THEN ? ELSE json_extract(episode,'$.position') END,
    '$.played', CASE WHEN json_extract(episode,'$.updated')<=? THEN ? ELSE json_extract(episode,'$.played') END,
    '$.updated', MAX(json_extract(episode,'$.updated'),?),
    '$.listenedAt', MAX(COALESCE(json_extract(episode,'$.listenedAt'),0),?))
    WHERE id=? AND episode IS NOT NULL`
  ).run(updated, position, updated, +played, updated, listenedAt, id);
}
function readStar(row: Record<string, unknown>): StarChange {
  return { id: String(row.id), updated: Number(row.updated), episode: row.episode ? JSON.parse(String(row.episode)) : null };
}
export function stars(db: DB): StarChange[] {
  return db.prepare("SELECT id,updated,episode FROM stars").all().map(readStar);
}
export function setStar(db: DB, change: StarChange): StarChange {
  db.prepare(`INSERT INTO stars VALUES(?,?,?) ON CONFLICT(id) DO UPDATE
    SET updated=excluded.updated,episode=excluded.episode WHERE stars.updated<excluded.updated`
  ).run(change.id, change.updated, change.episode ? JSON.stringify(change.episode) : null);
  return readStar(db.prepare("SELECT id,updated,episode FROM stars WHERE id=?").get(change.id)!);
}
