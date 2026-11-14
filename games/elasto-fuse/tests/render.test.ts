import test from "node:test";
import assert from "node:assert/strict";
import {
  FINISHED,
  DEAD,
  GAS,
  LEVELS,
  STEPS_PER_SECOND,
  createWorld,
  stepWorld,
  toView,
  type World,
} from "../src/engine/index.js";
import type { BikeView, WorldView } from "../src/engine/view.js";
import {
  FOREARM,
  SHIN,
  THIGH,
  UPPER_ARM,
  poseOf,
  twoBone,
} from "../src/render/bike.js";
import {
  AHEAD_SHARE,
  MAX_UNITS,
  MIN_UNITS,
  MIN_UNITS_HIGH,
  SNAP,
  cameraTarget,
  followCamera,
  levelBounds,
  paneGrid,
  paneScale,
} from "../src/render/camera.js";
import {
  CUE_HOLD,
  appleAt,
  countOf,
  cueGate,
  cuesBetween,
} from "../src/render/cues.js";
import { MAX_PARTICLES, createEffects } from "../src/render/effects.js";
import { GO_STEPS, clockText, ordinal, paneHud } from "../src/render/hud.js";
import {
  SLOT_COLORS,
  hexA,
  slotColor,
  slotHueShift,
} from "../src/render/palette.js";
import { DECAY_MS, createSmoother, shiftBike } from "../src/render/smooth.js";
import { toScreen, visiblePolygons } from "../src/render/terrain.js";
import { shiftHue } from "../src/render/tint.js";

function racing(steps = 0, bits: readonly number[] = [0, 0]): World {
  const world = createWorld(["a", "b"], 0, 0);
  for (let i = 0; i < steps; i++) stepWorld(world, bits, [true, true]);
  return world;
}
const near = (a: number, b: number, slack = 1e-9) => Math.abs(a - b) <= slack;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

// ---- cues ----

test("cues come from the views changing: the countdown's beeps, then go", () => {
  const world = createWorld(["a"], 0, 3 * STEPS_PER_SECOND);
  const seen: string[] = [];
  let before: WorldView | undefined;
  for (let i = 0; i < 3 * STEPS_PER_SECOND + 2; i++) {
    const after = toView(world);
    for (const cue of cuesBetween(before, after))
      seen.push(cue.kind === "count" ? `count ${cue.count}` : cue.kind);
    before = after;
    stepWorld(world, [0], [true]);
  }
  assert.deepEqual(seen, ["count 2", "count 1", "go"]);
  assert.equal(countOf(3 * STEPS_PER_SECOND), 3);
  assert.equal(countOf(1), 1);
  assert.equal(countOf(0), 0);
  assert.deepEqual(cuesBetween(undefined, toView(world)), [], "no first frame");
});

test("an apple, a crash and a finish are each told once, for the rider they happened to", () => {
  const world = racing(20);
  const before = toView(world);
  const second = appleAt(0, 1)!;
  world.riders[1]!.taken = 0b10;
  world.riders[0]!.status = DEAD;
  world.riders[0]!.wait = 40;
  stepWorld(world, [0, 0], [true, true]);
  const after = toView(world);
  const cues = cuesBetween(before, after);
  assert.deepEqual(
    cues.map((cue) => cue.kind),
    ["crash", "apple"],
  );
  assert.deepEqual(cues[1], { kind: "apple", slot: 1, ...second });
  const crash = cues[0]!;
  assert.ok(crash.kind === "crash" && crash.slot === 0);
  assert.deepEqual(
    cuesBetween(after, after),
    [],
    "nothing changed, nothing said",
  );

  world.riders[1]!.status = FINISHED;
  world.riders[1]!.finish = world.step;
  const home = toView(world);
  assert.deepEqual(
    cuesBetween(after, home).map((cue) => [
      cue.kind,
      "slot" in cue && cue.slot,
    ]),
    [["finish", 1]],
  );
});

test("a restart, a rollback and another level say nothing", () => {
  const world = racing(30, [GAS, 0]);
  world.riders[0]!.taken = 0b1;
  const before = toView(world);
  // Put back on the start with its apples: the apples coming back is not eating them.
  const restarted = toView(world);
  restarted.riders[0] = { ...restarted.riders[0]!, taken: 0b11, run: 0 };
  assert.deepEqual(cuesBetween(before, restarted), []);
  // The race clock went backwards: a rollback past what was shown.
  const earlier = { ...toView(world), step: before.step - 4 };
  earlier.riders[0] = { ...earlier.riders[0]!, taken: 0b11 };
  assert.deepEqual(cuesBetween(before, earlier), []);
  assert.deepEqual(cuesBetween(before, { ...before, level: 1 }), []);
  // The n-th apple is the n-th object of kind "apple".
  const apples = LEVELS[0]!.objects.filter((o) => o.kind === "apple");
  assert.deepEqual(
    [appleAt(0, 0)!.x, appleAt(0, 0)!.y],
    [apples[0]!.x, apples[0]!.y],
  );
  assert.equal(appleAt(0, apples.length), undefined);
  assert.equal(appleAt(99, 0), undefined);
});

// ---- the words on a pane ----

test("the clock reads m:ss.cc", () => {
  assert.equal(clockText(0), "0:00.00");
  assert.equal(clockText(7), "0:00.07");
  assert.equal(clockText(1234), "0:12.34");
  assert.equal(clockText(6000), "1:00.00");
  assert.equal(clockText(75_999), "12:39.99");
  assert.equal(clockText(-5), "0:00.00");
  assert.deepEqual([1, 2, 3, 4, 5].map(ordinal), [
    "1ST",
    "2ND",
    "3RD",
    "4TH",
    "5TH",
  ]);
});

test("a pane says the countdown, GO, the run clock, apples, place, a crash, the finish and the closing", () => {
  const waiting = createWorld(["a", "b"], 0, 2 * STEPS_PER_SECOND + 5);
  assert.deepEqual(
    [paneHud(toView(waiting), 0)!.banner, paneHud(toView(waiting), 0)!.tone],
    ["3", "count"],
  );
  const world = racing(1);
  let hud = paneHud(toView(world), 0)!;
  assert.deepEqual([hud.banner, hud.tone], ["GO!", "go"]);
  assert.equal(hud.place, "1ST");
  assert.equal(paneHud(toView(world), 1)!.place, "2ND");
  assert.equal(hud.closing, "");
  for (let i = 0; i < GO_STEPS; i++) stepWorld(world, [0, 0], [true, true]);
  hud = paneHud(toView(world), 0)!;
  assert.equal(hud.banner, "");
  assert.equal(hud.clock, clockText(Math.floor(((GO_STEPS + 1) * 100) / 80)));
  const total = LEVELS[0]!.objects.filter((o) => o.kind === "apple").length;
  assert.equal(hud.apples, `0 / ${total}`);

  world.riders[0]!.status = DEAD;
  assert.deepEqual(
    [paneHud(toView(world), 0)!.banner, paneHud(toView(world), 0)!.tone],
    ["CRASHED", "crash"],
  );
  // The other rider gets home: the first is on the clock.
  world.riders[0]!.status = 0;
  world.riders[1]!.status = FINISHED;
  world.riders[1]!.finish = world.step;
  world.riders[1]!.run = 800;
  world.close = world.step + 30 * STEPS_PER_SECOND;
  const view = toView(world);
  assert.equal(paneHud(view, 1)!.banner, "FINISHED 0:10.00");
  assert.equal(
    paneHud(view, 1)!.closing,
    "",
    "the one who is home is not on the clock",
  );
  assert.equal(paneHud(view, 0)!.closing, "CLOSING 30");
  assert.equal(paneHud(view, 1)!.place, "1ST");
  // Alone, there is no place to show; a slot nobody rides has no words.
  assert.equal(paneHud(toView(createWorld(["a"], 0, 0)), 0)!.place, "");
  assert.equal(paneHud(view, 4), undefined);
});

// ---- the camera and the panes ----

test("one pane per rider: side by side on a wide screen, stacked on a tall one, never overlapping", () => {
  for (const [w, h] of [
    [1280, 720],
    [390, 844],
  ] as const)
    for (let count = 1; count <= 5; count++) {
      const panes = paneGrid(count, w, h);
      assert.equal(panes.length, count);
      for (const pane of panes) {
        assert.ok(pane.x >= 0 && pane.y >= 0, `${count} in ${w}x${h}`);
        assert.ok(pane.x + pane.w <= w + 1e-9 && pane.y + pane.h <= h + 1e-9);
        assert.ok(pane.w > 60 && pane.h > 60);
      }
      for (const a of panes)
        for (const b of panes)
          if (a !== b)
            assert.ok(
              a.x + a.w <= b.x + 1e-9 ||
                b.x + b.w <= a.x + 1e-9 ||
                a.y + a.h <= b.y + 1e-9 ||
                b.y + b.h <= a.y + 1e-9,
              `${count} in ${w}x${h} overlap`,
            );
    }
  assert.deepEqual(paneGrid(1, 800, 600), [{ x: 0, y: 0, w: 800, h: 600 }]);
  const [left, right] = paneGrid(2, 1000, 500);
  assert.ok(left!.y === right!.y && left!.x < right!.x, "side by side");
  const [top, bottom] = paneGrid(2, 500, 1000);
  assert.ok(top!.x === bottom!.x && top!.y < bottom!.y, "stacked");
  assert.equal(paneGrid(9, 800, 600).length, 5);
  assert.equal(paneGrid(0, 800, 600).length, 1);
});

test("a desktop pane shows about seventeen units across, a phone fewer, and never a slit", () => {
  assert.ok(near(1280 / paneScale(1280, 720), MAX_UNITS));
  assert.ok(near(3000 / paneScale(3000, 2000), MAX_UNITS), "never more");
  const phone = 844 / paneScale(844, 390);
  assert.ok(phone < MAX_UNITS && phone >= MIN_UNITS);
  assert.ok(near(390 / paneScale(390, 600), MIN_UNITS), "never fewer");
  assert.ok(300 / paneScale(1200, 300) >= MIN_UNITS_HIGH - 1e-9);
});

test("the camera rides level with the bike, 15% of the width from the edge behind it, inside the level", () => {
  const level = LEVELS[0]!,
    box = levelBounds(level);
  assert.equal(levelBounds(level), box, "worked out once");
  assert.ok(box.maxX - box.minX > 40, "a level longer than a pane");
  const bike = toView(racing()).riders[0]!.bike;
  const wide = 16,
    high = 9;
  // Mid-level, facing right: the bike is 35% of the width behind the pane's centre.
  const mid: BikeView = { ...bike, x: (box.minX + box.maxX) / 2 };
  const right = cameraTarget(mid, box, wide, high);
  assert.ok(near(right.x - mid.x, AHEAD_SHARE * wide));
  assert.ok(near((mid.x - (right.x - wide / 2)) / wide, 0.15));
  const left = cameraTarget({ ...mid, flipped: true }, box, wide, high);
  assert.ok(
    near(left.x - mid.x, -AHEAD_SHARE * wide),
    "mirrored when it faces left",
  );
  // At the level's ends the pane stops at the wall (and a unit of ground).
  const start = cameraTarget({ ...bike, x: box.minX + 1 }, box, wide, high);
  assert.ok(near(start.x - wide / 2, box.minX - 1));
  const end = cameraTarget({ ...bike, x: box.maxX - 1 }, box, wide, high);
  assert.ok(near(end.x + wide / 2, box.maxX + 1));
  // A pane taller than the level centres it.
  const tall = cameraTarget(bike, box, wide, 500);
  assert.ok(near(tall.y, (box.minY + box.maxY) / 2));
  // A lift raises the bike in the pane.
  const lifted = cameraTarget(mid, box, wide, 4, undefined, 1);
  assert.ok(lifted.y <= cameraTarget(mid, box, wide, 4).y);
});

test("the camera closes on its target smoothly and jumps a restart", () => {
  const target = { x: 10, y: 2 };
  assert.deepEqual(followCamera(undefined, target, 16), target);
  const stepped = followCamera({ x: 8, y: 2 }, target, 16);
  assert.ok(stepped.x > 8 && stepped.x < 10);
  assert.equal(stepped.y, 2);
  const later = followCamera({ x: 8, y: 2 }, target, 400);
  assert.ok(later.x > stepped.x && later.x < 10);
  assert.deepEqual(followCamera({ x: 8, y: 2 }, target, 0), { x: 8, y: 2 });
  assert.deepEqual(
    followCamera({ x: 10 + SNAP + 1, y: 2 }, target, 16),
    target,
    "too far to glide",
  );
});

test("only polygons that can show in a pane are traced, and world points land on the canvas y down", () => {
  const level = LEVELS[0]!,
    box = levelBounds(level);
  const pane = { x: 100, y: 50, w: 800, h: 400 };
  const inside = {
    pane,
    camera: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    scale: 50,
  };
  assert.ok(visiblePolygons(level, inside).includes(0), "the sky polygon");
  const away = { ...inside, camera: { x: box.maxX + 500, y: box.maxY + 500 } };
  assert.deepEqual(visiblePolygons(level, away), []);
  assert.deepEqual(toScreen(inside, inside.camera.x, inside.camera.y), {
    x: 500,
    y: 250,
  });
  const up = toScreen(inside, inside.camera.x + 1, inside.camera.y + 1);
  assert.deepEqual(up, { x: 550, y: 200 }, "a unit right and up");
});

// ---- the rider ----

test("two-bone IK keeps both bones' lengths, bends the asked way, and straightens out of reach", () => {
  const a = { x: 0, y: 0 },
    b = { x: 0.5, y: -0.2 };
  for (const bend of [1, -1] as const) {
    const joint = twoBone(a, b, 0.4, 0.3, bend);
    assert.ok(near(dist(a, joint), 0.4), "first bone");
    assert.ok(near(dist(joint, b), 0.3), "second bone");
    // Left of the line from a to b for 1, right of it for −1.
    const side = (b.x - a.x) * (joint.y - a.y) - (b.y - a.y) * (joint.x - a.x);
    assert.equal(Math.sign(side), bend);
  }
  const far = twoBone(a, { x: 3, y: 0 }, 0.4, 0.3, 1);
  assert.ok(
    near(far.x, 0.4, 1e-6) && near(far.y, 0, 1e-6),
    "straight towards a far target",
  );
  const close = twoBone(a, { x: 0.01, y: 0 }, 0.4, 0.3, 1);
  assert.ok(near(dist(a, close), 0.4), "folded as far as the bones allow");
  const same = twoBone(a, a, 0.4, 0.4, 1);
  assert.ok(Number.isFinite(same.x) && Number.isFinite(same.y));
});

test("the rider's joints follow the view and mirror when the bike faces left", () => {
  const bike = toView(racing()).riders[0]!.bike;
  const pose = poseOf(bike);
  assert.deepEqual(pose.head, bike.head, "the head is the view's");
  assert.ok(near(dist(pose.hip, pose.knee), THIGH));
  assert.ok(dist(pose.knee, pose.foot) <= SHIN + 0.05);
  assert.ok(near(dist(pose.shoulder, pose.elbow), UPPER_ARM));
  assert.ok(dist(pose.elbow, pose.hand) <= FOREARM + 0.05);
  assert.ok(pose.knee.x > pose.hip.x, "the knee points forward");
  assert.ok(pose.hand.x > bike.x, "the hands are on the bars, ahead");
  assert.ok(pose.elbow.y < pose.shoulder.y, "the elbow hangs");
  assert.ok(pose.neck.y < bike.head.y && pose.neck.y > pose.hip.y);
  // The struts reach the hubs: the swingarm the rear wheel, the fork the front.
  assert.deepEqual(pose.struts[0][1], { x: bike.left.x, y: bike.left.y });
  assert.deepEqual(pose.struts[1][1], { x: bike.right.x, y: bike.right.y });

  // The same bike mirrored about its frame's centre and facing left.
  const mirror = <P extends { x: number }>(point: P): P => ({
    ...point,
    x: 2 * bike.x - point.x,
  });
  const flipped: BikeView = {
    ...bike,
    flipped: true,
    left: mirror(bike.right),
    right: mirror(bike.left),
    body: mirror(bike.body),
    head: mirror(bike.head),
  };
  const mirrored = poseOf(flipped);
  for (const joint of ["hip", "knee", "foot", "elbow", "hand"] as const) {
    assert.ok(near(mirrored[joint].x, mirror(pose[joint]).x, 1e-9), joint);
    assert.ok(near(mirrored[joint].y, pose[joint].y, 1e-9), joint);
  }
  assert.deepEqual(mirrored.struts[0][1], {
    x: flipped.right.x,
    y: flipped.right.y,
  });
});

// ---- colours ----

test("each roster slot has its own colour, and the sprites' cyan is turned to it", () => {
  assert.equal(new Set(SLOT_COLORS).size, 5);
  assert.equal(slotColor(0), SLOT_COLORS[0]);
  assert.equal(slotColor(5), SLOT_COLORS[0]);
  assert.equal(slotColor(-1), SLOT_COLORS[4]);
  assert.equal(slotHueShift(0), 0);
  assert.equal(new Set([0, 1, 2, 3, 4].map(slotHueShift)).size, 5);
  assert.equal(hexA("#ff0080", 0.5), "rgba(255,0,128,0.5)");
  assert.equal(hexA("#000000", 7), "rgba(0,0,0,1)");
});

test("turning a sprite's hue moves the colour and leaves greys, brightness and alpha alone", () => {
  // Pure red, a grey, a transparent pixel, and the sprites' cyan at half alpha.
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255, 120, 120, 120, 255, 9, 200, 30, 0, 22, 231, 255, 128,
  ]);
  shiftHue(pixels, 120);
  assert.deepEqual([...pixels.slice(0, 4)], [0, 255, 0, 255], "red to green");
  assert.deepEqual([...pixels.slice(4, 8)], [120, 120, 120, 255], "grey stays");
  assert.deepEqual([...pixels.slice(8, 12)], [9, 200, 30, 0], "nothing to see");
  const [r, g, b, a] = pixels.slice(12, 16);
  assert.equal(a, 128);
  assert.equal(Math.max(r!, g!, b!), 255, "as bright as it was");
  assert.equal(Math.min(r!, g!, b!), 22, "as saturated as it was");
  assert.ok(r! > b!, "cyan turned towards pink and red");
  const same = new Uint8ClampedArray([10, 200, 90, 255]);
  shiftHue(same, 360);
  assert.deepEqual([...same], [10, 200, 90, 255]);
  // There and back again.
  const round = new Uint8ClampedArray([22, 231, 255, 255]);
  shiftHue(round, 140);
  shiftHue(round, 220);
  assert.ok(
    [22, 231, 255].every((value, i) => Math.abs(round[i]! - value) <= 2),
    [...round].join(),
  );
});

// ---- effects and smoothing ----

test("sparks move by the wall clock, fade out, stay bounded and show only in their rider's pane", () => {
  let n = 0;
  const effects = createEffects(() => ((n = (n * 73 + 17) % 101), n / 101));
  effects.burst(0, 0, "#ffffff", 10, 5, { life: 0.5, tag: 1 });
  assert.equal(effects.count, 10);
  effects.step(0.1);
  assert.equal(effects.count, 10);
  effects.step(0.1);
  for (let i = 0; i < 10; i++) effects.step(0.1);
  assert.equal(effects.count, 0, "gone after their life");
  for (let i = 0; i < 100; i++) effects.burst(0, 0, "#ffffff", 10, 5);
  assert.equal(effects.count, MAX_PARTICLES);
  effects.dust(0, 0, -1, 0, "#ffffff", 0);
  assert.equal(effects.count, MAX_PARTICLES);
  effects.clear();
  assert.equal(effects.count, 0);
});

test("a rollback's correction on another rider glides; this device's own bike and a restart are shown as they are", () => {
  const smoother = createSmoother();
  const base = toView(racing(20));
  const moved = (dx: number): WorldView => ({
    ...base,
    riders: base.riders.map((rider) => ({
      ...rider,
      bike: shiftBike(rider.bike, dx, 0),
    })),
  });
  const x = (view: WorldView, slot: number) => view.riders[slot]!.bike.x;
  assert.equal(smoother.apply(base, 1, 0, 0), base, "nothing to hide");
  // The runtime replaced history: both bikes are 0.5 further on.
  const corrected = smoother.apply(moved(0.5), 2, 16, 0);
  assert.equal(
    x(corrected, 0),
    x(base, 0) + 0.5,
    "the local bike jumps with its rider",
  );
  assert.ok(
    near(x(corrected, 1), x(base, 1)),
    "the ghost stays where it was drawn",
  );
  const head = corrected.riders[1]!.bike.head.x;
  assert.ok(near(head, base.riders[1]!.bike.head.x), "all of it");
  const later = smoother.apply(moved(0.5), 2, 16 + DECAY_MS, 0);
  assert.ok(x(later, 1) > x(base, 1) && x(later, 1) < x(base, 1) + 0.5);
  const settled = smoother.apply(moved(0.5), 2, 16 + DECAY_MS * 20, 0);
  assert.equal(x(settled, 1), x(base, 1) + 0.5);
  // A correction as long as a restart is not dragged across the level.
  const far = smoother.apply(moved(40), 3, 17 + DECAY_MS * 20, 0);
  assert.equal(x(far, 1), x(base, 1) + 40);
});

test("a cue given again by a rollback a moment later is told once", () => {
  const gate = cueGate();
  const apple = { kind: "apple", slot: 0, x: 3, y: 1, gravity: false } as const;
  const crash = { kind: "crash", slot: 0, x: 0, y: 0 } as const;
  assert.deepEqual(gate([apple, crash], 1000), [apple, crash]);
  assert.deepEqual(gate([apple, crash, { kind: "go" }], 1100), [
    { kind: "go" },
  ]);
  assert.deepEqual(gate([{ ...apple, slot: 1 }], 1100), [
    { ...apple, slot: 1 },
  ]);
  assert.deepEqual(gate([apple], 1000 + CUE_HOLD), [apple]);
});
