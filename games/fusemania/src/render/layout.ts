import { COLUMNS } from "../engine/view-kit.js";
import { BASE_WINDOW_MS, type LaneGeometry } from "./mods.js";

/**
 * Where everything goes on the canvas, as pure arithmetic over its size. Sizes are in the pixels the scene draws in
 * (device pixels); `unit` is how many of them one CSS pixel is, so the chrome keeps its size on a dense screen.
 *
 * A rider's device shows its own field, large, with the leaderboard beside it (or, on a narrow portrait phone, as a
 * strip of boxes along the top so the field keeps its width). A watcher or the shared screen shows every field in a
 * row, with the leaderboard on the right when there is room. A rider alone has no leaderboard.
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
  /** The fields drawn: the local rider's alone, or everyone's. */
  fields: Field[];
  panel?: Panel;
}

/** A field's lanes are at least this many columns long, header included. */
const MIN_COLUMNS_HIGH = 6.5;
/** How far from the lanes' near edge the targets sit, in columns. */
export const TARGET_INSET = 0.72;

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
  const shown = own ? 1 : count;
  const pad = Math.round(8 * unit);
  const barHeight = Math.round(24 * unit);
  const bottom = Math.max(0, height - Math.max(0, inset) * unit - pad);
  let top = barHeight + Math.round(pad / 2);
  let right = width;
  const layout: Layout = { width, height, unit, barHeight, fields: [] };
  if (shown === 0) return layout;

  if (count > 1) {
    const area = bottom - top;
    const wanted = columnFor(width, area, shown, unit);
    const panelWidth = Math.round(
      Math.max(150 * unit, Math.min(300 * unit, width * 0.22)),
    );
    const beside = columnFor(width - panelWidth - 2 * pad, area, shown, unit);
    const gap = Math.round(6 * unit);
    if (beside >= wanted * 0.8 && beside >= 30 * unit) {
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
  const col = columnFor(right, area, shown, unit);
  const gap = Math.round(col * (shown === 1 ? 0.3 : 0.6));
  const fieldWidth = col * COLUMNS;
  const total = shown * fieldWidth + (shown - 1) * gap;
  const start = Math.round((right - total) / 2);
  const headerHeight = Math.round(Math.max(26 * unit, col * 0.42));
  for (let i = 0; i < shown; i++) {
    const x = start + i * (fieldWidth + gap);
    const gutter = shown === 1 && x >= col * 2.6;
    layout.fields.push({
      slot: own ? local : i,
      x,
      col,
      top,
      headerHeight,
      laneTop: top + headerHeight,
      laneBottom: Math.max(top + headerHeight, bottom),
      hudX: gutter ? x - Math.round(col * 0.35) : x + Math.round(col * 0.2),
      hudAlign: gutter ? -1 : 1,
    });
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
  out.length = Math.max(1, field.laneBottom - field.laneTop - inset);
  out.runout = inset;
  out.windowMs = BASE_WINDOW_MS / (speed > 0 ? speed : 1);
  return out;
}
