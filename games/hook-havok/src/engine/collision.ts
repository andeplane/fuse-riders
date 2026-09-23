import { PLATFORMS, S, HALF, BODY, WIDTH, type World } from "./world.js";
export interface Hit {
  time: number;
  nx: number;
  ny: number;
  platform: number;
}
/** Slab sweep. Stable platform index breaks equal-time ties; no frame-rate substeps. */
export function sweep(
  x: number,
  y: number,
  dx: number,
  dy: number,
  body = false,
): Hit | null {
  let hit: Hit | null = null;
  for (let i = 0; i < PLATFORMS.length; i++) {
    const [px, py, w, h] = PLATFORMS[i]!;
    const left = px * S - (body ? HALF : 0),
      right = (px + w) * S + (body ? HALF : 0);
    const top = py * S,
      bottom = (py + h) * S + (body ? BODY : 0);
    if (
      (!dx && (x <= left || x >= right)) ||
      (!dy && (y <= top || y >= bottom))
    )
      continue;
    const tx1 = dx ? (left - x) / dx : -Infinity,
      tx2 = dx ? (right - x) / dx : Infinity;
    const ty1 = dy ? (top - y) / dy : -Infinity,
      ty2 = dy ? (bottom - y) / dy : Infinity;
    const nearX = Math.min(tx1, tx2),
      nearY = Math.min(ty1, ty2);
    const enter = Math.max(nearX, nearY),
      leave = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2));
    if (enter < -1e-9 || enter > 1 || enter > leave || leave < 0) continue;
    const nx = nearX > nearY ? -Math.sign(dx) : 0,
      ny = nearX > nearY ? 0 : -Math.sign(dy);
    if (dx * nx + dy * ny >= 0) continue;
    if (!hit || enter < hit.time - 1e-9)
      hit = { time: Math.max(0, enter), nx, ny, platform: i };
  }
  return hit;
}
export function move(
  world: Pick<World, "x" | "feet" | "vx" | "vy" | "grounded">,
): void {
  let dx = world.vx,
    dy = world.vy;
  world.grounded = false;
  for (let iteration = 0; iteration < 4 && (dx || dy); iteration++) {
    const hit = sweep(world.x, world.feet, dx, dy, true);
    if (!hit) {
      world.x += dx;
      world.feet += dy;
      break;
    }
    world.x += Math.round(dx * hit.time) + hit.nx;
    world.feet += Math.round(dy * hit.time) + hit.ny;
    dx = hit.nx ? 0 : Math.round(dx * (1 - hit.time));
    dy = hit.ny ? 0 : Math.round(dy * (1 - hit.time));
    if (hit.nx) world.vx = 0;
    if (hit.ny) world.vy = 0;
    if (hit.ny === -1) world.grounded = true;
  }
  if (world.x < HALF || world.x > WIDTH * S - HALF) {
    world.x = Math.max(HALF, Math.min(WIDTH * S - HALF, world.x));
    world.vx = 0;
  }
}
export function overlaps(x: number, feet: number): boolean {
  return PLATFORMS.some(
    ([px, py, w, h]) =>
      x + HALF > px * S &&
      x - HALF < (px + w) * S &&
      feet > py * S &&
      feet - BODY < (py + h) * S,
  );
}
/** Player bodies only collide with top faces while crossing downward. Hooks and props retain solid sweeps. */
export function movePlayer(
  world: Pick<World, "x" | "feet" | "vx" | "vy" | "grounded">,
): void {
  let first = Infinity;
  if (world.vy > 0)
    for (const [px, py, width] of PLATFORMS) {
      const time = (py * S - world.feet) / world.vy;
      if (time < 0 || time > 1 || time >= first) continue;
      const x = world.x + world.vx * time;
      if (x + HALF > px * S && x - HALF < (px + width) * S) first = time;
    }
  world.x = Math.max(HALF, Math.min(WIDTH * S - HALF, world.x + world.vx));
  if (world.x === HALF || world.x === WIDTH * S - HALF) world.vx = 0;
  world.feet += Number.isFinite(first)
    ? Math.round(world.vy * first) - 1
    : world.vy;
  world.grounded = Number.isFinite(first) && supported(world.x, world.feet);
  if (Number.isFinite(first)) world.vy = 0;
}
export function supported(x: number, feet: number): boolean {
  return PLATFORMS.some(
    ([px, py, width]) =>
      Math.abs(feet - py * S) <= 1 &&
      x + HALF > px * S &&
      x - HALF < (px + width) * S,
  );
}
