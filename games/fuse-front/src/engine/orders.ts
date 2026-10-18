/**
 * Queued orders (shift-click). A hero's current order lives in its own fields — a `goal` (a move, or an attack-move
 * with `sweep`) or a focus (`focus.ts`) — and the orders queued behind it in `queue`, at most `QUEUE_MAX`. A hero is
 * idle when it has neither and its stick is released; each step (`step.ts`, after the step's commands) a living idle
 * hero starts the next queued order: a move or attack-move walks to its tile, an attack focuses its target (skipped
 * when the target is gone), and a cast is tried there and then. A queued cast that cannot be cast — cooldown, energy,
 * range, a target gone — is retried each step while the hero stands, `wait` counting the tries, and skipped after
 * `CAST_WAIT`; a cast that goes off (or is skipped) starts the next order the same step.
 *
 * A command with `queued` appends to the queue (a full queue refuses it); one without starts at once and clears the
 * queue, as does pushing the stick and the hero's death. A plain cast is instant and leaves the current order and
 * queue alone. Releasing the stick keeps the queue. Orders queued while the stick is still held wait for its release,
 * orders queued while dead start after the respawn, and an attack-move standing to fight is still its current order.
 */
import { dropFocus, enemyAt } from "./focus.js";
import { alive } from "./hero.js";
import type { GameMap } from "./map.js";
import { cast } from "./spells.js";
import { CAST_WAIT, QUEUE_MAX, teamOf } from "./tuning.js";
import type { Hero, World } from "./world.js";

/** A queued order; a cast's `of` and `id` are its chosen target (`MARKS` index and id), or -1 for none. */
export type Order =
  | { type: "move" | "attackMove"; x: number; y: number }
  | { type: "attack"; of: number; id: number }
  | {
      type: "cast";
      slot: number;
      x: number;
      y: number;
      of: number;
      id: number;
    };

/** Order kinds by their checkpoint index (`codec.ts`). */
export const ORDER_KINDS = ["move", "attackMove", "attack", "cast"] as const;

/** Whether the hero has no current order (no goal, no focus) and its stick is released. */
export const idle = (hero: Hero): boolean =>
  hero.goal < 0 && hero.focusOf < 0 && hero.steerX === 0 && hero.steerY === 0;

export function clearQueue(hero: Hero): void {
  hero.queue = [];
  hero.wait = 0;
}

/** Appends an order unless the queue is full. The queue array is replaced, never mutated, so snapshots stay intact. */
export function enqueue(hero: Hero, order: Order): void {
  if (hero.queue.length < QUEUE_MAX) hero.queue = [...hero.queue, order];
}

/** Starts a move (or attack-move) to tile (x, y): it drops a focus and releases the stick. */
export function startMove(
  map: GameMap,
  hero: Hero,
  x: number,
  y: number,
  sweep: boolean,
): void {
  dropFocus(hero);
  [hero.goal, hero.steerX, hero.steerY] = [y * map.width + x, 0, 0];
  hero.sweep = sweep ? 1 : 0;
}

/** Focuses the hero on an enemy, dropping its move and releasing the stick. */
export function startAttack(hero: Hero, of: number, id: number): void {
  dropFocus(hero);
  Object.assign(hero, { focusOf: of, focus: id, goal: -1, sweep: 0 });
  [hero.steerX, hero.steerY] = [0, 0];
}

/**
 * Whether a queued cast's chosen target (`MARKS` index and id) is one a checkpoint admits: a unit id already given
 * out (`nextId`), a seat in play, or a map site. Whether it is still there, and a fit target, is the spell's to check.
 */
export const castable = (
  map: GameMap,
  nextId: number,
  inPlay: (seat: number) => boolean,
  of: number,
  id: number,
): boolean =>
  of === 0 ? id < nextId : of === 1 ? inPlay(id) : id < map.sites.length;

/** Each living idle hero, by seat, starts its queued orders until one takes time or a cast has to wait. */
export function advanceOrders(map: GameMap, world: World): void {
  for (const hero of world.heroes) {
    // At most one try per queued order and step, so the loop is bounded by `QUEUE_MAX`.
    while (alive(hero) && hero.queue.length > 0 && idle(hero)) {
      const order = hero.queue[0]!;
      if (order.type === "cast") {
        const { slot, x, y, of, id } = order;
        const chosen = of < 0 ? undefined : { of, id };
        if (
          !cast(map, world, hero, slot, x, y, chosen) &&
          ++hero.wait < CAST_WAIT
        )
          break;
        hero.wait = 0;
        hero.queue = hero.queue.slice(1);
        continue;
      }
      hero.queue = hero.queue.slice(1);
      if (order.type === "attack") {
        const team = teamOf(hero.seat);
        if (enemyAt(map, world, team, order.of, order.id) !== undefined)
          startAttack(hero, order.of, order.id);
      } else
        startMove(map, hero, order.x, order.y, order.type === "attackMove");
    }
  }
}
