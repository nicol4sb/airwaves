import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AudioLines,
  Headphones,
  Search,
  Play,
  Pause,
  Download,
  Volume1,
  Volume2,
  Check,
  Plus,
  ChevronDown,
  ChevronRight,
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
  LoaderCircle,
  Trash2,
} from "lucide-react";
import type { Library, Episode, Speaker, Podcast } from "../shared/types";
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
import { profileLabel } from "./profile";
const empty: Library = { episodes: [], podcasts: [], queue: [] };
type PodcastSearchResult = { id: string; title: string; url: string; author: string; image: string };
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
function EpisodeImportStatus({ podcast, online }: { podcast: Podcast; online: boolean }) {
  const loading = online && !podcast.error;
  return (
    <span className="episode-import" role="status">
      {loading && <LoaderCircle size={15} aria-hidden="true" />}
      {podcast.error ? "Couldn’t load episodes. Will retry on refresh."
        : online ? "Loading episodes…" : "Waiting for a connection to update episodes."}
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
    [tab, setTab] = useState("Episodes"),
    [filter, setFilter] = useState("Unplayed"),
    [detail, setPodcastId] = useState(""),
    [episodeQuery, setEpisodeQuery] = useState(""),
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
  const [speakers, setSpeakers] = useState<Speaker[]>(),
    [scanning, setScanning] = useState(false),
    [speakerError, setSpeakerError] = useState(""),
    [remote, setRemote] = useState<Remote | null>(null),
    [volume, setVolume] = useState<number>();
  const volumeTarget = useRef<Remote | null>(null);
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
    searchRequest = useRef(0),
    player = remote ?? phone;
  const pickerOpen = modal === "devices";
  const remoteUnavailable = !online || (pickerOpen && !!speakerError);
  const deviceLabel = remote ? (remoteUnavailable ? "Playback device" : remote.speaker.name) : "This device";
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
  const importingPodcast = lib.podcasts.find((p) => p.importPending && !p.error);
  const importingEpisodes = !!importingPodcast;
  useEffect(() => {
    if (!online || !importingEpisodes || addingPodcastURL) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) run(refresh);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [online, importingEpisodes, addingPodcastURL]);
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
  async function start(e: Episode, position = e.played ? 0 : e.position) {
    if (current.current.id && current.current.id !== e.id && (remote || !audio.ended))
      void storePosition(current.current.id, current.current.pos).catch(report);
    current.current = { id: e.id, pos: position, playing: false };
    setEpisodeId(e.id);
    setPosition(position);
    setPlaying(false);
    await player.play(e, position);
    setPlaying(true);
    if (!remote) audio.playbackRate = speed;
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
  const handlers = useRef({ toggle, seek, storePosition });
  handlers.current = { toggle, seek, storePosition };
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
      setPlaying(false);
      run(() => handlers.current.storePosition(current.current.id, audio.currentTime, true));
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
    if (!remote || remoteUnavailable) return;
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
        setVolume(remote.volumeLevel);
        const e = lib.episodes.find((e) => e.audio === s.audio);
        if (e) {
          if (current.current.id && current.current.id !== e.id) {
            await storePosition(current.current.id, current.current.pos, true);
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
  }, [remote, remoteUnavailable]);
  async function choose(s?: Speaker) {
    if (s && s.id === remote?.speaker.id) {
      setModal("");
      return;
    }
    const target = s ? new Remote(s) : null;
    if (episode) {
      let offset = audio.currentTime;
      if (remote) {
        offset = pos;
        if (!remoteUnavailable)
          offset = await remote.status().then((status) => status.position).catch(() => pos);
      }
      if (target) {
        await target.play(episode, offset);
        await player.pause();
      } else {
        if (!remoteUnavailable)
          await player.pause().catch(() => msg("Speaker unreachable. It may still be playing."));
        await phone.play(episode, offset);
      }
      setPlaying(true);
    }
    volumeTarget.current = target;
    setVolume(undefined);
    setRemote(target);
    setModal("");
  }
  function changeVolume(target: Remote, value: number) {
    const write = target.setVolume(value);
    setVolume(target.volumeLevel);
    void write.catch((error) => {
      if (volumeTarget.current === target) {
        setVolume(target.volumeLevel);
        report(error);
      }
    });
  }
  useEffect(() => {
    if (!remote || remoteUnavailable) return;
    const press = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.cancelable || remote.volumeLevel === undefined) return;
      if (event.key !== "AudioVolumeUp" && event.key !== "AudioVolumeDown") return;
      event.preventDefault();
      changeVolume(remote, remote.volumeLevel + (event.key === "AudioVolumeUp" ? 5 : -5));
    };
    window.addEventListener("keydown", press);
    return () => window.removeEventListener("keydown", press);
  }, [remote, remoteUnavailable]);
  const volumeControls = remote && !remoteUnavailable && volume !== undefined && (
    <div className="speaker-volume" role="group" aria-label={remote.speaker.name + " volume"}>
      <button aria-label="Lower speaker volume" disabled={volume === 0} onClick={() => changeVolume(remote, volume - 5)}><Volume1 /></button>
      <input type="range" aria-label="Speaker volume" min="0" max="100" value={volume} onChange={(e) => changeVolume(remote, +e.target.value)} />
      <output>{volume}%</output>
      <button aria-label="Raise speaker volume" disabled={volume === 100} onClick={() => changeVolume(remote, volume + 5)}><Volume2 /></button>
    </div>
  );
  const readingSpeakers = useRef<AbortController | null>(null);
  async function loadSpeakers(rescan = false) {
    if (!navigator.onLine || (!rescan && readingSpeakers.current)) return;
    readingSpeakers.current?.abort();
    const controller = new AbortController();
    readingSpeakers.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setScanning(rescan);
    try {
      const rooms = await request<Speaker[]>(
        rescan ? "speakers/scan" : "speakers",
        rescan ? "POST" : "GET",
        undefined,
        controller.signal,
      );
      if (readingSpeakers.current === controller) {
        setSpeakers(rooms);
        setSpeakerError("");
      }
    } catch {
      if (readingSpeakers.current === controller) {
        setSpeakers(undefined);
        setSpeakerError("Couldn’t reach the server’s speaker list.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (readingSpeakers.current === controller) {
        readingSpeakers.current = null;
        setScanning(false);
      }
    }
  }
  useEffect(() => {
    if (!pickerOpen) return;
    const fetchList = () => {
      if (!document.hidden) void loadSpeakers();
    };
    const offline = () => {
      readingSpeakers.current?.abort();
      readingSpeakers.current = null;
      setSpeakers(undefined);
      setScanning(false);
      setSpeakerError("Server offline.");
    };
    if (navigator.onLine) fetchList();
    else offline();
    window.addEventListener("offline", offline);
    window.addEventListener("online", fetchList);
    document.addEventListener("visibilitychange", fetchList);
    const timer = window.setInterval(fetchList, 5000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", fetchList);
      document.removeEventListener("visibilitychange", fetchList);
      readingSpeakers.current?.abort();
      readingSpeakers.current = null;
    };
  }, [pickerOpen]);
  function devices() {
    setSpeakers(undefined);
    setScanning(false);
    setSpeakerError(navigator.onLine ? "" : "Server offline.");
    setModal("devices");
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
  async function deletePodcast(podcastId: string) {
    const previous = lib;
    const next = {
      ...lib,
      podcasts: lib.podcasts.filter((p) => p.id !== podcastId),
      episodes: lib.episodes.filter((e) => e.podcastId !== podcastId),
    };
    setLib(next);
    setPodcastId("");
    setModal("");
    setSwipedPodcast("");
    await put("library", next);
    try {
      await request("podcasts/" + podcastId, "DELETE");
      void refresh();
    } catch (error) {
      setLib(previous);
      await put("library", previous);
      report(error);
    }
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
  useEffect(() => {
    const query = search.trim();
    const requestId = ++searchRequest.current;
    if (modal !== "add" || query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void request<PodcastSearchResult[]>("search-podcasts?q=" + encodeURIComponent(query))
        .then((results) => {
          if (searchRequest.current === requestId) setSearchResults(results);
        })
        .catch((error) => {
          if (searchRequest.current === requestId) report(error);
        })
        .finally(() => {
          if (searchRequest.current === requestId) setSearching(false);
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, modal]);
  async function addPodcast(result: PodcastSearchResult) {
    if (addingPodcastURL) return;
    setAddingPodcastURL(result.url);
    let optimistic: Library | undefined;
    let optimisticId = "";
    try {
      const normalizedURL = new URL(result.url).href;
      if (lib.podcasts.some((p) => p.url === normalizedURL)) {
        setModal("");
        return;
      }
      optimisticId = result.id;
      const localPodcast: Podcast = { id: optimisticId, title: result.title, url: normalizedURL, art: result.image, error: "", importPending: 1 };
      optimistic = { ...lib, podcasts: [...lib.podcasts.filter((p) => p.id !== optimisticId), localPodcast].sort((a, b) => a.title.localeCompare(b.title)) };
      setLib(optimistic);
      setModal("");
      void put("library", optimistic);
      const added = await request<{ id: string; podcast: Podcast }>("podcasts", "POST", {
        url: normalizedURL,
        title: result.title,
        art: result.image,
      });
      setLib((currentLib) => ({
        ...currentLib,
        podcasts: currentLib.podcasts.map((p) => p.id === optimisticId ? added.podcast : p),
      }));
      void put("library", {
        ...optimistic,
        podcasts: optimistic.podcasts.map((p) => p.id === optimisticId ? added.podcast : p),
      });
      void refresh();
    } catch (e) {
      if (optimistic) {
        if (optimisticId) {
          setLib((currentLib) => ({ ...currentLib, podcasts: currentLib.podcasts.filter((p) => p.id !== optimisticId) }));
          const local = await localLibrary();
          if (local) await put("library", { ...local, podcasts: local.podcasts.filter((p) => p.id !== optimisticId) });
        }
      }
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
  ] as const;
  const detailPodcast = lib.podcasts.find((p) => p.id === detail);
  const titleQuery = episodeQuery.trim().toLocaleLowerCase();
  const eps = useMemo(() => lib.episodes.filter((e) => {
    if (detail) return e.podcastId === detail && e.title.toLocaleLowerCase().includes(titleQuery);
    if (filter === "Downloaded") return saved.includes(e.id);
    return filter !== "Unplayed" || !e.played;
  }), [lib.episodes, detail, titleQuery, filter, saved]);
  const emptyImport = detailPodcast?.importPending ? detailPodcast
    : tab === "Episodes" && filter !== "Downloaded" && !eps.length ? importingPodcast : undefined;
  const row = (e: Episode) => (
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
              {deviceLabel}
              <ChevronDown size={14} />
            </button>
            <IconButton label="Library settings" click={() => show("settings")}>
              <Settings2 />
            </IconButton>
          </div>
        </div>
      </header>
      <main>
        <div className="pagehead">
          <div className="over"><span className="tinyline" /> {profileLabel.toUpperCase()}’S LIBRARY</div>
          <h1>{detail ? lib.podcasts.find((p) => p.id === detail)?.title : tab}</h1>
        </div>
        {!online && (
          <div className="notice">
            <WifiOff size={16} /> Offline library
          </div>
        )}
        {tab === "Episodes" && hero && (
          <section className="hero">
            <div className="herocopy">
              <div className="heroeyebrow"><Headphones size={16} />{recent.length ? "Continue listening" : "Featured episode"}</div>
              <h2>{hero.title}</h2>
              <div className="herometa">{name(hero)} <span>·</span> {minutes(hero.duration)}</div>
              {hero.position > 0 && <progress value={hero.position} max={hero.duration || hero.position} />}
              <button className="primary" onClick={() => run(() => (id === hero.id ? toggle() : start(hero)))}>
                {playing && id === hero.id ? <Pause /> : <Play />}
                {playing && id === hero.id ? "Pause" : hero.position ? "Resume episode" : "Play episode"}
              </button>
            </div>
            <Art e={hero} />
          </section>
        )}
        {tab === "Podcasts" && !detail ? (
          <>
            <div className="sectionhead">
              <h2>Podcasts <em>{lib.podcasts.length}</em></h2>
              <button className="add-podcast" aria-label="Add podcast" onClick={() => show("add")}>
                <Plus size={20} /> <span>Add podcast</span>
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
                    setEpisodeQuery("");
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
                    setEpisodeQuery("");
                    setPodcastId(p.id);
                    setVisibleCount(15);
                  }}
                >
                  <Art e={p} />
                  <div>
                    <b>{p.title}</b>
                    <small>
                      {p.importPending ? <EpisodeImportStatus podcast={p} online={online} /> : <>
                        {lib.episodes.filter((e) => e.podcastId === p.id && !e.played).length} new
                        {p.error ? " · Refresh pending" : ""}
                      </>}
                    </small>
                  </div>
                  {lib.episodes.some((e) => e.podcastId === p.id && !e.played) && <i className="unread-dot" aria-label="Unread episodes" />}
                  <ChevronRight />
                </button>
                {swipedPodcast === p.id && (
                  <div className="subscription-actions">
                    <button onClick={() => run(() => deletePodcast(p.id))}><Trash2 size={17} /> Delete</button>
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
              <h2>{detail ? <button onClick={() => setPodcastId("")}><ArrowLeft size={18} /> Podcasts</button> : "Latest episodes"} {!emptyImport && <em>{eps.length}</em>}</h2>
              {detail && (
                <button
                  className="secondary"
                  onClick={() => setModal("remove")}
                >
                  Unsubscribe
                </button>
              )}
              {tab === "Episodes" && (
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
            {detail && (
              <label className="episode-search">
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search episodes in this podcast"
                  placeholder="Search episodes by title"
                  value={episodeQuery}
                  onChange={(event) => {
                    setEpisodeQuery(event.target.value);
                    setVisibleCount(15);
                  }}
                />
              </label>
            )}
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
                {emptyImport
                  ? <EpisodeImportStatus podcast={emptyImport} online={online} />
                  : !ready && !lib.podcasts.length
                  ? "Loading library…"
                  : detail && titleQuery
                    ? "No matching episode titles."
                    : !detail && filter === "Downloaded"
                      ? "Downloaded episodes will appear here."
                      : ready && !lib.podcasts.length && online
                        ? <button className="secondary" onClick={() => show("add")}><Plus size={16} /> Add your first podcast</button>
                        : "No episodes here yet."}
              </p>
            )}
          </>
        )}
      </main>
      <footer>
        {selected && (
          <div className="minibar">
            <div className="mini">
              <button className="minititle" onClick={() => setModal("player")}>
                <Art e={selected} />
                <div>
                  <div className="eyebrow">{episode ? "Now playing" : "Ready to play"}</div>
                  <b>{selected.title}</b>
                  <small>{name(selected)}</small>
                </div>
              </button>
              <div className="actions">
                <IconButton label="Playback device" click={devices}><Cast /></IconButton>
                <button className="round big" aria-label="Play or pause" onClick={() => run(toggle)}>{playing ? <Pause /> : <Play />}</button>
              </div>
            </div>
            <div className="track"><i style={{ width: Math.min(100, (pos / (selected.duration || 1)) * 100) + "%" }} /></div>
          </div>
        )}
        <nav>
          {tabs.map(([t, Icon]) => (
            <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => {
              setTab(t);
              setPodcastId("");
              setVisibleCount(15);
              window.scrollTo(0, 0);
            }}>
              <Icon size={20} />{t}
            </button>
          ))}
        </nav>
      </footer>
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
                    {deviceLabel}
                  </button>
                </div>
                {volumeControls}
                <p>{selected.description}</p>
              </div>
            )}
            {modal === "add" && (
              <>
                <label>
                  Search podcasts
                  <input autoFocus type="search" minLength={2} maxLength={100} placeholder="The Rest Is History" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
                {searching && <p className="search-status" role="status">Searching…</p>}
                {searchResults.length > 0 && (
                  <div className="podcast-results" aria-label="Search results">
                    {searchResults.map((result) => (
                      <button key={result.url} type="button" disabled={!!addingPodcastURL} onClick={() => void addPodcast(result)}>
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
                  onClick={() => run(() => deletePodcast(detail))}
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
                {speakers?.map((s) => (
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
                {remote && speakers?.some((s) => s.id === remote.speaker.id) && volumeControls}
                {speakers && <button
                  className="secondary"
                  disabled={scanning}
                  onClick={() => void loadSpeakers(true)}
                >
                  <RefreshCw size={16} />
                  {scanning ? "Scanning…" : "Scan for speakers"}
                </button>}
                {speakerError && <p role="alert">{speakerError}</p>}
                {!speakerError && !speakers && !scanning && <p>Loading speakers…</p>}
                {!speakerError && !scanning && speakers?.length === 0 && (
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
