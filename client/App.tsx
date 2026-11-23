import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AudioLines,
  ListMusic,
  Bookmark,
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
  Star,
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
  setStar,
  setStationHidden,
  starredEpisodes,
  sync,
} from "./storage";
import { audio, phone, Remote } from "./player";
import Radio from "./Radio";
import SwipeActionRow from "./SwipeActionRow";
import EpisodeDetails from "./EpisodeDetails";
import { haptic, useRowActions } from "./rowActions";
import { usePlayerDismiss } from "./usePlayerDismiss";
import { lastListened, withProgress } from "./listening";
const empty: Library = { episodes: [], podcasts: [], queue: [] };
const tabs = [
  ["Podcasts", PodcastIcon],
  ["Queue", ListMusic],
  ["Saved", Bookmark],
  ["Radio", RadioIcon],
] as const;
type Tab = (typeof tabs)[number][0];
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
function EpisodeStar({ starred, click, compact = false }: {
  starred: boolean;
  click: () => void;
  compact?: boolean;
}) {
  const label = starred ? "Unstar episode" : "Star episode";
  return (
    <button
      type="button"
      className={"episode-star " + (compact ? "icon" : "secondary")}
      aria-pressed={starred}
      aria-label={label}
      title={label}
      onClick={click}
    >
      <Star size={18} fill={starred ? "currentColor" : "none"} />
      {!compact && (starred ? "Starred" : "Star")}
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
export default function App() {
  const [lib, setLib] = useState<Library>(empty),
    [tab, setTab] = useState<Tab>("Podcasts"),
    [filter, setFilter] = useState<"Starred" | "Downloaded">("Starred"),
    [detail, setPodcastId] = useState(""),
    [episodeQuery, setEpisodeQuery] = useState(""),
    [count, setVisibleCount] = useState(15);
  const [modal, setModal] = useState(""),
    [message, msg] = useState(""),
    [ready, setReady] = useState(false),
    [serverReachable, setServerReachable] = useState<boolean>(),
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
  const [starred, setStarred] = useState<Episode[]>([]);
  const starredIds = useMemo(() => new Set(starred.map(e => e.id)), [starred]);
  const [activeEpisode, setActiveEpisode] = useState<Episode>();
  const [startingStation, setStartingStation] = useState<string>();
  const [readEpisode, setReadEpisode] = useState<Episode>();
  const [actionPodcast, setActionPodcast] = useState<Podcast>();
  const [actionEpisode, setActionEpisode] = useState<Episode>();
  const [actionStation, setActionStation] = useState<RadioStation>();
  const [hiddenStations, setHiddenStations] = useState<RadioStation[]>([]);
  const rowActions = useRowActions();
  const dismissModal = useCallback(() => setModal(""), []);
  const playerDismiss = usePlayerDismiss(modal === "player", dismissModal);
  const closeModal = modal === "player" ? playerDismiss.close : dismissModal;
  const backdropPressed = useRef(false);
  const playbackAttempt = useRef(0);
  const pendingDelete = useRef(new Set<string>());
  const running = useRef(new Set<string>()),
    last = useRef(0),
    current = useRef({ id: "", pos: 0, playing: false }),
    searchRequest = useRef(0);
  const pickerOpen = modal === "devices";
  const online = serverReachable ?? navigator.onLine;
  const remoteUnavailable = !online || !!speakerError;
  const player = remoteUnavailable ? phone : remote ?? phone;
  const deviceLabel = remote && !remoteUnavailable ? remote.speaker.name : "This device";
  const episode = lib.episodes.find((e) => e.id === id)
    ?? downloaded.find((e) => e.id === id)
    ?? starred.find((e) => e.id === id)
    ?? (activeEpisode?.id === id ? activeEpisode : undefined);
  const name = (e: Episode) =>
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
      setStarred(await starredEpisodes());
      setServerReachable(true);
    } catch (e) {
      setServerReachable(false);
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
    const lost = () => setServerReachable(false);
    window.addEventListener("login-needed", login);
    const resumeSync = () => {
      if (!document.hidden) {
        setServerReachable(undefined);
        setForeground((n) => n + 1);
        wake();
      }
    };
    document.addEventListener("visibilitychange", resumeSync);
    window.addEventListener("online", resumeSync);
    window.addEventListener("offline", lost);
    run(async () => {
      const initial = (await localLibrary()) ?? empty;
      setLib(initial);
      await rememberDownloads(initial.episodes, initial.podcasts);
      await refreshDownloads();
      setStarred(await starredEpisodes());
      setHiddenStations((await get<RadioStation[]>("hidden-stations")) ?? []);
      setAutoCount((await get<number>("auto")) ?? 0);
      await refresh();
    });
    const timer = setInterval(wake, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("login-needed", login);
      document.removeEventListener("visibilitychange", resumeSync);
      window.removeEventListener("online", resumeSync);
      window.removeEventListener("offline", lost);
    };
  }, []);
  const importingEpisodes = lib.podcasts.some(p => p.importPending && !p.error);
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
  async function storePosition(key: string, value: number, ended = false, listened = value > 0 || ended) {
    if (!key || key.startsWith("radio:") || !Number.isFinite(value)) return;
    const updated = Date.now();
    const p = { id: key, position: value, updated, played: ended, listenedAt: listened ? updated : 0 };
    const apply = (e: Episode) => e.id === key ? withProgress(e, p) : e;
    setLib((l) => ({
      ...l,
      episodes: l.episodes.map(apply),
    }));
    setDownloaded(episodes => episodes.some(e => e.id === key) ? episodes.map(apply) : episodes);
    setStarred(episodes => episodes.some(e => e.id === key) ? episodes.map(apply) : episodes);
    setActiveEpisode(e => e && apply(e));
    await saveProgress(p);
  }
  async function start(e: Episode, position = e.played ? 0 : e.position) {
    const attempt = ++playbackAttempt.current;
    setStartingStation(e.station?.id);
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
          setServerReachable(false);
          await onPhone();
        }
      } else {
        await onPhone();
      }
      if (attempt !== playbackAttempt.current) return;
      setPlaying(true);
      if (!e.station) await storePosition(e.id, position, false, true);
    } catch (error) {
      if (attempt === playbackAttempt.current) throw error;
    } finally {
      if (attempt === playbackAttempt.current) setStartingStation(undefined);
    }
  }
  async function toggle() {
    if (!episode) return;
    if (remote && remoteUnavailable) return start(episode, episode.station ? 0 : pos);
    if (playing) {
      await player.pause();
      setPlaying(false);
      await storePosition(id, remote ? pos : audio.currentTime, !remote && audio.ended);
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
  function stationActions(station: RadioStation) {
    setActionStation(station);
    setModal("station-actions");
  }
  async function hideStation(station: RadioStation, hidden: boolean) {
    if (hidden) {
      haptic(24);
      dismissModal();
    }
    setHiddenStations(await setStationHidden(station, hidden));
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
            false,
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
          await storePosition(e.id, s.position, false, s.playing);
        }
      } catch (error) {
        if (alive) {
          setPlaying(false);
          if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError"))
            setServerReachable(false);
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
  async function loadSpeakers(action: "list" | "retry" | "scan" = "list") {
    if (action === "list" && readingSpeakers.current) return;
    readingSpeakers.current?.abort();
    const controller = new AbortController();
    readingSpeakers.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    const rescan = action === "scan";
    setScanning(rescan);
    if (action !== "list") setSpeakerError("");
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
        setServerReachable(true);
      }
    } catch (error) {
      if (readingSpeakers.current === controller) {
        if (error instanceof TypeError || controller.signal.aborted) setServerReachable(false);
        setSpeakers(undefined);
        setSpeakerError("Couldn’t load the speaker list from " + location.host + ". Retrying automatically.");
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
    const resume = () => {
      if (!document.hidden) void loadSpeakers("retry");
    };
    fetchList();
    window.addEventListener("offline", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", fetchList);
    document.addEventListener("visibilitychange", resume);
    const timer = window.setInterval(fetchList, 5000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("offline", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", fetchList);
      document.removeEventListener("visibilitychange", resume);
      readingSpeakers.current?.abort();
      readingSpeakers.current = null;
    };
  }, [pickerOpen]);
  function devices() {
    setSpeakers(undefined);
    setScanning(false);
    setSpeakerError("");
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
    setStarred(await starredEpisodes());
    await refreshDownloads();
    if (starredIds.has(e.id) && navigator.onLine) void refresh(true);
  }
  async function toggleStar(e: Episode) {
    const adding = !starredIds.has(e.id);
    if (adding && !starred.length) void navigator.storage?.persist?.().catch(() => {});
    await setStar({ ...e, podcastTitle: name(e) }, adding);
    setStarred(await starredEpisodes());
    if (navigator.onLine) void refresh(true);
  }
  async function markPodcastRead(podcastId: string) {
    const unread = lib.episodes.filter((e) => e.podcastId === podcastId && !e.played);
    const updated = Date.now();
    setLib((currentLib) => ({
      ...currentLib,
      episodes: currentLib.episodes.map((e) =>
        e.podcastId === podcastId && !e.played
          ? withProgress(e, { id: e.id, position: e.position, played: true, updated, listenedAt: 0 })
          : e,
      ),
    }));
    await Promise.all(unread.map((e) => saveProgress({
      id: e.id,
      position: e.position,
      played: true,
      updated,
      listenedAt: 0,
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
          !(e.position && !e.played)
        )
          await drop(id, { automatic: true });
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
  useEffect(() => {
    if (!starred.length || !navigator.onLine || document.hidden) return;
    let cancelled = false;
    run(async () => {
      const existing = new Set(await downloads());
      for (const entry of starred) {
        if (cancelled) break;
        if (existing.has(entry.id)) continue;
        const episode = lib.episodes.find(e => e.id === entry.id) ?? entry;
        await save(episode, false).catch(() => {
          // The Starred list still shows the pending download and allows a retry.
        });
      }
    });
    return () => { cancelled = true; };
  }, [starred, online, foreground]);
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
  const podcastsById = useMemo(() => new Map(lib.podcasts.map(p => [p.id, p])), [lib.podcasts]);
  const newCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of lib.episodes) {
      if (!entry.played && !entry.position && !lastListened(entry))
        counts.set(entry.podcastId, (counts.get(entry.podcastId) ?? 0) + 1);
    }
    return counts;
  }, [lib.episodes]);
  const catalog = useMemo(() => {
    const entries = new Map<string, Episode>();
    for (const entry of [...starred, ...downloaded, ...lib.episodes]) {
      const previous = entries.get(entry.id);
      const progress = previous && previous.updated > entry.updated ? previous : entry;
      entries.set(entry.id, previous
        ? withProgress(entry, {
          ...progress,
          played: !!progress.played,
          listenedAt: Math.max(lastListened(previous), lastListened(entry)),
        })
        : entry);
    }
    return entries;
  }, [starred, downloaded, lib.episodes]);
  const listening = useMemo(() => {
    const history = [...catalog.values()].filter(e => lastListened(e) > 0)
      .sort((a, b) => lastListened(b) - lastListened(a));
    const recent = new Map<string, Episode>();
    for (const e of history) if (!recent.has(e.podcastId)) recent.set(e.podcastId, e);
    return {
      unfinished: history.filter(e => !e.played),
      recent: [...recent.values()].slice(0, 10),
    };
  }, [catalog]);
  const detailPodcast = podcastsById.get(detail);
  const titleQuery = episodeQuery.trim().toLocaleLowerCase();
  const podcastEpisodes = detailPodcast
    ? lib.episodes.filter(e => e.podcastId === detail && e.title.toLocaleLowerCase().includes(titleQuery))
    : [];
  const savedEpisodes = tab === "Saved"
    ? [...catalog.values()].filter(e => filter === "Starred" ? starredIds.has(e.id) : saved.includes(e.id))
      .sort((a, b) => b.date - a.date)
    : [];
  function openPodcast(p: Podcast) {
    setEpisodeQuery("");
    setPodcastId(p.id);
    setVisibleCount(15);
    window.scrollTo(0, 0);
  }
  function closePodcast() {
    setPodcastId("");
    setVisibleCount(15);
    window.scrollTo(0, 0);
  }
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
  const starButton = (e: Episode, compact = false) => (
    <EpisodeStar compact={compact} starred={starredIds.has(e.id)} click={() => run(() => toggleStar(e))} />
  );
  const row = (e: Episode, resume = false) => (
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
          {resume ? e.position > 0 ? fmt(e.position) + " played" : "Started" : (
            <>{date(e.date)} <span>·</span> {minutes(e.duration)}{e.played ? " · Played" : ""}</>
          )}
        </small>
        {resume && e.duration > 0 && (
          <progress className="queue-progress" aria-label={"Progress for " + e.title}
            value={Math.min(e.position, e.duration)} max={e.duration} />
        )}
        {starredIds.has(e.id) && !saved.includes(e.id) && percent[e.id] === undefined && (
          <small>Download pending</small>
        )}
      </div>
      <div className="actions">
        {starButton(e, true)}
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
          aria-label={(id === e.id && playing ? "Pause " : resume ? "Resume " : "Play ") + e.title}
          onClick={() => run(() => (id === e.id ? toggle() : start(e)))}
        >
          {id === e.id && playing ? <Pause /> : <Play />}
        </button>
      </div>
    </article>
  );
  const episodeList = (episodes: Episode[], resume = false) => (
    <>
      <div className="listing">{episodes.slice(0, count).map(e => row(e, resume))}</div>
      {episodes.length > count && (
        <button className="more" onClick={() => setVisibleCount(count + 25)}>Show more episodes</button>
      )}
    </>
  );
  const podcastRow = (p: Podcast) => {
    const count = newCounts.get(p.id) ?? 0;
    return (
      <SwipeActionRow key={p.id} title={p.title} options={() => podcastActions(p)} removeLabel="Unsubscribe"
        remove={() => { setActionPodcast(p); setModal("remove"); }}>
        <button className="subscription" onClick={() => openPodcast(p)}>
          <Art e={p} />
          <div>
            <b>{p.title}</b>
            <small>{p.importPending ? <EpisodeImportStatus podcast={p} online={online} /> : <>
              {count ? count + (count === 1 ? " new episode" : " new episodes") : "Caught up"}
              {p.error ? " · Refresh pending" : ""}
            </>}</small>
          </div>
          <ChevronRight />
        </button>
      </SwipeActionRow>
    );
  };
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
            {serverReachable === true && (
              <span className="server-dot" role="img" aria-label="Connected to home server" title="Connected to home server" />
            )}
          </div>
        </div>
      </header>
      <main>
        {!online && (
          <div className="notice library-notice">
            <WifiOff size={16} /> Offline library
          </div>
        )}
        {detailPodcast ? (
          <>
            <div className="sectionhead">
              <button className="secondary" onClick={closePodcast}><ArrowLeft size={18} /> {tab}</button>
              <button className="secondary" onClick={() => podcastActions(detailPodcast)}>
                <MoreHorizontal size={18} /> Options
              </button>
            </div>
            <h1 className="podcast-title">{detailPodcast.title}</h1>
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
            {podcastEpisodes.length ? episodeList(podcastEpisodes) : (
              <p className="empty">
                {detailPodcast.importPending ? <EpisodeImportStatus podcast={detailPodcast} online={online} />
                  : titleQuery ? "No matching episode titles." : "No episodes here yet."}
              </p>
            )}
          </>
        ) : tab === "Podcasts" ? (
          <>
            <div className="sectionhead subscriptions">
              <h1>Podcasts <em>{lib.podcasts.length}</em></h1>
              <button className="add-podcast" aria-label="Add podcast" onClick={() => show("add")}>
                <Plus size={20} /> <span>Add podcast</span>
              </button>
            </div>
            {newCounts.size > 0 && (
              <section className="library-group">
                <h2>New episodes</h2>
                {lib.podcasts.filter(p => newCounts.has(p.id)).map(podcastRow)}
              </section>
            )}
            {lib.podcasts.length > newCounts.size && (
              <section className="library-group">
                <h2>{newCounts.size ? "Other podcasts" : "Your subscriptions"}</h2>
                {lib.podcasts.filter(p => !newCounts.has(p.id)).map(podcastRow)}
              </section>
            )}
            {!lib.podcasts.length && (
              <p className="empty">{ready ? "Subscribed podcasts will appear here." : "Loading library…"}</p>
            )}
          </>
        ) : tab === "Queue" ? (
          <>
            <div className="sectionhead"><h1>Queue</h1></div>
            <section className="library-group">
              <h2>Continue listening</h2>
              {listening.unfinished.length ? episodeList(listening.unfinished, true)
                : <p className="empty">Unfinished episodes will appear here.</p>}
            </section>
            <section className="library-group">
              <h2>Recently listened</h2>
              {listening.recent.length ? listening.recent.map(entry => {
                const podcast = podcastsById.get(entry.podcastId);
                const title = podcast?.title ?? name(entry);
                return (
                  <div className="subscription-swipe" key={entry.podcastId}>
                    <button className="subscription" onClick={() => podcast ? openPodcast(podcast) : openEpisode(entry)}>
                      <Art e={podcast ?? entry} />
                      <div>
                        <b>{title}</b>
                        <small>Last listened {date(lastListened(entry))}</small>
                      </div>
                      <ChevronRight />
                    </button>
                  </div>
                );
              }) : <p className="empty">Podcasts you listen to will appear here.</p>}
            </section>
          </>
        ) : tab === "Saved" ? (
          <>
            <div className="sectionhead">
              <h1>Saved</h1>
              <div className="filters">
                {(["Starred", "Downloaded"] as const).map(option => (
                  <button key={option} aria-pressed={filter === option} onClick={() => {
                    setFilter(option);
                    setVisibleCount(15);
                  }}>{option}</button>
                ))}
              </div>
            </div>
            {savedEpisodes.length ? episodeList(savedEpisodes) : (
              <p className="empty">{filter === "Starred" ? "Tap the star on an episode to save it here." : "Downloaded episodes will appear here."}</p>
            )}
          </>
        ) : (
          <>
            <div className="sectionhead"><h1>Radio</h1></div>
            <Radio
              active={playing ? episode?.station?.id : undefined}
              connecting={startingStation}
              play={playStation}
              options={stationActions}
              hidden={hiddenStations}
              localPlayback={player === phone}
              remove={station => run(() => hideStation(station, true))}
              restore={station => run(() => hideStation(station, false))}
            />
          </>
        )}
      </main>
      <footer>
        {episode && (
          <div className="minibar">
            <div className="mini">
              <button className="minititle" onClick={() => setModal("player")}>
                <Art e={episode} eager />
                <div>
                  <div className="eyebrow">Now playing</div>
                  <b>{episode.title}</b>
                  <small>{episode.station ? "Live radio" : name(episode)}</small>
                </div>
              </button>
              <div className="actions">
                <IconButton label="Playback device" click={devices}><Cast /></IconButton>
                <button className="round big" aria-label="Play or pause" onClick={() => run(toggle)}>{playing ? <Pause /> : <Play />}</button>
              </div>
            </div>
            <div className="track"><i style={{ width: Math.min(100, (pos / (episode.duration || 1)) * 100) + "%" }} /></div>
          </div>
        )}
        <nav>
          {tabs.map(([t, Icon]) => (
            <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => {
              setTab(t);
              closePodcast();
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
            if (backdropPressed.current && modal !== "login") closeModal();
            backdropPressed.current = false;
          }}
        >
          <section
            className="sheet"
            ref={modal === "player" ? playerDismiss.sheet : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={modal === "player" ? "Now playing" : modal}
            onClick={(e) => e.stopPropagation()}
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
                    "station-actions": actionStation?.name,
                    "download-actions": "Downloaded episode",
                    remove: "Unsubscribe?",
                  }[modal]
                }
              </h2>
              <IconButton label="Close" click={closeModal}>
                <X />
              </IconButton>
            </div>
            {modal === "player" && episode && (
              <div className="full">
                <Art e={episode} eager />
                <div className="eyebrow">{name(episode)}</div>
                <h2>{episode.title}</h2>
                {episode.station ? <div className="live-label">Live radio</div> : <>
                <input
                  aria-label="Playback position"
                  type="range"
                  min="0"
                  max={episode.duration || pos || 1}
                  value={pos}
                  onChange={(e) => run(() => seek(+e.target.value))}
                />
                <div className="time">
                  <span>{fmt(pos)}</span>
                  <span>{fmt(episode.duration)}</span>
                </div></>}
                <div className="controls">
                  {!episode.station && <button
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
                  {!episode.station && <button
                    aria-label="Forward 30 seconds"
                    onClick={() => run(() => seek(pos + 30))}
                  >
                    30
                    <FastForward />
                  </button>}
                </div>
                <div className="controls">
                  {!episode.station && player === phone && (
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
                  {!episode.station && starButton(episode)}
                </div>
                {volumeControls}
                <p>{episode.description}</p>
              </div>
            )}
            {modal === "episode" && readEpisode && (
              <>
                <div className="episode-sheet-title">
                  <Art e={readEpisode} eager />
                  <div><div className="eyebrow">{name(readEpisode)}</div><h3>{readEpisode.title}</h3></div>
                </div>
                <div className="episode-sheet-actions">
                  <button className="primary" onClick={() => run(() => id === readEpisode.id ? toggle() : start(readEpisode))}>
                    {id === readEpisode.id && playing ? <><Pause /> Pause</> : <><Play /> Play episode</>}
                  </button>
                  {starButton(readEpisode)}
                </div>
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
            {modal === "station-actions" && actionStation && (
              <div className="sheet-actions">
                <button className="option destructive" onClick={() => run(() => hideStation(actionStation, true))}>
                  <Trash2 /> Remove station
                </button>
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
                  }}>{starredIds.has(actionEpisode.id) ? "Unstar and delete download" : "Delete download"}</button>
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
                  onClick={() => void loadSpeakers("scan")}
                >
                  <RefreshCw size={16} />
                  {scanning ? "Scanning…" : "Scan for speakers"}
                </button>}
                {speakerError && <>
                  <p role="alert">{speakerError}</p>
                  <button className="secondary" onClick={() => void loadSpeakers("retry")}>
                    <RefreshCw size={16} /> Retry speaker list
                  </button>
                </>}
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
