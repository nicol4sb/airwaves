import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AudioLines,
  Headphones,
  ListMusic,
  Play,
  Pause,
  Download,
  Check,
  Plus,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  SkipForward,
  Settings2,
  Cast,
  X,
  Rewind,
  FastForward,
  Disc3,
  Podcast as PodcastIcon,
  RefreshCw,
  Smartphone,
  ArrowLeft,
  WifiOff,
  Trash2,
} from "lucide-react";
import type { Library, Episode, Speaker } from "../shared/types";
import {
  automaticIds,
  download,
  downloads,
  drop,
  get,
  localLibrary,
  loadDownloadedAudio,
  put,
  request,
  saveProgress,
  sync,
} from "./storage";
import { audio, phone, Remote } from "./player";
const empty: Library = { episodes: [], podcasts: [], queue: [] };
type PodcastSearchResult = { title: string; url: string; author: string; image: string };
const fmt = (n: number) =>
  Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
const minutes = (s: number) =>
  s ? Math.round(s / 60) + " min" : "Duration unknown";
const date = (v: number) =>
  v
    ? new Date(v).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
function IconButton({
  label,
  click,
  children,
  active = false,
}: {
  label: string;
  click: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      className={"icon " + (active ? "active" : "")}
      aria-label={label}
      title={label}
      onClick={click}
    >
      {children}
    </button>
  );
}
function Art({ e }: { e: { art: string; title: string } }) {
  return (
    <span className="art">
      <Disc3 />
      {e.art && (
        <img
          src={e.art}
          alt=""
          loading="lazy"
          onError={(x) => (x.currentTarget.hidden = true)}
        />
      )}
    </span>
  );
}
function Cassette({ name }: { name: string }) {
  return (
    <div className="illustration" aria-hidden="true">
      <div className="orbit" />
      <div className="tape">
        <i />
        <i />
        <i />
        <i />
        <div className="label">
          <div className="hand">{name}</div>
          <div className="stripes" />
          <div className="window">
            <b />
            <span />
            <b />
          </div>
        </div>
        <div className="foot">
          <b />
          <span />
          <span />
          <b />
        </div>
      </div>
    </div>
  );
}
export default function App() {
  const [lib, setLib] = useState<Library>(empty),
    [tab, setTab] = useState("Podcasts"),
    [filter, setFilter] = useState("All"),
    [detail, setPodcastId] = useState(""),
    [count, setVisibleCount] = useState(15);
  const [modal, setModal] = useState(""),
    [message, msg] = useState(""),
    [ready, setReady] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [searchResults, setSearchResults] = useState<PodcastSearchResult[]>([]),
    [searching, setSearching] = useState(false),
    [addingPodcastURL, setAddingPodcastURL] = useState("");
  const [id, setEpisodeId] = useState(""),
    [playing, setPlaying] = useState(false),
    [pos, setPosition] = useState(0),
    [speed, setSpeed] = useState(1);
  const [saved, setSaved] = useState<string[]>([]),
    [percent, setDownloadProgress] = useState<Record<string, number>>({}),
    [auto, setAutoCount] = useState(0);
  const [speakers, setSpeakers] = useState<Speaker[]>([]),
    [remote, setRemote] = useState<Remote | null>(null),
    [volume, setVolume] = useState(25);
  const [foreground, setForeground] = useState(0);
  const [swipedPodcast, setSwipedPodcast] = useState("");
  const [swipedEpisode, setSwipedEpisode] = useState("");
  const running = useRef(new Set<string>()),
    podcastPress = useRef(new Map<string, number>()),
    podcastGesture = useRef(new Map<string, { x: number; y: number }>()),
    ignorePodcastClick = useRef(new Set<string>()),
    episodePress = useRef(new Map<string, number>()),
    episodeGesture = useRef(new Map<string, { x: number; y: number }>()),
    ignoreEpisodeClick = useRef(new Set<string>()),
    last = useRef(0),
    current = useRef({ id: "", pos: 0, playing: false }),
    player = remote ?? phone;
  const episode = lib.episodes.find((e) => e.id === id),
    recent = [...lib.episodes]
      .filter((e) => e.position > 0 && !e.played)
      .sort((a, b) => b.updated - a.updated);
  const hero = recent[0] ?? lib.episodes[0],
    selected = episode ?? hero,
    name = (e: Episode) =>
      lib.podcasts.find((p) => p.id === e.podcastId)?.title ?? "Podcast";
  const report = (e: unknown) =>
    msg(e instanceof Error ? e.message : String(e));
  const run = (fn: () => Promise<unknown>) => {
    void fn().catch(report);
  };
  async function refresh() {
    try {
      setLib(await sync());
      setOnline(true);
    } catch (e) {
      setOnline(false);
      if (navigator.onLine && !(await localLibrary())) report(e);
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    const login = () => setModal("login");
    const wake = () => {
      if (!document.hidden) run(refresh);
    };
    const lost = () => setOnline(false);
    window.addEventListener("login-needed", login);
    const resumeSync = () => {
      if (!document.hidden) {
        setForeground((n) => n + 1);
        wake();
      }
    };
    document.addEventListener("visibilitychange", resumeSync);
    window.addEventListener("online", wake);
    window.addEventListener("offline", lost);
    run(async () => {
      setLib((await localLibrary()) ?? empty);
      setSaved(await downloads());
      await loadDownloadedAudio();
      setAutoCount((await get<number>("auto")) ?? 0);
      await refresh();
    });
    const timer = setInterval(wake, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("login-needed", login);
      document.removeEventListener("visibilitychange", resumeSync);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", lost);
    };
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => msg(""), 6000);
    return () => clearTimeout(t);
  }, [message]);
  async function storePosition(key: string, value: number, ended = false) {
    if (!key || !Number.isFinite(value)) return;
    const p = { id: key, position: value, updated: Date.now(), played: ended };
    setLib((l) => ({
      ...l,
      episodes: l.episodes.map((e) =>
        e.id === key ? { ...e, ...p, played: +ended } : e,
      ),
    }));
    await saveProgress(p);
  }
  async function queue(ids: string[]) {
    await put("queue", ids);
    setLib((l) => ({ ...l, queue: ids }));
    if (online) await refresh();
  }
  async function start(e: Episode, position = e.played ? 0 : e.position) {
    if (current.current.id && current.current.id !== e.id)
      void storePosition(current.current.id, current.current.pos).catch(report);
    current.current = { id: e.id, pos: position, playing: false };
    setEpisodeId(e.id);
    setPosition(position);
    setPlaying(false);
    await player.play(e, lib.queue, position);
    setPlaying(true);
    if (!remote) audio.playbackRate = speed;
    if (lib.queue.includes(e.id))
      await queue(lib.queue.filter((i) => i !== e.id));
  }
  async function toggle() {
    if (!episode && selected) return start(selected);
    if (!episode) return;
    if (playing) {
      await player.pause();
      setPlaying(false);
      await storePosition(id, pos);
    } else if (remote || audio.src) {
      await player.resume();
      setPlaying(true);
    } else await start(episode);
  }
  async function seek(n: number) {
    const value = Math.max(
      0,
      Math.min(n, episode?.duration || audio.duration || n),
    );
    await player.seek(value);
    setPosition(value);
    current.current.pos = value;
    await storePosition(id, value);
  }
  async function next() {
    const e = lib.episodes.find((e) => e.id === lib.queue[0]);
    if (e) await start(e);
  }
  const handlers = useRef({ next, toggle, seek, storePosition });
  handlers.current = { next, toggle, seek, storePosition };
  current.current = { id, pos, playing };
  useEffect(() => {
    if (remote) return;
    const tick = () => {
      const n = audio.currentTime;
      setPosition(n);
      current.current.pos = n;
      if (Date.now() - last.current > 4500) {
        last.current = Date.now();
        run(() => handlers.current.storePosition(current.current.id, n));
      }
    };
    const pause = () => setPlaying(false),
      play = () => setPlaying(true),
      fail = () => {
        setPlaying(false);
        msg("This audio could not be played. Try downloading the episode.");
      };
    const end = () => {
      run(async () => {
        await handlers.current.storePosition(
          current.current.id,
          audio.currentTime,
          true,
        );
        current.current.id = "";
        await handlers.current.next();
      });
    };
    const hide = () => {
      if (document.hidden && current.current.id)
        run(() =>
          handlers.current.storePosition(
            current.current.id,
            audio.currentTime,
            audio.ended,
          ),
        );
    };
    audio.addEventListener("timeupdate", tick);
    audio.addEventListener("pause", pause);
    audio.addEventListener("playing", play);
    audio.addEventListener("ended", end);
    audio.addEventListener("error", fail);
    document.addEventListener("visibilitychange", hide);
    return () => {
      audio.removeEventListener("timeupdate", tick);
      audio.removeEventListener("pause", pause);
      audio.removeEventListener("playing", play);
      audio.removeEventListener("ended", end);
      audio.removeEventListener("error", fail);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [remote]);
  useEffect(() => {
    if (!episode || !("mediaSession" in navigator) || remote) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: name(episode),
      album: "Airwave",
      artwork: episode.art
        ? [{ src: new URL(episode.art, location.href).href }]
        : [],
    });
    const actions: Partial<
      Record<MediaSessionAction, MediaSessionActionHandler>
    > = {
      play: () => run(() => phone.resume()),
      pause: () => run(() => phone.pause()),
      seekbackward: () =>
        run(() => handlers.current.seek(audio.currentTime - 15)),
      seekforward: () =>
        run(() => handlers.current.seek(audio.currentTime + 30)),
      seekto: (d) => run(() => handlers.current.seek(d.seekTime ?? 0)),
      nexttrack: () => run(() => handlers.current.next()),
    };
    for (const [a, fn] of Object.entries(actions))
      try {
        navigator.mediaSession.setActionHandler(a as MediaSessionAction, fn);
      } catch {}
    return () => {
      for (const a of Object.keys(actions))
        try {
          navigator.mediaSession.setActionHandler(
            a as MediaSessionAction,
            null,
          );
        } catch {}
    };
  }, [id, remote]);
  useEffect(() => {
    if (!remote) return;
    let alive = true,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const s = await remote.status();
        if (!alive) return;
        setPosition(s.position);
        setPlaying(s.playing);
        setVolume(s.volume);
        const e = lib.episodes.find((e) => e.audio === s.audio);
        if (e) {
          if (current.current.id && current.current.id !== e.id) {
            await storePosition(current.current.id, current.current.pos, true);
            await queue(lib.queue.filter((i) => i !== e.id));
          }
          setEpisodeId(e.id);
          await storePosition(e.id, s.position);
        }
      } catch {
        if (alive) {
          setPlaying(false);
          msg(
            "Speaker unavailable. Check its connection or select this device.",
          );
        }
      } finally {
        running = false;
      }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [remote, lib.queue.join(",")]);
  async function choose(s?: Speaker) {
    if (s && s.id === remote?.speaker.id) {
      setModal("");
      return;
    }
    const target = s ? new Remote(s) : null;
    if (episode) {
      const offset = remote
        ? await remote
            .status()
            .then((s) => s.position)
            .catch(() => pos)
        : audio.currentTime;
      if (target) {
        await target.play(episode, lib.queue, offset);
        await player.pause();
      } else {
        await player
          .pause()
          .catch(() => msg("Speaker unreachable. It may still be playing."));
        await phone.play(episode, [], offset);
      }
      setPlaying(true);
    }
    setRemote(target);
    setModal("");
  }
  async function scan() {
    setBusy(true);
    try {
      setSpeakers(await request<Speaker[]>("speakers"));
    } finally {
      setBusy(false);
    }
  }
  function devices() {
    setModal("devices");
    run(scan);
  }
  async function save(e: Episode, manual = true) {
    if (running.current.has(e.id)) return;
    running.current.add(e.id);
    setDownloadProgress((p) => ({ ...p, [e.id]: 0 }));
    try {
      await download(
        e,
        (n) => setDownloadProgress((p) => ({ ...p, [e.id]: n })),
        manual,
      );
      setSaved(await downloads());
      if (manual) msg("Downloaded to this device");
    } finally {
      running.current.delete(e.id);
      setDownloadProgress((p) => {
        const next = { ...p };
        delete next[e.id];
        return next;
      });
    }
  }
  async function removeDownload(e: Episode) {
    await drop(e.id);
    await put("skip:" + e.id, true);
    setSaved(await downloads());
  }
  async function markPodcastRead(podcastId: string) {
    const unread = lib.episodes.filter((e) => e.podcastId === podcastId && !e.played);
    const updated = Date.now();
    setLib((currentLib) => ({
      ...currentLib,
      episodes: currentLib.episodes.map((e) =>
        e.podcastId === podcastId && !e.played
          ? { ...e, played: 1, updated }
          : e,
      ),
    }));
    await Promise.all(unread.map((e) => saveProgress({
      id: e.id,
      position: e.position,
      played: true,
      updated,
    })));
  }
  useEffect(() => {
    if (!online || !ready || !lib.episodes.length) return;
    let stop = false;
    run(async () => {
      const wanted = automaticIds(lib, auto);
      const existing = await downloads();
      for (const id of existing) {
        const e = lib.episodes.find((e) => e.id === id);
        if (
          !wanted.includes(id) &&
          !(e?.position && !e.played) &&
          !(await get("pin:" + id))
        )
          await drop(id);
      }
      for (const key of wanted) {
        if (stop) break;
        if (!existing.includes(key) && !(await get("skip:" + key)))
          await save(
            lib.episodes.find((e) => e.id === key)!,
            false,
          );
      }
      if (!stop) setSaved(await downloads());
    });
    return () => {
      stop = true;
    };
  }, [auto, online, ready, foreground, automaticIds(lib, auto).join(",")]);
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    try {
      if (modal === "login")
        await request("login", "POST", { password: input });
      else await request("podcasts", "POST", { url: input.trim() });
      setInput("");
      setModal("");
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function searchPodcasts(ev: FormEvent) {
    ev.preventDefault();
    setSearching(true);
    try {
      setSearchResults(await request<PodcastSearchResult[]>("search-podcasts?q=" + encodeURIComponent(search.trim())));
    } catch (e) {
      report(e);
    } finally {
      setSearching(false);
    }
  }
  async function addPodcast(url: string) {
    if (addingPodcastURL) return;
    setAddingPodcastURL(url);
    try {
      await request("podcasts", "POST", { url });
      setModal("");
      msg("Podcast added");
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setAddingPodcastURL("");
    }
  }
  const show = (m: string) => {
    setInput("");
    setSearch("");
    setSearchResults([]);
    setModal(m);
  };
  const tabs = [
    ["Episodes", AudioLines],
    ["Podcasts", PodcastIcon],
    ["Queue", ListMusic],
  ] as const;
  const eps = (
    lib.episodes
  ).filter(
    (e) =>
      (detail
        ? e.podcastId === detail
        : filter === "Unplayed"
          ? !e.played
          : filter === "Downloaded"
            ? saved.includes(e.id)
            : true),
  );
  const row = (e: Episode, index: number) => (
    <article
      className={"row " + (swipedEpisode === e.id ? "swiped" : "")}
      key={e.id}
      onPointerDown={(event) => {
        if (!saved.includes(e.id) || (event.pointerType === "mouse" && event.button !== 0)) return;
        episodeGesture.current.set(e.id, { x: event.clientX, y: event.clientY });
        episodePress.current.set(e.id, window.setTimeout(() => {
          ignoreEpisodeClick.current.add(e.id);
          setSwipedEpisode(e.id);
        }, 550));
      }}
      onPointerMove={(event) => {
        const start = episodeGesture.current.get(e.id);
        if (!start) return;
        if (Math.abs(event.clientX - start.x) > 12 || Math.abs(event.clientY - start.y) > 12) {
          window.clearTimeout(episodePress.current.get(e.id));
          episodePress.current.delete(e.id);
        }
      }}
      onPointerUp={(event) => {
        window.clearTimeout(episodePress.current.get(e.id));
        episodePress.current.delete(e.id);
        const start = episodeGesture.current.get(e.id);
        episodeGesture.current.delete(e.id);
        if (!start) return;
        const dx = event.clientX - start.x;
        if (dx < -55) {
          ignoreEpisodeClick.current.add(e.id);
          setSwipedEpisode(e.id);
        } else if (dx > 55 && swipedEpisode === e.id) {
          ignoreEpisodeClick.current.add(e.id);
          setSwipedEpisode("");
        }
      }}
      onPointerCancel={() => {
        window.clearTimeout(episodePress.current.get(e.id));
        episodePress.current.delete(e.id);
        episodeGesture.current.delete(e.id);
      }}
      onClickCapture={(event) => {
        if (!ignoreEpisodeClick.current.delete(e.id)) return;
        if ((event.target as HTMLElement).closest(".episode-delete")) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        className="artplay"
        aria-label={"Play " + e.title}
        onClick={() => run(() => start(e))}
      >
        <Art e={e} />
      </button>
      <div className="rowcopy">
        <div className="eyebrow">{name(e)}</div>
        <button className="rowtitle" onClick={() => run(() => start(e))}>
          {e.title}
        </button>
        <small>
          {date(e.date)} <span>·</span> {minutes(e.duration)}{" "}
          {e.played ? " · Played" : ""}
        </small>
      </div>
      <div className="actions">
        {tab === "Queue" ? (
          <>
            <IconButton
              label="Move up"
              click={() => {
                if (index) {
                  const a = [...lib.queue];
                  [a[index - 1], a[index]] = [a[index], a[index - 1]];
                  run(() => queue(a));
                }
              }}
            >
              <ChevronUp />
            </IconButton>
            <IconButton
              label="Move down"
              click={() => {
                if (index + 1 < lib.queue.length) {
                  const a = [...lib.queue];
                  [a[index + 1], a[index]] = [a[index], a[index + 1]];
                  run(() => queue(a));
                }
              }}
            >
              <ChevronDown />
            </IconButton>
            <IconButton
              label="Remove from queue"
              click={() =>
                run(() => queue(lib.queue.filter((i) => i !== e.id)))
              }
            >
              <X />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton
              label={
                saved.includes(e.id) ? "Delete download" : "Download episode"
              }
              click={() =>
                run(() => (saved.includes(e.id) ? removeDownload(e) : save(e)))
              }
            >
              {percent[e.id] !== undefined ? (
                <small>{percent[e.id]}%</small>
              ) : saved.includes(e.id) ? (
                <Check />
              ) : (
                <Download />
              )}
            </IconButton>
            <IconButton
              label={
                lib.queue.includes(e.id) ? "Remove from queue" : "Add to queue"
              }
              click={() =>
                run(() =>
                  queue(
                    lib.queue.includes(e.id)
                      ? lib.queue.filter((i) => i !== e.id)
                      : [...lib.queue, e.id],
                  ),
                )
              }
            >
              {lib.queue.includes(e.id) ? <Check /> : <Plus />}
            </IconButton>
          </>
        )}
        {swipedEpisode === e.id && saved.includes(e.id) && (
          <button className="episode-delete" aria-label="Delete downloaded episode" onClick={() => {
            ignoreEpisodeClick.current.delete(e.id);
            setSwipedEpisode("");
            run(() => removeDownload(e));
          }}>
            <Trash2 size={17} /> Delete
          </button>
        )}
        <button
          className="round"
          aria-label={"Play or pause " + e.title}
          onClick={() => run(() => (id === e.id ? toggle() : start(e)))}
        >
          {id === e.id && playing ? <Pause /> : <Play />}
        </button>
      </div>
    </article>
  );
  return (
    <>
      <header>
        <div className="headinner">
          <div className="brand">
            <span>
              <AudioLines size={24} />
            </span>
            Airwave
          </div>
          <div className="headtools">
            <button className="device" onClick={devices}>
              <Cast size={16} />
              {remote?.speaker.name ?? "This device"}
              <ChevronDown size={14} />
            </button>
            <IconButton label="Library settings" click={() => show("settings")}>
              <Settings2 />
            </IconButton>
          </div>
        </div>
      </header>
      <main>
        {!online && (
          <div className="notice">
            <WifiOff size={16} /> Offline library
          </div>
        )}
        {!detail ? (
          <>
            <div className="sectionhead">
              <span />
              <button className="icon" aria-label="Add podcast" onClick={() => show("add")}>
                <Plus size={19} />
              </button>
            </div>
            {lib.podcasts.map((p) => (
              <div
                className={"subscription-swipe " + (swipedPodcast === p.id ? "swiped" : "")}
                key={p.id}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse" && event.button !== 0) return;
                  podcastGesture.current.set(p.id, { x: event.clientX, y: event.clientY });
                  const timer = window.setTimeout(() => {
                    ignorePodcastClick.current.add(p.id);
                    setPodcastId(p.id);
                    setModal("remove");
                  }, 550);
                  podcastPress.current.set(p.id, timer);
                }}
                onPointerMove={(event) => {
                  const start = podcastGesture.current.get(p.id);
                  if (!start) return;
                  const dx = event.clientX - start.x;
                  const dy = event.clientY - start.y;
                  if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
                    window.clearTimeout(podcastPress.current.get(p.id));
                    podcastPress.current.delete(p.id);
                  }
                }}
                onPointerUp={(event) => {
                  window.clearTimeout(podcastPress.current.get(p.id));
                  podcastPress.current.delete(p.id);
                  const start = podcastGesture.current.get(p.id);
                  podcastGesture.current.delete(p.id);
                  if (!start) return;
                  const dx = event.clientX - start.x;
                  if (dx < -55) {
                    ignorePodcastClick.current.add(p.id);
                    setSwipedPodcast(p.id);
                  } else if (dx > 55 && swipedPodcast === p.id) {
                    ignorePodcastClick.current.add(p.id);
                    setSwipedPodcast("");
                  }
                }}
                onPointerCancel={() => {
                  window.clearTimeout(podcastPress.current.get(p.id));
                  podcastPress.current.delete(p.id);
                  podcastGesture.current.delete(p.id);
                }}
              >
                <button
                  className="subscription"
                  onClick={() => {
                    if (ignorePodcastClick.current.delete(p.id)) return;
                    setPodcastId(p.id);
                    setVisibleCount(15);
                  }}
                >
                  <Art e={p} />
                  <div>
                    <b>{p.title}</b>
                    <small>
                      {lib.episodes.filter((e) => e.podcastId === p.id && !e.played).length} new
                      {p.error ? " · Refresh pending" : ""}
                    </small>
                  </div>
                  {lib.episodes.some((e) => e.podcastId === p.id && !e.played) && <i className="unread-dot" aria-label="Unread episodes" />}
                  <ChevronRight />
                </button>
                {swipedPodcast === p.id && (
                  <div className="subscription-actions">
                    <button onClick={() => {
                      setPodcastId(p.id);
                      setModal("remove");
                      setSwipedPodcast("");
                    }}><Trash2 size={17} /> Delete</button>
                    <button onClick={() => {
                      run(() => markPodcastRead(p.id));
                      setSwipedPodcast("");
                    }}>Mark all read</button>
                  </div>
                )}
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="sectionhead">
              <h2><button onClick={() => setPodcastId("")}><ArrowLeft size={18} /> Podcasts</button></h2>
              {detail && (
                <button
                  className="secondary"
                  onClick={() => setModal("remove")}
                >
                  Unsubscribe
                </button>
              )}
              {detail && (
                <div className="filters">
                  {["Unplayed", "All", "Downloaded"].map((f) => (
                    <button
                      key={f}
                      aria-pressed={filter === f}
                      onClick={() => {
                        setFilter(f);
                        setVisibleCount(15);
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="listing">{eps.slice(0, count).map(row)}</div>
            {eps.length > count && (
              <button
                className="more"
                onClick={() => setVisibleCount(count + 25)}
              >
                Show more episodes
              </button>
            )}
            {!eps.length && (
              <p className="empty">
                {!ready
                  ? "Loading library…"
                  : filter === "Downloaded"
                      ? "Downloaded episodes will appear here."
                      : "No episodes here yet."}
              </p>
            )}
          </>
        )}
      </main>
      {message && (
        <button className="toast" role="status" onClick={() => msg("")}>
          {message}
          <X size={15} />
        </button>
      )}
      {modal && (
        <div
          className={"scrim " + (modal === "player" ? "fullscreen" : "")}
          onClick={() => {
            if (modal !== "login") setModal("");
          }}
        >
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "player" ? "Now playing" : modal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheethead">
              <h2>
                {
                  {
                    player: "Now playing",
                    settings: "Library settings",
                    devices: "Playback device",
                    login: "Sign in",
                    add: "Add podcast",
                    remove: "Remove subscription?",
                  }[modal]
                }
              </h2>
              <IconButton label="Close" click={() => setModal("")}>
                <X />
              </IconButton>
            </div>
            {modal === "player" && selected && (
              <div className="full">
                <Art e={selected} />
                <div className="eyebrow">{name(selected)}</div>
                <h2>{selected.title}</h2>
                <input
                  aria-label="Playback position"
                  type="range"
                  min="0"
                  max={selected.duration || pos || 1}
                  value={pos}
                  onChange={(e) => run(() => seek(+e.target.value))}
                />
                <div className="time">
                  <span>{fmt(pos)}</span>
                  <span>{fmt(selected.duration)}</span>
                </div>
                <div className="controls">
                  <button
                    aria-label="Back 15 seconds"
                    onClick={() => run(() => seek(pos - 15))}
                  >
                    <Rewind />
                    15
                  </button>
                  <button
                    className="round big"
                    onClick={() => run(toggle)}
                    aria-label="Play or pause"
                  >
                    {playing ? <Pause /> : <Play />}
                  </button>
                  <button
                    aria-label="Forward 30 seconds"
                    onClick={() => run(() => seek(pos + 30))}
                  >
                    30
                    <FastForward />
                  </button>
                </div>
                <div className="controls">
                  {!remote && (
                    <select
                      aria-label="Playback speed"
                      value={speed}
                      onChange={(e) => {
                        setSpeed(+e.target.value);
                        audio.playbackRate = +e.target.value;
                      }}
                    >
                      {[1, 1.25, 1.5, 1.75, 2].map((n) => (
                        <option key={n} value={n}>
                          {n}×
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={devices}>
                    <Cast size={16} />
                    {remote?.speaker.name ?? "This device"}
                  </button>
                </div>
                <p>{selected.description}</p>
              </div>
            )}
            {modal === "add" && (
              <>
                <form onSubmit={searchPodcasts}>
                  <label>
                    Search podcasts
                    <input autoFocus type="search" minLength={2} maxLength={100} placeholder="The Rest Is History" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </label>
                  <button className="primary" disabled={searching || search.trim().length < 2}>{searching ? "Searching…" : "Search"}</button>
                </form>
                {searchResults.length > 0 && (
                  <div className="podcast-results" aria-label="Search results">
                    {searchResults.map((result) => (
                      <button key={result.url} type="button" disabled={!!addingPodcastURL} onClick={() => void addPodcast(result.url)}>
                        {result.image && <img src={result.image} alt="" />}
                        <span><strong>{addingPodcastURL === result.url ? "Adding…" : result.title}</strong>{result.author && <small>{result.author}</small>}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {modal === "login" && (
              <form onSubmit={submit}>
                <label>
                  Library password
                  <input
                    autoFocus
                    required
                    type="password"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? "Connecting…" : "Sign in"}
                </button>
              </form>
            )}
            {modal === "settings" && (
              <label>
                Automatically download unplayed episodes per podcast
                <select
                  value={auto}
                  onChange={(e) => {
                    setAutoCount(+e.target.value);
                    run(() => put("auto", +e.target.value));
                  }}
                >
                  {[0, 1, 2, 3, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n || "Off"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {modal === "remove" && (
              <>
                <p>
                  This removes the podcast and its episodes from your library.
                </p>
                <button
                  className="primary"
                  onClick={() =>
                    run(async () => {
                      await request("podcasts/" + detail, "DELETE");
                      setPodcastId("");
                      setModal("");
                      await refresh();
                    })
                  }
                >
                  Remove podcast
                </button>
              </>
            )}
            {modal === "devices" && (
              <>
                <button
                  className="option"
                  onClick={() => (remote ? run(() => choose()) : setModal(""))}
                >
                  <Smartphone />
                  This device {!remote && <Check />}
                </button>
                {speakers.map((s) => (
                  <button
                    className="option"
                    key={s.id}
                    onClick={() => run(() => choose(s))}
                  >
                    <Cast />
                    {s.name}
                    <small>{s.system}</small>
                    {remote?.speaker.id === s.id && <Check />}
                  </button>
                ))}
                {remote && (
                  <label>
                    Speaker volume
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={volume}
                      onChange={(e) => {
                        setVolume(+e.target.value);
                        run(() => remote.volume(+e.target.value));
                      }}
                    />
                  </label>
                )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => run(scan)}
                >
                  <RefreshCw size={16} />
                  {busy ? "Scanning…" : "Scan for speakers"}
                </button>
                {!busy && !speakers.length && (
                  <p>No Sonos speakers found on the server’s network.</p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
