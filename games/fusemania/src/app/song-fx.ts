import { FADE, PINGPONG, type Effect } from "../engine/index.js";

/**
 * What the two attacks on the ears do to the song this device plays. Only loudness, per ear: the song is never
 * delayed, filtered or re-timed, so the clock, the arrows and the judging are exactly as they were. Read off the same
 * picture the screen is drawn from, so every device agrees on when it starts and ends.
 */
export interface SongShape {
  /** How loud the song is, 0 to 1. */
  level: number;
  /** Where it sits between the speakers, -1 (left) to 1 (right). */
  pan: number;
}

/** A fade takes this long to go down and to come back. */
export const FADE_EASE_MS = 1500;
/** What is left of the song at the bottom of a fade: the faintest trace, not silence. */
export const FADE_FLOOR = 0.04;
/** Ping-pong eases in and out over this long. */
export const PINGPONG_EASE_MS = 400;
/** How far to each side the song is thrown: not all the way, so neither ear ever goes dead. */
export const PINGPONG_REACH = 0.85;
/** The song crosses from one ear to the other once every this many beats. */
export const PINGPONG_BEATS = 1;
/**
 * A panned song is turned down by this much at full reach: a stereo song folded into one speaker can come out
 * louder than it went in, and an attack must never be louder than the song itself.
 */
export const PINGPONG_TRIM = 0.3;

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** How much of an effect is on at `songMs`: 0 outside it, 1 in its middle, eased over `ease` at each end. */
const strength = (effect: Effect, songMs: number, ease: number): number =>
  songMs > effect[1] && songMs < effect[2]
    ? smooth(Math.min(songMs - effect[1], effect[2] - songMs) / ease)
    : 0;

/** The song as a rider under `effects` hears it at `songMs`, `beat` beats into the song. */
export function songShape(
  effects: readonly Effect[],
  songMs: number,
  beat: number,
): SongShape {
  let fade = 0,
    swing = 0;
  for (const effect of effects) {
    if (effect[0] === FADE)
      fade = Math.max(fade, strength(effect, songMs, FADE_EASE_MS));
    else if (effect[0] === PINGPONG)
      swing = Math.max(swing, strength(effect, songMs, PINGPONG_EASE_MS));
  }
  // A sine across the beat: the song is hard to one side on each beat and passes the middle between them.
  const pan =
    swing * PINGPONG_REACH * Math.cos((Math.PI * beat) / PINGPONG_BEATS);
  const level =
    (1 - (1 - FADE_FLOOR) * fade) * (1 - PINGPONG_TRIM * Math.abs(pan));
  return { level, pan: pan === 0 ? 0 : pan };
}
