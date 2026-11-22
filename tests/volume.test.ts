import { it, expect, vi } from "vitest";
import { request } from "../client/storage";
vi.mock("../client/storage", () => ({ request: vi.fn() }));

it("coalesces volume changes and ignores a status response from before the change", async () => {
  vi.stubGlobal("Audio", class {});
  try {
    const { Remote } = await import("../client/player");
    const room = new Remote({ id: "room", name: "Studio", system: "" });
    const api = vi.mocked(request);
    api.mockResolvedValueOnce({ volume: 20 });
    await room.status();
    let finishStatus!: (value: unknown) => void;
    let finishWrite!: (value: unknown) => void;
    api.mockImplementationOnce(() => new Promise(resolve => { finishStatus = resolve; }));
    const poll = room.status();
    api.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
    const write = room.setVolume(25);
    await room.setVolume(30);
    await room.setVolume(35);
    expect(room.volumeLevel).toBe(35);
    api.mockResolvedValueOnce({ ok: true });
    finishWrite({ ok: true });
    await write;
    finishStatus({ volume: 20 });
    await poll;
    expect(room.volumeLevel).toBe(35);
    expect(api.mock.calls.filter(call => call[1] === "POST").map(call => call[2])).toEqual([
      { action: "volume", value: 25 }, { action: "volume", value: 35 },
    ]);
    api.mockRejectedValueOnce(Error("Speaker offline"));
    await expect(room.setVolume(40)).rejects.toThrow("Speaker offline");
    expect(room.volumeLevel).toBe(35);
  } finally {
    vi.unstubAllGlobals();
  }
});
