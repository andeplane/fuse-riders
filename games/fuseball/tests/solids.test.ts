import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  DOWN,
  LEFT,
  MAP_IDS,
  RIGHT,
  UP,
  botInput,
  stepWorld,
  stepsPerTick,
  type MapId,
  type World,
} from "../src/engine/index.js";
import { apart } from "../src/engine/collide.js";
import { boxesOf, mapOf } from "../src/engine/maps.js";
import { SUB, abs, isqrt } from "../src/engine/math.js";
import { BALL_R, RIDER_R } from "../src/engine/tuning.js";
import {
  at,
  ballAt,
  fresh,
  held,
  place,
  playing,
  scripted,
} from "./fixtures/world.js";

/**
 * Nothing pushes a body into a solid: whatever riders and bubbles do to the ball, and bubbles and riders to a rider,
 * the solids have the last word on every step.
 */

/** How far `body`'s edge is inside the nearest solid, in sub-units: 0 when it only touches; its radius when its centre is in one. */
function sunk(
  world: World,
  body: { x: number; y: number },
  radius: number,
): number {
  const map = mapOf(world.mapId);
  let most = 0;
  for (const box of boxesOf(world.mapId)) {
    const { dx, dy } = apart(body.x, body.y, box.cx, box.cy, map),
      ex = abs(dx) > box.hw ? abs(dx) - box.hw : 0,
      ey = abs(dy) > box.hh ? abs(dy) - box.hh : 0,
      depth = ex === 0 && ey === 0 ? radius : radius - isqrt(ex * ex + ey * ey);
    if (depth > most) most = depth;
  }
  return most;
}
/** A hair of overlap is rounding (the solids push out by whole sub-units of a truncated distance). */
const HAIR = 8;
function assertClear(world: World, when: string): void {
  assert.ok(
    sunk(world, world.ball, BALL_R) <= HAIR,
    `${when}: the ball is in a solid at ${at(world.ball.x)}, ${at(world.ball.y)}`,
  );
  for (const rider of world.riders)
    assert.ok(
      sunk(world, rider, RIDER_R) < RIDER_R,
      `${when}: rider ${rider.slot}'s centre is in a solid at ${at(rider.x)}, ${at(rider.y)}`,
    );
}
/** Steps `count` times, checking the solids after every one. */
function run(
  world: World,
  count: number,
  inputs: ReadonlyMap<string, number> = new Map(),
): void {
  for (let i = 1; i <= count; i++) {
    stepWorld(world, inputs);
    assertClear(world, `step ${i}`);
  }
}
/** A world in play with rider B parked out of the way and the ball at rest at `(x, y)` pixels. */
function resting(mapId: MapId, x: number, y: number): World {
  const world = playing(mapId);
  ballAt(world, x, y);
  return world;
}

test("a rider landing square on a resting ball squirts it out along the floor instead of burying it", () => {
  const world = resting("gridlock", 320, 336);
  place(world, 0, 320, 300);
  run(world, 120);
  const { ball, riders } = world;
  assert.equal(at(ball.y), 336, "the ball is on the floor");
  assert.equal(at(riders[0].y), 335, "and so is the rider");
  assert.ok(riders[0].grounded);
  // Square on top there is no side to prefer: it goes the way the rider faces.
  assert.equal(riders[0].facing, 1);
  assert.ok(at(ball.x) - at(riders[0].x) >= 17, "clear of the rider");
  assert.equal(ball.touch, 0);

  // The mirror image goes the other way.
  const other = resting("gridlock", 320, 336);
  place(other, 0, 320, 300);
  other.riders[0].facing = -1;
  run(other, 120);
  assert.equal(at(other.ball.x) - 320, 320 - at(ball.x));
});

test("a rider coming down off-centre sends the ball away from them", () => {
  const world = resting("gridlock", 320, 336);
  place(world, 0, 326, 300);
  run(world, 240);
  assert.ok(at(world.ball.x) < 320 - 3, "it left to the left");
  assert.equal(at(world.ball.y), 336);
});

test("a rider driving down onto a ball on a thin platform cannot push it through", () => {
  for (const [mapId, x, y] of [
    ["gridlock", 320, 168],
    ["halo", 320, 192],
  ] as const) {
    const world = resting(mapId, x, y);
    place(world, 0, x, y - 38);
    world.riders[0].prev = BTN;
    for (let i = 1; i <= 240; i++) {
      stepWorld(world, held(DOWN | BTN));
      assertClear(world, `${mapId} step ${i}`);
      const over = abs(at(world.ball.x) - x) < 20;
      assert.ok(
        !over || at(world.ball.y) <= y,
        `${mapId} step ${i}: the ball went into the platform`,
      );
    }
    assert.ok(abs(at(world.ball.x) - x) > 8, `${mapId}: it was squeezed out`);
  }
});

test("a ball squeezed against a wall by a rider pops up it", () => {
  // Gridlock's seam wall: its left face is at x = 628 below the goal mouth.
  const world = resting("gridlock", 620, 336);
  place(world, 0, 590, 335);
  let top = 336;
  for (let i = 1; i <= 120; i++) {
    stepWorld(world, held(RIGHT));
    assertClear(world, `step ${i}`);
    top = Math.min(top, at(world.ball.y));
  }
  assert.ok(top < 330, "the ball left the corner upwards");
});

test("a body whose centre is inside a solid leaves by the nearest face that leads into the field", () => {
  const cases: [MapId, number, number, (x: number, y: number) => boolean][] = [
    // The floor and the ceiling on the field's edge have one way out.
    ["gridlock", 320, 352, (_x, y) => y === 336],
    ["gridlock", 320, 358, (_x, y) => y === 336],
    ["gridlock", 320, 8, (_x, y) => y >= 24 && y < 26],
    ["gridlock", 320, 3, (_x, y) => y >= 24 && y < 26],
    // So have the side walls of an arena that does not wrap sideways.
    ["downlink", 8, 180, (x) => x >= 20 && x < 21],
    ["downlink", 632, 180, (x) => x <= 620 && x > 619],
    // A floating platform lets go by whichever face is nearer.
    ["gridlock", 320, 179, (_x, y) => y <= 168 && y > 167],
    ["gridlock", 320, 184, (_x, y) => y >= 194 && y < 196],
  ];
  for (const [mapId, x, y, out] of cases) {
    const world = resting(mapId, x, y);
    stepWorld(world, new Map());
    assertClear(world, `${mapId} ${x},${y}`);
    assert.ok(
      out(at(world.ball.x), at(world.ball.y)),
      `${mapId} ${x},${y}: the ball came out at ${at(world.ball.x)}, ${at(world.ball.y)}`,
    );
    const rider = resting(mapId, 320, 100);
    place(rider, 0, x, y);
    stepWorld(rider, new Map());
    assertClear(rider, `${mapId} rider ${x},${y}`);
  }
});

/** Rider B's bubble at `(x, y)` pixels, hard for as long as B holds the button. */
function hardBubble(world: World, x: number, y: number): void {
  Object.assign(world.bubbles[1], {
    active: true,
    hard: true,
    x: x * SUB,
    y: y * SUB,
  });
}
const clearOf = (world: World): boolean => {
  const bubble = world.bubbles[1],
    { dx, dy } = apart(
      world.ball.x,
      world.ball.y,
      bubble.x,
      bubble.y,
      mapOf(world.mapId),
    );
  return Math.hypot(at(dx), at(dy)) >= 22;
};

test("a hard bubble held over a ball on the floor squeezes it out sideways and stays", () => {
  const world = resting("gridlock", 300, 336);
  hardBubble(world, 300, 326);
  run(world, 120, held(0, BTN));
  assert.ok(clearOf(world), "the ball is out from under the bubble");
  assert.ok(world.bubbles[1].active && world.bubbles[1].hard);
  assert.equal(at(world.ball.y) <= 336, true);
  // Free again: the bubble is not still bumping it.
  const bounces = world.ball.bounces;
  run(world, 120, held(0, BTN));
  assert.ok(world.ball.bounces - bounces < 10);
});

test("a hard bubble that pins the ball in a corner pops rather than hold it there", () => {
  const world = resting("gridlock", 620, 336);
  hardBubble(world, 608, 320);
  run(world, 30, held(0, BTN));
  assert.equal(world.bubbles[1].active, false, "the bubble gave");
  const bounces = world.ball.bounces;
  run(world, 600, held(0, BTN));
  assert.ok(world.ball.bounces - bounces < 10, "nothing keeps bumping it");
  assert.equal(at(world.ball.y), 336);
});

test("a hard bubble beside a wall with room for the ball is an ordinary bumper", () => {
  const world = resting("gridlock", 600, 300);
  hardBubble(world, 560, 300);
  world.ball.vx = -2 * SUB;
  run(world, 400, held(0, BTN));
  assert.ok(world.bubbles[1].active && world.bubbles[1].hard);
});

test("fuzz: on every map, whoever plays, no step leaves the ball or a rider's centre in a solid", () => {
  const BITS = [
    0,
    LEFT,
    RIGHT,
    DOWN,
    UP,
    BTN,
    LEFT | BTN,
    RIGHT | BTN,
    DOWN | BTN,
    LEFT | DOWN,
    RIGHT | DOWN,
    LEFT | DOWN | BTN,
    RIGHT | DOWN | BTN,
    UP | BTN,
  ];
  const TICKS = 2400;
  for (const mapId of MAP_IDS)
    for (let game = 0; game < 6; game++) {
      const world = fresh(mapId),
        next = scripted(977 * (game + 1) + mapId.length),
        hold = [0, 0];
      // Game 0 is the bot against itself, 1 and 2 the bot against a masher, the rest two mashers.
      const bot = (slot: number) =>
        game === 0 || (game < 3 && slot === game - 1);
      for (let tick = 1; tick <= TICKS && world.phase !== "over"; tick++) {
        world.riders.forEach((rider, slot) => {
          if (bot(slot)) hold[slot] = botInput(world, rider);
          else if (next() % 10 < 3) hold[slot] = BITS[next() % BITS.length]!;
        });
        const inputs = held(hold[0]!, hold[1]!);
        for (let left = stepsPerTick(world); left > 0; left--) {
          stepWorld(world, inputs);
          assertClear(world, `${mapId} game ${game} step ${world.step}`);
        }
      }
    }
});
