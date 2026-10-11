// Shared helpers for the engine tests (not a test file itself).

import {
  createRound,
  FIRE,
  gridHash,
  isLoaded,
  step,
  type Gate,
  type RoundConfig,
  type RoundState,
  type Rocket,
} from "../src/engine/index.js";

/** One tick of an input script: each seat's held bits, or `true` for `FIRE` held (`true` on consecutive ticks holds it). */
export type Inputs = readonly (number | boolean)[];

/** The held bits `step` takes for one tick of an input script. */
export const held = (inputs: Inputs): number[] =>
  inputs.map((b) => (b === true ? FIRE : b === false ? 0 : b));

/** Presses every loaded castle's button: the "fire whenever loaded" script. */
export function spamInputs(state: RoundState): boolean[] {
  return state.castles.map((c) => isLoaded(c));
}

/** Runs a round to completion with the given input script (after `setup` changes the fresh round, if given). */
export function playOut(
  config: RoundConfig,
  inputs: (state: RoundState) => Inputs = spamInputs,
  onTick?: (state: RoundState) => void,
  setup?: (state: RoundState) => void,
): RoundState {
  const state = createRound(config);
  setup?.(state);
  while (state.result === null && state.tick < state.maxTicks + 10) {
    step(state, held(inputs(state)));
    onTick?.(state);
  }
  return state;
}

/** A compact fingerprint of everything that matters in a state. */
export function fingerprint(state: RoundState): string {
  const terrain = gridHash(state.terrain);
  return JSON.stringify({
    tick: state.tick,
    phase: state.phase,
    result: state.result,
    rng: state.rng,
    terrain,
    castles: state.castles,
    rockets: state.rockets.map((r) => [r.id, r.x, r.y, r.vx, r.vy, r.power]),
    gates: state.gates.map((g) => [g.id, g.x, g.y, g.multiplier]),
    crates: state.crates.map((k) => [k.id, k.x, k.y, k.card]),
    ghosts: state.ghosts,
    lastHeld: state.lastHeld,
    bots: state.bots,
  });
}

/** Replaces all gates with one stationary gate at (x, y). */
export function placeGate(
  state: RoundState,
  x: number,
  y: number,
  multiplier: number,
): Gate {
  const gate: Gate = {
    id: state.nextId++,
    multiplier,
    x,
    y,
    width: 22,
    height: 110,
    spawnTick: state.tick,
    expireTick: state.tick + 100_000,
    x0: x,
    vx: 0,
    minX: x,
    maxX: x,
    baseY: y,
    bobAmp: 0,
    bobPeriodTicks: 60,
    bobPhase: 0,
  };
  state.gates = [gate];
  return gate;
}

/** Adds a free-flying rocket (for targeted collision tests). */
export function addRocket(
  state: RoundState,
  rocket: Partial<Rocket> & { x: number; y: number },
): Rocket {
  const r: Rocket = {
    id: state.nextId++,
    owner: 0,
    vx: 0,
    vy: 0,
    power: 1,
    mega: false,
    bomb: false,
    ghost: false,
    gates: [],
    age: 0,
    ...rocket,
  };
  state.rockets.push(r);
  return r;
}

/** Clears all rock (hard rock too), so a test builds exactly the terrain it needs. */
export function openWorld(state: RoundState): void {
  state.terrain.solid.fill(0);
  state.terrain.hard.fill(0);
}

/**
 * Clears the rock and lines the castles up `spacing` px apart across the middle of the world, so neighbours are in
 * range of each other. On the temple the spawn anchors are mostly out of range of each other, so tests of aim
 * without flying set rounds up like this.
 */
export function lineUp(state: RoundState, spacing = 1200): void {
  openWorld(state);
  const n = state.castles.length;
  for (const c of state.castles) {
    c.x = state.terrain.width / 2 + (c.id - (n - 1) / 2) * spacing;
    c.y = 1300;
  }
}

/** Removes gates and crates so tests are not disturbed by them. */
export function clearSky(state: RoundState): void {
  state.gates = [];
  state.crates = [];
  state.nextCrateTick = Number.MAX_SAFE_INTEGER;
}
