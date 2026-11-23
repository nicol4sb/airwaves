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
  private attempt?: AbortController;
  async play(e: Episode, position: number, serverAvailable = true) {
    this.attempt?.abort();
    const controller = new AbortController();
    this.attempt = controller;
    const local = localAudioURL(e.id);
    if (!local && !navigator.onLine) {
      throw Error(e.station ? "Live radio needs an internet connection." : "This episode is not downloaded to this device.");
    }
    const sources = local ? [local] : [e.audio];
    if (!local && !e.station && serverAvailable && e.cached === "ready")
      sources.push(apiPath("audio/" + e.id));

    let failure: unknown;
    for (const source of sources) {
      try {
        await this.playURL(source, position, controller.signal);
        return;
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "NotAllowedError"))
          throw error;
        failure = error;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    }
    throw failure ?? Error("No audio source available");
  }
  private async playURL(src: string, position: number, signal: AbortSignal) {
    audio.src = src;
    if (position > 0) audio.currentTime = position;
    const pending = audio.play();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
    let onAbort: () => void = () => {};
    try {
      await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(deadline.reason);
          if (deadline.aborted) onAbort();
          else deadline.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      deadline.removeEventListener("abort", onAbort);
    }
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
    if (e.station)
      return request<void>("speakers/" + this.speaker.id, "POST", { action: "radio", stationId: e.station.id });
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
