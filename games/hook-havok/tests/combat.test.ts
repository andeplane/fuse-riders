import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  DEFAULT_TUNING,
  NEUTRAL,
  S,
  type World,
} from "../src/engine/world.js";
import { step } from "../src/engine/step.js";
import { strike } from "../src/engine/combat.js";
import { decodeWorld, parseTuning } from "../src/engine/codec.js";
import { Feedback } from "../src/render/feedback.js";
import { toView } from "../src/engine/view.js";
import { interpolate } from "../src/render/interpolation.js";
import { ACTION, JOIN, SETTINGS } from "fuse-netcode";
import {
  createRoom,
  foldTick,
  encode,
  decode,
  hash,
  type Entry,
} from "../src/online/game.js";

const trial = (experiment: "target" | "ball") =>
  createWorld({ ...DEFAULT_TUNING, experiment });
test("experiment selection resets scope and replay/checkpoint hashes agree", () => {
  const a = createRoom("lobby", DEFAULT_TUNING);
  let b = createRoom("lobby", DEFAULT_TUNING);
  for (let tick = 1; tick <= 100; tick++) {
    const entries: Entry[] =
      tick === 1
        ? [
            [1, tick, JOIN, "host", "Keeper", 0, "keeper", 1],
            [2, tick, ACTION, "start", "match"],
          ]
        : tick === 2
          ? [
              [3, tick, SETTINGS, { ...DEFAULT_TUNING, experiment: "target" }],
              [4, tick, 0, "match", 1, { ...NEUTRAL, fire: true }],
            ]
          : tick === 3
            ? [
                [
                  5,
                  tick,
                  0,
                  "match",
                  2,
                  { ...NEUTRAL, fire: true, aimX: 450, aimY: 782 },
                ],
              ]
            : tick === 60
              ? [[6, tick, SETTINGS, { ...DEFAULT_TUNING, experiment: "ball" }]]
              : [];
    const streams = new Map([["host", { generation: 1, entries }]]);
    foldTick(a, "host", streams);
    foldTick(b, "host", streams);
    assert.equal(hash(a), hash(b));
    if (tick === 2) {
      assert.equal(a.round, 2);
      assert.equal(a.simulation.keepers[0]!.world.input.fire, false);
    }
    if (tick === 50) assert.equal(a.simulation.combat.hits, 1);
    if (tick === 60) {
      assert.equal(a.round, 3);
      assert.equal(a.simulation.combat.hits, 0);
    }
    const restored = decode(encode(a), a.tick);
    assert.ok(restored);
    assert.equal(hash(a), hash(restored));
    if (tick % 7 === 0) b = restored;
  }
});
test("presentation interpolates stable bodies without morphing split children or resets", () => {
  const w = trial("ball"),
    older = toView(w);
  for (let i = 0; i < 3; i++) step(w);
  const newer = toView(w),
    saved = structuredClone(newer);
  const mid = interpolate(older, newer, 1.5);
  assert.equal(
    mid.combat.balls[0]!.x,
    (older.combat.balls[0]!.x + newer.combat.balls[0]!.x) / 2,
  );
  const ball = w.combat.balls[0]!;
  w.hook = {
    phase: "flying",
    x: ball.x,
    y: ball.y,
    vx: 20 * S,
    vy: 0,
    life: 60,
    distance: 0,
    platform: -1,
  };
  strike(w, 20 * S, 0);
  const split = toView(w);
  assert.deepEqual(
    interpolate(newer, split, 1.5).combat.balls,
    split.combat.balls,
  );
  assert.equal(interpolate(split, older, 1.5), older);
  assert.deepEqual(newer, saved);
});
function shot(w: World, x: number, y: number, ticks = 40) {
  w.input = { ...NEUTRAL, fire: true, aimX: x, aimY: y };
  for (let i = 0; i < ticks; i++) step(w);
}
test("ordinary aimed shot knocks target off terrace; hold never fires again; target returns", () => {
  const w = trial("target");
  shot(w, 450, 782);
  assert.equal(w.combat.hits, 1);
  assert.ok(w.combat.target!.x > 520 * S);
  for (let i = 0; i < 160; i++) {
    step(w);
    assert.ok(decodeWorld(w), `target checkpoint ${w.tick}`);
  }
  assert.equal(w.combat.falls, 1);
  assert.equal(w.combat.hits, 1);
  assert.equal(w.combat.target!.x, 450 * S);
  w.input.fire = false;
  step(w);
  shot(w, 450, 782);
  assert.equal(w.combat.hits, 2);
});
test("platform wins equal-time hit; intervening ledge blocks target shot", () => {
  const w = trial("target");
  w.hook = {
    phase: "flying",
    x: 414 * S,
    y: 782 * S,
    vx: 20 * S,
    vy: 0,
    life: 60,
    distance: 0,
    platform: -1,
  };
  assert.equal(strike(w, 20 * S, 0, 1), false);
  assert.equal(w.combat.hits, 0);
  w.hook.x = 415 * S;
  w.tick = 1;
  assert.equal(strike(w, 20 * S, 0, 1), true);
  const blocked = trial("target");
  blocked.combat.target!.x = 310 * S;
  blocked.combat.target!.feet = 670 * S - 1;
  shot(blocked, 310, 642, 5);
  assert.equal(blocked.combat.hits, 0);
  assert.equal(blocked.hook.phase, "attached");
});
test("seven consumed shots exhaust one binary split tree; no shot hits multiple overlapping orbs", () => {
  const w = trial("ball");
  const ids: number[] = [];
  while (w.combat.balls.length) {
    const b = w.combat.balls[0]!;
    ids.push(b.id);
    w.tick++;
    w.hook = {
      phase: "flying",
      x: b.x,
      y: b.y,
      vx: 20 * S,
      vy: 0,
      life: 60,
      distance: 0,
      platform: -1,
    };
    assert.equal(strike(w, 20 * S, 0), true);
    assert.ok(w.combat.balls.length <= 4);
    assert.ok(decodeWorld(w));
  }
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(w.combat.hits, 7);
  assert.equal(strike(w, 20 * S, 0), false);
});
test("ball bounces remain bounded and checkpoint continuation reproduces impacts", () => {
  const a = trial("ball");
  let b = trial("ball");
  for (let i = 0; i < 1800; i++) {
    const ball = a.combat.balls[0];
    a.input = {
      ...NEUTRAL,
      fire: i % 60 < 45,
      aimX: ball ? Math.round(ball.x / S) : 940,
      aimY: ball ? Math.round(ball.y / S) : 720,
    };
    b.input = { ...a.input };
    step(a);
    step(b);
    assert.deepEqual(a, b);
    const restored = decodeWorld(a);
    assert.ok(restored, `ball checkpoint ${i}`);
    if (i % 31 === 0) b = restored;
  }
  assert.ok(a.combat.hits > 0, "ordinary shots reach the field from spawn");
});
test("keeper fall preserves progress, reset clears trial and corrupt combat snapshots reject", () => {
  const w = trial("target");
  shot(w, 450, 782, 12);
  const hits = w.combat.hits;
  w.x = 1550 * S;
  w.feet = 960 * S;
  step(w);
  for (let i = 0; i < 30; i++) step(w);
  assert.equal(w.combat.hits, hits);
  assert.equal(w.x, 310 * S);
  const bads = [
    { ...w.combat, target: { ...w.combat.target, vx: Infinity } },
    { ...w.combat, impact: { ...w.combat.impact, tick: w.tick + 1 } },
    { ...w.combat, falls: 100 },
  ];
  for (const combat of bads)
    assert.equal(decodeWorld({ ...w, combat }), undefined);
  w.input.reset = true;
  step(w);
  assert.equal(w.combat.hits, 0);
  assert.equal(w.hook.phase, "ready");
  const ball = trial("ball");
  assert.equal(
    decodeWorld({
      ...ball,
      combat: { ...ball.combat, balls: Array(5).fill(ball.combat.balls[0]) },
    }),
    undefined,
  );
  assert.equal(
    decodeWorld({ ...ball, combat: { ...ball.combat, hits: 3 } }),
    undefined,
  );
  assert.equal(
    parseTuning({ ...DEFAULT_TUNING, experiment: ["ball"] }),
    undefined,
  );
});
test("impact feedback emits once at hit position and never repeats on old views", () => {
  const w = trial("target"),
    feedback = new Feedback();
  feedback.update(toView(w), 0);
  shot(w, 450, 782, 7);
  const view = toView(w);
  assert.ok(feedback.update(view, 100).includes("impact"));
  const burst = feedback.active().find((b) => b.kind === "impact")!;
  assert.equal(burst.x, view.combat.impact.x);
  assert.deepEqual(feedback.update(view, 120), []);
  feedback.reset();
  assert.deepEqual(feedback.update(view, 150), []);
});
