import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  spawnEnemy,
  toView,
  type WorldView,
} from "../src/engine/index.js";
import {
  FLOOR_BOTTOM_PX,
  FLOOR_TOP_PX,
  VIEW_H,
  VIEW_W,
} from "../src/engine/view-kit.js";
import {
  BODY_H,
  BLADE,
  BODY_W,
  ENEMY_COLOR,
  POST_GAP,
  SEAT_COLORS,
  draw,
  type Paint,
} from "../src/render/debug-scene.js";

type Call = [string, string, ...number[]];

/** A 2D context that records every rectangle and ellipse with the colour it was filled in. */
function recorder(): Paint & { calls: Call[] } {
  const calls: Call[] = [];
  let pending: number[] = [];
  return {
    calls,
    fillStyle: "",
    fillRect(x, y, w, h) {
      calls.push(["rect", String(this.fillStyle), x, y, w, h]);
    },
    beginPath() {
      pending = [];
    },
    ellipse(x, y, rx, ry) {
      pending = [x, y, rx, ry];
    },
    fill() {
      calls.push(["ellipse", String(this.fillStyle), ...pending]);
    },
  };
}

/** P1 jumping at (180, 150), P3 standing at (150, 120), the camera at 100, and a ravager at each `[x, y]` pixel. */
function world(
  ravagers: readonly (readonly [number, number])[] = [],
): WorldView {
  let state = createWorld({
    seed: 7,
    heroes: [
      { seat: 0, kind: "brakka" },
      { seat: 2, kind: "gorm" },
    ],
  });
  // `spawnEnemy` takes sub-units, 256 to the pixel.
  for (const [x, y] of ravagers)
    state = spawnEnemy(state, "ravager", x * 256, y * 256);
  const view = toView(state);
  view.camX = 100;
  view.heroes[0] = { ...view.heroes[0]!, x: 180, y: 150, z: 20, facing: -1 };
  view.heroes[1] = { ...view.heroes[1]!, x: 150, y: 120, z: 0, facing: 1 };
  return view;
}
const rects = (calls: Call[], color: string) =>
  calls.filter(([kind, fill]) => kind === "rect" && fill === color);

test("the scene fills the native screen: sky, the floor band and its edges", () => {
  const ctx = recorder();
  draw(ctx, world(), 0);
  const [sky, , floor] = ctx.calls;
  assert.deepEqual(sky!.slice(2), [0, 0, VIEW_W, FLOOR_TOP_PX]);
  assert.deepEqual(floor!.slice(2), [
    0,
    FLOOR_TOP_PX,
    VIEW_W,
    VIEW_H - FLOOR_TOP_PX,
  ]);
  const rows = ctx.calls
    .filter((call) => call[0] === "rect" && call[5] === 1 && call[4] === VIEW_W)
    .map((call) => call[3]);
  assert.deepEqual(rows, [FLOOR_TOP_PX, FLOOR_BOTTOM_PX]);
});

test("each hero is a box in its seat's colour at (x − camX, y − z) over a shadow on the floor at (x − camX, y)", () => {
  const ctx = recorder();
  draw(ctx, world(), 0);
  const [p1] = rects(ctx.calls, SEAT_COLORS[0]);
  assert.deepEqual(p1!.slice(2), [
    180 - 100 - BODY_W / 2,
    150 - 20 - BODY_H,
    BODY_W,
    BODY_H,
  ]);
  const [p3] = rects(ctx.calls, SEAT_COLORS[2]);
  assert.deepEqual(p3!.slice(2, 4), [150 - 100 - BODY_W / 2, 120 - BODY_H]);
  const shadows = ctx.calls.filter(([kind]) => kind === "ellipse");
  assert.deepEqual(
    shadows.map((call) => call.slice(2, 4)),
    [
      [50, 120],
      [80, 150],
    ],
    "shadows stay on the floor, the jumping hero's too",
  );
  // Further up the floor is further away: P3 (y 120) is drawn before P1 (y 150).
  const order = ctx.calls.map(([, fill]) => fill);
  assert.ok(order.indexOf(SEAT_COLORS[2]) < order.indexOf(SEAT_COLORS[0]));
  // The facing tick sits on the side the hero looks to.
  const eyes = rects(ctx.calls, "#ffffff").map((call) => call[2]);
  assert.deepEqual(eyes, [50 - BODY_W / 2 + BODY_W - 3, 80 - BODY_W / 2 + 1]);
});

test("the road's posts scroll with the camera and their embers flicker with the frame", () => {
  const posts = (camX: number, frame: number) => {
    const ctx = recorder(),
      view = world();
    view.camX = camX;
    draw(ctx, view, frame);
    return ctx.calls.filter((call) => call[4] === 3 && call[5] === 2);
  };
  const still = posts(0, 0);
  assert.equal(still.length, VIEW_W / POST_GAP);
  assert.deepEqual(
    still.map((call) => call[2]),
    Array.from({ length: VIEW_W / POST_GAP }, (_, i) => i * POST_GAP),
  );
  const moved = posts(15, 0);
  assert.equal(moved[0]![2], -15, "the first post slides off the left edge");
  assert.equal(moved.at(-1)![2], 8 * POST_GAP - 15);
  assert.notEqual(posts(0, 0)[0]![1], posts(0, 8)[0]![1]);
  assert.equal(posts(0, 0)[0]![1], posts(0, 16)[0]![1]);
});

test("enemies are red boxes sorted into the heroes by depth", () => {
  const ctx = recorder();
  draw(ctx, world([[200, 130]]), 0);
  const [enemy] = rects(ctx.calls, ENEMY_COLOR);
  assert.deepEqual(enemy!.slice(2), [94, 102, BODY_W, BODY_H]);
  const order = ctx.calls.map(([, fill]) => fill);
  assert.ok(order.indexOf(SEAT_COLORS[2]) < order.indexOf(ENEMY_COLOR));
  assert.ok(order.indexOf(ENEMY_COLOR) < order.indexOf(SEAT_COLORS[0]));
  assert.equal(
    ctx.calls.filter(([kind]) => kind === "ellipse").length,
    3,
    "every figure has a shadow",
  );
});

test("a swing shows a blade on the side the hero faces, longer for the finisher; no swing, no blade", () => {
  const blades = (anim: "attack1" | "attack3" | "walk") => {
    const ctx = recorder(),
      view = world();
    for (const hero of view.heroes) hero.anim = anim;
    draw(ctx, view, 0);
    return rects(ctx.calls, BLADE).map((call) => call.slice(2));
  };
  assert.deepEqual(blades("walk"), []);
  // P3 at screen x 50 faces right; P1 at 80, 20 px up in a jump, faces left.
  assert.deepEqual(blades("attack1"), [
    [50 - BODY_W / 2 + BODY_W, 120 - BODY_H + 12, 10, 2],
    [80 - BODY_W / 2 - 10, 150 - 20 - BODY_H + 12, 10, 2],
  ]);
  assert.deepEqual(
    blades("attack3").map((call) => call[2]),
    [14, 14],
  );
});
