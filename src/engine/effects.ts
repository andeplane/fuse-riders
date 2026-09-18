/**
 * Timed effects on a rider, as one table. A pickup, a shield or a portal puts an effect on a rider with `applyEffect`;
 * every phase asks what is in force through the readers below, which answer from the table. A new timed effect is an
 * `EFFECT_KINDS` entry and a row: its stacking and the flags it sets are all any phase reads, and the compiler refuses
 * a kind without a row.
 *
 * Nothing here imports the rest of the engine's rules, so `tuning.ts` can build its motion kernel on `speedMultiplier`.
 */
import { drunkHeadingOffset } from "./drunk.js";

/** Nitro doubles the collector's speed and Snail halves every rival's; see `NITRO_DURATION_TICKS`. */
export const NITRO_SPEED = 2;
export const SNAIL_SPEED = 0.5;
/** Deadlines a rider can hold per stacking effect: a bound for checkpoints. A 33rd collection inside one window is dropped, at a speed nobody survives anyway. */
export const MAX_SPEED_EFFECT_STACK = 32;

/** Every timed effect, in the one order a rider's effects are held and read in. */
export const EFFECT_KINDS = [
  "star",
  "nitro",
  "snail",
  "drunk",
  "ink",
  "shieldGrace",
  "portalGrace",
  "portalCooldown",
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * How a second application meets the first:
 * - `stack`: every application is its own deadline, up to MAX_SPEED_EFFECT_STACK, each in force until it passes;
 * - `extend`: one deadline, pushed out to whichever is later; a fresh start (the old one spent) restarts `sinceTick`;
 * - `replace`: one deadline, set to the new one.
 * A `stack` deadline leaves the rider once it has passed (`expireEffects`). An `extend` or `replace` effect keeps its
 * last deadline after it has passed, as a record of when it ended: the view projects it, and presentation reads a new
 * portal cooldown deadline as the rider having gone through a gate.
 */
export type EffectStacking = "stack" | "extend" | "replace";

export interface EffectRule {
  stacking: EffectStacking;
  /** A factor on the rider's pace for every deadline in force, multiplied in `EFFECT_KINDS` order. */
  speed?: number;
  /** No hazard harms the rider (trails, blasts, walls, other riders, bullets), and the boundary turns it back. */
  immune?: true;
  /** Counted as invulnerable riding in the match statistics. */
  invulnerable?: true;
  /** A contact between this rider and another harms neither of them. */
  defensiveGrace?: true;
  /** An absolute heading offset while in force, from the effect's own start and end. */
  heading?: (
    seed: number,
    playerId: string,
    tick: number,
    sinceTick: number,
    untilTick: number,
  ) => number;
}

export const EFFECTS: Readonly<Record<EffectKind, EffectRule>> = {
  star: { stacking: "extend", immune: true, invulnerable: true },
  nitro: { stacking: "stack", speed: NITRO_SPEED },
  snail: { stacking: "stack", speed: SNAIL_SPEED },
  drunk: { stacking: "extend", heading: drunkHeadingOffset },
  // Ink is drawn, not simulated: the renderer blots the screen of whoever carries it.
  ink: { stacking: "extend" },
  shieldGrace: { stacking: "replace", immune: true },
  portalGrace: { stacking: "replace", immune: true, defensiveGrace: true },
  // Read by the portal crossing itself: a rider cannot re-enter a gate until it has passed.
  portalCooldown: { stacking: "replace" },
};

// ---------------------------------------------------------------------------------------------------------------------
// Storage. Until the state carries `effects`, each kind lives in the field it always had.

/** The per-effect fields a rider carries. */
export interface EffectHolder {
  invulnerableUntilTick: number;
  nitroUntilTicks: number[];
  snailUntilTicks: number[];
  drunkStartedTick: number;
  drunkUntilTick: number;
  inkUntilTick: number;
  shieldGraceUntilTick: number;
  portalGraceUntilTick: number;
  portalCooldownUntilTick: number;
}

/** What the pace reads: only the speed effects. */
export interface SpeedHolder {
  nitroUntilTicks: readonly number[];
  snailUntilTicks: readonly number[];
}

type SingleField = Exclude<
  keyof EffectHolder,
  "nitroUntilTicks" | "snailUntilTicks" | "drunkStartedTick"
>;
const SINGLE: Record<Exclude<EffectKind, "nitro" | "snail">, SingleField> = {
  star: "invulnerableUntilTick",
  drunk: "drunkUntilTick",
  ink: "inkUntilTick",
  shieldGrace: "shieldGraceUntilTick",
  portalGrace: "portalGraceUntilTick",
  portalCooldown: "portalCooldownUntilTick",
};

/** Every deadline this rider holds for `kind`, earliest first; a spent `extend` or `replace` deadline included. */
export function effectDeadlines(
  player: Readonly<EffectHolder>,
  kind: EffectKind,
): readonly number[] {
  if (kind === "nitro") return player.nitroUntilTicks;
  if (kind === "snail") return player.snailUntilTicks;
  return [player[SINGLE[kind]]];
}

/** The tick the current spell of `kind` began: 0 for a rider who has never had it. */
export function effectSince(
  player: Readonly<EffectHolder>,
  kind: EffectKind,
): number {
  return kind === "drunk" ? player.drunkStartedTick : 0;
}

/** Puts `kind` on the rider until `untilTick`, as its row stacks it. */
export function applyEffect(
  player: EffectHolder,
  kind: EffectKind,
  tick: number,
  untilTick: number,
): void {
  if (kind === "nitro" || kind === "snail") {
    const deadlines =
      kind === "nitro" ? player.nitroUntilTicks : player.snailUntilTicks;
    // Deadlines stay sorted, so the earliest to expire is always first and replicas hold identical lists.
    if (deadlines.length >= MAX_SPEED_EFFECT_STACK) return;
    let index = deadlines.length;
    while (index > 0 && deadlines[index - 1]! > untilTick) index -= 1;
    deadlines.splice(index, 0, untilTick);
    return;
  }
  const field = SINGLE[kind];
  if (EFFECTS[kind].stacking === "replace") {
    player[field] = untilTick;
    return;
  }
  if (kind === "drunk" && player.drunkUntilTick <= tick)
    player.drunkStartedTick = tick;
  player[field] = Math.max(player[field], untilTick);
}

/** The one expiry: stacked deadlines that have passed leave the rider. Run before movement, every tick of play. */
export function expireEffects(player: EffectHolder, tick: number): void {
  const spent = (until: number) => until <= tick;
  if (player.nitroUntilTicks.some(spent))
    player.nitroUntilTicks = player.nitroUntilTicks.filter(
      (until) => !spent(until),
    );
  if (player.snailUntilTicks.some(spent))
    player.snailUntilTicks = player.snailUntilTicks.filter(
      (until) => !spent(until),
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Readers. Everything a phase asks about effects, answered from the table.

/** The latest deadline this rider holds for `kind`, spent or not; 0 if it never had it. */
export function effectUntil(
  player: Readonly<EffectHolder>,
  kind: EffectKind,
): number {
  return effectDeadlines(player, kind).reduce(
    (latest, until) => Math.max(latest, until),
    0,
  );
}

/** Whether `kind` is in force on `tick`: some deadline of it is still ahead. */
export function hasEffect(
  player: Readonly<EffectHolder>,
  kind: EffectKind,
  tick: number,
): boolean {
  return effectDeadlines(player, kind).some((until) => until > tick);
}

function anyInForce(
  player: Readonly<EffectHolder>,
  tick: number,
  flag: "immune" | "invulnerable" | "defensiveGrace",
): boolean {
  return EFFECT_KINDS.some(
    (kind) => EFFECTS[kind][flag] && hasEffect(player, kind, tick),
  );
}

/** No hazard can touch this rider on `tick` (a Star, shield grace, portal grace); a wall turns it back instead. */
export function isHazardImmune(
  player: Readonly<EffectHolder>,
  tick: number,
): boolean {
  return anyInForce(player, tick, "immune");
}

/** Riding invulnerable on `tick`, as the match statistics count it (a Star). */
export function isInvulnerable(
  player: Readonly<EffectHolder>,
  tick: number,
): boolean {
  return anyInForce(player, tick, "invulnerable");
}

/** A contact with this rider on `tick` harms nobody (portal grace). */
export function hasDefensiveGrace(
  player: Readonly<EffectHolder>,
  tick: number,
): boolean {
  return anyInForce(player, tick, "defensiveGrace");
}

/** Every speed effect in force on `tick`, multiplied together in table order: one factor per deadline still ahead. */
export function speedMultiplier(
  player: Readonly<SpeedHolder>,
  tick: number,
): number {
  let multiplier = 1;
  // Powers of two are exact, so the order of these products never matters to replicas.
  for (const kind of EFFECT_KINDS) {
    const factor = EFFECTS[kind].speed;
    if (factor === undefined) continue;
    for (const until of effectDeadlines(player as Readonly<EffectHolder>, kind))
      if (until > tick) multiplier *= factor;
  }
  return multiplier;
}

/**
 * The heading offset every heading effect puts on this rider on `tick`, each from its own start and end, whether or
 * not it is in force (a spent or absent one answers 0 itself). An absolute offset, never an angular velocity.
 */
export function headingOffset(
  seed: number,
  player: Readonly<EffectHolder> & { id: string },
  tick: number,
): number {
  let offset: number | undefined;
  for (const kind of EFFECT_KINDS) {
    const heading = EFFECTS[kind].heading;
    if (!heading) continue;
    const value = heading(
      seed,
      player.id,
      tick,
      effectSince(player, kind),
      effectUntil(player, kind),
    );
    offset = offset === undefined ? value : offset + value;
  }
  return offset ?? 0;
}
