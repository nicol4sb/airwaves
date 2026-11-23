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
  podcastTitle?: string;
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
  transcript?: TranscriptSource | null;
  station?: RadioStation;
}
export interface TranscriptSource {
  url: string;
  type: string;
}
export interface RadioStation {
  id: string;
  name: string;
  url: string;
  art: string;
  group: string;
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
