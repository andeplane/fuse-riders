/**
 * Sample-level synthesis helpers. Every system sound is rendered into a mono Float32Array by a
 * pure, deterministic function of the sample rate (and a seeded random source), which the
 * SoundService turns into an AudioBuffer. Keeping the synthesis out of the Web Audio graph makes
 * it identical in a browser, an OfflineAudioContext and Node (scripts/fuseos/render-sounds.ts
 * writes WAVs with the very same code), and lets tests inspect the waveform directly.
 */

export type Random = () => number;

/** mulberry32: a small seeded generator so a sound renders the same every time. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ToneOptions = {
  freq: number;
  /** Seconds from the start of the track. */
  start: number;
  duration: number;
  /** Peak amplitude, 0..1. */
  amp: number;
  /** Linear fade in/out in seconds; default 5 ms so tones never click. */
  attack?: number;
  release?: number;
  /** Starting phase in radians. */
  phase?: number;
  /** Exponential decay time constant in seconds (a struck bell); absent means sustained. */
  decay?: number;
};

/** A mono track of fixed length that sounds are mixed into. */
export class PcmTrack {
  readonly samples: Float32Array;

  constructor(
    readonly sampleRate: number,
    readonly duration: number,
  ) {
    this.samples = new Float32Array(Math.ceil(duration * sampleRate));
  }

  /** Mixes `signal` in at `start` seconds, clipping to the track's end. */
  add(start: number, signal: Float32Array, gain = 1): void {
    const offset = Math.round(start * this.sampleRate);
    const end = Math.min(this.samples.length, offset + signal.length);
    for (let i = Math.max(0, offset); i < end; i++) {
      const value = this.samples[i] ?? 0;
      this.samples[i] = value + (signal[i - offset] ?? 0) * gain;
    }
  }

  tone(options: ToneOptions): void {
    this.add(options.start, renderTone(this.sampleRate, options));
  }

  /** Applies a linear gain ramp between two points in time (seconds). */
  ramp(from: number, to: number, gainFrom: number, gainTo: number): void {
    const a = Math.round(from * this.sampleRate);
    const b = Math.min(this.samples.length, Math.round(to * this.sampleRate));
    for (let i = a; i < b; i++) {
      const t = (i - a) / Math.max(1, b - a);
      this.samples[i] =
        (this.samples[i] ?? 0) * (gainFrom + (gainTo - gainFrom) * t);
    }
  }
}

export function renderTone(
  sampleRate: number,
  options: ToneOptions,
): Float32Array {
  const n = Math.round(options.duration * sampleRate);
  const out = new Float32Array(n);
  const step = (2 * Math.PI * options.freq) / sampleRate;
  const phase = options.phase ?? 0;
  for (let i = 0; i < n; i++) {
    let value = Math.sin(phase + step * i) * options.amp;
    if (options.decay !== undefined)
      value *= Math.exp(-i / (options.decay * sampleRate));
    out[i] = value;
  }
  applyEnvelope(
    out,
    sampleRate,
    options.attack ?? 0.005,
    options.release ?? 0.005,
  );
  return out;
}

/** Linear fade in and out, in place. */
export function applyEnvelope(
  samples: Float32Array,
  sampleRate: number,
  attack: number,
  release: number,
): void {
  const n = samples.length;
  const a = Math.min(n, Math.round(attack * sampleRate));
  const r = Math.min(n, Math.round(release * sampleRate));
  for (let i = 0; i < a; i++) samples[i] = (samples[i] ?? 0) * (i / a);
  for (let i = 0; i < r; i++) {
    const index = n - 1 - i;
    samples[index] = (samples[index] ?? 0) * (i / r);
  }
}

/** White noise in -amp..amp. */
export function renderNoise(
  length: number,
  random: Random,
  amp = 1,
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = (random() * 2 - 1) * amp;
  return out;
}

export type FilterKind = "lowpass" | "highpass" | "bandpass";

/** An RBJ cookbook biquad; returns a function that filters a whole buffer into a new one. */
export function biquad(
  kind: FilterKind,
  freq: number,
  q: number,
  sampleRate: number,
): (input: Float32Array) => Float32Array {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * q);
  let b0: number;
  let b1: number;
  let b2: number;
  switch (kind) {
    case "lowpass":
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      break;
    case "highpass":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      break;
    case "bandpass":
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      break;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const c0 = b0 / a0;
  const c1 = b1 / a0;
  const c2 = b2 / a0;
  const d1 = a1 / a0;
  const d2 = a2 / a0;
  return (input) => {
    const out = new Float32Array(input.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const x0 = input[i] ?? 0;
      const y0 = c0 * x0 + c1 * x1 + c2 * x2 - d1 * y1 - d2 * y2;
      out[i] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    return out;
  };
}

/** Noise confined to `low`..`high` Hz (a cascade of a high-pass and a low-pass, each applied twice). */
export function renderBandNoise(
  sampleRate: number,
  length: number,
  random: Random,
  low: number,
  high: number,
  amp: number,
): Float32Array {
  const hp = biquad("highpass", low, 0.707, sampleRate);
  const lp = biquad("lowpass", high, 0.707, sampleRate);
  const shaped = lp(lp(hp(hp(renderNoise(length, random)))));
  return scale(shaped, amp / Math.max(1e-6, peak(shaped)));
}

export function scale(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = (samples[i] ?? 0) * gain;
  return out;
}

export function peak(
  samples: Float32Array,
  from = 0,
  to = samples.length,
): number {
  let max = 0;
  for (let i = from; i < to; i++)
    max = Math.max(max, Math.abs(samples[i] ?? 0));
  return max;
}

/** Scales the track so its loudest sample sits at `target`, and clips any stray overshoot. */
export function normalize(samples: Float32Array, target = 0.9): Float32Array {
  const max = peak(samples);
  const out =
    max > 0 ? scale(samples, target / max) : new Float32Array(samples);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.max(-1, Math.min(1, out[i] ?? 0));
  return out;
}

/** Root mean square over a sample range. */
export function rms(
  samples: Float32Array,
  from = 0,
  to = samples.length,
): number {
  let sum = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/**
 * Goertzel: the power and phase of one frequency over a sample range. Tests use it to check
 * that the dial tone really is 350 + 440 Hz, that a digit's two DTMF tones are there, and that
 * the answer tone flips phase.
 */
export function goertzel(
  samples: Float32Array,
  sampleRate: number,
  freq: number,
  from: number,
  to: number,
): { power: number; phase: number } {
  const n = to - from;
  const k = (2 * Math.PI * freq) / sampleRate;
  const coeff = 2 * Math.cos(k);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    s0 = (samples[i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(k);
  const imag = s2 * Math.sin(k);
  return {
    power: (real * real + imag * imag) / (n * n),
    phase: Math.atan2(imag, real),
  };
}

/** Sample-exact equality; far faster than a deep-equal matcher on a quarter of a million floats. */
export function sameSamples(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Seconds to a sample index. */
export function at(sampleRate: number, seconds: number): number {
  return Math.round(seconds * sampleRate);
}
