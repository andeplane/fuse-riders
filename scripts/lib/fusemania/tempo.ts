/**
 * Tempo for the Fusemania chart generator: from a song's onsets to a time map that says when every beat is heard.
 *
 * The tracks are generated audio whose tempo is steady to the ear but not to the millisecond: many of them speed up
 * by a few tenths of a percent over their length, which is a tenth of a second of drift against a constant grid. So
 * the tempo is not one number fitted to the whole song. Instead:
 *
 * 1. `pulseFrequency` finds the fastest steady pulse (usually the sixteenths or the triplets) from short windows,
 *    where drift cannot blur it.
 * 2. `fitWarp` follows that pulse through the song: first a coherent fit of frequency plus a linear tempo ramp over
 *    every onset (robust where the pulse is weak), then the smooth remainder by complex demodulation. The result is
 *    `delta(t)`, how late the pulse runs against a metronome at time t.
 * 3. In pulse coordinates the song is exactly periodic, so the beat (how many pulses, which one) and the bar are
 *    read from whole-song sums in `metre.ts`.
 * 4. `fitSegments` turns the beat times into the fewest constant-tempo `#BPMS` segments that stay within a few
 *    milliseconds of them.
 */
import type { Onset } from "./dsp.js";

export interface BandOnset extends Onset {
  /** 0 low (kick, bass), 1 mid (snare, melody attacks), 2 high (hats, cymbals). */
  band: 0 | 1 | 2;
}

const TAU = 2 * Math.PI;

/** How much an onset counts in a fit: its strength, compressed so one loud hit does not outvote a bar of hats. */
export const onsetWeight = (onset: Onset): number =>
  Math.sqrt(Math.min(1, onset.strength));

/**
 * The strongest steady pulse between 4 and 14.5 Hz, in Hz: the peak of the onsets' spectrum averaged over
 * ten-second windows (magnitudes, so drift between windows does not cancel it).
 */
export function pulseFrequency(
  onsets: readonly BandOnset[],
  duration: number,
): number {
  const window = 10,
    hop = 5,
    step = 0.004,
    low = 4,
    high = 14.5;
  const count = Math.round((high - low) / step) + 1;
  const power = new Float64Array(count);
  for (
    let start = 0;
    start + window <= Math.max(window, duration);
    start += hop
  ) {
    const inside = onsets.filter(
      (onset) => onset.time >= start && onset.time < start + window,
    );
    let total = 0;
    for (const onset of inside) total += onsetWeight(onset);
    if (total <= 0) continue;
    for (let j = 0; j < count; j++) {
      const f = low + j * step;
      let re = 0,
        im = 0;
      for (const onset of inside) {
        const angle = TAU * f * onset.time,
          weight = onsetWeight(onset);
        re += weight * Math.cos(angle);
        im += weight * Math.sin(angle);
      }
      power[j] = power[j]! + Math.hypot(re, im) / total;
    }
  }
  let best = 0;
  for (let j = 1; j < count; j++) if (power[j]! > power[best]!) best = j;
  return low + best * step;
}

export interface Warp {
  /** The pulse's mean frequency in Hz. */
  f: number;
  /** Seconds between samples of `delta` and `clarity`. */
  step: number;
  /** How late the pulse runs at each sample time, in seconds. */
  delta: Float64Array;
  /** How much of the onset weight around each sample time is on the pulse, 0 to 1. */
  clarity: Float64Array;
  /** The fraction of a pulse by which pulse 0 trails time 0. */
  theta: number;
  /** The largest distance between `delta` and its straight-line fit: what one constant tempo would drift by. */
  ramp: number;
}

const sampleAt = (values: Float64Array, step: number, time: number): number => {
  const at = Math.min(values.length - 1, Math.max(0, time / step));
  const low = Math.floor(at),
    high = Math.min(values.length - 1, low + 1);
  return values[low]! + (values[high]! - values[low]!) * (at - low);
};

/** The pulse count at `time`: whole numbers are pulses. */
export const pulseAt = (warp: Warp, time: number): number =>
  warp.f * (time - sampleAt(warp.delta, warp.step, time)) - warp.theta;

/** The time of pulse `count`: `pulseAt` inverted. Beyond the audio the tempo at its nearer end is carried on. */
export function timeOfPulse(warp: Warp, count: number): number {
  const base = (count + warp.theta) / warp.f;
  let time = base;
  for (let i = 0; i < 12; i++)
    time = base + sampleAt(warp.delta, warp.step, time);
  return time;
}

/** How much of the pulse the onsets around `time` carry, 0 to 1. */
export const clarityAt = (warp: Warp, time: number): number =>
  sampleAt(warp.clarity, warp.step, time);

/** Follows the pulse near `f0` through the whole song. */
export function fitWarp(
  onsets: readonly BandOnset[],
  duration: number,
  f0: number,
): Warp {
  const times = onsets.map((onset) => onset.time);
  const weights = onsets.map(onsetWeight);
  const middle = duration / 2;
  // 1. Frequency plus a linear tempo ramp (a parabola in delta, `sag` seconds at either end), over every onset.
  const coherence = (f: number, sag: number): number => {
    let re = 0,
      im = 0;
    for (let i = 0; i < times.length; i++) {
      const offset = (times[i]! - middle) / middle;
      const angle = TAU * f * (times[i]! - sag * offset * offset);
      re += weights[i]! * Math.cos(angle);
      im += weights[i]! * Math.sin(angle);
    }
    return Math.hypot(re, im);
  };
  let bestF = f0,
    bestSag = 0,
    best = -1;
  const fStep = 0.3 / duration,
    fSpan = 0.012 * f0,
    sagStep = 0.008,
    sagSpan = 0.4;
  for (let f = f0 - fSpan; f <= f0 + fSpan; f += fStep)
    for (let sag = -sagSpan; sag <= sagSpan; sag += sagStep) {
      const value = coherence(f, sag);
      if (value > best) {
        best = value;
        bestF = f;
        bestSag = sag;
      }
    }
  for (
    let df = fStep / 2, ds = sagStep / 2, round = 0;
    round < 14;
    round++, df /= 2, ds /= 2
  )
    for (const [f, sag] of [
      [bestF - df, bestSag],
      [bestF + df, bestSag],
      [bestF, bestSag - ds],
      [bestF, bestSag + ds],
    ] as const) {
      const value = coherence(f, sag);
      if (value > best) {
        best = value;
        bestF = f;
        bestSag = sag;
      }
    }
  const f = bestF;
  const step = 0.25;
  const samples = Math.ceil(duration / step) + 1;
  const delta = new Float64Array(samples);
  for (let j = 0; j < samples; j++) {
    const offset = (j * step - middle) / middle;
    delta[j] = bestSag * offset * offset;
  }
  // 2. What the parabola leaves: the pulse's phase around each sample time, relative to the whole song's.
  const sigma = 2.0;
  const clarity = new Float64Array(samples);
  const measure = (): { re: Float64Array; im: Float64Array } => {
    const re = new Float64Array(samples),
      im = new Float64Array(samples),
      mass = new Float64Array(samples);
    for (let i = 0; i < times.length; i++) {
      const time = times[i]!;
      const angle = -TAU * f * (time - sampleAt(delta, step, time));
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      const from = Math.max(0, Math.ceil((time - 3 * sigma) / step)),
        to = Math.min(samples - 1, Math.floor((time + 3 * sigma) / step));
      for (let j = from; j <= to; j++) {
        const distance = (j * step - time) / sigma;
        const gain = weights[i]! * Math.exp(-0.5 * distance * distance);
        re[j] = re[j]! + gain * cos;
        im[j] = im[j]! + gain * sin;
        mass[j] = mass[j]! + gain;
      }
    }
    for (let j = 0; j < samples; j++)
      clarity[j] = mass[j]! > 0 ? Math.hypot(re[j]!, im[j]!) / mass[j]! : 0;
    return { re, im };
  };
  for (let round = 0; round < 4; round++) {
    const { re, im } = measure();
    let sumRe = 0,
      sumIm = 0;
    for (let j = 0; j < samples; j++) {
      sumRe += re[j]!;
      sumIm += im[j]!;
    }
    const mean = Math.atan2(sumIm, sumRe);
    const sorted = Float64Array.from(clarity).sort();
    const trusted = Math.max(0.12, 0.5 * sorted[samples >> 1]!);
    const correction = new Float64Array(samples);
    const known: number[] = [];
    const wrap = (angle: number): number =>
      angle - TAU * Math.round(angle / TAU);
    let previous = 0,
      unwrapped = 0;
    for (let j = 0; j < samples; j++) {
      // Where little of the weight is on the pulse (an intro, a break) the phase is noise, not tempo.
      if (clarity[j]! < trusted) continue;
      // Followed from one trusted sample to the next, so a residual of more than half a pulse is not mistaken for
      // its alias on the other side (a whole pulse of error, which would be a sixteenth's jump in the grid).
      const phase = Math.atan2(im[j]!, re[j]!) - mean;
      unwrapped =
        known.length === 0 ? wrap(phase) : unwrapped + wrap(phase - previous);
      previous = phase;
      correction[j] = unwrapped;
      known.push(j);
    }
    const turns = Math.round(
      [...known.map((j) => correction[j]!)].sort((a, b) => a - b)[
        known.length >> 1
      ]! / TAU,
    );
    // A late onset turns the phase back, so a negative phase is a pulse that runs later than modelled.
    for (const j of known)
      correction[j] = -(correction[j]! - TAU * turns) / (TAU * f);
    // Such a stretch is bridged from the trusted samples either side of it, so the tempo carries through.
    for (let j = 0, next = 0; j < samples && known.length > 0; j++) {
      while (next < known.length && known[next]! < j) next++;
      const after = known[Math.min(next, known.length - 1)]!,
        before = known[Math.max(0, next - 1)]!;
      if (after === j) continue;
      correction[j] =
        after < j || before > j || after === before
          ? correction[after < j ? after : before]!
          : correction[before]! +
            ((correction[after]! - correction[before]!) * (j - before)) /
              (after - before);
    }
    for (let j = 0; j < samples; j++) delta[j] = delta[j]! + correction[j]!;
  }
  const { re, im } = measure();
  let sumRe = 0,
    sumIm = 0;
  for (let j = 0; j < samples; j++) {
    sumRe += re[j]!;
    sumIm += im[j]!;
  }
  const theta = -Math.atan2(sumIm, sumRe) / TAU;
  // The drift one constant tempo would have: delta against its least-squares line.
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let j = 0; j < samples; j++) {
    n++;
    sx += j;
    sy += delta[j]!;
    sxx += j * j;
    sxy += j * delta[j]!;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx),
    intercept = (sy - slope * sx) / n;
  let ramp = 0;
  for (let j = 0; j < samples; j++)
    ramp = Math.max(ramp, Math.abs(delta[j]! - intercept - slope * j));
  return { f, step, delta, clarity, theta, ramp };
}

export type BpmSegment = readonly [beat: number, bpm: number];

/** Seconds from beat 0 to `beat` under `segments` (StepMania `#BPMS`: each tempo holds until the next entry). */
export function secondsAtBeat(
  segments: readonly BpmSegment[],
  beat: number,
): number {
  let seconds = 0;
  for (let i = 0; i < segments.length; i++) {
    const [start, bpm] = segments[i]!;
    const end = i + 1 < segments.length ? segments[i + 1]![0] : Infinity;
    if (beat <= start) break;
    seconds += ((Math.min(beat, end) - start) * 60) / bpm;
  }
  if (beat < 0) seconds = (beat * 60) / segments[0]![1];
  return seconds;
}

/** `secondsAtBeat` inverted. */
export function beatAtSeconds(
  segments: readonly BpmSegment[],
  seconds: number,
): number {
  if (seconds <= 0) return (seconds * segments[0]![1]) / 60;
  let elapsed = 0;
  for (let i = 0; i < segments.length; i++) {
    const [start, bpm] = segments[i]!;
    const end = i + 1 < segments.length ? segments[i + 1]![0] : Infinity;
    const length = ((end - start) * 60) / bpm;
    if (seconds <= elapsed + length)
      return start + ((seconds - elapsed) * bpm) / 60;
    elapsed += length;
  }
  return 0;
}

/**
 * The fewest constant-tempo segments, changing only on multiples of `quantum` beats, whose beat times stay within
 * `tolerance` seconds of `beatTimes` (index = beat, relative to beat 0). Tempos are rounded to three decimals as
 * the file will carry them, and each segment starts where the rounded ones before it actually end.
 */
export function fitSegments(
  beatTimes: readonly number[],
  quantum: number,
  tolerance: number,
): BpmSegment[] {
  const segments: [number, number][] = [];
  const last = beatTimes.length - 1;
  let start = 0,
    startTime = 0;
  while (start < last) {
    let low = 0,
      high = Infinity,
      end = start,
      seconds = 0;
    // Grow the segment a quantum at a time while one tempo still passes within tolerance of every beat in it.
    for (
      let candidate = Math.min(last, start + quantum);
      ;
      candidate = Math.min(last, candidate + quantum)
    ) {
      let nextLow = low,
        nextHigh = high;
      for (let beat = Math.max(start + 1, end + 1); beat <= candidate; beat++) {
        const target = beatTimes[beat]! - beatTimes[0]! - startTime;
        nextLow = Math.max(nextLow, (target - tolerance) / (beat - start));
        nextHigh = Math.min(nextHigh, (target + tolerance) / (beat - start));
      }
      if (nextLow > nextHigh && end > start) break;
      low = nextLow;
      high = nextHigh;
      end = candidate;
      // Aim at the last beat itself where the bounds allow, so the next segment starts with its error spent.
      const aim =
        (beatTimes[end]! - beatTimes[0]! - startTime) / (end - start);
      seconds = Math.min(Math.max(aim, low), Math.max(low, high));
      if (candidate === last) break;
    }
    const bpm = Math.round(60000 / seconds) / 1000;
    segments.push([start, bpm]);
    startTime += ((end - start) * 60) / bpm;
    start = end;
  }
  // Neighbours that rounded to the same tempo are one segment.
  return segments.filter(
    (segment, index) => index === 0 || segment[1] !== segments[index - 1]![1],
  );
}
