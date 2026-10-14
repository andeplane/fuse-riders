import {
  GRAVITY,
  MAX_VX,
  MAX_VY,
  SHOT_STEPS,
  UNIT,
  WINDS,
  legalVector,
  quantize,
  type Match,
  type Player,
  type Projectile,
  type Terrain,
  type Crate,
  type Vector,
} from "./types.js";
import {
  advanceProjectile,
  damageAt,
  launchPosition,
  projectileOrigin,
  outside,
  collectsCrate,
  blastProfile,
} from "./physics.js";
import { generateTerrain } from "./terrain.js";

/** A candidate, not an analytical hit claim: every accepted vector is simulated below. */
export function candidateVector(
  from: Player,
  to: { x: number; y: number },
  wind: number,
  candidate: number,
): Vector | undefined {
  const time = 30 + candidate;
  // The muzzle depends on launch direction. Solve each of the four origins and retain
  // only a self-consistent quantized vector; targeting heuristics never grant a hit.
  for (const direction of [
    [1, 0],
    [-1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    const start = launchPosition(from, direction[0], direction[1]);
    const vx = (to.x - start.x - (wind * time * (time + 1)) / 2) / time;
    const vy = (to.y - start.y - (GRAVITY * time * (time + 1)) / 2) / time;
    if (Math.abs(vx) > MAX_VX || Math.abs(vy) > MAX_VY) continue;
    const v = quantize(vx, vy),
      actual = launchPosition(from, v.vx, v.vy);
    if (actual.x === start.x && actual.y === start.y && legalVector(v.vx, v.vy))
      return v;
  }
  return;
}
export function traceShot(
  terrain: Terrain,
  players: readonly Player[],
  from: Player,
  vector: Vector,
  wind: number,
  target: string,
): { hit: boolean; steps: number } {
  const p: Projectile = {
    id: 1,
    shot: 1,
    owner: from.id,
    kind: "pebble",
    ...projectileOrigin(from, vector, terrain, players),
    ...vector,
    expires: SHOT_STEPS,
    cleared: false,
  };
  for (let step = 0; step < SHOT_STEPS; step++) {
    const hit = advanceProjectile(p, wind, terrain, players, []);
    if (hit) {
      const bird = players.find((b) => b.id === target);
      return {
        hit: !!bird && damageAt(terrain, hit, bird, "pebble") > 0,
        steps: step + 1,
      };
    }
    if (outside(p)) return { hit: false, steps: step + 1 };
  }
  return { hit: false, steps: SHOT_STEPS };
}
/** Certify the actual crate collider and pickup rule, including survival of the collecting owner. */
export function traceCrateShot(
  terrain: Terrain,
  players: readonly Player[],
  from: Player,
  vector: Vector,
  wind: number,
  crates: readonly Crate[],
  target: Crate,
): { hit: boolean; steps: number } {
  const projectile: Projectile = {
    id: 0,
    shot: 0,
    owner: from.id,
    kind: "pebble",
    ...projectileOrigin(from, vector, terrain, players, crates),
    ...vector,
    expires: SHOT_STEPS,
    cleared: false,
  };
  for (let step = 0; step < SHOT_STEPS; step++) {
    const hit = advanceProjectile(projectile, wind, terrain, players, crates);
    if (hit)
      return {
        hit:
          collectsCrate(terrain, hit, target, blastProfile("pebble").radius) &&
          damageAt(terrain, hit, from, "pebble") < from.hp,
        steps: step + 1,
      };
    if (outside(projectile)) return { hit: false, steps: step + 1 };
  }
  return { hit: false, steps: SHOT_STEPS };
}
export function prepareLevel(state: Match): void {
  const job = state.preparation,
    count = state.players.length;
  let budget = 2200;
  const nextTerrain = (attempt: number) => {
    job.attempt = attempt;
    job.pair = 0;
    job.wind = 0;
    job.candidate = 0;
    job.witnesses = [];
    const level = generateTerrain(
      (state.seed + attempt * 2654435761) >>> 0,
      count,
      attempt === 4,
    );
    state.terrain = level.terrain;
    for (let i = 0; i < count; i++)
      Object.assign(state.players[i]!, level.spawns[i]);
  };
  const fail = () => {
    state.phase = "fault";
    state.fault =
      "The level could not establish safe opening shots. Start a new round.";
  };
  while (budget > 0 && state.phase === "preparing") {
    if (job.pair >= count * (count - 1)) {
      state.phase = "aiming";
      state.deadline = state.tick + 500;
      return;
    }
    // The quota is aggregate across attempts. Reserve the final fifth for the flat fallback.
    if (job.attempt < 4 && job.work >= 800_000) nextTerrain(4);
    if (job.work + SHOT_STEPS + 1 > 1_000_000) {
      fail();
      return;
    }
    const fromIndex = Math.floor(job.pair / (count - 1)),
      targetIndex = job.pair % (count - 1);
    const from = state.players[fromIndex]!,
      to =
        state.players[
          targetIndex >= fromIndex ? targetIndex + 1 : targetIndex
        ]!;
    const wind = WINDS[job.wind]!,
      v = candidateVector(from, to, wind, job.candidate);
    // A candidate trace is atomic; leave it for the next tick if its worst case would exceed this tick's quota.
    if (v && budget < SHOT_STEPS + 1) return;
    job.candidate++;
    budget--;
    job.work++;
    if (v) {
      const result = traceShot(
        state.terrain,
        state.players,
        from,
        v,
        wind,
        to.id,
      );
      budget -= result.steps;
      job.work += result.steps;
      if (result.hit) {
        job.witnesses.push({ from: from.id, to: to.id, wind, ...v });
        job.candidate = 0;
        if (++job.wind === WINDS.length) {
          job.wind = 0;
          job.pair++;
        }
      }
    }
    if (job.candidate >= 201) {
      if (job.attempt >= 4) {
        fail();
        return;
      }
      nextTerrain(job.attempt + 1);
    }
  }
}
