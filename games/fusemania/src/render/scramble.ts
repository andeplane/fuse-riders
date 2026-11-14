import { COLUMNS } from "../engine/view-kit.js";

/**
 * How a field's columns are shown. A rider's device draws the other riders' fields beside its own so that a thrown
 * attack can be seen landing, but an opponent's arrows are not there to be read: every column is drawn in another
 * column's place, with that place's arrow, so the field looks like any other and says nothing about which key the
 * opponent is being asked for. `columns[real]` is the place a column is drawn in.
 *
 * It is the same shuffle for every opponent on a device (two riders on one chart look alike), it changes from match
 * to match with the match's seed, and it is only ever the picture: the view, the charts and the judging are untouched.
 */
export const PLAIN: readonly number[] = Array.from(
  { length: COLUMNS },
  (_, column) => column,
);

/**
 * The shuffles that leave no column in its own place. The plain mirror is left out: a flip attack mirrors the
 * columns too, and the two together would put every arrow back.
 */
export const SCRAMBLES: readonly (readonly number[])[] = [
  [1, 2, 3, 0],
  [3, 0, 1, 2],
  [1, 0, 3, 2],
  [2, 3, 0, 1],
  [1, 3, 0, 2],
  [2, 0, 3, 1],
  [2, 3, 1, 0],
  [3, 2, 0, 1],
];

/** The shuffle a match's opponents are drawn with. */
export const scrambleFor = (seed: number): readonly number[] =>
  SCRAMBLES[
    (Math.trunc(Number.isFinite(seed) ? seed : 0) >>> 0) % SCRAMBLES.length
  ]!;
