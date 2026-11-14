import { CALIBRATION_MIN_TAPS, calibrate, placeLag } from "./calibration.js";
import { MAX_AUDIO_MS, MAX_OFFSET_MS, MAX_VISUAL_MS } from "./prefs.js";

/**
 * What a run on the Timing screen comes to: one line on what was measured, one on what to do, and the offsets its
 * APPLY button sets. A run is thirty seconds of taps on a steady click, by ear (the click is heard) or by eye (it
 * is silent and only the arrows are followed).
 *
 * The taps are given as they were heard, in ms from the first counted tick, with no input offset taken off: by ear
 * their centre is the whole lag between the sound and the press, which is what the input offset (or, when it is
 * too large to be a keyboard's, the audio offset) has to be. By eye the centre is compared with the lag by ear:
 * what is left is the picture's, and goes to the visual offset.
 */
export interface TimingRun {
  kind: "ear" | "eye";
  /** Every tap, ms from the first counted tick. */
  taps: readonly number[];
  /** Ms between two ticks, and how many ticks were counted. */
  beatMs: number;
  ticks: number;
}
export interface TimingOffsets {
  audioMs: number;
  inputMs: number;
  visualMs: number;
}
export interface TimingAdvice {
  /** `few` and `scattered` are no measurement; `good` needs nothing; `apply` has offsets to set. */
  verdict: "few" | "scattered" | "good" | "apply";
  measured: string;
  advice: string;
  apply?: Partial<TimingOffsets>;
  /** The taps' centre and spread, ms, and how many were used. */
  lagMs: number;
  spreadMs: number;
  used: number;
}

/** A difference smaller than this is a player's own wobble, not something to set. */
export const ADVICE_LEAST_MS = 3;

const signed = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value))}`;
const clamp = (value: number, max: number) =>
  Math.max(-max, Math.min(max, Math.round(value)));

/**
 * `offsets` are the ones the run was made with. `earLagMs` is the lag the newest by-ear run found; without one a
 * by-eye run is compared with the input offset, which is that lag once a player has applied it.
 */
export function adviseRun(
  run: TimingRun,
  offsets: TimingOffsets,
  earLagMs?: number,
): TimingAdvice {
  const result = calibrate(run.taps, run.beatMs),
    stats = {
      lagMs: result.offsetMs,
      spreadMs: result.spreadMs,
      used: result.used,
    },
    how = run.kind === "ear" ? "by ear" : "by eye",
    count = `±${result.spreadMs.toFixed(0)} ms over ${result.used} taps`;
  if (!result.ok)
    return result.used < CALIBRATION_MIN_TAPS
      ? {
          ...stats,
          verdict: "few",
          measured: `Only ${result.used} of ${run.ticks} ticks were tapped.`,
          advice: "Too few to tell. Run it again and tap on every tick.",
        }
      : {
          ...stats,
          verdict: "scattered",
          measured: `Your taps ${how} are spread ${count}.`,
          advice:
            run.kind === "ear"
              ? "Too scattered to act on. Run it again and go by the sound, not the arrows."
              : "Too scattered to act on. Run it again and hit the arrow as it fills the target.",
        };
  if (run.kind === "ear") {
    const left = Math.round(result.offsetMs - offsets.inputMs);
    if (Math.abs(left) < ADVICE_LEAST_MS)
      return {
        ...stats,
        verdict: "good",
        measured: `You tap on the tick: ${signed(left)} ms ${count}.`,
        advice:
          "Nothing to change: the input and audio offsets are right for this device.",
      };
    const placed = placeLag(result.offsetMs, offsets.audioMs, {
      input: MAX_OFFSET_MS,
      audio: MAX_AUDIO_MS,
    });
    if (
      placed.offsetMs === offsets.inputMs &&
      placed.audioMs === offsets.audioMs
    )
      return {
        ...stats,
        verdict: "good",
        measured: `Your taps land ${Math.abs(left)} ms ${left > 0 ? "late" : "early"} (${count}).`,
        advice: "The offsets are as far as they go: nothing more to set here.",
      };
    return {
      ...stats,
      verdict: "apply",
      measured: `Your taps land ${Math.abs(left)} ms ${left > 0 ? "late" : "early"} (${count}).`,
      advice:
        placed.moved === "audio"
          ? `That is too much for a keyboard: the sound arrives late here. APPLY sets the audio offset to ${signed(placed.audioMs)} ms and the input offset to ${signed(placed.offsetMs)} ms.`
          : `APPLY sets the input offset to ${signed(placed.offsetMs)} ms.`,
      apply: { inputMs: placed.offsetMs, audioMs: placed.audioMs },
    };
  }
  const late = Math.round(result.offsetMs - (earLagMs ?? offsets.inputMs)),
    visualMs = clamp(offsets.visualMs + late, MAX_VISUAL_MS);
  if (Math.abs(late) < ADVICE_LEAST_MS || visualMs === offsets.visualMs)
    return {
      ...stats,
      verdict: "good",
      measured: `By eye you tap where you tap by ear: ${signed(late)} ms ${count}.`,
      advice:
        Math.abs(late) < ADVICE_LEAST_MS
          ? "Nothing to change: the arrows are on the sound."
          : `The visual offset is as far as it goes (${signed(visualMs)} ms).`,
    };
  return {
    ...stats,
    verdict: "apply",
    measured: `By eye you tap ${Math.abs(late)} ms ${late > 0 ? "later" : "earlier"} than by ear (${count}): the arrows are ${late > 0 ? "late" : "early"}.`,
    advice: `APPLY sets the visual offset to ${signed(visualMs)} ms.`,
    apply: { visualMs },
  };
}
