import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  deterministicViolations,
  syntax,
} from "../../../tests/fixtures/source-guards.js";
import {
  GHOST_FLIGHT,
  GUNSHIP_FLIGHT,
  MAX_SUBSTEP,
  flyStep,
  openSky,
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
const CELL = 4;
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
const R = GUNSHIP_FLIGHT.radius;
/** A ship resting on rock or the world edge keeps its circle at most this far off it, px (about a pixel). */
const GAP = 1.1;

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

test("a gunship is slow and heavy: about 1-1.5 s to top speed, to reverse and to coast to rest", () => {
  const top = GUNSHIP_FLIGHT.topSpeed;
  assert.equal(top, 200);
  const b = body(50_000, 50_000);
  const half = ticksUntil(b, RIGHT, (s) => s.vx >= top / 2);
  const full = half + ticksUntil(b, RIGHT, (s) => s.vx >= top - 1e-9);
  const reverse = ticksUntil(b, LEFT, (s) => s.vx <= -top + 1e-9);
  const coast = ticksUntil(b, 0, (s) => s.vx === 0 && s.vy === 0);
  const seconds = (ticks: number): number => ticks / TICK_HZ;
  // Measured: half speed 0.33 s, top speed 1.07 s, reversal 1.45 s, coasting 1.6 s.
  assert.ok(seconds(half) > 0.25, `half speed after ${seconds(half)} s`);
  assert.ok(
    seconds(full) >= 1 && seconds(full) <= 1.5,
    `top speed after ${seconds(full)} s`,
  );
  assert.ok(
    seconds(reverse) >= 1 && seconds(reverse) <= 1.5,
    `reversal took ${seconds(reverse)} s`,
  );
  assert.ok(
    seconds(coast) >= 1 && seconds(coast) <= 2,
    `coasted for ${seconds(coast)} s`,
  );
  // Never faster than the cap, and the cap is reached rather than approached forever.
  const fast = body(50_000, 50_000);
  for (let i = 0; i < 300; i++) {
    flyStep(fast, RIGHT | DOWN, GUNSHIP_FLIGHT, SKY);
    assert.ok(speed(fast) <= top + 1e-9);
  }
  assert.ok(Math.abs(speed(fast) - top) < 1e-9);
});

test("balloons hover: no gravity, and a body at rest stays exactly where it is", () => {
  const b = body(500, 500);
  for (let i = 0; i < 600; i++) flyStep(b, FIRE, GUNSHIP_FLIGHT, SKY);
  assert.deepEqual(b, body(500, 500));
});

test("a ghost is lighter and faster than a gunship", () => {
  assert.ok(GHOST_FLIGHT.topSpeed > GUNSHIP_FLIGHT.topSpeed);
  const toTop = (tuning: FlightTuning): number =>
    ticksUntil(
      body(50_000, 50_000),
      RIGHT,
      (s) => s.vx >= tuning.topSpeed - 1e-9,
      tuning,
    );
  assert.ok(toTop(GHOST_FLIGHT) < toTop(GUNSHIP_FLIGHT));
  // Ghosts fly through rock: a field that is never solid.
  const rock = field(2000, 2000, () => true);
  const ghost = body(1000, 1000);
  for (let i = 0; i < 120; i++)
    flyStep(ghost, RIGHT, GHOST_FLIGHT, openSky(rock.width, rock.height));
  assert.ok(ghost.x > 1200);
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
        for (let i = 0; i < (tuning === rocket ? 60 : 240); i++) {
          flyStep(b, bits, tuning, world);
          assert.ok(side(b), `${label}: crossed at ${b.x}, ${b.y}`);
          assert.ok(penetration(b, tuning.radius, rule) <= 0, label);
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
    const impact = flyStep(skimmer, DOWN | RIGHT, GUNSHIP_FLIGHT, world);
    touched ||= impact > 0;
    if (touched) assert.equal(skimmer.vy, 0, `tick ${i}`);
    assert.ok(skimmer.y >= lastY && skimmer.y + R <= 600);
    lastY = skimmer.y;
  }
  assert.ok(touched);
  assert.ok(skimmer.vx > 150, `vx ${skimmer.vx}`);
  assert.ok(600 - (skimmer.y + R) < GAP, "resting on the floor");
});

test("corners: a ship settles into an inside corner and a ledge stops level flight until it climbs", () => {
  const corner: CellRule = (cx, cy) => cx >= 150 || cy >= 150; // walls at x = 600 and y = 600
  const box = field(1000, 1000, corner);
  const b = body(300, 300);
  for (let i = 0; i < 300; i++) {
    flyStep(b, DOWN | RIGHT, GUNSHIP_FLIGHT, box);
    assert.ok(penetration(b, R, corner) <= 0);
  }
  assert.deepEqual([b.vx, b.vy], [0, 0]);
  assert.ok(600 - (b.x + R) < GAP && 600 - (b.y + R) < GAP);

  // A block at [400, 480) x [400, 480); the ship flies level 20 px above its top, so its rim meets the corner.
  const ledge: CellRule = (cx, cy) =>
    cx >= 100 && cx < 120 && cy >= 100 && cy < 120;
  const world = field(1000, 1000, ledge);
  const level = body(300, 380);
  for (let i = 0; i < 180; i++) {
    flyStep(level, RIGHT, GUNSHIP_FLIGHT, world);
    assert.ok(penetration(level, R, ledge) <= 0, `tick ${i}`);
  }
  assert.ok(level.x < 400, "stopped by the corner");
  const climber = body(300, 380);
  for (let i = 0; i < 300; i++) {
    flyStep(climber, RIGHT | UP, GUNSHIP_FLIGHT, world);
    assert.ok(penetration(climber, R, ledge) <= 0, `tick ${i}`);
  }
  assert.ok(climber.x > 500, "climbed over");
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

test("a buried body is pushed out, and one buried too deep flies out instead of being stuck", () => {
  const ground: CellRule = (_cx, cy) => cy >= 100; // y >= 400
  const world = field(1000, 1000, ground);
  const shallow = body(500, 400 - R + 10); // 10 px into the ground
  flyStep(shallow, 0, GUNSHIP_FLIGHT, world);
  assert.ok(penetration(shallow, R, ground) <= 0);
  assert.ok(400 - (shallow.y + R) < PUSH_OUT_SLACK);
  // An islet smaller than the ship, wholly inside its circle, counts as buried too.
  const islet: CellRule = (cx, cy) => cx === 125 && cy === 125; // [500, 504)²
  const around = body(502, 502);
  for (let i = 0; i < 120; i++)
    flyStep(around, RIGHT, GUNSHIP_FLIGHT, field(1000, 1000, islet));
  assert.ok(around.x > 502 + 2 * R, `escaped the islet: x ${around.x}`);
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
const PUSH_OUT_SLACK = 2.5;

test("separation pushes overlapping ships apart symmetrically and damps their approach", () => {
  const world = openSky(2000, 2000);
  const a = body(1000, 1000, 50, 10),
    b = body(1040, 1010, -70, 30);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const before = { a: { ...a }, b: { ...b } };
  separate([a, b], R, world);
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
  separate([c, e], R, world);
  assert.deepEqual([c.vx, e.vx], [-20, 20]);
  assert.ok(Math.abs(e.x - c.x - 2 * R) < 1e-9);

  // Exactly on top of each other: they part along x, the later one to the right.
  const p = body(500, 500),
    q = body(500, 500);
  separate([p, q], R, world);
  assert.deepEqual([p.x, p.y, q.x, q.y], [500 - R, 500, 500 + R, 500]);
});

test("separation never pushes a ship into rock: the free one takes the whole push", () => {
  const wall: CellRule = (cx) => cx < 100; // rock left of x = 400
  const world = field(2000, 2000, wall);
  const pinned = body(400 + R + 0.01, 1000),
    other = body(400 + R + 20, 1000);
  separate([pinned, other], R, world);
  assert.ok(penetration(pinned, R, wall) <= 0);
  assert.ok(pinned.x >= 400 + R);
  assert.ok(Math.abs(other.x - pinned.x - 2 * R) < 1e-6);
  // Wedged between two walls with no room: nobody enters rock, nobody tunnels.
  const slot: CellRule = (cx) => cx < 100 || cx >= 125; // free x in [400, 500), narrower than two ships
  const narrow = field(2000, 2000, slot);
  const left = body(400 + R, 1000),
    right = body(500 - R, 1000);
  separate([left, right], R, narrow);
  for (const s of [left, right]) {
    assert.ok(penetration(s, R, slot) <= 0);
    assert.ok(s.x >= 400 + R - 1e-9 && s.x <= 500 - R + 1e-9);
  }
  // A cluster of four in open sky ends with no overlap.
  const cluster = [
    body(1000, 1000),
    body(1010, 1000),
    body(1005, 1012),
    body(995, 990),
  ];
  separate(cluster, R, openSky(2000, 2000));
  for (let i = 0; i < cluster.length; i++)
    for (let j = i + 1; j < cluster.length; j++) {
      const s = cluster[i]!,
        t = cluster[j]!;
      assert.ok(Math.hypot(t.x - s.x, t.y - s.y) >= 2 * R - 1e-6, `${i}-${j}`);
    }
});

/** A small cave: floor, two walls, a pillar and an islet. */
const cave: CellRule = (cx, cy) =>
  cy >= 220 ||
  cx < 4 ||
  cx >= 296 ||
  (cx >= 140 && cx < 150 && cy >= 120) ||
  (cx >= 60 && cx < 80 && cy >= 60 && cy < 70);

/** Three ships flying seeded random inputs in the cave, separated every step; their state after every step. */
function replay(start: FlightBody[], inputs: readonly number[][]): number[][] {
  const world = field(1200, 1000, cave);
  const trace: number[][] = [];
  for (const tick of inputs) {
    start.forEach((b, i) => flyStep(b, tick[i]!, GUNSHIP_FLIGHT, world));
    separate(start, R, world);
    trace.push(start.flatMap((b) => [b.x, b.y, b.vx, b.vy]));
    for (const b of start) assert.ok(penetration(b, R, cave) <= 0);
  }
  return trace;
}

test("replay: the same inputs give identical floats, also from a mid-run snapshot", () => {
  let seed = 12345;
  const next = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed >>> 16;
  };
  const inputs = Array.from({ length: 900 }, () =>
    [0, 1, 2].map(() => next() & INPUT_MASK),
  );
  const start = (): FlightBody[] => [
    body(200, 200),
    body(400, 300),
    body(900, 400),
  ];
  const first = replay(start(), inputs);
  const second = replay(start(), inputs);
  assert.deepEqual(second, first);
  // Roll back to tick 450 from a structured clone of the state and replay the rest.
  const ships = start();
  replay(ships, inputs.slice(0, 450));
  const snapshot = structuredClone(ships);
  assert.deepEqual(replay(snapshot, inputs.slice(450)), first.slice(450));
});

test("sub-steps never exceed MAX_SUBSTEP, half a terrain cell", () => {
  assert.ok(MAX_SUBSTEP <= CELL / 2);
});

test("flight and input use only deterministic arithmetic", () => {
  for (const file of ["flight.ts", "input.ts"]) {
    const path = fileURLToPath(
      new URL(`../src/engine/${file}`, import.meta.url),
    );
    assert.deepEqual(deterministicViolations(syntax(path)), [], file);
  }
});
