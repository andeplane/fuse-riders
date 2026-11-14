/** Shared setup for the engine tests: a round with no bots and only the units a test asks for. */
import assert from "node:assert/strict";
import {
  NEUTRAL,
  S,
  arenaOf,
  createRound,
  stepRound,
  type Arena,
  type GameEvent,
  type Input,
  type MapId,
  type Round,
  type Unit,
} from "../src/engine/index.js";

export const ALL_HUMANS: readonly boolean[] = [
  true,
  true,
  true,
  true,
  true,
  true,
];
const PARKED = 10_000_000;

/** A round where people hold every slot (so no bot moves) and every unit waits off the map until a test puts it. */
export function bare(mapId: MapId = 1): Round {
  const state = createRound({ seed: 7, mapId, humans: ALL_HUMANS });
  for (const unit of state.units) {
    unit.dead = true;
    unit.respawn = PARKED;
  }
  return state;
}

export function unitOf(state: Round, slot: number): Unit {
  const unit = state.units[slot];
  assert.ok(unit, `slot ${slot}`);
  return unit;
}

/** Puts a unit in the air with its feet at (x, y) art pixels. */
export function put(
  state: Round,
  slot: number,
  x: number,
  y: number,
  patch: Partial<Unit> = {},
): Unit {
  const unit = unitOf(state, slot);
  Object.assign(
    unit,
    { dead: false, respawn: 0, x: x * S, y: y * S, vx: 0, vy: 0, ground: -1 },
    patch,
  );
  return unit;
}

/** The platform whose top is at `y` art pixels under `x`. */
export function platformUnder(arena: Arena, x: number, y: number): number {
  const index = arena.solids.findIndex(
    (solid) =>
      solid.y === y * S && x * S >= solid.x && x * S <= solid.x + solid.w,
  );
  assert.ok(index >= 0, `no platform top at ${x}, ${y}`);
  return index;
}

/** Stands a unit on the platform whose top is at (x, y) art pixels. */
export function stand(
  state: Round,
  slot: number,
  x: number,
  y: number,
  patch: Partial<Unit> = {},
): Unit {
  const ground = platformUnder(arenaOf(state.mapId), x, y);
  return put(state, slot, x, y, { ground, ...patch });
}

export const control = (patch: Partial<Input>): Input => ({
  ...NEUTRAL,
  ...patch,
});

/** An input array with the given slots' controls and neutral elsewhere. */
export function controls(
  bySlot: Readonly<Record<number, Partial<Input>>>,
): Input[] {
  return ALL_HUMANS.map((_, slot) => control(bySlot[slot] ?? {}));
}

/** Steps the round and returns every event of those steps in order. */
export function run(
  state: Round,
  steps: number,
  inputs: (index: number) => readonly Input[] = () => [],
): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < steps; i += 1) {
    stepRound(state, inputs(i));
    events.push(...state.events);
  }
  return events;
}

export const ofType = <T extends GameEvent["type"]>(
  events: readonly GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] =>
  events.filter(
    (event): event is Extract<GameEvent, { type: T }> => event.type === type,
  );
