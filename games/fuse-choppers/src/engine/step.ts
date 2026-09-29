import { SUB, clamp, div, isqrt, px, toward, wave } from "./math.js";
import { next } from "./rng.js";
import * as T from "./tuning.js";
import {
  CAMERA_END,
  EXIT_X,
  PICKUP_KINDS,
  SEG,
  ceilingAt,
  floorAt,
  progress,
  sawY,
  segment,
  segmentsNear,
  span,
  type Platform,
} from "./level.js";
import { DOWN, FIRE, LEFT, RIGHT, UP, scrambled } from "./input.js";
import { bumping, shooting } from "./settings.js";
import {
  CAUSES,
  FX,
  rightEdge,
  type Cause,
  type Chopper,
  type World,
} from "./world.js";

/**
 * One simulation step. The order is part of the rules: the camera and the crush zone move first, then every
 * chopper flies and meets the cave, then choppers bump, guns fire, projectiles and enemies move, pickups are
 * taken, timers run down and the round is decided. `inputs` holds each chopper's held bits by id; a missing id
 * holds nothing (so a disconnected chopper falls).
 */
export function stepWorld(
  world: World,
  inputs: ReadonlyMap<string, number>,
): void {
  world.step++;
  for (const chopper of world.choppers) {
    const raw = inputs.get(chopper.id) ?? 0;
    chopper.input = chopper.scramble > 0 ? scrambled(raw) : raw;
  }
  if (world.phase === "countdown") {
    if (world.step >= T.COUNTDOWN_STEPS) {
      world.phase = "play";
      world.phaseAt = world.step;
      world.rockAt = world.step + 480;
    }
    return;
  }
  advanceCamera(world);
  spawnSegments(world);
  crushZone(world);
  for (const chopper of world.choppers)
    if (flying(chopper)) fly(world, chopper);
  if (bumping(world.combat)) bump(world);
  if (shooting(world.combat)) fire(world);
  moveBullets(world);
  moveDrones(world);
  moveBolts(world);
  moveRocks(world);
  collectPickups(world);
  for (const chopper of world.choppers) countDown(chopper);
  world.fx = world.fx.filter((fx) => world.step - fx.at < T.FX_LIFE);
  decide(world);
}

export const flying = (chopper: Chopper): boolean =>
  chopper.alive && !chopper.exited;

/** Steps of play so far: the scroll ramp and the difficulty read this. */
export const played = (world: World): number =>
  Math.max(0, world.step - T.COUNTDOWN_STEPS);

function random(world: World, n: number): number {
  const { value, state } = next(world.rng);
  world.rng = state;
  return n > 0 ? value % n : 0;
}
const between = (world: World, low: number, high: number) =>
  low + random(world, high - low + 1);

function effect(
  world: World,
  kind: number,
  x: number,
  y: number,
  slot = -1,
  data = 0,
): void {
  world.fx.push({ id: world.nextId++, at: world.step, kind, x, y, slot, data });
  if (world.fx.length > T.MAX_FX)
    world.fx.splice(0, world.fx.length - T.MAX_FX);
}

function advanceCamera(world: World): void {
  const end = CAMERA_END * SUB;
  if (world.camX < end) {
    const speed = Math.min(
      T.SCROLL_MAX,
      T.SCROLL_START +
        div(
          (T.SCROLL_MAX - T.SCROLL_START) * played(world),
          T.SCROLL_RAMP_STEPS,
        ),
    );
    world.scroll = Math.min(speed, end - world.camX);
    world.camX += world.scroll;
    world.crushX += world.scroll + T.CRUSH_GROW;
  } else {
    world.scroll = 0;
    world.crushX += T.CRUSH_FINALE;
  }
}

const LAST_SEGMENT = Math.ceil(EXIT_X / SEG);
function spawnSegments(world: World): void {
  while (
    world.segment <= LAST_SEGMENT &&
    world.segment * SEG * SUB < world.camX + (T.VIEW_W + 200) * SUB
  ) {
    for (const spawn of segment(world.seed, world.segment).spawns) {
      if (spawn.kind === "drone") {
        if (world.drones.length < T.MAX_DRONES)
          world.drones.push({
            id: world.nextId++,
            x: spawn.x * SUB,
            y: spawn.y * SUB,
            baseY: spawn.y * SUB,
            hp: T.DRONE_HP,
            cool: between(world, 40, 110),
            charge: 0,
            phase: between(world, 0, 159),
          });
      } else if (
        world.powerUps &&
        (spawn.kind !== "triple" || shooting(world.combat)) &&
        world.pickups.length < T.MAX_PICKUPS
      )
        world.pickups.push({
          id: world.nextId++,
          kind: PICKUP_KINDS.indexOf(spawn.kind),
          x: spawn.x * SUB,
          y: spawn.y * SUB,
        });
    }
    world.segment++;
  }
}

/** The crush zone warns, then throws a rock into the field; the throws come faster the deeper the cave. */
function crushZone(world: World): void {
  if (world.phase === "play" && world.step >= world.rockAt) {
    const x = world.crushX + px(10),
      top = ceilingAt(world.seed, x) + px(36),
      bottom = floorAt(world.seed, x) - px(36);
    if (bottom > top && world.warnings.length < T.MAX_ROCKS)
      world.warnings.push({
        id: world.nextId++,
        y: top + random(world, bottom - top),
        at: world.step + T.ROCK_WARNING_STEPS,
      });
    const depth = progress(div(world.camX, SUB));
    world.rockAt =
      world.step + 280 - div(depth * 120, 1000) + between(world, -40, 40);
  }
  for (const warning of world.warnings.filter((w) => w.at <= world.step)) {
    if (world.rocks.length < T.MAX_ROCKS)
      world.rocks.push({
        id: world.nextId++,
        x: world.crushX + px(6),
        y: warning.y,
        vx: world.scroll + between(world, px(2.4), px(3.6)),
        vy: between(world, -px(1.6), px(0.4)),
        r: between(world, px(10), px(14)),
        life: T.ROCK_LIFE,
      });
  }
  world.warnings = world.warnings.filter((w) => w.at > world.step);
}

/** Circle against an axis-aligned box given by centre and half sizes. */
function circleBox(
  cx: number,
  cy: number,
  r: number,
  bx: number,
  by: number,
  hw: number,
  hh: number,
): boolean {
  const qx = clamp(cx, bx - hw, bx + hw),
    qy = clamp(cy, by - hh, by + hh),
    dx = cx - qx,
    dy = cy - qy;
  return dx * dx + dy * dy < r * r;
}
const platformBox = (platform: Platform) => ({
  x0: platform.x * SUB,
  x1: (platform.x + platform.w) * SUB,
  y0: platform.y * SUB,
  y1: (platform.y + platform.h) * SUB,
});

/** A contact that would kill: a shield turns it into a bounce, and grace after that ignores it. True if it died. */
function hurt(world: World, chopper: Chopper, cause: Cause): boolean {
  // Once the round is decided the outro is a victory lap: contacts push, nobody dies and the result stands.
  if (chopper.grace > 0 || world.phase === "outro") return false;
  if (chopper.shield > 0) {
    chopper.shield = 0;
    chopper.grace = T.SHIELD_GRACE;
    effect(world, FX.shieldPop, chopper.x, chopper.y, chopper.slot);
    return false;
  }
  chopper.alive = false;
  chopper.endedAt = world.step;
  chopper.cause = CAUSES.indexOf(cause);
  chopper.landed = false;
  effect(world, FX.explode, chopper.x, chopper.y, chopper.slot);
  return true;
}

function fly(world: World, chopper: Chopper): void {
  const bits = chopper.input,
    stunned = chopper.stun > 0;
  if (
    !chopper.engaged &&
    (bits & (UP | DOWN) || played(world) >= T.START_HOVER)
  )
    chopper.engaged = true;
  if (!chopper.engaged) chopper.vy -= div(chopper.vy, 4);
  else if (world.lift === "classic") {
    if (bits & UP) {
      let lift = chopper.turbo > 0 ? div(T.LIFT * 1150, 1000) : T.LIFT;
      if (stunned) lift = div(lift * T.STUN_LIFT, 1000);
      chopper.vy -= lift;
      chopper.landed = false;
    }
    chopper.vy = clamp(chopper.vy + T.GRAVITY, -T.MAX_RISE, T.MAX_FALL);
  } else {
    const thrust = stunned ? div(T.THRUST * T.STUN_LIFT, 1000) : T.THRUST,
      up = (bits & UP) !== 0,
      down = (bits & DOWN) !== 0;
    if (up && !down) {
      chopper.vy -= thrust;
      chopper.landed = false;
    } else if (down && !up) chopper.vy += thrust;
    else chopper.vy -= div(chopper.vy, 8);
    chopper.vy = clamp(
      chopper.vy + T.THRUST_GRAVITY,
      -T.THRUST_MAX,
      T.THRUST_MAX,
    );
  }
  // A knocked chopper wobbles, which is what makes a nudge dangerous near the rock.
  if (stunned)
    chopper.vx += div(wave(world.step + chopper.slot * 5, 16) * px(0.2), 1000);
  const dir = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0),
    max = chopper.turbo > 0 ? T.TURBO_AIRSPEED : T.MAX_AIRSPEED,
    accel = stunned ? div(T.H_ACCEL * T.STUN_STEER, 1000) : T.H_ACCEL,
    target = dir * max;
  if (dir) chopper.face = dir as 1 | -1;
  if (chopper.vx < target)
    chopper.vx = Math.min(target, chopper.vx + (dir > 0 ? accel : T.H_DRAG));
  else if (chopper.vx > target)
    chopper.vx = Math.max(target, chopper.vx - (dir < 0 ? accel : T.H_DRAG));

  const lastY = chopper.y;
  chopper.x += world.scroll + chopper.vx;
  chopper.y += chopper.vy;
  const right = rightEdge(world) - T.RIGHT_MARGIN;
  if (chopper.x > right) {
    chopper.x = right;
    if (chopper.vx > 0) chopper.vx = 0;
  }
  if (chopper.x + T.CHOPPER_HW >= EXIT_X * SUB) {
    chopper.exited = true;
    chopper.endedAt = world.step;
    chopper.landed = false;
    effect(world, FX.exit, chopper.x, chopper.y, chopper.slot);
    return;
  }

  const hw = T.CHOPPER_HW,
    hh = T.CHOPPER_HH,
    x0 = chopper.x - hw,
    x1 = chopper.x + hw;
  // The crush zone.
  if (x0 < world.crushX) {
    if (hurt(world, chopper, "crush")) return;
    chopper.x = world.crushX + hw + px(30);
    chopper.vx = px(4);
  }
  // The cave's rock.
  const open = span(world.seed, x0, x1);
  if (chopper.y - hh < open.ceiling) {
    if (hurt(world, chopper, "wall")) return;
    chopper.y = open.ceiling + hh + px(2);
    chopper.vy = Math.max(chopper.vy, px(2.5));
  } else if (chopper.y + hh > open.floor) {
    if (hurt(world, chopper, "wall")) return;
    chopper.y = open.floor - hh - px(2);
    chopper.vy = Math.min(chopper.vy, -px(3.5));
  }
  let standing = false;
  for (const part of segmentsNear(world.seed, div(x0, SUB), div(x1, SUB) + 1)) {
    // Floating rocks: a landing pad on top, deadly anywhere else.
    for (const platform of part.platforms) {
      const box = platformBox(platform);
      if (
        x1 <= box.x0 ||
        x0 >= box.x1 ||
        chopper.y + hh <= box.y0 ||
        chopper.y - hh >= box.y1
      )
        continue;
      if (lastY + hh <= box.y0 + px(1) && chopper.vy >= 0) {
        chopper.y = box.y0 - hh;
        chopper.vy = 0;
        standing = true;
        continue;
      }
      if (hurt(world, chopper, "platform")) return;
      if (lastY - hh >= box.y1 - px(1)) {
        chopper.y = box.y1 + hh + px(2);
        chopper.vy = px(2.5);
      } else {
        const left = chopper.x * 2 < box.x0 + box.x1;
        chopper.x = left ? box.x0 - hw - px(2) : box.x1 + hw + px(2);
        chopper.vx = left ? -px(3) : px(3);
      }
    }
    for (const saw of part.saws) {
      const cx = saw.x * SUB,
        cy = sawY(saw, world.step) * SUB,
        r = (saw.r - 3) * SUB;
      if (!circleBox(cx, cy, r, chopper.x, chopper.y, hw, hh)) continue;
      if (hurt(world, chopper, "saw")) return;
      const away = toward(chopper.x - cx, chopper.y - cy, px(4));
      chopper.vx = away.x;
      chopper.vy = away.y;
    }
  }
  chopper.landed = standing;
}

/** Choppers that touch bounce apart: the closing speed is returned with interest, so a ram is a weapon. */
function bump(world: World): void {
  const live = world.choppers.filter(flying),
    reach = 2 * T.BUMP_R;
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!,
        b = live[j]!,
        dx = b.x - a.x,
        dy = b.y - a.y,
        d2 = dx * dx + dy * dy;
      if (d2 >= reach * reach) continue;
      const n = toward(dx, dy, 1024),
        overlap = reach - isqrt(d2),
        sx = div(n.x * overlap, 2048),
        sy = div(n.y * overlap, 2048);
      a.x -= sx;
      a.y -= sy;
      b.x += sx;
      b.y += sy;
      const closing = div((a.vx - b.vx) * n.x + (a.vy - b.vy) * n.y, 1024);
      if (closing <= 0) continue;
      const impulse = div(closing * 9, 10) + T.BUMP_PUSH;
      a.vx -= div(n.x * impulse, 1024);
      a.vy -= div(n.y * impulse, 1024);
      b.vx += div(n.x * impulse, 1024);
      b.vy += div(n.y * impulse, 1024);
      for (const chopper of [a, b]) {
        chopper.stun = Math.max(chopper.stun, T.BUMP_STUN);
        chopper.landed = false;
        chopper.bumps++;
      }
      effect(world, FX.bump, (a.x + b.x) >> 1, (a.y + b.y) >> 1);
    }
}

function fire(world: World): void {
  for (const chopper of world.choppers) {
    if (!flying(chopper) || !(chopper.input & FIRE) || chopper.cool > 0)
      continue;
    chopper.cool = chopper.triple > 0 ? T.TRIPLE_COOLDOWN : T.FIRE_COOLDOWN;
    const spread = chopper.triple > 0 ? [-px(1.2), 0, px(1.2)] : [0];
    for (const vy of spread) {
      if (world.bullets.length >= T.MAX_BULLETS) break;
      world.bullets.push({
        id: world.nextId++,
        owner: chopper.slot,
        x: chopper.x + chopper.face * px(26),
        y: chopper.y + px(5),
        vx: world.scroll + chopper.vx + chopper.face * T.BULLET_SPEED,
        vy,
        life: T.BULLET_LIFE,
      });
    }
  }
}

/** Whether a point falls inside the cave's rock or a floating platform. */
function solid(world: World, x: number, y: number, r = 0): boolean {
  if (y - r < ceilingAt(world.seed, x) || y + r > floorAt(world.seed, x))
    return true;
  for (const part of segmentsNear(
    world.seed,
    div(x - r, SUB),
    div(x + r, SUB) + 1,
  ))
    for (const platform of part.platforms) {
      const box = platformBox(platform);
      if (
        circleBox(
          x,
          y,
          Math.max(r, 1),
          (box.x0 + box.x1) >> 1,
          (box.y0 + box.y1) >> 1,
          (box.x1 - box.x0) >> 1,
          (box.y1 - box.y0) >> 1,
        )
      )
        return true;
    }
  return false;
}

const onScreen = (world: World, x: number, margin: number) =>
  x > world.camX - margin && x < rightEdge(world) + margin;

function moveBullets(world: World): void {
  world.bullets = world.bullets.filter((bullet) => {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    if (--bullet.life <= 0 || !onScreen(world, bullet.x, px(40))) return false;
    if (solid(world, bullet.x, bullet.y)) {
      effect(world, FX.spark, bullet.x, bullet.y, bullet.owner);
      return false;
    }
    const owner = world.choppers.find((c) => c.slot === bullet.owner);
    for (const target of world.choppers) {
      if (
        target.slot === bullet.owner ||
        !flying(target) ||
        !circleBox(
          bullet.x,
          bullet.y,
          T.BULLET_R,
          target.x,
          target.y,
          T.CHOPPER_HW,
          T.CHOPPER_HH,
        )
      )
        continue;
      // A nudge, never a kill: the push and the wobble do the damage.
      target.vx += (bullet.vx - world.scroll >= 0 ? 1 : -1) * T.BULLET_PUSH;
      target.vy += (bullet.id % 2 ? -1 : 1) * T.BULLET_LIFT_PUSH;
      target.stun = Math.max(target.stun, T.BULLET_STUN);
      target.landed = false;
      if (owner) owner.hits++;
      effect(world, FX.hit, bullet.x, bullet.y, target.slot);
      return false;
    }
    for (const drone of world.drones) {
      // A drone downed by an earlier bullet this step takes no more hits (and no more credit).
      if (drone.hp <= 0) continue;
      if (
        !circleBox(
          bullet.x,
          bullet.y,
          T.BULLET_R,
          drone.x,
          drone.y,
          T.DRONE_HW,
          T.DRONE_HH,
        )
      )
        continue;
      drone.hp--;
      if (drone.hp <= 0) {
        if (owner) owner.downed++;
        effect(world, FX.droneDown, drone.x, drone.y, bullet.owner);
      } else effect(world, FX.droneHit, bullet.x, bullet.y, bullet.owner);
      return false;
    }
    return true;
  });
  world.drones = world.drones.filter((drone) => drone.hp > 0);
}

function moveDrones(world: World): void {
  const depth = progress(div(world.camX, SUB));
  world.drones = world.drones.filter((drone) => {
    drone.x -= T.DRONE_DRIFT;
    drone.y =
      drone.baseY + div(wave(world.step + drone.phase, 160) * px(22), 1000);
    if (drone.x - T.DRONE_HW < world.crushX) {
      effect(world, FX.droneDown, drone.x, drone.y);
      return false;
    }
    if (drone.x < world.camX - px(60)) return false;
    const inView =
      drone.x < rightEdge(world) - px(30) && drone.x > world.camX + px(40);
    if (inView && world.phase === "play") {
      if (drone.charge > 0) {
        if (--drone.charge === 0) shootBolt(world, drone.x, drone.y);
      } else if (--drone.cool <= 0) {
        drone.charge = T.DRONE_CHARGE;
        drone.cool = between(world, 100, 150) - div(depth * 40, 1000);
      }
    }
    for (const chopper of world.choppers) {
      if (
        !flying(chopper) ||
        chopper.stun >= 10 ||
        Math.abs(chopper.x - drone.x) >= T.CHOPPER_HW + T.DRONE_HW ||
        Math.abs(chopper.y - drone.y) >= T.CHOPPER_HH + T.DRONE_HH
      )
        continue;
      chopper.vx += (chopper.x >= drone.x ? 1 : -1) * px(3);
      chopper.vy += (chopper.y >= drone.y ? 1 : -1) * px(2);
      chopper.stun = 24;
      chopper.landed = false;
      effect(world, FX.bump, chopper.x, chopper.y, chopper.slot);
    }
    return true;
  });
}

function shootBolt(world: World, x: number, y: number): void {
  let target: Chopper | undefined,
    best = Infinity;
  for (const chopper of world.choppers) {
    if (!flying(chopper)) continue;
    const dx = chopper.x - x,
      dy = chopper.y - y,
      d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      target = chopper;
    }
  }
  if (!target || world.bolts.length >= T.MAX_BOLTS) return;
  const aim = toward(target.x - x, target.y - y, T.BOLT_SPEED);
  world.bolts.push({
    id: world.nextId++,
    x: x - px(18),
    y: y + px(4),
    vx: world.scroll + aim.x,
    vy: aim.y,
    life: T.BOLT_LIFE,
  });
  effect(world, FX.bolt, x - px(18), y + px(4));
}

function moveBolts(world: World): void {
  world.bolts = world.bolts.filter((bolt) => {
    bolt.x += bolt.vx;
    bolt.y += bolt.vy;
    if (--bolt.life <= 0 || !onScreen(world, bolt.x, px(40))) return false;
    if (solid(world, bolt.x, bolt.y)) {
      effect(world, FX.spark, bolt.x, bolt.y);
      return false;
    }
    for (const chopper of world.choppers) {
      if (
        !flying(chopper) ||
        !circleBox(
          bolt.x,
          bolt.y,
          T.BOLT_R,
          chopper.x,
          chopper.y,
          T.CHOPPER_HW,
          T.CHOPPER_HH,
        )
      )
        continue;
      const push = toward(bolt.vx - world.scroll, bolt.vy, T.BOLT_PUSH);
      chopper.vx += push.x;
      chopper.vy += push.y;
      chopper.stun = Math.max(chopper.stun, T.BOLT_STUN);
      chopper.landed = false;
      effect(world, FX.hit, bolt.x, bolt.y, chopper.slot);
      return false;
    }
    return true;
  });
}

function moveRocks(world: World): void {
  world.rocks = world.rocks.filter((rock) => {
    rock.vy += T.ROCK_GRAVITY;
    rock.x += rock.vx;
    rock.y += rock.vy;
    if (--rock.life <= 0 || rock.x > rightEdge(world) + px(60)) return false;
    if (solid(world, rock.x, rock.y, rock.r)) {
      effect(world, FX.shatter, rock.x, rock.y);
      return false;
    }
    for (const chopper of world.choppers) {
      if (
        !flying(chopper) ||
        !circleBox(
          rock.x,
          rock.y,
          rock.r,
          chopper.x,
          chopper.y,
          T.CHOPPER_HW,
          T.CHOPPER_HH,
        )
      )
        continue;
      if (!hurt(world, chopper, "rock")) {
        const away = toward(chopper.x - rock.x, chopper.y - rock.y, px(4));
        chopper.vx += away.x;
        chopper.vy += away.y;
      }
      effect(world, FX.shatter, rock.x, rock.y);
      return false;
    }
    return true;
  });
}

function collectPickups(world: World): void {
  world.pickups = world.pickups.filter((pickup) => {
    if (pickup.x < world.crushX) return false;
    for (const chopper of world.choppers) {
      if (
        !flying(chopper) ||
        !circleBox(
          pickup.x,
          pickup.y,
          T.PICKUP_R,
          chopper.x,
          chopper.y,
          T.CHOPPER_HW,
          T.CHOPPER_HH,
        )
      )
        continue;
      chopper.pickups++;
      effect(world, FX.pickup, pickup.x, pickup.y, chopper.slot, pickup.kind);
      powerUp(world, chopper, PICKUP_KINDS[pickup.kind]!);
      return false;
    }
    return true;
  });
}

function powerUp(
  world: World,
  chopper: Chopper,
  kind: (typeof PICKUP_KINDS)[number],
): void {
  switch (kind) {
    case "shield":
      chopper.shield = 1;
      return;
    case "triple":
      chopper.triple = T.TRIPLE_STEPS;
      return;
    case "turbo":
      chopper.turbo = T.TURBO_STEPS;
      return;
    case "scramble":
      for (const other of world.choppers)
        if (other !== chopper && flying(other)) {
          other.scramble = T.SCRAMBLE_STEPS;
          effect(world, FX.scramble, other.x, other.y, other.slot);
        }
      return;
    case "shock": {
      effect(world, FX.shock, chopper.x, chopper.y, chopper.slot);
      const radius = T.SHOCK_RADIUS,
        inside = (x: number, y: number) => {
          const dx = x - chopper.x,
            dy = y - chopper.y;
          return dx * dx + dy * dy < radius * radius;
        };
      for (const other of world.choppers) {
        if (other === chopper || !flying(other) || !inside(other.x, other.y))
          continue;
        const dx = other.x - chopper.x,
          dy = other.y - chopper.y,
          distance = isqrt(dx * dx + dy * dy),
          strength = div(
            T.SHOCK_PUSH * (1000 - div(600 * distance, radius)),
            1000,
          ),
          push = toward(dx, dy, strength);
        other.vx += push.x;
        other.vy += push.y;
        other.stun = Math.max(other.stun, T.SHOCK_STUN);
        other.landed = false;
      }
      world.bolts = world.bolts.filter((bolt) => !inside(bolt.x, bolt.y));
      world.rocks = world.rocks.filter((rock) => {
        if (!inside(rock.x, rock.y)) return true;
        effect(world, FX.shatter, rock.x, rock.y);
        return false;
      });
      return;
    }
  }
}

function countDown(chopper: Chopper): void {
  if (chopper.stun > 0) chopper.stun--;
  if (chopper.grace > 0) chopper.grace--;
  if (chopper.cool > 0) chopper.cool--;
  if (chopper.triple > 0) chopper.triple--;
  if (chopper.turbo > 0) chopper.turbo--;
  if (chopper.scramble > 0) chopper.scramble--;
}

/**
 * The round ends when a chopper reaches the exit (the furthest one that step, then the lower seat), or when one
 * chopper is left flying (none: a draw). A chopper alone in the cave plays until it crashes or escapes.
 */
function decide(world: World): void {
  if (world.winner !== null || world.phase !== "play") return;
  const escaped = world.choppers
    .filter((c) => c.exited && c.endedAt === world.step)
    .sort((a, b) => b.x - a.x || a.slot - b.slot);
  const still = world.choppers.filter(flying);
  if (escaped[0]) finish(world, escaped[0].id);
  else if (world.choppers.length > 1 ? still.length <= 1 : still.length === 0)
    finish(world, still[0]?.id ?? "");
}
function finish(world: World, winner: string): void {
  world.winner = winner;
  world.phase = "outro";
  world.phaseAt = world.step;
}

/** The round is over and its outro has played. */
export const roundDone = (world: World): boolean =>
  world.phase === "outro" && world.step - world.phaseAt >= T.OUTRO_STEPS;
