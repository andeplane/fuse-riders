import {
  BODY,
  HEIGHT,
  S,
  createWorld,
  readyHook,
  resetWorld,
  type World,
} from "./world.js";
import { move, sweep } from "./collision.js";
const approach = (value: number, target: number, change: number) =>
  value < target
    ? Math.min(target, value + change)
    : Math.max(target, value - change);
const length = (x: number, y: number) => Math.sqrt(x * x + y * y);
function grapple(world: World): void {
  const h = world.hook,
    sx = world.x,
    sy = world.feet - Math.round(BODY * 0.6);
  if (!world.input.fire && (h.phase === "flying" || h.phase === "attached")) {
    h.phase = "retracting";
    h.life = 6;
  }
  if (h.phase === "ready" && world.input.fire && !world.previous.fire) {
    const dx = world.input.aimX * S - sx,
      dy = world.input.aimY * S - sy,
      d = length(dx, dy);
    if (d < S) return;
    Object.assign(h, {
      phase: "flying",
      x: sx,
      y: sy,
      vx: Math.round((dx / d) * 20 * S),
      vy: Math.round((dy / d) * 20 * S),
      life: 60,
      distance: 0,
      platform: -1,
    });
  }
  if (h.phase === "flying") {
    const remaining = world.tuning.range * S - h.distance;
    const speed = length(h.vx, h.vy),
      ratio = Math.min(1, remaining / speed);
    const dx = Math.round(h.vx * ratio),
      dy = Math.round(h.vy * ratio);
    const hit = sweep(h.x, h.y, dx, dy);
    if (hit) {
      h.x += Math.round(dx * hit.time) + hit.nx;
      h.y += Math.round(dy * hit.time) + hit.ny;
      h.phase = "attached";
      h.platform = hit.platform;
      h.vx = h.vy = 0;
    } else {
      h.x += dx;
      h.y += dy;
      h.distance += Math.round(length(dx, dy));
      if (--h.life <= 0 || h.distance >= world.tuning.range * S - 1) {
        h.phase = "retracting";
        h.life = 6;
      }
    }
  }
  if (h.phase === "attached") {
    const dx = h.x - sx,
      dy = h.y - sy,
      d = length(dx, dy),
      obstruction = sweep(sx, sy, dx, dy);
    if (
      d > world.tuning.range * S + S ||
      (obstruction && obstruction.time < 0.995)
    ) {
      h.phase = "retracting";
      h.life = 6;
    } else if (d > 26 * S) {
      const force = Math.round((world.tuning.pull * S) / 3600);
      world.vx += Math.round((dx / d) * force);
      world.vy += Math.round((dy / d) * force);
    } else {
      world.vx = Math.round(world.vx * 0.7);
      world.vy = Math.round(world.vy * 0.7);
    }
  }
  if (h.phase === "retracting") {
    h.x += Math.round((sx - h.x) / Math.max(1, h.life));
    h.y += Math.round((sy - h.y) / Math.max(1, h.life));
    if (--h.life <= 0) world.hook = readyHook();
  }
}
export function step(world: World): void {
  world.tick++;
  if (world.input.reset && !world.previous.reset) {
    resetWorld(world);
    return;
  }
  if (world.respawn > 0) {
    if (--world.respawn === 0) resetWorld(world);
    world.previous = { ...world.input };
    return;
  }
  world.coyote = world.grounded ? 6 : Math.max(0, world.coyote - 1);
  world.buffer =
    world.input.jump && !world.previous.jump
      ? 6
      : Math.max(0, world.buffer - 1);
  const target = Math.round((world.input.move * world.tuning.speed * S) / 60);
  const acceleration = Math.round(
    ((2600 * S) / 3600) * (world.grounded ? 1 : world.tuning.air / 100),
  );
  // Released grapple momentum is not instantly replaced with ordinary running speed.
  if (world.input.move || world.grounded)
    world.vx = approach(world.vx, target, acceleration);
  if (world.input.move) world.facing = world.input.move;
  world.vy += Math.round((world.tuning.gravity * S) / 3600);
  if (world.buffer && world.coyote) {
    world.vy = -Math.round((world.tuning.jump * S) / 60);
    world.buffer = world.coyote = 0;
    world.grounded = false;
  }
  if (!world.input.jump && world.previous.jump && world.vy < 0)
    world.vy = Math.round(world.vy * 0.48);
  grapple(world);
  const cap = Math.round((1000 * S) / 60);
  world.vx = Math.max(-cap, Math.min(cap, world.vx));
  world.vy = Math.max(-cap, Math.min(cap, world.vy));
  move(world);
  if (world.feet - BODY > HEIGHT * S) {
    world.respawn = 30;
    world.deaths++;
    world.hook = readyHook();
    world.vx = world.vy = 0;
    world.buffer = world.coyote = 0;
  }
  world.previous = { ...world.input };
}
export function retune(world: World, tuning: World["tuning"]): World {
  return { ...createWorld(tuning), tick: world.tick };
}
