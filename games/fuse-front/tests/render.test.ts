import test from "node:test";
import assert from "node:assert/strict";
import { SUB, TILE_PX, type CombatEvent } from "../src/engine/view.js";
import * as cam from "../src/render/camera.js";
import {
  EventDedupe,
  Effects,
  KEEP_STEPS,
  MAX_EFFECTS,
  effectsOf,
} from "../src/render/cues.js";
import { bakeGround } from "../src/render/ground.js";
import { rgba, type Colour, type Img } from "../src/render/pixel/image.js";
import { BIOME } from "../src/render/pixel/palette.js";
import * as art from "../src/render/sprites.js";

const VIEW = { w: 480, h: 320, scale: 2 };

test("the viewport keeps a whole scale and never shows past the map", () => {
  assert.deepEqual(cam.fitViewport(960, 640, 1, 768, 448), VIEW);
  // A high-density screen gets more device pixels per art pixel, not a blurrier picture.
  assert.equal(cam.fitViewport(960, 640, 2, 768, 448).scale, 4);
  assert.deepEqual(cam.fitViewport(200, 100, 1, 768, 448), {
    w: 200,
    h: 100,
    scale: 1,
  });
  assert.equal(cam.fitViewport(4000, 1200, 1, 768, 448).w, 768);
});

test("the pixel battlefield zooms by rows within bounds, stepping its whole scale", () => {
  assert.equal(cam.zoomRows(cam.TARGET_ROWS, 100), cam.MIN_ROWS);
  assert.equal(cam.zoomRows(cam.TARGET_ROWS, 0.01), cam.MAX_ROWS);
  // On a 900-pixel-tall view: 3× by default, 1× zoomed fully out.
  assert.equal(cam.fitViewport(1600, 900, 1, 4096, 4096).scale, 3);
  const out = cam.fitViewport(1600, 900, 1, 4096, 4096, cam.MAX_ROWS);
  assert.equal(out.scale, 1);
});

test("the camera clamps to the map and maps a pointer to its tile", () => {
  assert.deepEqual(cam.clampCamera(-50, -1, VIEW, 768, 448), { x: 0, y: 0 });
  assert.deepEqual(cam.clampCamera(999, 999, VIEW, 768, 448), {
    x: 288,
    y: 128,
  });
  assert.deepEqual(cam.clampCamera(160, 40, VIEW, 768, 448), { x: 160, y: 40 });
  const full = { w: 768, h: 448, scale: 1 };
  assert.deepEqual(cam.clampCamera(30, 30, full, 768, 448), { x: 0, y: 0 });
  const camera = { x: 160, y: 40 };
  // An art pixel is 2 device pixels: 1 CSS pixel at dpr 1, half of one at dpr 2.
  assert.deepEqual(cam.screenToArt(17, 9, camera, VIEW, 1), { x: 168, y: 44 });
  assert.deepEqual(cam.screenToArt(8, 4, camera, VIEW, 2), { x: 168, y: 44 });
  assert.deepEqual(cam.artToTile(168, 44, TILE_PX, 96, 56), { x: 21, y: 5 });
  assert.equal(cam.artToTile(-1, 0, TILE_PX, 96, 56), undefined);
  assert.equal(cam.artToTile(96 * TILE_PX, 0, TILE_PX, 96, 56), undefined);
  assert.deepEqual(cam.edgePan(5, 200, 800, 600), { x: -1, y: 0 });
  assert.deepEqual(cam.edgePan(795, 595, 800, 600), { x: 1, y: 1 });
  assert.deepEqual(cam.edgePan(400, 300, 800, 600), { x: 0, y: 0 });
  assert.deepEqual(cam.edgePan(-5, 300, 800, 600), { x: 0, y: 0 });
});

const shot = (step: number, id = 1) => ({
  step,
  event: {
    type: "shot",
    from: { of: "unit", id, x: 0, y: 0 },
    to: { of: "unit", id: 9, x: 8 * SUB, y: 0 },
    damage: 6,
  } satisfies CombatEvent,
});

test("a rollback that re-delivers the same events plays each cue once", () => {
  const dedupe = new EventDedupe();
  const played: number[] = [];
  const deliver = (steps: readonly number[], id = 1) => {
    for (const step of steps)
      if (dedupe.accept("m1", shot(step, id))) played.push(step);
  };
  deliver([10, 11, 12]);
  // The netcode rolls back to step 11 and re-runs: 11 and 12 come again, then 13 is new.
  deliver([11, 12, 13]);
  assert.deepEqual(played, [10, 11, 12, 13]);
  // A re-run that changed what happened on step 12 is a different event, and plays.
  deliver([12], 2);
  assert.deepEqual(played, [10, 11, 12, 13, 12]);
  assert.ok(dedupe.accept("m2", shot(10)), "a new match starts afresh");
  for (let step = 0; step < 3 * KEEP_STEPS; step++)
    dedupe.accept("m3", shot(step));
  assert.ok(dedupe.size <= KEEP_STEPS + 1, "bounded");
  assert.equal(dedupe.accept("m3", shot(1)), false, "too old to replay");
});

test("events become effects in art pixels, and effects expire under a cap", () => {
  const torch = (id: number) => id === 1;
  const none = (): { x: number; y: number } | undefined => undefined;
  const kinds = (event: CombatEvent, site = none) =>
    effectsOf(event, 5, site, torch).map((e) => [e.kind, e.x, e.y]);
  assert.deepEqual(kinds(shot(1).event), [["flame", 0, -4]]);
  assert.deepEqual(kinds(shot(1, 2).event), [["tracer", 0, -4]]);
  const death = { x: 16 * SUB, y: 32 * SUB, id: 3, owner: 0 };
  assert.deepEqual(kinds({ type: "death", kind: "lightTank", ...death }), [
    ["boom", 16, 28.5],
    ["scorch", 16, 32],
  ]);
  const fort = { type: "destroyed", building: 2, kind: "fort" } as const;
  assert.deepEqual(kinds(fort, () => ({ x: 40, y: 80 }))[1], [
    "scorch",
    40,
    80,
  ]);
  assert.deepEqual(kinds(fort), []);
  const cast = (effect: "shockwave" | "orbitalDrop") =>
    effectsOf(
      { type: "cast", seat: 0, slot: 0, effect, x: 0, y: 0, toX: 0, toY: 0 },
      0,
      none,
      torch,
    );
  assert.equal(cast("shockwave")[0]!.colour, "#f8d030");
  assert.deepEqual(
    cast("orbitalDrop").map((e) => e.kind),
    ["ring", "boom", "scorch"],
  );
  assert.deepEqual(kinds({ type: "won", winner: 0 }), []);

  const effects = new Effects();
  const hero = { type: "heroDeath", seat: 0, killer: 1, x: 0, y: 0 } as const;
  const [boom] = effectsOf(hero, 0, none, torch);
  effects.add([boom!, { ...boom!, born: 400 }]);
  effects.prune(600);
  assert.deepEqual(
    effects.live.map((e) => e.born),
    [400],
  );
  effects.add(Array.from({ length: MAX_EFFECTS + 10 }, () => boom!));
  assert.equal(effects.live.length, MAX_EFFECTS);
});

test("each sprite variant is painted once, keyed by kind, team, facing and frame", () => {
  let painted = 0;
  const cache = new art.SpriteCache<Img>((img) => (painted++, img));
  for (let frame = 0; frame < 30; frame++) {
    cache.get(art.unitArt("grunt", 0, 1));
    cache.get(art.unitArt("grunt", 0, -1));
    cache.get(art.unitArt("grunt", 1, 1));
    cache.get(art.heroArt(0, 1));
    cache.get(art.buildingArt("robotFactory", 0, false, frame, 1));
  }
  assert.equal(painted, 4 + art.SMOKE_FRAMES);
  assert.equal(cache.size, painted);
  const key = (...a: Parameters<typeof art.buildingArt>) =>
    art.buildingArt(...a).key;
  // A ruin looks the same whoever owned it; only a standing turret turns and only a standing factory smokes.
  assert.equal(key("fort", 0, true, 0, 1), key("fort", 1, true, 3, -1));
  assert.notEqual(
    key("turret", 0, false, 0, 1),
    key("turret", 0, false, 0, -1),
  );
  assert.equal(key("fort", 0, false, 2, -1), key("fort", 0, false, 0, 1));
  assert.deepEqual([-1, 0, 1].map(art.teamId), ["neutral", "red", "blue"]);
  const arts = [
    art.unitArt("torch", 1, -1),
    art.unitArt("lightTank", 0, -1),
    ...(["fort", "turret", "robotFactory", "vehicleFactory"] as const).flatMap(
      (kind) =>
        [-1, 0].map((team) => art.buildingArt(kind, team, team < 0, 1, 1)),
    ),
    art.flagArt(-1),
    art.boomArt(6, 3),
    art.flameArt(10, -1),
    art.ringArt(9, "#f8d030"),
    art.scorchArt(5, 1),
    art.markArt("stun", 1),
    art.markArt("rally", 0),
  ];
  assert.equal(new Set(arts.map((a) => a.key)).size, arts.length);
  for (const a of arts) {
    const { d } = cache.get(a).surface;
    assert.ok(
      d.some((v, i) => i % 4 === 3 && v > 0),
      `${a.key} paints`,
    );
    assert.ok(a.ax >= 0 && a.ax < a.w && a.ay >= 0 && a.ay < a.h, a.key);
  }
});

test("the ground bakes water, bridge planks and rock from the map's tiles", () => {
  const img = bakeGround({
    width: 6,
    height: 4,
    terrain: ["######", "#.~~.#", "#.==.#", "######"],
  });
  assert.deepEqual([img.w, img.h], [6 * TILE_PX, 4 * TILE_PX]);
  const at = (x: number, y: number) => String(img.sample(x, y).slice(0, 3));
  const among = (colours: readonly Colour[]) =>
    colours.map((c) => String(rgba(c).slice(0, 3)));
  const planks = ["#b88a58", "#7a5030", "#8a6038", "#3a2410", "#2a1a0a"];
  assert.ok(among(BIOME.desert.water).includes(at(20, 12)), "water");
  assert.ok(among(planks).includes(at(20, 20)), "a bridge");
  assert.ok(among(BIOME.desert.rock).includes(at(28, 4)), "a rock wall");
});
