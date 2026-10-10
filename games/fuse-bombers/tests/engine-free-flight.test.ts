import test from "node:test";
import assert from "node:assert/strict";
import {
  createRound,
  DOWN,
  FIRE,
  GUNSHIP_FLIGHT,
  isLoaded,
  LEFT,
  predictTrajectory,
  RIGHT,
  step,
  UP,
  type RoundState,
} from "../src/engine/index.js";
import { circleOverlapsSolid, fillRect } from "../src/engine/grid.js";
import { clearSky, openWorld } from "./engine-helpers.js";

// Free flight inside the round: held input bits, fire on the rising edge, gunships flying against the round's rock.

/** Steps `ticks` times with `held`; returns the number of volleys fired. */
function hold(s: RoundState, held: number[], ticks = 1): number {
  let fired = 0;
  for (let i = 0; i < ticks; i++)
    for (const e of step(s, held)) if (e.type === "fired") fired++;
  return fired;
}

/** A 2-player round with no rock, gates or crates, castle 0 at (x, y) and castle 1 far away. */
function open(x = 1000, y = 1000): RoundState {
  const s = createRound({
    seed: 5,
    playerCount: 2,
    tuning: { spreadDeg: 0, speedJitter: 0 },
  });
  clearSky(s);
  openWorld(s);
  Object.assign(s.castles[0]!, { x, y });
  Object.assign(s.castles[1]!, { x: 3800, y: 1000 });
  return s;
}

test("fire fires on its rising edge: holding never fires again, a fresh press fires once loaded, from the moving ship", () => {
  const s = open();
  const c = s.castles[0]!;
  assert.equal(hold(s, [FIRE], 300), 0, "held from before it loaded");
  assert.ok(isLoaded(c));
  hold(s, [RIGHT], 30);
  // The guide is drawn from the ship as it is now, and the volley leaves from there although the ship moves on.
  const guide = predictTrajectory(s, 0);
  assert.equal(hold(s, [RIGHT | FIRE]), 1, "a fresh press fires");
  assert.deepEqual(
    [s.rockets[0]?.x, s.rockets[0]?.y],
    [guide.points[1]?.x, guide.points[1]?.y],
  );
  assert.equal(hold(s, [RIGHT | FIRE], 400), 0, "held through the reload");
  assert.ok(isLoaded(c));
  assert.equal(hold(s, [0]) + hold(s, [FIRE]), 1, "released and pressed again");
});

test("held bits are validated: an entry that is not an integer of the five bits holds nothing", () => {
  const s = open();
  const c = s.castles[0]!;
  c.reloadTicks = 0;
  const bad: unknown[] = [
    NaN,
    -1,
    1.5,
    32,
    33,
    Infinity,
    "24",
    null,
    undefined,
  ];
  for (const value of [...bad, []]) {
    const held = (Array.isArray(value) ? value : [value]) as number[];
    assert.equal(hold(s, held, 3), 0, `fired on ${String(value)}`);
    assert.deepEqual([c.x, c.y, c.thrust, s.lastHeld[0]], [1000, 1000, 0, 0]);
  }
  assert.equal(
    hold(s, [RIGHT | FIRE, 0, UP]),
    1,
    "valid input works; seats past the last are ignored",
  );
  assert.ok(c.x > 1000 && c.thrust === RIGHT);
});

test("gunships fly on their held directions, stop at rock and slide along it, and never fall", () => {
  const s = open();
  const c = s.castles[0]!;
  fillRect(s.terrain, 1200, 600, 1240, 1400); // a wall to the right
  hold(s, [RIGHT], 120);
  const r = GUNSHIP_FLIGHT.shape.radius;
  assert.ok(c.x > 1150 && c.x <= 1200 - r, `stopped by the wall at ${c.x}`);
  assert.ok(Math.abs(c.vx) < 1 && c.thrust === RIGHT);
  const [x, y] = [c.x, c.y];
  hold(s, [RIGHT | DOWN], 60);
  assert.ok(c.y > y + 80 && Math.abs(c.x - x) < 2, "slides down along it");
  assert.equal(circleOverlapsSolid(s.terrain, c.x, c.y, r), false);
  hold(s, [0], 180);
  const rest = [c.x, c.y];
  hold(s, [0], 120);
  assert.deepEqual(
    [c.vx, c.vy, c.x, c.y],
    [0, 0, ...rest],
    "at rest, no gravity",
  );
});

test("gunships that fly into each other are parted and never overlap", () => {
  const s = open();
  const [a, b] = s.castles;
  assert.ok(a && b);
  Object.assign(b, { x: 1200, y: 1010 });
  let closest = Infinity;
  for (let i = 0; i < 150; i++) {
    hold(s, [RIGHT, LEFT]);
    closest = Math.min(closest, Math.hypot(b.x - a.x, b.y - a.y));
  }
  assert.ok(closest >= 2 * GUNSHIP_FLIGHT.shape.radius - 1e-6, `${closest}`);
  assert.ok(b.x - a.x < 70, "they met");
});

test("a launch with rock on the barrel blows up at the wall instead of starting beyond it; the guide agrees", () => {
  const s = open(1000, 1100);
  const c = s.castles[0]!;
  fillRect(s.terrain, 900, 956, 1100, 964); // a thin ceiling the barrel can reach through
  hold(s, [UP], 120); // flown up against it, the pivot is in the ceiling
  assert.ok(c.y < 1000 && c.y > 990, `${c.y}`);
  c.reloadTicks = 0;
  c.angle = Math.PI / 2;
  const guide = predictTrajectory(s, 0);
  assert.equal(guide.impact.kind, "terrain");
  assert.equal(guide.impact.tick, 0);
  assert.equal(guide.points.length, 1);
  const events = step(s, [FIRE]);
  const crater = events.find((e) => e.type === "crater");
  assert.ok(
    crater && crater.y > 956 && crater.y < 968,
    "it blew up in the ceiling",
  );
  assert.deepEqual([crater.x, crater.y], [guide.impact.x, guide.impact.y]);
  assert.ok(
    s.rockets.every((r) => r.y > 964),
    "nothing started above it",
  );
  assert.equal(c.hp, c.maxHp, "own blasts never hurt");
});
