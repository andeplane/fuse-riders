/**
 * The rules of 3D Pipes without any rendering: a grid of taken cells, how a pipe picks its next cell and joint,
 * the camera angles and the dissolve order. Ported from Isaiah Odhner's pipes (MIT, see docs/fuseos/screensaver.md);
 * `pipes.ts` draws what these decide, so everything here runs in plain tests.
 */

export type Vec3 = readonly [number, number, number];

/** How a pipe is joined where it turns: "cycle" rotates through the other three, one style per fresh scene. */
export type JointStyle = "elbow" | "ball" | "mixed" | "cycle";
export const JOINT_STYLES: readonly JointStyle[] = [
  "elbow",
  "ball",
  "mixed",
  "cycle",
];
export const JOINT_STYLE_LABELS: Readonly<Record<JointStyle, string>> = {
  elbow: "Elbows",
  ball: "Balls",
  mixed: "Mixed",
  cycle: "Cycle through all",
};
const JOINT_CYCLE: readonly Exclude<JointStyle, "cycle">[] = [
  "elbow",
  "ball",
  "mixed",
];

export function isJointStyle(value: unknown): value is JointStyle {
  return (
    typeof value === "string" &&
    (JOINT_STYLES as readonly string[]).includes(value)
  );
}

/** A number in [0, 1), like `Math.random`. */
export type Random = () => number;

/** The pipes grow inside a cube of 21 cells a side, centred on the origin. */
export const GRID_HALF = 10;
export const DIRECTIONS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function equalVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
export function inBounds(point: Vec3, half: number = GRID_HALF): boolean {
  return point.every((coordinate) => Math.abs(coordinate) <= half);
}

export function random(rng: Random, from: number, to: number): number {
  return rng() * (to - from) + from;
}
export function randomInteger(rng: Random, from: number, to: number): number {
  return Math.round(random(rng, from, to));
}
export function chance(rng: Random, probability: number): boolean {
  return rng() < probability;
}
export function chooseFrom<T>(rng: Random, values: readonly T[]): T {
  const value = values[Math.floor(rng() * values.length)];
  if (value === undefined) throw new Error("chooseFrom needs a non-empty list");
  return value;
}
export function shuffleInPlace<T>(rng: Random, array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = array[i];
    const b = array[j];
    if (a !== undefined && b !== undefined) {
      array[i] = b;
      array[j] = a;
    }
  }
  return array;
}

export function randomCell(rng: Random, half: number = GRID_HALF): Vec3 {
  return [
    randomInteger(rng, -half, half),
    randomInteger(rng, -half, half),
    randomInteger(rng, -half, half),
  ];
}

/** The cells pipes already occupy, so two pipes never run through each other. */
export class PipeGrid {
  private readonly taken = new Set<string>();
  has(point: Vec3): boolean {
    return this.taken.has(key(point));
  }
  take(point: Vec3): void {
    this.taken.add(key(point));
  }
  clear(): void {
    this.taken.clear();
  }
  get size(): number {
    return this.taken.size;
  }
}
function key(point: Vec3): string {
  return `${point[0]},${point[1]},${point[2]}`;
}

/** Half the time a pipe keeps going straight; otherwise it picks any of the six directions (which may still be straight). */
export function chooseDirection(rng: Random, last: Vec3 | undefined): Vec3 {
  if (last && chance(rng, 1 / 2)) return last;
  const axis = Math.floor(rng() * 3);
  const sign = chooseFrom(rng, [1, -1] as const);
  const direction: [number, number, number] = [0, 0, 0];
  direction[axis] = sign;
  return direction;
}

export type JointKind = "ball" | "teapot" | "elbow";
export type JointChances = { teapot: number; ball: number };

/** Ball joints always, a third of the time or never, and the teapot one turn in two hundred when the easter egg is on. */
export function jointChances(
  style: Exclude<JointStyle, "cycle">,
  teapots: boolean,
  teapotChance: number = 1 / 200,
): JointChances {
  return {
    teapot: teapots ? teapotChance : 0,
    ball: style === "ball" ? 1 : style === "mixed" ? 1 / 3 : 0,
  };
}

export function chooseJoint(rng: Random, chances: JointChances): JointKind {
  if (chance(rng, chances.teapot)) return "teapot";
  if (chance(rng, chances.ball)) return "ball";
  return "elbow";
}

/** The style a fresh scene uses: "cycle" walks elbow, ball, mixed, elbow, ... across scenes. */
export function resolveJointStyle(
  style: JointStyle,
  cycleIndex: number,
): Exclude<JointStyle, "cycle"> {
  if (style !== "cycle") return style;
  return JOINT_CYCLE[cycleIndex % JOINT_CYCLE.length] ?? "elbow";
}

export type PipeState = {
  current: Vec3;
  /** The cell before `current`; undefined until the pipe has moved. */
  previous: Vec3 | undefined;
  /** Every cell visited, oldest first. */
  cells: Vec3[];
};

export function createPipeState(start: Vec3): PipeState {
  return { current: start, previous: undefined, cells: [start] };
}

export type PipeStep = {
  from: Vec3;
  to: Vec3;
  /** The joint drawn at `from` when the pipe turned; none while it runs straight or on its first segment. */
  joint: JointKind | undefined;
};

/**
 * One frame of growth: picks a direction and, when the next cell is free and inside the grid, takes it. Returns
 * undefined when the pipe stayed put this frame (it tries again next frame, like the original).
 */
export function stepPipe(
  rng: Random,
  state: PipeState,
  grid: PipeGrid,
  chances: JointChances,
  half: number = GRID_HALF,
): PipeStep | undefined {
  const last = state.previous
    ? subVec(state.current, state.previous)
    : undefined;
  const direction = chooseDirection(rng, last);
  const next = addVec(state.current, direction);
  if (!inBounds(next, half) || grid.has(next)) return undefined;
  grid.take(next);
  const turned = last !== undefined && !equalVec(last, direction);
  const step: PipeStep = {
    from: state.current,
    to: next,
    joint: turned ? chooseJoint(rng, chances) : undefined,
  };
  state.previous = state.current;
  state.current = next;
  state.cells.push(next);
  return step;
}

/** One pipe, or with "multiple" two and sometimes three. */
export function pipeCount(rng: Random, multiple: boolean): number {
  return multiple ? 2 + (chance(rng, 1 / 10) ? 1 : 0) : 1;
}

/** Seconds a scene lives before it dissolves: 16 to 24, nothing like the original's fill-based rule but close enough. */
export const SCENE_SECONDS: readonly [number, number] = [16, 24];
export function sceneLifetimeMs(
  rng: Random,
  interval: readonly [number, number] = SCENE_SECONDS,
): number {
  return random(rng, interval[0], interval[1]) * 1000;
}

export const CAMERA_DISTANCE = 14;

/** Half the time the classic head-on view; otherwise the same distance rotated a quarter turn about a random axis. */
export function cameraPosition(rng: Random): Vec3 {
  if (chance(rng, 1 / 2)) return [0, 0, CAMERA_DISTANCE];
  const axis = normalize([
    random(rng, -1, 1),
    random(rng, -1, 1),
    random(rng, -1, 1),
  ]);
  return rotateQuarterTurn([CAMERA_DISTANCE, 0, 0], axis);
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length === 0
    ? [1, 0, 0]
    : [v[0] / length, v[1] / length, v[2] / length];
}

/** Rodrigues' formula for a 90° turn: v cos θ + (k × v) sin θ + k (k · v)(1 − cos θ) with cos θ = 0, sin θ = 1. */
function rotateQuarterTurn(v: Vec3, k: Vec3): Vec3 {
  const cross: Vec3 = [
    k[1] * v[2] - k[2] * v[1],
    k[2] * v[0] - k[0] * v[2],
    k[0] * v[1] - k[1] * v[0],
  ];
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [cross[0] + k[0] * dot, cross[1] + k[1] * dot, cross[2] + k[2] * dot];
}

export type DissolveCell = { column: number; row: number };

/** The pixel-block order the dissolve paints black in, every block exactly once. */
export function dissolveOrder(
  rng: Random,
  columns: number,
  rows: number,
): DissolveCell[] {
  const cells: DissolveCell[] = [];
  for (let index = 0; index < columns * rows; index += 1)
    cells.push({ column: index % columns, row: Math.floor(index / columns) });
  return shuffleInPlace(rng, cells);
}

/** Blocks of about 20 CSS pixels, as many as cover the viewport. */
export const DISSOLVE_BLOCK_PX = 20;
export function dissolveGrid(
  width: number,
  height: number,
): { columns: number; rows: number } {
  return {
    columns: Math.max(1, Math.ceil(width / DISSOLVE_BLOCK_PX)),
    rows: Math.max(1, Math.ceil(height / DISSOLVE_BLOCK_PX)),
  };
}

/** Blocks to paint per frame so the whole screen is black after `seconds` at 60 frames a second, at least one. */
export function dissolveBlocksPerFrame(total: number, seconds: number): number {
  return Math.max(1, Math.floor(total / (seconds * 60)));
}
