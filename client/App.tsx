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
  MoreHorizontal,
  Radio as RadioIcon,
} from "lucide-react";
import type { Library, Episode, Speaker, Podcast, RadioStation } from "../shared/types";
import {
  automaticIds,
  download,
  downloads,
  drop,
  get,
  localLibrary,
  downloadedEpisodes,
  rememberDownloads,
  put,
  request,
  saveProgress,
  sync,
} from "./storage";
import { audio, phone, Remote } from "./player";
import Radio from "./Radio";
import EpisodeDetails from "./EpisodeDetails";
import { haptic, useRowActions } from "./rowActions";
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
function Art({ e, eager = false }: { e: { art: string; title: string }; eager?: boolean }) {
  return (
    <span className="art">
      <Disc3 />
      {e.art && (
        <img
          key={e.art}
          src={e.art}
          alt=""
          loading={eager ? "eager" : "lazy"}
          onError={(event) => {
            const image = event.currentTarget;
            image.hidden = true;
            navigator.serviceWorker?.controller?.postMessage({ failedArtwork: image.src });
          }}
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
  const [downloaded, setDownloaded] = useState<Episode[]>([]);
  const [activeEpisode, setActiveEpisode] = useState<Episode>();
  const [readEpisode, setReadEpisode] = useState<Episode>();
  const [actionPodcast, setActionPodcast] = useState<Podcast>();
  const [actionEpisode, setActionEpisode] = useState<Episode>();
  const rowActions = useRowActions();
  const dismissGesture = useRef<{ x: number; y: number } | null>(null);
  const backdropPressed = useRef(false);
  const playbackAttempt = useRef(0);
  const pendingDelete = useRef(new Set<string>());
  const running = useRef(new Set<string>()),
    last = useRef(0),
    current = useRef({ id: "", pos: 0, playing: false }),
    searchRequest = useRef(0);
  const pickerOpen = modal === "devices";
  const remoteUnavailable = !online || !!speakerError;
  const player = remoteUnavailable ? phone : remote ?? phone;
  const deviceLabel = remote && !remoteUnavailable ? remote.speaker.name : "This device";
  const episode = lib.episodes.find((e) => e.id === id)
    ?? downloaded.find((e) => e.id === id)
    ?? (activeEpisode?.id === id ? activeEpisode : undefined),
    recent = [...lib.episodes]
      .filter((e) => e.position > 0 && !e.played)
      .sort((a, b) => b.updated - a.updated);
  const hero = recent[0] ?? lib.episodes[0],
    selected = episode ?? hero,
    name = (e: Episode) =>
      e.station?.group || lib.podcasts.find((p) => p.id === e.podcastId)?.title || e.podcastTitle || "Podcast";
  const report = (e: unknown) =>
    msg(e instanceof Error ? e.message : String(e));
  const run = (fn: () => Promise<unknown>) => {
    void fn().catch(report);
  };
  async function refreshDownloads() {
    const ids = await downloads();
    setSaved(ids);
    setDownloaded(await downloadedEpisodes(ids));
  }
  async function refresh(afterMutation = false) {
    try {
      const fresh = await sync(afterMutation);
      const removed = pendingDelete.current;
      setLib(removed.size ? {
        ...fresh,
        podcasts: fresh.podcasts.filter(podcast => !removed.has(podcast.id)),
        episodes: fresh.episodes.filter(episode => !removed.has(episode.podcastId)),
      } : fresh);
      await refreshDownloads();
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
      const initial = (await localLibrary()) ?? empty;
      setLib(initial);
      await rememberDownloads(initial.episodes, initial.podcasts);
      await refreshDownloads();
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
    if (!key || key.startsWith("radio:") || !Number.isFinite(value)) return;
    const p = { id: key, position: value, updated: Date.now(), played: ended };
    setLib((l) => ({
      ...l,
      episodes: l.episodes.map((e) =>
        e.id === key ? { ...e, ...p, played: +ended } : e,
      ),
    }));
    setDownloaded(episodes => episodes.map(e => e.id === key ? { ...e, ...p, played: +ended } : e));
    await saveProgress(p);
  }
  async function start(e: Episode, position = e.played ? 0 : e.position) {
    const attempt = ++playbackAttempt.current;
    if (current.current.id && current.current.id !== e.id && (remote || !audio.ended))
      void storePosition(current.current.id, current.current.pos).catch(report);
    current.current = { id: e.id, pos: position, playing: false };
    setActiveEpisode(e);
    setEpisodeId(e.id);
    setPosition(position);
    setPlaying(false);
    async function onPhone() {
      if (remote) {
        volumeTarget.current = null;
        setRemote(null);
      }
      await phone.play(e, position, online);
      if (attempt === playbackAttempt.current) audio.playbackRate = e.station ? 1 : speed;
    }
    try {
      if (remote && !remoteUnavailable) {
        try {
          await remote.play(e, position);
        } catch (error) {
          if (attempt !== playbackAttempt.current) return;
          if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === "TimeoutError")) throw error;
          setOnline(false);
          await onPhone();
        }
      } else {
        await onPhone();
      }
      if (attempt !== playbackAttempt.current) return;
      setPlaying(true);
    } catch (error) {
      if (attempt === playbackAttempt.current) throw error;
    }
  }
  async function toggle() {
    if (!episode && selected) return start(selected);
    if (!episode) return;
    if (remote && remoteUnavailable) return start(episode, episode.station ? 0 : pos);
    if (playing) {
      await player.pause();
      setPlaying(false);
      await storePosition(id, pos);
    } else if (remote || audio.getAttribute("src")) {
      await player.resume();
      setPlaying(true);
    } else await start(episode);
  }
  function playStation(station: RadioStation) {
    const key = "radio:" + station.id;
    if (id === key) return run(toggle);
    run(() => start({
      id: key, station, podcastId: "", title: station.name, audio: station.url,
      art: station.art, description: "", date: 0, duration: 0, position: 0,
      played: 0, updated: 0, cached: "none",
    }));
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
      if (current.current.id.startsWith("radio:")) return;
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
    if (episode.station) {
      delete actions.seekbackward;
      delete actions.seekforward;
      delete actions.seekto;
    }
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
        if (!current.current.id || current.current.id.startsWith("radio:")) return;
        const e = lib.episodes.find((e) => e.audio === s.audio);
        if (e) {
          if (current.current.id && current.current.id !== e.id) {
            await storePosition(current.current.id, current.current.pos, true);
          }
          setEpisodeId(e.id);
          await storePosition(e.id, s.position);
        }
      } catch (error) {
        if (alive) {
          setPlaying(false);
          if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"))
            setOnline(false);
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
    if (s && s.id === remote?.speaker.id && !remoteUnavailable) {
      setModal("");
      return;
    }
    const target = s ? new Remote(s) : null;
    if (episode && playing) {
      const offset = episode.station ? 0 : remote ? pos : audio.currentTime;
      if (target) {
        await target.play(episode, offset);
        if (player !== target) await player.pause().catch(report);
      } else {
        const local = phone.play(episode, offset, online);
        if (remote && !remoteUnavailable) void remote.pause().catch(report);
        await local;
        audio.playbackRate = episode.station ? 1 : speed;
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
        { ...e, podcastTitle: name(e) },
        (n) => setDownloadProgress((p) => ({ ...p, [e.id]: n })),
        manual,
        online,
      );
      await refreshDownloads();
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
    haptic(24);
    await drop(e.id);
    await put("skip:" + e.id, true);
    await refreshDownloads();
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
    if (pendingDelete.current.has(podcastId)) return;
    pendingDelete.current.add(podcastId);
    haptic(24);
    const previous = lib;
    const next = {
      ...lib,
      podcasts: lib.podcasts.filter((p) => p.id !== podcastId),
      episodes: lib.episodes.filter((e) => e.podcastId !== podcastId),
    };
    setLib(next);
    setPodcastId("");
    setModal("");
    try {
      await rememberDownloads(previous.episodes.filter(e => e.podcastId === podcastId), previous.podcasts);
      await put("library", next);
      await request("podcasts/" + podcastId, "DELETE");
      await refresh(true);
    } catch (error) {
      setLib(previous);
      await put("library", previous);
      report(error);
    } finally {
      pendingDelete.current.delete(podcastId);
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
        if (stop) return;
        if (
          e && !pendingDelete.current.has(e.podcastId) && !wanted.includes(id) &&
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
      if (!stop) await refreshDownloads();
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
    ["Radio", RadioIcon],
  ] as const;
  const detailPodcast = lib.podcasts.find((p) => p.id === detail);
  const titleQuery = episodeQuery.trim().toLocaleLowerCase();
  const eps = useMemo(() => {
    if (!detail && filter === "Downloaded") {
      const episodes = new Map(downloaded.map(e => [e.id, e]));
      for (const e of lib.episodes) if (saved.includes(e.id)) episodes.set(e.id, e);
      return [...episodes.values()].sort((a, b) => b.date - a.date);
    }
    return lib.episodes.filter((e) => {
      if (detail) return e.podcastId === detail && e.title.toLocaleLowerCase().includes(titleQuery);
      return filter !== "Unplayed" || !e.played;
    });
  }, [lib.episodes, detail, titleQuery, filter, saved, downloaded]);
  const emptyImport = detailPodcast?.importPending ? detailPodcast
    : tab === "Episodes" && filter !== "Downloaded" && !eps.length ? importingPodcast : undefined;
  function openEpisode(e: Episode) {
    setReadEpisode(e);
    setModal("episode");
  }
  function downloadActions(e: Episode) {
    setActionEpisode(e);
    setModal("download-actions");
  }
  function podcastActions(p: Podcast) {
    setActionPodcast(p);
    setModal("podcast-actions");
  }
  const row = (e: Episode) => (
    <article className="row" key={e.id}
      {...(saved.includes(e.id) ? rowActions(e.id, () => downloadActions(e)) : {})}>
      <button
        className="artplay"
        aria-label={"Details for " + e.title}
        onClick={() => openEpisode(e)}
      >
        <Art e={e} />
      </button>
      <div className="rowcopy">
        {!detail && <div className="eyebrow">{name(e)}</div>}
        <button className="rowtitle" onClick={() => openEpisode(e)}>
          {e.title}
        </button>
        <small>
          {date(e.date)} <span>·</span> {minutes(e.duration)}{" "}
          {e.played ? " · Played" : ""}
        </small>
      </div>
      <div className="actions">
        {percent[e.id] !== undefined ? (
          <span className="icon download-progress" role="status" aria-label="Downloading">
            {percent[e.id] ? <small>{percent[e.id]}%</small> : <LoaderCircle size={18} />}
          </span>
        ) : <IconButton
          label={saved.includes(e.id) ? "Manage download" : "Download episode"}
          click={() => saved.includes(e.id) ? downloadActions(e) : run(() => save(e))}
        >
          {saved.includes(e.id) ? <Check /> : <Download />}
        </IconButton>}
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
        {!detail && <div className="pagehead">
          <div className="over"><span className="tinyline" /> {profileLabel.toUpperCase()}’S LIBRARY</div>
          <h1>{tab}</h1>
        </div>}
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
        {tab === "Radio" ? <Radio active={playing ? episode?.station?.id : undefined} play={playStation} /> : tab === "Podcasts" && !detail ? (
          <>
            <div className="sectionhead">
              <h2>Podcasts <em>{lib.podcasts.length}</em></h2>
              <button className="add-podcast" aria-label="Add podcast" onClick={() => show("add")}>
                <Plus size={20} /> <span>Add podcast</span>
              </button>
            </div>
            {lib.podcasts.map((p) => (
              <div className="subscription-swipe" key={p.id} {...rowActions(p.id, () => podcastActions(p))}>
                <button className="subscription" onClick={() => {
                  setEpisodeQuery("");
                  setPodcastId(p.id);
                  setVisibleCount(15);
                  window.scrollTo(0, 0);
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
                <button className="row-menu" aria-label={"Options for " + p.title} onClick={() => podcastActions(p)}>
                  <MoreHorizontal size={20} />
                </button>
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
                  onClick={() => detailPodcast && podcastActions(detailPodcast)}
                >
                  <MoreHorizontal size={18} /> Options
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
                <Art e={selected} eager />
                <div>
                  <div className="eyebrow">{episode ? "Now playing" : "Ready to play"}</div>
                  <b>{selected.title}</b>
                  <small>{selected.station ? "Live radio" : name(selected)}</small>
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
          onPointerDown={(event) => { backdropPressed.current = event.target === event.currentTarget; }}
          onPointerCancel={() => { backdropPressed.current = false; }}
          onClick={() => {
            if (backdropPressed.current && modal !== "login") setModal("");
            backdropPressed.current = false;
          }}
        >
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "player" ? "Now playing" : modal}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(event) => {
              dismissGesture.current = null;
              if (modal !== "player" || event.touches.length !== 1 || event.currentTarget.scrollTop > 0
                || (event.target as Element).closest("input, select, button")) return;
              const touch = event.touches[0];
              dismissGesture.current = { x: touch.clientX, y: touch.clientY };
            }}
            onTouchCancel={() => { dismissGesture.current = null; }}
            onTouchEnd={(event) => {
              const start = dismissGesture.current;
              dismissGesture.current = null;
              const touch = event.changedTouches[0];
              if (modal === "player" && start && touch && touch.clientY - start.y > 72
                && Math.abs(touch.clientX - start.x) < 55) setModal("");
            }}
          >
            {modal === "player" && <div className="player-grabber" aria-hidden="true" />}
            <div className="sheethead">
              <h2>
                {
                  {
                    player: "Now playing",
                    settings: "Library settings",
                    devices: "Playback device",
                    login: "Sign in",
                    add: "Add podcast",
                    episode: "Episode details",
                    "podcast-actions": actionPodcast?.title,
                    "download-actions": "Downloaded episode",
                    remove: "Unsubscribe?",
                  }[modal]
                }
              </h2>
              <IconButton label="Close" click={() => setModal("")}>
                <X />
              </IconButton>
            </div>
            {modal === "player" && selected && (
              <div className="full">
                <Art e={selected} eager />
                <div className="eyebrow">{name(selected)}</div>
                <h2>{selected.title}</h2>
                {selected.station ? <div className="live-label">Live radio</div> : <>
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
                </div></>}
                <div className="controls">
                  {!selected.station && <button
                    aria-label="Back 15 seconds"
                    onClick={() => run(() => seek(pos - 15))}
                  >
                    <Rewind />
                    15
                  </button>}
                  <button
                    className="round big"
                    onClick={() => run(toggle)}
                    aria-label="Play or pause"
                  >
                    {playing ? <Pause /> : <Play />}
                  </button>
                  {!selected.station && <button
                    aria-label="Forward 30 seconds"
                    onClick={() => run(() => seek(pos + 30))}
                  >
                    30
                    <FastForward />
                  </button>}
                </div>
                <div className="controls">
                  {!selected.station && player === phone && (
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
            {modal === "episode" && readEpisode && (
              <>
                <div className="episode-sheet-title">
                  <Art e={readEpisode} eager />
                  <div><div className="eyebrow">{name(readEpisode)}</div><h3>{readEpisode.title}</h3></div>
                </div>
                <button className="primary" onClick={() => run(() => id === readEpisode.id ? toggle() : start(readEpisode))}>
                  {id === readEpisode.id && playing ? <><Pause /> Pause</> : <><Play /> Play episode</>}
                </button>
                <EpisodeDetails key={readEpisode.id} episode={readEpisode} />
              </>
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
            {modal === "podcast-actions" && actionPodcast && (
              <div className="sheet-actions">
                <button className="option" onClick={() => {
                  setModal("");
                  run(() => markPodcastRead(actionPodcast.id));
                }}><Check /> Mark all as played</button>
                <button className="option destructive" onClick={() => setModal("remove")}><Trash2 /> Unsubscribe</button>
              </div>
            )}
            {modal === "remove" && actionPodcast && (
              <>
                <p className="sheet-copy">Stop following <strong>{actionPodcast.title}</strong>? Saved episodes stay in Downloads.</p>
                <div className="confirm-actions">
                  <button className="secondary" onClick={() => setModal("")}>Cancel</button>
                  <button className="destructive confirm-delete" onClick={() => run(() => deletePodcast(actionPodcast.id))}>Unsubscribe</button>
                </div>
              </>
            )}
            {modal === "download-actions" && actionEpisode && (
              <>
                <p className="sheet-copy">{actionEpisode.title}</p>
                <div className="confirm-actions">
                  <button className="secondary" onClick={() => setModal("")}>Cancel</button>
                  <button className="destructive confirm-delete" onClick={() => {
                    setModal("");
                    run(() => removeDownload(actionEpisode));
                  }}>Delete download</button>
                </div>
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
