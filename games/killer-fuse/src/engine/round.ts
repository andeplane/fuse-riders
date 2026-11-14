/** Creating a round: six units on their spawn points, full piles, empty hives, neutral gates, the snail at its start. */
import { newMind } from "./bot.js";
import { arenaOf, standingOn, wrapDelta, wrapX, type Arena } from "./maps.js";
import { hashSeed } from "./rng.js";
import { MAX_PLAYERS, QUEEN_EGGS, RULES, UNIT } from "./tuning.js";
import type { Lesson, LooseBerry, Round, RoundOptions, Unit } from "./types.js";
import { isQueenSlot, newUnit } from "./units.js";

/** Every lesson, in the order the tutorial teaches them. */
export const LESSONS: readonly Lesson[] = [
  "berries",
  "warrior",
  "snail",
  "queen",
];
/** The seat a Worker lesson is set up for: Cyan's first Worker. */
export const LESSON_SLOT = 2;
/** How far from the learner's spawn a lesson's berry lies. */
const LESSON_BERRY = 2 * UNIT;

/**
 * A lesson's berry, always at rest: on the learner's spawn platform, two units to the side that has that platform
 * under it and nobody standing there, or, where the platform is too short for either, on the first platform below
 * that spot, for the learner to step down to.
 */
function lessonBerry(arena: Arena): LooseBerry {
  const spawn = arena.spawns[LESSON_SLOT]!;
  const ground = standingOn(arena, spawn.x, spawn.y);
  const sides = [wrapX(spawn.x + LESSON_BERRY), wrapX(spawn.x - LESSON_BERRY)];
  // Clear of every other spawn, or a teammate standing there would take it.
  const beside = sides.find(
    (side) =>
      standingOn(arena, side, spawn.y) === ground &&
      arena.spawns.every((other) => Math.abs(wrapDelta(other.x, side)) >= UNIT),
  );
  const x = beside ?? sides[0]!;
  let y = spawn.y;
  if (beside === undefined) {
    // The floor spans the map, so there is always a platform below.
    const below = arena.solids
      .filter(
        (solid) => solid.y > spawn.y && x >= solid.x && x <= solid.x + solid.w,
      )
      .map((solid) => solid.y);
    y = Math.min(...below);
  }
  return { x, y, vx: 0, vy: 0, resting: true, wait: 0, by: LESSON_SLOT };
}

export function createRound(options: RoundOptions): Round {
  const mapId = options.mapId ?? 1;
  const arena = arenaOf(mapId);
  const botLevel = options.botLevel ?? "medium";
  const units: Unit[] = [];
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) {
    const spawn = arena.spawns[slot]!;
    units.push(
      newUnit(
        slot,
        isQueenSlot(slot) ? "queen" : "worker",
        spawn.x,
        spawn.y,
        standingOn(arena, spawn.x, spawn.y),
      ),
    );
  }
  const state: Round = {
    rules: RULES,
    mapId,
    seed: Math.trunc(options.seed),
    rng: hashSeed(options.seed, mapId),
    botLevel,
    teamLevels: [...(options.teamLevels ?? [botLevel, botLevel])],
    humans: Array.from(
      { length: MAX_PLAYERS },
      (_, slot) => options.humans?.[slot] === true,
    ),
    passive: options.passive === true,
    step: 0,
    units,
    piles: arena.piles.map((pile) => pile.count),
    loose: [],
    holes: arena.holes.map((holes) => holes.map(() => false)),
    gates: arena.gates.map(() => ({ owner: -1, user: -1 })),
    snail: {
      x: arena.snail.start,
      vx: 0,
      rider: -1,
      victim: -1,
      eat: 0,
      facing: 1,
    },
    eggs: [QUEEN_EGGS, QUEEN_EGGS],
    winner: null,
    bots: [],
    events: [],
  };
  if (options.lesson === "berries" || options.lesson === "warrior")
    state.loose.push(lessonBerry(arena));
  if (options.lesson === "snail") {
    const goal = arena.snail.goals[0];
    state.snail.x = goal + Math.trunc((arena.snail.start - goal) / 4);
    // Cyan's goal is the left one on every map.
    state.snail.facing = -1;
  }
  // Each team's plan is drawn from the seed, in an order that favours neither side.
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1)
    state.bots.push(newMind(state, slot));
  return state;
}
