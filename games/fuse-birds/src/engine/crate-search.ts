import {
  SHOT_STEPS,
  UNIT,
  WIDTH,
  nextRandom,
  type Match,
  type Crate,
  HEIGHT,
} from "./types.js";
import { groundAt, boxClear } from "./terrain.js";
import { candidateVector, traceCrateShot } from "./level.js";
import { sweep } from "./physics.js";

/** Predict the same full-width resting contact used by the live falling crate. */
export function crateLanding(
  state: Match,
  x: number,
): { spawnY: number; crate: Crate } | undefined {
  const spawnY = Math.max(30, groundAt(state.terrain, x) - 170) * UNIT;
  if (!boxClear(state.terrain, x * UNIT, spawnY, 5 * UNIT, 5 * UNIT)) return;
  const ground = sweep(
    state.terrain,
    x * UNIT,
    spawnY,
    0,
    HEIGHT * UNIT - spawnY,
    5 * UNIT,
  );
  if (!ground || (ground.y - 1) / UNIT + 5 >= state.water) return;
  return {
    spawnY,
    crate: {
      id: state.nextEntity,
      x: x * UNIT,
      y: ground.y - 1,
      vy: 0,
      grounded: true,
    },
  };
}

export function scheduleCrate(state: Match): void {
  if (state.crates.length >= 3 || state.crateSearch) return;
  state.crateSearch = {
    sites: Array.from(
      { length: 8 },
      () => 40 + (nextRandom(state) % (WIDTH - 80)),
    ),
    site: 0,
    player: 0,
    candidate: 0,
    work: 0,
  };
}
/** Checkpointed, bounded search. Failed sites skip a delivery rather than block a turn. */
export function searchCrate(state: Match): void {
  const job = state.crateSearch;
  if (!job) return;
  if (
    state.crates.length >= 3 ||
    state.phase === "over" ||
    state.phase === "fault"
  ) {
    state.crateSearch = null;
    return;
  }
  let budget = 2200,
    cachedSite = -1,
    surface = 0;
  let landing: ReturnType<typeof crateLanding>;
  const next = () => {
    if (++job.candidate === 24) {
      job.candidate = 0;
      if (++job.player === state.players.length) {
        job.player = 0;
        job.site++;
      }
    }
  };
  while (budget > 0 && job.site < job.sites.length) {
    if (job.work + SHOT_STEPS + 1 > 100_000) {
      state.crateSearch = null;
      return;
    }
    const x = job.sites[job.site]!;
    if (cachedSite !== job.site) {
      cachedSite = job.site;
      surface = groundAt(state.terrain, x);
      landing = crateLanding(state, x);
    }
    if (
      surface >= state.water - 10 ||
      state.players.some((p) => p.hp > 0 && Math.abs(p.x / UNIT - x) < 20)
    ) {
      budget--;
      job.work++;
      job.site++;
      job.player = 0;
      job.candidate = 0;
      continue;
    }
    if (!landing) {
      budget--;
      job.work++;
      job.site++;
      job.player = 0;
      job.candidate = 0;
      continue;
    }
    const player = state.players[job.player]!,
      target = landing.crate;
    const vector =
      player.hp > 0 && player.grounded
        ? candidateVector(player, target, state.wind, job.candidate * 8)
        : undefined;
    if (vector && budget < SHOT_STEPS + 1) return;
    budget--;
    job.work++;
    if (vector) {
      const result = traceCrateShot(
        state.terrain,
        state.players,
        player,
        vector,
        state.wind,
        [...state.crates, target],
        target,
      );
      job.work += result.steps;
      budget -= result.steps;
      if (result.hit) {
        state.crates.push({
          id: state.nextEntity++,
          x: x * UNIT,
          y: landing.spawnY,
          vy: 0,
          grounded: false,
        });
        state.crateSearch = null;
        return;
      }
    }
    next();
  }
  if (job.site === job.sites.length) state.crateSearch = null;
}
