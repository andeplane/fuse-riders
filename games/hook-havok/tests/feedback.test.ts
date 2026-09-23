import test from "node:test";
import assert from "node:assert/strict";
import { Feedback } from "../src/render/feedback.js";
import { createWorld } from "../src/engine/world.js";
import { toView } from "../src/engine/view.js";
import { EffectsAudio, type ToneSink } from "../src/app/audio.js";
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
