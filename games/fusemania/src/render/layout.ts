import { COLUMNS } from "../engine/view-kit.js";
import { BASE_WINDOW_MS, type LaneGeometry } from "./mods.js";

/**
 * Where everything goes on the canvas, as pure arithmetic over its size. Sizes are in the pixels the scene draws in
 * (device pixels); `unit` is how many of them one CSS pixel is, so the chrome keeps its size on a dense screen.
 *
 * A rider's device shows its own field, large, with the other riders' fields beside it, smaller and with their
 * arrows shuffled (`scramble.ts`): its own in the middle of an odd number of riders and on the left of an even one.
 * The leaderboard is beside them, or, where that would squeeze the fields (a portrait phone), a strip of boxes along
 * the top. A watcher or the shared screen shows every field in a row, all the same size, with the leaderboard on the
 * right when there is room. A rider alone has no leaderboard.
 */
export interface Field {
  slot: number;
  /** The lanes' left edge and one column's width. */
  x: number;
  col: number;
  /** The header band: name, place and score. */
  top: number;
  headerHeight: number;
  /** The lanes, top to bottom. */
  laneTop: number;
  laneBottom: number;
  /** Where the power-up read-out is anchored, and whether its text runs right from there (1) or ends there (−1). */
  hudX: number;
  hudAlign: number;
}
export interface Panel {
  /** A row of compact boxes along the top (true) or a column of full ones on the right. */
  strip: boolean;
  x: number;
  y: number;
  boxWidth: number;
  boxHeight: number;
  gap: number;
  count: number;
}
export interface Layout {
  width: number;
  height: number;
  unit: number;
  /** The title bar across the top, with the song's progress along its bottom edge. */
  barHeight: number;
  /** The fields drawn, left to right: everyone's. On a rider's device its own is the big one, at `ownPlace`. */
  fields: Field[];
  panel?: Panel;
  /** The race line under the lanes (`race.ts`); left out where the lanes have no height to spare. */
  race?: Race;
}
/** The band the race line is drawn in: as wide as the row of fields. */
export interface Race {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** The race line's band and the gap over it, in CSS pixels; and the height it must leave the fields, in CSS pixels. */
const RACE_HEIGHT = 30,
  RACE_GAP = 6,
  RACE_LEAVES = 200;

/** A field's lanes are at least this many columns long, header included. */
const MIN_COLUMNS_HIGH = 6.5;
/** How far from the lanes' near edge the targets sit, in columns. */
export const TARGET_INSET = 0.95;
/**
 * Half a note: a note comes in, and a missed one is gone, with its centre this far inside the lanes, so nothing is
 * drawn over the header or under the touch buttons.
 */
const NOTE_MARGIN = 0.5;

/** The widest a column is drawn: a field does not grow with a wide screen, only with a tall one. */
const columnCap = (areaHeight: number, unit: number): number =>
  Math.max(88 * unit, areaHeight / 10);

function columnFor(
  width: number,
  areaHeight: number,
  count: number,
  unit: number,
): number {
  const gap = count === 1 ? 0.3 : 0.6;
  return Math.max(
    1,
    Math.floor(
      Math.min(
        width / (count * COLUMNS + (count + 1) * gap),
        areaHeight / MIN_COLUMNS_HIGH,
        columnCap(areaHeight, unit),
      ),
    ),
  );
}

/**
 * Beside the other riders' fields, a rider's own keeps at least this much of the column it would have alone; theirs
 * are at most `RIVAL_MAX` and at least `RIVAL_MIN` of its column, and a gap is `RIVAL_GAP` of theirs.
 */
const OWN_KEEP = 0.7,
  RIVAL_MAX = 0.8,
  RIVAL_MIN = 0.25,
  RIVAL_GAP = 0.5;

/** The gap beside a rival's field. */
const rivalGap = (rival: number, unit: number): number =>
  Math.round(Math.max(6 * unit, rival * RIVAL_GAP));

/**
 * The columns of a rider's own field and of each of the `rivals` fields beside it, in `width`. The rivals' shrink
 * first, down to `RIVAL_MIN` of the rider's own; only then does the rider's own give way.
 */
function split(
  width: number,
  areaHeight: number,
  rivals: number,
  unit: number,
  out: { own: number; rival: number },
): void {
  const alone = columnFor(width, areaHeight, 1, unit);
  // What the rivals take, in their own columns: a field and a gap each, and a gap at the outside.
  const theirs = rivals * (COLUMNS + RIVAL_GAP) + RIVAL_GAP;
  const ratio = Math.max(
    RIVAL_MIN,
    Math.min(RIVAL_MAX, (width / (alone * OWN_KEEP) - COLUMNS) / theirs),
  );
  let own = Math.max(
    1,
    Math.min(alone, Math.floor(width / (COLUMNS + ratio * theirs))),
  );
  const rival = (): number =>
    Math.max(1, Math.min(own, Math.floor(own * ratio)));
  // The gaps have a least size, which the arithmetic above does not know of.
  while (
    own > 1 &&
    own * COLUMNS + rivals * (rival() * COLUMNS + rivalGap(rival(), unit)) >
      width
  )
    own--;
  out.own = own;
  out.rival = rival();
}

/** Where the local rider's field is in the row: the middle of an odd number of fields, the left of an even one. */
export const ownPlace = (fields: number): number =>
  fields % 2 === 1 ? (fields - 1) / 2 : 0;

export function layoutFor(
  width: number,
  height: number,
  riders: number,
  local: number,
  inset = 0,
  unit = 1,
): Layout {
  const count = Math.max(0, Math.min(5, Math.trunc(riders)));
  const own = local >= 0 && local < count;
  const pad = Math.round(8 * unit);
  const barHeight = Math.round(24 * unit);
  const floor = Math.max(0, height - Math.max(0, inset) * unit - pad);
  let top = barHeight + Math.round(pad / 2);
  // The race line takes a band under the lanes, where the lanes can spare it.
  const raceHeight = Math.round(RACE_HEIGHT * unit);
  const raced = floor - top - raceHeight >= RACE_LEAVES * unit;
  const bottom = raced
    ? floor - raceHeight - Math.round(RACE_GAP * unit)
    : floor;
  let right = width;
  const layout: Layout = { width, height, unit, barHeight, fields: [] };
  if (count === 0) return layout;
  const rivals = own ? count - 1 : 0;
  const whole = { own: 0, rival: 0 },
    beside = { own: 0, rival: 0 };
  /** The columns in `across`: a rider's own and the rivals', or every field's alike on a shared screen. */
  const columns = (
    across: number,
    area: number,
    out: { own: number; rival: number },
  ): void => {
    if (rivals > 0) split(across, area, rivals, unit, out);
    else out.own = out.rival = columnFor(across, area, count, unit);
  };

  if (count > 1) {
    const area = bottom - top;
    const panelWidth = Math.round(
      Math.max(150 * unit, Math.min(300 * unit, width * 0.22)),
    );
    columns(width, area, whole);
    columns(width - panelWidth - 2 * pad, area, beside);
    const gap = Math.round(6 * unit);
    // The board goes beside the fields unless that costs them too much of their size. A rider's device gives a
    // little more, since the board is its only ranking, but not at its rivals' fields' expense.
    const keep = own ? 0.7 : 0.8;
    if (
      beside.own >= whole.own * keep &&
      beside.rival >= whole.rival * keep &&
      beside.own >= 30 * unit
    ) {
      layout.panel = {
        strip: false,
        x: width - panelWidth - pad,
        y: top,
        boxWidth: panelWidth,
        boxHeight: Math.max(
          1,
          Math.floor(Math.min(96 * unit, (area - (count - 1) * gap) / count)),
        ),
        gap,
        count,
      };
      // The gutter between the field and the boxes is where a thrown attack's zap runs.
      right = layout.panel.x - Math.round(18 * unit);
    } else if (own) {
      const stripGap = Math.round(4 * unit);
      layout.panel = {
        strip: true,
        x: pad,
        y: top,
        boxWidth: Math.max(
          1,
          Math.floor((width - 2 * pad - (count - 1) * stripGap) / count),
        ),
        boxHeight: Math.round(40 * unit),
        gap: stripGap,
        count,
      };
      // Under the strip, a little room for the zap.
      top += layout.panel.boxHeight + Math.round(10 * unit);
    }
  }

  const area = Math.max(0, bottom - top);
  columns(right, area, whole);
  const shown = count,
    mine = own ? ownPlace(shown) : -1;
  const gap = own
    ? rivalGap(whole.rival, unit)
    : Math.round(whole.own * (shown === 1 ? 0.3 : 0.6));
  const total =
    (own ? whole.own + rivals * whole.rival : shown * whole.own) * COLUMNS +
    (shown - 1) * gap;
  // Every header is as tall as the biggest field's, so the lanes start level.
  const headerHeight = Math.round(Math.max(30 * unit, whole.own * 0.44));
  let x = Math.round((right - total) / 2),
    rival = 0;
  for (let i = 0; i < shown; i++) {
    const col = !own || i === mine ? whole.own : whole.rival;
    // A rider's own slot, then the others in slot order around it.
    const slot = !own
      ? i
      : i === mine
        ? local
        : rival < local
          ? rival
          : rival + 1;
    if (own && i !== mine) rival++;
    // Room beside a rider's own field, at the left of the row: the power-up read-out goes there.
    const gutter = (shown === 1 || i === mine) && i === 0 && x >= col * 2.6;
    layout.fields.push({
      slot,
      x,
      col,
      top,
      headerHeight,
      laneTop: top + headerHeight,
      laneBottom: Math.max(top + headerHeight, bottom),
      hudX: gutter ? x - Math.round(col * 0.35) : x + Math.round(col * 0.2),
      hudAlign: gutter ? -1 : 1,
    });
    x += col * COLUMNS + gap;
  }
  if (raced) {
    const left = layout.fields[0]!.x;
    layout.race = {
      x: left,
      y: floor - raceHeight,
      width: x - gap - left,
      height: raceHeight,
    };
  }
  return layout;
}

/** The left edge of the leaderboard box at `row` (0 is the leader; fractional part way through a slide). */
export const boxX = (panel: Panel, row: number): number =>
  panel.strip ? panel.x + row * (panel.boxWidth + panel.gap) : panel.x;
export const boxY = (panel: Panel, row: number): number =>
  panel.strip ? panel.y : panel.y + row * (panel.boxHeight + panel.gap);

/** A field's lanes for the mods' math, with x measured from the field's left edge. `out` is filled and returned. */
export function laneOf(
  field: Field,
  speed: number,
  down: boolean,
  out: LaneGeometry,
): LaneGeometry {
  const inset = field.col * TARGET_INSET;
  out.columnWidth = field.col;
  out.down = down;
  out.targetY = down ? field.laneBottom - inset : field.laneTop + inset;
  const margin = field.col * NOTE_MARGIN;
  out.length = Math.max(1, field.laneBottom - field.laneTop - inset - margin);
  out.runout = Math.max(1, inset - margin);
  out.windowMs = BASE_WINDOW_MS / (speed > 0 ? speed : 1);
  return out;
}
