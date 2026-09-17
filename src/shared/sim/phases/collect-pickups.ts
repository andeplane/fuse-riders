import type { TickContext } from "../context.js";
import { DRUNK_DURATION_TICKS } from "../../drunk.js";
import {
  EPSILON,
  pointSegmentDistanceSquared,
  square,
} from "../../geometry.js";
import {
  GRAVITY_CORE_SPAWN_CLEARANCE,
  GRAVITY_FIELD_TICKS,
  GRAVITY_MAX_HOLES_PER_PICKUP,
  GRAVITY_MAX_RADIUS,
  GRAVITY_MIN_RADIUS,
  INK_DURATION_TICKS,
  MAX_GRAVITY_FIELDS,
  MAX_SPEED_EFFECT_STACK,
  NITRO_DURATION_TICKS,
  PICKUP_RADIUS,
  RIDER_RADIUS,
  SNAIL_DURATION_TICKS,
  STAR_DURATION_TICKS,
} from "../../tuning.js";
import { type GameState, type PlayerId, sortedPlayers } from "../../state.js";
import { MAX_EXTRA_BOMBS } from "../../launch-modifiers.js";
import { MAX_PORTAL_PAIRS, createPortalPair } from "../../portal.js";
import {
  MAX_POWER_PICKUPS,
  powerTrailLifetimeTicks,
} from "../../power-progression.js";
import { type Movement } from "../context.js";
import { cos, hypot2, sin } from "../../deterministic-math.js";
import { isClearOfPortalWalls, isSafePortalPosition } from "../portals.js";
import { nextRandom } from "../../rng.js";
import { portalBounds } from "../field.js";
import { recordPickup } from "../../match-stats.js";

/**
 * Each pickup goes to the nearest rider whose step reaches it (seat order breaks a tie) and takes effect at once, so
 * a Star collected this tick already protects against this tick's hazards. Pickups are visited in id order: a portal
 * or a black hole draws from the shared random stream as it is placed.
 */
export function collectPickups(ctx: TickContext): void {
  const { state, movements, events } = ctx;
  const consumed = new Set<number>();
  for (const pickup of [...state.pickups].sort((a, b) => a.id - b.id)) {
    const collectors = [...movements.values()]
      .filter(({ player }) => pickup.type !== "grip" || !player.grip)
      .map((movement) => ({
        movement,
        distance: pointSegmentDistanceSquared(
          pickup.x,
          pickup.y,
          movement.oldX,
          movement.oldY,
          movement.x,
          movement.y,
        ),
      }))
      .filter(
        ({ distance }) =>
          distance <= square(RIDER_RADIUS + PICKUP_RADIUS) + EPSILON,
      )
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          a.movement.player.slot - b.movement.player.slot,
      );
    const collector = collectors[0]?.movement.player;
    if (!collector) continue;
    if (pickup.type === "portal") {
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
      if (!pair) continue;
      // Pairs accumulate and expire on their own schedules; only the cap retires one early.
      state.portalPairs = [
        ...state.portalPairs.slice(
          Math.max(0, state.portalPairs.length + 1 - MAX_PORTAL_PAIRS),
        ),
        pair,
      ];
    }
    consumed.add(pickup.id);
    events.push({
      type: "pickupCollected",
      playerId: collector.id,
      pickupId: pickup.id,
    });
    recordPickup(state.matchStats, collector.id, pickup.type);
    if (pickup.type === "stopwatch") {
      collector.fuseLevel = Math.min(2, collector.fuseLevel + 1);
    } else if (pickup.type === "power") {
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
    } else if (pickup.type === "gun") {
      collector.gunArmed = true;
    } else if (pickup.type === "gravity") {
      openBlackHoles(state, movements);
    } else if (pickup.type === "shell") {
      collector.shellArmed = true;
    } else if (pickup.type === "target") {
      collector.targetBombArmed = true;
    } else if (pickup.type === "star") {
      collector.invulnerableUntilTick = Math.max(
        collector.invulnerableUntilTick,
        state.tick + STAR_DURATION_TICKS,
      );
    } else if (pickup.type === "grip") {
      collector.grip = true;
    } else if (pickup.type === "nitro") {
      addSpeedEffect(
        collector.nitroUntilTicks,
        state.tick + NITRO_DURATION_TICKS,
      );
    } else if (pickup.type === "snail") {
      for (const player of sortedPlayers(state)) {
        if (player.alive && player.id !== collector.id)
          addSpeedEffect(
            player.snailUntilTicks,
            state.tick + SNAIL_DURATION_TICKS,
          );
      }
    } else if (pickup.type === "ink") {
      for (const player of sortedPlayers(state)) {
        if (player.alive && player.id !== collector.id)
          player.inkUntilTick = Math.max(
            player.inkUntilTick,
            state.tick + INK_DURATION_TICKS,
          );
      }
    } else if (pickup.type === "beer") {
      for (const player of sortedPlayers(state)) {
        if (player.alive && player.id !== collector.id) {
          if (player.drunkUntilTick <= state.tick)
            player.drunkStartedTick = state.tick;
          player.drunkUntilTick = Math.max(
            player.drunkUntilTick,
            state.tick + DRUNK_DURATION_TICKS,
          );
        }
      }
    } else if (pickup.type === "five") {
      collector.fiveShotArmed = true;
    } else if (pickup.type === "extraBomb") {
      collector.extraBombs = Math.min(
        MAX_EXTRA_BOMBS,
        collector.extraBombs + 1,
      );
    } else if (pickup.type === "triple") {
      collector.tripleShotArmed = true;
    } else if (pickup.type === "orbitShield") {
      collector.shielded = true;
    }
  }
  if (consumed.size > 0)
    state.pickups = state.pickups.filter((pickup) => !consumed.has(pickup.id));
}

/** Deadlines stay sorted, so the earliest to expire is always first and replicas hold identical lists. */
function addSpeedEffect(deadlines: number[], untilTick: number): void {
  if (deadlines.length >= MAX_SPEED_EFFECT_STACK) return;
  let index = deadlines.length;
  while (index > 0 && deadlines[index - 1]! > untilTick) index -= 1;
  deadlines.splice(index, 0, untilTick);
}

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
