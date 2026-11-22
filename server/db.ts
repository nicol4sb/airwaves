import { DatabaseSync } from "node:sqlite";
import { parseFeed } from "./rss";
import type { Episode, Podcast, Library } from "../shared/types";
export function database(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS podcasts(id TEXT PRIMARY KEY,url TEXT UNIQUE,title TEXT,art TEXT,error TEXT DEFAULT '');
 CREATE TABLE IF NOT EXISTS episodes(id TEXT PRIMARY KEY,podcastId TEXT REFERENCES podcasts ON DELETE CASCADE,title TEXT,audio TEXT,art TEXT,description TEXT,date INTEGER,duration REAL,position REAL DEFAULT 0, played INTEGER DEFAULT 0,updated INTEGER DEFAULT 0,cached TEXT DEFAULT 'none',stored INTEGER DEFAULT 0,mime TEXT DEFAULT 'audio/mpeg');
 CREATE INDEX IF NOT EXISTS dates ON episodes(date DESC);
 CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY REFERENCES episodes ON DELETE CASCADE,rank INTEGER);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);`);
  if (!db.prepare("PRAGMA table_info(podcasts)").all().some((column) => column.name === "importPending"))
    db.exec("ALTER TABLE podcasts ADD COLUMN importPending INTEGER NOT NULL DEFAULT 0");
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
      `INSERT INTO episodes(id,podcastId,title,audio,art,description,date,duration,cached) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,audio=excluded.audio,art=excluded.art,description=excluded.description,date=excluded.date,duration=excluded.duration`,
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
      .all() as unknown as Episode[],
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
) {
  db.prepare(
    "UPDATE episodes SET position=?,played=?,updated=? WHERE id=? AND updated<=?",
  ).run(position, +played, updated, id, updated);
}
