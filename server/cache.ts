import {
  mkdirSync,
  readdirSync,
  unlinkSync,
  existsSync,
  statSync,
  renameSync,
  createWriteStream,
} from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openExternal } from "./network";
import type { DB } from "./db";
export class AudioCache {
  private active = new Map<string, Promise<void>>();
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private db: DB,
    private dir: string,
    private limit = Number(process.env.CACHE_MB ?? 2048) * 1024 ** 2,
  ) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (
        /^[a-f0-9]{64}(\.part)?$/.test(f) &&
        !db
          .prepare("SELECT 1 FROM episodes WHERE id=? AND cached='ready'")
          .get(f)
      )
        unlinkSync(join(dir, f));
    }
    for (const r of db
      .prepare("SELECT id FROM episodes WHERE cached='ready'")
      .all())
      if (!existsSync(this.path(String(r.id))))
        db.prepare("UPDATE episodes SET cached='pending' WHERE id=?").run(r.id);
    db.exec("UPDATE episodes SET cached='pending' WHERE cached='loading'");
  }
  path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("Invalid episode");
    return join(this.dir, id);
  }
  remove(id: string) {
    if (existsSync(this.path(id))) unlinkSync(this.path(id));
    this.db.prepare("UPDATE episodes SET cached='none' WHERE id=?").run(id);
  }
  prune(bytes = 0, exclude = "") {
    let used = 0;
    const rows = this.db
      .prepare(
        "SELECT id,position,played,stored FROM episodes WHERE cached='ready' ORDER BY stored",
      )
      .all();
    for (const row of rows)
      if (existsSync(this.path(String(row.id))))
        used += statSync(this.path(String(row.id))).size;
    for (const row of rows) {
      if (row.id === exclude || (Number(row.position) > 0 && !row.played))
        continue;
      if (
        used + bytes <= this.limit &&
        Number(row.stored) >
          Date.now() - Number(process.env.RETENTION_DAYS ?? 30) * 86400000
      )
        continue;
      const path = this.path(String(row.id));
      if (existsSync(path)) used -= statSync(path).size;
      this.remove(String(row.id));
    }
    if (used + bytes > this.limit) throw Error("Server audio storage is full");
  }
  ensure(id: string) {
    if (this.active.has(id)) return this.active.get(id)!;
    const task = this.tail
      .then(() => this.download(id))
      .finally(() => this.active.delete(id));
    this.tail = task.catch(() => {});
    this.active.set(id, task);
    return task;
  }
  private async download(id: string) {
    const row = this.db
      .prepare("SELECT audio,cached FROM episodes WHERE id=?")
      .get(id);
    if (!row) throw Error("Episode unavailable");
    if (row.cached === "ready" && existsSync(this.path(id))) return;
    const tmp = this.path(id) + ".part";
    this.db.prepare("UPDATE episodes SET cached='loading' WHERE id=?").run(id);
    try {
      const response = await openExternal(String(row.audio), 600000);
      let bytes = 0;
      const limit = this.limit;
      await pipeline(
        response,
        new Transform({
          transform(chunk, _enc, cb) {
            bytes += chunk.length;
            cb(
              bytes > limit ? Error("Episode exceeds cache limit") : null,
              chunk,
            );
          },
        }),
        createWriteStream(tmp),
      );
      if (!bytes || !response.complete) throw Error("Incomplete download");
      this.prune(bytes);
      if (!this.db.prepare("SELECT id FROM episodes WHERE id=?").get(id))
        throw Error("Subscription removed");
      renameSync(tmp, this.path(id));
      this.db
        .prepare(
          "UPDATE episodes SET cached='ready',stored=?,mime=? WHERE id=?",
        )
        .run(
          Date.now(),
          String(response.headers["content-type"] ?? "audio/mpeg").split(
            ";",
          )[0],
          id,
        );
    } catch (e) {
      if (existsSync(tmp)) unlinkSync(tmp);
      this.db.prepare("UPDATE episodes SET cached='failed' WHERE id=?").run(id);
      throw e;
    }
  }
}
