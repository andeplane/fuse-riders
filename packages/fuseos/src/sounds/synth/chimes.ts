import type { Random } from "./pcm";
import {
  applyEnvelope,
  at,
  biquad,
  normalize,
  PcmTrack,
  renderNoise,
  seededRandom,
} from "./pcm";

/**
 * The short system sounds: start-up and shut-down chimes, the error chord, the ding and the
 * Recycle Bin's paper crumple. All original compositions synthesised here, none of them
 * Microsoft's recordings.
 */

export const STARTUP_DURATION = 3.8;
export const SHUTDOWN_DURATION = 2.6;
export const DING_DURATION = 0.8;
export const ERROR_DURATION = 0.65;
export const RECYCLE_DURATION = 0.75;

/** A few partials make a sine into a soft organ/bell. */
function voice(
  track: PcmTrack,
  freq: number,
  start: number,
  duration: number,
  amp: number,
  options: { attack?: number; release?: number; decay?: number } = {},
) {
  const partials: readonly [number, number][] = [
    [1, 1],
    [2, 0.35],
    [3, 0.12],
    [4.01, 0.05],
  ];
  for (const [ratio, gain] of partials)
    track.tone({
      freq: freq * ratio,
      start,
      duration,
      amp: amp * gain,
      attack: options.attack,
      release: options.release,
      decay: options.decay,
    });
}

const D3 = 146.83;
const A3 = 220.0;
const D4 = 293.66;
const FS4 = 369.99;
const A4 = 440.0;
const D5 = 587.33;
const A5 = 880.0;
const D6 = 1174.66;
const C4 = 261.63;
const EF4 = 311.13;
const GF4 = 369.99;

/** The pad swells in, then two high sparkles land on it. */
export function renderStartup(sampleRate: number): Float32Array {
  const track = new PcmTrack(sampleRate, STARTUP_DURATION);
  for (const freq of [D3, A3, FS4, D4])
    voice(track, freq, 0, 3.4, 0.11, { attack: 0.5, release: 1.4 });
  voice(track, A4, 0.9, 2.6, 0.06, { attack: 0.3, release: 1.2 });
  voice(track, A5, 1.3, 2.2, 0.07, { attack: 0.01, release: 0.2, decay: 0.7 });
  voice(track, D6, 1.75, 1.9, 0.07, { attack: 0.01, release: 0.2, decay: 0.8 });
  voice(track, FS4 * 2, 2.2, 1.5, 0.05, {
    attack: 0.01,
    release: 0.2,
    decay: 0.7,
  });
  return normalize(track.samples, 0.7);
}

/** Four notes stepping down onto a low pad that fades out. */
export function renderShutdown(sampleRate: number): Float32Array {
  const track = new PcmTrack(sampleRate, SHUTDOWN_DURATION);
  const melody: readonly [number, number][] = [
    [D5, 0],
    [A4, 0.32],
    [FS4, 0.64],
    [D4, 0.96],
  ];
  for (const [freq, start] of melody)
    voice(track, freq, start, 1.4, 0.1, {
      attack: 0.02,
      release: 0.4,
      decay: 0.6,
    });
  for (const freq of [D3, A3])
    voice(track, freq, 0.9, 1.6, 0.08, { attack: 0.3, release: 0.9 });
  return normalize(track.samples, 0.7);
}

/** A struck bell at A5 with its octave and twelfth. */
export function renderDing(sampleRate: number): Float32Array {
  const track = new PcmTrack(sampleRate, DING_DURATION);
  track.tone({
    freq: 880,
    start: 0,
    duration: 0.78,
    amp: 0.5,
    attack: 0.002,
    release: 0.05,
    decay: 0.2,
  });
  track.tone({
    freq: 1760,
    start: 0,
    duration: 0.6,
    amp: 0.2,
    attack: 0.002,
    release: 0.05,
    decay: 0.12,
  });
  track.tone({
    freq: 2640,
    start: 0,
    duration: 0.4,
    amp: 0.08,
    attack: 0.002,
    release: 0.05,
    decay: 0.08,
  });
  return normalize(track.samples, 0.6);
}

/** The error chord: a diminished triad with a square-ish bite, over before you can argue. */
export function renderError(sampleRate: number): Float32Array {
  const track = new PcmTrack(sampleRate, ERROR_DURATION);
  for (const freq of [C4, EF4, GF4]) {
    track.tone({
      freq,
      start: 0,
      duration: 0.6,
      amp: 0.2,
      attack: 0.004,
      release: 0.15,
      decay: 0.5,
    });
    track.tone({
      freq: freq * 3,
      start: 0,
      duration: 0.5,
      amp: 0.05,
      attack: 0.004,
      release: 0.15,
      decay: 0.3,
    });
  }
  return normalize(track.samples, 0.6);
}

/** Paper being crumpled: a swish of noise peppered with crackles that cluster then thin out. */
export function renderRecycle(
  sampleRate: number,
  random: Random = seededRandom(0x4e_c1),
): Float32Array {
  const track = new PcmTrack(sampleRate, RECYCLE_DURATION);
  const swish = biquad(
    "bandpass",
    3200,
    0.6,
    sampleRate,
  )(renderNoise(at(sampleRate, 0.6), random, 1));
  applyEnvelope(swish, sampleRate, 0.08, 0.3);
  track.add(0.02, swish, 0.25);
  const crackle = new PcmTrack(sampleRate, RECYCLE_DURATION);
  let t = 0.02;
  while (t < RECYCLE_DURATION - 0.05) {
    const burst = renderNoise(
      at(sampleRate, 0.004 + random() * 0.006),
      random,
      1,
    );
    applyEnvelope(burst, sampleRate, 0.0005, 0.004);
    const position = t / RECYCLE_DURATION;
    const density = Math.sin(Math.PI * position);
    crackle.add(t, burst, 0.4 + density * 0.6);
    t += 0.006 + random() * (0.05 - density * 0.035);
  }
  track.add(0, biquad("highpass", 900, 0.7, sampleRate)(crackle.samples), 0.8);
  return normalize(track.samples, 0.6);
}
