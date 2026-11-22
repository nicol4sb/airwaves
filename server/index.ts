import express from "express";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { database, ingest, library, transaction, progress } from "./db";
import { DEFAULT_FEED } from "./rss";
import { externalURL, fetchXML } from "./network";
import { AudioCache } from "./cache";
import { LocalSonos, MockSonos, type SonosAdapter } from "../sonos/adapter";
if (process.env.NODE_ENV !== "production" && existsSync(".env"))
  process.loadEnvFile(".env");
const dir = resolve(process.env.DATA_DIR ?? "data");
mkdirSync(dir, { recursive: true });
const db = database(join(dir, "library.sqlite"));
if (!db.prepare("SELECT 1 FROM settings WHERE key='seed'").get()) {
  ingest(db, readFileSync("server/starter.xml", "utf8"), DEFAULT_FEED);
  db.prepare("INSERT INTO settings VALUES('seed','1')").run();
}
let cache: AudioCache;
const sonos: SonosAdapter =
  process.env.SONOS_MODE === "mock" ? new MockSonos() : new LocalSonos();
const app = express();
const password = process.env.APP_PASSWORD;
const prod = process.env.NODE_ENV === "production";
const lanHost = process.env.LAN_HOST;
const digest = (s: string) => createHash("sha256").update(s).digest();
const session = randomBytes(32).toString("hex");
const cooldown = new Map<string, number[]>();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.get("/health", (_q, r) => {
  db.prepare("SELECT 1").get();
  r.json({ ok: true });
});
app.use("/api", (q, r, next) => {
  r.set("Cache-Control", "no-store");
  if (q.method !== "GET" && q.get("x-airwave") !== "1") {
    r.status(403).json({ error: "Invalid request" });
    return;
  }
  if (q.path === "/login" && q.method === "POST") {
    const ip = q.ip ?? "local";
    const attempts = (cooldown.get(ip) ?? []).filter(
      (t) => Date.now() - t < 60000,
    );
    if (attempts.length >= 10) {
      r.status(429).json({ error: "Try again in one minute" });
      return;
    }
    if (
      password &&
      !timingSafeEqual(digest(password), digest(String(q.body?.password)))
    ) {
      cooldown.set(ip, [...attempts, Date.now()]);
      r.status(401).json({ error: "Incorrect password" });
      return;
    }
    r.cookie("airwave", session, {
      httpOnly: true,
      secure: prod,
      sameSite: "strict",
      maxAge: 30 * 86400000,
      path: "/api",
    }).json({ ok: true });
    return;
  }
  if (
    password &&
    !q.headers.cookie?.split(";").some((c) => c.trim() === "airwave=" + session)
  ) {
    r.status(401).json({ error: "Sign in to your library" });
    return;
  }
  next();
});
app.get("/api/library", (_q, r) => r.json(library(db)));
app.post("/api/podcasts", async (q, r) => {
  const url = externalURL(q.body.url).href;
  const id = ingest(db, await fetchXML(url), url);
  r.json({ id });
  void drain();
});
app.delete("/api/podcasts/:id", (q, r) => {
  for (const e of db
    .prepare("SELECT id FROM episodes WHERE podcastId=?")
    .all(q.params.id))
    cache.remove(String(e.id));
  db.prepare("DELETE FROM podcasts WHERE id=?").run(q.params.id);
  r.json({ ok: true });
});
app.put("/api/progress/:id", (q, r) => {
  const { position, played, updated } = q.body;
  if (
    !Number.isFinite(position) ||
    position < 0 ||
    typeof played !== "boolean" ||
    !Number.isSafeInteger(updated) ||
    updated > Date.now() + 300000
  )
    throw Error("Invalid playback progress");
  progress(db, q.params.id, position, played, updated);
  r.json({ ok: true });
});
app.put("/api/queue", (q, r) => {
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
app.get("/api/audio/:id", async (q, r) => {
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
app.get("/api/speakers", async (_q, r) => r.json(await sonos.discover()));
app.get("/api/speakers/:id", async (q, r) =>
  r.json(await sonos.status(q.params.id)),
);
app.post("/api/speakers/:id", async (q, r) => {
  const { action, value = 0, ids } = q.body;
  if (!Number.isFinite(value) || value < 0)
    throw Error("Invalid position or volume");
  if (action === "start") {
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
if (existsSync("dist/index.html")) app.use(express.static("dist"));
app.use(
  (
    error: Error,
    _q: express.Request,
    r: express.Response,
    next: express.NextFunction,
  ) => {
    if (r.headersSent) {
      next(error);
      return;
    }
    r.status(400).json({ error: error.message });
  },
);
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
    for (const p of db.prepare("SELECT id,url FROM podcasts").all()) {
      try {
        const xml = await fetchXML(String(p.url));
        if (db.prepare("SELECT 1 FROM podcasts WHERE id=?").get(p.id))
          ingest(db, xml, String(p.url));
      } catch (e) {
        db.prepare("UPDATE podcasts SET error=? WHERE id=?").run(
          String(e),
          p.id,
        );
      }
    }
    db.exec("UPDATE episodes SET cached='pending' WHERE cached='failed'");
    cache.prune();
    await drain();
  } finally {
    refreshing = false;
  }
}
const tick = () => {
  void refresh().catch((e) => console.warn("Refresh:", String(e)));
};
const port = Number(process.env.PORT ?? 4173);
const hosts = [...new Set(["127.0.0.1", ...(lanHost ? [lanHost] : [])])];
function listen(host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    app.listen(port, host, (error?: Error) => {
      if (error) {
        const reason =
          (error as NodeJS.ErrnoException).code === "EADDRINUSE"
            ? "Port already in use. If Airwave is running via npm run dev or npm start, use that instance or stop it first."
            : error.message;
        reject(new Error(`Cannot start Airwave on ${host}:${port}. ${reason}`));
        return;
      }
      resolve();
    });
  });
}
try {
  for (const host of hosts) await listen(host);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
// Cache recovery must run only after this process has acquired its listeners.
cache = new AudioCache(
  db,
  resolve(process.env.AUDIO_DIR ?? join(dir, "audio")),
);
for (const host of hosts)
  console.log(`Airwave listening at http://${host}:${port}`);
tick();
setInterval(
  tick,
  Math.max(1, Number(process.env.REFRESH_MINUTES ?? 60)) * 60000,
).unref();
