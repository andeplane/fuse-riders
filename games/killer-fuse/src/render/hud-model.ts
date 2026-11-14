/**
 * What is shown about a round beyond its things, worked out from a view without drawing anything: which win is one
 * move away, what a seat's tag reads, and where the ending closes in and what it says.
 */
import type { RoundView, UnitView } from "../engine/index.js";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./layout.js";
import { teamName, type SheetDef } from "./manifest.js";
import type { Sizes } from "./metrics.js";

/** How close the snail is to `team`'s goal, 0 at the start line and 1 on the goal. */
export function snailThreat(view: RoundView, team: number): number {
  const goal = view.map.snail.goals[team === 1 ? 1 : 0];
  const span = Math.abs(goal - view.map.snail.start);
  if (span === 0) return 0;
  const done =
    (view.snail.x - view.map.snail.start) / (goal - view.map.snail.start);
  return Math.max(0, Math.min(1, done));
}

export interface Danger {
  /** Per team: this team's Queen is on her last egg. */
  readonly lastEgg: readonly [boolean, boolean];
  /** Per team: this team needs one more berry to win. */
  readonly lastBerry: readonly [boolean, boolean];
  /** Per team: the snail is in the last stretch before this team's goal, with someone riding it. */
  readonly snailNear: readonly [boolean, boolean];
  /** Per team: the snail is in that last stretch, ridden or not. */
  readonly snailClose: readonly [boolean, boolean];
  /** Anything at all is on the brink. */
  readonly any: boolean;
}

/** The share of the way to a goal from which the snail counts as about to win. */
export const SNAIL_NEAR = 0.75;

export function dangerOf(view: RoundView): Danger {
  const over = view.winner !== null;
  const egg = (team: number): boolean => !over && (view.eggs[team] ?? 0) <= 1;
  const berry = (team: number): boolean => {
    const holes = view.hives[team]?.length ?? 0;
    return !over && holes > 0 && (view.berries[team] ?? 0) === holes - 1;
  };
  const close = (team: number): boolean =>
    !over && snailThreat(view, team) >= SNAIL_NEAR;
  const snail = (team: number): boolean => view.snail.rider >= 0 && close(team);
  const lastEgg = [egg(0), egg(1)] as const;
  const lastBerry = [berry(0), berry(1)] as const;
  const snailNear = [snail(0), snail(1)] as const;
  return {
    lastEgg,
    lastBerry,
    snailNear,
    snailClose: [close(0), close(1)],
    any: [...lastEgg, ...lastBerry, ...snailNear].some(Boolean),
  };
}

/** Characters the tag font can draw; anything else in a name is dropped. */
const TAG_CHARS = /[^A-Z0-9 !?.\-_]/g;
export const TAG_LENGTH = 8;

/** The tag over a seat's unit: the player's name in capitals, cut to fit, or BOT for an unnamed bot. */
export function tagOf(name: string | undefined, bot: boolean): string {
  const clean = (name ?? "")
    .toUpperCase()
    .replace(TAG_CHARS, "")
    .trim()
    .slice(0, TAG_LENGTH)
    .trim();
  if (clean) return clean;
  return bot ? "BOT" : "";
}

/** Seconds left of a respawn, rounded up, for the count over a dead unit's spawn. */
export const respawnCount = (respawn: number, totalSeconds: number): number =>
  Math.max(
    1,
    Math.ceil((1 - Math.max(0, Math.min(1, respawn))) * totalSeconds),
  );

/**
 * Where a hive sprite's anchor goes so the holes drawn in it land on the engine's: hole 0 minus the sheet's first
 * hole offset. Null when the art's layout is not this map's (no holes, another count, or any hole elsewhere): the
 * wall then stands on the map's wall rectangle and the renderer draws every hole itself.
 */
export function hiveAnchor(
  holes: readonly { readonly x: number; readonly y: number }[],
  def: Pick<SheetDef, "holes">,
): { x: number; y: number } | null {
  const first = holes[0],
    offset = def.holes[0];
  if (!first || !offset || holes.length !== def.holes.length) return null;
  const at = { x: first.x - offset[0], y: first.y - offset[1] };
  return holes.every((hole, index) => {
    const from = def.holes[index];
    return (
      from !== undefined &&
      at.x + from[0] === hole.x &&
      at.y + from[1] === hole.y
    );
  })
    ? at
    : null;
}

/**
 * The sheet of a team's hive wall on a map: the art draws one per map, named after it (`hive-day-cyan`), and an
 * art set with a single wall for every map names it `hive-cyan`. Undefined when the art has neither.
 */
export function hiveSheet(
  mapName: string,
  team: number,
  has: (id: string) => boolean,
): string | undefined {
  const name = teamName(team);
  return [`hive-${mapName.toLowerCase()}-${name}`, `hive-${name}`].find(has);
}

export type EggState = "full" | "cracked" | "broken";

/**
 * What each of a team's spare eggs looks like. The engine says which are still there; while the Queen is dead the
 * first of them is the one hatching her (`cracked`), and one that has hatched is an empty shell.
 */
export function eggStates(
  spares: readonly { readonly present: boolean }[],
  hatching: boolean,
): EggState[] {
  const next = spares.findIndex((spare) => spare.present);
  return spares.map((spare, index) =>
    !spare.present ? "broken" : hatching && index === next ? "cracked" : "full",
  );
}

/** Steps into a round for which bots carry their BOT tag, the last of them fading. */
export const BOT_TAG_STEPS = 300,
  BOT_TAG_FADE = 60;

/** How strongly a bot's tag shows on `step`: there for the opening seconds so seats can be told apart, then gone. */
export function botTagAlpha(step: number): number {
  if (step >= BOT_TAG_STEPS) return 0;
  return 0.5 * Math.min(1, (BOT_TAG_STEPS - Math.max(0, step)) / BOT_TAG_FADE);
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * What decided the round, for the ending to close in on: the Queen who fell (`fell` is where), the hive that filled
 * or the snail at its goal. A round the clock decided closes on the winning Queen.
 */
export function victoryFocus(
  view: RoundView,
  sizes: Sizes,
  fell?: Point,
): Point {
  const middle = { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2 };
  const { winner } = view;
  if (!winner) return middle;
  const queenOf = (team: number): Point | undefined => {
    const queen = view.units.find(
      (unit) => unit.kind === "queen" && unit.team === team,
    );
    return queen && { x: queen.x, y: queen.y - sizes.queen / 2 };
  };
  if (view.timeUp) return queenOf(winner.team) ?? middle;
  // Where she died, when the renderer saw it: the engine may have moved her body since.
  if (winner.kind === "military")
    return fell ?? queenOf(1 - winner.team) ?? middle;
  if (winner.kind === "snail")
    return { x: view.snail.x, y: view.snail.y - sizes.snail / 2 };
  const holes = view.hives[winner.team] ?? [];
  if (holes.length === 0) return middle;
  return {
    x: holes.reduce((sum, hole) => sum + hole.x, 0) / holes.length,
    y: holes.reduce((sum, hole) => sum + hole.y, 0) / holes.length,
  };
}

/**
 * The ending, timed after the arcade: the hexagon closes to this corner radius in half a second while the view
 * centres on what decided the round, and the picture grows to twice its size over a second and a half, a little
 * past it before settling. A military win waits for the dead Queen's shake first.
 */
export const IRIS_RADIUS = 43,
  IRIS_SECONDS = 0.5,
  CENTRE_SECONDS = 0.5,
  ZOOM_SECONDS = 1.5,
  END_ZOOM = 2,
  ZOOM_SPRING = 0.6;
/** Wide enough that the hexagon holds the whole picture wherever its centre is. */
const IRIS_OPEN = 700;
const ROOT3 = Math.sqrt(3);

/** The hexagon's corner radius `age` seconds into the ending: fast at first, settling at the end. */
export function irisRadius(age: number): number {
  const t = Math.max(0, Math.min(1, age / IRIS_SECONDS));
  return IRIS_RADIUS + (IRIS_OPEN - IRIS_RADIUS) * (1 - t) ** 3;
}

/** Seconds the ending waits after the win: `shake` when a Queen's death decided it, else none. */
export const endingDelay = (
  winner: NonNullable<RoundView["winner"]>,
  timeUp: boolean,
  shake: number,
): number => (winner.kind === "military" && !timeUp ? shake : 0);

export interface Camera {
  /** The point of the arena shown in the middle of the screen, and how much the picture is enlarged about it. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const STILL: Camera = { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2, zoom: 1 };

/** Where the camera is `age` seconds into the ending, on its way to `focus`. */
export function endingCamera(age: number, focus: Point): Camera {
  if (age <= 0) return STILL;
  const t = Math.min(1, age / CENTRE_SECONDS);
  const pan = t * t * (3 - 2 * t);
  const z = Math.min(1, age / ZOOM_SECONDS) - 1;
  const grown = 1 + (ZOOM_SPRING + 1) * z * z * z + ZOOM_SPRING * z * z;
  return {
    x: STILL.x + (focus.x - STILL.x) * pan,
    y: STILL.y + (focus.y - STILL.y) * pan,
    zoom: 1 + (END_ZOOM - 1) * grown,
  };
}

/** Where a point of the arena is on the screen through a camera. */
export const project = (point: Point, camera: Camera): Point => ({
  x: STILL.x + (point.x - camera.x) * camera.zoom,
  y: STILL.y + (point.y - camera.y) * camera.zoom,
});

/** Half the width of a flat-topped hexagon of corner radius `radius`, `dy` rows from its middle; 0 outside it. */
export function hexHalfWidth(radius: number, dy: number): number {
  const reach = (radius * ROOT3) / 2;
  return Math.abs(dy) > reach ? 0 : radius - Math.abs(dy) / ROOT3;
}

/** The two lines of the ending: who won, and how. */
export function victoryLines(
  winner: NonNullable<RoundView["winner"]>,
  timeUp: boolean,
): { title: string; kind: string } {
  return {
    title: `${teamName(winner.team).toUpperCase()} WINS!`,
    kind: timeUp ? "TIME UP" : `${winner.kind.toUpperCase()} VICTORY`,
  };
}

export interface Outline {
  readonly color: string;
  /** Where the unit's silhouette is stamped under it, in pixels from its place. */
  readonly offsets: readonly (readonly [number, number])[];
}

/** One pixel out on each side. */
export const RIM: Outline["offsets"] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
/** The arcade's "this is you" outline: green, and two pixels thick so it reads at a glance on any background. */
export const HIGHLIGHT_COLOR = "#4dff5e";
export const HIGHLIGHT_RIM: Outline["offsets"] = [-2, -1, 0, 1, 2].flatMap(
  (dx) =>
    [-2, -1, 0, 1, 2]
      .filter((dy) => (dx !== 0 || dy !== 0) && Math.abs(dx) + Math.abs(dy) < 4)
      .map((dy) => [dx, dy] as const),
);

/** The outline the local player's unit wears while the page asks for the highlight; no other unit has one. */
export function outlineOf(
  unit: UnitView,
  localSlot: number,
  highlight: boolean,
): Outline | null {
  return highlight && unit.slot === localSlot && !unit.dead && !unit.eaten
    ? { color: HIGHLIGHT_COLOR, offsets: HIGHLIGHT_RIM }
    : null;
}
