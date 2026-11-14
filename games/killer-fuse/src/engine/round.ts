/** Creating a round: six units on their spawn points, full piles, empty hives, neutral gates, the snail at its start. */
import { newMind } from "./bot.js";
import { arenaOf, standingOn } from "./maps.js";
import { hashSeed } from "./rng.js";
import { MAX_PLAYERS, QUEEN_EGGS, RULES } from "./tuning.js";
import type { Round, RoundOptions, Unit } from "./types.js";
import { isQueenSlot, newUnit } from "./units.js";

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
  // Each team's plan is drawn from the seed, in an order that favours neither side.
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1)
    state.bots.push(newMind(state, slot));
  return state;
}
