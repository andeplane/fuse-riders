// Reachability: can a castle hit another one from where they stand with some launcher angle in its
// arc? `createRound` uses it to reject arenas where some pair of castles could never hit each other.

import {
  arcFor,
  castleCenter,
  DEG,
  integrate,
  isOffscreen,
  launchState,
} from "./geometry.js";
import { surfaceAt } from "./terrain.js";
import { SUBSTEPS, type Tuning } from "./tuning.js";
import type { Facing, TerrainView, Vec2 } from "./types.js";

export interface ShotEnd {
  /** Index into `castles` of the castle the rocket hit, or -1 for terrain / off-screen / timeout. */
  hit: number;
  /** Where the rocket stopped. */
  x: number;
  y: number;
}

/**
 * Traces a spread-free rocket fired from `castles[shooter]` at `angle` with the same integrator as
 * the simulation. Gates, crates and shields are ignored: this is about terrain and castle bodies.
 */
export function traceShot(
  terrain: TerrainView,
  tuning: Tuning,
  castles: readonly Readonly<Vec2>[],
  shooter: number,
  angle: number,
  maxTicks = 600,
): ShotEnd {
  const from = castles[shooter];
  if (!from) throw new RangeError(`no castle ${shooter}`);
  const r = launchState(from, tuning, angle);
  const reach = tuning.castleRadius + tuning.rocketRadius;
  const centres = castles.map((c) => castleCenter(c, tuning));
  for (let k = 0; k < maxTicks * SUBSTEPS; k++) {
    integrate(r, tuning.gravity);
    if (isOffscreen(r.x, r.y, terrain.width, terrain.height)) break;
    for (let i = 0; i < centres.length; i++) {
      const c = centres[i];
      if (i === shooter || !c) continue;
      const dx = r.x - c.x;
      const dy = r.y - c.y;
      if (dx * dx + dy * dy < reach * reach) return { hit: i, x: r.x, y: r.y };
    }
    if (r.y >= surfaceAt(terrain, r.x)) break;
  }
  return { hit: -1, x: r.x, y: r.y };
}

/**
 * An angle in `[arcMin, arcMax]` at which `castles[shooter]` hits `castles[target]` (every castle in
 * the list can block the shot), or null if there is none. Scans the half of the arc that points at
 * the target every `stepDeg` degrees and bisects wherever the landing point jumps across the target,
 * so hit windows much narrower than the scan step are still found.
 */
export function findHitAngle(
  terrain: TerrainView,
  tuning: Tuning,
  castles: readonly Readonly<Vec2>[],
  shooter: number,
  target: number,
  arc: readonly [number, number],
  stepDeg = 0.5,
): number | null {
  const from = castles[shooter];
  const to = castles[target];
  if (!from || !to || shooter === target) return null;
  let [lo, hi] = arc;
  if (to.x > from.x) hi = Math.min(hi, Math.PI / 2);
  else lo = Math.max(lo, Math.PI / 2);
  if (hi < lo) return null;

  // Signed miss: 0 on a hit, otherwise which side of the target the rocket came down on.
  const miss = (angle: number): number => {
    const end = traceShot(terrain, tuning, castles, shooter, angle);
    return end.hit === target ? 0 : end.x - to.x || 1e-9;
  };
  const n = Math.max(1, Math.ceil((hi - lo) / (stepDeg * DEG)));
  let prevAngle = lo;
  let prev = miss(lo);
  if (prev === 0) return lo;
  for (let k = 1; k <= n; k++) {
    const angle = lo + ((hi - lo) * k) / n;
    const m = miss(angle);
    if (m === 0) return angle;
    if (Math.sign(m) !== Math.sign(prev)) {
      let a = prevAngle;
      let b = angle;
      let ma = prev;
      for (let i = 0; i < 14; i++) {
        const mid = (a + b) / 2;
        const mm = miss(mid);
        if (mm === 0) return mid;
        if (Math.sign(mm) === Math.sign(ma)) {
          a = mid;
          ma = mm;
        } else b = mid;
      }
    }
    prevAngle = angle;
    prev = m;
  }
  return null;
}

/** Which way a castle faces with living opponents on the given sides. */
function facingOf(left: boolean, right: boolean): Facing {
  return left && right ? "both" : left ? "left" : "right";
}

/**
 * True when every castle can hit every other castle, both at spawn (everyone alive, spawn arcs) and
 * in the duel the pair would end up in (only the two alive, arcs narrowed toward each other).
 * `castles` must be ordered left to right, as in a round.
 */
export function everyPairReachable(
  terrain: TerrainView,
  tuning: Tuning,
  castles: readonly Readonly<Vec2>[],
): boolean {
  const n = castles.length;
  for (let i = 0; i < n; i++) {
    const spawnArc = arcFor(facingOf(i > 0, i < n - 1), tuning);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (findHitAngle(terrain, tuning, castles, i, j, spawnArc) === null)
        return false;
      const a = castles[i];
      const b = castles[j];
      if (!a || !b) return false;
      const duelArc = arcFor(b.x < a.x ? "left" : "right", tuning);
      if (findHitAngle(terrain, tuning, [a, b], 0, 1, duelArc) === null)
        return false;
    }
  }
  return true;
}
