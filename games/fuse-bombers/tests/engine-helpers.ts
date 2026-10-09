// Shared helpers for the engine tests (not a test file itself).

import {
  createRound,
  isLoaded,
  step,
  type Gate,
  type RoundConfig,
  type RoundState,
  type Rocket,
} from "../src/engine/index.js";

/** Presses every loaded castle's button: the "fire whenever loaded" script. */
export function spamInputs(state: RoundState): boolean[] {
  return state.castles.map((c) => isLoaded(c));
}

/** Runs a round to completion with the given input script. */
export function playOut(
  config: RoundConfig,
  inputs: (state: RoundState) => boolean[] = spamInputs,
  onTick?: (state: RoundState) => void,
): RoundState {
  const state = createRound(config);
  while (state.result === null && state.tick < state.maxTicks + 10) {
    step(state, inputs(state));
    onTick?.(state);
  }
  return state;
}

/** A compact fingerprint of everything that matters in a state. */
export function fingerprint(state: RoundState): string {
  let terrain = 0;
  for (let i = 0; i < state.terrain.surface.length; i++) {
    terrain += (state.terrain.surface[i] ?? 0) * ((i % 7) + 1);
  }
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

/** Removes gates and crates so tests are not disturbed by them. */
export function clearSky(state: RoundState): void {
  state.gates = [];
  state.crates = [];
  state.nextCrateTick = Number.MAX_SAFE_INTEGER;
}
