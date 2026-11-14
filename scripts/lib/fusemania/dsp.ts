/**
 * Signal processing for the Fusemania chart generator: decoding through ffmpeg, zero-phase band splitting, onset
 * functions with millisecond resolution and a harmonic spectrogram for melody onsets, pitch contour and chords.
 *
 * Everything that feeds the beat grid is built from symmetric (zero-phase) operations on a linear amplitude
 * envelope, so an onset's detected time is the time of the steepest rise of the attack and carries no half-window
 * lag: a Butterworth low-pass run forwards and backwards, a triangular smoother centred on its sample, a central
 * difference.
 */
import { spawnSync } from "node:child_process";

/** The rate every file is decoded at. 11 kHz of bandwidth keeps hi-hats; onsets do not need more. */
export const SAMPLE_RATE = 22050;
/** Frames per second of the fine envelopes and onset functions: one per millisecond. */
export const FINE_RATE = 1000;

/** Mono float PCM at `SAMPLE_RATE`, decoded by ffmpeg (which removes the codec's priming samples, as browsers do). */
export function decodeAudio(file: string): Float32Array {
  const run = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "f32le",
      "-",
    ],
    { maxBuffer: 1 << 30 },
  );
  if (run.status !== 0)
    throw new Error(`ffmpeg failed on ${file}: ${run.stderr.toString()}`);
  const bytes = run.stdout;
  const out = new Float32Array(Math.floor(bytes.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = bytes.readFloatLE(i * 4);
  return out;
}

/** A second-order Butterworth low-pass run forwards then backwards: fourth order, no phase shift. */
export function lowpassZeroPhase(
  input: Float32Array,
  cutoffHz: number,
): Float32Array {
  const k = Math.tan((Math.PI * cutoffHz) / SAMPLE_RATE);
  const norm = 1 / (1 + Math.SQRT2 * k + k * k);
  const b0 = k * k * norm,
    b1 = 2 * b0,
    b2 = b0;
  const a1 = 2 * (k * k - 1) * norm,
    a2 = (1 - Math.SQRT2 * k + k * k) * norm;
  const pass = (x: Float32Array, reverse: boolean): Float32Array => {
    const y = new Float32Array(x.length);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    for (let n = 0; n < x.length; n++) {
      const i = reverse ? x.length - 1 - n : n;
      const xn = x[i]!;
      const yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = xn;
      y2 = y1;
      y1 = yn;
      y[i] = yn;
    }
    return y;
  };
  return pass(pass(input, false), true);
}

/**
 * The amplitude envelope of `x` at `FINE_RATE`: |x| under a triangular window (two box filters of `boxMs`) centred
 * on each output frame.
 */
export function envelope(x: Float32Array, boxMs: number): Float32Array {
  const half = Math.max(1, Math.round((boxMs / 1000) * SAMPLE_RATE * 0.5));
  const box = (source: Float64Array): Float64Array => {
    const prefix = new Float64Array(source.length + 1);
    for (let i = 0; i < source.length; i++)
      prefix[i + 1] = prefix[i]! + source[i]!;
    const out = new Float64Array(source.length);
    for (let i = 0; i < source.length; i++) {
      const from = Math.max(0, i - half),
        to = Math.min(source.length, i + half + 1);
      out[i] = (prefix[to]! - prefix[from]!) / (to - from);
    }
    return out;
  };
  const rectified = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) rectified[i] = Math.abs(x[i]!);
  const smooth = box(box(rectified));
  const frames = Math.floor((x.length / SAMPLE_RATE) * FINE_RATE);
  const out = new Float32Array(frames);
  for (let k = 0; k < frames; k++)
    out[k] =
      smooth[
        Math.min(x.length - 1, Math.round((k * SAMPLE_RATE) / FINE_RATE))
      ]!;
  return out;
}

/** The mean of `values` over `[i - radius, i + radius]` for every i. */
export function movingMean(values: Float32Array, radius: number): Float32Array {
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++)
    prefix[i + 1] = prefix[i]! + values[i]!;
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - radius),
      to = Math.min(values.length, i + radius + 1);
    out[i] = (prefix[to]! - prefix[from]!) / (to - from);
  }
  return out;
}

/**
 * The onset function of an envelope: its rise over four milliseconds (a central difference, so it peaks where the
 * attack is steepest), relative to the loudness around it so a quiet section's hits count like a loud one's.
 */
export function onsetFunction(env: Float32Array): Float32Array {
  const local = movingMean(env, Math.round(1.5 * FINE_RATE));
  let total = 0;
  for (const value of env) total += value;
  const floor = (0.08 * total) / Math.max(1, env.length) + 1e-9;
  const out = new Float32Array(env.length);
  for (let k = 2; k < env.length - 2; k++) {
    const rise = env[k + 2]! - env[k - 2]!;
    if (rise > 0) out[k] = rise / (local[k]! + floor);
  }
  return out;
}

export interface Onset {
  /** Seconds into the file, interpolated between frames. */
  time: number;
  strength: number;
}

/**
 * The peaks of an onset function: local maxima that are the largest within `guardMs` either side and stand above
 * `threshold` times the function's 99th percentile.
 */
export function pickOnsets(
  fn: Float32Array,
  rate: number,
  guardMs: number,
  threshold: number,
): Onset[] {
  const sorted = Float32Array.from(fn).sort();
  const reference = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  if (reference <= 0) return [];
  const guard = Math.max(1, Math.round((guardMs / 1000) * rate));
  const out: Onset[] = [];
  for (let k = 1; k < fn.length - 1; k++) {
    const value = fn[k]!;
    if (value < threshold * reference) continue;
    if (value < fn[k - 1]! || value <= fn[k + 1]!) continue;
    let top = true;
    for (
      let j = Math.max(0, k - guard);
      j <= Math.min(fn.length - 1, k + guard);
      j++
    )
      if (fn[j]! > value) {
        top = false;
        break;
      }
    if (!top) continue;
    const left = fn[k - 1]!,
      right = fn[k + 1]!;
    const curve = left - 2 * value + right;
    const shift = curve < 0 ? (0.5 * (left - right)) / curve : 0;
    out.push({ time: (k + shift) / rate, strength: value / reference });
  }
  return out;
}

/** In-place radix-2 FFT. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size)
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(step * k),
          wi = Math.sin(step * k);
        const a = start + k,
          b = a + half;
        const xr = re[b]! * wr - im[b]! * wi,
          xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
  }
}

export const STFT_SIZE = 1024;
/** Samples between spectrogram frames: about ten milliseconds. */
export const STFT_HOP = 220;
export const STFT_RATE = SAMPLE_RATE / STFT_HOP;
/** The spectrogram keeps the bins that carry melody and chords. */
const BIN_HZ = SAMPLE_RATE / STFT_SIZE;
export const FIRST_BIN = Math.ceil(150 / BIN_HZ);
export const LAST_BIN = Math.floor(4000 / BIN_HZ);
export const BINS = LAST_BIN - FIRST_BIN + 1;
export const binHz = (index: number): number => (FIRST_BIN + index) * BIN_HZ;

/**
 * The magnitude spectrogram between 150 Hz and 4 kHz, frames centred on `frame * STFT_HOP` samples (the signal is
 * padded by half a window), as one row-major array of `BINS` values per frame.
 */
export function spectrogram(x: Float32Array): {
  frames: number;
  data: Float32Array;
} {
  const frames = Math.floor(x.length / STFT_HOP);
  const data = new Float32Array(frames * BINS);
  const window = new Float64Array(STFT_SIZE);
  for (let i = 0; i < STFT_SIZE; i++)
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / STFT_SIZE);
  const re = new Float64Array(STFT_SIZE),
    im = new Float64Array(STFT_SIZE);
  for (let frame = 0; frame < frames; frame++) {
    const start = frame * STFT_HOP - STFT_SIZE / 2;
    for (let i = 0; i < STFT_SIZE; i++) {
      const at = start + i;
      re[i] = at >= 0 && at < x.length ? x[at]! * window[i]! : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let bin = 0; bin < BINS; bin++) {
      const at = FIRST_BIN + bin;
      data[frame * BINS + bin] = Math.hypot(re[at]!, im[at]!);
    }
  }
  return { frames, data };
}

/**
 * The harmonic part of a spectrogram: each bin's median over `span` frames. A drum hit is shorter than the span and
 * drops out; a held note stays, and because a median keeps edges where they are, it still starts on time.
 */
export function harmonicPart(
  data: Float32Array,
  frames: number,
  span: number,
): Float32Array {
  const out = new Float32Array(data.length);
  const half = span >> 1;
  const scratch = new Float32Array(span);
  for (let bin = 0; bin < BINS; bin++)
    for (let frame = 0; frame < frames; frame++) {
      let count = 0;
      for (
        let j = Math.max(0, frame - half);
        j <= Math.min(frames - 1, frame + half);
        j++
      )
        scratch[count++] = data[j * BINS + bin]!;
      const view = scratch.subarray(0, count).sort();
      out[frame * BINS + bin] = view[count >> 1]!;
    }
  return out;
}
