import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  deterministicViolations,
  syntax,
} from "../../../tests/fixtures/source-guards.js";
import {
  CELL_SIZE,
  GHOST_FLIGHT,
  GUNSHIP_FLIGHT,
  flightShape,
  flyStep,
  openSky,
  placeClear,
  separate,
  type FlightBody,
  type FlightTuning,
  type FlightWorld,
} from "../src/engine/flight.js";
import {
  DOWN,
  FIRE,
  INPUT_MASK,
  LEFT,
  RIGHT,
  UP,
  isInput,
  thrustDirection,
} from "../src/engine/input.js";
import { TICK_HZ } from "../src/engine/tuning.js";

/** The bitmap terrain's shape: 4 px cells, solid by cell coordinates. */
const CELL = CELL_SIZE;
type CellRule = (cx: number, cy: number) => boolean;
const field = (width: number, height: number, rule: CellRule): FlightWorld => ({
  width,
  height,
  solidAt: (x, y) => rule(Math.floor(x / CELL), Math.floor(y / CELL)),
});

/**
 * How deep rock reaches into the body's circle, px, measured exactly against the cells (not with the engine's probes):
 * 0 or less is clear (0 = touching).
 */
function penetration(body: FlightBody, radius: number, rule: CellRule): number {
  let worst = -Infinity;
  const x0 = Math.floor((body.x - radius) / CELL) - 1,
    x1 = Math.floor((body.x + radius) / CELL) + 1,
    y0 = Math.floor((body.y - radius) / CELL) - 1,
    y1 = Math.floor((body.y + radius) / CELL) + 1;
  for (let cx = x0; cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++) {
      if (!rule(cx, cy)) continue;
      const nx = Math.min(Math.max(body.x, cx * CELL), cx * CELL + CELL),
        ny = Math.min(Math.max(body.y, cy * CELL), cy * CELL + CELL);
      worst = Math.max(worst, radius - Math.hypot(body.x - nx, body.y - ny));
    }
  return worst;
}

const body = (x: number, y: number, vx = 0, vy = 0): FlightBody => ({
  x,
  y,
  vx,
  vy,
});
const speed = (b: FlightBody): number => Math.hypot(b.vx, b.vy);
const SKY = openSky(100_000, 100_000);
const R = GUNSHIP_FLIGHT.shape.radius;
/** A ship resting on rock or the world edge keeps its circle at most this far off it, px (about a pixel). */
const GAP = 1.1;
/** A buried body is moved out to within this far of the rock, px: its rings are 2 px apart. */
const PUSH_OUT_SLACK = 2.5;

/** Ticks of holding `bits` until `done`, from `b` in open sky. */
function ticksUntil(
  b: FlightBody,
  bits: number,
  done: (b: FlightBody) => boolean,
  tuning: FlightTuning = GUNSHIP_FLIGHT,
): number {
  for (let tick = 1; tick <= 10 * TICK_HZ; tick++) {
    flyStep(b, bits, tuning, SKY);
    if (done(b)) return tick;
  }
  return Infinity;
}

/** Seconds to reach half speed, top speed, a full reversal and rest from top speed, in open sky. */
function timings(tuning: FlightTuning): {
  half: number;
  full: number;
  reverse: number;
  coast: number;
} {
  const top = tuning.topSpeed;
  const b = body(50_000, 50_000);
  const half = ticksUntil(b, RIGHT, (s) => s.vx >= top / 2, tuning);
  const full = half + ticksUntil(b, RIGHT, (s) => s.vx >= top - 1e-9, tuning);
  const reverse = ticksUntil(b, LEFT, (s) => s.vx <= -top + 1e-9, tuning);
  const coast = ticksUntil(b, 0, (s) => s.vx === 0 && s.vy === 0, tuning);
  return {
    half: half / TICK_HZ,
    full: full / TICK_HZ,
    reverse: reverse / TICK_HZ,
    coast: coast / TICK_HZ,
  };
}

test("input bits: a validator for anything that crosses a boundary", () => {
  for (let bits = 0; bits <= INPUT_MASK; bits++) assert.ok(isInput(bits));
  assert.equal(INPUT_MASK, 31);
  for (const bad of [
    -1,
    32,
    64 | UP,
    1.5,
    NaN,
    Infinity,
    "1",
    null,
    undefined,
    {},
    [UP],
  ])
    assert.equal(isInput(bad), false, String(bad));
});

test("thrust direction: opposites cancel, diagonals are unit length, fire is ignored", () => {
  assert.deepEqual(thrustDirection(0), { x: 0, y: 0 });
  assert.deepEqual(thrustDirection(UP | DOWN), { x: 0, y: 0 });
  assert.deepEqual(thrustDirection(LEFT | RIGHT), { x: 0, y: 0 });
  assert.deepEqual(thrustDirection(UP | DOWN | LEFT | RIGHT | FIRE), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(thrustDirection(RIGHT), { x: 1, y: 0 });
  assert.deepEqual(thrustDirection(UP | FIRE), { x: 0, y: -1 });
  assert.deepEqual(thrustDirection(LEFT | RIGHT | DOWN), { x: 0, y: 1 });
  assert.deepEqual(thrustDirection(UP | LEFT), {
    x: -Math.SQRT1_2,
    y: -Math.SQRT1_2,
  });
  for (let bits = 0; bits <= INPUT_MASK; bits++) {
    const d = thrustDirection(bits);
    const length = Math.hypot(d.x, d.y);
    assert.ok(length === 0 || Math.abs(length - 1) < 1e-15, String(bits));
  }
  // Anything else stays inside the table.
  assert.deepEqual(thrustDirection(NaN), { x: 0, y: 0 });
});

test("a gunship is slow and heavy: about 1-1.5 s to top speed and to reverse, 1-2 s to coast to rest", () => {
  const top = GUNSHIP_FLIGHT.topSpeed;
  assert.equal(top, 200);
  const { half, full, reverse, coast } = timings(GUNSHIP_FLIGHT);
  // Measured: half speed 0.33 s, top speed 1.07 s, reversal 1.45 s, coasting 1.6 s.
  assert.ok(half > 0.25, `half speed after ${half} s`);
  assert.ok(full >= 1 && full <= 1.5, `top speed after ${full} s`);
  assert.ok(reverse >= 1 && reverse <= 1.5, `reversal took ${reverse} s`);
  assert.ok(coast >= 1 && coast <= 2, `coasted for ${coast} s`);
  // Never faster than the cap, and the cap is reached rather than approached forever.
  const fast = body(50_000, 50_000);
  for (let i = 0; i < 300; i++) {
    flyStep(fast, RIGHT | DOWN, GUNSHIP_FLIGHT, SKY);
    assert.ok(speed(fast) <= top + 1e-9);
  }
  assert.ok(Math.abs(speed(fast) - top) < 1e-9);
});

test("no gravity: level flight stays level, and a body at rest stays exactly where it is", () => {
  // A small gravity would hide in the dead stop below `stopSpeed` at rest, so also fly level for two seconds.
  const level = body(500, 500);
  for (let i = 0; i < 120; i++) flyStep(level, RIGHT, GUNSHIP_FLIGHT, SKY);
  assert.equal(level.vy, 0);
  assert.equal(level.y, 500);
  assert.ok(level.x > 500);
  const rest = body(500, 500);
  for (let i = 0; i < 600; i++) flyStep(rest, FIRE, GUNSHIP_FLIGHT, SKY);
  assert.deepEqual(rest, body(500, 500));
});

test("a ghost is lighter and faster than a gunship, and the world edge still stops it", () => {
  const ship = timings(GUNSHIP_FLIGHT),
    ghost = timings(GHOST_FLIGHT);
  assert.ok(GHOST_FLIGHT.topSpeed > GUNSHIP_FLIGHT.topSpeed);
  // Measured: half speed 0.25 s, top speed 0.78 s, reversal 1.05 s, coasting 1.47 s.
  assert.ok(ghost.half < ship.half && ghost.full < ship.full);
  assert.ok(ghost.full >= 0.5 && ghost.full <= 1, `${ghost.full} s`);
  assert.ok(ghost.reverse >= 0.75 && ghost.reverse <= 1.25, `${ghost.reverse}`);
  assert.ok(ghost.coast >= 1 && ghost.coast <= 2, `${ghost.coast} s`);
  // Open sky has no rock to ask about, but the edges are walls.
  const sky = {
    ...openSky(1200, 800),
    solidAt: (): boolean => assert.fail("a rockless world is never probed"),
  };
  const flier = body(600, 400);
  const g = GHOST_FLIGHT.shape.radius;
  let nearestX = Infinity,
    nearestY = Infinity;
  for (let i = 0; i < 600; i++) {
    flyStep(flier, RIGHT | DOWN, GHOST_FLIGHT, sky);
    assert.ok(flier.x >= g && flier.x <= sky.width - g, `x ${flier.x}`);
    assert.ok(flier.y >= g && flier.y <= sky.height - g, `y ${flier.y}`);
    nearestX = Math.min(nearestX, sky.width - flier.x);
    nearestY = Math.min(nearestY, sky.height - flier.y);
  }
  // It reached both edges (it bounces off the second, so look at the closest it came).
  assert.ok(
    nearestX < g + GAP && nearestY < g + GAP,
    `${nearestX}, ${nearestY}`,
  );
});

test("diagonal flight is exactly as fast as straight flight; opposite keys cancel", () => {
  const straight = body(50_000, 50_000),
    diagonal = body(50_000, 50_000);
  for (let i = 0; i < 120; i++) {
    flyStep(straight, RIGHT, GUNSHIP_FLIGHT, SKY);
    flyStep(diagonal, RIGHT | DOWN, GUNSHIP_FLIGHT, SKY);
    assert.ok(Math.abs(speed(straight) - speed(diagonal)) < 1e-9, `tick ${i}`);
    assert.ok(Math.abs(diagonal.vx - diagonal.vy) < 1e-12);
  }
  const idle = body(500, 500, 120, -60),
    all = body(500, 500, 120, -60),
    sideways = body(500, 500, 0, 0),
    down = body(500, 500, 0, 0);
  for (let i = 0; i < 90; i++) {
    flyStep(idle, 0, GUNSHIP_FLIGHT, SKY);
    flyStep(all, UP | DOWN | LEFT | RIGHT, GUNSHIP_FLIGHT, SKY);
    flyStep(sideways, LEFT | RIGHT | DOWN, GUNSHIP_FLIGHT, SKY);
    flyStep(down, DOWN, GUNSHIP_FLIGHT, SKY);
  }
  assert.deepEqual(all, idle);
  assert.deepEqual(sideways, down);
});

test("no tunnelling through one-cell rock at any heading, even far above top speed", () => {
  // 70 px a tick: more than the ship is wide, so only sub-steps stop it jumping a wall.
  const rocket: FlightTuning = {
    ...GUNSHIP_FLIGHT,
    topSpeed: 4200,
    thrust: 1e6,
  };
  const shapes: readonly [string, CellRule, (b: FlightBody) => boolean][] = [
    ["wall", (cx) => cx === 100, (b) => b.x < 400],
    ["floor", (_cx, cy) => cy === 100, (b) => b.y < 400],
    // Touches its neighbours only at cell corners.
    ["staircase", (cx, cy) => cx === cy, (b) => b.x < b.y],
    ["post", (cx, cy) => cx === 100 && cy === 100, () => true],
  ];
  for (const tuning of [GUNSHIP_FLIGHT, GHOST_FLIGHT, rocket])
    for (const [name, rule, side] of shapes) {
      const world = field(800, 800, rule);
      for (let degrees = 0; degrees < 360; degrees += 15) {
        const a = (degrees * Math.PI) / 180;
        const cos = Math.cos(a),
          sin = Math.sin(a);
        const b = body(
          name === "floor" ? 400 : 250,
          name === "floor" ? 250 : name === "staircase" ? 550 : 400,
          tuning.topSpeed * cos,
          tuning.topSpeed * sin,
        );
        const bits =
          (cos > 0.3 ? RIGHT : cos < -0.3 ? LEFT : 0) |
          (sin > 0.3 ? DOWN : sin < -0.3 ? UP : 0);
        const label = `${name}, ${tuning.topSpeed} px/s at ${degrees}°`;
        // The ghost's tuning is flown through rock here on purpose: only the shape matters for tunnelling.
        for (let i = 0; i < (tuning === rocket ? 60 : 240); i++) {
          flyStep(b, bits, tuning, world);
          assert.ok(side(b), `${label}: crossed at ${b.x}, ${b.y}`);
          assert.ok(penetration(b, tuning.shape.radius, rule) <= 0, label);
        }
      }
    }
});

test("sliding along a floor keeps the parallel velocity and stops the blocked one", () => {
  const rule: CellRule = (_cx, cy) => cy >= 150; // floor at y = 600
  const world = field(4000, 1000, rule);
  // Coasting diagonally into the floor: x moves exactly as it would in open sky.
  const slider = body(400, 560, 150, 150),
    free = body(400, 560, 150, 150);
  let hit = 0;
  for (let i = 0; i < 40; i++) {
    hit = Math.max(hit, flyStep(slider, 0, GUNSHIP_FLIGHT, world));
    flyStep(free, 0, GUNSHIP_FLIGHT, SKY);
    assert.equal(slider.vx, free.vx);
    assert.ok(Math.abs(slider.x - free.x) < 1e-9);
    assert.ok(penetration(slider, R, rule) <= 0);
  }
  assert.ok(hit > 100, "the floor was hit hard");
  assert.ok(slider.vy <= 0, "and the fall bounced or stopped");
  // Holding down-right just above the floor: once it touches, the ship skims it without jitter and keeps accelerating
  // sideways.
  const skimmer = body(400, 600 - R - 1.5);
  let lastY = skimmer.y,
    touched = false;
  for (let i = 0; i < 120; i++) {
    flyStep(skimmer, DOWN | RIGHT, GUNSHIP_FLIGHT, world);
    touched ||= skimmer.vy === 0;
    if (touched) assert.equal(skimmer.vy, 0, `tick ${i}`);
    assert.ok(skimmer.y >= lastY && skimmer.y + R <= 600);
    lastY = skimmer.y;
  }
  assert.ok(touched);
  assert.ok(skimmer.vx > 150, `vx ${skimmer.vx}`);
  assert.ok(600 - (skimmer.y + R) < GAP, "resting on the floor");
});

test("the reported impact is a hard hit: a ship pressing on a wall reports nothing", () => {
  const floor: CellRule = (_cx, cy) => cy >= 150;
  const world = field(2000, 1000, floor);
  const presser = body(400, 600 - R - 0.5);
  for (let i = 0; i < 120; i++)
    assert.equal(flyStep(presser, DOWN, GUNSHIP_FLIGHT, world), 0, `tick ${i}`);
  assert.equal(presser.vy, 0);
  // Slowly into the floor stops against it; fast bounces and reports the speed.
  const slow = body(800, 600 - R - 0.5, 0, GUNSHIP_FLIGHT.bounceMinSpeed - 1);
  assert.equal(flyStep(slow, 0, GUNSHIP_FLIGHT, world), 0);
  const fast = body(800, 600 - R - 3, 0, 100);
  let impact = 0;
  for (let i = 0; i < 3 && impact === 0; i++)
    impact = flyStep(fast, 0, GUNSHIP_FLIGHT, world);
  assert.ok(impact > 90 && impact <= 100, `impact ${impact}`);
  assert.ok(fast.vy < 0 && Math.abs(fast.vy + impact * 0.35) < 1e-9);
});

/**
 * A ramp climbing to the right: flat ground at y = 1500 up to x = 300, then a surface rising at `degrees`, as 4 px
 * cells (so it is a staircase). Its ceiling mirror hangs from y = 300 and falls to the right.
 */
const ramp = (degrees: number): CellRule => {
  const tan = Math.tan((degrees * Math.PI) / 180);
  return (cx, cy) => cy * CELL + 2 >= 1500 - tan * Math.max(0, cx * CELL - 300);
};
const roof = (degrees: number): CellRule => {
  const tan = Math.tan((degrees * Math.PI) / 180);
  return (cx, cy) => cy * CELL + 2 <= 300 + tan * Math.max(0, cx * CELL - 300);
};

test("ships ride up ramps while thrusting into them instead of stopping or bouncing back", () => {
  for (const degrees of [6, 15, 30, 45]) {
    const rule = ramp(degrees);
    const tan = Math.tan((degrees * Math.PI) / 180);
    const world = field(3000, 1800, rule);
    const b = body(100, 1460);
    for (let i = 0; i < 300; i++) {
      flyStep(b, RIGHT, GUNSHIP_FLIGHT, world);
      assert.ok(penetration(b, R, rule) <= 0, `${degrees}° tick ${i}`);
    }
    // It followed the slope up (not stopped at its foot, not thrown back): its height gain matches the slope it
    // covered, and it is still moving up and along it.
    const line = tan * (b.x - 300),
      rise = 1460 - b.y;
    assert.ok(b.x > 500, `${degrees}°: x ${b.x}`);
    assert.ok(
      rise > 0.7 * line && rise < line + 60,
      `${degrees}°: rose ${rise} over a slope worth ${line}`,
    );
    assert.ok(b.vx > 50 && b.vy < 0, `${degrees}°: v ${b.vx}, ${b.vy}`);
  }
});

test("ships ride over stair-stepped gentle rises and along sloped roofs", () => {
  // Treads 20 px long and risers one cell high (11°): every riser is a flat wall that stops an axis-aligned slide.
  const stairs: CellRule = (cx, cy) =>
    cy >= 375 - Math.floor(Math.max(0, cx - 75) / 5);
  const stairWorld = field(3000, 1800, stairs);
  const climber = body(100, 1460);
  for (let i = 0; i < 300; i++) {
    flyStep(climber, RIGHT, GUNSHIP_FLIGHT, stairWorld);
    assert.ok(penetration(climber, R, stairs) <= 0, `stairs tick ${i}`);
  }
  assert.ok(climber.x > 800 && climber.y < 1460 - 100, `${climber.x}`);

  for (const degrees of [15, 30, 45]) {
    const rule = roof(degrees);
    const tan = Math.tan((degrees * Math.PI) / 180);
    const world = field(3000, 1800, rule);
    const b = body(100, 340);
    for (let i = 0; i < 300; i++) {
      flyStep(b, RIGHT, GUNSHIP_FLIGHT, world);
      assert.ok(penetration(b, R, rule) <= 0, `${degrees}° roof tick ${i}`);
    }
    assert.ok(b.x > 500, `${degrees}° roof: x ${b.x}`);
    assert.ok(b.y >= 340 + 0.6 * tan * (b.x - 300), `${degrees}° roof: ${b.y}`);
  }
});

test("a steep, jagged slope slows a ship but never holds it", () => {
  const rule = ramp(60);
  const world = field(3000, 1800, rule);
  const b = body(100, 1460);
  for (let i = 0; i < 360; i++) flyStep(b, RIGHT, GUNSHIP_FLIGHT, world);
  assert.ok(b.y < 1460 - 250, `climbed to ${b.y}`);
  assert.ok(penetration(b, R, rule) <= 0);
});

test("corners: a ship settles into an inside corner, stops at a face and rolls over a ledge's corner", () => {
  const corner: CellRule = (cx, cy) => cx >= 150 || cy >= 150; // walls at x = 600 and y = 600
  const box = field(1000, 1000, corner);
  const b = body(300, 300);
  for (let i = 0; i < 300; i++) {
    flyStep(b, DOWN | RIGHT, GUNSHIP_FLIGHT, box);
    assert.ok(penetration(b, R, corner) <= 0);
  }
  assert.ok(Math.abs(b.vx) < 1e-9 && Math.abs(b.vy) < 1e-9);
  assert.ok(600 - (b.x + R) < GAP && 600 - (b.y + R) < GAP);

  // A block at [400, 480) x [400, 480). Flying level into its face stops against it.
  const ledge: CellRule = (cx, cy) =>
    cx >= 100 && cx < 120 && cy >= 100 && cy < 120;
  const world = field(1000, 1000, ledge);
  const level = body(300, 440);
  for (let i = 0; i < 180; i++) {
    flyStep(level, RIGHT, GUNSHIP_FLIGHT, world);
    assert.ok(penetration(level, R, ledge) <= 0, `tick ${i}`);
  }
  assert.ok(level.x + R <= 400 && 400 - (level.x + R) < GAP, `x ${level.x}`);
  assert.equal(level.vx, 0);
  // Flying level 20 px above its top, the circle meets only the corner, below its centre: it rolls up and over it.
  const roller = body(300, 380);
  for (let i = 0; i < 300; i++) {
    flyStep(roller, RIGHT, GUNSHIP_FLIGHT, world);
    assert.ok(penetration(roller, R, ledge) <= 0, `tick ${i}`);
  }
  assert.ok(
    roller.x > 500 && roller.y < 380,
    `rolled to ${roller.x}, ${roller.y}`,
  );
});

test("the world edge is a soft wall: the ship bounces back and never leaves", () => {
  const world = openSky(1200, 800);
  for (const [bits, axis, sign] of [
    [RIGHT, "x", 1],
    [LEFT, "x", -1],
    [DOWN, "y", 1],
    [UP, "y", -1],
  ] as const) {
    const b = body(600, 400);
    const v = axis === "x" ? "vx" : "vy";
    for (let i = 0; i < 300; i++) flyStep(b, bits, GUNSHIP_FLIGHT, world);
    // Let go just before the edge at full speed: the bounce sends it back at `bounce` of the impact speed.
    const fresh = body(
      axis === "x" ? 600 + sign * (600 - R - 5) : 600,
      axis === "y" ? 400 + sign * (400 - R - 5) : 400,
    );
    fresh[v] = sign * GUNSHIP_FLIGHT.topSpeed;
    let impact = 0;
    for (let i = 0; i < 3 && impact === 0; i++)
      impact = flyStep(fresh, 0, GUNSHIP_FLIGHT, world);
    assert.ok(impact > 150, `${axis} ${sign}: impact ${impact}`);
    assert.ok(
      Math.abs(fresh[v] + sign * impact * GUNSHIP_FLIGHT.bounce) < 1e-9,
      `${axis} ${sign}: ${fresh[v]}`,
    );
    for (const s of [b, fresh]) {
      assert.ok(s.x >= R && s.x <= world.width - R);
      assert.ok(s.y >= R && s.y <= world.height - R);
    }
    assert.ok(
      Math.abs(
        (axis === "x" ? b.x : b.y) -
          (sign > 0 ? (axis === "x" ? 1200 : 800) - R : R),
      ) < GAP,
    );
  }
  // A body placed outside the world is put back inside before it moves.
  const outside = body(-50, 900);
  flyStep(outside, 0, GUNSHIP_FLIGHT, world);
  assert.ok(outside.x >= R && outside.x - R < GAP, `x ${outside.x}`);
  assert.ok(
    outside.y <= 800 - R && 800 - R - outside.y < GAP,
    `y ${outside.y}`,
  );
});

test("solidAt is only asked about points inside [0, width) x [0, height), also at the edges", () => {
  const posts: CellRule = (cx, cy) => cx % 31 === 5 && cy % 29 === 3;
  const rule: CellRule = (cx, cy) => cy >= 190 || posts(cx, cy);
  const asked: string[] = [];
  const world: FlightWorld = {
    width: 800,
    height: 800,
    solidAt: (x, y) => {
      if (!(x >= 0 && x < 800 && y >= 0 && y < 800)) asked.push(`${x},${y}`);
      return rule(Math.floor(x / CELL), Math.floor(y / CELL));
    },
  };
  const ships = [body(40, 40), body(760, 40, -50, 0), body(400, 400)];
  for (const [i, s] of ships.entries())
    placeClear(s, GUNSHIP_FLIGHT.shape, world) || assert.fail(`${i}`);
  for (let t = 0; t < 600; t++) {
    ships.forEach((s, i) =>
      flyStep(
        s,
        [UP | LEFT, UP | RIGHT, DOWN | RIGHT][i]!,
        GUNSHIP_FLIGHT,
        world,
      ),
    );
    separate(ships, GUNSHIP_FLIGHT.shape, world);
  }
  assert.deepEqual(asked, []);
});

test("a buried body is pushed out, and one buried too deep flies out instead of being stuck", () => {
  const ground: CellRule = (_cx, cy) => cy >= 100; // y >= 400
  const world = field(1000, 1000, ground);
  const shallow = body(500, 400 - R + 10); // 10 px into the ground
  flyStep(shallow, 0, GUNSHIP_FLIGHT, world);
  assert.ok(penetration(shallow, R, ground) <= 0);
  assert.ok(400 - (shallow.y + R) < PUSH_OUT_SLACK);
  // Its centre 60 px under the surface is still within reach of a push-out, with no input at all.
  const sunk = body(500, 460);
  flyStep(sunk, 0, GUNSHIP_FLIGHT, world);
  assert.ok(penetration(sunk, R, ground) <= 0, `y ${sunk.y}`);
  // Deep in rock: no clear spot within reach, so it flies through until it is out, then collides again.
  const deep = body(500, 700);
  let ticks = 0;
  while (penetration(deep, R, ground) > 0 && ticks < 600) {
    flyStep(deep, UP, GUNSHIP_FLIGHT, world);
    ticks++;
  }
  assert.ok(ticks < 600, "got out");
  for (let i = 0; i < 60; i++) {
    flyStep(deep, DOWN, GUNSHIP_FLIGHT, world);
    assert.ok(penetration(deep, R, ground) <= 0);
  }
});

test("placing a body (a spawn) finds rock the rim never meets, such as an islet inside the circle", () => {
  // An islet smaller than the ship, wholly inside its circle: [500, 504)².
  const islet: CellRule = (cx, cy) => cx === 125 && cy === 125;
  const world = field(1000, 1000, islet);
  const around = body(502, 502);
  assert.ok(penetration(around, R, islet) > 0);
  assert.equal(placeClear(around, GUNSHIP_FLIGHT.shape, world), true);
  assert.ok(penetration(around, R, islet) <= 0);
  assert.ok(Math.hypot(around.x - 502, around.y - 502) < 2 * R);
  // A clear body stays where it is, also one resting against the cell.
  const resting = body(504 + GUNSHIP_FLIGHT.shape.ring + 0.01, 502);
  assert.equal(placeClear(resting, GUNSHIP_FLIGHT.shape, world), true);
  assert.deepEqual(resting, body(504 + GUNSHIP_FLIGHT.shape.ring + 0.01, 502));
  // Inside solid rock with no clear spot within reach: false, and the body is only put inside the world.
  const solid = field(1000, 1000, () => true);
  const lost = body(500, 500);
  assert.equal(placeClear(lost, GUNSHIP_FLIGHT.shape, solid), false);
  assert.deepEqual(lost, body(500, 500));
  const outside = body(-10, 2000);
  placeClear(outside, GUNSHIP_FLIGHT.shape, openSky(1000, 1000));
  assert.ok(outside.x >= R && outside.y <= 1000 - R);
});

test("separation pushes overlapping ships apart symmetrically and damps their approach", () => {
  const world = openSky(2000, 2000);
  const a = body(1000, 1000, 50, 10),
    b = body(1040, 1010, -70, 30);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const before = { a: { ...a }, b: { ...b } };
  separate([a, b], GUNSHIP_FLIGHT.shape, world);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(Math.abs(d - 2 * R) < 1e-9, `distance ${d}`);
  assert.ok(Math.abs((a.x + b.x) / 2 - mid.x) < 1e-9);
  assert.ok(Math.abs((a.y + b.y) / 2 - mid.y) < 1e-9);
  const nx = (b.x - a.x) / d,
    ny = (b.y - a.y) / d;
  const approach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  assert.ok(Math.abs(approach) < 1e-9, "approach removed");
  // Momentum is conserved and the sliding part of the relative velocity is kept.
  assert.ok(Math.abs(a.vx + b.vx - (before.a.vx + before.b.vx)) < 1e-9);
  assert.ok(Math.abs(a.vy + b.vy - (before.a.vy + before.b.vy)) < 1e-9);
  const tangent = (s: { a: FlightBody; b: FlightBody }): number =>
    (s.b.vx - s.a.vx) * -ny + (s.b.vy - s.a.vy) * nx;
  assert.ok(Math.abs(tangent({ a, b }) - tangent(before)) < 1e-9);

  // Ships already moving apart keep their velocities.
  const c = body(1000, 1000, -20, 0),
    e = body(1030, 1000, 20, 0);
  separate([c, e], GUNSHIP_FLIGHT.shape, world);
  assert.deepEqual([c.vx, e.vx], [-20, 20]);
  assert.ok(Math.abs(e.x - c.x - 2 * R) < 1e-9);

  // Exactly on top of each other: they part along x, the later one to the right.
  const p = body(500, 500),
    q = body(500, 500);
  separate([p, q], GUNSHIP_FLIGHT.shape, world);
  assert.deepEqual([p.x, p.y, q.x, q.y], [500 - R, 500, 500 + R, 500]);
});

test("separation never pushes a ship into rock: the free one takes the whole push", () => {
  const wall: CellRule = (cx) => cx < 100; // rock left of x = 400
  const world = field(2000, 2000, wall);
  const ring = GUNSHIP_FLIGHT.shape.ring;
  const pinned = body(400 + ring + 0.01, 1000),
    other = body(400 + ring + 20, 1000);
  separate([pinned, other], GUNSHIP_FLIGHT.shape, world);
  assert.ok(penetration(pinned, R, wall) <= 0);
  assert.ok(pinned.x >= 400 + R);
  assert.ok(pinned.x - (400 + ring) < 0.02, `pinned moved to ${pinned.x}`);
  assert.ok(Math.abs(other.x - pinned.x - 2 * R) < 1e-6);

  // Pressed against the world edge, a ship is not pushed through it either.
  const edge = openSky(1200, 800);
  const last = body(1200 - ring - 0.001, 400),
    next = body(1200 - ring - 20, 400);
  separate([next, last], GUNSHIP_FLIGHT.shape, edge);
  assert.ok(last.x <= 1170, `pushed to ${last.x}`);
  assert.ok(last.x + ring < 1200);
  assert.ok(Math.abs(last.x - next.x - 2 * R) < 1e-6);

  // A cluster of four in open sky ends with no overlap.
  const cluster = [
    body(1000, 1000),
    body(1010, 1000),
    body(1005, 1012),
    body(995, 990),
  ];
  separate(cluster, GUNSHIP_FLIGHT.shape, openSky(2000, 2000));
  for (let i = 0; i < cluster.length; i++)
    for (let j = i + 1; j < cluster.length; j++) {
      const s = cluster[i]!,
        t = cluster[j]!;
      assert.ok(Math.hypot(t.x - s.x, t.y - s.y) >= 2 * R - 1e-6, `${i}-${j}`);
    }
});

test("separation pushes in sub-steps, so a ship cannot be thrown over a thin post", () => {
  // A post one cell wide at x [1044, 1048), y [996, 1004): the ship pushed right from 1000 would otherwise land with
  // the post inside its circle, where no rim probe sees it.
  const post: CellRule = (cx, cy) => cx === 261 && (cy === 249 || cy === 250);
  const world = field(2000, 2000, post);
  const a = body(1000, 1000),
    b = body(1000, 1000);
  separate([a, b], GUNSHIP_FLIGHT.shape, world);
  for (const s of [a, b]) assert.ok(penetration(s, R, post) <= 0, `${s.x}`);
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) >= 2 * R - 1e-6);
  assert.ok(b.x < 1044, "stopped by the post");
});

test("separation parts ships a wall or a shaft keeps from parting along their line", () => {
  // Free width [432-ish, 440-ish] for a centre: two ships side by side in a shaft 72 px wide must part vertically.
  const shaft: CellRule = (cx) => cx < 100 || cx >= 118;
  const narrow = field(2000, 2000, shaft);
  const left = body(432, 1000),
    right = body(440, 1000);
  separate([left, right], GUNSHIP_FLIGHT.shape, narrow);
  for (const s of [left, right]) {
    assert.ok(penetration(s, R, shaft) <= 0);
    assert.ok(s.x >= 400 + R && s.x <= 472 - R);
  }
  assert.ok(Math.hypot(right.x - left.x, right.y - left.y) >= 2 * R - 1e-6);
  assert.ok(right.y - left.y > 55, "the later ship is below");

  // Exactly on top of each other in the shaft: x runs out at the walls, so they part along y.
  const p = body(436, 1000),
    q = body(436, 1000);
  separate([p, q], GUNSHIP_FLIGHT.shape, narrow);
  for (const s of [p, q]) assert.ok(penetration(s, R, shaft) <= 0);
  assert.ok(Math.hypot(q.x - p.x, q.y - p.y) >= 2 * R - 1e-6);
  assert.ok(q.y - p.y > 55 && p.y < 1000 && q.y > 1000, `${p.y}, ${q.y}`);

  // A slot narrower than two ships, the pair starting clear of the walls but overlapping each other: nobody enters
  // rock, and the pair ends parted (they have the whole slot to slide along).
  const slot: CellRule = (cx) => cx < 100 || cx >= 125; // free x in [400, 500)
  const slotted = field(2000, 2000, slot);
  const one = body(432, 1000),
    two = body(468, 1000);
  assert.ok(penetration(one, R, slot) <= 0 && penetration(two, R, slot) <= 0);
  separate([one, two], GUNSHIP_FLIGHT.shape, slotted);
  for (const s of [one, two]) {
    assert.ok(penetration(s, R, slot) <= 0);
    assert.ok(s.x >= 400 + R - 1e-9 && s.x <= 500 - R + 1e-9);
  }
  assert.ok(Math.hypot(two.x - one.x, two.y - one.y) >= 2 * R - 1e-6);
});

/** A small cave: floor, two walls, a pillar and an islet. */
const cave: CellRule = (cx, cy) =>
  cy >= 220 ||
  cx < 4 ||
  cx >= 296 ||
  (cx >= 140 && cx < 150 && cy >= 120) ||
  (cx >= 60 && cx < 80 && cy >= 60 && cy < 70);

/**
 * Three ships flying seeded random inputs in the cave, separated every step; their state after every step, and how
 * many hard hits and pair overlaps the run had (so a test can tell it exercised collisions and separation).
 */
function replay(
  start: FlightBody[],
  inputs: readonly number[][],
): { trace: number[][]; hits: number; overlaps: number } {
  const world = field(1200, 1000, cave);
  const trace: number[][] = [];
  let hits = 0,
    overlaps = 0;
  for (const tick of inputs) {
    start.forEach((b, i) => {
      if (flyStep(b, tick[i]!, GUNSHIP_FLIGHT, world) > 0) hits++;
    });
    for (let i = 0; i < start.length; i++)
      for (let j = i + 1; j < start.length; j++)
        if (
          Math.hypot(start[j]!.x - start[i]!.x, start[j]!.y - start[i]!.y) <
          2 * R
        )
          overlaps++;
    separate(start, GUNSHIP_FLIGHT.shape, world);
    trace.push(start.flatMap((b) => [b.x, b.y, b.vx, b.vy]));
    for (const b of start) assert.ok(penetration(b, R, cave) <= 0);
  }
  return { trace, hits, overlaps };
}

test("replay: the same inputs give identical floats, also from a mid-run snapshot", () => {
  let seed = 12345;
  const next = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 16;
  };
  // Each ship holds its input for 20-80 ticks, so it builds up speed and reaches walls, the floor and the others.
  const inputs: number[][] = [];
  const held = [0, 0, 0],
    left = [0, 0, 0];
  for (let tick = 0; tick < 900; tick++) {
    for (let i = 0; i < 3; i++) {
      if (left[i]! === 0) {
        held[i] = next() & INPUT_MASK;
        left[i] = 20 + (next() % 61);
      }
      left[i]!--;
    }
    inputs.push([...held]);
  }
  const start = (): FlightBody[] => [
    body(200, 200),
    body(400, 300),
    body(900, 400),
  ];
  const first = replay(start(), inputs);
  // The run is a real test of collisions and separation, not three ships jittering in open air.
  assert.ok(first.hits >= 5, `${first.hits} hard hits`);
  assert.ok(first.overlaps >= 20, `${first.overlaps} overlaps`);
  const fastest = Math.max(...first.trace.map((t) => Math.hypot(t[2]!, t[3]!)));
  assert.ok(fastest > 150, `fastest ${fastest}`);
  const second = replay(start(), inputs);
  assert.deepEqual(second.trace, first.trace);
  // Roll back to tick 450 from a structured clone of the state and replay the rest.
  const ships = start();
  replay(ships, inputs.slice(0, 450));
  const snapshot = structuredClone(ships);
  assert.deepEqual(
    replay(snapshot, inputs.slice(450)).trace,
    first.trace.slice(450),
  );
});

test("a shape is a pure function of its radius, with its rim on a ring a little wider than the circle", () => {
  assert.deepEqual(flightShape(30), GUNSHIP_FLIGHT.shape);
  assert.deepEqual(flightShape(18), GHOST_FLIGHT.shape);
  for (const shape of [GUNSHIP_FLIGHT.shape, GHOST_FLIGHT.shape]) {
    assert.ok(shape.ring > shape.radius && shape.ring < shape.radius + GAP);
    for (let i = 0; i < shape.rim.length; i += 2)
      assert.ok(
        Math.abs(Math.hypot(shape.rim[i]!, shape.rim[i + 1]!) - shape.ring) <
          1e-9,
      );
  }
});

test("flight and input use only deterministic arithmetic", () => {
  for (const file of ["flight.ts", "input.ts"]) {
    const path = fileURLToPath(
      new URL(`../src/engine/${file}`, import.meta.url),
    );
    assert.deepEqual(deterministicViolations(syntax(path)), [], file);
  }
});
