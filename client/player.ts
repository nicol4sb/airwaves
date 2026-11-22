import type { Episode, Speaker, Status } from "../shared/types";
import { request, localAudioURL } from "./storage";
import { apiPath } from "./profile";
export interface Playback {
  play(e: Episode, position: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(value: number): Promise<void>;
}
export const audio = new Audio();
audio.preload = "metadata";
class Phone implements Playback {
  private objectURL = "";
  async play(e: Episode, position: number) {
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
        await this.playURL(apiPath("audio/" + e.id), position);
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
  volumeLevel?: number;
  private confirmedVolume?: number;
  private writingVolume = false;
  private volumeRevision = 0;
  private command(action: string, value = 0, ids?: string[]) {
    return request<void>("speakers/" + this.speaker.id, "POST", {
      action,
      value,
      ids,
    });
  }
  play(e: Episode, position: number) {
    return this.command("start", position, [e.id]);
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
  async setVolume(value: number) {
    this.volumeLevel = Math.max(0, Math.min(100, Math.round(value)));
    this.volumeRevision++;
    if (this.writingVolume) return;
    this.writingVolume = true;
    try {
      while (this.volumeLevel !== this.confirmedVolume) {
        const target: number = this.volumeLevel;
        await this.command("volume", target);
        this.confirmedVolume = target;
      }
    } catch (error) {
      this.volumeLevel = this.confirmedVolume;
      throw error;
    } finally {
      this.writingVolume = false;
      this.volumeRevision++;
    }
  }
  async status() {
    const revision = this.volumeRevision;
    const status = await request<Status>("speakers/" + this.speaker.id);
    if (!this.writingVolume && revision === this.volumeRevision)
      this.confirmedVolume = this.volumeLevel = status.volume;
    return status;
  }
}
