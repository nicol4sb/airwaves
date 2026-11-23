import type { Episode } from "../shared/types";

export type Progress = {
  id: string;
  position: number;
  played: boolean;
  updated: number;
  listenedAt?: number;
};

export function lastListened(episode: Episode | Progress) {
  return episode.listenedAt ?? (episode.position > 0 ? episode.updated : 0);
}

export function withProgress(episode: Episode, progress: Progress): Episode {
  const position = progress.updated >= episode.updated
    ? { position: progress.position, played: +progress.played, updated: progress.updated }
    : {};
  return { ...episode, ...position, listenedAt: Math.max(lastListened(episode), lastListened(progress)) };
}
