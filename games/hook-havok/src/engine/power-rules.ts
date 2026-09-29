import type { Tuning } from "./world.js";
/**
 * Power-up rule values (11D). Ticks are 60 Hz engine steps; lengths are world
 * units per tick unless named otherwise. Presentation receives what it draws
 * through the view.
 */
/** Bit order of the `powerUps` setting: triple 1, shield 2, cluster 4, harpoon 8, dash 16. */
export const POWER_KINDS = [
  "triple",
  "shield",
  "cluster",
  "harpoon",
  "dash",
] as const;
export type PowerKind = (typeof POWER_KINDS)[number];
/** Every kind enabled: the default for new rooms. 0 turns pads off. */
export const ALL_POWERS = (1 << POWER_KINDS.length) - 1;
export const isPowerKind = (v: unknown): v is PowerKind =>
  POWER_KINDS.includes(v as PowerKind);
const pools = new Map<string, readonly PowerKind[]>();
/**
 * Kinds a pad can draw: enabled in the setting and useful with this room's
 * bombs. Shield and Cluster bomb need bombs, so bombs off leaves them out.
 * Every draw on every peer reads the same cached list, and the view hands it
 * out, so it is frozen: no consumer can change a later draw.
 */
export function powerPool(
  tuning: Pick<Tuning, "powerUps" | "bomb">,
): readonly PowerKind[] {
  const key = `${tuning.powerUps}/${tuning.bomb}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = Object.freeze(
      POWER_KINDS.filter(
        (kind, i) =>
          tuning.powerUps & (1 << i) &&
          (tuning.bomb !== "off" || (kind !== "shield" && kind !== "cluster")),
      ),
    );
    pools.set(key, pool);
  }
  return pool;
}
/**
 * Stateless draw for one pad cycle: the same seed, pad and cycle give the
 * same kind on every peer. Integer mixing only (Math.imul and shifts).
 */
export function drawPower(
  seed: number,
  pad: number,
  cycle: number,
  pool: readonly PowerKind[],
): PowerKind | undefined {
  if (!pool.length) return;
  let h = (seed ^ Math.imul(pad + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h ^ Math.imul(cycle + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return pool[h % pool.length];
}
/** A collected pad shows a new draw 10 s of active play later. */
export const PAD_TICKS = 600;
/** Triple jump, Shield, Harpoon and Dash bump last 8 s. */
export const POWER_TICKS = 480;
/** Cluster bomb: the next three throws, within 15 s. */
export const CLUSTER_TICKS = 900,
  CLUSTER_CHARGES = 3;
export const powerTicks = (kind: PowerKind): number =>
  kind === "cluster" ? CLUSTER_TICKS : POWER_TICKS;
/**
 * Extra air actions a power restores on landing or a rope jump, on top of the
 * ordinary air jump. Triple jump makes two air jumps in either jump mode; Dash
 * bump turns the air jump into a dash, and gives single-jump rooms one. A
 * pickup grants these at once (`grantPower`), the air jump included.
 */
export function bonusRefill(
  kind: PowerKind | "",
  jumpMode: Tuning["jumpMode"],
): number {
  const base = jumpMode === "double" ? 1 : 0;
  return kind === "triple" ? 2 - base : kind === "dash" ? 1 - base : 0;
}
/** Dash bump: 0.2 s at 900 units/s along the aim, then half the speed is kept. */
export const DASH_TICKS = 12,
  DASH_SPEED = 900,
  DASH_KEEP = 0.5;
/** A dash that touches a rival knocks them this hard (units/tick) and ends. */
export const DASH_KNOCK = 15,
  DASH_LIFT = 5;
/** Harpoon: a tip hit pulls the rival toward the hooking keeper (units/tick). */
export const HARPOON_PULL = 13,
  HARPOON_LIFT = 3;
