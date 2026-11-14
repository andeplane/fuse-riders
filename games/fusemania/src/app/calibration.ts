/**
 * Tap calibration: the screen plays a click every beat, the player taps along by ear, and the taps say how far
 * this player on this device lands from the sound. The offset is subtracted from later presses before judging.
 */

/** Taps further than this share of a beat from every click are not attempts at one. */
export const CALIBRATION_REACH = 0.4;
/** Taps used before the result is trusted. */
export const CALIBRATION_MIN_TAPS = 8;
/** The spread in ms under which the taps count as consistent. */
export const CALIBRATION_MAX_SPREAD_MS = 40;
/** Outliers are cut at three spreads; this floor keeps a very steady player's ordinary taps from being cut. */
const LEAST_SPREAD_MS = 5;

export interface Calibration {
  /** Median signed error in ms: positive = the player taps late. */
  offsetMs: number;
  /** Spread (median absolute deviation) in ms: small means consistent. */
  spreadMs: number;
  /** Taps used after dropping outliers. */
  used: number;
  /** Enough consistent taps to trust it (at least 8 used, spread under 40 ms). */
  ok: boolean;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
const spread = (values: readonly number[], centre: number) =>
  median(values.map((value) => Math.abs(value - centre)));

/**
 * Taps (song ms, already converted with the song clock) against a click every `beatMs` starting at 0. Each tap is
 * compared with its nearest click; taps before the first click's reach, taps further than `CALIBRATION_REACH` of
 * a beat from any click and outliers beyond three spreads are dropped.
 */
export function calibrate(
  taps: readonly number[],
  beatMs: number,
): Calibration {
  const none: Calibration = { offsetMs: 0, spreadMs: 0, used: 0, ok: false };
  if (!Number.isFinite(beatMs) || beatMs <= 0) return none;
  const errors: number[] = [];
  for (const tap of taps) {
    if (!Number.isFinite(tap)) continue;
    const beat = Math.round(tap / beatMs),
      error = tap - beat * beatMs;
    if (beat >= 0 && Math.abs(error) <= CALIBRATION_REACH * beatMs)
      errors.push(error);
  }
  if (errors.length === 0) return none;
  const centre = median(errors),
    cut = 3 * Math.max(LEAST_SPREAD_MS, spread(errors, centre)),
    kept = errors.filter((error) => Math.abs(error - centre) <= cut),
    offsetMs = median(kept),
    spreadMs = spread(kept, offsetMs);
  return {
    offsetMs,
    spreadMs,
    used: kept.length,
    ok:
      kept.length >= CALIBRATION_MIN_TAPS &&
      spreadMs < CALIBRATION_MAX_SPREAD_MS,
  };
}

/** A measured lag this large is not a keyboard's or a player's: it is sound that arrives late (or early). */
export const AUDIO_SHARE_MS = 80;

/**
 * Where a measured lag goes. `totalMs` is what the presses were late by with the audio offset `audioMs` in use
 * (so it is the input offset that would centre them). A small one is the input offset. A large one is the sound's:
 * it is added to the audio offset, so the arrows move with the judging, and the input offset starts from zero;
 * what the audio offset cannot take stays with the input offset.
 */
export function placeLag(
  totalMs: number,
  audioMs: number,
  limits: { input: number; audio: number },
): { offsetMs: number; audioMs: number; moved: "input" | "audio" } {
  const clamp = (value: number, max: number) =>
    Math.max(-max, Math.min(max, Math.round(value)));
  if (!Number.isFinite(totalMs))
    return {
      offsetMs: 0,
      audioMs: clamp(audioMs, limits.audio),
      moved: "input",
    };
  if (Math.abs(totalMs) < AUDIO_SHARE_MS)
    return {
      offsetMs: clamp(totalMs, limits.input),
      audioMs: clamp(audioMs, limits.audio),
      moved: "input",
    };
  const audio = clamp(audioMs + totalMs, limits.audio);
  return {
    offsetMs: clamp(audioMs + totalMs - audio, limits.input),
    audioMs: audio,
    moved: "audio",
  };
}
