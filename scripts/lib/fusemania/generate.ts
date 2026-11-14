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
 *    neither crosses the other below Hard, a rising melody moves right and a falling one left, the four arrows are
 *    used evenly, and a bar whose rhythm and contour repeat an earlier bar of the phrase gets that bar's arrows
 *    (or their mirror image).
 *
 * Everything random is drawn from a hash of the song id, the difficulty and the place in the song.
 */
import { beatSeconds, decodeSeries, type Analysis } from "./analysis.js";

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
  /** Rows per second aimed at in the quietest and the busiest bars. */
  density: readonly [number, number];
  /** The most rows per second any four-beat window may hold. */
  cap: number;
  /** How much a slot of each level counts: beat, off-beat eighth, sixteenth level. 0 bars the level. */
  levels: { Q: number; E: number; S: number };
  /** How much hi-hats count as something to step on. */
  hats: number;
  /** The least salience a slot needs to carry a step (1 is a strong onset). */
  floor: number;
  /** The most rows a sixteenth-speed run may have. */
  burst: number;
  /** The least time between two rows, in seconds, whatever the grid allows. */
  gap: number;
  /** Jumps: the least accent, how many per bar at most, and the clear space needed either side, in beats. */
  jump: { accent: number; perBar: number; clear: number };
  /** Freezes: how many per bar at most, and how many rows the other foot may take while one is held. */
  hold: { perBar: number; rowsInside: number };
  /** Whether a foot may cross the other, and what it costs. */
  crossover: number | undefined;
  /** What a foot going straight from Up to Down (or back) costs. */
  candle: number;
  /** The shortest gap, in beats, at which the same arrow may come twice running. */
  jack: number;
  /**
   * The meter from the chart's notes per second. Every chart of a difficulty aims at the same density range, so the
   * steps are narrow: a meter ranks the songs of this pack against each other more than against other packs.
   */
  meter: (average: number, peak: number) => number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const TUNING: Record<Difficulty, Tuning> = {
  Easy: {
    density: [0.8, 1.6],
    cap: 2.0,
    levels: { Q: 1, E: 0, S: 0 },
    hats: 0.5,
    floor: 0.3,
    gap: 0.3,
    burst: 1,
    jump: { accent: 1.15, perBar: 0.125, clear: 1 },
    hold: { perBar: 0.25, rowsInside: 0 },
    crossover: undefined,
    candle: 6,
    jack: 2,
    meter: (average) => 2 + clamp(Math.round((average - 1.16) / 0.11), 0, 2),
  },
  Medium: {
    density: [1.7, 3.0],
    cap: 3.5,
    levels: { Q: 1, E: 0.62, S: 0 },
    hats: 0.7,
    floor: 0.3,
    gap: 0.16,
    burst: 1,
    jump: { accent: 1.05, perBar: 0.45, clear: 0.75 },
    hold: { perBar: 0.5, rowsInside: 1 },
    crossover: undefined,
    candle: 4,
    jack: 1,
    meter: (average) => 5 + clamp(Math.round((average - 2.4) / 0.12), 0, 2),
  },
  Hard: {
    density: [2.8, 5.0],
    cap: 6.0,
    levels: { Q: 1, E: 0.85, S: 0.5 },
    hats: 0.85,
    floor: 0.25,
    gap: 0.095,
    burst: 5,
    jump: { accent: 0.95, perBar: 0.8, clear: 0.4 },
    hold: { perBar: 0.75, rowsInside: 3 },
    crossover: 2.8,
    candle: 1.1,
    jack: 0.5,
    meter: (average) => 8 + clamp(Math.round((average - 3.8) / 0.3), 0, 2),
  },
  Challenge: {
    density: [3.8, 7.6],
    cap: 9.0,
    levels: { Q: 1, E: 0.95, S: 0.8 },
    hats: 1,
    floor: 0.2,
    gap: 0.07,
    burst: 33,
    jump: { accent: 0.9, perBar: 1.1, clear: 0.3 },
    hold: { perBar: 1, rowsInside: 6 },
    crossover: 2.2,
    candle: 0.8,
    jack: 0.5,
    meter: (average, peak) =>
      10 + clamp(Math.round((0.6 * average + 0.4 * peak - 6.3) / 0.3), 0, 3),
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
}

/**
 * The rows of one difficulty. `base` is the easier chart's rows, all of which are kept.
 */
function pickRows(
  song: Song,
  difficulty: Difficulty,
  base: ReadonlySet<number>,
): Row[] {
  const tuning = TUNING[difficulty];
  const { slotsPerBeat, perBar, analysis } = song;
  const levelOf = (slot: number): "Q" | "E" | "S" | "X" =>
    analysis.levels[slot % slotsPerBeat] as "Q" | "E" | "S" | "X";
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
  for (const slot of base)
    if (slot >= song.first && slot <= song.last) chosen.add(slot);
  chosen.add(song.first);
  chosen.add(song.last);
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

  for (
    let bar = Math.floor(song.first / perBar);
    bar * perBar <= song.last;
    bar++
  ) {
    const from = bar * perBar,
      to = Math.min(song.slots, from + perBar);
    const barSeconds = song.seconds[to]! - song.seconds[from]!;
    // The bars of a four-bar phrase aim at much the same density, so a rhythm that repeats is stepped the same way.
    const phraseStart = bar - ((((bar - analysis.phrase) % 4) + 4) % 4);
    let phraseEnergy = 0,
      phraseBars = 0;
    for (let other = Math.max(0, phraseStart); other < phraseStart + 4; other++)
      if (other < song.bars) {
        phraseEnergy += song.energy[other]!;
        phraseBars++;
      }
    const energy =
      0.7 * (phraseEnergy / Math.max(1, phraseBars)) +
      0.3 * (song.energy[bar] ?? 0);
    const target = Math.round(
      (tuning.density[0] + (tuning.density[1] - tuning.density[0]) * energy) *
        barSeconds,
    );
    const candidates: number[] = [];
    let count = 0;
    for (let slot = from; slot < to; slot++) {
      if (chosen.has(slot)) count++;
      else if (
        slot > song.first &&
        slot < song.last &&
        priority(slot) > 0 &&
        // A slot the rest of the phrase hits hard needs only a faint onset of its own to keep the rhythm going.
        salience[slot]! >= (phraseMean >= 0.6 ? 0.5 : 1) * tuning.floor
      )
        candidates.push(slot);
    }
    candidates.sort((a, b) => priority(b) - priority(a) || a - b);
    for (const slot of candidates) {
      if (count >= target) break;
      if (!fits(slot)) continue;
      if (runLength(slot) > tuning.burst) continue;
      chosen.add(slot);
      count++;
    }
  }
  // On a straight grid a sixteenth needs the step it leads into: alone it reads as a mistake. (A swung one is the
  // rhythm itself.)
  for (const slot of [...chosen].sort((a, b) => a - b)) {
    if (slotsPerBeat !== 4 || levelOf(slot) !== "S" || base.has(slot)) continue;
    let leads = false;
    for (
      let next = slot + 1;
      next < song.slots && beatGap(slot, next) < 0.4;
      next++
    )
      if (chosen.has(next)) leads = true;
    if (!leads) chosen.delete(slot);
  }

  const slots = [...chosen].sort((a, b) => a - b);
  const index = new Map(slots.map((slot, at) => [slot, at]));
  const rows: Row[] = slots.map((slot) => ({ slot, jump: false }));
  const clearOf = (at: number): number =>
    Math.min(
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
        value >= tuning.jump.accent &&
        levelOf(slot) !== "S" &&
        (difficulty === "Hard" || difficulty === "Challenge"
          ? true
          : levelOf(slot) === "Q") &&
        clearOf(at) >= tuning.jump.clear,
    )
    .sort((a, b) => b.value - a.value || a.slot - b.slot);
  const jumpBudget = Math.floor(
    tuning.jump.perBar * ((song.last - song.first) / perBar),
  );
  const jumpsInBar = new Map<number, number>();
  let jumps = 0;
  for (const { slot, at } of jumpable) {
    if (jumps >= jumpBudget) break;
    const bar = Math.floor(slot / perBar);
    const inBar = jumpsInBar.get(bar) ?? 0;
    if (inBar >= Math.max(1, Math.ceil(tuning.jump.perBar))) continue;
    // Never two jumps on neighbouring rows below Challenge.
    if (
      difficulty !== "Challenge" &&
      (rows[at - 1]?.jump === true || rows[at + 1]?.jump === true)
    )
      continue;
    rows[at]!.jump = true;
    jumpsInBar.set(bar, inBar + 1);
    jumps++;
  }
  // The last row is the song's last hit: a jump from Medium up.
  if (difficulty !== "Easy" && clearOf(rows.length - 1) >= tuning.jump.clear)
    rows[rows.length - 1]!.jump = true;

  // Freezes on sustained notes: a new pitch that rings on with no new pitch after it.
  const half = slotsPerBeat % 2 === 0 ? slotsPerBeat / 2 : slotsPerBeat;
  const holdBudget = Math.floor(
    tuning.hold.perBar * ((song.last - song.first) / perBar),
  );
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
  for (const { slot, at, length } of holdable) {
    if (holds >= holdBudget) break;
    // The tail lands on a beat or an eighth, before the sound stops.
    let end = slot + Math.floor((length - 1) / half) * half;
    // Rows while it is held go to the other foot: only so many, none of them fast, and never a jump (a hand).
    let inside = 0;
    for (
      let next = at + 1;
      next < slots.length && slots[next]! <= end;
      next++
    ) {
      const gap = beatGap(slots[next]!, slots[next - 1]!);
      if (
        inside >= tuning.hold.rowsInside ||
        rows[next]!.jump ||
        rows[next]!.holdEnd !== undefined ||
        gap < 0.45
      ) {
        // Let go an eighth (a beat, on a triplet grid) before the row that cannot be taken while holding.
        end = slots[next]! - half;
        end = slot + Math.floor((end - slot) / half) * half;
        break;
      }
      inside++;
    }
    if (end - slot < slotsPerBeat) continue;
    // One freeze at a time, with a breath between them.
    if (heldUntil.some(([a, b]) => slot <= b + half && end + half >= a))
      continue;
    // The row after the tail needs a moment too.
    const after = slots.find((other) => other > end);
    if (after !== undefined && after - end < half && inside === 0) continue;
    rows[index.get(slot)!]!.holdEnd = end;
    heldUntil.push([slot, end]);
    holds++;
  }
  heldUntil = [];
  return rows;
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

/** The arrows of every row. */
function placeSteps(
  song: Song,
  difficulty: Difficulty,
  rows: readonly Row[],
): Note[] {
  const tuning = TUNING[difficulty];
  const seed = hash(`${song.analysis.id}/${difficulty}`);
  const { slotsPerBeat, perBar } = song;
  const BEAM = 14;

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

  const stepCost = (
    state: State,
    foot: number,
    column: number,
    at: number,
    gapBeats: number,
    gapSeconds: number,
  ): number | undefined => {
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
      cost += tuning.crossover + (gapSeconds < 0.2 ? 2 : 0);
    }
    if ((from === 1 && column === 2) || (from === 2 && column === 1))
      cost += tuning.candle;
    const [last, second] = state.recent;
    if (column === last) {
      // The same arrow again: a jack, only at a speed the difficulty allows and only a few running.
      if (gapBeats < tuning.jack || state.jacks >= 2) return undefined;
      const same =
        song.pitch[rows[at]!.slot]! !== 0 &&
        Math.abs(
          song.pitch[rows[at]!.slot]! - song.pitch[rows[at - 1]!.slot]!,
        ) <= 1;
      cost += (same ? 0.5 : 1.6) + 0.8 * state.jacks;
    } else if (column === second) {
      cost += 0.2 + (state.trill >= 3 ? 0.8 * (state.trill - 2) : 0);
    } else if (last >= 0 && second >= 0 && column - last === last - second) {
      // Carrying on in the same direction: a staircase.
      cost -= 0.4;
    }
    // The melody: up moves right, down moves left.
    const direction = contour(at);
    if (direction !== 0 && last >= 0) {
      const moved = Math.sign(column - last);
      cost += moved === direction ? -0.35 : moved === 0 ? 0.3 : 0.7;
    }
    // Even use of the four arrows.
    const total = state.uses[0] + state.uses[1] + state.uses[2] + state.uses[3];
    cost += 2.2 * (state.uses[column]! / (total + 6) - 0.25);
    const wanted = remembered.get(at);
    if (wanted && wanted.length === 1 && wanted[0] === column) cost -= 1.5;
    cost += 0.35 * noise(seed, rows[at]!.slot, column, foot);
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
      if (found && found.columns.length >= 3) {
        found.uses++;
        // Every other repeat is the mirror image.
        const mirror = found.uses % 2 === 1 && noise(seed, bar, 7) < 0.7;
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
              let cost =
                a === 0 && b === 3 ? 0 : a === 1 && b === 2 ? 0.9 : 0.35;
              // Not the same jump as the one before, unless the bar is a repeat.
              if (state.lastJump === a * 4 + b) cost += 0.45;
              if (difficulty === "Easy" && !(a === 0 && b === 3)) cost += 1.5;
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
                cost -= 1.5;
              cost += 0.45 * noise(seed, row.slot, a * 4 + b, 9);
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
      const key = `${state.left}${state.right}${state.foot}${state.recent[0]}${state.holding}`;
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

/** A few mines for flavour on Challenge: in rests, on an arrow no foot is resting on. */
function addMines(song: Song, notes: Note[]): void {
  const seed = hash(`${song.analysis.id}/mines`);
  const { slotsPerBeat } = song;
  const rowSlots = [...new Set(notes.map((note) => note.slot))].sort(
    (a, b) => a - b,
  );
  const holds = notes.filter((note) => note.kind === "hold");
  let placed = 0,
    lastMine = -Infinity;
  const half = slotsPerBeat % 2 === 0 ? slotsPerBeat / 2 : slotsPerBeat;
  for (let at = 0; at + 1 < rowSlots.length && placed < 10; at++) {
    const from = rowSlots[at]!,
      to = rowSlots[at + 1]!;
    if (to - from < slotsPerBeat) continue;
    if (from - lastMine < 8 * slotsPerBeat) continue;
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

/** The four charts of a song, easiest first. */
export function generateCharts(analysis: Analysis): Chart[] {
  const song = readSong(analysis);
  const charts: Chart[] = [];
  let base = new Set<number>();
  for (const difficulty of DIFFICULTIES) {
    const rows = pickRows(song, difficulty, base);
    base = new Set(rows.map((row) => row.slot));
    const notes = placeSteps(song, difficulty, rows);
    if (difficulty === "Challenge") addMines(song, notes);
    const chart: Chart = { difficulty, meter: 0, notes };
    const stats = chartStats(analysis, chart);
    chart.meter = TUNING[difficulty].meter(stats.average, stats.peak);
    charts.push(chart);
  }
  return charts;
}
