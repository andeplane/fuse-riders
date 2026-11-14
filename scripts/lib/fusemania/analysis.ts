/**
 * A song's analysis: everything the chart generator needs, small enough to commit, so charts can be regenerated
 * without the audio or ffmpeg. `analyzeSong` in `analyze.ts` writes one; `generate.ts` reads it.
 *
 * Time is in beats. The grid has `slotsPerBeat` slots per beat (4 for straight sixteenths, 3 for triplets, 6 for
 * swung sixteenths) and every per-slot series is a string with one base-62 digit per slot, slot 0 at beat 0.
 */
import { beatAtSeconds, secondsAtBeat, type BpmSegment } from "./tempo.js";

export interface Analysis {
  readonly id: string;
  /** Length of the audio in seconds. */
  readonly duration: number;
  /** StepMania `#OFFSET`: beat 0 is heard `-offset` seconds into the file. Beat 0 starts a bar. */
  readonly offset: number;
  /** StepMania `#BPMS`: each tempo holds from its beat until the next entry. */
  readonly bpms: readonly BpmSegment[];
  readonly slotsPerBeat: number;
  /**
   * What each slot of a beat is, one letter per slot: `Q` the beat, `E` the off-beat eighth (straight or swung),
   * `S` a sixteenth-level slot the music uses, `X` a slot it does not.
   */
  readonly levels: string;
  /** Which bar (0 to 3) starts a four-bar phrase. */
  readonly phrase: number;
  /** The song select's preview: seconds into the file, and length. */
  readonly sample: readonly [start: number, length: number];
  readonly quality: Quality;
  /** Per bar, 0 to 61: loudness relative to the song's loud sections (61 is as loud as they get). */
  readonly energy: string;
  /** Per bar, 0 to 61: how much of the onset weight sits on the pulse (61 is 0.7 or more). */
  readonly clarity: string;
  /** Per slot, 0 to 61 (30 is a strong onset): low band, kick and bass. */
  readonly low: string;
  /** Per slot: mid band, snare and note attacks. */
  readonly mid: string;
  /** Per slot: high band, hats and cymbals. */
  readonly high: string;
  /** Per slot: a new sustained pitch, the melody and chords whether or not they have an attack. */
  readonly tone: string;
  /** Per slot: where the new pitch sits, 1 (150 Hz) to 58 (4 kHz) in semitones; 0 where `tone` found none. */
  readonly pitch: string;
  /** Per slot: how much sustained sound there is, 0 to 61 (50 is the song's loud sections). */
  readonly level: string;
}

export interface Quality {
  /** Share of strong onsets within 25 ms of a slot the charts may use. */
  readonly align: number;
  /** What `align` would be for onsets at random times. */
  readonly chance: number;
  /** The largest median distance, in milliseconds, between strong onsets and the grid over any 25 s window. */
  readonly driftMs: number;
  /** How far one constant tempo would have drifted, in milliseconds: why there are several `#BPMS`. */
  readonly rampMs: number;
  /** The median share of onset weight on the pulse, 0 to 1. */
  readonly pulse: number;
  /** How clearly the bar's first beat stood out from the next best candidate, 0 to 1. */
  readonly downbeat: number;
}

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const encodeSeries = (values: ArrayLike<number>): string => {
  let out = "";
  for (let i = 0; i < values.length; i++)
    out += DIGITS[Math.max(0, Math.min(61, Math.round(values[i]!)))]!;
  return out;
};

export const decodeSeries = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i] =
      code <= 57 ? code - 48 : code >= 97 ? code - 97 + 10 : code - 65 + 36;
  }
  return out;
};

/** Seconds into the audio file at which `beat` is heard. */
export const beatSeconds = (
  analysis: Pick<Analysis, "offset" | "bpms">,
  beat: number,
): number => secondsAtBeat(analysis.bpms, beat) - analysis.offset;

/** The beat heard `seconds` into the audio file. */
export const secondsBeat = (
  analysis: Pick<Analysis, "offset" | "bpms">,
  seconds: number,
): number => beatAtSeconds(analysis.bpms, seconds + analysis.offset);

/** The slowest and fastest tempo. */
export const bpmRange = (
  analysis: Pick<Analysis, "bpms">,
): readonly [number, number] => {
  let low = Infinity,
    high = -Infinity;
  for (const [, bpm] of analysis.bpms) {
    low = Math.min(low, bpm);
    high = Math.max(high, bpm);
  }
  return [low, high];
};

export function parseAnalysis(text: string): Analysis {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null)
    throw new Error("analysis: not an object");
  const analysis = value as Analysis;
  const slots = analysis.low.length;
  for (const key of ["mid", "high", "tone", "pitch", "level"] as const)
    if (analysis[key].length !== slots)
      throw new Error(`analysis ${analysis.id}: ${key} has the wrong length`);
  if (analysis.levels.length !== analysis.slotsPerBeat)
    throw new Error(`analysis ${analysis.id}: levels does not match the grid`);
  return analysis;
}
