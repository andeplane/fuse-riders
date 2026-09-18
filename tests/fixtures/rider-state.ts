/**
 * Setting up a rider's effects and weapons in a constructed test state. Every write goes through the engine's own
 * `applyEffect` / `armWeapon`, so the lists stay in the order and shape the rules hold them in (a checkpoint would
 * refuse anything else); the only liberty taken is that a test may put a deadline back, which play never does.
 */
import {
  type EffectHolder,
  type EffectKind,
  applyEffect,
} from "../../src/engine/effects.ts";
import {
  type ArmedHolder,
  type WeaponKind,
  armWeapon,
} from "../../src/engine/weapons.ts";

/** The rider holds `kind` until `untilTick` (a spell begun at `sinceTick`), replacing whatever it held of it. */
export function setEffect(
  player: EffectHolder,
  kind: EffectKind,
  untilTick: number,
  sinceTick = 0,
): void {
  player.effects = player.effects.filter((effect) => effect.kind !== kind);
  applyEffect(player, kind, sinceTick, untilTick);
}

/** The rider holds exactly these deadlines of a stacking effect (Nitro, Snail). */
export function setDeadlines(
  player: EffectHolder,
  kind: EffectKind,
  deadlines: readonly number[],
  sinceTick = 0,
): void {
  player.effects = player.effects.filter((effect) => effect.kind !== kind);
  for (const untilTick of deadlines)
    applyEffect(player, kind, sinceTick, untilTick);
}

/** The rider holds `kind` armed, or not. */
export function setArmed(
  player: ArmedHolder,
  kind: WeaponKind,
  armed: boolean | undefined,
): void {
  if (armed) armWeapon(player, kind);
  else player.armed = player.armed.filter((candidate) => candidate !== kind);
}
