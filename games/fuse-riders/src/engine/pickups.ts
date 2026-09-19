/**
 * Every pickup as one row: how often it drops by default, which match statistic counts it, who may take it, and what
 * taking it does. `collectPickups` decides who reaches a pickup and in what order; everything a type means is here, so
 * a new pickup is a `PICKUP_TYPES` entry and a row, and the compiler refuses a type without one.
 */
import type { Movement } from "./sim/context.js";
import type { MatchPlayerStats } from "./match-stats.js";
import { PICKUP_TYPES, type PickupType } from "./pickup-types.js";
import { DRUNK_DURATION_TICKS } from "./drunk.js";
import { type EffectKind, applyEffect } from "./effects.js";
import { armWeapon } from "./weapons.js";
import { cos, hypot2, sin } from "./deterministic-math.js";
import {
  GRAVITY_CORE_SPAWN_CLEARANCE,
  GRAVITY_FIELD_TICKS,
  GRAVITY_MAX_HOLES_PER_PICKUP,
  GRAVITY_MAX_RADIUS,
  GRAVITY_MIN_RADIUS,
  INK_DURATION_TICKS,
  MAX_GRAVITY_FIELDS,
  NITRO_DURATION_TICKS,
  RIDER_RADIUS,
  SNAIL_DURATION_TICKS,
  STAR_DURATION_TICKS,
} from "./tuning.js";
import {
  type GameState,
  type PickupState,
  type PlayerId,
  type PlayerState,
  sortedPlayers,
} from "./state.js";
import { MAX_EXTRA_BOMBS } from "./launch-modifiers.js";
import { MAX_RANGE_LEVEL } from "./bomb-launch.js";
import { MAX_PORTAL_PAIRS, createPortalPair } from "./portal.js";
import {
  MAX_POWER_PICKUPS,
  POWER_TUNING,
  powerTrailLifetimeTicks,
} from "./power-progression.js";
import { isClearOfPortalWalls, isSafePortalPosition } from "./sim/portals.js";
import { nextRandom } from "./rng.js";
import { portalBounds } from "./sim/field.js";

/** A per-type counter of the stored match statistics. Every collection also counts in `pickupsCollected`. */
export type PickupStat = Extract<
  keyof MatchPlayerStats,
  | "powerPickups"
  | "starPickups"
  | "beerPickups"
  | "inkPickups"
  | "triplePickups"
  | "fivePickups"
  | "shieldPickups"
  | "portalPickups"
>;

/** What a collection can see: the board, the pickup, who took it, and every rider's step this tick. */
export interface Collection {
  state: GameState;
  pickup: Readonly<PickupState>;
  collector: PlayerState;
  movements: ReadonlyMap<PlayerId, Movement>;
}

export interface PickupRule {
  /** Its weight in `defaultRoomSettings()`; a room can reweigh any type. */
  weight: number;
  /**
   * The stored per-type counter it bumps, or `null` for a type the stored match results have no counter for (adding
   * one is a change to the stored results' schema, validated field by field in `games/fuse-riders/src/platform.ts`).
   */
  stat: PickupStat | null;
  /** Whether this rider may take it at all; a rider it refuses rides over it and leaves it for someone else. */
  eligible?: (player: Readonly<PlayerState>) => boolean;
  /**
   * What taking it does, applied the moment it is taken. `false` means it could not be taken after all (a portal
   * with nowhere safe to open): it stays on the board and nothing is recorded.
   */
  collect: (collection: Collection) => boolean | void;
}

/** A timed effect on whoever took it (Star, Nitro). */
function onSelf(
  kind: EffectKind,
  durationTicks: number,
): PickupRule["collect"] {
  return ({ state, collector }) =>
    applyEffect(collector, kind, state.tick, state.tick + durationTicks);
}

/** A timed effect on everyone else still riding, in seat order (Snail, Ink, Beer). */
function onRivals(
  kind: EffectKind,
  durationTicks: number,
): PickupRule["collect"] {
  return ({ state, collector }) => {
    for (const player of sortedPlayers(state))
      if (player.alive && player.id !== collector.id)
        applyEffect(player, kind, state.tick, state.tick + durationTicks);
  };
}

export const PICKUPS: Readonly<Record<PickupType, PickupRule>> = {
  power: {
    weight: POWER_TUNING.defaultDropWeight,
    stat: "powerPickups",
    collect: ({ collector }) => {
      const previousLifetime = powerTrailLifetimeTicks(collector.powerPickups);
      collector.powerPickups = Math.min(
        MAX_POWER_PICKUPS,
        collector.powerPickups + 1,
      );
      const extension =
        powerTrailLifetimeTicks(collector.powerPickups) - previousLifetime;
      // Retain the existing tail while the rider grows into the extra capacity.
      // Expired or destroyed trail is never recreated.
      for (const segment of collector.trail)
        if (!segment.detached) segment.expiresAtTick += extension;
    },
  },
  extraBomb: {
    weight: 400,
    stat: null,
    collect: ({ collector }) => {
      collector.extraBombs = Math.min(
        MAX_EXTRA_BOMBS,
        collector.extraBombs + 1,
      );
    },
  },
  stopwatch: {
    weight: 160,
    stat: null,
    collect: ({ collector }) => {
      collector.fuseLevel = Math.min(2, collector.fuseLevel + 1);
    },
  },
  gun: {
    weight: 400,
    stat: null,
    collect: ({ collector }) => armWeapon(collector, "gun"),
  },
  shell: {
    weight: 53,
    stat: null,
    collect: ({ collector }) => armWeapon(collector, "shell"),
  },
  star: {
    weight: 160,
    stat: "starPickups",
    collect: onSelf("star", STAR_DURATION_TICKS),
  },
  beer: {
    weight: 160,
    stat: "beerPickups",
    collect: onRivals("drunk", DRUNK_DURATION_TICKS),
  },
  ink: {
    weight: 160,
    stat: "inkPickups",
    collect: onRivals("ink", INK_DURATION_TICKS),
  },
  triple: {
    weight: 540,
    stat: "triplePickups",
    collect: ({ collector }) => armWeapon(collector, "triple"),
  },
  five: {
    weight: 180,
    stat: "fivePickups",
    collect: ({ collector }) => armWeapon(collector, "five"),
  },
  orbitShield: {
    weight: 160,
    stat: "shieldPickups",
    collect: ({ collector }) => {
      collector.shielded = true;
    },
  },
  portal: {
    weight: 160,
    stat: "portalPickups",
    collect: ({ state, pickup, movements }) => {
      // Safety disks conservatively cover the entire portal wall plus rider clearance.
      const pair = createPortalPair({
        id: `${state.round}:${pickup.id}:${state.tick}`,
        tick: state.tick,
        bounds: portalBounds(state),
        riderRadius: RIDER_RADIUS,
        random: () => nextRandom(state),
        isSafe: (point, radius) =>
          isSafePortalPosition(state, point, radius, movements) &&
          isClearOfPortalWalls(state, point, radius),
      });
      if (!pair) return false;
      // Pairs accumulate and expire on their own schedules; only the cap retires one early.
      state.portalPairs = [
        ...state.portalPairs.slice(
          Math.max(0, state.portalPairs.length + 1 - MAX_PORTAL_PAIRS),
        ),
        pair,
      ];
    },
  },
  gravity: {
    weight: 120,
    stat: null,
    collect: ({ state, movements }) => openBlackHoles(state, movements),
  },
  grip: {
    weight: 160,
    stat: null,
    // Once per round: a rider who has it is not offered another.
    eligible: (player) => !player.grip,
    collect: ({ collector }) => {
      collector.grip = true;
    },
  },
  range: {
    weight: 160,
    stat: null,
    eligible: (player) => player.rangeLevel < MAX_RANGE_LEVEL,
    collect: ({ collector }) => {
      collector.rangeLevel = Math.min(
        MAX_RANGE_LEVEL,
        collector.rangeLevel + 1,
      );
    },
  },
  nitro: {
    weight: 160,
    stat: null,
    collect: onSelf("nitro", NITRO_DURATION_TICKS),
  },
  snail: {
    weight: 160,
    stat: null,
    collect: onRivals("snail", SNAIL_DURATION_TICKS),
  },
};

/** Whether this rider may take a pickup of this type (a rider it refuses rides over it). */
export function canCollect(
  type: PickupType,
  player: Readonly<PlayerState>,
): boolean {
  return PICKUPS[type].eligible?.(player) ?? true;
}

/**
 * The default weights in `PICKUP_TYPES` order — the one order the weights are read in — as `defaultRoomSettings()`
 * seeds them. Power supplies roughly three quarters of default drops; specials stay occasional.
 */
export const PICKUP_WEIGHTS: ReadonlyArray<
  Readonly<{ type: PickupType; weight: number }>
> = PICKUP_TYPES.map((type) => ({ type, weight: PICKUPS[type].weight }));

/** One to three holes anywhere on the field. Every hole costs the same three draws, so replicas stay in step whatever the sizes. */
function openBlackHoles(
  state: GameState,
  movements: ReadonlyMap<PlayerId, Movement>,
): void {
  const bounds = portalBounds(state);
  const count =
    1 + Math.floor(nextRandom(state) * GRAVITY_MAX_HOLES_PER_PICKUP);
  for (let hole = 0; hole < count; hole += 1) {
    const radius =
      GRAVITY_MIN_RADIUS +
      nextRandom(state) * (GRAVITY_MAX_RADIUS - GRAVITY_MIN_RADIUS);
    let x = bounds.minX + nextRandom(state) * (bounds.maxX - bounds.minX);
    let y = bounds.minY + nextRandom(state) * (bounds.maxY - bounds.minY);
    // The core kills, so it never opens under a rider: slide the hole straight away from anyone too close, in seat order.
    for (const { id, alive, angle } of sortedPlayers(state)) {
      // Riders have moved this tick but not yet landed in the state: measure from where they are about to be.
      const player = movements.get(id);
      if (!alive || !player) continue;
      const awayX = x - player.x,
        awayY = y - player.y,
        distance = hypot2(awayX, awayY);
      if (distance >= GRAVITY_CORE_SPAWN_CLEARANCE) continue;
      const ux = distance === 0 ? cos(angle + Math.PI) : awayX / distance,
        uy = distance === 0 ? sin(angle + Math.PI) : awayY / distance;
      x = player.x + ux * GRAVITY_CORE_SPAWN_CLEARANCE;
      y = player.y + uy * GRAVITY_CORE_SPAWN_CLEARANCE;
      // Against a wall the slide goes the other way on that axis, which keeps the full clearance where a clamp would not.
      if (x < bounds.minX || x > bounds.maxX)
        x = player.x - ux * GRAVITY_CORE_SPAWN_CLEARANCE;
      if (y < bounds.minY || y > bounds.maxY)
        y = player.y - uy * GRAVITY_CORE_SPAWN_CLEARANCE;
    }
    x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
    y = Math.max(bounds.minY, Math.min(bounds.maxY, y));
    state.gravityFields.push({
      x,
      y,
      radius,
      expiresAtTick: state.tick + GRAVITY_FIELD_TICKS,
    });
  }
  state.gravityFields = state.gravityFields.slice(
    Math.max(0, state.gravityFields.length - MAX_GRAVITY_FIELDS),
  );
}
