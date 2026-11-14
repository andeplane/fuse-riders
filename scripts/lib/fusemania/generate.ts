/**
 * Analysis to charts: Easy, Medium, Hard and Challenge for one song, deterministically.
 *
 * Two stages, both driven by what the music does on the grid:
 *
 * 1. Rhythm (`pickRows`): which slots carry a step. Every slot has a salience (an onset in some band); each
 *    difficulty takes the most salient slots of each bar that its level allows (beats only on Easy, off-beat
 *    eighths from Medium, sixteenth-level slots from Hard), up to a density that follows the bar's energy, and never
 *    a slot with no onset. A harder chart starts from the easier one's rows, so the four agree with each other.
 *    Accents become jumps and sustained notes become freezes.
 * 2. Steps (`placeSteps`): which arrow each row is. A beam search over the two feet's positions: feet alternate,
 *    neither crosses the other below Hard, a rising melody moves right and a falling one left, and a bar whose
 *    rhythm repeats an earlier bar of the phrase sometimes gets that bar's arrows (or their mirror image).
 *
 * How much of everything comes from `reference.ts`, the statistics of published charts: how many notes a second,
 * how many jumps and freezes and where, and which arrow tends to follow which at each speed. Those are frequencies,
 * so the search samples them (`gumbel`) and does not copy any chart; `compare.ts` measures how close the result is.
 *
 * Everything random is drawn from a hash of the song id, the difficulty and the place in the song.
 */
import { beatSeconds, decodeSeries, type Analysis } from "./analysis.js";
import {
  ARROWS,
  referenceFor,
  speedOf,
  type Reference,
  type Speed,
} from "./reference.js";

export type Difficulty = "Easy" | "Medium" | "Hard" | "Challenge";
export const DIFFICULTIES: readonly Difficulty[] = [
  "Easy",
  "Medium",
  "Hard",
  "Challenge",
];

export interface Note {
  /** Slots from beat 0: `slot / slotsPerBeat` is the beat. */
  slot: number;
  /** 0 Left, 1 Down, 2 Up, 3 Right. */
  column: number;
  kind: "tap" | "hold" | "mine";
  /** Holds: the slot of the tail. */
  endSlot?: number;
}

export interface Chart {
  difficulty: Difficulty;
  meter: number;
  /** In slot order, then column order. */
  notes: Note[];
}

interface Tuning {
  /**
   * Notes per second over the whole chart, for a song at 135 beats a minute: the median of the published charts of
   * this difficulty. A slower song gets fewer and a faster one more (the square root of the tempo, within 15%).
   */
  nps: number;
  /** How a bar's share of that moves with its energy: times this in the quietest bars and in the busiest. */
  range: readonly [number, number];
  /** The most rows per second any four-beat window may hold. */
  cap: number;
  /** How much a slot of each level counts: beat, off-beat eighth, sixteenth level. 0 bars the level. */
  levels: { Q: number; E: number; S: number };
  /** The share of the bars, busiest first, that may use the sixteenth level: fast runs come in bursts. */
  sixteenths: number;
  /** How much an off-beat eighth gains from the off-beat a beat away being stepped: 1 for nothing. */
  runs: number;
  /** How much hi-hats count as something to step on. */
  hats: number;
  /** The least salience a slot needs to carry a step (1 is a strong onset). */
  floor: number;
  /** The most rows a sixteenth-speed run may have. */
  burst: number;
  /** The least time between two rows, in seconds, whatever the grid allows. */
  gap: number;
  /**
   * Jumps: how many a bar may have, the clear space needed either side, in beats, and the space needed on the
   * roomier side. How many there are comes from the reference.
   */
  jump: { perBar: number; clear: number; wide: number };
  /** Freezes: how many rows the other foot may take while one is held. How many and how long: the reference. */
  hold: { rowsInside: number; clears: number };
  /** Mines: how many at most, and how many beats apart. */
  mines: { most: number; apart: number };
  /** Whether a foot may cross the other, and what it costs on top of how rare the pattern is in the reference. */
  crossover: number | undefined;
  /** What a foot going straight from Up to Down (or back) costs, likewise. */
  candle: number;
  /** The shortest gap, in beats, at which the same arrow may come twice running. */
  jack: number;
  /** How often a bar that repeats an earlier bar's rhythm is given its arrows (or their mirror image) again. */
  echo: number;
  /** The meter from the chart's rows per second, over the whole chart and over its busiest four beats. */
  meter: (average: number, peak: number) => number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const TUNING: Record<Difficulty, Tuning> = {
  Easy: {
    nps: 1.55,
    range: [0.7, 1.25],
    cap: 2.2,
    levels: { Q: 1, E: 0, S: 0 },
    sixteenths: 0,
    runs: 1,
    hats: 0.5,
    floor: 0.3,
    gap: 0.3,
    burst: 1,
    jump: { perBar: 1, clear: 1, wide: 2 },
    hold: { rowsInside: 0, clears: 2 },
    mines: { most: 0, apart: 0 },
    crossover: undefined,
    candle: 1,
    jack: 1,
    echo: 0.6,
    meter: (average) => 2 + clamp(Math.round((average - 1.2) / 0.15), 0, 2),
  },
  Medium: {
    nps: 2.37,
    range: [0.6, 1.35],
    cap: 3.6,
    levels: { Q: 1, E: 1.1, S: 0 },
    sixteenths: 0,
    runs: 1,
    hats: 0.7,
    floor: 0.3,
    gap: 0.16,
    burst: 1,
    jump: { perBar: 2, clear: 1, wide: 0 },
    hold: { rowsInside: 1, clears: 2 },
    mines: { most: 0, apart: 0 },
    crossover: undefined,
    candle: 0.6,
    jack: 0.5,
    echo: 0.4,
    meter: (average) => 5 + clamp(Math.round((average - 1.9) / 0.2), 0, 2),
  },
  Hard: {
    nps: 3.3,
    range: [0.5, 1.5],
    cap: 5.5,
    levels: { Q: 1, E: 1.05, S: 2.1 },
    sixteenths: 0.5,
    runs: 1.6,
    hats: 0.85,
    floor: 0.25,
    gap: 0.095,
    burst: 5,
    jump: { perBar: 2, clear: 0.5, wide: 0 },
    hold: { rowsInside: 3, clears: 0 },
    mines: { most: 4, apart: 16 },
    crossover: 0.8,
    candle: 0.2,
    jack: 0.5,
    echo: 0.3,
    meter: (average) => 8 + clamp(Math.round((average - 2.7) / 0.3), 0, 2),
  },
  Challenge: {
    nps: 4.8,
    range: [0.5, 1.5],
    cap: 8.5,
    levels: { Q: 1, E: 0.85, S: 2.3 },
    sixteenths: 0.6,
    runs: 1.6,
    hats: 1,
    floor: 0.2,
    gap: 0.07,
    burst: 17,
    jump: { perBar: 3, clear: 0.3, wide: 0 },
    hold: { rowsInside: 6, clears: 0 },
    mines: { most: 12, apart: 6 },
    crossover: 0.5,
    candle: 0.1,
    jack: 0.5,
    echo: 0.25,
    meter: (average, peak) =>
      10 + clamp(Math.round((0.6 * average + 0.4 * peak - 4.6) / 0.5), 0, 3),
  },
};

/** A 32-bit hash of a string (FNV-1a), the seed of everything random here. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** A number in [0, 1) from a seed and up to three integers. */
function noise(seed: number, a: number, b = 0, c = 0): number {
  let value = seed ^ Math.imul(a + 1, 0x9e3779b1);
  value =
    Math.imul(value ^ (value >>> 15), 0x85ebca6b) ^
    Math.imul(b + 1, 0xc2b2ae35);
  value =
    Math.imul(value ^ (value >>> 13), 0x27d4eb2f) ^
    Math.imul(c + 1, 0x165667b1);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

/** The song as the generator reads it. */
interface Song {
  analysis: Analysis;
  slotsPerBeat: number;
  perBar: number;
  slots: number;
  bars: number;
  /** Per slot, 1 is a strong onset. */
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  tone: Float32Array;
  /** Per slot: semitones, 0 for none. */
  pitch: Uint8Array;
  /** Per slot: sustained sound, 1 is the loud sections. */
  level: Float32Array;
  /** Per bar, 0 to 1: how loud the bar is among the song's bars. */
  energy: Float32Array;
  seconds: Float64Array;
  /** The first and last slot that may carry a step. */
  first: number;
  last: number;
}

function readSong(analysis: Analysis): Song {
  const slotsPerBeat = analysis.slotsPerBeat,
    perBar = 4 * slotsPerBeat;
  const scale = (text: string, unit: number): Float32Array =>
    Float32Array.from(decodeSeries(text), (value) => value / unit);
  const low = scale(analysis.low, 30),
    mid = scale(analysis.mid, 30),
    high = scale(analysis.high, 30),
    tone = scale(analysis.tone, 30);
  const slots = low.length,
    bars = Math.floor(slots / perBar);
  const seconds = new Float64Array(slots + 1);
  for (let slot = 0; slot <= slots; slot++)
    seconds[slot] = beatSeconds(analysis, slot / slotsPerBeat);
  // Energy: each bar with its neighbours, then spread between the song's quiet and loud bars.
  const raw = scale(analysis.energy, 61);
  const smooth = raw.map(
    (value, bar) =>
      (2 * value + (raw[bar - 1] ?? value) + (raw[bar + 1] ?? value)) / 4,
  );
  const sorted = Float32Array.from(smooth).sort();
  const quiet = sorted[Math.floor(sorted.length * 0.1)] ?? 0,
    loud = sorted[Math.floor(sorted.length * 0.9)] ?? 1;
  // A song that is loud throughout is busy throughout: the scale never spans less than seven decibels.
  const span = Math.max(loud - quiet, 0.3);
  const strength = (slot: number): number =>
    Math.max(low[slot]!, mid[slot]!, high[slot]!, tone[slot]!);
  // And how much is going on: the share of the bar's slots that sound, again between the song's sparse and busy bars.
  const busy = new Float32Array(smooth.length);
  for (let bar = 0; bar < bars; bar++) {
    let sum = 0;
    for (let slot = bar * perBar; slot < (bar + 1) * perBar; slot++)
      sum += Math.min(1, strength(slot));
    busy[bar] = sum / perBar;
  }
  const busySorted = Float32Array.from(busy.subarray(0, bars)).sort();
  const sparse = busySorted[Math.floor(bars * 0.1)] ?? 0,
    dense = busySorted[Math.floor(bars * 0.9)] ?? 1;
  const energy = smooth.map(
    (value, bar) =>
      0.5 * clamp((value - (loud - span)) / span, 0, 1) +
      0.5 *
        clamp(
          ((busy[bar] ?? 0) - sparse) / Math.max(dense - sparse, 0.05),
          0,
          1,
        ),
  );
  // Steps start on the first bar line two seconds in whose bar has a beat to step to: two of its beats sound.
  let first = slots;
  for (let bar = 0; bar < bars; bar++) {
    if (seconds[bar * perBar]! < 2) continue;
    let sounding = 0;
    for (let beat = 0; beat < 4; beat++)
      if (strength(bar * perBar + beat * slotsPerBeat) >= 0.4) sounding++;
    if (sounding >= 2) {
      first = bar * perBar;
      break;
    }
  }
  // And end on the last strong hit on a beat or an eighth that the file still has room to ring after.
  let last = first;
  for (let slot = slots - 1; slot > first; slot--) {
    const level = analysis.levels[slot % slotsPerBeat]!;
    if (
      (level === "Q" || level === "E") &&
      strength(slot) >= 0.7 &&
      seconds[slot]! < analysis.duration - 0.4
    ) {
      last = slot;
      break;
    }
  }
  return {
    analysis,
    slotsPerBeat,
    perBar,
    slots,
    bars,
    low,
    mid,
    high,
    tone,
    pitch: decodeSeries(analysis.pitch),
    level: scale(analysis.level, 50),
    energy,
    seconds,
    first,
    last,
  };
}

/** One row of a chart before it has arrows. */
interface Row {
  slot: number;
  jump: boolean;
  /** The tail's slot, when the row starts a freeze. */
  holdEnd?: number;
  /** Whether the row gave way to a freeze held alone. */
  dropped?: boolean;
}

/**
 * The rows of one difficulty. `base` is the easier chart's rows, all of which are kept. `placement`, when given,
 * replaces the rhythm this function would choose (the slots that carry a step); jumps and freezes are still added here.
 */
function pickRows(
  song: Song,
  difficulty: Difficulty,
  base: ReadonlySet<number>,
  placement?: readonly number[],
): Row[] {
  const tuning = TUNING[difficulty];
  const reference = referenceFor(difficulty);
  const { slotsPerBeat, perBar, analysis } = song;
  const levelOf = (slot: number): "Q" | "E" | "S" | "X" =>
    analysis.levels[slot % slotsPerBeat] as "Q" | "E" | "S" | "X";
  const jumpShare = reference.scalars.jump_share?.p50 ?? 0.07;

  // How many rows a second the chart aims at, and each bar's share of them.
  const firstBar = Math.floor(song.first / perBar),
    lastBar = Math.floor(song.last / perBar),
    barCount = lastBar - firstBar + 1;
  const span = song.seconds[song.last]! - song.seconds[song.first]!;
  const bpm =
    (60 * (song.last - song.first)) / slotsPerBeat / Math.max(1, span);
  const rowsPerSecond =
    (tuning.nps * clamp(Math.sqrt(bpm / 135), 0.85, 1.15)) / (1 + jumpShare);
  // The bars of a four-bar phrase aim at much the same density, so a rhythm that repeats is stepped the same way.
  const energyOf = (bar: number): number => {
    const phraseStart = bar - ((((bar - analysis.phrase) % 4) + 4) % 4);
    let phraseEnergy = 0,
      phraseBars = 0;
    for (let other = Math.max(0, phraseStart); other < phraseStart + 4; other++)
      if (other < song.bars) {
        phraseEnergy += song.energy[other]!;
        phraseBars++;
      }
    return (
      0.7 * (phraseEnergy / Math.max(1, phraseBars)) +
      0.3 * (song.energy[bar] ?? 0)
    );
  };
  const barSeconds = (bar: number): number =>
    song.seconds[Math.min(song.slots, (bar + 1) * perBar)]! -
    song.seconds[Math.min(song.slots, bar * perBar)]!;
  // Quiet bars thin out and busy ones fill in, and a chart builds the way published ones do (they are a few percent
  // busier in their last fifth): the reference's density curve, a tenth of the chart at a time.
  const shape = new Map<number, number>();
  let weighted = 0;
  for (let bar = firstBar; bar <= lastBar; bar++) {
    const tenth = Math.min(9, Math.floor((10 * (bar - firstBar)) / barCount));
    const value =
      (tuning.range[0] + (tuning.range[1] - tuning.range[0]) * energyOf(bar)) *
      (reference.densityCurve[tenth] ?? 1);
    shape.set(bar, value);
    weighted += value * barSeconds(bar);
  }
  const norm = weighted / Math.max(1e-9, span);
  // The sixteenth level only in the busiest bars.
  const ranked = [...shape.keys()].map(energyOf).sort((a, b) => b - a);
  const gate =
    tuning.sixteenths >= 1
      ? -1
      : (ranked[Math.floor(tuning.sixteenths * ranked.length)] ?? 2);
  const fast = (bar: number): boolean => energyOf(bar) > gate;
  const salience = new Float32Array(song.slots);
  for (let slot = 0; slot < song.slots; slot++)
    salience[slot] = Math.max(
      song.low[slot]!,
      song.mid[slot]!,
      song.tone[slot]!,
      tuning.hats * song.high[slot]!,
    );
  // A slot's priority leans on the same slot of the other bars of its four-bar phrase, so a phrase keeps a rhythm.
  const priority = (slot: number): number => {
    const bar = Math.floor(slot / perBar),
      within = slot % perBar;
    const start = bar - ((((bar - analysis.phrase) % 4) + 4) % 4);
    let sum = 0,
      count = 0;
    for (let other = Math.max(0, start); other < start + 4; other++) {
      const at = other * perBar + within;
      if (at < song.slots) {
        sum += salience[at]!;
        count++;
      }
    }
    phraseMean = sum / Math.max(1, count);
    const level = levelOf(slot);
    let weight = level === "X" ? 0 : tuning.levels[level];
    // On Easy the first and third beats come first.
    if (difficulty === "Easy" && (within / slotsPerBeat) % 2 === 1)
      weight *= 0.72;
    return (0.45 * salience[slot]! + 0.55 * phraseMean) * weight;
  };
  /** The salience of the slot `priority` was last asked about, averaged over the bars of its phrase. */
  let phraseMean = 0;

  const chosen = new Set<number>();
  const beatGap = (a: number, b: number): number =>
    Math.abs(a - b) / slotsPerBeat;
  /** Whether adding `slot` keeps every four-beat window under the cap and its neighbours far enough away. */
  const fits = (slot: number): boolean => {
    for (let near = slot - 1; near >= 0; near--) {
      if (song.seconds[slot]! - song.seconds[near]! >= tuning.gap) break;
      if (chosen.has(near)) return false;
    }
    for (let near = slot + 1; near < song.slots; near++) {
      if (song.seconds[near]! - song.seconds[slot]! >= tuning.gap) break;
      if (chosen.has(near)) return false;
    }
    for (let start = slot - perBar + 1; start <= slot; start++) {
      let rows = 1;
      for (let at = Math.max(0, start); at < start + perBar; at++)
        if (chosen.has(at)) rows++;
      const window =
        song.seconds[Math.min(song.slots, Math.max(0, start) + perBar)]! -
        song.seconds[Math.max(0, start)]!;
      if (rows > Math.max(2, Math.floor(tuning.cap * window))) return false;
    }
    return true;
  };
  /** How many rows a sixteenth-speed run through `slot` would have if `slot` were added. */
  const runLength = (slot: number): number => {
    let length = 1;
    for (
      let at = slot, next = slot - 1;
      next >= 0 && beatGap(at, next) < 0.4;
      next--
    )
      if (chosen.has(next)) {
        length++;
        at = next;
      } else if (beatGap(at, next) >= 0.3) break;
    for (
      let at = slot, next = slot + 1;
      next < song.slots && beatGap(at, next) < 0.4;
      next++
    )
      if (chosen.has(next)) {
        length++;
        at = next;
      } else if (beatGap(at, next) >= 0.3) break;
    return length;
  };

  /** The chart's rows, aiming `scale` times as high as `rowsPerSecond`. */
  const fill = (scale: number): void => {
    chosen.clear();
    for (const slot of base)
      if (slot >= song.first && slot <= song.last) chosen.add(slot);
    chosen.add(song.first);
    chosen.add(song.last);
    // What rounding a bar's rows leaves over goes to the next bar.
    let carry = 0;
    for (let bar = firstBar; bar <= lastBar; bar++) {
      const from = bar * perBar,
        to = Math.min(song.slots, from + perBar);
      const exact =
        ((scale * rowsPerSecond * (shape.get(bar) ?? 1)) / norm) *
          barSeconds(bar) +
        carry;
      const target = Math.round(exact);
      carry = clamp(exact - target, -0.5, 0.5);
      const candidates: number[] = [];
      let count = 0;
      for (let slot = from; slot < to; slot++) {
        if (chosen.has(slot)) count++;
        else if (
          slot > song.first &&
          slot < song.last &&
          priority(slot) > 0 &&
          (levelOf(slot) !== "S" || fast(bar)) &&
          // A slot the rest of the phrase hits hard needs only a faint onset of its own to keep the rhythm going.
          salience[slot]! >= (phraseMean >= 0.6 ? 0.5 : 1) * tuning.floor
        )
          candidates.push(slot);
      }
      // A slot the bar two back stepped on comes first among equals: published charts repeat a bar's rhythm two
      // bars on about a third of the time.
      const rank = new Map(
        candidates.map((slot) => [
          slot,
          priority(slot) * (chosen.has(slot - 2 * perBar) ? 1.4 : 1),
        ]),
      );
      candidates.sort((a, b) => rank.get(b)! - rank.get(a)! || a - b);
      // An off-beat next to one already stepped comes sooner, so eighths gather into runs and do not scatter.
      const joined = (slot: number): number =>
        levelOf(slot) === "E" &&
        (chosen.has(slot - slotsPerBeat) || chosen.has(slot + slotsPerBeat))
          ? tuning.runs
          : 1;
      const left = new Set(candidates);
      while (count < target && left.size > 0) {
        let slot = -1,
          best = -1;
        for (const other of left) {
          const value = rank.get(other)! * joined(other);
          if (value > best) {
            best = value;
            slot = other;
          }
        }
        left.delete(slot);
        if (!fits(slot) || runLength(slot) > tuning.burst) continue;
        chosen.add(slot);
        count++;
      }
    }
    // On a straight grid a sixteenth needs the step it leads into: alone it reads as a mistake. (A swung one is the
    // rhythm itself.)
    for (const slot of [...chosen].sort((a, b) => a - b)) {
      if (slotsPerBeat !== 4 || levelOf(slot) !== "S" || base.has(slot))
        continue;
      let leads = false;
      for (
        let next = slot + 1;
        next < song.slots && beatGap(slot, next) < 0.4;
        next++
      )
        if (chosen.has(next)) leads = true;
      if (!leads) chosen.delete(slot);
    }
  };
  // Where the music leaves fewer places to step than the aim, aim higher until the chart is as busy as it should be.
  let scale = 1;
  fill(scale);
  for (let round = 0; round < 3; round++) {
    const actual = (chosen.size - 1) / Math.max(1, span);
    if (Math.abs(actual / rowsPerSecond - 1) < 0.03) break;
    scale = clamp((scale * rowsPerSecond) / actual, 0.4, 2.5);
    fill(scale);
  }

  const slots = (
    placement
      ? [...new Set(placement)].filter(
          (slot) => slot >= song.first && slot <= song.last,
        )
      : [...chosen]
  ).sort((a, b) => a - b);
  const index = new Map(slots.map((slot, at) => [slot, at]));
  const rows: Row[] = slots.map((slot) => ({ slot, jump: false }));
  const clearOf = (at: number): number =>
    Math.min(
      at > 0 ? beatGap(slots[at]!, slots[at - 1]!) : 8,
      at + 1 < slots.length ? beatGap(slots[at]!, slots[at + 1]!) : 8,
    );
  const wideOf = (at: number): number =>
    Math.max(
      at > 0 ? beatGap(slots[at]!, slots[at - 1]!) : 8,
      at + 1 < slots.length ? beatGap(slots[at]!, slots[at + 1]!) : 8,
    );

  // Jumps on the accents: kick and snare or cymbal together, the more so on a bar line and a phrase start.
  const accent = (slot: number): number => {
    const bar = Math.floor(slot / perBar);
    const drums =
      0.5 * (song.low[slot]! + Math.max(song.mid[slot]!, song.high[slot]!));
    return (
      drums +
      (slot % perBar === 0 ? 0.15 : 0) +
      (slot % perBar === 0 && (((bar - analysis.phrase) % 4) + 4) % 4 === 0
        ? 0.25
        : 0)
    );
  };
  const jumpable = slots
    .map((slot, at) => ({ slot, at, value: accent(slot) }))
    .filter(
      ({ slot, at, value }) =>
        value >= 0.45 &&
        levelOf(slot) !== "S" &&
        (difficulty !== "Easy" || levelOf(slot) === "Q") &&
        wideOf(at) >= tuning.jump.wide &&
        // Off the beat the rows either side are an eighth away at best.
        clearOf(at) >=
          (levelOf(slot) === "Q"
            ? tuning.jump.clear
            : Math.min(tuning.jump.clear, 0.5)),
    )
    .sort((a, b) => b.value - a.value || a.slot - b.slot);
  // As many jumps as published charts have, and on the beats of the bar they have them on: the strongest accents
  // of each beat first, then whatever accents are left.
  const jumpBudget = Math.round(jumpShare * slots.length);
  const jumpsInBar = new Map<number, number>();
  let jumps = 0;
  const makeJump = (slot: number, at: number): boolean => {
    const bar = Math.floor(slot / perBar);
    const inBar = jumpsInBar.get(bar) ?? 0;
    if (rows[at]!.jump || inBar >= tuning.jump.perBar) return false;
    // Where a jump needs room, it needs twice as much from the next jump.
    if (
      tuning.jump.wide > 0 &&
      rows.some(
        (row, other) =>
          row.jump && beatGap(slots[other]!, slot) < 2 * tuning.jump.wide,
      )
    )
      return false;
    // Never two jumps on neighbouring rows below Challenge.
    if (
      difficulty !== "Challenge" &&
      (rows[at - 1]?.jump === true || rows[at + 1]?.jump === true)
    )
      return false;
    rows[at]!.jump = true;
    jumpsInBar.set(bar, inBar + 1);
    jumps++;
    return true;
  };
  const beatOf = (slot: number): string =>
    levelOf(slot) === "Q" ? String((slot % perBar) / slotsPerBeat) : "off";
  for (const beat of ["0", "1", "2", "3", "off"]) {
    let quota = Math.round(
      jumpBudget * (reference.tables.jump_beat?.[beat] ?? 0.2),
    );
    for (const { slot, at } of jumpable) {
      if (quota <= 0 || jumps >= jumpBudget) break;
      if (beatOf(slot) === beat && makeJump(slot, at)) quota--;
    }
  }
  for (const { slot, at } of jumpable) {
    if (jumps >= jumpBudget) break;
    makeJump(slot, at);
  }
  // The last row is the song's last hit: a jump from Medium up.
  if (difficulty !== "Easy" && clearOf(rows.length - 1) >= tuning.jump.clear)
    rows[rows.length - 1]!.jump = true;

  // Freezes on sustained notes: a new pitch that rings on with no new pitch after it.
  const half = slotsPerBeat % 2 === 0 ? slotsPerBeat / 2 : slotsPerBeat;
  // As many freezes as published charts have, and no longer: one beat, two or up to four, as often as theirs are.
  const holdBudget = Math.round(
    (reference.scalars.hold_share?.p50 ?? 0.04) * (slots.length + jumps),
  );
  const lengths = reference.tables.hold_beats ?? {};
  const one = lengths["<=1"] ?? 0.45,
    two = lengths["<=2"] ?? 0.3,
    four = lengths["<=4"] ?? 0.2;
  const sustain = (slot: number): number => {
    // Slots until the sound stops or a new note starts.
    const reference = Math.max(song.level[slot + 1] ?? 0, song.level[slot]!);
    let length = 1;
    while (
      slot + length < song.slots &&
      length < 4 * slotsPerBeat + 1 &&
      song.tone[slot + length]! < 0.5 &&
      song.level[slot + length]! >= 0.55 * reference &&
      song.level[slot + length]! >= 0.12
    )
      length++;
    return length;
  };
  const holdable = slots
    .map((slot, at) => ({ slot, at, length: sustain(slot) }))
    .filter(
      ({ slot, at, length }) =>
        song.tone[slot]! >= 0.4 &&
        levelOf(slot) !== "S" &&
        length >= slotsPerBeat &&
        at < slots.length - 1 &&
        (!rows[at]!.jump || difficulty === "Challenge"),
    )
    .sort(
      (a, b) =>
        b.length * song.tone[b.slot]! - a.length * song.tone[a.slot]! ||
        a.slot - b.slot,
    );
  let holds = 0,
    heldUntil: [number, number][] = [];
  // The long ones first, wherever the music and the rows around leave room for one, then the shorter.
  const tiers: readonly (readonly [number, number, number])[] = [
    [4, 2, Math.round((holdBudget * four) / (one + two + four))],
    [2, 1, Math.round((holdBudget * (two + four)) / (one + two + four))],
    [1, 0, holdBudget],
  ];
  for (const [most, over, quota] of tiers)
    for (const { slot, at, length } of holdable) {
      if (holds >= quota) break;
      if (rows[at]!.holdEnd !== undefined || rows[at]!.dropped === true)
        continue;
      // The tail lands on a beat or an eighth, before the sound stops.
      let end =
        slot +
        Math.floor(Math.min(length - 1, most * slotsPerBeat) / half) * half;
      // Rows while it is held go to the other foot: only so many, none of them fast, and never a jump (a hand).
      let inside = 0;
      // On the easier charts a long freeze is held alone, as published ones are: a row or two under it give way.
      const dropped: number[] = [];
      for (
        let next = at + 1;
        next < slots.length && slots[next]! <= end;
        next++
      ) {
        if (rows[next]!.dropped === true) continue;
        const gap = beatGap(slots[next]!, slots[next - 1]!);
        const fixed = rows[next]!.jump || rows[next]!.holdEnd !== undefined;
        if (inside >= tuning.hold.rowsInside || fixed || gap < 0.45) {
          if (
            most > 1 &&
            !fixed &&
            dropped.length < tuning.hold.clears &&
            next < slots.length - 1
          ) {
            dropped.push(next);
            continue;
          }
          // Let go an eighth (a beat, on a triplet grid) before the row that cannot be taken while holding.
          end = slots[next]! - half;
          end = slot + Math.floor((end - slot) / half) * half;
          break;
        }
        inside++;
      }
      if (end - slot < slotsPerBeat || end - slot <= over * slotsPerBeat)
        continue;
      // One freeze at a time, with a breath between them.
      if (heldUntil.some(([a, b]) => slot <= b + half && end + half >= a))
        continue;
      // The row after the tail needs a moment too.
      const after = slots.find(
        (other, found) => other > end && rows[found]!.dropped !== true,
      );
      if (after !== undefined && after - end < half && inside === 0) continue;
      rows[index.get(slot)!]!.holdEnd = end;
      for (const gone of dropped) rows[gone]!.dropped = true;
      heldUntil.push([slot, end]);
      holds++;
    }
  heldUntil = [];
  return rows.filter((row) => row.dropped !== true);
}

/** Where the feet are and how the search got there. */
interface State {
  left: number;
  right: number;
  /** The foot that stepped last: 0 left, 1 right. */
  foot: number;
  /** The arrows of the last three single steps, newest first; -1 for none or a jump. */
  recent: readonly [number, number, number];
  /** How many steps in a row have repeated the arrow two steps before (a trill). */
  trill: number;
  /** How many steps in a row have repeated the arrow one step before (a jack). */
  jacks: number;
  /** The foot holding a freeze and the slot it lets go, or -1. */
  holding: number;
  holdEnd: number;
  uses: readonly [number, number, number, number];
  /** The last jump's two arrows as `4 * lower + higher`, or -1. */
  lastJump: number;
  cost: number;
  /** The arrows of the row that led here, and the state before it. */
  columns: readonly number[];
  holdColumn: number;
  previous: State | undefined;
}

/** Left and Right are either side of the pad; Down and Up are both in the middle. */
const ACROSS = [0, 1, 1, 2] as const;
const MIRROR = [3, 1, 2, 0] as const;

/** How likely each arrow is after one arrow (`two`, by `4 * last + next`) and after two (`three`). */
interface Prior {
  two: Float64Array;
  three: Float64Array;
}

/** The slower speeds a speed borrows from when the reference has no table for it at this difficulty. */
const FALLBACK: Record<Speed, readonly Speed[]> = {
  "4th": ["4th"],
  "8th": ["8th", "4th"],
  "16th": ["16th", "8th", "4th"],
};

/**
 * What published charts step next, by how fast the steps come: sixteenths are mostly drills (there and back),
 * eighths sweep and turn, quarters repeat an arrow often. From the reference's bigram and trigram frequencies.
 */
function priors(reference: Reference): Record<Speed, Prior> {
  const conditional = (kind: string, speed: Speed, size: number) => {
    const table = FALLBACK[speed]
      .map((from) => reference.tables[`${kind}_${from}`])
      .find((found) => found !== undefined);
    const out = new Float64Array(4 ** size).fill(0.25);
    if (!table) return out;
    for (let context = 0; context < 4 ** (size - 1); context++) {
      const share = (next: number): number => {
        let key = ARROWS[next]!;
        for (let rest = context, at = 0; at < size - 1; at++, rest >>= 2)
          key = ARROWS[rest & 3]! + key;
        // A pattern the reference never has is rare here, not impossible.
        return (table[key] ?? 0) + 0.0005;
      };
      const sum = share(0) + share(1) + share(2) + share(3);
      for (let next = 0; next < 4; next++)
        out[context * 4 + next] = share(next) / sum;
    }
    return out;
  };
  const prior = (speed: Speed): Prior => ({
    two: conditional("bigram", speed, 2),
    three: conditional("trigram", speed, 3),
  });
  return { "4th": prior("4th"), "8th": prior("8th"), "16th": prior("16th") };
}

/** A draw from the Gumbel distribution: added to log-likelihoods, the best choice is a fair sample of them. */
const gumbel = (uniform: number): number =>
  -Math.log(-Math.log(clamp(uniform, 1e-9, 1 - 1e-9)));

/** The arrows of every row. */
function placeSteps(
  song: Song,
  difficulty: Difficulty,
  rows: readonly Row[],
): Note[] {
  const tuning = TUNING[difficulty];
  const seed = hash(`${song.analysis.id}/${difficulty}`);
  const { slotsPerBeat, perBar } = song;
  const BEAM = 20;

  // A bar's signature is its rhythm and its jumps. (The melody's rise and fall into each row steers the arrows too.)
  const contour = (at: number): number => {
    if (at === 0) return 0;
    const now = song.pitch[rows[at]!.slot]!,
      before = song.pitch[rows[at - 1]!.slot]!;
    if (now === 0 || before === 0) return 0;
    return now - before >= 2 ? 1 : before - now >= 2 ? -1 : 0;
  };
  const barOf = (at: number): number => Math.floor(rows[at]!.slot / perBar);
  const signature = new Map<number, string>();
  const firstRow = new Map<number, number>();
  rows.forEach((row, at) => {
    const bar = barOf(at);
    if (!firstRow.has(bar)) firstRow.set(bar, at);
    signature.set(
      bar,
      `${signature.get(bar) ?? ""}${row.slot % perBar}${row.jump ? "j" : ""},`,
    );
  });
  /** Arrows remembered for a bar signature within the current eight-bar phrase. */
  let memory = new Map<string, { columns: number[][]; uses: number }>();
  let memoryPhrase = -1;
  /** The arrows the row should repeat, if its bar repeats one remembered. */
  const remembered = new Map<number, readonly number[]>();

  const reference = referenceFor(difficulty);
  const prior = priors(reference);
  const jumpPairs = reference.tables.jump_pair ?? {};
  const afterJumpIn = reference.tables.after_jump?.in ?? 0.42;
  /** Whether the bar's remembered arrows are used: a repeat should repeat. */
  const ECHO = 4;
  const JACK = 0.2;

  const stepCost = (
    state: State,
    foot: number,
    column: number,
    at: number,
    gapBeats: number,
    gapSeconds: number,
  ): number | undefined => {
    const speed = speedOf(gapBeats);
    // Whether the step before came at this speed too: then the last two arrows say what comes next.
    const chained =
      at >= 2 &&
      speedOf((rows[at - 1]!.slot - rows[at - 2]!.slot) / slotsPerBeat) ===
        speed;
    const other = foot === 0 ? state.right : state.left,
      from = foot === 0 ? state.left : state.right;
    if (column === other) return undefined;
    const left = foot === 0 ? column : state.left,
      right = foot === 1 ? column : state.right;
    let cost = 0;
    if (ACROSS[left]! > ACROSS[right]!) {
      // A crossover: one foot over the other, only on the harder charts and never both arrows across.
      if (tuning.crossover === undefined || ACROSS[left]! - ACROSS[right]! > 1)
        return undefined;
      cost += tuning.crossover + (gapSeconds < 0.15 ? 1 : 0);
    }
    if ((from === 1 && column === 2) || (from === 2 && column === 1))
      cost += tuning.candle;
    const [last, second] = state.recent;
    // The same arrow again: a jack, only at a speed the difficulty allows and only a few running.
    if (column === last && (gapBeats < tuning.jack || state.jacks >= 2))
      return undefined;
    // A drill may run on, but not for ever.
    if (column === second && column !== last && state.trill >= 6)
      cost += 0.6 * (state.trill - 5);
    if (last >= 0) {
      // What published charts step after these arrows at this speed.
      const likely =
        chained && second >= 0
          ? prior[speed].three[second * 16 + last * 4 + column]!
          : prior[speed].two[last * 4 + column]!;
      cost -= Math.log(4 * likely);
      // The feet here alternate more strictly than a player's do, which makes the same arrow twice rarer than it
      // should be: this much puts it back.
      if (column === last) cost -= JACK;
    } else if (state.columns.length === 2) {
      // After a jump: one of its arrows again about as often as published charts do.
      const stays = state.columns.includes(column);
      cost -= Math.log((stays ? afterJumpIn : 1 - afterJumpIn) / 0.5);
    }
    // The melody: up moves right, down moves left.
    const direction = contour(at);
    if (direction !== 0 && last >= 0) {
      const moved = Math.sign(column - last);
      cost += moved === direction ? -0.35 : moved === 0 ? 0 : 0.7;
    }
    // Even use of the four arrows.
    const total = state.uses[0] + state.uses[1] + state.uses[2] + state.uses[3];
    cost += 2.2 * (state.uses[column]! / (total + 6) - 0.25);
    const wanted = remembered.get(at);
    if (wanted && wanted.length === 1 && wanted[0] === column) cost -= ECHO;
    // The draw that makes the cheapest arrow a sample of the likely ones and not always the likeliest.
    cost -= gumbel(noise(seed, rows[at]!.slot, column));
    return cost;
  };

  const start: State = {
    left: 0,
    right: 3,
    foot: noise(seed, 1) < 0.5 ? 0 : 1,
    recent: [-1, -1, -1],
    trill: 0,
    jacks: 0,
    holding: -1,
    holdEnd: -1,
    uses: [0, 0, 0, 0],
    lastJump: -1,
    cost: 0,
    columns: [],
    holdColumn: -1,
    previous: undefined,
  };
  let beam: State[] = [start];
  const best = (): State => beam.reduce((a, b) => (b.cost < a.cost ? b : a));
  /** The arrows of rows `from` to `to` on the path that ends in `state` after row `to`. */
  const pathColumns = (state: State, from: number, to: number): number[][] => {
    const out: number[][] = [];
    let walk: State | undefined = state;
    for (let at = to; at >= from && walk; at--, walk = walk.previous)
      out.unshift([...walk.columns]);
    return out;
  };

  for (let at = 0; at < rows.length; at++) {
    const row = rows[at]!;
    const bar = barOf(at);
    if (firstRow.get(bar) === at) {
      // The bar before is settled enough to remember; then see whether this bar repeats one.
      const phrase = Math.floor((bar - song.analysis.phrase + 8) / 8);
      const previousBar = at > 0 ? barOf(at - 1) : -1;
      if (previousBar >= 0 && phrase === memoryPhrase) {
        const key = signature.get(previousBar)!;
        if (!memory.has(key))
          memory.set(key, {
            columns: pathColumns(best(), firstRow.get(previousBar)!, at - 1),
            uses: 0,
          });
      }
      if (phrase !== memoryPhrase) {
        memory = new Map();
        memoryPhrase = phrase;
      }
      const found = memory.get(signature.get(bar)!);
      if (
        found &&
        found.columns.length >= 3 &&
        noise(seed, bar, 5) < tuning.echo
      ) {
        found.uses++;
        // The mirror image a little more often than the same arrows, as in published charts.
        const mirror = noise(seed, bar, 7) < 0.55;
        found.columns.forEach((columns, offset) =>
          remembered.set(
            at + offset,
            mirror
              ? columns.map((column) => MIRROR[column]!).sort((a, b) => a - b)
              : columns,
          ),
        );
      }
    }
    const before = at > 0 ? rows[at - 1]!.slot : row.slot - 4 * slotsPerBeat;
    const gapBeats = (row.slot - before) / slotsPerBeat,
      gapSeconds = song.seconds[row.slot]! - song.seconds[Math.max(0, before)]!;
    const next: State[] = [];
    for (const state of beam) {
      const holding = state.holding >= 0 && row.slot <= state.holdEnd;
      const push = (
        cost: number,
        left: number,
        right: number,
        foot: number,
        columns: number[],
        single: boolean,
        holdFoot: number,
      ): void => {
        const column = single ? columns[0]! : -1;
        const uses: [number, number, number, number] = [...state.uses];
        for (const used of columns) uses[used]!++;
        const startsHold = row.holdEnd !== undefined;
        next.push({
          left,
          right,
          foot,
          recent: [column, state.recent[0], state.recent[1]],
          trill:
            single && column === state.recent[1] && column !== state.recent[0]
              ? state.trill + 1
              : 0,
          jacks: single && column === state.recent[0] ? state.jacks + 1 : 0,
          holding: startsHold ? holdFoot : holding ? state.holding : -1,
          holdEnd: startsHold ? row.holdEnd! : holding ? state.holdEnd : -1,
          uses,
          lastJump: single ? state.lastJump : columns[0]! * 4 + columns[1]!,
          cost: state.cost + cost,
          columns,
          holdColumn: startsHold ? (holdFoot === 0 ? left : right) : -1,
          previous: state,
        });
      };
      if (row.jump && !holding) {
        for (let a = 0; a < 4; a++)
          for (let b = a + 1; b < 4; b++) {
            // The left foot takes the arrow further left; Down and Up can go either way round.
            const ways: [number, number][] =
              a === 1 && b === 2
                ? [
                    [1, 2],
                    [2, 1],
                  ]
                : [[a, b]];
            for (const [left, right] of ways) {
              // The pairs published charts jump on, as often as they do.
              let cost = -Math.log(
                6 * ((jumpPairs[ARROWS[a]! + ARROWS[b]!] ?? 0) + 0.005),
              );
              // Not the same jump as the one before, unless the bar is a repeat.
              if (state.lastJump === a * 4 + b) cost += 0.45;
              for (const [from, to] of [
                [state.left, left],
                [state.right, right],
              ] as const) {
                if (from !== to) cost += 0.2;
                if ((from === 1 && to === 2) || (from === 2 && to === 1))
                  cost += tuning.candle;
              }
              const total =
                state.uses[0] + state.uses[1] + state.uses[2] + state.uses[3];
              cost +=
                2.2 * ((state.uses[a]! + state.uses[b]!) / (total + 6) - 0.5);
              const wanted = remembered.get(at);
              if (
                wanted &&
                wanted.length === 2 &&
                wanted[0] === a &&
                wanted[1] === b
              )
                cost -= ECHO;
              cost -= gumbel(noise(seed, row.slot, a * 4 + b, 9));
              // A jump counts as the step of the foot whose turn it was, so the feet go on alternating after it.
              const holdFoot = noise(seed, row.slot, 11) < 0.5 ? 0 : 1;
              push(cost, left, right, 1 - state.foot, [a, b], false, holdFoot);
            }
          }
        continue;
      }
      // A single step. Its foot is the other one; the same one only while the other holds a freeze, for a jack,
      // or after a rest long enough to stand still.
      const feet: [number, number][] = holding
        ? [[1 - state.holding, 0]]
        : [
            [1 - state.foot, 0],
            [state.foot, gapBeats >= 2 ? 0.4 : gapBeats >= 1 ? 1.5 : -1],
          ];
      for (const [foot, extra] of feet)
        for (let column = 0; column < 4; column++) {
          const sameFoot = !holding && foot === state.foot;
          const from = foot === 0 ? state.left : state.right;
          // The same foot may repeat its own arrow (a jack) at any allowed speed, or move after a rest.
          if (sameFoot && column !== from && extra < 0) continue;
          const cost = stepCost(state, foot, column, at, gapBeats, gapSeconds);
          if (cost === undefined) continue;
          const moved = holding && column !== from ? 0.25 : 0;
          push(
            cost + (sameFoot && column !== from ? extra : 0) + moved,
            foot === 0 ? column : state.left,
            foot === 1 ? column : state.right,
            foot,
            [column],
            true,
            foot,
          );
        }
    }
    if (next.length === 0)
      throw new Error(
        `${song.analysis.id} ${difficulty}: no way to step row ${at} (slot ${row.slot})`,
      );
    next.sort((a, b) => a.cost - b.cost);
    // Keep the cheapest few, at most one per position of the feet.
    const seen = new Set<string>();
    beam = [];
    for (const state of next) {
      const key = `${state.left}${state.right}${state.foot}${state.recent[0]},${state.recent[1]},${state.holding}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(state);
      if (beam.length >= BEAM) break;
    }
  }

  const notes: Note[] = [];
  let walk: State | undefined = best();
  for (let at = rows.length - 1; at >= 0 && walk; at--, walk = walk.previous) {
    const row = rows[at]!;
    for (const column of walk.columns)
      notes.push(
        row.holdEnd !== undefined && column === walk.holdColumn
          ? { slot: row.slot, column, kind: "hold", endSlot: row.holdEnd }
          : { slot: row.slot, column, kind: "tap" },
      );
  }
  return notes.sort((a, b) => a.slot - b.slot || a.column - b.column);
}

/** A few mines for flavour on Hard and Challenge: in rests, on an arrow no foot is resting on. */
function addMines(
  song: Song,
  notes: Note[],
  most: number,
  apart: number,
): void {
  const seed = hash(`${song.analysis.id}/mines`);
  const { slotsPerBeat } = song;
  const rowSlots = [...new Set(notes.map((note) => note.slot))].sort(
    (a, b) => a - b,
  );
  const holds = notes.filter((note) => note.kind === "hold");
  let placed = 0,
    lastMine = -Infinity;
  const half = slotsPerBeat % 2 === 0 ? slotsPerBeat / 2 : slotsPerBeat;
  for (let at = 0; at + 1 < rowSlots.length && placed < most; at++) {
    const from = rowSlots[at]!,
      to = rowSlots[at + 1]!;
    if (to - from < slotsPerBeat) continue;
    if (from - lastMine < apart * slotsPerBeat) continue;
    if (holds.some((hold) => hold.slot <= to && hold.endSlot! >= from))
      continue;
    // In the middle of the rest, on a beat or an eighth.
    const slot = from + half * Math.round((to - from) / (2 * half));
    if (slot <= from || slot >= to) continue;
    // Not on the arrows of the rows either side: where the feet are, and where they are going.
    const busy = new Set(
      notes
        .filter((note) => note.slot === from || note.slot === to)
        .map((note) => note.column),
    );
    const free = [0, 1, 2, 3].filter((column) => !busy.has(column));
    if (free.length === 0) continue;
    notes.push({
      slot,
      column: free[Math.floor(noise(seed, slot) * free.length)]!,
      kind: "mine",
    });
    lastMine = slot;
    placed++;
  }
  notes.sort((a, b) => a.slot - b.slot || a.column - b.column);
}

export interface ChartStats {
  /** Arrows to step on: taps and freeze heads, a jump counting two. */
  notes: number;
  /** Rows (a jump is one) per second from the first to the last. */
  average: number;
  /** The most rows per second over any four beats. */
  peak: number;
  jumps: number;
  holds: number;
  mines: number;
  /** Seconds into the audio of the first and last row. */
  first: number;
  last: number;
}

export function chartStats(analysis: Analysis, chart: Chart): ChartStats {
  const { slotsPerBeat } = analysis;
  const steps = chart.notes.filter((note) => note.kind !== "mine");
  const rows = [...new Set(steps.map((note) => note.slot))].sort(
    (a, b) => a - b,
  );
  const seconds = (slot: number): number =>
    beatSeconds(analysis, slot / slotsPerBeat);
  let peak = 0;
  for (let from = 0, to = 0; from < rows.length; from++) {
    while (to < rows.length && rows[to]! < rows[from]! + 4 * slotsPerBeat) to++;
    peak = Math.max(
      peak,
      (to - from) /
        (seconds(rows[from]! + 4 * slotsPerBeat) - seconds(rows[from]!)),
    );
  }
  const first = rows.length > 0 ? seconds(rows[0]!) : 0,
    last = rows.length > 0 ? seconds(rows[rows.length - 1]!) : 0;
  return {
    notes: steps.length,
    average: rows.length > 1 ? (rows.length - 1) / (last - first) : 0,
    peak,
    jumps: steps.length - rows.length,
    holds: steps.filter((note) => note.kind === "hold").length,
    mines: chart.notes.length - steps.length,
    first,
    last,
  };
}

/**
 * The four charts of a song, easiest first. `placement` (beats, per difficulty) swaps in another rhythm, such as a learned
 * model's (`scripts/chartnet`, for its evaluation); the arrows, jumps, freezes and mines are still this generator's.
 */
export function generateCharts(
  analysis: Analysis,
  placement?: Partial<Record<Difficulty, readonly number[]>>,
): Chart[] {
  const song = readSong(analysis);
  const charts: Chart[] = [];
  let base = new Set<number>();
  for (const difficulty of DIFFICULTIES) {
    const beats = placement?.[difficulty];
    const rows = pickRows(
      song,
      difficulty,
      base,
      beats?.map((beat) => Math.round(beat * song.slotsPerBeat)),
    );
    base = new Set(rows.map((row) => row.slot));
    const notes = placeSteps(song, difficulty, rows);
    const { mines } = TUNING[difficulty];
    if (mines.most > 0) addMines(song, notes, mines.most, mines.apart);
    const chart: Chart = { difficulty, meter: 0, notes };
    const stats = chartStats(analysis, chart);
    chart.meter = TUNING[difficulty].meter(stats.average, stats.peak);
    charts.push(chart);
  }
  return charts;
}
