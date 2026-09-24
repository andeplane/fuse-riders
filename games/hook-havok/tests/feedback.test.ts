import test from "node:test";
import assert from "node:assert/strict";
import { Feedback } from "../src/render/feedback.js";
import { createWorld } from "../src/engine/world.js";
import { toView } from "../src/engine/view.js";
import { EffectsAudio, type ToneSink } from "../src/app/audio.js";
test("power feedback belongs to its subject and never replays repeated events", () => {
  const f = new Feedback();
  const v = { ...toView(createWorld()), localId: "a" };
  f.update(v, 0);
  const pickup = {
    ...v,
    tick: 3,
    pickupEvents: [{ tick: 2, by: "b", kind: "ward" as const, x: 130, y: 782 }],
  };
  assert.deepEqual(f.update(pickup, 50), []);
  const own = {
    ...pickup,
    tick: 6,
    pickupEvents: [{ ...pickup.pickupEvents[0]!, tick: 5, by: "a" }],
  };
  assert.deepEqual(f.update(own, 100), ["power"]);
  assert.deepEqual(f.update(own, 110), []);
  assert.deepEqual(f.update({ ...own, tick: 9 }, 150), []);
});
test("keeper action poses override running and never change the view", () => {
  const f = new Feedback();
  const idle = toView(createWorld());
  const running = { ...idle, vx: 240, grounded: true };
  const before = structuredClone(running);
  assert.equal(f.pose(idle, 0, false).frame, 0);
  const runFrames = new Set(
    Array.from({ length: 40 }, (_, i) => f.pose(running, i * 25, false).frame),
  );
  assert.deepEqual([...runFrames].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
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
test("gait follows speed, restarts at contact and does not advance on paused frames", () => {
  const slow = new Feedback(),
    fast = new Feedback();
  const view = { ...toView(createWorld()), grounded: true, vx: 150 };
  assert.equal(slow.pose(view, 9000, false).frame, 0);
  fast.pose({ ...view, vx: 300 }, 9000, false);
  for (let ms = 9025; ms <= 9275; ms += 25) {
    slow.pose(view, ms, false);
    fast.pose({ ...view, vx: 300 }, ms, false);
  }
  const s = slow.pose(view, 9275, false),
    f = fast.pose({ ...view, vx: 300 }, 9275, false);
  assert.equal(s.texture, "run");
  assert.equal(s.frame, 2);
  assert.equal(f.frame, 4);
  assert.deepEqual(slow.pose(view, 9275, false), s);
  slow.pose({ ...view, vx: 0 }, 9300, false);
  assert.equal(slow.pose(view, 12000, false).frame, 0);
  const reduced = slow.pose(view, 12050, true);
  assert.equal(reduced.frame, 0);
  assert.equal(reduced.rotation, 0);
  assert.equal(reduced.scaleX, 1);
  assert.equal(slow.pose(view, 12100, true).frame, 0);
});

test("a landing cannot hide a simultaneous hook launch", () => {
  const f = new Feedback();
  const v = toView(createWorld());
  f.update({ ...v, grounded: false, vy: 300 }, 0);
  const landed = {
    ...v,
    tick: 3,
    grounded: true,
    hook: { phase: "flying" as const, x: 300, y: 700 },
  };
  assert.deepEqual(f.update(landed, 50), ["land", "fire"]);
  assert.equal(f.pose(landed, 70, false).state, "fire");
  assert.equal(f.pose(landed, 70, true).frame, 7);
});

test("directional hit reaction belongs only to the victim and does not replay", () => {
  const victim = new Feedback(),
    attacker = new Feedback();
  const base = toView(createWorld());
  const keepers = ["a", "b"].map((id, slot) => ({
    id,
    slot,
    name: id,
    connected: true,
    playing: true,
    shield: 0,
    ward: 0,
    hits: 0,
    body: { ...base, vx: id === "b" ? -400 : 0, vy: -200 },
  }));
  const v = { ...base, localId: "b", keepers };
  victim.update(v, 0);
  attacker.update({ ...v, localId: "a" }, 0);
  const hit = {
    ...v,
    tick: 3,
    hit: { tick: 3, by: "a", target: "b", x: 200, y: 780 },
  };
  const unchanged = structuredClone(hit);
  victim.update(hit, 50);
  attacker.update({ ...hit, localId: "a" }, 50);
  assert.equal(victim.pose(hit, 75, false).state, "hit");
  assert.ok(victim.pose(hit, 75, false).rotation < 0);
  assert.notEqual(attacker.pose(hit, 75, false).state, "hit");
  const reduced = victim.pose(hit, 75, true);
  assert.equal(reduced.rotation, 0);
  assert.equal(reduced.scaleY, 1);
  assert.equal(victim.active()[0]!.target, "b");
  assert.deepEqual(victim.update(hit, 90), []);
  assert.deepEqual(victim.update(v, 100), []);
  assert.equal(victim.active().length, 1);
  assert.deepEqual(hit, unchanged);
});

test("fall, arrival and elimination transitions are distinct, bounded and resettable", () => {
  const f = new Feedback();
  const v = { ...toView(createWorld()), localId: "b", feet: 910 };
  f.update(v, 0);
  const fallen = { ...v, tick: 3, feet: 810, deaths: 1, respawn: 3 };
  f.update(fallen, 50);
  assert.equal(f.active()[0]!.kind, "vanish");
  assert.equal(f.active()[0]!.y, 870);
  const returned = { ...fallen, tick: 6, respawn: 0 };
  assert.deepEqual(f.update(returned, 100), ["respawn"]);
  assert.equal(f.pose(returned, 120, false).state, "arrive");
  assert.ok(f.pose(returned, 120, false).alpha < 1);
  assert.equal(f.pose(returned, 120, true).alpha, 1);
  f.reset();
  assert.equal(f.active().length, 0);
  const active = {
    ...v,
    contest: {
      ...v.contest,
      rules: "elimination" as const,
      entries: [{ id: "b", slot: 0, score: 0, out: false }],
    },
  };
  f.update(active, 200);
  const out = {
    ...active,
    tick: 3,
    contest: {
      ...active.contest,
      entries: [{ id: "b", slot: 0, score: 0, out: true }],
    },
  };
  f.update(out, 250);
  assert.equal(f.active().filter((burst) => burst.kind === "vanish").length, 1);
  f.update({ ...out, tick: 6 }, 275);
  assert.equal(f.active().length, 1);
  f.update({ ...out, tick: 60 }, 300);
  assert.equal(
    f.active().length,
    0,
    "checkpoint gaps discard stale visual history",
  );
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
