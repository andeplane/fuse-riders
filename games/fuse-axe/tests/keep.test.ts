import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGES,
  STAGE_4,
  createWorld,
  decodeWorld,
  encodeWorld,
  step,
  waveSpawns,
} from "../src/engine/index.js";
import * as T from "../src/engine/tuning.js";
import { gravesPx, stageLengthPx } from "../src/engine/view-kit.js";
import { STAGE_NAMES } from "../src/app/presenter.js";

const { px } = T;
const PLAN = STAGE_4;
const SLABS = PLAN.graves ?? [];

test("Vorhal's Keep is Stage 4: five screens of halls, bonewalkers rising from the slabs on their waves' screens, then the throne room", () => {
  const { waves, length, cameraEnd, imps } = PLAN;
  assert.deepEqual([STAGES.length, STAGES[3]], [4, PLAN]);
  assert.deepEqual([length, cameraEnd], [px(1600), px(1280)]);
  assert.deepEqual([stageLengthPx(4), STAGE_NAMES[4]], [1600, "VORHAL'S KEEP"]);
  assert.deepEqual(
    SLABS.map(({ x, y }) => [x / T.SUB, y / T.SUB]),
    gravesPx(4),
  );
  assert.equal(waves.length, 6);
  assert.equal(waves.at(-1)!.at, cameraEnd);
  assert.equal(imps.length, 1);
  const kinds = new Set<string>(),
    raised = new Set<number>();
  waves.forEach((wave, index) => {
    assert.ok(wave.at > (waves[index - 1]?.at ?? 0));
    for (const spawn of [...wave.spawns, ...(wave.extras ?? [])]) {
      kinds.add(`${spawn.kind}${spawn.tier}${spawn.mount ?? ""}`);
      if (spawn.grave === undefined) continue;
      raised.add(spawn.grave);
      // The slab is on the screen the wave holds, a whole body in from its edges.
      const slab = SLABS[spawn.grave]!;
      assert.equal(spawn.kind, "bonewalker");
      assert.ok(slab.x - T.ENEMY_HALF_W >= wave.at, `wave ${index + 1}`);
      assert.ok(slab.x + T.ENEMY_HALF_W <= wave.at + px(T.VIEW_W));
      assert.equal(spawn.y, slab.y);
    }
  });
  for (const each of ["ravager2", "lancer1", "bonewalker1", "ravager1clawbeak"])
    assert.ok(kinds.has(each), each);
  // None of the halls' five slabs is dead data: each has a wave raising a bonewalker from it.
  SLABS.forEach((slab, index) => {
    if (slab.x < cameraEnd) assert.ok(raised.has(index), `slab ${index}`);
  });
  // The throne room's three slabs lie on its screen.
  const throne = SLABS.filter((slab) => slab.x >= cameraEnd);
  assert.equal(throne.length, 3);
  for (const slab of throne) assert.ok(slab.x + T.ENEMY_HALF_W <= length);
  // A bigger party meets more in the throne room.
  assert.ok(waveSpawns(waves.at(-1)!, 5).length > waveSpawns(waves.at(-1)!, 1).length); // prettier-ignore
});

test("the keep's first wave begins at its trigger, its bonewalker clawing up out of its slab, and the checkpoint keeps it", () => {
  const start = createWorld({
    seed: 4,
    stage: 4,
    heroes: [{ seat: 0, kind: "gorm" }],
  });
  const at = PLAN.waves[0]!.at;
  let world = step(
    {
      ...start,
      camX: at,
      heroes: start.heroes.map((h) => ({ ...h, x: h.x + at })),
    },
    [],
  );
  const risen = world.enemies.find((each) => each.kind === "bonewalker")!;
  assert.deepEqual(
    [world.wave, world.locked, risen.state, risen.x, risen.y],
    [1, true, "rise", SLABS[0]!.x, SLABS[0]!.y],
  );
  for (let i = 0; i < 120; i++) world = step(world, []);
  assert.deepEqual(decodeWorld(structuredClone(encodeWorld(world))), world);
});
