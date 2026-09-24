import test from "node:test";
import assert from "node:assert/strict";
import { Feedback } from "../src/render/feedback.js";
import { createWorld } from "../src/engine/world.js";
import { toView } from "../src/engine/view.js";
import { EffectsAudio, type ToneSink } from "../src/app/audio.js";
test("keeper action poses override running and never change the view", () => {
  const f = new Feedback();
  const idle = toView(createWorld());
  const running = { ...idle, vx: 240, grounded: true };
  const before = structuredClone(running);
  assert.equal(f.pose(idle, 0, false).frame, 0);
  const runFrames = new Set(
    Array.from({ length: 40 }, (_, i) => f.pose(running, i * 25, false).frame),
  );
  assert.deepEqual([...runFrames].sort(), [1, 2, 3, 4]);
  assert.equal(
    f.pose({ ...running, grounded: false, vy: -200 }, 0, false).frame,
    5,
  );
  assert.equal(
    f.pose({ ...running, grounded: false, vy: 200 }, 0, false).frame,
    6,
  );
  f.update(running, 0);
  const fired = {
    ...running,
    tick: 3,
    hook: { phase: "flying" as const, x: 330, y: 700 },
  };
  f.update(fired, 50);
  assert.equal(
    f.pose(fired, 70, false).frame,
    7,
    "moving shot shows the launch arm",
  );
  assert.equal(
    f.pose(fired, 70, true).frame,
    7,
    "reduced motion keeps the authored action pose",
  );
  assert.equal(f.pose(fired, 70, true).rotation, 0);
  const pulling = {
    ...fired,
    hook: { ...fired.hook, phase: "attached" as const },
  };
  assert.equal(
    f.pose(pulling, 200, false).frame,
    8,
    "grounded pull is not a run frame",
  );
  assert.equal(f.pose(pulling, 200, true).rotation, 0);
  assert.deepEqual(running, before);
});
test("simultaneous prop and player hits retain independent effect positions", () => {
  const f = new Feedback(),
    v = toView(createWorld());
  v.experiment = "ball";
  f.update(v, 0);
  const next = structuredClone(v);
  next.tick = 3;
  next.hit = { tick: 2, by: "a", target: "b", x: 170, y: 782 };
  next.combat.hits = 1;
  next.combat.impact = { tick: 3, x: 900, y: 700 };
  assert.deepEqual(f.update(next, 50), ["pop", "impact"]);
  assert.deepEqual(
    f.active().map(({ kind, x, y }) => ({ kind, x, y })),
    [
      { kind: "pop", x: 900, y: 700 },
      { kind: "impact", x: 170, y: 782 },
    ],
  );
});
test("view transitions cue once; rollback/repeated frames do not replay effects", () => {
  const f = new Feedback(),
    v = toView(createWorld());
  const before = structuredClone(v);
  assert.deepEqual(f.update(v, 0), []);
  const rise = { ...v, tick: 3, grounded: false, vy: -500, feet: 790 };
  assert.deepEqual(f.update(rise, 50), ["jump"]);
  assert.deepEqual(f.update(rise, 60), []);
  assert.deepEqual(f.update(v, 70), []);
  const fall = { ...rise, tick: 6, vy: 400 };
  f.update(fall, 100);
  assert.deepEqual(f.update({ ...v, tick: 9 }, 150), ["land"]);
  assert.equal(f.pose({ ...v, tick: 9 }, 155, false).state, "land");
  assert.ok(f.pose(v, 155, false).scaleY < 1);
  assert.equal(f.pose(v, 155, true).scaleY, 1);
  assert.deepEqual(v, before);
  f.reset();
  assert.deepEqual(f.update(v, 200), []);
  assert.equal(f.active().length, 0);
});
test("attach/release/respawn feedback uses real anchor and expires", () => {
  const f = new Feedback(),
    v = toView(createWorld());
  f.update(v, 0);
  const attached = {
    ...v,
    tick: 3,
    hook: { phase: "attached" as const, x: 300, y: 698 },
  };
  assert.deepEqual(f.update(attached, 50), ["fire", "attach"]);
  assert.equal(f.active()[1]!.y, 698);
  assert.deepEqual(f.update({ ...v, tick: 6 }, 100), ["release"]);
  f.update({ ...v, tick: 9, respawn: 3 }, 150);
  assert.deepEqual(f.update({ ...v, tick: 12 }, 200), ["respawn"]);
  f.update({ ...v, tick: 15 }, 650);
  assert.equal(f.active().length, 0);
});
test("effects require gesture resume, obey mute/volume, cancel pending unlock and dispose", async () => {
  let created = 0,
    plays = 0,
    closed = 0,
    resolve: () => void = () => {};
  const sink: ToneSink = {
    resume: () => new Promise<void>((r) => (resolve = r)),
    play: () => plays++,
    silence() {},
    close: () => closed++,
  };
  const audio = new EffectsAudio(false, () => {
    created++;
    return sink;
  });
  audio.cue("jump");
  assert.equal(plays, 0);
  audio.unlock();
  audio.pause();
  resolve();
  await Promise.resolve();
  audio.cue("jump");
  assert.equal(plays, 0);
  audio.unlock();
  resolve();
  await Promise.resolve();
  audio.cue("attach");
  assert.equal(plays, 1);
  audio.setVolume(0);
  audio.cue("land");
  assert.equal(plays, 1);
  audio.destroy();
  audio.destroy();
  assert.equal(closed, 1);
  assert.equal(created, 1);
  const muted = new EffectsAudio(true, () => {
    created++;
    return sink;
  });
  muted.unlock();
  muted.cue("fire");
  assert.equal(created, 1);
});
