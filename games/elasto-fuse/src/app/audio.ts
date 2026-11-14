import type { GameAudio } from "fuse-ui/game-audio";
import type { Cue } from "../render/cues.js";

/**
 * Elasto Fuse's sound: little synthesized cues for what the scene says happened since the last frame
 * (`Scene.draw`'s cues), and an engine hum that follows the gas and the driven wheel. All of it goes through the
 * shared audio bus, so the header's sound button, `M` and `?mute` rule it; no effect is a file.
 */
export interface Sfx {
  play(cue: Cue): void;
  /**
   * The engine now: `rev` is how fast the driven wheel turns (0 to 1), `gas` whether the throttle is open; `running`
   * false (no bike of this device's on the track) lets it fall silent.
   */
  engine(rev: number, gas: boolean, running: boolean): void;
}

export { ALL_SONGS as ELASTO_SONGS } from "fuse-ui/music";

/** The hum's pitch in Hz for a wheel speed and throttle: idle, up through the revs, a little more under load. */
export const humPitch = (rev: number, gas: boolean): number =>
  52 + Math.max(0, Math.min(1, rev)) * 118 + (gas ? 14 : 0);
/** The hum's volume, 0 when the engine is not `running`. */
export const humVolume = (
  rev: number,
  gas: boolean,
  running: boolean,
): number =>
  running
    ? 0.012 + (gas ? 0.022 : 0) + Math.max(0, Math.min(1, rev)) * 0.014
    : 0;

export function createSfx(audio: GameAudio): Sfx {
  const { tone, noise, jingle } = audio;
  // A saw and the octave under it through a low-pass: a small two-stroke, not a buzzer.
  const hum = audio.hum({ type: "sawtooth", sub: "square", cutoff: 520 });
  return {
    engine(rev, gas, running) {
      hum.set(humPitch(rev, gas), humVolume(rev, gas, running));
    },
    play(cue) {
      switch (cue.kind) {
        case "apple":
          tone({
            frequency: 880,
            duration: 0.09,
            type: "triangle",
            volume: 0.07,
            slide: 1.5,
          });
          tone({
            frequency: 1320,
            duration: 0.12,
            volume: 0.05,
            slide: 1.2,
            delay: 0.07,
          });
          break;
        case "crash":
          noise({ duration: 0.35, volume: 0.2, cutoff: 900 });
          tone({
            frequency: 140,
            duration: 0.3,
            type: "sawtooth",
            volume: 0.08,
            slide: 0.3,
          });
          audio.duck({ keep: 0.4, hold: 500 });
          break;
        case "finish":
          jingle([523, 659, 784, 1046, 1318], 100, { volume: 0.06 });
          audio.duck({ keep: 0.5, hold: 700 });
          break;
        case "count":
          tone({
            frequency: 440,
            duration: 0.12,
            type: "square",
            volume: 0.045,
          });
          break;
        case "go":
          tone({ frequency: 880, duration: 0.3, type: "square", volume: 0.05 });
          break;
        default:
          break;
      }
    },
  };
}
