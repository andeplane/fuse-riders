import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { BASE_STATS, config } from "../src/game/sim/config.js";
import { NEUTRAL_INPUT } from "../src/game/sim/input.js";
import { stepDrones, type Drone } from "../src/game/sim/items.js";
import { createRace, step, type RaceState } from "../src/game/sim/race.js";
import { parseTrack } from "../src/game/sim/track.js";
import { createTruck, type Truck } from "../src/game/sim/truck.js";
import { defined } from "./fixtures/defined.js";

const load = (n: string) =>
  parseTrack(
    JSON.parse(readFileSync(`games/fuse-drivers/tracks/${n}.tmj`, "utf8")),
    n,
  );
const sidewinder = load("sidewinder");
const bridge = defined(sidewinder.bridges[0]);
const racing = (n: number): RaceState => ({
  ...createRace(sidewinder, 1, Array(n).fill(BASE_STATS)),
  phase: "racing",
  tick: 100,
});
const at = (
  t: Truck,
  x: number,
  y: number,
  heading: number,
  extra: Partial<Truck> = {},
): Truck => ({ ...t, x, y, heading, speed: BASE_STATS.topSpeed, ...extra });

test("the parser accepts every committed track and variant", () => {
  const names = readdirSync("games/fuse-drivers/tracks")
    .filter((f) => f.endsWith(".tmj"))
    .map((f) => f.replace(".tmj", ""));
  assert.ok(names.length >= 9);
  for (const n of names) assert.ok(load(n).checkpoints.length >= 8, n);
  assert.equal(bridge.entry, "top");
});

test("entering the deck from its entry side sets onBridge; the under lane does not; leaving clears it", () => {
  let s = racing(1);
  const cx = (bridge.x0 + bridge.x1) / 2,
    cy = (bridge.y0 + bridge.y1) / 2;
  // From above, heading down: deck.
  s = {
    ...s,
    trucks: [at(defined(s.trucks[0]), cx, bridge.y0 - 5, Math.PI / 2)],
  };
  let r = step(s, [NEUTRAL_INPUT], sidewinder);
  assert.equal(defined(r.state.trucks[0]).onBridge, true);
  // Keep driving down until it leaves the rectangle: cleared.
  for (let i = 0; i < 40 && defined(r.state.trucks[0]).onBridge; i++)
    r = step(r.state, [NEUTRAL_INPUT], sidewinder);
  assert.equal(defined(r.state.trucks[0]).onBridge, false);
  assert.ok(defined(r.state.trucks[0]).y > bridge.y1);
  // From the right, heading left: under lane, flag stays off and the under walls still confine it.
  let u = racing(1);
  u = { ...u, trucks: [at(defined(u.trucks[0]), bridge.x1 + 5, cy, Math.PI)] };
  let ur = step(u, [NEUTRAL_INPUT], sidewinder);
  assert.equal(defined(ur.state.trucks[0]).onBridge, false);
  for (let i = 0; i < 30; i++) ur = step(ur.state, [NEUTRAL_INPUT], sidewinder);
  assert.ok(
    Math.abs(defined(ur.state.trucks[0]).y - cy) < 40,
    "under-lane truck stays in its lane through the crossing",
  );
});

test("a deck truck is held by the railings and never drops onto the under lane sideways", () => {
  let s = racing(1);
  const cx = (bridge.x0 + bridge.x1) / 2;
  s = {
    ...s,
    trucks: [at(defined(s.trucks[0]), cx, bridge.y0 - 5, Math.PI / 2)],
  };
  let r = step(s, [NEUTRAL_INPUT], sidewinder);
  assert.equal(defined(r.state.trucks[0]).onBridge, true);
  for (let i = 0; i < 12; i++)
    r = step(r.state, [{ ...NEUTRAL_INPUT, right: true }], sidewinder);
  const t = defined(r.state.trucks[0]);
  assert.ok(
    t.onBridge || t.y > bridge.y1,
    "either still on the deck or exited at the bottom",
  );
  assert.ok(
    t.x > bridge.x0 && t.x < bridge.x1,
    `x ${t.x} stayed between the railings`,
  );
});

test("a missile fired from the deck drops to ground level once past the bridge", () => {
  let s = racing(2);
  const cx = (bridge.x0 + bridge.x1) / 2;
  // An armed missile heading down the deck, and a ground truck just past the deck exit.
  const shooter = at(
    defined(s.trucks[0]),
    bridge.x0 - 200,
    bridge.y0 - 200,
    0,
    { speed: 0 },
  );
  const victim = at(defined(s.trucks[1]), cx - 6, bridge.y1 + 24, Math.PI / 2, {
    speed: 0,
  });
  s = {
    ...s,
    trucks: [shooter, victim],
    missiles: [
      {
        id: 1,
        owner: 0,
        x: cx,
        y: bridge.y1 - 50,
        heading: Math.PI / 2,
        launchedTick: 0,
        target: null,
        onBridge: true,
      },
    ],
    nextId: 2,
  };
  let r = step(
    s,
    [NEUTRAL_INPUT, { ...NEUTRAL_INPUT, brake: true }],
    sidewinder,
  );
  assert.equal(defined(r.state.missiles[0]).onBridge, true);
  let hit = false;
  for (let i = 0; i < 40 && !hit; i++) {
    r = step(
      r.state,
      [NEUTRAL_INPUT, { ...NEUTRAL_INPUT, brake: true }],
      sidewinder,
    );
    hit = r.events.some((e) => e.type === "hit");
  }
  assert.ok(hit, "missile left the deck and hit the ground truck");
});

test("a drone zaps from its own position, once per second per truck, and dies with its owner", () => {
  const owner = at(createTruck(0, 0, 0, 0), 500, 500, 0, { speed: 0 });
  const d: Drone = {
    id: 1,
    owner: 0,
    launchedTick: 100,
    zaps: 0,
    lastZapTick: [0, 0],
  };
  const r = config.items.drone.radius;
  const near = at(createTruck(1, 0, 0, 0), 500 + r, 500, 0); // where the drone starts its orbit
  const opposite = at(createTruck(1, 0, 0, 0), 500 - r - 20, 500, 0); // 140 u from the owner, 200 u from the drone
  assert.equal(stepDrones([d], [owner, near], 100).hits.length, 1);
  assert.equal(stepDrones([d], [owner, opposite], 100).hits.length, 0);
  const again = stepDrones(
    [{ ...d, lastZapTick: [0, 100] }],
    [owner, near],
    110,
  );
  assert.equal(again.hits.length, 0);
  assert.equal(
    stepDrones([d], [{ ...owner, respawnAtTick: 200 }, near], 100).drones
      .length,
    0,
  );
});

test("an oil slick makes the truck slide but keeps the tile underneath working", () => {
  const refinery = load("refinery");
  let s: RaceState = { ...createRace(refinery, 1), phase: "racing", tick: 100 };
  const pad = (() => {
    for (let i = 0; i < refinery.surface.length; i++)
      if (refinery.surface[i] === "boost")
        return {
          x: (i % refinery.cols) * 32 + 16,
          y: Math.floor(i / refinery.cols) * 32 + 16,
        };
    throw new Error("no pad");
  })();
  s = {
    ...s,
    trucks: [at(defined(s.trucks[0]), pad.x, pad.y, 0, { speed: 0 })],
    oils: [{ id: 9, owner: 0, x: pad.x, y: pad.y, droppedTick: 100 }],
  };
  const r = step(s, [NEUTRAL_INPUT], refinery);
  assert.ok(defined(r.state.trucks[0]).oilUntilTick > r.state.tick);
  assert.ok(
    defined(r.state.trucks[0]).padUntilTick > r.state.tick,
    "the boost pad still fires under the slick",
  );
});
