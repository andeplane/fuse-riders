import type { GameAudio } from "fuse-ui/game-audio";
import { MINED, isAttack, type PlayerView } from "../engine/index.js";

/**
 * Fusemania's own sounds: the song is the music, so these are only the things a player must hear over it. A power-up
 * picked up, thrown, landing on you or bouncing off a shield, and a mine going off. Each is read off two pictures of
 * the same player, so a sound follows what the screen shows; all of it goes through the shared audio bus, where the
 * header's sound button, `M` and `?mute` rule it.
 */
export type Cue = "pickup" | "throw" | "struck" | "boost" | "blocked" | "mine";

/** What happened to a player between two pictures of them, as sounds. */
export function cuesBetween(
  before: PlayerView | undefined,
  after: PlayerView,
): Cue[] {
  if (!before || before.id !== after.id) return [];
  const cues: Cue[] = [];
  if (!before.item && after.item) cues.push("pickup");
  if (before.item && !after.item) cues.push("throw");
  const known = new Set(
    before.effects.map(([kind, from, , by]) => `${kind}:${from}:${by}`),
  );
  for (const [kind, from, , by] of after.effects) {
    if (known.has(`${kind}:${from}:${by}`)) continue;
    cues.push(isAttack(kind) && by !== after.slot ? "struck" : "boost");
  }
  if (after.blocked > before.blocked) cues.push("blocked");
  if (after.counts[MINED]! > before.counts[MINED]!) cues.push("mine");
  return [...new Set(cues)];
}

export interface Sfx {
  play(cue: Cue): void;
  /** A menu choice moved. */
  blip(): void;
  /** A song is over: a little fanfare, brighter for a better grade. */
  fanfare(good: boolean): void;
}

export function createSfx(audio: GameAudio): Sfx {
  const { tone, noise, jingle } = audio;
  return {
    play(cue) {
      switch (cue) {
        case "pickup":
          jingle([988, 1319, 1976], 55, { type: "square", volume: 0.05 });
          break;
        case "throw":
          tone({
            frequency: 320,
            duration: 0.22,
            type: "sawtooth",
            volume: 0.06,
            slide: 3.2,
          });
          break;
        case "struck":
          tone({
            frequency: 660,
            duration: 0.35,
            type: "sawtooth",
            volume: 0.08,
            slide: 0.25,
          });
          noise({ duration: 0.18, volume: 0.1, cutoff: 2400 });
          break;
        case "boost":
          jingle([523, 784, 1046, 1568], 60, { volume: 0.06 });
          break;
        case "blocked":
          tone({
            frequency: 1760,
            duration: 0.18,
            type: "triangle",
            volume: 0.09,
            slide: 0.7,
          });
          tone({ frequency: 2637, duration: 0.25, volume: 0.05, delay: 0.04 });
          break;
        case "mine":
          noise({ duration: 0.3, volume: 0.22, cutoff: 700 });
          tone({
            frequency: 110,
            duration: 0.28,
            type: "square",
            volume: 0.09,
            slide: 0.4,
          });
          break;
        default:
          break;
      }
    },
    blip() {
      tone({ frequency: 1245, duration: 0.04, type: "square", volume: 0.03 });
    },
    fanfare(good) {
      jingle(good ? [523, 659, 784, 1046, 1318, 1568] : [392, 494, 587], 95, {
        volume: 0.06,
      });
    },
  };
}
