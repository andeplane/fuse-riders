/**
 * The chart lab's record mode: while the song plays, the listener taps the rhythm they hear on WASD or IJKL, and each
 * tap lands as an arrow at the moment it was pressed. The taps are a sketch of where the steps should be, not a
 * chart: they are kept as they were played, unsnapped, for whoever tunes the chart generator to read.
 */
import { NotesError } from "./notes.js";

/** One tap: seconds into the music, the beat there on the song's timing, and the lane (left, down, up, right). */
export interface Tap {
  time: number;
  beat: number;
  column: number;
}

/** A song's taps as they are stored. */
export interface TapsFile {
  version: 1;
  song: string;
  taps: Tap[];
}

export const MAX_TAPS = 20000;
const SONG_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const LANES: Readonly<Record<string, number>> = {
  a: 0,
  s: 1,
  w: 2,
  d: 3,
  j: 0,
  k: 1,
  i: 2,
  l: 3,
};

/** The lane a key taps: WASD and IJKL laid out like the arrow keys (left, down, up, right), or undefined. */
export const tapColumn = (key: string): number | undefined =>
  LANES[key.toLowerCase()];

/** The taps with one more, in time order. */
export function addTap(taps: readonly Tap[], tap: Tap): Tap[] {
  return [...taps, tap].sort((a, b) => a.time - b.time || a.column - b.column);
}

/** The taps without one tap at that time and lane (the first such, if it was pressed twice). */
export function removeTap(taps: readonly Tap[], tap: Tap): Tap[] {
  const index = taps.findIndex(
    (other) => other.time === tap.time && other.column === tap.column,
  );
  return index < 0 ? [...taps] : taps.filter((_, i) => i !== index);
}

/** The taps outside the time span `[start, end]`: what is left after deleting a selection. */
export function removeSpan(
  taps: readonly Tap[],
  start: number,
  end: number,
): Tap[] {
  return taps.filter((tap) => tap.time < start || tap.time > end);
}

export const writeTaps = (file: TapsFile): string =>
  `${JSON.stringify(file, null, 2)}\n`;

/** Reads and checks a stored taps file. */
export function parseTaps(text: string): TapsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new NotesError("the taps are not JSON");
  }
  if (typeof raw !== "object" || raw === null)
    throw new NotesError("the taps are not an object");
  const { version, song, taps } = raw as Record<string, unknown>;
  if (version !== 1) throw new NotesError("the taps are not version 1");
  if (typeof song !== "string" || !SONG_ID.test(song))
    throw new NotesError("the taps' song id is not valid");
  if (!Array.isArray(taps) || taps.length > MAX_TAPS)
    throw new NotesError(`taps must be a list of at most ${MAX_TAPS}`);
  const number = (value: unknown, min: number, max: number): number => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new NotesError("a tap has a number out of range");
    return value;
  };
  return {
    version: 1,
    song,
    taps: taps.map((tap: unknown) => {
      if (typeof tap !== "object" || tap === null)
        throw new NotesError("a tap is not an object");
      const t = tap as Record<string, unknown>;
      const column = number(t["column"], 0, 3);
      if (!Number.isInteger(column))
        throw new NotesError("a tap's column is not a lane");
      return {
        time: number(t["time"], 0, 1e5),
        beat: number(t["beat"], -1e5, 1e5),
        column,
      };
    }),
  };
}
