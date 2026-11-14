/**
 * Metre for the Fusemania chart generator: which pulses are beats and which beats start a bar.
 *
 * `tempo.ts` leaves the song in pulse coordinates, where it is exactly periodic. Here the beat length is chosen
 * among whole numbers of pulses by how much of the onset weight repeats at the beat and half-beat and by how
 * natural the tempo is to step to; then the beat's place among those pulses and the bar's among four beats are
 * chosen together, from where the kick sits, where the harmony changes and where sections turn over.
 */
import { BINS, STFT_RATE, binHz } from "./dsp.js";
import { onsetWeight, type BandOnset } from "./tempo.js";

const TAU = 2 * Math.PI;

/** How natural a tempo is to step to: widest around 125 BPM, half as likely an octave away. */
const tempoPrior = (bpm: number): number => {
  const octaves = Math.log2(bpm / 125) / 0.5;
  return Math.exp(-0.5 * octaves * octaves);
};

export const MIN_BPM = 78;
export const MAX_BPM = 185;

/**
 * Pulses per beat: the candidate whose beat and half-beat carry the most onset weight, among those that give a
 * tempo between `MIN_BPM` and `MAX_BPM` (any, if none does).
 */
export function pulsesPerBeat(
  onsets: readonly BandOnset[],
  pulses: readonly number[],
  pulseHz: number,
): number {
  const share = (cycles: number): number => {
    let re = 0,
      im = 0,
      total = 0;
    for (let i = 0; i < onsets.length; i++) {
      const weight = onsetWeight(onsets[i]!),
        angle = TAU * cycles * pulses[i]!;
      re += weight * Math.cos(angle);
      im += weight * Math.sin(angle);
      total += weight;
    }
    return Math.hypot(re, im) / Math.max(total, 1e-9);
  };
  const candidates = [2, 3, 4, 6, 8, 12];
  const inRange = candidates.filter((n) => {
    const bpm = (pulseHz * 60) / n;
    return bpm >= MIN_BPM && bpm <= MAX_BPM;
  });
  let best = 4,
    bestScore = -1;
  for (const n of inRange.length > 0 ? inRange : candidates) {
    const score =
      tempoPrior((pulseHz * 60) / n) * (share(1 / n) + share(2 / n));
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** The strongest onset of `band` within `reach` pulses of each whole pulse, indexed by pulse minus `first`. */
export function strengthByPulse(
  onsets: readonly BandOnset[],
  pulses: readonly number[],
  band: number,
  first: number,
  count: number,
  reach: number,
): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < onsets.length; i++) {
    if (onsets[i]!.band !== band) continue;
    const nearest = Math.round(pulses[i]!);
    if (Math.abs(pulses[i]! - nearest) > reach) continue;
    const at = nearest - first;
    if (at >= 0 && at < count)
      out[at] = Math.max(out[at]!, onsets[i]!.strength);
  }
  return out;
}

/** Twelve pitch classes per spectrogram frame, from the harmonic part between 300 Hz and 3 kHz. */
export function chromaFrames(
  harmonic: Float32Array,
  frames: number,
): Float32Array {
  const out = new Float32Array(frames * 12);
  const classes: number[] = [];
  for (let bin = 0; bin < BINS; bin++) {
    const hz = binHz(bin);
    classes.push(
      hz < 300 || hz > 3000
        ? -1
        : ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12,
    );
  }
  for (let frame = 0; frame < frames; frame++)
    for (let bin = 0; bin < BINS; bin++) {
      const pitch = classes[bin]!;
      if (pitch >= 0) {
        const at = frame * 12 + pitch;
        out[at] = out[at]! + harmonic[frame * BINS + bin]!;
      }
    }
  return out;
}

/** The mean chroma between two times. */
function chromaBetween(
  chroma: Float32Array,
  frames: number,
  from: number,
  to: number,
): Float64Array {
  const out = new Float64Array(12);
  const first = Math.max(0, Math.round(from * STFT_RATE)),
    last = Math.min(frames - 1, Math.round(to * STFT_RATE));
  for (let frame = first; frame <= last; frame++)
    for (let pitch = 0; pitch < 12; pitch++)
      out[pitch] = out[pitch]! + chroma[frame * 12 + pitch]!;
  return out;
}

function cosineDistance(a: Float64Array, b: Float64Array): number {
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return aa > 0 && bb > 0 ? 1 - dot / Math.sqrt(aa * bb) : 0;
}

export interface MetreInput {
  onsets: readonly BandOnset[];
  /** Each onset's pulse coordinate. */
  pulses: readonly number[];
  pulsesPerBeat: number;
  /** The time of a pulse coordinate. */
  timeOf: (pulse: number) => number;
  duration: number;
  chroma: Float32Array;
  frames: number;
  /** Loudness (RMS) between two times. */
  loudness: (from: number, to: number) => number;
}

export interface MetreCandidate {
  /** The candidate first beat's pulse offset within the bar. */
  offset: number;
  score: number;
  /** How much more the harmony changes on this beat than on the average beat (1 is average). */
  harmony: number;
  /** The share of the song's section changes (large loudness steps, in decibels) that fall on this beat of the bar. */
  form: number;
  /** Kick on this beat and the third, less the second and fourth, in units of the average kick. */
  drums: number;
  /** Snare on the second and fourth, less the first and third. */
  backbeat: number;
  /** Whether the song's first sound falls on this beat of the bar. */
  entry: number;
}

export interface Metre {
  /** The pulse coordinate of a bar's first beat: every `4 * pulsesPerBeat` pulses from here is another. */
  downbeatPulse: number;
  /** How far the chosen bar phase stands above the next best, 0 to 1. */
  confidence: number;
  /** Every candidate, best first, for the report. */
  candidates: readonly MetreCandidate[];
}

const mean = (values: readonly number[]): number =>
  values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/**
 * The bar's phase. Every pulse position that could be a beat (the most kick-heavy position within a beat and, if it is nearly as heavy, the one half a beat away) is
 * tried at each of the four beats of a bar, and scored on what a first beat has that others lack:
 *
 * - harmony: chords change on the first beat, so the chroma of the two beats after differs most from the two before;
 * - form: sections change on a bar line, so the song's large steps in loudness fall there;
 * - entry: the first sound of the song is, more often than not, a first beat;
 * - the kick: low-band onsets land on the beat, and on 1 and 3 more than 2 and 4;
 * - the backbeat: mid and high onsets (snare, clap) lean to 2 and 4.
 */
export function findMetre(input: MetreInput): Metre {
  const { onsets, pulses, pulsesPerBeat: n, timeOf, duration } = input;
  const bar = 4 * n;
  let lowPulse = Infinity,
    highPulse = -Infinity;
  for (const pulse of pulses) {
    lowPulse = Math.min(lowPulse, pulse);
    highPulse = Math.max(highPulse, pulse);
  }
  const first = Math.floor(lowPulse / bar) * bar - bar,
    count = Math.ceil(highPulse) - first + bar;
  const bands = [0, 1, 2].map((band) =>
    strengthByPulse(onsets, pulses, band, first, count, 0.35),
  );
  const [kick, snare, hat] = [bands[0]!, bands[1]!, bands[2]!];
  // How much of the drums each position within a beat carries: kick and snare in full, hats by half.
  const profile = new Float64Array(n);
  const totals = bands.map((band) =>
    Math.max(
      band.reduce((a, b) => a + b, 0),
      1e-9,
    ),
  );
  for (let at = 0; at < count; at++) {
    const position = (((at + first) % n) + n) % n;
    profile[position] =
      profile[position]! +
      kick[at]! / totals[0]! +
      snare[at]! / totals[1]! +
      (0.5 * hat[at]!) / totals[2]!;
  }
  let top = 0;
  for (let position = 1; position < n; position++)
    if (profile[position]! > profile[top]!) top = position;
  const positions = [top];
  // Half a beat away is the one other place the beat could be: a song whose bass plays the off-beats.
  const other = (top + n / 2) % n;
  if (n % 2 === 0 && profile[other]! >= 0.55 * profile[top]!)
    positions.push(other);
  const scored: MetreCandidate[] = [];
  for (const position of positions) {
    // Every beat of this position that lies inside the audio, as pulse coordinates.
    const beats: number[] = [];
    for (
      let pulse = first + ((((position - first) % n) + n) % n);
      pulse < first + count;
      pulse += n
    )
      if (timeOf(pulse) >= 0 && timeOf(pulse + n) <= duration)
        beats.push(pulse);
    const total = beats.length;
    const chromas = beats.map((pulse) =>
      chromaBetween(
        input.chroma,
        input.frames,
        timeOf(pulse) + 0.03,
        timeOf(pulse + n) - 0.03,
      ),
    );
    const decibels = beats.map(
      (pulse) =>
        20 *
        Math.log10(input.loudness(timeOf(pulse), timeOf(pulse + n)) + 1e-5),
    );
    const chromaOver = (from: number, to: number): Float64Array => {
      const out = new Float64Array(12);
      for (let i = Math.max(0, from); i < Math.min(total, to); i++)
        for (let p = 0; p < 12; p++) out[p] = out[p]! + chromas[i]![p]!;
      return out;
    };
    const change = beats.map((_, i) =>
      i >= 2 && i + 2 <= total
        ? cosineDistance(chromaOver(i, i + 2), chromaOver(i - 2, i))
        : 0,
    );
    // Section changes: the largest steps in loudness between the eight beats before and after a beat.
    const step = beats.map((_, i) => {
      if (i < 8 || i + 8 > total) return 0;
      return Math.abs(
        mean(decibels.slice(i, i + 8)) - mean(decibels.slice(i - 8, i)),
      );
    });
    const turns: number[] = [];
    for (let i = 0; i < total; i++) {
      if (step[i]! < 1.5) continue;
      let top = true;
      for (let j = Math.max(0, i - 6); j <= Math.min(total - 1, i + 6); j++)
        if (step[j]! > step[i]!) top = false;
      if (top) turns.push(i);
    }
    turns.sort((a, b) => step[b]! - step[a]!);
    const votes = [0, 0, 0, 0];
    for (const i of turns.slice(0, 10)) votes[i % 4]! += step[i]!;
    const voteTotal = votes.reduce((a, b) => a + b, 0);
    // The song's first sound: the first beat within 30 dB of the loud parts.
    const loud = [...decibels].sort((a, b) => a - b)[Math.floor(total * 0.9)]!;
    const entry = decibels.findIndex((value) => value > loud - 30);
    const kicks = beats.map((pulse) => kick[pulse - first]!),
      snares = beats.map(
        (pulse) => snare[pulse - first]! + 0.5 * hat[pulse - first]!,
      );
    const norm = (values: readonly number[]) => Math.max(mean(values), 1e-9);
    const changeNorm = norm(change),
      kickNorm = norm(kicks),
      snareNorm = norm(snares);
    const beatWeight = profile[position]! / profile[positions[0]!]!;
    for (let phase = 0; phase < 4; phase++) {
      const pick = (values: readonly number[], shift: number) =>
        mean(values.filter((_, i) => (i - phase - shift + 8) % 4 === 0));
      const harmony = pick(change, 0) / changeNorm,
        form = votes[phase]! / (voteTotal + 8),
        drums =
          (pick(kicks, 0) + 0.6 * pick(kicks, 2)) / kickNorm -
          (pick(kicks, 1) + pick(kicks, 3)) / (2 * kickNorm),
        backbeat =
          (pick(snares, 1) + pick(snares, 3)) / (2 * snareNorm) -
          (pick(snares, 0) + pick(snares, 2)) / (2 * snareNorm),
        entryTerm = entry >= 0 && entry % 4 === phase ? 1 : 0;
      const score =
        (1.0 * harmony +
          1.0 * form +
          0.3 * entryTerm +
          0.35 * drums +
          0.35 * backbeat) *
        (0.6 + 0.4 * beatWeight);
      scored.push({
        offset: ((beats[phase]! % bar) + bar) % bar,
        score,
        harmony,
        form,
        drums,
        backbeat,
        entry: entryTerm,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!,
    next = scored[1]?.score ?? 0;
  return {
    downbeatPulse: best.offset,
    confidence: Math.max(
      0,
      Math.min(1, (best.score - next) / Math.max(best.score, 1e-9)),
    ),
    candidates: scored,
  };
}
