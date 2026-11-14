/**
 * The result's timing graph, drawn on a canvas.
 *
 * Across: the song from its first beat to its end. Up and down: how far a press was from its note, with the line
 * in the middle at 0 ms, early above it and late below. Every step hit is one dot in its judgment's colour, every
 * miss a red tick on the floor. Beside it, on the same scale, how many hits fell at each offset, so the spread and
 * the lean are read at a glance; under it, on the same time axis, the combo as it grew and broke.
 */
import { BOO, MARVELOUS, MISS, WINDOWS } from "../engine/index.js";
import { JUDGMENT_COLORS } from "../render/palette.js";
import { graphRange, histogram, runStats, type RunLog } from "./run-log.js";

/** The part of a 2D context the graph draws with. */
export type GraphContext = Pick<
  CanvasRenderingContext2D,
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "globalAlpha"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "clearRect"
  | "fillRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "arc"
  | "fill"
  | "stroke"
  | "fillText"
  | "setLineDash"
>;

export interface GraphRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Where the three parts go on a canvas of `width` by `height` CSS pixels. */
export function graphLayout(
  width: number,
  height: number,
): { plot: GraphRect; bars: GraphRect; combo: GraphRect } {
  const barsW = Math.round(Math.max(36, Math.min(110, width * 0.16))),
    axisW = 34,
    comboH = Math.round(Math.max(24, Math.min(44, height * 0.17))),
    top = 14,
    plotH = Math.max(40, height - top - comboH - 16),
    plotW = Math.max(40, width - barsW - axisW - 2);
  return {
    plot: { x: 1, y: top, w: plotW, h: plotH },
    bars: { x: plotW + axisW, y: top, w: barsW, h: plotH },
    combo: { x: 1, y: top + plotH + 14, w: plotW, h: comboH },
  };
}

const judgmentOf = (off: number): number => {
  const distance = Math.abs(off);
  for (let judgment = MARVELOUS; judgment <= BOO; judgment++)
    if (distance <= WINDOWS[judgment]!) return judgment;
  return BOO;
};

export interface GraphOptions {
  /** The song's length, ms. */
  endMs: number;
  /** The font family for the labels. */
  font: string;
}

export function drawTimingGraph(
  ctx: GraphContext,
  width: number,
  height: number,
  log: RunLog,
  options: GraphOptions,
): void {
  const { plot, bars, combo } = graphLayout(width, height),
    range = graphRange(log.steps),
    endMs = Math.max(1, options.endMs),
    stats = runStats(log.steps),
    mid = plot.y + plot.h / 2,
    yOf = (off: number) => mid + (off / range) * (plot.h / 2),
    xOf = (ms: number) =>
      plot.x + (Math.max(0, Math.min(endMs, ms)) / endMs) * plot.w,
    label = (size: number) => `${size}px ${options.font}`;
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // The field, and a faint band for each judgment's window.
  ctx.fillStyle = "#081230";
  ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
  ctx.fillRect(bars.x, bars.y, bars.w, bars.h);
  ctx.fillRect(combo.x, combo.y, combo.w, combo.h);
  let inner = 0;
  for (let judgment = MARVELOUS; judgment <= BOO; judgment++) {
    const outer = Math.min(range, WINDOWS[judgment]!);
    if (outer <= inner) break;
    ctx.globalAlpha = judgment === MARVELOUS ? 0.1 : 0.05;
    ctx.fillStyle = JUDGMENT_COLORS[judgment]!;
    for (const side of [-1, 1]) {
      const from = yOf(side * inner),
        to = yOf(side * outer);
      for (const part of [plot, bars])
        ctx.fillRect(part.x, Math.min(from, to), part.w, Math.abs(to - from));
    }
    inner = outer;
  }
  ctx.globalAlpha = 1;

  // The axis between the two: the window edges in ms.
  ctx.font = label(8);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#8fa0d8";
  const axisX = plot.x + plot.w + (bars.x - plot.x - plot.w) / 2;
  ctx.fillText("0", axisX, mid);
  for (const edge of WINDOWS) {
    // Only the edges with room for a label.
    if (edge > range || (edge / range) * (plot.h / 2) < 12) continue;
    if (edge !== WINDOWS[0] && (edge / range) * (plot.h / 2) < 26) continue;
    ctx.fillText(`−${edge}`, axisX, yOf(-edge));
    ctx.fillText(`+${edge}`, axisX, yOf(edge));
  }

  // Misses: ticks on the floor, so a section that fell apart shows where it was.
  ctx.fillStyle = JUDGMENT_COLORS[MISS];
  ctx.globalAlpha = 0.55;
  const tick = Math.min(10, plot.h * 0.08);
  for (const at of log.misses)
    ctx.fillRect(xOf(at) - 0.5, plot.y + plot.h - tick, 1, tick);
  ctx.globalAlpha = 1;

  // The line every press aims for.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(plot.x, mid);
  ctx.lineTo(plot.x + plot.w, mid);
  ctx.moveTo(bars.x, mid);
  ctx.lineTo(bars.x + bars.w, mid);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // One dot per step.
  const radius =
    log.steps.length > 600 ? 1.6 : log.steps.length > 250 ? 2 : 2.6;
  ctx.globalAlpha = 0.9;
  for (const step of log.steps) {
    if (!Number.isFinite(step.off)) continue;
    ctx.fillStyle = JUDGMENT_COLORS[step.judgment] ?? "#ffffff";
    ctx.beginPath();
    ctx.arc(xOf(step.at), yOf(step.off), radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Where the presses landed on average.
  if (stats.hits) {
    ctx.strokeStyle = "#ff8ad4";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, yOf(stats.meanMs));
    ctx.lineTo(plot.x + plot.w, yOf(stats.meanMs));
    ctx.moveTo(bars.x, yOf(stats.meanMs));
    ctx.lineTo(bars.x + bars.w, yOf(stats.meanMs));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // How many hits at each offset, on the same scale.
  const binMs = range > 100 ? 6 : 3,
    bins = histogram(log.steps, range, binMs),
    most = Math.max(1, ...bins),
    binH = plot.h / bins.length;
  bins.forEach((count, index) => {
    if (!count) return;
    ctx.fillStyle =
      JUDGMENT_COLORS[judgmentOf(-range + (index + 0.5) * binMs)]!;
    ctx.fillRect(
      bars.x,
      plot.y + index * binH,
      Math.max(1, (count / most) * bars.w),
      Math.max(1, binH - 0.5),
    );
  });

  // The combo over the song.
  let best = 0;
  for (const [, value] of log.combo) best = Math.max(best, value);
  if (best > 0) {
    const floor = combo.y + combo.h,
      cy = (value: number) => floor - (value / best) * (combo.h - 2);
    ctx.fillStyle = "#16e7ff";
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(combo.x, floor);
    let level = 0;
    for (const [at, value] of log.combo) {
      // A break drops straight down; a combo that grows climbs to its new height.
      if (value < level) ctx.lineTo(xOf(at), cy(level));
      ctx.lineTo(xOf(at), cy(value));
      level = value;
    }
    ctx.lineTo(combo.x + combo.w, cy(level));
    ctx.lineTo(combo.x + combo.w, floor);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // What is where.
  ctx.font = label(8);
  ctx.fillStyle = "#8fa0d8";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("EARLY", plot.x + 4, plot.y + 4);
  ctx.fillText("COMBO", combo.x + 4, combo.y + 4);
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "LATE",
    plot.x + 4,
    plot.y + plot.h - 4 - (log.misses.length ? tick : 0),
  );
  ctx.fillText("EVERY STEP, START TO END", plot.x, plot.y - 3);
  ctx.textAlign = "right";
  ctx.fillText("SPREAD", bars.x + bars.w, plot.y - 3);
}
