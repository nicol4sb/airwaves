import express from "express";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { openProfile } from "./profile";
import { externalURL } from "./network";
import { hash } from "./rss";
import { profileNames } from "../shared/profiles";
import { LocalSonos, MockSonos, type SonosAdapter } from "../sonos/adapter";
if (process.env.NODE_ENV !== "production") {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
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
  for (const profile of libraries) profile.db.prepare("SELECT 1").get();
  r.set("Cache-Control", "no-store").json({ ok: true });
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
const sharedApi = express.Router();
sharedApi.get("/search-podcasts", async (q, r) => {
  const term = String(q.query.q ?? "").trim();
  if (term.length < 2 || term.length > 100) {
    r.status(400).json({ error: "Enter at least 2 characters to search" });
    return;
  }
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("media", "podcast");
  url.searchParams.set("limit", "12");
  const result = await fetch(url, {
    headers: { "User-Agent": "Airwave/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!result.ok) throw Error("Podcast search failed (" + result.status + ")");
  const data = (await result.json()) as { results?: Array<Record<string, unknown>> };
  r.json((data.results ?? []).flatMap((feed) => {
    if (typeof feed.collectionName !== "string" || typeof feed.feedUrl !== "string") return [];
    let url: string;
    try {
      url = externalURL(feed.feedUrl).href;
    } catch {
      return [];
    }
    return [{
      id: hash(url),
      title: feed.collectionName,
      url,
      author: typeof feed.artistName === "string" ? feed.artistName : "",
      image: typeof feed.artworkUrl100 === "string" ? feed.artworkUrl100 : "",
    }];
  }));
});
sharedApi.get("/speakers", async (_q, r) => {
  r.json(sonos.cached() ?? await sonos.discover());
});
sharedApi.post("/speakers/scan", async (_q, r) => r.json(await sonos.discover()));
sharedApi.get("/speakers/:id", async (q, r) =>
  r.json(await sonos.status(q.params.id)),
);
const libraries: ReturnType<typeof openProfile>[] = [];
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
// Open the databases and recover cached files only after acquiring the listeners.
const dataDir = resolve(process.env.DATA_DIR ?? "data");
const audioDir = resolve(process.env.AUDIO_DIR ?? join(dataDir, "audio"));
for (const name of profileNames) {
  const isNic = name === "nic";
  const profile = openProfile(
    isNic ? dataDir : join(dataDir, "profiles", name),
    isNic ? audioDir : join(audioDir, "profiles", name),
    isNic,
    sonos,
  );
  libraries.push(profile);
  const routes = ["/api/profiles/" + name];
  if (isNic) routes.push("/api");
  app.use(routes, sharedApi, profile.router);
}

if (existsSync("dist/index.html")) {
  app.get(profileNames.map((name) => "/" + name), (_q, r) => r.sendFile(resolve("dist/index.html")));
  app.use(express.static("dist"));
}
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
for (const host of hosts)
  console.log(`Airwave listening at http://${host}:${port}`);
const refreshSpeakers = () => {
  void sonos.discover().catch((e) => console.warn("Sonos discovery:", String(e)));
};
refreshSpeakers();
setInterval(refreshSpeakers, 60_000).unref();
const tick = () => {
  for (const profile of libraries)
    void profile.refresh().catch((error) => console.warn("Refresh:", String(error)));
};
tick();
setInterval(
  tick,
  Math.max(1, Number(process.env.REFRESH_MINUTES ?? 60)) * 60000,
).unref();
