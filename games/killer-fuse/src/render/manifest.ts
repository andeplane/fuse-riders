/**
 * The art manifest (`public/killer-fuse/art/manifest.json`) as the renderer reads it: sheets cut into equal frames,
 * each with an anchor, and the extras some sheets carry. Parsing is strict about what the renderer relies on, so a
 * regenerated manifest that drops a sheet fails at load and not as a blank sprite in the middle of a game.
 */

export interface AnimationDef {
  readonly frames: readonly string[];
  readonly fps: number;
  readonly loop: boolean;
}

export interface SheetDef {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly frames: Readonly<Record<string, number>>;
  readonly anchor: readonly [number, number];
  readonly animations: Readonly<Record<string, AnimationDef>>;
  readonly fps: number;
  /** The white silhouette sheet with the same layout, for unit sheets. */
  readonly flash: string | undefined;
  /** Rider's feet per snail frame, berry slots of a pile, relative to the frame's top-left corner or the anchor. */
  readonly saddle: readonly (readonly [number, number])[];
  readonly slots: readonly (readonly [number, number])[];
  readonly parallax: number;
  /** A hive's hole centres in the engine's hole order, its count plaque (top centre) and its roof pad, from the anchor. */
  readonly holes: readonly (readonly [number, number])[];
  readonly count: readonly [number, number] | undefined;
  readonly perch: readonly [number, number] | undefined;
  /** The snail strip's marker columns at team 0's goal and team 1's. */
  readonly lane: readonly [number, number] | undefined;
}

export interface ArtManifest {
  readonly canvas: readonly [number, number];
  /** Four-step ramps, dark to light, by team name. */
  readonly teams: Readonly<Record<string, readonly string[]>>;
  readonly assets: Readonly<Record<string, SheetDef>>;
}

export const TEAM_NAMES = ["cyan", "pink"] as const;
export const teamName = (team: number): string =>
  TEAM_NAMES[team === 1 ? 1 : 0];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function number(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`art manifest: ${what} is not a number`);
  return value;
}

function pair(value: unknown, what: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2)
    throw new Error(`art manifest: ${what} is not a pair`);
  return [number(value[0], what), number(value[1], what)];
}

const optionalPair = (
  value: unknown,
  what: string,
): [number, number] | undefined =>
  value === undefined ? undefined : pair(value, what);

const pairs = (value: unknown, what: string): [number, number][] =>
  Array.isArray(value) ? value.map((entry) => pair(entry, what)) : [];

function animations(value: unknown, id: string): Record<string, AnimationDef> {
  const out: Record<string, AnimationDef> = {};
  if (!isRecord(value)) return out;
  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw) || !Array.isArray(raw.frames))
      throw new Error(`art manifest: ${id}.${name} is not an animation`);
    out[name] = {
      frames: raw.frames.map(String),
      fps: number(raw.fps, `${id}.${name}.fps`),
      loop: raw.loop === true,
    };
  }
  return out;
}

function sheet(value: unknown, id: string): SheetDef {
  if (!isRecord(value) || typeof value.file !== "string")
    throw new Error(`art manifest: ${id} is not a sheet`);
  const frames: Record<string, number> = {};
  if (isRecord(value.frames))
    for (const [name, index] of Object.entries(value.frames))
      frames[name] = number(index, `${id}.frames.${name}`);
  return {
    file: value.file,
    width: number(value.width, `${id}.width`),
    height: number(value.height, `${id}.height`),
    frameWidth: number(value.frameWidth, `${id}.frameWidth`),
    frameHeight: number(value.frameHeight, `${id}.frameHeight`),
    frameCount: number(value.frameCount, `${id}.frameCount`),
    frames,
    anchor: pair(value.anchor, `${id}.anchor`),
    animations: animations(value.animations, id),
    fps: typeof value.fps === "number" ? value.fps : 12,
    flash: typeof value.flash === "string" ? value.flash : undefined,
    saddle: pairs(value.saddle, `${id}.saddle`),
    slots: pairs(value.slots, `${id}.slots`),
    parallax: typeof value.parallax === "number" ? value.parallax : 0,
    holes: pairs(value.holes, `${id}.holes`),
    count: optionalPair(value.count, `${id}.count`),
    perch: optionalPair(value.perch, `${id}.perch`),
    lane: optionalPair(value.lane, `${id}.lane`),
  };
}

/** Sheets the renderer cannot draw a game without. */
export const REQUIRED_SHEETS: readonly string[] = [
  ...TEAM_NAMES.flatMap((team) => [
    `worker-${team}`,
    `speed-worker-${team}`,
    `warrior-${team}`,
    `speed-warrior-${team}`,
    `queen-${team}`,
    `transform-${team}`,
    `hive-${team}`,
    `hive-hole-${team}`,
    `egg-${team}`,
    `goal-${team}`,
    `kill-burst-${team}`,
    `queen-death-${team}`,
    `respawn-${team}`,
    `death-puff-${team}`,
    `banner-military-${team}`,
    `banner-economy-${team}`,
    `banner-snail-${team}`,
  ]),
  "worker-flash",
  "speed-worker-flash",
  "warrior-flash",
  "speed-warrior-flash",
  "queen-flash",
  "snail",
  "snail-strip",
  "snail-marker",
  "gate-warrior",
  "gate-speed",
  "berry",
  "berry-pile",
  "flap-puff",
  "gate-sparkle",
  "berry-pop",
  "tiles",
  "bg-far",
  "bg-mid",
  "bg-near",
];

export function parseManifest(value: unknown): ArtManifest {
  if (!isRecord(value) || !isRecord(value.assets) || !isRecord(value.teams))
    throw new Error("art manifest: not a manifest");
  const assets: Record<string, SheetDef> = {};
  for (const [id, raw] of Object.entries(value.assets))
    assets[id] = sheet(raw, id);
  for (const id of REQUIRED_SHEETS)
    if (!assets[id]) throw new Error(`art manifest: no sheet ${id}`);
  const teams: Record<string, string[]> = {};
  for (const name of TEAM_NAMES) {
    const ramp = value.teams[name];
    if (!Array.isArray(ramp) || ramp.length < 4)
      throw new Error(`art manifest: no ${name} ramp`);
    teams[name] = ramp.map(String);
  }
  return { canvas: pair(value.canvas, "canvas"), teams, assets };
}

export interface FrameRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/** Where frame `index` sits in its sheet. Sheets wrap into rows when they are wider than the image. */
export function frameRect(def: SheetDef, index: number): FrameRect {
  const columns = Math.max(1, Math.floor(def.width / def.frameWidth));
  const last = Math.max(0, def.frameCount - 1);
  const at = Math.min(last, Math.max(0, Math.trunc(index)));
  return {
    sx: (at % columns) * def.frameWidth,
    sy: Math.floor(at / columns) * def.frameHeight,
    sw: def.frameWidth,
    sh: def.frameHeight,
  };
}

/** Index of a named frame; an unknown name is frame 0 so a missing pose still draws the unit. */
export const frameIndex = (def: SheetDef, name: string): number =>
  def.frames[name] ?? 0;

/**
 * The frame of a named animation at `time` seconds. A sheet without that animation plays all its frames in order
 * at its own `fps` (effect sheets), and a non-looping one holds its last frame.
 */
export function animationFrame(
  def: SheetDef,
  name: string,
  time: number,
): number {
  const animation = def.animations[name];
  const t = Math.max(0, time);
  if (!animation) {
    const at = Math.floor(t * def.fps);
    return Math.min(def.frameCount - 1, at);
  }
  const count = animation.frames.length;
  const at = Math.floor(t * animation.fps);
  const pick = animation.loop ? at % count : Math.min(count - 1, at);
  return frameIndex(def, animation.frames[pick] ?? "");
}

/** Seconds a sheet's frames take played once at its own rate. */
export const sheetDuration = (def: SheetDef): number =>
  def.frameCount / Math.max(1, def.fps);
