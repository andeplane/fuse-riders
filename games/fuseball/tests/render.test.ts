import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  MAP_IDS,
  RIGHT,
  toView,
  type World,
  type WorldView,
} from "../src/engine/index.js";
import {
  BUBBLE_RADIUS,
  VIEW_H,
  VIEW_W,
  mapOf,
} from "../src/engine/view-kit.js";
import { between, blend, fraction } from "../src/render/interpolate.js";
import {
  MAX_PARTICLES,
  createEffects,
  cues,
  goalNear,
  type Cue,
} from "../src/render/effects.js";
import { bannerOf, scoreSegments } from "../src/render/hud.js";
import { TEAM, hexA } from "../src/render/palette.js";
import {
  copies,
  createScene,
  letterbox,
  solidCopies,
  type SceneCanvas,
} from "../src/render/scene.js";
import {
  FRAME_ART,
  FRAME_NAMES,
  SPRITE_H,
  SPRITE_W,
  frameFor,
  type Paint,
} from "../src/render/sprites.js";
import {
  ballAt,
  fresh,
  held,
  place,
  playing,
  steps,
  until,
} from "./fixtures/world.js";

/** A 2D context that records what was drawn: every member of `Paint`, so the scene draws on it in Node as it is. */
function recorder() {
  const calls: (string | number)[][] = [];
  const note =
    (name: string) =>
    (...args: (string | number | boolean | undefined)[]) =>
      void calls.push([
        name,
        ...args.filter((a) => typeof a !== "boolean" && a !== undefined),
      ]);
  const gradient = { addColorStop: () => {} };
  const g: Paint = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    save: note("save"),
    restore: note("restore"),
    setTransform: (...args: unknown[]) =>
      void calls.push([
        "setTransform",
        ...args.filter((a) => typeof a === "number"),
      ]),
    translate: note("translate"),
    beginPath: note("beginPath"),
    closePath: note("closePath"),
    moveTo: note("moveTo"),
    lineTo: note("lineTo"),
    arc: note("arc"),
    ellipse: note("ellipse"),
    rect: note("rect"),
    clip: () => void calls.push(["clip"]),
    fill: () => void calls.push(["fill"]),
    stroke: () => void calls.push(["stroke"]),
    fillRect: (x, y, w, h) =>
      void calls.push(["fillRect", x, y, w, h, String(g.fillStyle)]),
    fillText: note("fillText"),
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
  };
  const canvas: SceneCanvas & { clientWidth: number; clientHeight: number } = {
    width: VIEW_W,
    height: VIEW_H,
    clientWidth: 0,
    clientHeight: 0,
    getContext: () => g,
  };
  return {
    calls,
    canvas,
    clear: () => void (calls.length = 0),
    texts: () =>
      calls.filter((c) => c[0] === "fillText").map((c) => String(c[1])),
    arcs: (radius: number) =>
      calls.filter((c) => c[0] === "arc" && c[3] === radius).length,
    /** How many times exactly this rectangle was filled, in `style` if one is given. */
    rects: (x: number, y: number, w: number, h: number, style?: string) =>
      calls.filter(
        (c) =>
          c[0] === "fillRect" &&
          c[1] === x &&
          c[2] === y &&
          c[3] === w &&
          c[4] === h &&
          (style === undefined || c[5] === style),
      ).length,
  };
}

/** A fixed scatter, so a test draws the same particles every run. */
const dice = () => {
  let seed = 11;
  return () => (seed = (seed * 48271) % 0x7fffffff) / 0x7fffffff;
};
const kinds = (found: readonly Cue[]) => found.map((cue) => cue.kind);

/** Slot 0 jumps from the floor and air-jumps `bubbles` times, each press a fresh edge. */
function fly(world: World, bubbles: number): void {
  for (let i = 0; i <= bubbles; i++) {
    steps(world, 4, held(BTN));
    steps(world, 14, held(0));
  }
}
/** The ball dropped into `team`'s goal: the world one step after the point. */
function scored(world: World, team: 0 | 1): { x: number; y: number } {
  const goal = goalNear(toView(world), team, team === 0 ? VIEW_W : 0, 180);
  ballAt(world, Math.round(goal.x), Math.round(goal.y));
  assert.notEqual(
    until(world, () => world.phase !== "play"),
    -1,
  );
  return goal;
}

test("a coordinate goes the short way round a wrapping axis and snaps across a fixed one", () => {
  assert.equal(between(100, 120, 0.25, VIEW_W, true), 105);
  assert.equal(between(100, 120, 0.25, VIEW_W, false), 105);
  // Out through the right edge and in at the left: never back across the field.
  assert.equal(between(636, 4, 0.25, VIEW_W, true), 638);
  assert.equal(between(636, 4, 0.75, VIEW_W, true), 2);
  assert.equal(between(4, 636, 0.75, VIEW_W, true), 638);
  assert.equal(between(4, 636, 0.5, VIEW_W, true), 0);
  for (let a = 0; a <= 1; a += 0.125) {
    const x = between(630, 12, a, VIEW_W, true);
    assert.ok(x >= 0 && x < VIEW_W && (x >= 630 || x <= 12), `${a}: ${x}`);
  }
  // No seam to cross on a walled axis: more than half the field is a teleport.
  assert.equal(between(600, 40, 0.5, VIEW_W, false), 40);
  assert.equal(between(40, 600, 0.01, VIEW_W, false), 600);
});

test("blending moves riders and the ball between two views, the short way round on the map's wrapping axes", () => {
  const world = playing("gridlock");
  place(world, 0, 636, 100);
  ballAt(world, 300, 100);
  const older = toView(world);
  place(world, 0, 4, 110);
  ballAt(world, 320, 110);
  world.step += 6;
  world.riders[0].jumps += 1;
  const newer = toView(world);

  const mid = blend(older, newer, 0.5);
  assert.equal(mid.riders[0].x, 0);
  assert.equal(mid.riders[0].y, 105);
  assert.equal(mid.ball.x, 310);
  assert.equal(mid.step, older.step + 3);
  // Flags and counters are the newer view's: the effect fires on the first blended frame.
  assert.equal(mid.riders[0].jumps, newer.riders[0].jumps);
  assert.deepEqual(mid.bubbles, newer.bubbles);
  assert.equal(blend(older, newer, 0).riders[0].x, 636);
  assert.equal(blend(older, newer, 1), newer);
  assert.equal(blend(undefined, newer, 0.5), newer);
  assert.equal(blend(newer, older, 0.5), older, "out of order");

  // Downlink's sides are walls: the same jump there is a teleport, and it wraps top to bottom instead.
  const walled = playing("downlink");
  place(walled, 1, 600, 356);
  const before = toView(walled);
  place(walled, 1, 40, 4);
  walled.step += 6;
  const after = blend(before, toView(walled), 0.5);
  assert.equal(after.riders[1].x, 40);
  assert.equal(after.riders[1].y, 0);
});

test("views either side of a point reset, or of different arenas, are not blended", () => {
  const world = playing("halo");
  scored(world, 0);
  const zap = toView(world);
  assert.notEqual(
    until(world, () => world.phase === "countdown"),
    -1,
  );
  const reset = toView(world);
  assert.equal(blend(zap, reset, 0.5), reset);
  const other = toView(playing("gridlock"));
  assert.equal(blend(other, reset, 0.5), reset);

  assert.equal(fraction(undefined, 10, 10), 1);
  assert.equal(fraction(10, 12, 11), 0.5);
  assert.equal(fraction(10, 12, 40), 1);
  assert.equal(fraction(12, 12, 12), 1);
});

test("cues are read off counters moving forwards: a jump, a bubble, the trail it replaces, a pop", () => {
  const world = playing("gridlock");
  let last = toView(world);
  const next = () => {
    const found = cues(last, (last = toView(world)));
    return found;
  };
  steps(world, 4, held(BTN));
  assert.deepEqual(kinds(next()), ["jump"]);
  steps(world, 14);
  assert.deepEqual(kinds(next()), []);

  steps(world, 4, held(BTN));
  const first = next();
  // Still held a step after the press: the new bubble is already hard.
  assert.deepEqual(kinds(first).sort(), ["bubble", "harden", "jump"]);
  const placed = first.find((cue) => cue.kind === "bubble");
  assert.ok(placed && placed.kind === "bubble" && placed.slot === 0);
  steps(world, 14);
  steps(world, 4, held(BTN));
  const second = next();
  assert.deepEqual(kinds(second).sort(), ["bubble", "harden", "jump", "trail"]);
  const trail = second.find((cue) => cue.kind === "trail");
  assert.ok(trail && trail.kind === "trail");
  assert.equal(trail.x, placed.x);
  assert.equal(trail.y, placed.y);
  // Holding on is no news.
  steps(world, 6, held(BTN));
  assert.deepEqual(kinds(next()), []);

  // A bubble gone with its number unchanged was popped; a counter that fell (a rollback) says nothing.
  const before = toView(world);
  const popped: WorldView = {
    ...before,
    bubbles: [
      { ...before.bubbles[0], active: false, hard: false },
      before.bubbles[1],
    ],
  };
  assert.deepEqual(kinds(cues(before, popped)), ["pop"]);
  assert.deepEqual(cues(last, before), []);
  const rolled: WorldView = {
    ...before,
    riders: [
      { ...before.riders[0], jumps: before.riders[0].jumps - 1 },
      before.riders[1],
    ],
    ball: { ...before.ball, bounces: 65535 },
  };
  assert.deepEqual(cues(before, rolled), []);
  // 65535 → 2 is three bounces on, not a fall: counters wrap.
  assert.deepEqual(
    kinds(cues(rolled, { ...rolled, ball: { ...rolled.ball, bounces: 2 } })),
    ["bounce"],
  );
  assert.deepEqual(cues(undefined, before), []);
});

test("a point gives a goal cue at the goal and a zap cue from it to the rider it struck", () => {
  for (const mapId of MAP_IDS) {
    const world = playing(mapId);
    const before = toView(world);
    const goal = scored(world, 0);
    const found = cues(before, toView(world));
    const point = found.find((cue) => cue.kind === "goal"),
      zap = found.find((cue) => cue.kind === "zap");
    assert.ok(point && point.kind === "goal", mapId);
    assert.equal(point.team, 0);
    assert.deepEqual({ x: point.x, y: point.y }, goal, mapId);
    assert.ok(zap && zap.kind === "zap", mapId);
    assert.equal(zap.slot, 1);
    assert.deepEqual({ x: zap.fromX, y: zap.fromY }, goal);
    assert.equal(zap.x, before.riders[1].x);
    // The reset clears the bubbles without popping them, and the countdown counts.
    const zapped = toView(world);
    until(world, () => world.phase === "countdown");
    assert.deepEqual(kinds(cues(zapped, toView(world))), ["count"]);
  }
  const world = fresh("gridlock");
  const counting = toView(world);
  until(world, () => world.phase === "play");
  assert.deepEqual(kinds(cues(counting, toView(world))), ["go"]);
});

test("effects fire once per change, stay inside their pool and die out on the clock they are given", () => {
  const fx = createEffects({ random: dice() });
  const world = playing("gridlock");
  let now = 0;
  assert.deepEqual(fx.update(toView(world), now), []);
  fly(world, 1);
  const view = toView(world);
  const found = fx.update(view, (now += 16));
  assert.ok(kinds(found).includes("bubble"));
  assert.ok(fx.count() > 0);
  assert.equal(fx.bubbleAge(0, now + 100), 100);
  // The same view again is no news.
  const alive = fx.count();
  assert.deepEqual(fx.update(view, now), []);
  assert.equal(fx.count(), alive);

  // Far more than the pool holds: a goal and a zap every frame.
  const before = toView(world);
  scored(world, 0);
  const after = toView(world);
  for (let i = 0; i < 40; i++) {
    fx.update(before, (now += 1));
    fx.update(after, (now += 1));
    assert.ok(fx.count() <= MAX_PARTICLES);
  }
  assert.equal(fx.count(), MAX_PARTICLES);
  assert.ok(fx.zapAge(1, now) < 5);
  assert.equal(fx.zapAge(0, now), Infinity);

  // Time passes only as `update` is told: no frames, no change; a hidden tab's gap is one short step.
  fx.update(after, now + 60_000);
  assert.ok(fx.count() > 0);
  const clear = createEffects({ random: dice() });
  clear.update(toView(playing("halo")), 0);
  const halo = playing("halo");
  fly(halo, 1);
  clear.update(toView(halo), 16);
  assert.ok(clear.count() > 0);
  clear.reset();
  assert.equal(clear.count(), 0);
});

test("the field is letterboxed in the canvas at the device's pixel ratio", () => {
  assert.deepEqual(letterbox(1920, 1080), { scale: 3, x: 0, y: 0 });
  assert.deepEqual(letterbox(800, 800), { scale: 1.25, x: 0, y: 175 });
  assert.deepEqual(letterbox(1000, 360), { scale: 1, x: 180, y: 0 });

  const paper = recorder();
  let ratio = 2;
  const scene = createScene(paper.canvas, {
    pixelRatio: () => ratio,
    random: dice(),
  });
  paper.canvas.clientWidth = 400;
  paper.canvas.clientHeight = 400;
  scene.resize();
  assert.equal(paper.canvas.width, 800);
  assert.equal(paper.canvas.height, 800);
  scene.draw(toView(fresh()), 0, 0);
  assert.ok(
    paper.calls.some(
      (c) => c[0] === "setTransform" && c[1] === 1.25 && c[6] === 175,
    ),
  );
  assert.equal(paper.rects(0, 0, 800, 800), 1, "the bars are cleared too");
  // A box or a ratio that changed is picked up by the next draw.
  ratio = 1;
  paper.canvas.clientWidth = 640;
  paper.canvas.clientHeight = 360;
  scene.draw(toView(fresh()), 16, 0);
  assert.equal(paper.canvas.width, 640);
  assert.equal(paper.canvas.height, 360);
});

test("a solid over a seam is drawn again at the start of the axis, and a body near one on both sides", () => {
  const gridlock = mapOf("gridlock"),
    downlink = mapOf("downlink");
  assert.deepEqual(
    solidCopies(gridlock, { x: 628, y: 0, w: 24, h: 140 }).map((s) => s.x),
    [628, -12],
  );
  assert.deepEqual(
    solidCopies(downlink, { x: 200, y: 344, w: 240, h: 32 }).map((s) => s.y),
    [344, -16],
  );
  assert.equal(solidCopies(gridlock, gridlock.solids[0]!).length, 1);

  assert.deepEqual(copies(gridlock, 320, 180, 20), [{ x: 320, y: 180 }]);
  assert.deepEqual(copies(gridlock, 5, 180, 20), [
    { x: 5, y: 180 },
    { x: 645, y: 180 },
  ]);
  assert.deepEqual(copies(downlink, 5, 180, 20), [{ x: 5, y: 180 }]);
  assert.equal(copies(mapOf("halo"), 636, 3, 20).length, 4);

  const paper = recorder();
  const scene = createScene(paper.canvas, { random: dice() });
  scene.draw(toView(playing("gridlock")), 0, -1);
  assert.equal(paper.rects(-12, 0, 24, 140), 1);
  assert.equal(paper.rects(628, 220, 24, 140), 1);
  paper.clear();
  scene.draw(toView(playing("downlink")), 16, -1);
  assert.equal(paper.rects(200, -16, 240, 32), 1);
});

test("the scene draws every arena in every phase, a hard bubble with a second ring, and nothing once destroyed", () => {
  for (const mapId of MAP_IDS) {
    const paper = recorder();
    const scene = createScene(paper.canvas, { random: dice() });
    const world = fresh(mapId);
    let now = 0;
    const draw = (local: 0 | 1 | -1 = 0) => {
      paper.clear();
      return scene.draw(toView(world), (now += 16), local);
    };
    draw();
    assert.ok(paper.texts().includes("3"), mapId);
    assert.ok(paper.texts().includes("YOU"));
    assert.ok(paper.texts().includes(mapOf(mapId).name.toUpperCase()));
    until(world, () => world.phase === "play");
    assert.deepEqual(kinds(draw()), ["go"]);
    assert.ok(paper.texts().includes("GO!"));
    assert.equal(paper.arcs(BUBBLE_RADIUS + 4.5), 0);

    // An air-jump with the button kept down: a hard bubble, ringed twice.
    steps(world, 4, held(BTN | RIGHT));
    steps(world, 14, held(RIGHT));
    steps(world, 20, held(BTN | RIGHT));
    assert.ok(world.bubbles[0].hard, mapId);
    // Long enough for the rings of the jump itself to fade.
    for (let i = 0; i < 60; i++) draw();
    const rings = paper.calls.filter(
      (c) =>
        c[0] === "arc" &&
        c[1] === world.bubbles[0].x / 4096 &&
        typeof c[3] === "number" &&
        c[3] > BUBBLE_RADIUS + 3,
    );
    assert.equal(rings.length, 1, mapId);

    scored(world, 1);
    const point = kinds(draw(1));
    assert.ok(point.includes("goal") && point.includes("zap"), mapId);
    assert.ok(paper.texts().includes("GOAL!"));
    world.score = [1, 2];
    until(world, () => world.phase === "countdown");
    until(world, () => world.phase === "play");
    scored(world, 1);
    until(world, () => world.phase === "over");
    draw(1);
    assert.ok(paper.texts().includes("MAGENTA WINS"), mapId);
    assert.ok(paper.texts().includes("YOU WIN"));
    paper.clear();
    scene.draw(toView(world), (now += 16), 0, ["Ada", "Grace"]);
    assert.ok(paper.texts().includes("GRACE WINS"));
    assert.ok(paper.texts().includes("YOU LOSE"));

    scene.destroy();
    paper.clear();
    assert.deepEqual(scene.draw(toView(world), (now += 16), 0), []);
    assert.equal(paper.calls.length, 0);
  }
});

test("the score bars stand on each side's edge, and sudden death and the winner are announced", () => {
  const left = scoreSegments(0, 3),
    right = scoreSegments(1, 3);
  assert.equal(left.length, 3);
  assert.ok(left.every((s) => s.x >= 0 && s.x + s.w <= 12));
  assert.ok(right.every((s) => s.x >= VIEW_W - 12 && s.x + s.w <= VIEW_W));
  assert.ok(left[0]!.y > left[1]!.y && left[1]!.y > left[2]!.y, "bottom up");

  const world = playing("halo");
  assert.equal(bannerOf(toView(world)), undefined);
  world.score = [2, 2];
  world.suddenDeath = true;
  assert.deepEqual(bannerOf(toView(world)), { text: "SUDDEN DEATH", team: -1 });
  const paper = recorder();
  const scene = createScene(paper.canvas, { random: dice() });
  scene.draw(toView(world), 0, -1);
  assert.ok(paper.texts().includes("SUDDEN DEATH"));
  // One lit segment per point, in the side's colour.
  world.score = [2, 1];
  world.suddenDeath = false;
  paper.clear();
  scene.draw(toView(world), 16, -1);
  const lit = (slot: 0 | 1) =>
    scoreSegments(slot, 3).map(
      (s) => paper.rects(s.x, s.y, s.w, s.h, TEAM[slot]) > 0,
    );
  assert.deepEqual(lit(0), [true, true, false]);
  assert.deepEqual(lit(1), [true, false, false]);
  assert.equal(hexA("#16e7ff", 0.5), "rgba(22,231,255,0.5)");
  assert.equal(hexA("#ffffff", 2), "rgba(255,255,255,1)");
});

test("every rider frame is a full 16×18 sprite, and the frame follows what the rider is doing", () => {
  for (const name of FRAME_NAMES) {
    const rows = FRAME_ART[name];
    assert.equal(rows.length, SPRITE_H, name);
    for (const row of rows) {
      assert.equal(row.length, SPRITE_W, `${name}: ${row}`);
      assert.match(row, /^[.ocldvwb]+$/, name);
    }
  }
  const rider = { x: 100, vx: 0, grounded: true, sliding: false };
  assert.equal(frameFor(rider), "stand");
  assert.equal(frameFor({ ...rider, grounded: false }), "air");
  assert.equal(frameFor({ ...rider, sliding: true }), "slide");
  assert.notEqual(
    frameFor({ ...rider, vx: 1 }),
    frameFor({ ...rider, vx: 1, x: 107 }),
  );
});
