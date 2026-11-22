export interface Podcast {
  id: string;
  title: string;
  url: string;
  art: string;
  error: string;
  importPending?: number;
}
export interface Episode {
  id: string;
  podcastId: string;
  title: string;
  audio: string;
  art: string;
  description: string;
  date: number;
  duration: number;
  position: number;
  played: number;
  updated: number;
  cached: string;
}
export interface Library {
  podcasts: Podcast[];
  episodes: Episode[];
  queue: string[];
}
export interface Speaker {
  id: string;
  name: string;
  system: string;
}
export interface Status {
  position: number;
  playing: boolean;
  audio: string;
  volume: number;
}
