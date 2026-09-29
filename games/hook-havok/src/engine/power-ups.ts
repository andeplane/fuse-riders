import type { Arena, Keeper } from "./arena.js";
import { S, HALF, BODY, endDash, type Tuning } from "./world.js";
import type { MapId } from "./maps.js";
import {
  CLUSTER_CHARGES,
  PAD_TICKS,
  bonusRefill,
  drawPower,
  powerPool,
  powerTicks,
  type PowerKind,
} from "./power-rules.js";

/**
 * Pad centres in world units, 28 units above the ledge they stand on. Stable
 * order is part of the checkpoint contract. Each sits somewhere worth the
 * risk: a ledge lip over the void, a far corner or the summit.
 */
export const POWER_PADS: Record<MapId, readonly { x: number; y: number }[]> = {
  belfry: [
    { x: 790, y: 582 },
    { x: 1180, y: 452 },
    { x: 1395, y: 242 },
    { x: 820, y: 92 },
  ],
  crossroads: [
    { x: 800, y: 182 },
    { x: 370, y: 332 },
    { x: 1230, y: 332 },
    { x: 800, y: 482 },
  ],
};
export interface Pad {
  /** Ticks until the pad shows its next draw; 0 when ready. */
  cooldown: number;
  /** Collections so far (and round starts); the draw's input. */
  cycle: number;
}
/** A keeper's one active power-up, and the round's count of pickups. */
export interface PowerState {
  kind: PowerKind | "";
  /** Ticks left; 0 with no power. */
  ticks: number;
  /** Cluster bomb throws left; 0 for every other kind. */
  charges: number;
  taken: number;
}
export interface PickupEvent {
  tick: number;
  by: string;
  pad: number;
  kind: PowerKind;
}
/** A Shield that absorbed a blast, where the keeper's chest was. */
export interface ShieldPop {
  tick: number;
  target: string;
  x: number;
  y: number;
}
export const freshPower = (): PowerState => ({
  kind: "",
  ticks: 0,
  charges: 0,
  taken: 0,
});
export const freshPads = (map: MapId): Pad[] =>
  POWER_PADS[map].map(() => ({ cooldown: 0, cycle: 0 }));
/** The kind a pad shows now, or nothing when the pool is empty. */
export function padKind(arena: Arena, index: number): PowerKind | undefined {
  return drawPower(
    arena.seed,
    index,
    arena.pads[index]?.cycle ?? 0,
    powerPool(arena.tuning),
  );
}
export interface PadInfo {
  x: number;
  y: number;
  /** The pad's current draw; shown only while ready. */
  kind: PowerKind;
  ready: boolean;
}
/** The one read of the pads for bots and presentation. World units; empty when power-ups are off. */
export function padList(arena: Arena): PadInfo[] {
  const pool = powerPool(arena.tuning);
  if (!pool.length) return [];
  return POWER_PADS[arena.tuning.map].map((p, i) => ({
    x: p.x,
    y: p.y,
    kind: drawPower(arena.seed, i, arena.pads[i]!.cycle, pool)!,
    ready: !arena.pads[i]!.cooldown,
  }));
}
/** Drops the power and anything it granted in the movement kernel; the tally stays. */
export function clearPower(keeper: Keeper): void {
  const p = keeper.power;
  p.kind = "";
  p.ticks = p.charges = 0;
  keeper.world.bonusJumps = 0;
  endDash(keeper.world);
}
/** One power at a time: a new pickup replaces the old one. */
export function grantPower(
  keeper: Keeper,
  kind: PowerKind,
  jumpMode: Tuning["jumpMode"],
): void {
  clearPower(keeper);
  const p = keeper.power;
  p.kind = kind;
  p.ticks = powerTicks(kind);
  p.charges = kind === "cluster" ? CLUSTER_CHARGES : 0;
  p.taken = Math.min(0xffffffff, p.taken + 1);
  // Triple jump and Dash bump work at once, even when collected in the air.
  // In a double-jump room Dash bump's dash is the air jump, so a pickup after
  // the air jump was spent gives it back; single-jump rooms get a bonus one.
  keeper.world.bonusJumps = bonusRefill(kind, jumpMode);
  if (kind === "dash" && jumpMode === "double") keeper.world.airJump = true;
}
/** One active tick of a held power; it expires at 0. */
export function tickPower(keeper: Keeper): void {
  const p = keeper.power;
  if (p.kind && --p.ticks <= 0) clearPower(keeper);
}
/**
 * Post-movement contact: earlier rival hits stand, and a new power works from
 * the next tick. Pads resolve in index order, keepers in slot order.
 */
export function stepPowerUps(
  arena: Arena,
  eligible: (keeper: Keeper) => boolean,
): void {
  const pool = powerPool(arena.tuning);
  if (!pool.length) return;
  const acquired: PickupEvent[] = [];
  for (const [index, pad] of POWER_PADS[arena.tuning.map].entries()) {
    const state = arena.pads[index]!;
    state.cooldown = Math.max(0, state.cooldown - 1);
    if (state.cooldown) continue;
    const keeper = arena.keepers.find(
      (k) =>
        eligible(k) &&
        !k.world.respawn &&
        Math.abs(k.world.x - pad.x * S) <= HALF + 14 * S &&
        k.world.feet >= (pad.y - 14) * S &&
        k.world.feet - BODY <= (pad.y + 14) * S,
    );
    if (!keeper) continue;
    const kind = drawPower(arena.seed, index, state.cycle, pool)!;
    state.cooldown = PAD_TICKS;
    state.cycle = (state.cycle + 1) >>> 0;
    acquired.push({ tick: arena.tick, by: keeper.id, pad: index, kind });
    grantPower(keeper, kind, arena.tuning.jumpMode);
  }
  if (acquired.length) arena.pickupEvents = acquired;
}
