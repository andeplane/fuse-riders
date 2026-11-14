import type { GameAudio } from "fuse-ui/game-audio";
import type { Cue } from "../render/cues.js";

/**
 * Fuse Volley's sound: a warm beach palette of marimba-ish sine and triangle plucks, wet jelly thumps and a lifeguard
 * whistle. Effects are synthesised through the shared audio bus (no files); the songs are lazy-loaded mp3s.
 */
export interface Sfx {
  play(cue: Cue): void;
}

export { ALL_SONGS as VOLLEY_SONGS } from "fuse-ui/music";

export function createSfx(audio: GameAudio): Sfx {
  const { tone, noise } = audio;
  return {
    play(cue) {
      switch (cue.kind) {
        case "hit": {
          // A jelly "bum": a low thump that rises with the hit, plus a wet blip and a marimba note on top.
          const strength = Math.min(1, cue.speed / 8);
          tone({
            frequency: 110 + strength * 70,
            duration: 0.16,
            volume: 0.22,
            slide: 0.55,
          });
          tone({
            frequency: 320 + strength * 180 + cue.touches * 40,
            duration: 0.07,
            type: "triangle",
            volume: 0.06,
            slide: 1.8,
          });
          // Each touch on a side climbs a scale step: the rally sings.
          tone({
            frequency: [523, 587, 659][Math.min(2, cue.touches)] ?? 523,
            duration: 0.22,
            type: "sine",
            volume: 0.04 + strength * 0.03,
            delay: 0.02,
          });
          break;
        }
        case "net":
          tone({
            frequency: 1200,
            duration: 0.08,
            type: "triangle",
            volume: 0.05,
            slide: 0.6,
          });
          noise({ duration: 0.05, volume: 0.05, cutoff: 4000 });
          break;
        case "floor":
          if (cue.speed >= 1.5)
            noise({
              duration: 0.12,
              volume: Math.min(0.16, cue.speed * 0.02),
              cutoff: 700,
            });
          break;
        case "land":
          tone({ frequency: 90, duration: 0.08, volume: 0.06, slide: 0.7 });
          break;
        case "jump":
          tone({ frequency: 260, duration: 0.1, volume: 0.035, slide: 1.9 });
          break;
        case "point":
          // The whistle: two quick tones, and the song steps back.
          audio.duck({ keep: 0.3, hold: 900 });
          tone({
            frequency: 2100,
            duration: 0.12,
            type: "square",
            volume: 0.035,
          });
          tone({
            frequency: 2400,
            duration: 0.2,
            type: "square",
            volume: 0.035,
            delay: 0.13,
          });
          if (cue.matchPoint >= 0)
            audio.jingle([392, 523, 659], 90, {
              type: "triangle",
              volume: 0.05,
            });
          break;
        case "serve":
          tone({ frequency: 660, duration: 0.08, volume: 0.04, slide: 1.2 });
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
