import {
  isSystemSoundEvent,
  SOUND_EVENTS,
  soundEventInfo,
  SYSTEM_SOUND_EVENTS,
} from "./soundEvents";
import { loadSynth } from "./synth";

describe("SOUND_EVENTS", () => {
  it("lists every event once, with a label, a trigger and a sensible gain", () => {
    expect(SYSTEM_SOUND_EVENTS).toEqual([
      "startup",
      "shutdown",
      "ding",
      "error",
      "recycle",
      "floppy",
      "modem",
    ]);
    expect(new Set(SYSTEM_SOUND_EVENTS).size).toBe(SOUND_EVENTS.length);
    for (const info of SOUND_EVENTS) {
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.trigger.length).toBeGreaterThan(0);
      expect(info.gain).toBeGreaterThan(0);
      expect(info.gain).toBeLessThanOrEqual(1);
    }
    expect(
      SOUND_EVENTS.filter((info) => info.deferUntilUnlocked).map(
        (info) => info.event,
      ),
    ).toEqual(["startup"]);
  });

  it("guards and looks up events", () => {
    expect(isSystemSoundEvent("modem")).toBe(true);
    expect(isSystemSoundEvent("tada")).toBe(false);
    expect(isSystemSoundEvent(3)).toBe(false);
    expect(soundEventInfo("floppy").label).toBe("Floppy drive");
    expect(() => soundEventInfo("tada" as "ding")).toThrow(
      "Unknown system sound: tada",
    );
  });

  it("has a lazily loaded synthesiser for every event", async () => {
    for (const event of SYSTEM_SOUND_EVENTS) {
      const render = await loadSynth(event);
      const samples = render(4000);
      expect(samples.length).toBeGreaterThan(1000);
      expect(samples.some((value) => Math.abs(value) > 0.1)).toBe(true);
    }
  });
});
