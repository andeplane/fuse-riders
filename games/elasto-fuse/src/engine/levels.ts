import { WHEEL_RADIUS } from "./bike.js";
import type { Level, LevelObject, Point } from "./level.js";
import { PI, TAU, cos } from "./math.js";

/**
 * The tour's levels, drawn here in code: each floor is a pen path of straight runs, eased ramps and smooth hills,
 * closed into the level's sky polygon by a ceiling. The curves use the engine's own cosine, so every device builds
 * the same vertices. The levels are original to Elasto Fuse. They are rules data: changing one changes `RULES`.
 */
class Path {
  readonly points: Point[] = [];
  private x: number;
  private y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.points.push({ x, y });
  }
  /** A straight line to (`dx`, `dy`) from here. */
  to(dx: number, dy: number): this {
    this.x += dx;
    this.y += dy;
    this.points.push({ x: this.x, y: this.y });
    return this;
  }
  flat(distance: number): this {
    return this.to(distance, 0);
  }
  /** A smooth ramp: flat at both ends, `dy` higher after `dx`. */
  ease(dx: number, dy: number, pieces = 10): this {
    const x0 = this.x,
      y0 = this.y;
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces;
      this.x = x0 + dx * t;
      this.y = i === pieces ? y0 + dy : y0 + (dy * (1 - cos(PI * t))) / 2;
      this.points.push({ x: this.x, y: this.y });
    }
    return this;
  }
  /** A smooth hill `height` high (a dip when negative) over `width`, back to this height. */
  hill(width: number, height: number, pieces = 14): this {
    const x0 = this.x,
      y0 = this.y;
    for (let i = 1; i <= pieces; i++) {
      const t = i / pieces;
      this.x = x0 + width * t;
      this.y = i === pieces ? y0 : y0 + (height * (1 - cos(TAU * t))) / 2;
      this.points.push({ x: this.x, y: this.y });
    }
    return this;
  }
}
const path = (x: number, y: number): Path => new Path(x, y);

/** The floor's height at `x`: the first piece of the path that spans it. */
function surface(points: readonly Point[], x: number): number {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!,
      b = points[i + 1]!;
    if (b.x > a.x && x >= a.x && x <= b.x)
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  throw new Error(`no floor at ${x}`);
}

/** `[x, height above the floor]`, and for an apple optionally the gravity it turns on. */
type Spot = readonly [x: number, up: number];
interface Plan {
  id: string;
  name: string;
  floor: Path;
  /** The ceiling's height: a number for a flat one, or its own path from left to right. */
  top: number | Path;
  start: number;
  apples: readonly Spot[];
  flower: Spot;
  killers?: readonly Spot[];
  /** Pieces of ground floating in the sky, and objects placed by hand. */
  islands?: readonly (readonly Point[])[];
  objects?: readonly LevelObject[];
}
/** How high above the floor a wheel's hub starts: resting, with a hair of air. */
const START_UP = WHEEL_RADIUS + 0.02;

function level(plan: Plan): Level {
  const floor = plan.floor.points;
  const first = floor[0]!,
    last = floor[floor.length - 1]!;
  const ceiling =
    typeof plan.top === "number"
      ? [
          { x: last.x, y: plan.top },
          { x: first.x, y: plan.top },
        ]
      : [...plan.top.points].reverse();
  const spot = (kind: LevelObject["kind"], [x, up]: Spot): LevelObject => ({
    kind,
    x,
    y: surface(floor, x) + up,
  });
  return {
    id: plan.id,
    name: plan.name,
    polygons: [[...floor, ...ceiling], ...(plan.islands ?? [])],
    start: { x: plan.start, y: surface(floor, plan.start) + START_UP },
    objects: [
      ...plan.apples.map((at) => spot("apple", at)),
      ...(plan.killers ?? []).map((at) => spot("killer", at)),
      ...(plan.objects ?? []),
      spot("flower", plan.flower),
    ],
  };
}
const box = (x0: number, x1: number, top: number, depth: number): Point[] => [
  { x: x0, y: top },
  { x: x1, y: top },
  { x: x1, y: top - depth },
  { x: x0, y: top - depth },
];
const row = (from: number, to: number, gap: number, up: number): Spot[] => {
  const spots: Spot[] = [];
  for (let x = from; x <= to; x += gap) spots.push([x, up]);
  return spots;
};

/** Flat out: holding the gas is enough here, and nowhere else. */
const warmUp = level({
  id: "warm-up",
  name: "Warm Up",
  floor: path(0, 0).flat(70),
  top: 10,
  start: 2,
  apples: [
    [14, 0.8],
    [28, 0.8],
    [42, 0.8],
    [54, 0.8],
  ],
  flower: [66, 0.9],
});

const rollers = level({
  id: "rollers",
  name: "Rollers",
  floor: path(0, 0)
    .flat(8)
    .hill(5, 1)
    .hill(5, 1)
    .hill(5.5, 1.2)
    .hill(6, 1.4)
    .hill(6, 1.4)
    .flat(3)
    .hill(7, -1.8)
    .flat(9),
  top: 14,
  start: 2,
  apples: [
    [10.5, 0.8],
    [15.5, 0.8],
    [26.5, 0.9],
    [32.5, 0.9],
    [42, 0.8],
  ],
  flower: [51, 0.9],
});

const stepUp = level({
  id: "step-up",
  name: "Step Up",
  floor: path(0, 0)
    .flat(8)
    .ease(2.5, 1)
    .flat(5)
    .ease(2.5, 1)
    .flat(5)
    .ease(2.5, 1.1)
    .flat(5)
    .ease(2.5, 1.1)
    .flat(8)
    .ease(10, -4.2)
    .flat(9),
  top: 16,
  start: 2,
  apples: [
    [13, 0.8],
    [20.5, 0.8],
    [28, 0.8],
    [36, 0.8],
  ],
  flower: [58, 0.9],
});

const halfPipe = level({
  id: "half-pipe",
  name: "Half Pipe",
  floor: path(0, 0).flat(9).ease(9, -5).flat(5).ease(9, 5).flat(9),
  top: 14,
  start: 5,
  apples: [
    [1.2, 0.8],
    [20.5, 0.8],
    [36, 0.8],
  ],
  flower: [39.5, 0.9],
});

const theGap = level({
  id: "the-gap",
  name: "The Gap",
  floor: path(0, 0)
    .flat(14)
    .ease(6, 1.5)
    .to(0, -5)
    .flat(5)
    .to(0, 4.5)
    .flat(3)
    .ease(8, -1)
    .flat(10),
  top: 15,
  start: 2,
  apples: [
    [10, 0.8],
    [30, 0.8],
  ],
  killers: [
    [21.2, 0.5],
    [22.5, 0.5],
    [23.8, 0.5],
  ],
  flower: [43, 0.9],
});

/** A ramp up to a slab that runs back over a dead-end tunnel: ride it left, drop off, and fetch the apple under it. */
const switchback: Level = {
  id: "switchback",
  name: "Switchback",
  polygons: [
    [
      { x: 0, y: 0 },
      { x: 26, y: 0 },
      { x: 22.5, y: 3.6 },
      { x: 8, y: 3.6 },
      { x: 8, y: 4.6 },
      { x: 24, y: 4.6 },
      { x: 34, y: 0 },
      { x: 46, y: 0 },
      { x: 46, y: 14 },
      { x: 0, y: 14 },
    ],
  ],
  start: { x: 38, y: START_UP },
  objects: [
    { kind: "apple", x: 43.5, y: 0.8 },
    { kind: "apple", x: 16, y: 5.4 },
    { kind: "apple", x: 21, y: 0.8 },
    { kind: "flower", x: 1.5, y: 0.9 },
  ],
};

const bigClimb = level({
  id: "big-climb",
  name: "Big Climb",
  floor: path(0, 0)
    .flat(9)
    .ease(10, 3)
    .flat(4)
    .ease(9, 4)
    .flat(4)
    .ease(10, 5)
    .flat(10),
  top: 26,
  start: 2,
  apples: [
    [21, 0.8],
    [34, 0.8],
    [49, 0.8],
  ],
  flower: [53.5, 0.9],
});

const downhill = level({
  id: "downhill",
  name: "Downhill Run",
  floor: path(0, 0)
    .flat(8)
    .ease(8, -3)
    .hill(6, 1.2)
    .ease(10, -5)
    .flat(4)
    .hill(8, 1.5)
    .ease(8, -3)
    .flat(14),
  top: 12,
  start: 2,
  apples: [
    [19, 0.9],
    [34, 0.8],
    [40, 0.9],
  ],
  killers: [[65.4, 0.9]],
  flower: [60.5, 0.9],
});

const lowBridge = level({
  id: "low-bridge",
  name: "Low Bridge",
  floor: path(0, 0)
    .flat(10)
    .hill(8, -1.2)
    .flat(6)
    .hill(6, 0.7)
    .flat(8)
    .hill(8, -1.2)
    .flat(10),
  top: path(0, 9).flat(8).ease(3, -5.4).flat(34).ease(3, 5.4).flat(8),
  start: 2,
  apples: [
    [14, 0.8],
    [27, 0.8],
    [42, 0.8],
  ],
  flower: [53, 0.9],
  objects: [
    { kind: "killer", x: 20, y: 3.4 },
    { kind: "killer", x: 34, y: 3.4 },
  ],
});

const killerRow = level({
  id: "killer-row",
  name: "Killer Row",
  floor: path(0, 0)
    .flat(12)
    .ease(4, 0.9)
    .to(0, -0.9)
    .flat(10)
    .ease(4, 0.9)
    .to(0, -0.9)
    .flat(10)
    .ease(4, 1)
    .to(0, -1)
    .flat(12),
  top: 14,
  start: 2,
  apples: [
    [23, 0.8],
    [37, 0.8],
    [52, 0.8],
  ],
  killers: [
    [17.4, 0.45],
    [31.4, 0.45],
    [45.4, 0.45],
    [46.6, 0.45],
  ],
  flower: [54.5, 0.9],
});

const islandHop = level({
  id: "island-hop",
  name: "Island Hop",
  floor: path(0, 0).flat(10).to(0, -6).flat(39).to(0, 3.5).flat(12),
  top: 12,
  start: 3,
  apples: [[55, 0.8]],
  killers: row(11.5, 47.5, 3, 0.5),
  flower: [59, 0.9],
  islands: [
    box(13, 19, -0.5, 0.8),
    box(22, 28, -1, 0.8),
    box(31, 37, -1.5, 0.8),
    box(40, 46, -2, 0.8),
  ],
  objects: [
    { kind: "apple", x: 16, y: 0.3 },
    { kind: "apple", x: 34, y: -0.7 },
  ],
});

const grandTour = level({
  id: "grand-tour",
  name: "Grand Tour",
  floor: path(0, 0)
    .flat(10)
    .hill(6, 1)
    .hill(6, 1.2)
    .flat(5)
    .ease(6, 1.5)
    .to(0, -4.5)
    .flat(4)
    .to(0, 4)
    .flat(6)
    .ease(9, 4)
    .flat(6)
    .ease(10, -5)
    .flat(4)
    .hill(8, -1.5)
    .flat(10),
  top: 18,
  start: 5,
  apples: [
    [1.2, 0.8],
    [13, 0.8],
    [19, 0.9],
    [55, 0.8],
    [76, 0.8],
  ],
  killers: [
    [34.2, 0.5],
    [35.8, 0.5],
  ],
  flower: [88, 0.9],
});

export const LEVELS: readonly Level[] = [
  warmUp,
  rollers,
  stepUp,
  halfPipe,
  theGap,
  switchback,
  bigClimb,
  downhill,
  lowBridge,
  killerRow,
  islandHop,
  grandTour,
];
export const LEVEL_COUNT = LEVELS.length;
