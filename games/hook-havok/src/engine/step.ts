import {
  BODY,
  HALF,
  HOOK_SPEED,
  ROPE_MIN,
  S,
  createWorld,
  readyHook,
  resetWorld,
  type Hook,
  type World,
} from "./world.js";
import { movePlayer, supported, sweep } from "./collision.js";
import { stepCombat, strike, type CombatContext } from "./combat.js";
import { MAPS, blocks, ledges } from "./maps.js";
import { PAD_VY, field, onPad, pull } from "./zones.js";
const approach = (value: number, target: number, change: number) =>
  value < target
    ? Math.min(target, value + change)
    : Math.max(target, value - change);
const length = (x: number, y: number) => Math.sqrt(x * x + y * y);
/** Swing pump while hooked, units/s². */
const PUMP = 1100;
/** Within this many units of the fully reeled length, momentum is absorbed. */
const ARRIVAL = 12;
/** How quickly the reel reaches its speed: 10800 units/s², per tick in subunits. */
const WINCH = 3 * S;
function retract(h: Hook): void {
  h.phase = "retracting";
  h.life = 6;
}
/**
 * Winch rope. The rope never stretches: outward motion stops when it goes
 * taut. Holding the hook reels in, easing towards the anchor, while the swing
 * (gravity, steering, momentum) stays free, so keepers catch and swing instead
 * of sinking. Movement and collision still run afterwards through movePlayer.
 */
function rope(world: World, h: Hook, sx: number, sy: number): void {
  const d = length(sx - h.x, sy - h.y);
  if (!d) return;
  const ux = (sx - h.x) / d,
    uy = (sy - h.y) / d,
    slack = d - ROPE_MIN * S;
  if (world.input.move && !world.grounded) {
    // Steering pumps along the swing, never along the rope.
    const turn = -uy * world.input.move < 0 ? -1 : 1,
      pump = (PUMP * S) / 3600;
    world.vx += Math.round(-uy * turn * pump);
    world.vy += Math.round(ux * turn * pump);
  }
  // The reel eases over its last stretch so arrival does not overshoot.
  const reel = Math.min(
      Math.round((world.tuning.pull * S) / 60),
      Math.max(Math.min(S, slack), slack / 4),
    ),
    radial = world.vx * ux + world.vy * uy;
  let next = approach(Math.min(radial, 0), -Math.max(0, reel), WINCH);
  next = Math.max(next, Math.min(0, -slack));
  world.vx += Math.round(ux * (next - radial));
  world.vy += Math.round(uy * (next - radial));
  h.distance = Math.max(
    ROPE_MIN * S,
    Math.min(h.distance, Math.round(d + next)),
  );
  // Keep the swing on the circle; the radial step above is only first order.
  const px = sx + world.vx - h.x,
    py = sy + world.vy - h.y,
    pd = length(px, py);
  if (pd > h.distance) {
    const k = h.distance / pd;
    world.vx = Math.round(h.x + px * k - sx);
    world.vy = Math.round(h.y + py * k - sy);
  }
  if (slack <= ARRIVAL * S) {
    // Arriving: settle into a hang rather than whirling around the anchor.
    // A rope jump or release leaves from here.
    world.vx = Math.round(world.vx * 0.7);
    world.vy = Math.round(world.vy * 0.7);
  }
}
function grapple(world: World, context?: CombatContext): void {
  const h = world.hook,
    sx = world.x,
    sy = world.feet - Math.round(BODY * 0.6),
    platforms = MAPS[world.tuning.map].platforms;
  if (!world.input.fire && (h.phase === "flying" || h.phase === "attached"))
    retract(h);
  if (h.phase === "ready" && world.input.fire && !world.previous.fire) {
    const dx = world.input.aimX * S - sx,
      dy = world.input.aimY * S - sy,
      d = length(dx, dy);
    if (d < S) return;
    Object.assign(h, {
      phase: "flying",
      x: sx,
      y: sy,
      vx: Math.round((dx / d) * HOOK_SPEED * S),
      vy: Math.round((dy / d) * HOOK_SPEED * S),
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
    const hit = sweep(h.x, h.y, dx, dy, false, platforms);
    if (strike(world, dx, dy, hit?.time, context)) {
      // Entity impacts consume this shot. Retraction below still requires a new press.
    } else if (hit) {
      h.x += Math.round(dx * hit.time) + hit.nx;
      h.y += Math.round(dy * hit.time) + hit.ny;
      h.phase = "attached";
      h.platform = hit.platform;
      h.vx = h.vy = 0;
      // While attached, distance is the rope length, within the bounds the
      // checkpoint decoder accepts even if rope() returns early.
      h.distance = Math.max(
        ROPE_MIN * S,
        Math.min(
          world.tuning.range * S,
          Math.round(length(h.x - sx, h.y - sy)),
        ),
      );
    } else {
      h.x += dx;
      h.y += dy;
      h.distance += Math.round(length(dx, dy));
      if (--h.life <= 0 || h.distance >= world.tuning.range * S - 1) retract(h);
    }
  }
  if (h.phase === "attached") {
    if (length(h.x - sx, h.y - sy) > world.tuning.range * S + S) retract(h);
    else rope(world, h, sx, sy);
  }
  if (h.phase === "retracting") {
    h.x += Math.round((sx - h.x) / Math.max(1, h.life));
    h.y += Math.round((sy - h.y) / Math.max(1, h.life));
    if (--h.life <= 0) world.hook = readyHook();
  }
}
export function step(world: World, context?: CombatContext): void {
  world.tick++;
  if (world.input.reset && !world.previous.reset) {
    resetWorld(world);
    return;
  }
  if (world.respawn > 0) {
    if (--world.respawn === 0) {
      const combat = world.combat;
      resetWorld(world);
      world.combat = combat;
    }
    world.previous = { ...world.input };
    return;
  }
  const map = world.tuning.map,
    entryVy = world.vy;
  // Only a one-way ledge drops a keeper through; a solid block never does.
  const dropping =
    world.input.drop &&
    !world.previous.drop &&
    world.grounded &&
    supported(world.x, world.feet, ledges(map)) &&
    !supported(world.x, world.feet, blocks(map));
  if (dropping) {
    world.feet += 2;
    world.vy = Math.max(world.vy, 2 * S);
    world.grounded = false;
    world.coyote = world.buffer = 0;
    world.hook = readyHook();
  }
  world.coyote = world.grounded ? 6 : Math.max(0, world.coyote - 1);
  world.buffer =
    !dropping && world.input.jump && !world.previous.jump
      ? 6
      : Math.max(0, world.buffer - 1);
  const hooked = world.hook.phase === "attached";
  const target = Math.round((world.input.move * world.tuning.speed * S) / 60);
  const acceleration = Math.round(
    ((2600 * S) / 3600) * (world.grounded ? 1 : world.tuning.air / 100),
  );
  // Swing and knockback momentum is not replaced with ordinary running speed:
  // air steering never brakes a keeper already moving faster the held way.
  const coasting =
    !world.grounded &&
    world.input.move * world.vx > 0 &&
    Math.abs(world.vx) > Math.abs(target);
  if (
    (world.input.move || world.grounded) &&
    (world.grounded || !hooked) &&
    !coasting
  )
    world.vx = approach(world.vx, target, acceleration);
  if (world.input.move) world.facing = world.input.move;
  // Gravity, or a lift beam or the low-gravity wing where the body's centre is (12B).
  world.vy = pull(
    world.vy,
    field(world.tuning, world.x, world.feet - BODY / 2),
    Math.round((world.tuning.gravity * S) / 3600),
  );
  const launch = -Math.round((world.tuning.jump * S) / 60),
    fresh = !dropping && world.input.jump && !world.previous.jump;
  if (world.buffer && world.coyote) {
    world.vy = launch;
    world.buffer = world.coyote = 0;
    world.grounded = false;
    if (hooked) retract(world.hook);
  } else if (fresh && hooked) {
    // Rope jump: let go with a launch that keeps a stronger upward swing, and
    // restore the air-jump reserve.
    world.vy = Math.min(world.vy, launch);
    world.buffer = world.coyote = 0;
    world.airJump = world.tuning.jumpMode === "double";
    retract(world.hook);
  } else if (fresh && world.airJump) {
    world.vy = launch;
    world.airJump = false;
    world.buffer = world.coyote = 0;
  }
  // A held rope's upward swing is not a jump to cut short.
  if (
    !world.input.jump &&
    world.previous.jump &&
    world.vy < 0 &&
    world.hook.phase !== "attached"
  )
    world.vy = Math.round(world.vy * 0.48);
  if (!dropping) grapple(world, context);
  const cap = Math.round((1000 * S) / 60);
  world.vx = Math.max(-cap, Math.min(cap, world.vx));
  // A pad launch is the only rise past the cap at a tick boundary; it may
  // decay under gravity but never grow, so the upward bound follows it down.
  world.vy = Math.max(Math.min(-cap, entryVy), Math.min(cap, world.vy));
  movePlayer(world, ledges(map), blocks(map), MAPS[map].width);
  if (world.hook.phase === "attached") {
    // When the speed cap clips the rope's correction, the rope gives rather
    // than yanking the keeper next tick.
    const h = world.hook,
      d = Math.round(
        length(h.x - world.x, h.y - world.feet + Math.round(BODY * 0.6)),
      );
    if (d > h.distance + S / 8)
      h.distance = Math.min(world.tuning.range * S, d);
    // Landing on the hooked ledge is arrival: the rope lets go. Ledges are
    // one-way for keepers, so the rope may pass through stone on the way.
    const [px, py, width] = MAPS[world.tuning.map].platforms[h.platform]!;
    if (
      world.grounded &&
      Math.abs(world.feet - py * S) <= 1 &&
      world.x + HALF > px * S &&
      world.x - HALF < (px + width) * S
    )
      retract(h);
  }
  if (world.grounded && onPad(world.tuning, world.x, world.feet)) {
    // Touching a pad's top launches at a fixed speed and refills the air jump.
    world.vy = PAD_VY;
    world.grounded = false;
    world.coyote = world.buffer = 0;
    world.airJump = world.tuning.jumpMode === "double";
    if (world.hook.phase === "attached") retract(world.hook);
  }
  if (world.grounded) world.airJump = world.tuning.jumpMode === "double";
  if (world.feet - BODY > MAPS[map].height * S) {
    world.respawn = 30;
    world.deaths++;
    world.hook = readyHook();
    world.vx = world.vy = 0;
    world.buffer = world.coyote = 0;
    world.airJump = false;
    world.charge = 0;
  }
  if (!context) stepCombat(world);
  world.previous = { ...world.input };
}
export function retune(world: World, tuning: World["tuning"]): World {
  return { ...createWorld(tuning), tick: world.tick };
}
