import type { Episode, Speaker, Status } from "../shared/types";
import { request, localAudioURL } from "./storage";
export interface Playback {
  play(e: Episode, queue: string[], position: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(value: number): Promise<void>;
}
export const audio = new Audio();
audio.preload = "metadata";
class Phone implements Playback {
  private objectURL = "";
  async play(e: Episode, _queue: string[], position: number) {
    if (this.objectURL) URL.revokeObjectURL(this.objectURL);
    this.objectURL = "";
    const offlineURL = localAudioURL(e.id);
    const src = offlineURL ?? (
      e.cached === "ready" ||
      (location.protocol === "https:" && e.audio.startsWith("http:"))
        ? "/api/audio/" + e.id
        : e.audio
    );
    if (!offlineURL && !navigator.onLine)
      throw Error("This episode is not downloaded to this phone.");
    audio.src = src;
    audio.currentTime = position;
    const playback = audio.play();
    await playback;
  }
  async pause() {
    audio.pause();
  }
  async resume() {
    await audio.play();
  }
  async seek(value: number) {
    audio.currentTime = value;
  }
}
export const phone = new Phone();
export class Remote implements Playback {
  constructor(public speaker: Speaker) {}
  private command(action: string, value = 0, ids?: string[]) {
    return request<void>("speakers/" + this.speaker.id, "POST", {
      action,
      value,
      ids,
    });
  }
  play(e: Episode, queue: string[], position: number) {
    return this.command("start", position, [
      e.id,
      ...queue.filter((id) => id !== e.id),
    ]);
  }
  pause() {
    return this.command("pause");
  }
  resume() {
    return this.command("resume");
  }
  seek(value: number) {
    return this.command("seek", value);
  }
  volume(value: number) {
    return this.command("volume", value);
  }
  status() {
    return request<Status>("speakers/" + this.speaker.id);
  }
}
