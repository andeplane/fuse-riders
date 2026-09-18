import test from "node:test";
import assert from "node:assert/strict";
import { advanceRiderPose } from "../src/engine/rider-motion.js";
import {
  createGame,
  addPlayer,
  startMatch,
  step,
  SLOT_COLORS,
  riderMotionStep,
} from "../src/engine/game.js";
import { drunkHeadingOffset } from "../src/engine/drunk.js";
import { classicSettings } from "./fixtures/classic-settings.js";
import { effectSince, effectUntil } from "../src/engine/effects.ts";
import { setEffect } from "./fixtures/rider-state.ts";
test("pure rider kernel exactly matches authoritative turns including drunk offsets", () => {
  const game = createGame("motion-kernel", classicSettings());
  for (let i = 0; i < 2; i++)
    addPlayer(game, {
      id: `p${i}`,
      name: `P${i}`,
      slot: i,
      color: SLOT_COLORS[i]!,
    });
  startMatch(game);
  for (let t = 0; t < 60; t++) step(game, new Map());
  const p = game.players.get("p0")!;
  Object.assign(p, {
    x: 800,
    y: 450,
  });
  setEffect(p, "star", 10000);
  setEffect(p, "drunk", game.tick + 80, game.tick);
  const controls = { left: true, right: false, bomb: false };
  for (let i = 0; i < 80; i++) {
    const previous = {
      x: p.x,
      y: p.y,
      angle: p.angle,
      drunkHeadingOffset: p.drunkHeadingOffset,
    };
    const expected = advanceRiderPose(previous, controls, {
      ...riderMotionStep(p, game.tick + 1, game.roundStartedTick),
      drunkHeadingOffset: drunkHeadingOffset(
        game.seed,
        p.id,
        game.tick + 1,
        effectSince(p, "drunk"),
        effectUntil(p, "drunk"),
      ),
    });
    step(game, new Map([[p.id, controls]]));
    assert.deepEqual(
      {
        x: p.x,
        y: p.y,
        angle: p.angle,
        drunkHeadingOffset: p.drunkHeadingOffset,
      },
      expected,
    );
  }
});
test("opposite controls cancel steering and pure motion leaves input pose unchanged", () => {
  const pose = { x: 0, y: 0, angle: 0, drunkHeadingOffset: 0.1 },
    copy = { ...pose };
  const result = advanceRiderPose(
    pose,
    { left: true, right: true },
    { distance: 7.5, turn: 0.14, drunkHeadingOffset: 0.1 },
  );
  assert.deepEqual(result, { x: 7.5, y: 0, angle: 0, drunkHeadingOffset: 0.1 });
  assert.deepEqual(pose, copy);
});
