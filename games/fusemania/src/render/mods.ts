import {
  BLACKOUT,
  BOOMERANG,
  COLUMNS,
  DRUNK,
  FLIP,
  HIDDEN,
  LAG,
  TORNADO,
  TURBO,
  WAVE,
  type Effect,
} from "../engine/view-kit.js";

/**
 * The visual attacks, as pure math. `modsAt` says how strongly each one bears on a rider at a song time (easing in
 * and out at the effect's edges), and `notePlacement` says where a note that is `ahead` milliseconds from its target
 * is drawn under them. Whatever the mods, a note is exactly on its target at `ahead === 0`: an attack makes the
 * arrows hard to read, never wrong.
 */
export interface Mods {
  drunk: number;
  wave: number;
  boomerang: number;
  tornado: number;
  hidden: number;
  flip: number;
  turbo: number;
  blackout: number;
  lag: number;
}

/** How long an attack takes to reach full strength, and to let go. */
export const EASE_MS = 350;
/** How far behind the music a fully lagged rider's notes are drawn. */
export const LAG_MS = 110;
/** The milliseconds of song a field's whole length shows at speed 1. */
export const BASE_WINDOW_MS = 2200;

export const noMods = (): Mods => ({
  drunk: 0,
  wave: 0,
  boomerang: 0,
  tornado: 0,
  hidden: 0,
  flip: 0,
  turbo: 0,
  blackout: 0,
  lag: 0,
});

const clamp01 = (value: number): number =>
  value <= 0 ? 0 : value >= 1 ? 1 : value;
/** 0 at `from` and below, 1 at `to` and above, smooth between. */
export function smoothstep(from: number, to: number, value: number): number {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}

/** An effect's strength at `songMs`: 0 outside it, 1 in its middle, eased over `EASE_MS` at each end. */
export function strengthAt(effect: Effect, songMs: number): number {
  const from = effect[1],
    until = effect[2];
  if (!(songMs > from && songMs < until)) return 0;
  return smoothstep(0, 1, Math.min(songMs - from, until - songMs) / EASE_MS);
}

/**
 * The strength of each visual attack on a rider at `songMs`: 0 outside the effect, easing in and out over about
 * `EASE_MS` at its edges. `out` is filled and returned, so a frame need not allocate.
 */
export function modsAt(
  effects: readonly Effect[],
  songMs: number,
  out: Mods = noMods(),
): Mods {
  out.drunk = 0;
  out.wave = 0;
  out.boomerang = 0;
  out.tornado = 0;
  out.hidden = 0;
  out.flip = 0;
  out.turbo = 0;
  out.blackout = 0;
  out.lag = 0;
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i]!;
    const strength = strengthAt(effect, songMs);
    if (strength <= 0) continue;
    switch (effect[0]) {
      case DRUNK:
        if (strength > out.drunk) out.drunk = strength;
        break;
      case WAVE:
        if (strength > out.wave) out.wave = strength;
        break;
      case BOOMERANG:
        if (strength > out.boomerang) out.boomerang = strength;
        break;
      case TORNADO:
        if (strength > out.tornado) out.tornado = strength;
        break;
      case HIDDEN:
        if (strength > out.hidden) out.hidden = strength;
        break;
      case FLIP:
        if (strength > out.flip) out.flip = strength;
        break;
      case TURBO:
        if (strength > out.turbo) out.turbo = strength;
        break;
      case BLACKOUT:
        if (strength > out.blackout) out.blackout = strength;
        break;
      case LAG:
        if (strength > out.lag) out.lag = strength;
        break;
    }
  }
  return out;
}

/** Whether any of the mods bends a column sideways or folds it, so a hold's body needs more than a straight line. */
export const bends = (mods: Mods): boolean =>
  mods.drunk > 0 || mods.wave > 0 || mods.tornado > 0 || mods.boomerang > 0;

/** One field's lanes, in whatever pixels the caller draws in. */
export interface LaneGeometry {
  /** The width of one column; the field is `COLUMNS` of them from x = 0. */
  columnWidth: number;
  /** The y of the targets. */
  targetY: number;
  /** From the targets to the far end, where notes come in. */
  length: number;
  /** From the targets to the near end, where a missed note has faded out. */
  runout: number;
  /** The milliseconds of song `length` shows: `BASE_WINDOW_MS / speed`. */
  windowMs: number;
  /** Notes fall to targets at the bottom (true) or rise to targets at the top. */
  down: boolean;
}

export interface Placement {
  /** The note's centre: x from the field's left edge, y in the units of `targetY`. */
  x: number;
  y: number;
  alpha: number;
  rotation: number;
  scale: number;
}
export const noPlacement = (): Placement => ({
  x: 0,
  y: 0,
  alpha: 1,
  rotation: 0,
  scale: 1,
});

/** How much of the wave's speed is surge and stall (under 1, so an arrow never runs backwards), and how often. */
const WAVE_DEPTH = 0.85,
  WAVE_RATE = Math.PI * 5;
/** How far round a tornado has turned the columns at the far end, in radians. */
const TORNADO_TURN = 4.2;
/** A drunk column's sway, in column widths, and how far from the target it reaches full swing (in field lengths). */
const DRUNK_SWAY = 0.55,
  DRUNK_REACH = 0.28;
/** Notes fade in over this much of the field (in field lengths) as they enter. */
const ENTRY_FADE = 0.12;
/** A hidden note is gone this close to the target and whole this far out (in field lengths). */
const HIDDEN_GONE = 0.08,
  HIDDEN_WHOLE = 0.36;

/** How many field lengths ahead a note comes into view: further under a boomerang, which brings them in early. */
const entryAt = (mods: Mods): number => 1 + 0.5 * mods.boomerang;

/** The furthest ahead, in milliseconds, a note is drawn. */
export const aheadMs = (mods: Mods, lane: LaneGeometry): number =>
  (entryAt(mods) * lane.windowMs) / (1 + mods.turbo);

/** How long after its time a note that was not hit is still drawn, in milliseconds. */
export const behindMs = (mods: Mods, lane: LaneGeometry): number =>
  ((lane.runout / Math.max(1, lane.length) + 0.06) * lane.windowMs) /
  (1 + mods.turbo);

/** The x of a column's target: its own place, or mirrored across the field as a flip takes hold. */
export function targetX(
  flip: number,
  column: number,
  lane: LaneGeometry,
): number {
  const position = column + flip * (COLUMNS - 1 - 2 * column);
  return (position + 0.5) * lane.columnWidth;
}

/**
 * Where a note is drawn. `ahead` is the milliseconds until it reaches the target (negative: past it). At `ahead === 0`
 * the result is the column's target (`targetX`, `lane.targetY`), upright and full size, under every mod. `out` is
 * filled and returned.
 */
export function notePlacement(
  mods: Mods,
  column: number,
  ahead: number,
  songMs: number,
  lane: LaneGeometry,
  out: Placement = noPlacement(),
): Placement {
  // The real distance, in field lengths; turbo doubles the speed.
  const u = (ahead / lane.windowMs) * (1 + mods.turbo);

  // Wave: the scroll surges and stalls with distance.
  let distance = u;
  if (mods.wave > 0)
    distance += (mods.wave * WAVE_DEPTH * Math.sin(u * WAVE_RATE)) / WAVE_RATE;
  // Boomerang: the shown distance is a parabola of the real one, out to the far end and back.
  if (mods.boomerang > 0)
    distance += mods.boomerang * (0.5 * distance - distance * distance);

  // Flip mirrors the columns; a tornado swirls them round each other, settling at the target.
  let position = column + mods.flip * (COLUMNS - 1 - 2 * column);
  if (mods.tornado > 0) {
    const half = (COLUMNS - 1) / 2;
    const real = Math.max(-1, Math.min(1, (position - half) / half));
    const angle = Math.acos(real);
    position +=
      (Math.cos(angle + u * TORNADO_TURN) - Math.cos(angle)) *
      half *
      mods.tornado;
  }
  let x = (position + 0.5) * lane.columnWidth;
  let rotation = 0,
    scale = 1;
  if (mods.drunk > 0) {
    const sway =
      Math.sin(songMs * 0.0035 + column * 0.6 + u * 5.5) *
      smoothstep(0, DRUNK_REACH, Math.abs(u));
    x += mods.drunk * DRUNK_SWAY * lane.columnWidth * sway;
    // Adding zero turns a negative zero into zero: "upright" is one value.
    rotation = mods.drunk * 0.3 * sway + 0;
  }
  if (mods.wave > 0) {
    x += mods.wave * 0.14 * lane.columnWidth * Math.sin(u * 9);
    scale = 1 + mods.wave * 0.16 * Math.sin(u * WAVE_RATE);
  }

  const travel = distance * lane.length;
  let alpha = clamp01((entryAt(mods) - u) / ENTRY_FADE);
  if (mods.hidden > 0)
    alpha *= 1 - mods.hidden * (1 - smoothstep(HIDDEN_GONE, HIDDEN_WHOLE, u));
  if (travel < 0) alpha *= clamp01(1 + travel / Math.max(1, lane.runout));

  out.x = x;
  out.y = lane.down ? lane.targetY - travel : lane.targetY + travel;
  out.alpha = alpha;
  out.rotation = rotation;
  out.scale = scale;
  return out;
}

/** How dark a blacked-out field's notes are at `beat`: 0 on the beat's flash, the blackout's strength between. */
export function blackoutAt(blackout: number, beat: number): number {
  if (blackout <= 0) return 0;
  const part = beat - Math.floor(beat);
  const flash = part < 0.16 ? 1 - part / 0.16 : 0;
  return blackout * (1 - flash * flash);
}
