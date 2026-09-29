import { PLATFORMS, S, HALF, BODY, WIDTH, type World } from "./world.js";
import type { Platform } from "./maps.js";
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
  platforms: readonly Platform[] = PLATFORMS,
): Hit | null {
  let hit: Hit | null = null;
  for (let i = 0; i < platforms.length; i++) {
    const [px, py, w, h] = platforms[i]!;
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
  platforms: readonly Platform[] = PLATFORMS,
  width = WIDTH,
): void {
  let dx = world.vx,
    dy = world.vy;
  world.grounded = false;
  for (let iteration = 0; iteration < 4 && (dx || dy); iteration++) {
    const hit = sweep(world.x, world.feet, dx, dy, true, platforms);
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
  if (world.x < HALF || world.x > width * S - HALF) {
    world.x = Math.max(HALF, Math.min(width * S - HALF, world.x));
    world.vx = 0;
  }
}
export function overlaps(
  x: number,
  feet: number,
  platforms: readonly Platform[] = PLATFORMS,
): boolean {
  return platforms.some(
    ([px, py, w, h]) =>
      x + HALF > px * S &&
      x - HALF < (px + w) * S &&
      feet > py * S &&
      feet - BODY < (py + h) * S,
  );
}
/**
 * Keeper movement. One-way ledges (`platforms`) only catch a body crossing
 * their top face downward; solid blocks (12A: walls, pillars, ceilings) stop
 * it on every face through the same swept slab test hooks and props use, so
 * no speed tunnels through a block and a corner resolves to its top or bottom
 * face. Up to four contacts per tick, earliest first; on a tie the block wins.
 * Each contact leaves the body one subunit clear, so it never rests inside a
 * block. With no blocks this is exactly the ledge-only solver of 10A.
 */
export function movePlayer(
  world: Pick<World, "x" | "feet" | "vx" | "vy" | "grounded">,
  platforms: readonly Platform[] = PLATFORMS,
  blocks: readonly Platform[] = [],
  width = WIDTH,
): void {
  let dx = world.vx,
    dy = world.vy,
    landed = false;
  for (let i = 0; i < 4 && (dx || dy); i++) {
    let ledge = Infinity;
    if (dy > 0)
      for (const [px, py, w] of platforms) {
        const time = (py * S - world.feet) / dy;
        if (time < 0 || time > 1 || time >= ledge) continue;
        const x = world.x + dx * time;
        if (x + HALF > px * S && x - HALF < (px + w) * S) ledge = time;
      }
    const hit = blocks.length
      ? sweep(world.x, world.feet, dx, dy, true, blocks)
      : null;
    if (hit && hit.time <= ledge) {
      world.x += Math.round(dx * hit.time) + hit.nx;
      world.feet += Math.round(dy * hit.time) + hit.ny;
      dx = hit.nx ? 0 : Math.round(dx * (1 - hit.time));
      dy = hit.ny ? 0 : Math.round(dy * (1 - hit.time));
      if (hit.nx) world.vx = 0;
      if (hit.ny) world.vy = 0;
      if (hit.ny === -1) landed = true;
      continue;
    }
    if (Number.isFinite(ledge)) {
      const step = Math.round(dx * ledge);
      world.x += step;
      world.feet += Math.round(dy * ledge) - 1;
      dx -= step;
      dy = 0;
      world.vy = 0;
      landed = true;
      continue;
    }
    world.x += dx;
    world.feet += dy;
    break;
  }
  world.x = Math.max(HALF, Math.min(width * S - HALF, world.x));
  if (world.x === HALF || world.x === width * S - HALF) world.vx = 0;
  // Grounded only if still over a top after the whole tick's slide.
  world.grounded =
    landed &&
    (supported(world.x, world.feet, platforms) ||
      supported(world.x, world.feet, blocks));
}
export function supported(
  x: number,
  feet: number,
  platforms: readonly Platform[] = PLATFORMS,
): boolean {
  return platforms.some(
    ([px, py, width]) =>
      Math.abs(feet - py * S) <= 1 &&
      x + HALF > px * S &&
      x - HALF < (px + width) * S,
  );
}
