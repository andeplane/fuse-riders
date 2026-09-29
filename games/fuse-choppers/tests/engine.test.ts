import test from "node:test";
import assert from "node:assert/strict";
import {
  DOWN,
  FIRE,
  LEFT,
  RIGHT,
  UP,
  botInput,
  createWorld,
  encodeWorld,
  roundDone,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { SUB, px } from "../src/engine/math.js";
import {
  CAMERA_END,
  EXIT_X,
  PICKUP_KINDS,
  SEG,
  sawY,
  segment,
  span,
  type PickupKind,
} from "../src/engine/level.js";
import * as T from "../src/engine/tuning.js";
import {
  CLASSIC,
  HOVER,
  at,
  held,
  place,
  playing,
  steps,
} from "./fixtures/world.js";

/** No rocks, drones, pickups or shots, and no more spawns: one mechanic at a time. */
function quiet(world: World): World {
  world.rocks = [];
  world.warnings = [];
  world.drones = [];
  world.pickups = [];
  world.bullets = [];
  world.bolts = [];
  world.rockAt = 1e9;
  world.segment = 1000;
  return world;
}
const chopper = (world: World, id = "c0") =>
  world.choppers.find((c) => c.id === id)!;

function findSegment(
  seed: number,
  has: (s: ReturnType<typeof segment>) => boolean,
) {
  for (let s = 0; s < 20; s++)
    if (has(segment(seed, s))) return segment(seed, s);
  throw new Error("no such segment");
}

test("the countdown holds everyone still, then the cave starts to scroll", () => {
  const world = createWorld(7, [{ id: "c0", slot: 0 }], CLASSIC);
  const start = { ...world.choppers[0]! };
  for (let i = 0; i < T.COUNTDOWN_STEPS - 1; i++)
    stepWorld(world, held({ c0: UP | RIGHT }));
  assert.equal(world.phase, "countdown");
  assert.equal(world.choppers[0]!.y, start.y);
  assert.equal(world.camX, 0);
  stepWorld(world, new Map());
  assert.equal(world.phase, "play");
  stepWorld(world, new Map());
  assert.equal(world.scroll, T.SCROLL_START);
  assert.equal(world.camX, T.SCROLL_START);
});

test("at GO a chopper hovers until its pilot first climbs, or two seconds pass", () => {
  const world = quiet(playing(2));
  for (const c of world.choppers) c.engaged = false;
  const [ready, asleep] = world.choppers,
    y = asleep!.y;
  steps(world, 30, held({ c0: UP }));
  assert.ok(ready!.engaged && ready!.vy < 0, "lift engages it");
  assert.ok(!asleep!.engaged);
  assert.ok(Math.abs(asleep!.y - y) < px(1), "the other hovers");
  steps(world, T.START_HOVER);
  assert.ok(asleep!.engaged, "and falls in the end");
  assert.ok(asleep!.vy > 0);
});

test("classic: holding lift climbs, letting go falls, both capped", () => {
  const world = quiet(playing(1));
  place(world, "c0", 240, 440);
  const c = chopper(world);
  let before = c.vy;
  stepWorld(world, held({ c0: UP }));
  assert.equal(c.vy, before - T.LIFT + T.GRAVITY, "lift beats gravity");
  steps(world, 26, held({ c0: UP }));
  assert.equal(c.vy, -T.MAX_RISE, "climb rate capped");
  before = c.vy;
  stepWorld(world, new Map());
  assert.equal(c.vy, before + T.GRAVITY, "let go and it falls");
  assert.ok(c.alive);
});

test("the thrust trial: W climbs, S dives, and neither hovers", () => {
  const world = quiet(playing(1, HOVER));
  const c = chopper(world);
  stepWorld(world, held({ c0: UP }));
  assert.equal(c.vy, -T.THRUST + T.THRUST_GRAVITY);
  steps(world, 5, held({ c0: DOWN }));
  assert.ok(c.vy > 0, "S dives");
  steps(world, 120);
  assert.ok(Math.abs(c.vy) <= px(0.12), "neither key: it settles into a hover");
  steps(world, 5, held({ c0: UP | DOWN }));
  assert.ok(Math.abs(c.vy) <= px(0.2), "both keys cancel");
});

test("A and D fly back and forth against the scroll; the camera's right edge holds a chopper", () => {
  const world = quiet(playing(1, HOVER));
  const c = chopper(world);
  stepWorld(world, held({ c0: RIGHT }));
  assert.equal(c.vx, T.H_ACCEL);
  assert.equal(c.face, 1);
  steps(world, 60, held({ c0: RIGHT }));
  assert.equal(c.vx, T.MAX_AIRSPEED);
  steps(world, 400, held({ c0: RIGHT }));
  assert.equal(c.x, world.camX + T.VIEW_W * SUB - T.RIGHT_MARGIN);
  steps(world, 3, held({ c0: LEFT }));
  assert.equal(c.face, -1);
  assert.ok(c.vx < 0);
  steps(world, 60);
  assert.equal(c.vx, 0, "drag brings it back to the scroll's speed");
});

test("the cave's rock kills; a shield turns one crash into a bounce and a moment's grace", () => {
  const world = quiet(playing(1));
  const c = chopper(world);
  const open = span(world.seed, c.x - T.CHOPPER_HW, c.x + T.CHOPPER_HW);
  c.shield = 1;
  c.y = open.ceiling + T.CHOPPER_HH + px(2);
  c.vy = -T.MAX_RISE;
  stepWorld(world, held({ c0: UP }));
  assert.ok(c.alive, "the shield took it");
  assert.equal(c.shield, 0);
  assert.equal(c.grace, T.SHIELD_GRACE - 1);
  assert.ok(c.vy > 0, "bounced off the ceiling");
  assert.ok(
    world.fx.some((fx) => fx.kind === 2),
    "a shield pop to draw",
  );
  steps(world, T.SHIELD_GRACE);
  c.y = open.floor - T.CHOPPER_HH - px(1);
  c.vy = T.MAX_FALL;
  stepWorld(world, new Map());
  assert.equal(c.alive, false);
  assert.equal(c.cause, 0, "wall");
  assert.ok(c.endedAt > 0);
});

test("the crush zone kills whoever it reaches", () => {
  const world = quiet(playing(2, HOVER));
  const [a, b] = world.choppers;
  a!.x = world.crushX + T.CHOPPER_HW + px(3);
  b!.shield = 1;
  b!.x = world.crushX + T.CHOPPER_HW + px(3);
  steps(world, 20, held({ c0: LEFT, c1: LEFT }));
  assert.equal(a!.alive, false);
  assert.equal(a!.cause, 1, "crush");
  assert.ok(b!.alive, "a shield throws you back out");
  assert.ok(b!.x > world.crushX + T.CHOPPER_HW);
});

test("a floating platform is a landing pad on top and deadly from the side", () => {
  const seed = 7,
    part = findSegment(seed, (s) => s.platforms.length > 0),
    p = part.platforms[0]!;
  const world = quiet(playing(2, CLASSIC, seed));
  place(world, "c0", p.x + p.w / 2, p.y - 24);
  place(world, "c1", p.x - 30, p.y + p.h / 2);
  const [top, side] = world.choppers;
  side!.vx = T.MAX_AIRSPEED;
  let landed = false;
  for (let i = 0; i < 30 && !landed; i++) {
    stepWorld(world, held({ c1: RIGHT | UP }));
    landed = top!.landed;
  }
  assert.ok(landed, "it set down");
  assert.ok(top!.alive);
  assert.equal(top!.y, p.y * SUB - T.CHOPPER_HH);
  assert.equal(top!.vy, 0);
  stepWorld(world, new Map());
  assert.ok(top!.landed && top!.alive, "and stays down");
  steps(world, 30, held({ c1: RIGHT }));
  assert.equal(side!.alive, false);
  assert.equal(side!.cause, 4, "platform");
  stepWorld(world, held({ c0: UP }));
  assert.equal(top!.landed, false, "lift takes off again");
});

test("a saw blade kills", () => {
  const seed = 7,
    saw = findSegment(seed, (s) => s.saws.length > 0).saws[0]!;
  const world = quiet(playing(1, HOVER, seed));
  place(world, "c0", saw.x, sawY(saw, world.step + 1));
  stepWorld(world, new Map());
  assert.equal(chopper(world).alive, false);
  assert.equal(chopper(world).cause, 2, "saw");
});

test("a shot nudges a rival and knocks it about, but never kills it", () => {
  const world = quiet(playing(2, HOVER));
  place(world, "c0", 300, 250);
  place(world, "c1", 430, 250);
  const [shooter, target] = world.choppers;
  let hitAt = -1;
  for (let i = 0; i < 40 && hitAt < 0; i++) {
    stepWorld(world, held({ c0: FIRE }));
    if (target!.stun > 0) hitAt = i;
  }
  assert.ok(hitAt > 0, "the shot landed");
  assert.ok(target!.alive);
  assert.ok(target!.vx > 0, "pushed along the shot");
  assert.equal(shooter!.hits, 1);
  assert.equal(shooter!.cool > 0, true, "the gun cools down between shots");
  // Stunned, its lift is weaker: the same held lift climbs less.
  const vy = target!.vy;
  stepWorld(world, held({ c1: UP }));
  assert.equal(
    target!.vy - vy,
    -Math.trunc((T.THRUST * T.STUN_LIFT) / 1000) + T.THRUST_GRAVITY,
  );
});

test("with shots off the trigger does nothing; with bumps off choppers pass through each other", () => {
  const world = quiet(playing(2, { ...HOVER, combat: "bump" }));
  place(world, "c0", 300, 250);
  steps(world, 30, held({ c0: FIRE }));
  assert.equal(world.bullets.length, 0);
  const ghost = quiet(playing(2, { ...HOVER, combat: "shoot" }));
  place(ghost, "c0", 300, 250);
  place(ghost, "c1", 310, 250);
  stepWorld(ghost, new Map());
  assert.equal(ghost.choppers[1]!.bumps, 0);
});

test("choppers that touch bounce apart, both shaken, both flying", () => {
  const world = quiet(playing(2, HOVER));
  place(world, "c0", 300, 250);
  place(world, "c1", 330, 250);
  const [a, b] = world.choppers;
  a!.vx = px(2.5);
  stepWorld(world, new Map());
  assert.ok(a!.vx < 0 && b!.vx > 0, "they bounce");
  assert.ok(b!.x - a!.x >= 2 * T.BUMP_R - px(4), "and separate");
  assert.equal(a!.bumps, 1);
  assert.equal(b!.bumps, 1);
  assert.ok(a!.stun > 0 && b!.stun > 0);
  assert.ok(a!.alive && b!.alive);
});

test("a drone charges, fires a bolt that nudges, and three hits bring it down", () => {
  const world = quiet(playing(1, HOVER));
  place(world, "c0", 400, 250);
  world.drones.push({
    id: world.nextId++,
    x: world.camX + px(700),
    y: px(250),
    baseY: px(250),
    hp: T.DRONE_HP,
    cool: 1,
    charge: 0,
    phase: 0,
  });
  stepWorld(world, new Map());
  assert.equal(
    world.drones[0]!.charge,
    T.DRONE_CHARGE,
    "the eye lights up first",
  );
  steps(world, T.DRONE_CHARGE);
  assert.equal(world.bolts.length, 1, "then it fires");
  const c = chopper(world);
  for (let i = 0; i < 200 && c.stun === 0; i++) stepWorld(world, new Map());
  assert.ok(c.stun > 0, "the bolt nudged");
  assert.ok(c.alive, "and did not kill");
  assert.ok(c.vx < 0, "pushed back toward the crush zone");
  world.drones[0]!.cool = 1000;
  c.stun = 0;
  for (let i = 0; i < 300 && world.drones.length; i++) {
    place(world, "c0", at(world.drones[0]!.x) - 200, at(world.drones[0]!.y));
    stepWorld(world, held({ c0: FIRE }));
  }
  assert.equal(world.drones.length, 0);
  assert.equal(c.downed, 1);
});

test("the crush zone warns, then throws a rock; a rock kills", () => {
  const world = quiet(playing(2, HOVER));
  world.rockAt = world.step + 1;
  stepWorld(world, new Map());
  assert.equal(world.warnings.length, 1);
  assert.equal(world.rocks.length, 0);
  steps(world, T.ROCK_WARNING_STEPS);
  assert.equal(world.warnings.length, 0);
  assert.equal(world.rocks.length, 1);
  const rock = world.rocks[0]!;
  assert.ok(rock.vx > world.scroll, "it flies into the field");
  world.rocks = [];
  world.rockAt = 1e9;
  place(world, "c0", 400, 250);
  place(world, "c1", 400, 380);
  world.choppers[1]!.shield = 1;
  for (const target of world.choppers)
    world.rocks.push({
      id: world.nextId++,
      x: target.x - px(40),
      y: target.y,
      vx: world.scroll + px(4),
      vy: 0,
      r: px(12),
      life: 100,
    });
  steps(world, 10);
  assert.equal(world.choppers[0]!.alive, false);
  assert.equal(world.choppers[0]!.cause, 3, "rock");
  assert.ok(world.choppers[1]!.alive, "the shield broke the rock");
  assert.equal(world.rocks.length, 0);
});

function grab(world: World, id: string, kind: PickupKind): void {
  const c = chopper(world, id);
  world.pickups.push({
    id: world.nextId++,
    kind: PICKUP_KINDS.indexOf(kind),
    x: c.x,
    y: c.y,
  });
  stepWorld(world, new Map());
  assert.equal(world.pickups.length, 0, `${kind} taken`);
}

test("power-ups: shield, triple shot, turbo, scramble and shockwave", () => {
  const world = quiet(playing(3, HOVER));
  place(world, "c0", 300, 200);
  place(world, "c1", 420, 260);
  place(world, "c2", 420, 380);
  const [me, near, far] = world.choppers;
  grab(world, "c0", "shield");
  assert.equal(me!.shield, 1);
  assert.equal(me!.pickups, 1);
  assert.ok(world.fx.some((fx) => fx.kind === 3 && fx.data === 0));

  grab(world, "c0", "triple");
  assert.ok(me!.triple > 0);
  stepWorld(world, held({ c0: FIRE }));
  assert.equal(world.bullets.length, 3, "three barrels");
  world.bullets = [];

  grab(world, "c0", "turbo");
  steps(world, 40, held({ c0: RIGHT }));
  assert.equal(me!.vx, T.TURBO_AIRSPEED);

  grab(world, "c0", "scramble");
  assert.ok(near!.scramble > 0 && far!.scramble > 0 && me!.scramble === 0);
  const vx = near!.vx;
  stepWorld(world, held({ c1: LEFT }));
  assert.ok(near!.vx > vx, "left flies right while scrambled");

  place(world, "c1", at(me!.x) + 120, at(me!.y));
  near!.stun = 0;
  world.bolts.push({
    id: world.nextId++,
    x: me!.x + px(60),
    y: me!.y,
    vx: 0,
    vy: 0,
    life: 50,
  });
  grab(world, "c0", "shock");
  assert.ok(near!.vx > 0, "blown away");
  assert.ok(near!.stun > 0);
  assert.equal(world.bolts.length, 0, "the blast clears enemy fire");
  assert.ok(me!.stun === 0, "the one who set it off is untouched");
});

test("pickups and drones enter the world as the camera reaches their segment, as the settings allow", () => {
  /** Every pickup kind and drone that entered the world while an untouchable chopper flew the whole level. */
  const run = (rules = CLASSIC) => {
    const world = playing(1, rules, 11),
      kinds = new Set<string>();
    let drones = 0;
    const known = new Set<number>();
    for (let i = 0; i < 6000 && world.phase === "play"; i++) {
      stepWorld(world, new Map());
      const c = world.choppers[0]!;
      c.grace = 1000;
      c.y = px(300);
      c.x = world.crushX + px(60);
      for (const p of world.pickups) kinds.add(PICKUP_KINDS[p.kind]!);
      for (const d of world.drones)
        if (!known.has(d.id)) known.add(d.id) && drones++;
    }
    return { world, kinds, drones };
  };
  const all = run();
  assert.ok(all.world.segment > 10, "segments spawn as the camera moves");
  assert.ok(all.drones > 0, "drones came");
  assert.ok(all.kinds.size >= 2, `power-ups came: ${[...all.kinds]}`);
  assert.equal(
    run({ ...CLASSIC, powerUps: false }).kinds.size,
    0,
    "power-ups off: none spawn",
  );
  assert.ok(
    !run({ ...CLASSIC, combat: "bump" }).kinds.has("triple"),
    "no triple shot without shots",
  );
});

test("the round goes to the last chopper flying", () => {
  const world = quiet(playing(3, HOVER));
  place(world, "c0", 300, 90);
  place(world, "c1", 320, 500);
  world.choppers[0]!.vy = -T.THRUST_MAX;
  world.choppers[1]!.vy = T.THRUST_MAX;
  steps(world, 6, held({ c0: UP, c1: DOWN }));
  assert.equal(world.winner, "c2");
  assert.equal(world.phase, "outro");
  assert.equal(roundDone(world), false);
  steps(world, T.OUTRO_STEPS);
  assert.equal(roundDone(world), true);
});

test("the first chopper through the exit wins, however many still fly", () => {
  const world = quiet(playing(2, HOVER));
  world.camX = CAMERA_END * SUB;
  world.crushX = world.camX + T.CRUSH_START;
  place(world, "c0", EXIT_X - 60, 300);
  place(world, "c1", EXIT_X - 200, 300);
  for (let i = 0; i < 60 && world.winner === null; i++)
    stepWorld(world, held({ c0: RIGHT, c1: RIGHT }));
  assert.equal(world.winner, "c0");
  assert.ok(chopper(world, "c0").exited && chopper(world, "c0").alive);
  assert.ok(world.fx.some((fx) => fx.kind === 8));
  assert.equal(world.scroll, 0, "the camera stops at the gate");
});

test("nobody wins when the last two crash together; alone, a crash just ends the round", () => {
  const both = quiet(playing(2, HOVER));
  for (const c of both.choppers) {
    c.y =
      span(both.seed, c.x - T.CHOPPER_HW, c.x + T.CHOPPER_HW).ceiling +
      T.CHOPPER_HH +
      px(1);
    c.vy = -T.THRUST_MAX;
  }
  stepWorld(both, held({ c0: UP, c1: UP }));
  assert.equal(both.winner, "");
  const alone = quiet(playing(1, HOVER));
  alone.choppers[0]!.x = alone.crushX;
  stepWorld(alone, new Map());
  assert.equal(alone.winner, "");
  assert.equal(alone.phase, "outro");
});

test("the same inputs fold to the same world on every replica", () => {
  const fly = (seed: number) => {
    const world = createWorld(
      seed,
      [0, 1, 2, 3, 4].map((slot) => ({ id: `b${slot}`, slot })),
      CLASSIC,
    );
    let inputs = new Map<string, number>();
    for (let i = 0; i < 2400 && !roundDone(world); i++) {
      if (i % 3 === 0)
        inputs = new Map(world.choppers.map((c) => [c.id, botInput(world, c)]));
      stepWorld(world, inputs);
    }
    return JSON.stringify(encodeWorld(world));
  };
  assert.equal(fly(99), fly(99));
  assert.notEqual(fly(99), fly(100));
});

test("the AI flies the cave on ordinary controls, in both control schemes", () => {
  for (const rules of [CLASSIC, HOVER]) {
    const world = playing(1, { ...rules, combat: "off" }, 5);
    const seen = new Set<number>();
    for (let i = 0; i < 20 * 60 && world.choppers[0]!.alive; i++) {
      const bits = botInput(world, world.choppers[0]!);
      seen.add(bits);
      stepWorld(world, new Map([["c0", bits]]));
    }
    assert.ok(world.choppers[0]!.alive, `${rules.lift}: alive after 20 s`);
    assert.ok([...seen].every((bits) => (bits & ~31) === 0));
    if (rules.lift === "thrust")
      assert.ok([...seen].some((bits) => bits & DOWN));
    assert.equal(botInput(world, { ...world.choppers[0]!, alive: false }), 0);
  }
});

test("segments are laid out once per seed and stay put", () => {
  assert.equal(segment(3, 5), segment(3, 5));
  assert.deepEqual(segment(3, 0), { platforms: [], saws: [], spawns: [] });
  assert.deepEqual(segment(3, Math.ceil(EXIT_X / SEG) + 5), {
    platforms: [],
    saws: [],
    spawns: [],
  });
});
