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
    if (!offlineURL && !navigator.onLine)
      throw Error("This episode is not downloaded to this phone.");
    if (offlineURL) {
      await this.playURL(offlineURL, position);
      return;
    }

    // Prefer the Pi's cached copy when it is reachable. If the server is down
    // or away from home, stream directly from the publisher URL saved in the
    // local library.
    if (e.cached === "ready") {
      try {
        await this.playURL("/api/audio/" + e.id, position);
        return;
      } catch {
        // A failed server request can leave the media element in an error state.
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    }
    await this.playURL(e.audio, position);
  }
  private async playURL(src: string, position: number) {
    audio.src = src;
    audio.currentTime = position;
    await audio.play();
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
