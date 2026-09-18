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
// Storage (`PlayerState.effects`) and every reader, built from a table so nothing below names a kind.

/** One application of an effect: in force from `sinceTick` while `untilTick` is still ahead. */
export interface ActiveEffect<K extends string = EffectKind> {
  kind: K;
  sinceTick: number;
  untilTick: number;
}

/** What carries effects: a rider. Held in table order, and within a kind by deadline, earliest first. */
export interface EffectHolder<K extends string = EffectKind> {
  effects: ActiveEffect<K>[];
}

/** What every reader takes: anything carrying effects, read-only. */
export interface HasEffects<K extends string = EffectKind> {
  readonly effects: readonly Readonly<ActiveEffect<K>>[];
}

/**
 * Everything the engine does with timed effects, for a table of kinds in their holding order. The engine uses the one
 * built from `EFFECT_KINDS` and `EFFECTS` (the exports below); a test builds one with a kind the game does not have to
 * show a new effect needs nothing but its row.
 */
export function effectTable<K extends string>(
  kinds: readonly K[],
  rules: Readonly<Record<K, EffectRule>>,
) {
  const order = new Map<K, number>(kinds.map((kind, index) => [kind, index]));

  /** Where an effect of `kind` until `untilTick` belongs: after every entry that sorts before it or ties with it. */
  function insertionIndex(
    effects: readonly Readonly<ActiveEffect<K>>[],
    kind: K,
    untilTick: number,
  ): number {
    let index = effects.length;
    while (index > 0) {
      const previous = effects[index - 1]!;
      const position = order.get(previous.kind)! - order.get(kind)!;
      if (position < 0 || (position === 0 && previous.untilTick <= untilTick))
        break;
      index -= 1;
    }
    return index;
  }

  /** Every deadline this rider holds for `kind`, earliest first; a spent `extend` or `replace` deadline included. */
  function effectDeadlines(player: HasEffects<K>, kind: K): number[] {
    return player.effects
      .filter((effect) => effect.kind === kind)
      .map((effect) => effect.untilTick);
  }

  /** The tick the current spell of `kind` began: 0 for a rider who has never had it. */
  function effectSince(player: HasEffects<K>, kind: K): number {
    return (
      player.effects.find((effect) => effect.kind === kind)?.sinceTick ?? 0
    );
  }

  /** Puts `kind` on the rider until `untilTick`, as its row stacks it. */
  function applyEffect(
    player: EffectHolder<K>,
    kind: K,
    tick: number,
    untilTick: number,
  ): void {
    const { stacking } = rules[kind];
    const current =
      stacking === "stack"
        ? undefined
        : player.effects.find((effect) => effect.kind === kind);
    if (!current) {
      if (
        stacking === "stack" &&
        effectDeadlines(player, kind).length >= MAX_SPEED_EFFECT_STACK
      )
        return;
      // Kept sorted, so the earliest to expire is always first and replicas hold identical lists.
      player.effects.splice(
        insertionIndex(player.effects, kind, untilTick),
        0,
        {
          kind,
          sinceTick: tick,
          untilTick,
        },
      );
      return;
    }
    if (stacking === "replace") {
      current.sinceTick = tick;
      current.untilTick = untilTick;
      return;
    }
    // A spell that had run out starts again from now; one still running is only pushed further out.
    if (current.untilTick <= tick) current.sinceTick = tick;
    current.untilTick = Math.max(current.untilTick, untilTick);
  }

  /** The one expiry: stacked deadlines that have passed leave the rider. Run before movement, every tick of play. */
  function expireEffects(player: EffectHolder<K>, tick: number): void {
    const spent = (effect: ActiveEffect<K>) =>
      rules[effect.kind].stacking === "stack" && effect.untilTick <= tick;
    if (player.effects.some(spent))
      player.effects = player.effects.filter((effect) => !spent(effect));
  }

  /** The latest deadline this rider holds for `kind`, spent or not; 0 if it never had it. */
  function effectUntil(player: HasEffects<K>, kind: K): number {
    return effectDeadlines(player, kind).reduce(
      (latest, until) => Math.max(latest, until),
      0,
    );
  }

  /** Whether `kind` is in force on `tick`: some deadline of it is still ahead. */
  function hasEffect(player: HasEffects<K>, kind: K, tick: number): boolean {
    return effectDeadlines(player, kind).some((until) => until > tick);
  }

  function anyInForce(
    player: HasEffects<K>,
    tick: number,
    flag: "immune" | "invulnerable" | "defensiveGrace",
  ): boolean {
    return kinds.some(
      (kind) => rules[kind][flag] && hasEffect(player, kind, tick),
    );
  }

  /** No hazard can touch this rider on `tick` (a Star, shield grace, portal grace); a wall turns it back instead. */
  function isHazardImmune(player: HasEffects<K>, tick: number): boolean {
    return anyInForce(player, tick, "immune");
  }

  /** Riding invulnerable on `tick`, as the match statistics count it (a Star). */
  function isInvulnerable(player: HasEffects<K>, tick: number): boolean {
    return anyInForce(player, tick, "invulnerable");
  }

  /** A contact with this rider on `tick` harms nobody (portal grace). */
  function hasDefensiveGrace(player: HasEffects<K>, tick: number): boolean {
    return anyInForce(player, tick, "defensiveGrace");
  }

  /** Every speed effect in force on `tick`, multiplied together in table order: one factor per deadline still ahead. */
  function speedMultiplier(player: HasEffects<K>, tick: number): number {
    let multiplier = 1;
    // Powers of two are exact, so the order of these products never matters to replicas.
    for (const kind of kinds) {
      const factor = rules[kind].speed;
      if (factor === undefined) continue;
      for (const until of effectDeadlines(player, kind))
        if (until > tick) multiplier *= factor;
    }
    return multiplier;
  }

  /**
   * The heading offset every heading effect puts on this rider on `tick`, each from its own start and end, whether or
   * not it is in force (a spent or absent one answers 0 itself). An absolute offset, never an angular velocity.
   */
  function headingOffset(
    seed: number,
    player: HasEffects<K> & { id: string },
    tick: number,
  ): number {
    let offset: number | undefined;
    for (const kind of kinds) {
      const heading = rules[kind].heading;
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

  return {
    applyEffect,
    expireEffects,
    effectDeadlines,
    effectSince,
    effectUntil,
    hasEffect,
    isHazardImmune,
    isInvulnerable,
    hasDefensiveGrace,
    speedMultiplier,
    headingOffset,
  };
}

/** The game's effects: every reader and writer the engine uses, from `EFFECT_KINDS` and `EFFECTS`. */
export const {
  applyEffect,
  expireEffects,
  effectDeadlines,
  effectSince,
  effectUntil,
  hasEffect,
  isHazardImmune,
  isInvulnerable,
  hasDefensiveGrace,
  speedMultiplier,
  headingOffset,
} = effectTable(EFFECT_KINDS, EFFECTS);
