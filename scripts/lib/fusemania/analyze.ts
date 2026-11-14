/**
 * Audio to `Analysis`: the beat grid of a song and, on that grid, what the music does at every slot.
 *
 * Decode, split into three bands, pick onsets with millisecond resolution, follow the pulse (`tempo.ts`), find the
 * beat and the bar (`metre.ts`), fit `#BPMS`, then settle the offset on the attacks themselves and measure how well
 * the finished grid holds: the share of strong onsets on it and the worst drift over any 25 seconds.
 */
import {
  BINS,
  FINE_RATE,
  SAMPLE_RATE,
  STFT_RATE,
  binHz,
  decodeAudio,
  envelope,
  harmonicPart,
  lowpassZeroPhase,
  movingMean,
  onsetFunction,
  pickOnsets,
  spectrogram,
  type Onset,
} from "./dsp.js";
import {
  beatSeconds,
  encodeSeries,
  secondsBeat,
  type Analysis,
} from "./analysis.js";
import { chromaFrames, findMetre, pulsesPerBeat, type Metre } from "./metre.js";
import {
  clarityAt,
  fitSegments,
  fitWarp,
  pulseAt,
  pulseFrequency,
  timeOfPulse,
  type BandOnset,
} from "./tempo.js";

/** Onsets in the low (under 150 Hz), mid and high (over 2.5 kHz) bands, in time order. */
export function bandOnsets(x: Float32Array, threshold: number): BandOnset[] {
  const low = lowpassZeroPhase(x, 150);
  const body = lowpassZeroPhase(x, 2500);
  const mid = new Float32Array(x.length),
    high = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    mid[i] = body[i]! - low[i]!;
    high[i] = x[i]! - body[i]!;
  }
  const pick = (signal: Float32Array, boxMs: number, band: 0 | 1 | 2) =>
    pickOnsets(
      onsetFunction(envelope(signal, boxMs)),
      FINE_RATE,
      30,
      threshold,
    ).map((onset) => ({ ...onset, band }));
  // The low band needs a window of two periods of its lowest notes to be an envelope and not the waveform.
  return [...pick(low, 20, 0), ...pick(mid, 6, 1), ...pick(high, 6, 2)].sort(
    (a, b) => a.time - b.time,
  );
}

export interface ToneOnset extends Onset {
  /** Where the new sound sits, in semitones above 150 Hz. */
  pitch: number;
}

/**
 * How long before a sustained note's true start its onset is detected: the spectrogram frame that first overlaps
 * the note already rises. Measured on synthetic tones (see `selfTest`).
 */
export const TONE_LEAD = 0.012;

/** Onsets of sustained sound (a note or chord that was not there before), with where in pitch it appeared. */
export function toneOnsets(
  harmonic: Float32Array,
  frames: number,
  threshold: number,
): ToneOnset[] {
  const root = new Float32Array(harmonic.length);
  for (let i = 0; i < harmonic.length; i++) root[i] = Math.sqrt(harmonic[i]!);
  const level = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let bin = 0; bin < BINS; bin++) sum += root[frame * BINS + bin]!;
    level[frame] = sum;
  }
  const local = movingMean(level, Math.round(1.5 * STFT_RATE));
  let total = 0;
  for (const value of level) total += value;
  const floor = (0.08 * total) / Math.max(1, frames) + 1e-9;
  const flux = new Float32Array(frames);
  for (let frame = 1; frame < frames - 1; frame++) {
    let rise = 0;
    for (let bin = 0; bin < BINS; bin++) {
      const change =
        root[(frame + 1) * BINS + bin]! - root[(frame - 1) * BINS + bin]!;
      if (change > 0) rise += change;
    }
    flux[frame] = rise / (local[frame]! + floor);
  }
  return pickOnsets(flux, STFT_RATE, 50, threshold).map((onset) => {
    const frame = Math.min(
      frames - 3,
      Math.max(2, Math.round(onset.time * STFT_RATE)),
    );
    let weight = 0,
      sum = 0;
    for (let bin = 0; bin < BINS; bin++) {
      const change =
        root[(frame + 2) * BINS + bin]! - root[(frame - 2) * BINS + bin]!;
      if (change <= 0) continue;
      weight += change * change;
      sum += change * change * 12 * Math.log2(binHz(bin) / 150);
    }
    return {
      time: onset.time + TONE_LEAD,
      strength: onset.strength,
      pitch: weight > 0 ? sum / weight : 0,
    };
  });
}

const percentile = (values: readonly number[], share: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * share))
  ]!;
};

const median = (values: readonly number[]): number => percentile(values, 0.5);

/** The weighted median of `values`. */
function weightedMedian(
  values: readonly number[],
  weights: readonly number[],
): number {
  const order = values.map((_, index) => index);
  order.sort((a, b) => values[a]! - values[b]!);
  let total = 0;
  for (const weight of weights) total += weight;
  let seen = 0;
  for (const index of order) {
    seen += weights[index]!;
    if (seen >= total / 2) return values[index]!;
  }
  return 0;
}

/** What each slot of a beat is, from how much onset strength the song puts on each. */
function slotLevels(share: readonly number[]): string {
  const slots = share.length;
  if (slots === 4) return "QSES";
  let eighth = 1;
  for (let slot = 2; slot < slots; slot++)
    if (share[slot]! > share[eighth]!) eighth = slot;
  let out = "Q";
  for (let slot = 1; slot < slots; slot++)
    out +=
      slot === eighth
        ? "E"
        : share[slot]! >= 0.3 * share[eighth]!
          ? "S"
          : "X";
  return out;
}

export interface AnalyzeDebug {
  metre: Metre;
  pulsesPerBeat: number;
  pulseHz: number;
  slotShare: readonly number[];
}

export function analyzeSamples(
  id: string,
  x: Float32Array,
  debug?: (info: AnalyzeDebug) => void,
): Analysis {
  const duration = x.length / SAMPLE_RATE;
  const onsets = bandOnsets(x, 0.04);
  const tracked = onsets.filter((onset) => onset.strength >= 0.08);
  // Timing is read from the mid and high bands: an attack's click is there. The low band's envelope rises ten to
  // twenty milliseconds after it (and on a song with a busy sub-bass, at any time at all).
  const sharp = tracked.filter((onset) => onset.band !== 0);
  const warp = fitWarp(sharp, duration, pulseFrequency(sharp, duration));
  const pulses = tracked.map((onset) => pulseAt(warp, onset.time));
  const perBeat = pulsesPerBeat(
    sharp,
    sharp.map((onset) => pulseAt(warp, onset.time)),
    warp.f,
  );

  const { frames, data } = spectrogram(x);
  const harmonic = harmonicPart(data, frames, 15);
  const chroma = chromaFrames(harmonic, frames);
  const power = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) power[i + 1] = power[i]! + x[i]! * x[i]!;
  const loudness = (from: number, to: number): number => {
    const first = Math.max(
        0,
        Math.min(x.length, Math.round(from * SAMPLE_RATE)),
      ),
      last = Math.max(first, Math.min(x.length, Math.round(to * SAMPLE_RATE)));
    return last > first
      ? Math.sqrt((power[last]! - power[first]!) / (last - first))
      : 0;
  };
  const metre = findMetre({
    onsets: tracked,
    pulses,
    pulsesPerBeat: perBeat,
    timeOf: (pulse) => timeOfPulse(warp, pulse),
    duration,
    chroma,
    frames,
    loudness,
  });

  // Beat 0 is the first bar line at or after the start of the file.
  const barPulses = 4 * perBeat;
  let origin = metre.downbeatPulse;
  while (timeOfPulse(warp, origin - barPulses) >= 0.01) origin -= barPulses;
  while (timeOfPulse(warp, origin) < 0.01) origin += barPulses;
  const beatTimes: number[] = [];
  for (let beat = 0; ; beat++) {
    const time = timeOfPulse(warp, origin + beat * perBeat);
    beatTimes.push(time);
    if (time > duration && beat % 4 === 0) break;
  }
  let bpms = fitSegments(beatTimes, 4, 0.005);
  let offset = -beatTimes[0]!;

  // The grid: straight songs get sixteenths; triplet songs get the pulses themselves.
  const slotsPerBeat =
    perBeat === 3 || perBeat === 6 || perBeat === 12
      ? perBeat === 3
        ? 3
        : 6
      : 4;
  const beats = beatTimes.length - 1;
  const slots = beats * slotsPerBeat;
  const timing = () => ({ offset, bpms });
  const slotOf = (time: number): { slot: number; error: number } => {
    const at = secondsBeat(timing(), time) * slotsPerBeat;
    const slot = Math.round(at);
    return {
      slot,
      error: time - beatSeconds(timing(), slot / slotsPerBeat),
    };
  };
  const reach = (slot: number): number =>
    Math.min(
      0.04,
      0.45 *
        (beatSeconds(timing(), (slot + 1) / slotsPerBeat) -
          beatSeconds(timing(), slot / slotsPerBeat)),
    );

  // Which slots of a beat the song uses.
  const shareOf = (): number[] => {
    const share = new Array<number>(slotsPerBeat).fill(0);
    for (const onset of sharp) {
      const { slot, error } = slotOf(onset.time);
      if (Math.abs(error) <= 0.02)
        share[((slot % slotsPerBeat) + slotsPerBeat) % slotsPerBeat]! +=
          onset.strength;
    }
    return share;
  };
  let levels = slotLevels(shareOf());

  // Settle the offset on the attacks: the weighted median distance of strong onsets from the slots in use.
  const strong = sharp.filter((onset) => onset.strength >= 0.3);
  const used = (slot: number): boolean =>
    levels[((slot % slotsPerBeat) + slotsPerBeat) % slotsPerBeat] !== "X";
  const errors = (): { error: number; weight: number; time: number }[] => {
    const out: { error: number; weight: number; time: number }[] = [];
    for (const onset of strong) {
      const { slot, error } = slotOf(onset.time);
      if (used(slot) && Math.abs(error) <= reach(slot))
        out.push({ error, weight: onset.strength, time: onset.time });
    }
    return out;
  };
  const settle = (): void => {
    for (let round = 0; round < 3; round++) {
      const list = errors();
      offset -= weightedMedian(
        list.map((item) => item.error),
        list.map((item) => item.weight),
      );
    }
  };
  settle();
  // And the tempo: if the attacks run steadily ahead of or behind the grid, every segment is that much off.
  for (let round = 0; round < 2; round++) {
    const list = errors();
    let n = 0,
      st = 0,
      se = 0,
      stt = 0,
      ste = 0;
    for (const { error, weight, time } of list) {
      n += weight;
      st += weight * time;
      se += weight * error;
      stt += weight * time * time;
      ste += weight * time * error;
    }
    const slope = (n * ste - st * se) / Math.max(n * stt - st * st, 1e-9);
    if (!(Math.abs(slope) < 1e-3)) break;
    bpms = bpms.map(
      ([beat, bpm]) =>
        [beat, Math.round((bpm / (1 + slope)) * 1000) / 1000] as const,
    );
    settle();
  }
  levels = slotLevels(shareOf());

  // How well the finished grid holds.
  const finalErrors = errors();
  let onGrid = 0,
    considered = 0,
    usedSlots = 0;
  for (const onset of strong) {
    const { slot, error } = slotOf(onset.time);
    considered++;
    if (used(slot) && Math.abs(error) <= 0.025) onGrid++;
  }
  for (const level of levels) if (level !== "X") usedSlots++;
  const meanBeat = (beatTimes[beats]! - beatTimes[0]!) / beats;
  const chance = Math.min(1, (usedSlots * 0.05) / meanBeat);
  let drift = 0;
  for (let start = 0; start + 12.5 < duration; start += 12.5) {
    const inside = finalErrors.filter(
      (item) => item.time >= start && item.time < start + 25,
    );
    if (inside.length >= 12)
      drift = Math.max(
        drift,
        Math.abs(
          weightedMedian(
            inside.map((item) => item.error),
            inside.map((item) => item.weight),
          ),
        ),
      );
  }

  // Per-slot series.
  const series = (list: readonly Onset[]): Float32Array => {
    const out = new Float32Array(slots);
    for (const onset of list) {
      const { slot, error } = slotOf(onset.time);
      if (slot >= 0 && slot < slots && Math.abs(error) <= reach(slot))
        out[slot] = Math.max(out[slot]!, onset.strength);
    }
    return out;
  };
  const scaled = (values: Float32Array): number[] => {
    const present = [...values].filter((value) => value > 0);
    const strongLevel = percentile(present, 0.9) || 1;
    return [...values].map((value) => (30 * value) / strongLevel);
  };
  const tones = toneOnsets(harmonic, frames, 0.05);
  const pitch = new Float32Array(slots);
  const toneStrength = new Float32Array(slots);
  for (const tone of tones) {
    const { slot, error } = slotOf(tone.time);
    if (slot < 0 || slot >= slots || Math.abs(error) > reach(slot)) continue;
    if (tone.strength > toneStrength[slot]!) {
      toneStrength[slot] = tone.strength;
      pitch[slot] = 1 + Math.max(0, Math.min(57, Math.round(tone.pitch)));
    }
  }
  const sustained = new Float32Array(slots);
  for (let slot = 0; slot < slots; slot++) {
    // The sustained sound over the slot: the harmonic spectrogram's magnitude, from the slot to the next.
    const from = beatSeconds(timing(), slot / slotsPerBeat),
      to = beatSeconds(timing(), (slot + 1) / slotsPerBeat);
    const first = Math.max(0, Math.round(from * STFT_RATE)),
      last = Math.min(frames - 1, Math.round(to * STFT_RATE));
    let sum = 0,
      count = 0;
    for (let frame = first; frame <= last; frame++) {
      for (let bin = 0; bin < BINS; bin++) sum += harmonic[frame * BINS + bin]!;
      count++;
    }
    sustained[slot] = count > 0 ? sum / count : 0;
  }
  const loud = percentile([...sustained], 0.95) || 1;

  // Per-bar series.
  const bars = beats / 4;
  const decibels: number[] = [],
    clarity: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const from = beatSeconds(timing(), bar * 4),
      to = beatSeconds(timing(), bar * 4 + 4);
    decibels.push(20 * Math.log10(loudness(from, to) + 1e-6));
    let sum = 0;
    for (let i = 0; i < 8; i++)
      sum += clarityAt(warp, from + ((to - from) * (i + 0.5)) / 8);
    clarity.push(sum / 8);
  }
  const top = percentile(decibels, 0.95);
  const energy = decibels.map((value) =>
    Math.max(0, Math.min(1, (value - (top - 24)) / 24)),
  );

  // Four-bar phrases start where the loudness and the harmony turn over.
  const barChroma = (bar: number): Float64Array => {
    const out = new Float64Array(12);
    const first = Math.max(
        0,
        Math.round(beatSeconds(timing(), bar * 4) * STFT_RATE),
      ),
      last = Math.min(
        frames - 1,
        Math.round(beatSeconds(timing(), bar * 4 + 4) * STFT_RATE),
      );
    for (let frame = first; frame <= last; frame++)
      for (let p = 0; p < 12; p++)
        out[p] = out[p]! + chroma[frame * 12 + p]!;
    return out;
  };
  const turn = new Array<number>(4).fill(0);
  for (let bar = 1; bar < bars; bar++) {
    const a = barChroma(bar),
      b = barChroma(bar - 1);
    let dot = 0,
      aa = 0,
      bb = 0;
    for (let p = 0; p < 12; p++) {
      dot += a[p]! * b[p]!;
      aa += a[p]! * a[p]!;
      bb += b[p]! * b[p]!;
    }
    const harmonyTurn = aa > 0 && bb > 0 ? 1 - dot / Math.sqrt(aa * bb) : 0;
    turn[bar % 4]! +=
      Math.abs(energy[bar]! - energy[bar - 1]!) + 2 * harmonyTurn;
  }
  const phrase = turn.indexOf(Math.max(...turn));

  // The preview: the loudest twelve seconds that start on a bar line (a phrase start, if one is as loud).
  let sampleBar = 0,
    sampleScore = -1;
  for (let bar = 0; bar < bars; bar++) {
    const from = beatSeconds(timing(), bar * 4);
    if (from + 14 > duration) break;
    let sum = 0,
      count = 0;
    for (
      let other = bar;
      other < bars && beatSeconds(timing(), other * 4) < from + 12;
      other++
    ) {
      sum += energy[other]!;
      count++;
    }
    const score =
      sum / Math.max(1, count) + (bar % 4 === phrase ? 0.03 : 0);
    if (score > sampleScore + 1e-9) {
      sampleScore = score;
      sampleBar = bar;
    }
  }

  debug?.({
    metre,
    pulsesPerBeat: perBeat,
    pulseHz: warp.f,
    slotShare: shareOf(),
  });
  const round = (value: number, digits: number): number =>
    Number(value.toFixed(digits));
  return {
    id,
    duration: round(duration, 3),
    offset: round(offset, 3),
    bpms,
    slotsPerBeat,
    levels,
    phrase,
    sample: [round(beatSeconds(timing(), sampleBar * 4), 3), 12],
    quality: {
      align: round(onGrid / Math.max(1, considered), 3),
      chance: round(chance, 3),
      driftMs: round(drift * 1000, 1),
      rampMs: round(warp.ramp * 1000, 0),
      pulse: round(median([...warp.clarity]), 2),
      downbeat: round(metre.confidence, 2),
    },
    energy: encodeSeries(energy.map((value) => 61 * value)),
    clarity: encodeSeries(clarity.map((value) => (61 * value) / 0.7)),
    low: encodeSeries(
      scaled(series(onsets.filter((onset) => onset.band === 0))),
    ),
    mid: encodeSeries(
      scaled(series(onsets.filter((onset) => onset.band === 1))),
    ),
    high: encodeSeries(
      scaled(series(onsets.filter((onset) => onset.band === 2))),
    ),
    tone: encodeSeries(scaled(toneStrength)),
    pitch: encodeSeries(pitch),
    level: encodeSeries([...sustained].map((value) => (50 * value) / loud)),
  };
}

export const analyzeFile = (
  id: string,
  file: string,
  debug?: (info: AnalyzeDebug) => void,
): Analysis => analyzeSamples(id, decodeAudio(file), debug);
