import test from "node:test";
import assert from "node:assert/strict";
import {
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  stepWorld,
  type World,
} from "../src/engine/index.js";
import { CLASSIC } from "./fixtures/world.js";

/** A round well under way: bots flying, shooting and dying, rocks and drones about. */
function busy(): World {
  const world = createWorld(
    77,
    [0, 1, 2, 3, 4].map((slot) => ({ id: `b${slot}`, slot })),
    CLASSIC,
  );
  let inputs = new Map<string, number>();
  for (let i = 0; i < 1200; i++) {
    if (i % 3 === 0)
      inputs = new Map(world.choppers.map((c) => [c.id, botInput(world, c)]));
    stepWorld(world, inputs);
  }
  // One of everything, whatever the bots left about.
  const id = () => world.nextId++;
  world.bullets.push({
    id: id(),
    owner: 1,
    x: 256_000,
    y: 70_000,
    vx: 2000,
    vy: 0,
    life: 20,
  });
  world.bolts.push({
    id: id(),
    x: 256_100,
    y: 70_000,
    vx: -900,
    vy: 100,
    life: 90,
  });
  world.rocks.push({
    id: id(),
    x: 250_000,
    y: 60_000,
    vx: 1200,
    vy: -50,
    r: 3500,
    life: 200,
  });
  world.warnings.push({ id: id(), y: 64_000, at: world.step + 10 });
  world.drones.push({
    id: id(),
    x: 300_000,
    y: 60_000,
    baseY: 60_000,
    hp: 2,
    cool: 40,
    charge: 0,
    phase: 3,
  });
  world.pickups.push({ id: id(), kind: 4, x: 290_000, y: 70_000 });
  world.fx.push({
    id: id(),
    at: world.step,
    kind: 3,
    x: 290_000,
    y: 70_000,
    slot: 0,
    data: 4,
  });
  return world;
}

test("a world survives the checkpoint whole, and replays on from it identically", () => {
  const world = busy();
  const things =
    world.fx.length +
    world.bullets.length +
    world.rocks.length +
    world.drones.length +
    world.pickups.length;
  assert.ok(things > 0, "a busy world");
  const decoded = decodeWorld(structuredClone(encodeWorld(world)));
  assert.deepEqual(decoded, world);
  for (let i = 0; i < 300; i++) {
    stepWorld(world, new Map());
    stepWorld(decoded!, new Map());
  }
  assert.deepEqual(encodeWorld(decoded!), encodeWorld(world));
});

test("a corrupt world is refused, field by field", () => {
  const good = encodeWorld(busy());
  const broken = (change: (fields: unknown[]) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return decodeWorld(copy);
  };
  assert.ok(decodeWorld(structuredClone(good)));
  assert.equal(decodeWorld("nope"), undefined);
  assert.equal(decodeWorld(good.slice(0, 5)), undefined);
  const chopper = (f: unknown[]) => (f[14] as unknown[][])[0]!;
  for (const [what, change] of [
    ["seed", (f: unknown[]) => (f[0] = -1)],
    ["lift", (f: unknown[]) => (f[1] = "jetpack")],
    ["combat", (f: unknown[]) => (f[2] = "lasers")],
    ["power-ups", (f: unknown[]) => (f[3] = 1)],
    ["phase", (f: unknown[]) => (f[5] = "intermission")],
    ["phase before its step", (f: unknown[]) => (f[5] = "countdown")],
    ["phaseAt after step", (f: unknown[]) => (f[6] = (f[4] as number) + 1)],
    ["scroll", (f: unknown[]) => (f[8] = 1e9)],
    [
      "too many choppers",
      (f: unknown[]) => (f[14] as unknown[]).push(...(f[14] as unknown[])),
    ],
    ["chopper id", (f: unknown[]) => (chopper(f)[0] = "")],
    ["chopper slot", (f: unknown[]) => (chopper(f)[1] = 9)],
    ["chopper position", (f: unknown[]) => (chopper(f)[2] = 1.5)],
    ["chopper face", (f: unknown[]) => (chopper(f)[6] = 0)],
    [
      "crashed without a cause",
      (f: unknown[]) => {
        chopper(f)[7] = 0;
        chopper(f)[10] = -1;
      },
    ],
    [
      "crashed and escaped",
      (f: unknown[]) => {
        chopper(f)[7] = 0;
        chopper(f)[8] = 1;
        chopper(f)[10] = 0;
      },
    ],
    ["shield count", (f: unknown[]) => (chopper(f)[11] = 2)],
    ["input bits", (f: unknown[]) => (chopper(f)[19] = 64)],
    [
      "duplicate chopper",
      (f: unknown[]) => {
        const list = f[14] as unknown[][];
        list[1] = [...list[0]!];
        list[1]![1] = 4;
      },
    ],
    ["seats out of order", (f: unknown[]) => (f[14] as unknown[][]).reverse()],
    [
      "duplicate entity id",
      (f: unknown[]) => {
        (f[21] as unknown[][]).push([
          ...((f[21] as unknown[][])[0] ?? [1, 0, 0, 0, 0, -1, 0]),
        ]);
        (f[21] as unknown[][]).push([
          ...((f[21] as unknown[][])[0] ?? [1, 0, 0, 0, 0, -1, 0]),
        ]);
      },
    ],
    [
      "an id from the future",
      (f: unknown[]) =>
        (f[20] as unknown[][]).push([(f[11] as number) + 5, 0, 0, 0]),
    ],
    [
      "a pickup of no kind",
      (f: unknown[]) => (f[20] as unknown[][]).push([1, 9, 0, 0]),
    ],
    ["a short row", (f: unknown[]) => (f[18] as unknown[][]).push([1, 2])],
    [
      "a winner not in the round",
      (f: unknown[]) => {
        f[5] = "outro";
        f[22] = "ghost";
      },
    ],
    [
      "a winner without an outro",
      (f: unknown[]) => {
        f[5] = "play";
        f[22] = "b0";
      },
    ],
  ] as const)
    assert.equal(broken(change), undefined, what);
});
