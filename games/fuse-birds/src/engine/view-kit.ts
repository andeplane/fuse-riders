import { advanceProjectile, projectileOrigin, outside } from "./physics.js";
import {
  UNIT,
  legalVector,
  quantize,
  type Projectile,
  type Vector,
} from "./types.js";
import type { WorldView } from "./view.js";
export { quantize };
export { MAX_VX, MAX_VY } from "./types.js";
export function terrainSolid(view: WorldView, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) return false;
  const i = Math.floor(y) * view.width + Math.floor(x);
  return (view.terrain.bits[i >>> 3]! & (1 << (i & 7))) !== 0;
}
export function projectShot(
  view: WorldView,
  vector: Vector,
  budget = 45,
): { x: number; y: number }[] {
  const bird = view.players[view.active];
  if (!bird || !legalVector(vector.vx, vector.vy)) return [];
  const p: Projectile = {
    id: 0,
    shot: 0,
    owner: bird.id,
    kind: "pebble",
    ...projectileOrigin(bird, vector, view.terrain, view.players, view.crates),
    ...vector,
    expires: 600,
    cleared: false,
  };
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < Math.max(0, Math.min(90, Math.floor(budget))); i++) {
    const hit = advanceProjectile(
      p,
      view.wind,
      view.terrain,
      view.players,
      view.crates,
    );
    if (hit || outside(p)) break;
    if (i % 3 === 0) points.push({ x: p.x / UNIT, y: p.y / UNIT });
  }
  return points;
}
