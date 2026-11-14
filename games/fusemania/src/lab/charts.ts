/**
 * The chart lab's charts: simfile charts placed in time, coloured by beat quantisation, and edited one tap at a time.
 * Pure; the page draws and stores what these return.
 */
import {
  type ChartNote,
  type SimChart,
  type Simfile,
  type TimingData,
} from "../engine/simfile.js";
import { createTiming, type Timing } from "../engine/timing.js";

/** Beat subdivisions the lab names, coarsest first: 4th, 8th, 12th, 16th, 24th, 32nd, 48th, 64th. */
export const QUANTS = [1, 2, 3, 4, 6, 8, 12, 16] as const;
export type Quant = (typeof QUANTS)[number] | 0;

/** The coarsest subdivision `beat` falls on (1 = a quarter note, 4 = a 16th), or 0 when none does. */
export function quantOf(beat: number): Quant {
  const fraction = beat - Math.floor(beat);
  for (const q of QUANTS)
    if (Math.abs(fraction * q - Math.round(fraction * q)) < 1e-3) return q;
  return 0;
}

/** The note name a subdivision goes by in StepMania (`4th`, `16th`…). */
export const quantName = (q: Quant): string =>
  q === 0 ? "off-grid" : `${q * 4}th`;

export interface PlacedNote extends ChartNote {
  time: number;
  endTime?: number;
  quant: Quant;
}

export interface LabChart {
  /** Stable key: source and position. */
  key: string;
  label: string;
  source: string;
  chart: SimChart;
  timing: Timing;
  notes: PlacedNote[];
}

export function timingOf(sim: Simfile, chart: SimChart): TimingData {
  return chart.timing ?? sim.timing;
}

export function placeChart(
  sim: Simfile,
  chart: SimChart,
  key: string,
  source: string,
): LabChart {
  const timing = createTiming(timingOf(sim, chart));
  const notes = chart.notes.map((note) => ({
    ...note,
    time: timing.timeAt(note.beat),
    ...(note.endBeat !== undefined
      ? { endTime: timing.timeAt(note.endBeat) }
      : {}),
    quant: quantOf(note.beat),
  }));
  return {
    key,
    label:
      source === "song" ? chart.difficulty : `${chart.difficulty} · ${source}`,
    source,
    chart,
    timing,
    notes,
  };
}

/** `beat` snapped to the nearest `1 / perBeat` of a beat. */
export const snapBeat = (beat: number, perBeat: number): number =>
  Math.round(beat * perBeat) / perBeat;

/**
 * The chart with a tap toggled at `beat` in `column`: a note starting there (tap, hold or mine) is removed,
 * otherwise a tap is added. Notes stay sorted by beat then column.
 */
export function toggleTap(
  chart: SimChart,
  beat: number,
  column: number,
): SimChart {
  const hit = chart.notes.findIndex(
    (note) => note.column === column && Math.abs(note.beat - beat) < 1e-6,
  );
  const notes =
    hit >= 0
      ? chart.notes.filter((_, index) => index !== hit)
      : [...chart.notes, { beat, column, kind: "tap" as const }].sort(
          (a, b) => a.beat - b.beat || a.column - b.column,
        );
  return { ...chart, notes };
}

export interface ChartStats {
  steps: number;
  perSecond: number;
  /** Share of steps on each subdivision. */
  quants: Partial<Record<Quant, number>>;
}

/** Steps (rows with a tap or hold head), their rate over the stepped span and the share on each subdivision. */
export function chartStats(notes: readonly PlacedNote[]): ChartStats {
  const rows = new Map<number, PlacedNote>();
  for (const note of notes) if (note.kind !== "mine") rows.set(note.beat, note);
  const list = [...rows.values()];
  if (list.length === 0) return { steps: 0, perSecond: 0, quants: {} };
  // At least a second, so a span with one or two steps does not read as hundreds a second.
  const span = Math.max(1, list[list.length - 1]!.time - list[0]!.time);
  const quants: Partial<Record<Quant, number>> = {};
  for (const note of list)
    quants[note.quant] = (quants[note.quant] ?? 0) + 1 / list.length;
  return { steps: list.length, perSecond: list.length / span, quants };
}
