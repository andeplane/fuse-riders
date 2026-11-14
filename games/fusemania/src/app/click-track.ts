import { WINDOWS } from "../engine/index.js";

/**
 * The Timing screen's click: nothing but a tick, dead steady. A real song hides its beat in a mix and its chart was
 * placed by an analysis; here the sound is made from the same numbers the ticks are counted with, so a tick's first
 * sample is exactly on its time and any error left is the device's or the player's. The tick is a short high ping
 * (`CLICK_HZ`) with nothing under it, so a microphone can tell it from a key being pressed.
 *
 * It is not a song: it has no chart and no end, the library does not know it and the engine never sees it. The
 * page plays one short lap of ticks over and over on the audio clock (`tick-loop.ts`).
 */

/** Ticks a minute: 2, 2.5 and 3 a second. */
export const CLICK_RATES = [120, 150, 180] as const;
export const DEFAULT_CLICK_RATE = 150;
/** The rate named `bpm`, or undefined when it is not one of them. */
export const clickRateOf = (bpm: number): number | undefined =>
  CLICK_RATES.find((rate) => rate === bpm);
/** The tick: a decaying ping at this pitch, this long. */
export const CLICK_HZ = 6000;
export const CLICK_S = 0.03;
const CLICK_DECAY_S = 0.004;
/** The ping swells over this long, so its start does not splash across every pitch. */
const CLICK_ATTACK_S = 0.00025;
const CLICK_LEVEL = 0.85;
/** Ticks in the lap that is played over and over. */
export const LAP_TICKS = 16;
export const CLICK_SAMPLE_RATE = 48000;

/** Seconds between two ticks. */
export const beatS = (bpm: number): number => 60 / bpm;
/** The tick nearest to `ms` (counted from tick 0), and how far `ms` is after it. Ticks before the first do not exist. */
export function nearestTick(
  bpm: number,
  ms: number,
): { index: number; offMs: number } {
  const beat = 60000 / bpm,
    index = Math.max(0, Math.round(ms / beat));
  return { index, offMs: ms - index * beat };
}
/** A tap against the click: the tick it is nearest to, how far after it, and its judgment (-1: no tick near). */
export function judgeTap(
  bpm: number,
  ms: number,
): { index: number; offMs: number; judgment: number } {
  const near = nearestTick(bpm, ms);
  return {
    ...near,
    judgment: WINDOWS.findIndex((window) => Math.abs(near.offMs) <= window),
  };
}

/** Sample `index` of one tick at `sampleRate`: 0 before it and after `CLICK_S`. */
export function clickSample(sampleRate: number, index: number): number {
  const t = index / sampleRate;
  if (index < 0 || t >= CLICK_S) return 0;
  const attack =
    t < CLICK_ATTACK_S
      ? 0.5 - 0.5 * Math.cos((Math.PI * t) / CLICK_ATTACK_S)
      : 1;
  return (
    CLICK_LEVEL *
    attack *
    Math.exp(-t / CLICK_DECAY_S) *
    Math.sin(2 * Math.PI * CLICK_HZ * t)
  );
}

/**
 * One lap as a 16-bit mono WAV file: `ticks` ticks, the first on sample 0, and exactly `ticks` beats long, so a lap
 * started the moment the last one ends keeps the beat. A tick starts on the sample nearest its time.
 */
export function lapWav(
  bpm: number,
  ticks = LAP_TICKS,
  sampleRate = CLICK_SAMPLE_RATE,
): Uint8Array<ArrayBuffer> {
  const frames = Math.round(ticks * beatS(bpm) * sampleRate),
    length = Math.ceil(CLICK_S * sampleRate),
    bytes = new Uint8Array(44 + frames * 2),
    view = new DataView(bytes.buffer);
  const tag = (at: number, text: string) => {
    for (let index = 0; index < text.length; index++)
      view.setUint8(at + index, text.charCodeAt(index));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let tick = 0; tick < ticks; tick++) {
    const first = Math.round(tick * beatS(bpm) * sampleRate);
    for (let index = 0; index < length && first + index < frames; index++)
      view.setInt16(
        44 + (first + index) * 2,
        Math.round(clickSample(sampleRate, index) * 32767),
        true,
      );
  }
  return bytes;
}
