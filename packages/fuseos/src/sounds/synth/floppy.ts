import type { Random } from "./pcm";
import {
  applyEnvelope,
  at,
  biquad,
  normalize,
  PcmTrack,
  renderNoise,
  renderTone,
  seededRandom,
} from "./pcm";

/**
 * A 3½" floppy drive reading a disk: the spindle motor spinning up, the head stepper
 * recalibrating to track 0 (a 250 Hz buzz of step pulses), the head loading with a clunk, a
 * run of seeks of random length with the odd clack, and the motor spinning down. Built from
 * filtered noise and pulse trains, nothing sampled.
 */

export const FLOPPY_DURATION = 3.4;

const MOTOR_UP = 0.35;
const RECALIBRATE_START = 0.4;
const RECALIBRATE_END = 1.0;
const HEAD_LOAD = 1.08;
const SEEKS_START = 1.2;
const SEEKS_END = 2.7;
const MOTOR_DOWN_START = 2.75;

/** Step pulses per second: one track every 4 ms, the drive's rated step time. */
export const STEP_RATE = 250;

/** One stepper pulse: a tick of noise through a resonant band-pass, so a train of them buzzes. */
function renderStepPulse(sampleRate: number, random: Random) {
  const raw = renderNoise(at(sampleRate, 0.0025), random, 1);
  applyEnvelope(raw, sampleRate, 0.0002, 0.002);
  return biquad("bandpass", 1900, 1.4, sampleRate)(raw);
}

/** A head seek: `duration` seconds of step pulses, with a slight ramp as the stepper settles. */
function renderSeek(
  sampleRate: number,
  duration: number,
  random: Random,
  amp: number,
) {
  const seek = new PcmTrack(sampleRate, duration);
  // One pulse shape per seek: the train is periodic, so it buzzes at the step rate instead of hissing.
  const pulse = renderStepPulse(sampleRate, random);
  const period = 1 / STEP_RATE;
  for (let t = 0; t < duration; t += period)
    seek.add(t, pulse, amp * (0.9 + random() * 0.2));
  applyEnvelope(seek.samples, sampleRate, 0.01, 0.03);
  return seek.samples;
}

/** The head loading or the carriage hitting a stop: a short, low thud. */
function renderClunk(sampleRate: number, random: Random, amp: number) {
  const raw = renderNoise(at(sampleRate, 0.03), random, amp);
  applyEnvelope(raw, sampleRate, 0.001, 0.025);
  return biquad("lowpass", 160, 1.2, sampleRate)(raw);
}

export function renderFloppy(
  sampleRate: number,
  random: Random = seededRandom(0x35_14),
): Float32Array {
  const track = new PcmTrack(sampleRate, FLOPPY_DURATION);

  // Spindle motor: a 300 rpm whirr, mostly a low rumble with a thin whine on top.
  const motorLength = at(sampleRate, FLOPPY_DURATION);
  const rumble = biquad(
    "bandpass",
    180,
    2.5,
    sampleRate,
  )(renderNoise(motorLength, random, 1));
  const whine = biquad(
    "bandpass",
    1400,
    6,
    sampleRate,
  )(renderNoise(motorLength, random, 1));
  const motor = new Float32Array(motorLength);
  for (let i = 0; i < motorLength; i++) {
    const t = i / sampleRate;
    const wobble = 1 + 0.08 * Math.sin(2 * Math.PI * 5 * t);
    motor[i] = ((rumble[i] ?? 0) * 0.9 + (whine[i] ?? 0) * 0.25) * wobble;
  }
  track.add(0, motor, 0.25);
  track.add(
    0,
    renderTone(sampleRate, {
      freq: 100,
      start: 0,
      duration: FLOPPY_DURATION,
      amp: 0.05,
    }),
  );
  track.ramp(0, MOTOR_UP, 0, 1);
  track.ramp(MOTOR_DOWN_START, FLOPPY_DURATION, 1, 0);

  // Recalibrate: the head steps all the way to track 0.
  track.add(
    RECALIBRATE_START,
    renderSeek(sampleRate, RECALIBRATE_END - RECALIBRATE_START, random, 1.2),
  );
  track.add(RECALIBRATE_END, renderClunk(sampleRate, random, 0.6));
  track.add(HEAD_LOAD, renderClunk(sampleRate, random, 0.9));

  // Reading: seeks of 40-160 ms with 80-250 ms gaps while the disk turns, a clack now and then.
  let t = SEEKS_START;
  while (t < SEEKS_END) {
    const duration = 0.04 + random() * 0.12;
    track.add(
      t,
      renderSeek(sampleRate, Math.min(duration, SEEKS_END - t), random, 1.1),
    );
    t += duration;
    if (random() < 0.3) track.add(t, renderClunk(sampleRate, random, 0.5));
    t += 0.08 + random() * 0.17;
  }
  track.add(MOTOR_DOWN_START + 0.1, renderClunk(sampleRate, random, 0.4));

  return normalize(track.samples, 0.8);
}

/** How long the short seek lasts. */
export const DRIVE_SEEK_DURATION = 0.42;

/**
 * One short head seek with the head settling after it: what the drive does when a folder opens.
 * The same step pulses and clunk as `renderFloppy`, without the motor spinning up or down.
 */
export function renderDriveSeek(
  sampleRate: number,
  random: Random = seededRandom(0x5e_e4),
): Float32Array {
  const track = new PcmTrack(sampleRate, DRIVE_SEEK_DURATION);
  track.add(0.01, renderSeek(sampleRate, 0.16, random, 1.1));
  track.add(0.18, renderClunk(sampleRate, random, 0.7));
  track.add(0.24, renderSeek(sampleRate, 0.07, random, 0.9));
  track.ramp(DRIVE_SEEK_DURATION - 0.08, DRIVE_SEEK_DURATION, 1, 0);
  return normalize(track.samples, 0.7);
}
