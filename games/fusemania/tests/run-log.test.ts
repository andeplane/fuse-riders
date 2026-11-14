import test from "node:test";
import assert from "node:assert/strict";
import {
  COUNTS,
  GREAT,
  MARVELOUS,
  MISS,
  PERFECT,
  WORST_WINDOW,
  type PlayerView,
} from "../src/engine/index.js";
import {
  createRunLogger,
  graphRange,
  histogram,
  runStats,
  statLines,
} from "../src/app/run-log.js";
import { RESUME_MS, createPauseClock, resumeCount } from "../src/app/pause.js";
import {
  drawTimingGraph,
  graphLayout,
  type GraphContext,
} from "../src/app/timing-graph.js";

/** A rider's picture with `counts` of each judgment, the newest one `judged` at `judgedAt`, `judgedOff` off. */
function player(
  counts: Partial<Record<number, number>>,
  judged: number,
  judgedAt: number,
  judgedOff: number,
  combo = 0,
): PlayerView {
  return {
    id: "a",
    slot: 0,
    bot: false,
    chart: 0,
    score: 0,
    rating: 0,
    place: 1,
    combo,
    worst: combo > 0 ? 1 : -1,
    best: combo,
    counts: Array.from({ length: COUNTS }, (_, index) => counts[index] ?? 0),
    next: [0, 0, 0, 0],
    hold: [-1, -1, -1, -1],
    let: [0, 0, 0, 0],
    down: [false, false, false, false],
    hits: [],
    judged,
    judgedAt,
    judgedOff,
    item: 0,
    itemAt: 0,
    effects: [],
    shield: 0,
    blocked: 0,
  };
}

test("the log has a dot for every step hit, a time for every miss and the combo as it moved", () => {
  const logger = createRunLogger();
  logger.observe(player({}, -1, 0, 0), "1", -500);
  logger.observe(player({ [PERFECT]: 1 }, PERFECT, 1000, -30, 1), "1", 990);
  // The same picture again adds nothing.
  logger.observe(player({ [PERFECT]: 1 }, PERFECT, 1000, -30, 1), "1", 1000);
  // A jump judged the same on both arrows: two dots in one place.
  logger.observe(
    player({ [PERFECT]: 1, [GREAT]: 2 }, GREAT, 1500, 60, 3),
    "1",
    1570,
  );
  // Two notes went by: the misses are placed at the note, not where the window closed.
  logger.observe(
    player(
      { [PERFECT]: 1, [GREAT]: 2, [MISS]: 2 },
      MISS,
      2000 + WORST_WINDOW,
      0,
      0,
    ),
    "1",
    2190,
  );
  const log = logger.log();
  assert.deepEqual(log.steps, [
    { at: 1000, off: -30, judgment: PERFECT },
    { at: 1500, off: 60, judgment: GREAT },
    { at: 1500, off: 60, judgment: GREAT },
  ]);
  assert.deepEqual(log.misses, [2000, 2000]);
  assert.deepEqual(log.combo, [
    [990, 1],
    [1570, 3],
    [2190, 0],
  ]);
  assert.equal(log.unplaced, 0);
});

test("a step whose offset the picture did not carry is counted, not guessed", () => {
  const logger = createRunLogger();
  logger.observe(player({}, -1, 0, 0), "1", 0);
  // A Marvelous and a Perfect in one frame: the picture has the Perfect's offset only.
  logger.observe(
    player({ [MARVELOUS]: 1, [PERFECT]: 1 }, PERFECT, 1000, 40),
    "1",
    1040,
  );
  assert.deepEqual(logger.log().steps, [
    { at: 1000, off: 40, judgment: PERFECT },
  ]);
  assert.equal(logger.log().unplaced, 1);
});

test("another match starts the log over, and it is bounded", () => {
  const logger = createRunLogger(2);
  logger.observe(player({}, -1, 0, 0), "1", 0);
  for (let n = 1; n <= 5; n++)
    logger.observe(player({ [PERFECT]: n }, PERFECT, n * 100, 5, n), "1", n);
  assert.equal(logger.log().steps.length, 2);
  assert.equal(logger.log().combo.length, 2);
  logger.observe(player({ [PERFECT]: 5 }, PERFECT, 500, 5), "2", 0);
  assert.deepEqual(logger.log(), {
    steps: [],
    misses: [],
    combo: [],
    unplaced: 0,
  });
  // What the new match opened with is not a hit of its own.
  logger.observe(player({ [PERFECT]: 6 }, PERFECT, 600, -7), "2", 600);
  assert.deepEqual(logger.log().steps, [
    { at: 600, off: -7, judgment: PERFECT },
  ]);
});

test("the stats say where the presses landed and how widely", () => {
  const steps = [-40, -30, -10, 0, 10, 30, 40, 80].map((off, index) => ({
    at: index * 100,
    off,
    judgment: PERFECT,
  }));
  const stats = runStats(steps);
  assert.equal(stats.hits, 8);
  assert.equal(stats.meanMs, 10);
  assert.equal(Math.round(stats.spreadMs * 100) / 100, 36.74);
  assert.equal(stats.absMs, 30);
  // Inside a Marvelous is neither early nor late.
  assert.equal(stats.early, 2);
  assert.equal(stats.late, 3);
  assert.equal(stats.worstMs, 80);
  assert.deepEqual(statLines(stats), [
    ["MEAN", "+10.0 ms LATE"],
    ["STD DEV", "36.7 ms"],
    ["MEAN ABS", "30.0 ms"],
    ["EARLY", "2"],
    ["LATE", "3"],
  ]);
  assert.deepEqual(statLines(runStats([])), []);
  assert.equal(
    statLines(runStats([{ at: 0, off: -12, judgment: MARVELOUS }]))[0]![1],
    "−12.0 ms EARLY",
  );
});

test("the graph's range holds every hit and its histogram counts them all", () => {
  const steps = [-70, -3, 0, 2, 69.9].map((off) => ({
    at: 0,
    off,
    judgment: GREAT,
  }));
  assert.equal(graphRange(steps), 78);
  // A tight run is not stretched past a Perfect; a wild one stops at the last window.
  assert.equal(graphRange([{ at: 0, off: 4, judgment: MARVELOUS }]), 55);
  assert.equal(graphRange([{ at: 0, off: 179, judgment: 4 }]), WORST_WINDOW);
  const bins = histogram(steps, 78, 4);
  assert.equal(bins.length, 39);
  assert.equal(
    bins.reduce((sum, count) => sum + count, 0),
    5,
  );
  assert.equal(bins[2], 1);
  assert.deepEqual(bins.slice(18, 21), [1, 1, 1]);
});

test("a pause clock stands still while paused and goes on from where it stood", () => {
  let time = 1000;
  const clock = createPauseClock(() => time);
  assert.equal(clock.now(), 1000);
  time = 1500;
  clock.pause();
  clock.pause();
  time = 9000;
  assert.equal(clock.paused, true);
  assert.equal(clock.now(), 1500);
  clock.resume();
  clock.resume();
  assert.equal(clock.paused, false);
  assert.equal(clock.now(), 1500);
  time = 9250;
  assert.equal(clock.now(), 1750);
  clock.pause();
  time = 9300;
  clock.resume();
  assert.equal(clock.now(), 1750);
});

test("the count-in reads three, two, one", () => {
  assert.equal(resumeCount(RESUME_MS), "3");
  assert.equal(resumeCount(RESUME_MS - 501), "2");
  assert.equal(resumeCount(1), "1");
  assert.equal(resumeCount(0), "1");
});

test("the graph draws one dot per step inside its plot and a tick per miss", () => {
  const { plot, bars, combo } = graphLayout(600, 240);
  assert.ok(plot.x + plot.w < bars.x);
  assert.ok(bars.x + bars.w <= 600);
  assert.ok(plot.y + plot.h < combo.y);
  assert.ok(combo.y + combo.h <= 240);
  const dots: [number, number][] = [],
    rects: [number, number, number, number][] = [];
  const context: GraphContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "top",
    clearRect() {},
    fillRect(x, y, w, h) {
      rects.push([x, y, w, h]);
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc(x, y) {
      dots.push([x, y]);
    },
    fill() {},
    stroke() {},
    fillText() {},
    setLineDash() {},
  };
  drawTimingGraph(
    context,
    600,
    240,
    {
      steps: [
        { at: 0, off: -45, judgment: PERFECT },
        { at: 50_000, off: 0, judgment: MARVELOUS },
        { at: 100_000, off: 45, judgment: PERFECT },
      ],
      misses: [25_000],
      combo: [
        [0, 1],
        [50_000, 2],
        [60_000, 0],
      ],
      unplaced: 0,
    },
    { endMs: 100_000, font: "monospace" },
  );
  assert.equal(dots.length, 3);
  const mid = plot.y + plot.h / 2;
  // Early is above the line, late below it, a perfect press on it; the song runs left to right.
  assert.deepEqual(dots[1], [plot.x + plot.w / 2, mid]);
  assert.ok(dots[0]![1] < mid && dots[2]![1] > mid);
  assert.equal(dots[0]![0], plot.x);
  assert.equal(dots[2]![0], plot.x + plot.w);
  for (const [, y] of dots) assert.ok(y >= plot.y && y <= plot.y + plot.h);
  // The miss: a one-pixel tick on the plot's floor, a quarter of the way along.
  assert.ok(
    rects.some(
      ([x, y, w, h]) =>
        w === 1 &&
        Math.abs(x + 0.5 - (plot.x + plot.w / 4)) < 1e-9 &&
        Math.abs(y + h - (plot.y + plot.h)) < 1e-9,
    ),
  );
});
