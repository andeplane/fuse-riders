import { BODY, HALF, S, type Tuning } from "./world.js";
import { MAPS, type Laser, type Platform } from "./maps.js";
import { ROUND_TICKS, type Contest } from "./contest.js";
import {
  BONUS,
  LASER_HALF_WIDTH,
  LASER_LIVE,
  LASER_PERIOD,
  LASER_TELEGRAPH,
  LIFT_ACCEL,
  LIFT_RISE,
  LOW_GRAVITY,
  PAD_SPEED,
  RISE_TICKS,
} from "./zone-rules.js";

/**
 * Zones and hazards (12B): pure functions of the map's zone data, the shared
 * settings and the tick or contest clock. No zone keeps state of its own, so
 * checkpoints carry nothing new for them and every peer agrees from the log.
 */
export const ZONE_KEYS = [
  "jumpPads",
  "lifts",
  "lowGravity",
  "electricFloor",
  "lasers",
  "bonusZone",
] as const;
export type ZoneKey = (typeof ZONE_KEYS)[number];
type Settings = Pick<Tuning, "map" | "rules" | ZoneKey>;
/** Pad launch, lift rise and lift acceleration in subunits per tick. */
export const PAD_VY = -Math.round((PAD_SPEED * S) / 60),
  LIFT_VY = -Math.round((LIFT_RISE * S) / 60),
  LIFT_STEP = Math.round((LIFT_ACCEL * S) / 3600);
const within = (r: Platform, x: number, y: number) =>
  x >= r[0] * S &&
  x < (r[0] + r[2]) * S &&
  y >= r[1] * S &&
  y < (r[1] + r[3]) * S;
export type Field = "" | "lift" | "low";
/** What pulls on a body centred at (x, y), subunits; a lift beam wins over the wing. */
export function field(
  t: Pick<Tuning, "map" | "lifts" | "lowGravity">,
  x: number,
  y: number,
): Field {
  const z = MAPS[t.map].zones;
  if (t.lifts === "on")
    for (const r of z.lifts) if (within(r, x, y)) return "lift";
  if (t.lowGravity === "on")
    for (const r of z.lowGravity) if (within(r, x, y)) return "low";
  return "";
}
/**
 * One tick of vertical pull, subunits per tick. `gravity` is the body's usual
 * pull per tick. A lift beam replaces it, easing towards a capped rise.
 */
export function pull(vy: number, f: Field, gravity: number): number {
  if (f === "lift")
    return vy > LIFT_VY
      ? Math.max(LIFT_VY, vy - LIFT_STEP)
      : Math.min(LIFT_VY, vy + LIFT_STEP);
  return vy + (f === "low" ? Math.round(gravity * LOW_GRAVITY) : gravity);
}
/** True when a keeper standing at (x, feet) is on an enabled pad's top. */
export function onPad(
  t: Pick<Tuning, "map" | "jumpPads">,
  x: number,
  feet: number,
): boolean {
  if (t.jumpPads !== "on") return false;
  for (const [px, py, width] of MAPS[t.map].zones.pads)
    if (
      Math.abs(feet - py * S) <= 1 &&
      x + HALF > px * S &&
      x - HALF < (px + width) * S
    )
      return true;
  return false;
}
/** Pads apply on this map with these settings: the only launch past the speed cap. */
export const padsLive = (t: Settings) =>
  t.jumpPads === "on" && MAPS[t.map].zones.pads.length > 0;
/** A hazard can knock keepers out on this map with these settings. */
export const hazardsLive = (t: Settings) =>
  (t.electricFloor === "on" && !!MAPS[t.map].zones.floor) ||
  (t.lasers === "on" && MAPS[t.map].zones.lasers.length > 0);
/** Score gains inside the crown zone count BONUS times. */
export const bonusLive = (t: Settings) =>
  t.bonusZone === "on" && t.rules === "score" && !!MAPS[t.map].zones.bonus;
/** Ticks of a timed round the floor has risen for, 0 before the rise. */
export function risen(t: Settings, c: Pick<Contest, "phase" | "elapsed">) {
  if (t.rules === "free" || (c.phase !== "active" && c.phase !== "over"))
    return 0;
  return Math.max(
    0,
    Math.min(RISE_TICKS, c.elapsed - (ROUND_TICKS - RISE_TICKS)),
  );
}
/**
 * The electrified floor's top in subunits, or undefined when it is off. At
 * rest it sits at `base`; over a timed round's last RISE_TICKS it rises
 * linearly to `cap` (sudden death).
 */
export function floorTop(
  t: Settings,
  c: Pick<Contest, "phase" | "elapsed">,
): number | undefined {
  const f = MAPS[t.map].zones.floor;
  if (!f || t.electricFloor !== "on") return;
  return (
    f.base * S - Math.round(((f.base - f.cap) * S * risen(t, c)) / RISE_TICKS)
  );
}
export type LaserPhase = "idle" | "telegraph" | "live";
/** Where a gate is in its cycle at `tick`: the phase and ticks into it. */
export function laserPhase(
  l: Laser,
  tick: number,
): { phase: LaserPhase; at: number } {
  const t = (tick + l.offset) % LASER_PERIOD;
  if (t < LASER_TELEGRAPH) return { phase: "telegraph", at: t };
  if (t < LASER_TELEGRAPH + LASER_LIVE)
    return { phase: "live", at: t - LASER_TELEGRAPH };
  return { phase: "idle", at: t - LASER_TELEGRAPH - LASER_LIVE };
}
/** The beam's swept coordinate after `k` live ticks, subunits. */
const beamAt = (l: Laser, k: number) =>
  (l.axis === "h" ? l.y : l.x) * S +
  Math.round((l.travel * S * k) / LASER_LIVE);
/**
 * The band a live beam sweeps on `tick`, as [left, top, right, bottom] in
 * subunits, or undefined when the gate is not live. Contact tests the whole
 * band, so a fast sweep cannot pass over a keeper between ticks.
 */
export function laserBand(
  l: Laser,
  tick: number,
): readonly [number, number, number, number] | undefined {
  const { phase, at } = laserPhase(l, tick);
  if (phase !== "live") return;
  const from = beamAt(l, at) - LASER_HALF_WIDTH * S,
    to = beamAt(l, at + 1) + LASER_HALF_WIDTH * S;
  return l.axis === "h"
    ? [l.x * S, from, (l.x + l.length) * S, to]
    : [from, l.y * S, to, (l.y + l.length) * S];
}
/** A keeper's body box against a band, both in subunits. */
export const touchesBand = (
  b: readonly [number, number, number, number],
  x: number,
  feet: number,
) => x + HALF > b[0] && x - HALF < b[2] && feet > b[1] && feet - BODY < b[3];
/** Gains by a keeper whose body centre is in the crown zone count BONUS times. */
export function gain(t: Settings, x: number, feet: number): number {
  const b = MAPS[t.map].zones.bonus;
  return b && bonusLive(t) && within(b, x, feet - BODY / 2) ? BONUS : 1;
}
