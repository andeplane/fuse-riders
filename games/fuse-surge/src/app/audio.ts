import type { GameAudio } from "fuse-ui/game-audio";
import type { Cue } from "../render/cues.js";

/**
 * Fuse Surge's sound: square and saw blips for the riders, a crackle of noise for a surge that lands, and arcade
 * count-ins. Everything is synthesised through the shared audio bus, so there are no files to fetch. Only the rider
 * this device plays is heard jumping and ducking; hits, falls and the round's calls are everyone's.
 */
export interface Sfx {
  /** Sounds `cue`; `local` is this device's rider slot, or −1 when it has none (then every rider is heard). */
  play(cue: Cue, local: number): void;
}

export function createSfx(audio: GameAudio): Sfx {
  const { tone, noise } = audio;
  return {
    play(cue, local) {
      const mine = (slot: number) => local < 0 || slot === local;
      switch (cue.kind) {
        case "jump":
          if (mine(cue.slot))
            tone({
              frequency: 300,
              duration: 0.11,
              type: "square",
              volume: 0.035,
              slide: 1.9,
            });
          break;
        case "duck":
          if (mine(cue.slot))
            tone({
              frequency: 240,
              duration: 0.08,
              type: "square",
              volume: 0.03,
              slide: 0.55,
            });
          break;
        case "land":
          if (mine(cue.slot))
            tone({ frequency: 95, duration: 0.07, volume: 0.05, slide: 0.7 });
          break;
        case "dodge":
          // A clean dodge chimes, a step higher for every one in the streak.
          if (cue.slot === local && cue.streak > 0)
            tone({
              frequency: 520 * 2 ** (Math.min(cue.streak, 5) / 12),
              duration: 0.06,
              type: "triangle",
              volume: 0.03,
            });
          break;
        case "recover":
          audio.jingle([523, 659, 784], 70, { type: "triangle", volume: 0.05 });
          break;
        case "hit":
          noise({ duration: 0.18, volume: 0.16, cutoff: 2600 });
          tone({
            frequency: cue.out ? 180 : 140,
            duration: cue.out ? 0.5 : 0.2,
            type: "sawtooth",
            volume: 0.09,
            slide: cue.out ? 0.25 : 0.5,
          });
          if (cue.out) audio.duck({ keep: 0.4, hold: 600 });
          break;
        case "flip":
          tone({
            frequency: 880,
            duration: 0.07,
            type: "square",
            volume: 0.03,
            slide: 0.7,
          });
          break;
        case "count":
          if (cue.seconds > 0)
            tone({
              frequency: 440,
              duration: 0.12,
              type: "square",
              volume: 0.05,
            });
          break;
        case "go":
          tone({ frequency: 880, duration: 0.3, type: "square", volume: 0.06 });
          break;
        case "tick":
          tone({
            frequency: 660,
            duration: 0.05,
            type: "square",
            volume: 0.04,
          });
          break;
        case "round":
          audio.duck({ keep: 0.3, hold: 900 });
          if (cue.reason === "last")
            audio.jingle([523, 659, 784, 1046], 90, { volume: 0.06 });
          else
            audio.jingle([659, 587, 659], 110, {
              type: "triangle",
              volume: 0.05,
            });
          break;
        case "over":
          audio.duck({ keep: 0.2, hold: 2200 });
          audio.jingle([523, 659, 784, 1046, 1318], 110, { volume: 0.06 });
          audio.jingle([392, 523, 659, 784, 1046], 110, {
            type: "triangle",
            volume: 0.05,
          });
          break;
        default:
          break;
      }
    },
  };
}
