import { writeSsc, type ChartNote, type SongSource } from "../engine/index.js";

/**
 * The timing lab's songs: nothing but a tick, dead steady, with a note on every tick. A real song hides its beat in
 * a mix and its chart was placed by an analysis; here the audio and the chart are made from the same numbers, so a
 * tick's first sample is exactly on its note and any error left is the device's or the player's. The tick is a short
 * high ping (`CLICK_HZ`) with nothing under it, so a microphone can tell it from a key being pressed.
 *
 * They exist only on a `?debugtiming` page, for a solo run on this device: they are not in the bundled library, so
 * a room never plays one and the engine's `RULES` says nothing about them.
 */

/** Ticks a minute: 2, 2.5 and 3 a second. */
export const CLICK_RATES = [120, 150, 180] as const;
export const DEFAULT_CLICK_RATE = 150;
/** The tick: a decaying ping at this pitch, this long. */
export const CLICK_HZ = 6000;
export const CLICK_S = 0.03;
const CLICK_DECAY_S = 0.004;
/** The ping swells over this long, so its start does not splash across every pitch. */
const CLICK_ATTACK_S = 0.00025;
const CLICK_LEVEL = 0.85;
/** Seconds of silence before the first tick. */
export const CLICK_START_S = 0.5;
/** Ticks before the first note: time to find the pulse, and for a microphone to learn the room. */
export const CLICK_COUNT_IN = 8;
/** Seconds of notes. */
export const CLICK_PLAY_S = 40;
export const CLICK_SAMPLE_RATE = 48000;

export const clickId = (bpm: number): string => `click-${bpm}`;
/** The rate of a click track's id, or undefined when the id is not one. */
export function clickRate(id: string): number | undefined {
  const match = /^click-(\d+)$/.exec(id),
    bpm = match ? Number(match[1]) : NaN;
  return CLICK_RATES.find((rate) => rate === bpm);
}
/** What a click track's audio is named in the library: there is no file, the page makes it when it is asked for. */
export const clickAudio = (bpm: number): string => `click:${bpm}`;
export const clickAudioRate = (audio: string): number | undefined => {
  const match = /^click:(\d+)$/.exec(audio),
    bpm = match ? Number(match[1]) : NaN;
  return CLICK_RATES.find((rate) => rate === bpm);
};

/** How many notes a track at `bpm` has, and how many ticks its audio has (the count-in and one to end on). */
export const clickNotes = (bpm: number): number =>
  Math.round((CLICK_PLAY_S * bpm) / 60);
export const clickTicks = (bpm: number): number =>
  CLICK_COUNT_IN + clickNotes(bpm) + 1;
/**
 * Song time of tick `index` in ms: the same number the chart's note has. A chart's notes are whole milliseconds, so
 * the tick is put on the whole millisecond too, and audio and chart agree to the sample.
 */
export const clickMs = (bpm: number, index: number): number =>
  Math.round((CLICK_START_S + (index * 60) / bpm) * 1000);
/** The tick nearest to song time `ms`, and how far `ms` is after it. */
export function nearestClick(
  bpm: number,
  ms: number,
): { index: number; offMs: number } {
  const beat = 60000 / bpm,
    index = Math.max(
      0,
      Math.min(
        clickTicks(bpm) - 1,
        Math.round((ms - CLICK_START_S * 1000) / beat),
      ),
    );
  return { index, offMs: ms - clickMs(bpm, index) };
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

/** The track's audio as a 16-bit mono WAV file. A tick starts on the sample nearest its time. */
export function clickWav(
  bpm: number,
  sampleRate = CLICK_SAMPLE_RATE,
): Uint8Array<ArrayBuffer> {
  const ticks = clickTicks(bpm),
    frames = Math.ceil((clickMs(bpm, ticks - 1) / 1000 + 1) * sampleRate),
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
    const first = Math.round((clickMs(bpm, tick) / 1000) * sampleRate);
    for (let index = 0; index < length && first + index < frames; index++)
      view.setInt16(
        44 + (first + index) * 2,
        Math.round(clickSample(sampleRate, index) * 32767),
        true,
      );
  }
  return bytes;
}

/** The track's simfile: "Beginner" is one arrow on every tick, "Easy" walks the four. */
export function clickSsc(bpm: number): string {
  const notes = clickNotes(bpm);
  const chart = (
    difficulty: string,
    meter: number,
    column: (index: number) => number,
  ) => ({
    stepsType: "dance-single",
    difficulty,
    meter,
    description: "",
    credit: "Fusemania timing lab",
    notes: Array.from({ length: notes }, (_, index): ChartNote => ({
      beat: CLICK_COUNT_IN + index,
      column: column(index),
      kind: "tap",
    })),
  });
  return writeSsc({
    title: `Click Track ${bpm}`,
    subtitle: "",
    artist: "Timing lab",
    credit: "",
    music: "",
    timing: { offset: -CLICK_START_S, bpms: [[0, bpm]], stops: [] },
    sampleStart: 0,
    sampleLength: 8,
    charts: [
      chart("Beginner", 1, () => 1),
      chart("Easy", 2, (index) => index % 4),
    ],
  });
}

/** The click tracks as library sources. */
export const clickSources = (): SongSource[] =>
  CLICK_RATES.map((bpm) => ({
    id: clickId(bpm),
    audio: clickAudio(bpm),
    ssc: clickSsc(bpm),
  }));
