import test from "node:test";
import assert from "node:assert/strict";
import type { Frame } from "fuse-netcode";
import { blend, drawn, fraction } from "../src/app/interpolate.js";
import type {
  EnemyView,
  HeroView,
  ItemView,
  WorldView,
} from "../src/engine/view.js";
import {
  DEFAULT_SETTINGS,
  createRoom,
  view,
  type View,
} from "../src/online/game.js";

const hero = (id: number, x: number, y = 120, z = 0): HeroView => ({
  id,
  seat: id,
  kind: "rhea",
  x,
  y,
  z,
  facing: 1,
  anim: "walk",
  animStep: 0,
  hp: 48,
  maxHp: 48,
  lives: 3,
  invulnerable: false,
  pots: 0,
  maxPots: 6,
  charge: 0,
});
const enemy = (id: number, x: number): EnemyView => ({
  id,
  kind: "ravager",
  x,
  y: 130,
  z: 0,
  facing: -1,
  anim: "idle",
  animStep: 0,
  hp: 40,
  maxHp: 40,
  flash: false,
  boss: false,
  enraged: false,
  mounted: false,
  tier: 0,
});
const world = (extra: Partial<WorldView> = {}): WorldView => ({
  step: 0,
  camX: 0,
  heroes: [],
  enemies: [],
  fx: [],
  items: [],
  spells: [],
  mounts: [],
  stage: 1,
  camp: false,
  wave: 0,
  waves: 5,
  locked: false,
  go: false,
  cleared: false,
  defeated: false,
  boss: null,
  ...extra,
});

test("the presentation clock's place between two frames, never outside them", () => {
  assert.equal(fraction(10, 13, 11.5), 0.5);
  assert.equal(fraction(10, 13, 9), 0);
  assert.equal(fraction(10, 13, 20), 1);
  assert.equal(fraction(undefined, 13, 11), 1, "nothing to blend from");
  assert.equal(fraction(13, 13, 13), 1, "no span");
});

test("drawing between frames moves figures by id on whole pixels and leaves the rest as the newer frame has it", () => {
  const older = world({
    heroes: [hero(1, 100, 120, 0)],
    enemies: [enemy(7, 200)],
  });
  const newer = world({
    step: 3,
    heroes: [hero(1, 106, 124, 10), hero(2, 50)],
    enemies: [enemy(7, 206), enemy(8, 300)],
    fx: [{ kind: "hit", x: 90, y: 120, z: 8, age: 1 }],
  });
  const half = blend(older, newer, 0.5);
  assert.deepEqual(
    [half.heroes[0]!.x, half.heroes[0]!.y, half.heroes[0]!.z],
    [103, 122, 5],
  );
  assert.equal(half.enemies[0]!.x, 203);
  assert.deepEqual(
    half.heroes[1],
    newer.heroes[1],
    "a figure new since `older` stays put",
  );
  assert.deepEqual(half.enemies[1], newer.enemies[1]);
  assert.equal(half.step, newer.step);
  assert.equal(half.fx, newer.fx, "a spark stands where it struck");
  assert.equal(half.heroes[0]!.anim, "walk");
  const quarter = blend(older, newer, 0.25);
  assert.ok(
    [quarter.heroes[0]!.x, quarter.heroes[0]!.y, quarter.enemies[0]!.x].every(
      Number.isInteger,
    ),
    "every position is a whole pixel",
  );
  assert.equal(blend(older, newer, 1), newer);
  assert.equal(blend(older, newer, 2), newer);
  assert.equal(blend(older, newer, 0).heroes[0]!.x, 100);
  assert.equal(
    blend(older, newer, -1).heroes[0]!.x,
    100,
    "never before `older`",
  );
});

test("a hero that drops back in appears at its drop point instead of sliding there from where it fell", () => {
  const older = world({
    camX: 400,
    heroes: [{ ...hero(1, 40, 120, 0), anim: "dead", lives: 2 }],
  });
  const newer = world({
    step: 3,
    camX: 400,
    heroes: [{ ...hero(1, 464, 138, 130), anim: "respawn", lives: 2 }],
  });
  const half = blend(older, newer, 0.5);
  assert.deepEqual(
    [half.heroes[0]!.x, half.heroes[0]!.y, half.heroes[0]!.z],
    [464, 138, 130],
  );
  // Falling on, it blends as any figure in the air does.
  const falling = world({
    step: 6,
    camX: 400,
    heroes: [{ ...hero(1, 464, 138, 110), anim: "respawn", lives: 2 }],
  });
  assert.equal(blend(newer, falling, 0.5).heroes[0]!.z, 120);
});

test("a camera that follows a hero keeps it at the same screen column, and one that passes a stander moves it as the backdrop does", () => {
  const older = world({
    camX: 0,
    heroes: [hero(1, 100)],
    enemies: [enemy(7, 200)],
  });
  const newer = world({
    camX: 6,
    heroes: [hero(1, 106)],
    enemies: [enemy(7, 200)],
  });
  const half = blend(older, newer, 0.5);
  assert.equal(half.camX, 3);
  assert.equal(
    half.heroes[0]!.x - half.camX,
    100,
    "walking with the camera, the hero holds its column",
  );
  assert.equal(
    half.enemies[0]!.x - half.camX,
    197,
    "a standing enemy slides left by the camera's half step, as the posts do",
  );
});

test("a pot popping out of a sack rises and falls between ticks, a lying one stays put under a moving camera, and a new one stands where it appeared", () => {
  const pot = (id: number, x: number, z: number): ItemView => ({
    ...{ id, kind: "pot", x, y: 130, z },
    blink: false,
  });
  const older = world({ camX: 0, items: [pot(5, 200, 12), pot(6, 240, 0)] });
  const newer = world({
    ...{ step: 3, camX: 6 },
    items: [pot(5, 200, 16), pot(6, 240, 0), pot(7, 260, 12)],
  });
  const half = blend(older, newer, 0.5);
  assert.equal(half.items[0]!.z, 14, "the popping pot is halfway up");
  assert.equal(half.items[1]!.x, 240, "the lying pot keeps its place");
  assert.deepEqual(half.items[2], newer.items[2], "a new pot is where it is");
});

test("frames of one run blend; across a run or stage or into camp, or with nothing earlier or nothing to draw, the newer frame stands alone", () => {
  const room = createRoom("m1", DEFAULT_SETTINGS);
  const frame = (
    wv: WorldView | null,
    tick: number,
    extra: Partial<View> = {},
  ): Frame<View> => ({
    ...view(room),
    tick,
    logTick: tick / 3,
    managerId: "a",
    world: wv,
    ...extra,
  });
  const a = world({ heroes: [hero(1, 100)] }),
    b = world({ heroes: [hero(1, 106)] });
  const older = frame(a, 30, { matchId: "m", round: 1 }),
    newer = frame(b, 33, { matchId: "m", round: 1 });
  assert.equal(drawn({ older, newer, tick: 31.5 })!.heroes[0]!.x, 103);
  assert.equal(drawn({ older, newer, tick: 33 }), b);
  assert.equal(drawn({ older, newer, tick: 30 })!.heroes[0]!.x, 100);
  assert.equal(
    drawn({ older: { ...older, round: 0 }, newer, tick: 31.5 }),
    b,
    "another stage",
  );
  assert.equal(
    drawn({ older: { ...older, matchId: "other" }, newer, tick: 31.5 }),
    b,
    "another run",
  );
  const camp = { ...b, camp: true };
  assert.equal(
    drawn({ older, newer: { ...newer, world: camp }, tick: 31.5 }),
    camp,
    "into camp after the stage's tally",
  );
  assert.equal(drawn({ newer, tick: 33 }), b, "no earlier frame");
  assert.equal(drawn({ older: frame(null, 30), newer, tick: 31 }), b);
  assert.equal(
    drawn({ newer: frame(null, 33), tick: 33 }),
    null,
    "the lobby has no world",
  );
  assert.equal(drawn(undefined), null);
});
