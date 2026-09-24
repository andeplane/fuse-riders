import test from "node:test";
import assert from "node:assert/strict";
import { MAPS, type MapId } from "../src/engine/maps.js";
import {
  createWorld,
  DEFAULT_TUNING,
  NEUTRAL,
  S,
  type World,
} from "../src/engine/world.js";
import { step } from "../src/engine/step.js";
import { stepCombat } from "../src/engine/combat.js";
import { supported, overlaps } from "../src/engine/collision.js";
import { decodeWorld, parseTuning } from "../src/engine/codec.js";
import { toView } from "../src/engine/view.js";
import {
  createArena,
  syncKeepers,
  stepArena,
  encodeArena,
  decodeArena,
} from "../src/engine/arena.js";
import { interpolate } from "../src/render/interpolation.js";
import { Mesh } from "./fixtures/mesh.js";
import {
  createRoom,
  foldTick,
  encode,
  decode,
  hash,
  type Entry,
} from "../src/online/game.js";
import { JOIN, ACTION, SETTINGS, type StreamEntries } from "fuse-netcode";

const tuning = { ...DEFAULT_TUNING, map: "crossroads" as const };
const ids: MapId[] = ["belfry", "crossroads"];

test("a target crossing a ledge edge remains a valid checkpoint on both maps", () => {
  for (const map of ids) {
    const world = createWorld({ ...DEFAULT_TUNING, map, experiment: "target" });
    const right = map === "belfry" ? 520 : 900;
    world.tick = 1;
    world.combat.hits = 1;
    world.combat.impact = {
      tick: 1,
      x: world.combat.target!.x,
      y: world.combat.target!.feet - 28 * S,
    };
    Object.assign(world.combat.target!, { x: (right + 14) * S, vx: 4 * S });
    assert.ok(decodeWorld(world));
    step(world);
    assert.ok(world.combat.target!.x > (right + 16) * S);
    const restored = decodeWorld(world);
    assert.ok(
      restored,
      "solid target solver may retain grounded on the tick it leaves a ledge",
    );
    for (let i = 0; i < 45; i++) {
      step(world);
      step(restored);
      assert.deepEqual(restored, world);
      assert.ok(decodeWorld(world));
    }
  }
});

test("both maps have supported distinct spawns, stable idle and map-specific props", () => {
  for (const map of ids) {
    const positions = new Set<number>();
    for (let slot = 0; slot < 5; slot++) {
      const world = createWorld({ ...DEFAULT_TUNING, map }, slot);
      const x = world.x,
        feet = world.feet;
      positions.add(x);
      assert.ok(supported(x, feet, MAPS[map].platforms));
      assert.equal(overlaps(x, feet, MAPS[map].platforms), false);
      for (let i = 0; i < 120; i++) step(world);
      assert.equal(world.x, x);
      assert.equal(world.feet, feet);
      assert.ok(decodeWorld(world));
      assert.deepEqual(toView(world).platforms, MAPS[map].platforms);
    }
    assert.equal(positions.size, 5);
    const target = createWorld({
      ...DEFAULT_TUNING,
      map,
      experiment: "target",
    });
    assert.ok(decodeWorld(target));
    target.combat.target!.respawn = 1;
    stepCombat(target);
    assert.deepEqual(
      [target.combat.target!.x, target.combat.target!.feet],
      [MAPS[map].target[0] * S, MAPS[map].target[1] * S - 1],
    );
    for (let i = 0; i < 120; i++) step(target);
    assert.ok(decodeWorld(target));
    const ball = createWorld({ ...DEFAULT_TUNING, map, experiment: "ball" });
    for (let i = 0; i < 300; i++) {
      step(ball);
      assert.ok(decodeWorld(ball), `${map}: ball bounds at ${i}`);
    }
  }
  const sorted = MAPS.crossroads.spawns.map(([x]) => x).sort((a, b) => a - b);
  assert.ok(sorted.slice(1).every((x, i) => x - sorted[i]! >= 300));
});

test("selected terrain owns hook attachment, checkpoint validation and drop landings", () => {
  const world = createWorld(tuning, 2);
  world.input = { ...NEUTRAL, fire: true, aimX: 800, aimY: 0 };
  for (let i = 0; i < 10; i++) step(world);
  assert.equal(world.hook.phase, "attached");
  assert.equal(world.hook.platform, 6);
  const restored = decodeWorld(world)!;
  assert.ok(restored);
  for (let i = 0; i < 80; i++) {
    world.input.fire = restored.input.fire = i < 25;
    step(world);
    step(restored);
    assert.deepEqual(world, restored);
  }
  const supportedWorld = createWorld(tuning, 1);
  const wrongMap = structuredClone(supportedWorld);
  wrongMap.tuning.map = "belfry";
  assert.equal(
    decodeWorld(wrongMap),
    undefined,
    "belfry has no right starting pad",
  );
  const attached = createWorld(tuning, 2);
  attached.input = { ...NEUTRAL, fire: true, aimX: 800, aimY: 0 };
  for (let i = 0; i < 10; i++) step(attached);
  attached.tuning.map = "belfry";
  assert.equal(
    decodeWorld(attached),
    undefined,
    "attachment cannot migrate to a different map surface",
  );
  assert.equal(parseTuning({ ...tuning, map: "forged" }), undefined);
  const { map: _map, ...oldSettings } = tuning;
  assert.equal(parseTuning(oldSettings), undefined);
  // A real ordinary-input jump reaches the central lower ledge; a fresh drop returns to its pad.
  const jumper = createWorld(tuning, 2);
  jumper.input.jump = true;
  for (let i = 0; i < 60; i++) step(jumper);
  assert.equal(jumper.feet, 660 * S - 1);
  jumper.input = { ...NEUTRAL, drop: true };
  for (let i = 0; i < 60; i++) step(jumper);
  assert.equal(jumper.feet, 810 * S - 1);
  assert.equal(jumper.deaths, 0);
});

test("Crossroads splitting balls stay inside the selected field and reject belfry-only bounds", () => {
  const world = createWorld({ ...tuning, experiment: "ball" }, 2);
  world.input = { ...NEUTRAL, fire: true, aimX: 810, aimY: 700 };
  for (let i = 0; i < 25; i++) {
    step(world);
    assert.ok(decodeWorld(world));
  }
  assert.equal(world.combat.hits, 1);
  assert.equal(world.combat.balls.length, 2);
  const invalid = structuredClone(world);
  invalid.combat.balls[0]!.x = 1300 * S;
  assert.equal(decodeWorld(invalid), undefined);
  const restored = decodeWorld(world)!;
  for (let i = 0; i < 150; i++) {
    step(world);
    step(restored);
    assert.deepEqual(restored, world);
    assert.ok(decodeWorld(world));
  }
});

/** Ordinary controls only. The steering helper steers toward a waypoint, never sets position/velocity. */
function jumpTo(world: World, x: number, y: number): void {
  world.input = { ...NEUTRAL };
  step(world);
  for (let i = 0; i < 90; i++) {
    const error = x - world.x / S;
    world.input = {
      ...NEUTRAL,
      jump: true,
      move: Math.abs(error) > 12 ? (error > 0 ? 1 : -1) : 0,
    };
    step(world);
    if (world.grounded && world.feet === y * S - 1) return;
  }
  assert.fail(
    `Failed waypoint ${x},${y}; ended ${world.x / S},${world.feet / S}`,
  );
}
test("Crossroads outer routes can be climbed with ordinary jumping from both sides", () => {
  for (const [slot, sign] of [
    [0, 1],
    [1, -1],
  ] as const) {
    const world = createWorld(tuning, slot);
    const x = (left: number) => (sign === 1 ? left : 1600 - left);
    jumpTo(world, x(370), 660);
    jumpTo(world, x(300), 510);
    jumpTo(world, x(400), 360);
    world.input = { ...NEUTRAL, move: sign };
    for (let i = 0; i < 60 && (world.x / S - x(560)) * sign < 0; i++)
      step(world);
    world.input = { ...NEUTRAL };
    for (let i = 0; i < 12; i++) step(world);
    jumpTo(world, x(700), 210);
    assert.equal(world.deaths, 0);
    assert.ok(decodeWorld(world));
  }
});

test("competitive Crossroads replay and reversed membership order converge through respawns/results", () => {
  for (const rules of ["elimination", "score"] as const) {
    const a = createArena({ ...tuning, rules });
    const b = createArena({ ...tuning, rules });
    const members = Array.from({ length: 5 }, (_, slot) => ({
      id: `p${slot}`,
      slot,
      connected: true,
      generation: 1,
    }));
    syncKeepers(a, members);
    syncKeepers(b, [...members].reverse());
    for (let tick = 0; tick < 500; tick++) {
      for (const arena of [a, b])
        for (const keeper of arena.keepers)
          keeper.world.input = {
            ...NEUTRAL,
            move: keeper.slot % 2 ? 1 : -1,
            fire: tick % 90 < 30,
            aimX: 800,
            aimY: 210,
          };
      stepArena(a);
      stepArena(b);
      assert.deepEqual(encodeArena(a), encodeArena(b));
      if (tick % 30 === 0) assert.ok(decodeArena(encodeArena(a)));
    }
    assert.ok(a.keepers.some((keeper) => keeper.world.deaths > 0));
  }
});

test("map switch discards held and old-round inputs atomically and rejects corrupt room maps", () => {
  const room = createRoom("first", DEFAULT_TUNING);
  const entries: Entry[] = [
    [1, 1, JOIN, "a", "A", 0, "keeper", 1],
    [2, 1, ACTION, "start", "match"],
  ];
  const streams = new Map<string, StreamEntries<Entry>>([
    ["a", { generation: 1, entries }],
  ]);
  foldTick(room, "a", streams);
  const oldRound = room.round;
  entries.push([
    3,
    2,
    0,
    room.matchId,
    oldRound,
    { ...NEUTRAL, move: 1, fire: true },
  ]);
  foldTick(room, "a", streams);
  entries.push(
    [4, 3, SETTINGS, tuning],
    [5, 3, 0, room.matchId, oldRound, { ...NEUTRAL, move: 1, fire: true }],
  );
  foldTick(room, "a", streams);
  assert.equal(room.round, oldRound + 1);
  assert.equal(room.settings.map, "crossroads");
  assert.equal(room.simulation.keepers[0]!.world.x, 180 * S);
  assert.equal(room.simulation.keepers[0]!.world.hook.phase, "ready");
  assert.equal(room.simulation.keepers[0]!.world.input.move, 0);
  assert.equal(hash(decode(encode(room), room.tick)!), hash(room));
  const raw = encode(room);
  raw[3] = { ...room.settings, map: "belfry" };
  const healthy = hash(room);
  assert.equal(decode(raw, room.tick), undefined);
  assert.equal(hash(room), healthy);
  const before = toView(createWorld());
  const after = toView(createWorld(tuning));
  assert.equal(
    interpolate(before, after, 0),
    after,
    "map switch is never blended",
  );
});

test("map selection survives loss/reorder/duplicates, peer refresh and manager succession", () => {
  const mesh = new Mesh();
  const a = mesh.join("a");
  mesh.run(500);
  a.command({ type: "join", name: "A" });
  mesh.run(500);
  const b = mesh.join("b");
  mesh.run(1500);
  b.command({ type: "join", name: "B" });
  mesh.run(1000);
  a.command({ type: "action", action: "start" });
  mesh.run(1000);
  let packets = 0;
  mesh.fast = () =>
    ++packets % 7 === 0
      ? { drop: true }
      : {
          delay: packets % 3 ? 20 : 160,
          duplicate: packets % 5 ? undefined : 190,
        };
  a.command({ type: "settings", settings: tuning });
  mesh.run(2000);
  a.input({ ...NEUTRAL, jump: true });
  b.input({ ...NEUTRAL, fire: true, aimX: 1240, aimY: 510 });
  mesh.run(400);
  a.clear();
  b.clear();
  mesh.run(2500);
  const common = Math.min(a.state()!.tick, b.state()!.tick) - 10;
  assert.equal(a.hashAt(common), b.hashAt(common));
  assert.equal(b.state()!.settings.map, "crossroads");
  b.stop();
  mesh.run(1200);
  const returning = mesh.join("b");
  mesh.run(2500);
  assert.equal(returning.state()!.settings.map, "crossroads");
  assert.equal(
    returning.state()!.simulation.keepers[1]!.world.hook.phase,
    "ready",
  );
  a.stop();
  mesh.run(1500);
  assert.equal(
    returning.command({ type: "settings", settings: DEFAULT_TUNING }),
    true,
  );
  mesh.run(1000);
  assert.equal(returning.state()!.settings.map, "belfry");
  returning.stop();
});
