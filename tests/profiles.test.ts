import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database, ingest, library, progress } from "../server/db";
import { openProfile } from "../server/profile";
import { MockSonos } from "../sonos/adapter";

it("reopens Nic’s library and keeps subscriptions and progress separate for the same feed", () => {
  const root = mkdtempSync(join(tmpdir(), "airwave-profiles-"));
  const emmaDir = join(root, "profiles", "emma");
  const sonos = new MockSonos();
  const xml = '<rss><channel><title>A show</title><item><title>Episode</title><enclosure url="https://example.org/episode.mp3"/></item></channel></rss>';
  const url = "https://example.org/feed";
  try {
    const existing = database(join(root, "library.sqlite"));
    existing.prepare("INSERT INTO settings VALUES('seed','1')").run();
    const show = ingest(existing, xml, url);
    const episode = library(existing).episodes[0].id;
    progress(existing, episode, 12, false, 1);
    existing.close();

    const nic = openProfile(root, join(root, "audio"), true, sonos);
    const emma = openProfile(emmaDir, join(emmaDir, "audio"), false, sonos);
    try {
      expect(library(nic.db).episodes[0].position).toBe(12);
      expect(library(emma.db).podcasts).toEqual([]);
      ingest(emma.db, xml, url);
      progress(emma.db, episode, 30, true, 2);
      expect(library(emma.db).episodes[0].played).toBe(1);
      expect(library(nic.db).episodes[0].played).toBe(0);
      emma.db.prepare("DELETE FROM podcasts WHERE id=?").run(show);
      expect(library(nic.db).podcasts[0].id).toBe(show);
    } finally {
      nic.db.close();
      emma.db.close();
    }
    const reopened = openProfile(emmaDir, join(emmaDir, "audio"), false, sonos);
    try {
      expect(library(reopened.db).podcasts).toEqual([]);
    } finally {
      reopened.db.close();
    }
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
