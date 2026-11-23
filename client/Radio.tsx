import { useEffect, useState } from "react";
import { Search, Radio as RadioIcon, Play, Pause, LoaderCircle } from "lucide-react";
import type { RadioStation } from "../shared/types";
import { radioFranceOrigin, searchRadio, stations } from "../shared/radio";
import SwipeActionRow from "./SwipeActionRow";

export default function Radio({ active, connecting, play, options, hidden, restore, remove, localPlayback }: {
  active?: string;
  connecting?: string;
  play: (station: RadioStation) => void;
  options: (station: RadioStation) => void;
  hidden: RadioStation[];
  restore: (station: RadioStation) => void;
  remove: (station: RadioStation) => void;
  localPlayback: boolean;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const [result, setResult] = useState<{ term: string; stations: RadioStation[]; error?: boolean }>();
  useEffect(() => {
    if (term.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchRadio(term, AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]))
        .then(stations => { if (!controller.signal.aborted) setResult({ term, stations }); })
        .catch(() => { if (!controller.signal.aborted) setResult({ term, stations: [], error: true }); });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);
  const local = stations.filter(station => (station.name + " " + station.group).toLocaleLowerCase().includes(term));
  const remote = term.length >= 2 && result?.term === term ? result : undefined;
  const hits = [...local, ...(remote?.stations ?? []).filter(station => !local.some(builtIn =>
    station.name.toLocaleLowerCase() === builtIn.name.toLocaleLowerCase() || station.url === builtIn.url
  ))].filter(station => !hidden.some(entry => entry.id === station.id));
  return (
    <>
      {localPlayback && <link rel="preconnect" href={radioFranceOrigin} />}
      <label className="episode-search">
        <Search size={18} aria-hidden="true" />
        <input type="search" aria-label="Search radio stations" placeholder="Search stations, e.g. France Inter"
          value={query} onChange={event => setQuery(event.target.value)} maxLength={100} />
      </label>
      <div className="listing">
        {hits.map(station => (
          <SwipeActionRow key={station.id} title={station.name} options={() => options(station)}
            removeLabel="Remove station" remove={() => remove(station)}>
            <button className="radio-row" aria-busy={connecting === station.id}
              aria-label={(connecting === station.id ? "Connecting to " : active === station.id ? "Pause " : "Play ") + station.name}
              onClick={() => { if (connecting !== station.id) play(station); }}>
              <RadioIcon size={20} />
              <span><strong>{station.name}</strong><small>{connecting === station.id ? "Connecting…" : station.group}</small></span>
              {connecting === station.id ? <LoaderCircle size={19} /> : active === station.id ? <Pause size={19} /> : <Play size={19} />}
            </button>
          </SwipeActionRow>
        ))}
      </div>
      <div role="status">
        {term.length >= 2 && !remote ? <p className="empty">Searching stations…</p>
          : remote?.error ? <p className="empty">The radio directory is unavailable.</p>
          : !hits.length && term.length >= 2 ? <p className="empty">No stations found.</p> : null}
      </div>
      {!!hidden.length && (
        <details className="hidden-stations">
          <summary>Hidden stations</summary>
          {hidden.map(station => (
            <button className="secondary" key={station.id} onClick={() => restore(station)}>
              Restore {station.name}
            </button>
          ))}
        </details>
      )}
    </>
  );
}
