import {
  CHUNK,
  HEIGHT,
  UNIT,
  WIDTH,
  nextRandom,
  type Terrain,
} from "./types.js";

export function solid(terrain: Terrain, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return false;
  const i = Math.floor(y) * WIDTH + Math.floor(x);
  return (terrain.bits[i >>> 3]! & (1 << (i & 7))) !== 0;
}
function write(terrain: Terrain, x: number, y: number, fill: boolean): void {
  const i = y * WIDTH + x,
    mask = 1 << (i & 7);
  terrain.bits[i >>> 3] = fill
    ? terrain.bits[i >>> 3]! | mask
    : terrain.bits[i >>> 3]! & ~mask;
}
export function carve(
  terrain: Terrain,
  cx: number,
  cy: number,
  radius: number,
): number {
  const changed = new Set<number>();
  let removed = 0;
  for (
    let y = Math.max(0, Math.floor(cy - radius));
    y <= Math.min(HEIGHT - 1, Math.ceil(cy + radius));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(cx - radius));
      x <= Math.min(WIDTH - 1, Math.ceil(cx + radius));
      x++
    ) {
      const dx = 2 * x + 1 - 2 * cx,
        dy = 2 * y + 1 - 2 * cy;
      if (dx * dx + dy * dy <= 4 * radius * radius && solid(terrain, x, y)) {
        write(terrain, x, y, false);
        removed++;
        changed.add(
          Math.floor(y / CHUNK) * (WIDTH / CHUNK) + Math.floor(x / CHUNK),
        );
      }
    }
  }
  if (removed) {
    terrain.version++;
    for (const i of changed) terrain.revisions[i] = terrain.revisions[i]! + 1;
  }
  return removed;
}
export function groundAt(terrain: Terrain, x: number, from = 0): number {
  for (let y = Math.max(0, Math.floor(from)); y < HEIGHT; y++)
    if (solid(terrain, Math.floor(x), y)) return y;
  return HEIGHT;
}
/** Materials never generate physics. A seeded grid is authoritative even without graphics. */
export function generateTerrain(
  seed: number,
  count: number,
  fallback = false,
): { terrain: Terrain; spawns: { x: number; y: number }[] } {
  const rng = { rng: seed >>> 0 },
    terrain: Terrain = {
      bits: new Uint8Array((WIDTH * HEIGHT) / 8),
      revisions: Array<number>(72).fill(0),
      version: 0,
    };
  const heights: number[] = [];
  for (let i = 0; i <= 16; i++)
    heights.push(fallback ? 450 : 335 + (nextRandom(rng) % 285));
  const perches = Array.from({ length: count }, (_, i) => ({
    x: 70 + Math.round((i * (WIDTH - 140)) / (count - 1)),
    y: fallback ? 450 : 350 + (nextRandom(rng) % 60),
  }));
  for (let x = 0; x < WIDTH; x++) {
    const span = 96,
      i = Math.floor(x / span),
      f = x % span;
    // Integer smoothstep creates rounded mesas and steep gullies without native transcendental math.
    const blend = f * f * (3 * span - 2 * f),
      denominator = span * span * span;
    let surface = Math.trunc(
      (heights[i]! * (denominator - blend) + heights[i + 1]! * blend) /
        denominator,
    );
    // Players start on high, open perches; deeper valleys are still part of the knockback, falling and excavation geometry.
    // Actual trajectories, rather than this construction heuristic, decide whether a level is admitted.
    for (const perch of perches)
      surface = Math.min(
        surface,
        perch.y + Math.max(0, Math.abs(x - perch.x) - 20) * 2,
      );
    for (let y = surface; y < HEIGHT; y++) write(terrain, x, y, true);
  }
  if (!fallback) {
    // Deep arches keep launch perches safe while giving blasts useful bridges to cut.
    for (let i = 0; i < 5; i++) {
      const cx = 90 + i * 300 + (nextRandom(rng) % 100),
        cy = 704 + (nextRandom(rng) % 30);
      const rx = 45 + (nextRandom(rng) % 45),
        ry = 90 + (nextRandom(rng) % 85);
      for (let x = Math.max(0, cx - rx); x < Math.min(WIDTH, cx + rx); x++) {
        const roof = groundAt(terrain, x) + 48;
        for (let y = Math.max(roof, cy - ry); y < HEIGHT; y++) {
          const dx = x - cx,
            dy = y - cy;
          if (dx * dx * ry * ry + dy * dy * rx * rx < rx * rx * ry * ry)
            write(terrain, x, y, false);
        }
      }
    }
  }
  const spawns = Array.from({ length: count }, (_, i) => {
    const x = perches[i]!.x,
      y = groundAt(terrain, x);
    // Flatten a bounded perch, not the rest of the random landscape.
    for (let px = x - 18; px <= x + 18; px++)
      for (let py = y - 20; py <= y + 12; py++) write(terrain, px, py, py >= y);
    return { x: x * UNIT, y: (y - 6) * UNIT };
  });
  terrain.version = 0;
  terrain.revisions.fill(0);
  return { terrain, spawns };
}
export function boxClear(
  t: Terrain,
  x: number,
  y: number,
  hx: number,
  hy: number,
): boolean {
  for (
    let cy = Math.floor((y - hy) / UNIT);
    cy <= Math.floor((y + hy - 1) / UNIT);
    cy++
  )
    for (
      let cx = Math.floor((x - hx) / UNIT);
      cx <= Math.floor((x + hx - 1) / UNIT);
      cx++
    )
      if (solid(t, cx, cy)) return false;
  return true;
}
