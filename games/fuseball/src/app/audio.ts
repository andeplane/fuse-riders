import type { GameAudio, Song } from "fuse-ui/game-audio";
import type { Cue } from "../render/effects.js";

/**
 * Fuseball's sound: a harder neon-arena palette of square and sawtooth zaps, sharp kicks, a goal horn and a stadium
 * countdown. Effects are synthesised through the shared audio bus (no files); the songs are lazy-loaded mp3s.
 */
export interface Sfx {
  play(cue: Cue): void;
}

/** The songs, in `public/music/fuseball/`; none is fetched until the first key or touch. */
export const FUSEBALL_SONGS: readonly Song[] = [];

export function createSfx(audio: GameAudio): Sfx {
  const { tone, noise } = audio;
  return {
    play(cue) {
      switch (cue.kind) {
        case "jump":
          tone({
            frequency: cue.grounded ? 330 : 440,
            duration: 0.09,
            type: "square",
            volume: 0.04,
            slide: 1.6,
          });
          break;
        case "bubble":
          tone({ frequency: 620, duration: 0.12, volume: 0.07, slide: 1.5 });
          break;
        case "pop":
          tone({
            frequency: 900,
            duration: 0.07,
            type: "triangle",
            volume: 0.09,
            slide: 0.4,
          });
          noise({ duration: 0.08, volume: 0.08, cutoff: 3000 });
          break;
        case "harden":
          tone({
            frequency: 1250,
            duration: 0.1,
            type: "triangle",
            volume: 0.05,
            slide: 1.2,
          });
          break;
        case "bounce":
          // Quiet taps stay quiet: a rolling ball must not rattle.
          if (cue.speed >= 0.5)
            tone({
              frequency: 170 + Math.min(260, cue.speed * 70),
              duration: 0.07,
              type: "triangle",
              volume: Math.min(0.1, 0.03 + cue.speed * 0.02),
              slide: 0.7,
            });
          break;
        case "goal":
          // The horn: the song steps back and a rising riff answers the crowd's noise.
          audio.duck({ keep: 0.25, hold: cue.suddenDeath ? 1800 : 1100 });
          noise({ duration: 0.5, volume: 0.07, cutoff: 1800 });
          tone({
            frequency: 220,
            duration: 0.55,
            type: "sawtooth",
            volume: 0.05,
          });
          audio.jingle(
            cue.suddenDeath ? [523, 659, 784, 1046, 1318] : [523, 659, 784],
            90,
            { volume: 0.07, duration: 0.16 },
          );
          break;
        case "zap":
          tone({
            frequency: 1400,
            duration: 0.45,
            type: "sawtooth",
            volume: 0.07,
            slide: 0.08,
          });
          noise({ duration: 0.4, volume: 0.14, cutoff: 2200 });
          break;
        case "count":
          tone({
            frequency: 440,
            duration: 0.12,
            type: "square",
            volume: 0.06,
          });
          break;
        case "go":
          tone({ frequency: 880, duration: 0.3, type: "square", volume: 0.08 });
          tone({
            frequency: 1320,
            duration: 0.3,
            type: "square",
            volume: 0.04,
            delay: 0.02,
          });
          break;
        case "over":
          audio.duck({ keep: 0.2, hold: 2400 });
          audio.jingle([659, 784, 1046, 1318, 1568], 110, {
            volume: 0.07,
            duration: 0.16,
          });
          break;
        default:
          // A trail ring is only seen.
          break;
      }
    },
  };
}
