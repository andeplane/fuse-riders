import { COLUMNS, HOLD_POINTS, POINTS } from "./rules.js";
import type { SimChart, TimingData } from "./simfile.js";
import { createTiming } from "./timing.js";

/**
 * A chart ready to play: its notes in milliseconds of song time, in time order, with each column's notes and mines
 * listed apart so a rider's progress is one cursor per column. Built once per chart and never changed; a match's
 * state only points into it.
 */
export const TAP = 0,
  HOLD = 1,
  ROLL = 2,
  MINE = 3;
export interface StepNote {
  /** When the note is hit, in whole milliseconds of song time. */
  ms: number;
  /** A hold's or roll's tail; the note's own time otherwise. */
  endMs: number;
  column: number;
  kind: number;
  beat: number;
}
export interface Steps {
  /** Every note, by time then column; a note's id is its index here. */
  notes: readonly StepNote[];
  /** Per column: the ids of its taps, holds and rolls, in time order. */
  lanes: readonly (readonly number[])[];
  /** Per column: the ids of its mines, in time order. */
  mines: readonly (readonly number[])[];
  /** Taps, hold heads and roll heads: everything that gets a judgment. */
  steps: number;
  /** Holds and rolls. */
  holds: number;
  /** Points for every step Marvelous and every hold kept; at least 1. */
  full: number;
  firstMs: number;
  /** The end of the last note. */
  lastMs: number;
}

/** A hold must end at least this long before the next note in its column, and last at least this long. */
const HOLD_GAP_MS = 30;

/** Compiles a 4-column chart against its tempo map. A chart of another width is refused (`undefined`). */
export function compileSteps(
  chart: SimChart,
  fallback: TimingData,
): Steps | undefined {
  if (chart.notes.some((note) => note.column >= COLUMNS)) return;
  const timing = createTiming(chart.timing ?? fallback);
  const kinds = { tap: TAP, hold: HOLD, roll: ROLL, mine: MINE } as const;
  const drafts = chart.notes
    .map((note) => {
      const ms = Math.round(timing.timeAt(note.beat) * 1000);
      return {
        ms,
        endMs:
          note.endBeat === undefined
            ? ms
            : Math.round(timing.timeAt(note.endBeat) * 1000),
        column: note.column,
        kind: kinds[note.kind] as number,
        beat: note.beat,
      };
    })
    .filter((note) => Number.isFinite(note.ms) && Number.isFinite(note.endMs))
    .sort((a, b) => a.ms - b.ms || a.column - b.column);
  // One note per column and millisecond: a second on the same spot is dropped.
  const notes: StepNote[] = [];
  const lastIn: (StepNote | undefined)[] = [];
  for (const draft of drafts) {
    const before = lastIn[draft.column];
    if (before && before.ms === draft.ms) continue;
    if (before && before.kind !== MINE && draft.kind !== MINE) {
      // A hold never runs into the next note of its column.
      if (before.endMs > draft.ms - HOLD_GAP_MS)
        before.endMs = draft.ms - HOLD_GAP_MS;
    }
    const note: StepNote = { ...draft };
    notes.push(note);
    if (note.kind !== MINE) lastIn[draft.column] = note;
  }
  for (const note of notes) {
    if (note.kind === TAP || note.kind === MINE) note.endMs = note.ms;
    else if (note.endMs < note.ms + HOLD_GAP_MS) {
      note.kind = TAP;
      note.endMs = note.ms;
    }
  }
  const lanes: number[][] = [],
    mines: number[][] = [];
  for (let column = 0; column < COLUMNS; column++) {
    lanes.push([]);
    mines.push([]);
  }
  let steps = 0,
    holds = 0,
    lastMs = 0;
  for (const [id, note] of notes.entries()) {
    if (note.kind === MINE) mines[note.column]!.push(id);
    else {
      lanes[note.column]!.push(id);
      steps++;
      if (note.kind !== TAP) holds++;
      lastMs = Math.max(lastMs, note.endMs);
    }
  }
  if (steps === 0) return;
  return {
    notes,
    lanes,
    mines,
    steps,
    holds,
    full: steps * POINTS[0] + holds * HOLD_POINTS,
    firstMs: notes.find((note) => note.kind !== MINE)!.ms,
    lastMs,
  };
}
