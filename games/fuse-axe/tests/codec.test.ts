import test from "node:test";
import assert from "node:assert/strict";
import {
  DOWN,
  JUMP,
  RIGHT,
  createWorld,
  decodeWorld,
  encodeWorld,
  stepTick,
  type World,
} from "../src/engine/index.js";
import { CAMERA_END, STAGE_LENGTH, px } from "../src/engine/tuning.js";

/** Three heroes well down the road: two walking, one in the air, the camera moved on. */
function busy(): World {
  let world = createWorld({
    seed: 9,
    heroes: [
      { seat: 0, kind: "brakka" },
      { seat: 2, kind: "rhea" },
      { seat: 4, kind: "gorm" },
    ],
  });
  for (let tick = 0; tick < 200; tick++)
    world = stepTick(world, [
      RIGHT,
      0,
      RIGHT | DOWN,
      0,
      tick === 197 ? JUMP : 0,
    ]);
  return world;
}

test("a world survives the checkpoint whole, and steps on from it identically", () => {
  const world = busy();
  assert.ok(world.camX > 0);
  assert.deepEqual(
    world.heroes.map((hero) => hero.state),
    ["walk", "walk", "jump"],
  );
  const back = decodeWorld(structuredClone(encodeWorld(world)));
  assert.deepEqual(back, world);
  const held = [RIGHT, 0, JUMP, 0, DOWN];
  assert.deepEqual(stepTick(back!, held), stepTick(world, held));
  const empty = createWorld({ seed: 1, heroes: [] });
  assert.deepEqual(decodeWorld(encodeWorld(empty)), empty);
});

test("a corrupt, oversized or out-of-range world is refused whole", () => {
  const good = encodeWorld(busy()) as unknown[];
  const broken = (change: (fields: unknown[]) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return decodeWorld(copy);
  };
  const heroes = (f: unknown[]) => f[5] as unknown[][];
  const hero = (f: unknown[], index = 0) => heroes(f)[index]!;
  assert.ok(broken(() => {}));
  for (const raw of [null, "world", {}, 7])
    assert.equal(decodeWorld(raw), undefined, String(raw));
  for (const [what, change] of [
    ["a field short", (f) => f.pop()],
    ["a field over", (f) => f.push(0)],
    ["a fractional seed", (f) => (f[0] = 1.5)],
    ["a negative step", (f) => (f[1] = -1)],
    ["a step past 32 bits", (f) => (f[1] = 2 ** 32)],
    ["a random state as text", (f) => (f[2] = "1")],
    ["no next id", (f) => (f[3] = 0)],
    ["a camera past the stage", (f) => (f[4] = CAMERA_END + 1)],
    ["a camera behind it", (f) => (f[4] = -1)],
    ["heroes not a list", (f) => (f[5] = {})],
    ["six heroes", (f) => (f[5] = Array(6).fill(hero(f)))],
    ["a hero not a tuple", (f) => (heroes(f)[0] = 7 as never)],
    ["a hero field short", (f) => hero(f).pop()],
    ["an unknown hero", (f) => (hero(f)[2] = "wizard")],
    ["a sixth seat", (f) => (hero(f)[1] = 5)],
    ["a hero off the road", (f) => (hero(f)[3] = STAGE_LENGTH + px(400))],
    ["a hero below the screen", (f) => (hero(f)[4] = px(180) + 1)],
    ["a hero under the floor", (f) => (hero(f)[5] = -1)],
    ["a hero too fast", (f) => (hero(f)[6] = px(17))],
    ["a hero facing nowhere", (f) => (hero(f)[9] = 0)],
    ["an unknown state", (f) => (hero(f)[10] = "fly")],
    ["a negative timer", (f) => (hero(f)[11] = -1)],
    ["unknown held bits", (f) => (hero(f)[12] = 128)],
    ["NaN", (f) => (hero(f)[3] = NaN)],
    ["heroes out of order", (f) => heroes(f).reverse()],
    ["a repeated seat", (f) => (hero(f, 1)[1] = hero(f)[1])],
    ["a repeated id", (f) => (hero(f, 1)[0] = hero(f)[0])],
    ["an id not yet issued", (f) => (f[3] = hero(f, 2)[0])],
  ] as [string, (fields: unknown[]) => void][])
    assert.equal(broken(change), undefined, what);
});
