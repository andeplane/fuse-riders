import assert from "node:assert/strict";
import test from "node:test";
import {
  TRAIL_STUD_SPACING,
  arenaWall,
  pixelWall,
  smoothWallRect,
  trailStuds,
} from "../src/client/arena-wall.js";
import {
  THEME_STORAGE_KEY,
  defaultTheme,
  selectedTheme,
  themes,
} from "../src/client/themes.js";
import { createMemoryStorage } from "../src/client/safe-storage.js";
import { RIDER_SPEED, TICK_HZ } from "../src/engine/game.js";

test("each visual style asks for a different wall", () => {
  // The regression this guards is #68: both renderers flattened every style to one thin rim, so the
  // two modes became indistinguishable. Asserting the theme literals differ would NOT catch that —
  // they already differed throughout #68. Asserting the wall each style asks for does.
  const pixel = arenaWall(1200, 700, 20, themes["neon-pixel"]);
  const smooth = arenaWall(1200, 700, 20, themes["clean-neon"]);
  assert.equal(pixel.kind, "pixel");
  assert.equal(smooth.kind, "smooth");
  assert.ok(
    pixel.kind === "pixel" && pixel.bricks.length > 4,
    "a pixel style draws a brick run per edge",
  );
  assert.ok(
    smooth.kind === "smooth" &&
      smooth.strokeWidth === themes["clean-neon"].rendering.wallWidth,
  );
});

test("every registered style resolves to a drawable wall", () => {
  // A style added per docs/theme-assets.md must not fall through to nothing.
  for (const theme of Object.values(themes)) {
    const wall = arenaWall(1200, 700, 20, theme);
    if (wall.kind === "pixel")
      assert.ok(wall.bricks.length > 0 && wall.studs.length === 4);
    else assert.ok(wall.strokeWidth > 0 && wall.rect.width > 0);
  }
});

test("pixel bricks line all four edges inside the boundary", () => {
  const w = 1200,
    h = 700,
    inset = 24;
  const { bricks, brackets, studs } = pixelWall(w, h, inset);
  assert.ok(bricks.length > 4, "expected a brick run per edge");
  assert.equal(brackets.length, 4);
  assert.equal(studs.length, 4);
  for (const brick of bricks) {
    assert.ok(
      brick.width > 1 && brick.height > 1,
      "degenerate bricks are dropped",
    );
    assert.ok(
      brick.x >= 0 && brick.y >= 0,
      `brick off the canvas: ${JSON.stringify(brick)}`,
    );
    assert.ok(
      brick.x + brick.width <= w && brick.y + brick.height <= h,
      `brick past the canvas: ${JSON.stringify(brick)}`,
    );
  }
  // Every brick sits in the boundary band, never over the playfield the riders use.
  const playfield = { x1: inset, y1: inset, x2: w - inset, y2: h - inset };
  for (const brick of bricks) {
    const inside =
      brick.x + brick.width > playfield.x1 &&
      brick.x < playfield.x2 &&
      brick.y + brick.height > playfield.y1 &&
      brick.y < playfield.y2;
    assert.equal(
      inside,
      false,
      `brick overlaps the playfield: ${JSON.stringify(brick)}`,
    );
  }
});

test("bricks stay on the canvas even for a boundary thinner than the brick run", () => {
  // INITIAL_BOUNDARY_INSET is 20 and only grows, so a thin inset is unreachable in play — but the
  // brick depth is clamped to the inset so it cannot silently draw off-canvas if that ever changes.
  for (const inset of [2, 6, 20]) {
    const bricks = pixelWall(320, 200, inset).bricks;
    if (inset >= 20)
      assert.ok(
        bricks.length > 4,
        `inset ${inset} must still draw a brick run per edge`,
      );
    for (const brick of bricks) {
      assert.ok(
        brick.width > 1 && brick.height > 1,
        `degenerate at inset ${inset}`,
      );
      assert.ok(
        brick.x >= 0 && brick.y >= 0,
        `off-canvas at inset ${inset}: ${JSON.stringify(brick)}`,
      );
      assert.ok(
        brick.x + brick.width <= 320 && brick.y + brick.height <= 200,
        `past the canvas at inset ${inset}`,
      );
    }
    const rect = smoothWallRect(320, 200, inset);
    assert.ok(rect.width > 0 && rect.height > 0);
  }
});

test("the smooth wall sits outside the rim", () => {
  const rect = smoothWallRect(1200, 700, 24);
  assert.ok(rect.x < 24 && rect.y < 24);
  assert.equal(rect.width, 1200 - rect.x * 2);
});

test("trail studs are evenly spaced along each segment", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 0 },
  ];
  assert.deepEqual(
    trailStuds(path, 5).map((s) => s.x),
    [0, 5, 10, 15, 20, 25, 30],
  );
  assert.ok(trailStuds(path, 5).every((s) => s.y === 0));
});

test("trail studs do not crawl when expired segments drop off the front", () => {
  // A saturated trail loses its oldest segment every tick (TRAIL_LIFETIME_TICKS). Anchoring studs to
  // a distance walked from path[0] shifted every stud on the standing trail by 1.5 units per tick —
  // a 20 Hz shimmer down the whole trail. The studs that survive a trim must not move.
  const step = RIDER_SPEED / TICK_HZ;
  const full = Array.from({ length: 8 }, (_, i) => ({ x: i * step, y: 40 }));
  for (let dropped = 1; dropped <= 4; dropped++) {
    const trimmed = full.slice(dropped);
    const kept = trailStuds(full).filter((stud) => stud.x >= trimmed[0]!.x);
    assert.deepEqual(
      trailStuds(trimmed),
      kept,
      `studs moved after dropping ${dropped} segment(s)`,
    );
  }
});

test("trail studs ignore zero-length and single-point paths", () => {
  assert.deepEqual(trailStuds([{ x: 4, y: 4 }]), []);
  assert.deepEqual(
    trailStuds([
      { x: 4, y: 4 },
      { x: 4, y: 4 },
    ]),
    [],
  );
  assert.equal(
    trailStuds([
      { x: 0, y: 0 },
      { x: TRAIL_STUD_SPACING * 3, y: 0 },
    ]).length,
    4,
  );
  // A NaN pose must not hang the loop or emit a garbage stud.
  assert.deepEqual(
    trailStuds([
      { x: 0, y: 0 },
      { x: NaN, y: 0 },
    ]),
    [],
  );
});

test("every brick keeps its chip inside itself", () => {
  // The chip escaped short bricks while both renderers restated the modulus; pixelWall owns it now.
  for (const inset of [7, 10, 20, 29, 46, 200]) {
    for (const brick of pixelWall(1600, 900, inset).bricks) {
      assert.ok(
        brick.chip.x >= brick.x &&
          brick.chip.x + brick.chip.width <= brick.x + brick.width,
        `chip escaped horizontally at inset ${inset}: ${JSON.stringify(brick)}`,
      );
      assert.ok(
        brick.chip.y >= brick.y &&
          brick.chip.y + brick.chip.height <= brick.y + brick.height,
        `chip escaped vertically at inset ${inset}: ${JSON.stringify(brick)}`,
      );
    }
  }
});

test("no brick is too small for its own inner detail", () => {
  // A run ending short produced negative-extent highlight fills at the half-unit overtime insets.
  for (let inset = 20; inset <= 120; inset += 0.5) {
    for (const brick of pixelWall(1600, 900, inset).bricks) {
      // These are the extents drawPixelBrick derives: body, highlight and shade must all be drawable.
      assert.ok(
        brick.width - 6 > 0 && brick.height - 6 > 0,
        `sliver brick at inset ${inset}: ${JSON.stringify(brick)}`,
      );
    }
  }
});

test("a visual style is chosen from the URL, then storage, then the default", () => {
  const store = createMemoryStorage();
  // A `?theme=` override is stored, because entering a room rewrites the URL and would drop it.
  assert.equal(selectedTheme("?theme=clean-neon", store).id, "clean-neon");
  assert.equal(store.getItem(THEME_STORAGE_KEY), "clean-neon");
  assert.equal(selectedTheme("", store).id, "clean-neon");
  assert.equal(selectedTheme("?solo=1", store).id, "clean-neon");
  assert.equal(selectedTheme("", createMemoryStorage()).id, defaultTheme.id);
});

test("a bogus visual style falls back instead of reaching a prototype member", () => {
  for (const hostile of ["constructor", "toString", "__proto__", "nope", ""]) {
    const store = createMemoryStorage();
    assert.equal(selectedTheme(`?theme=${hostile}`, store).id, defaultTheme.id);
    assert.equal(
      store.getItem(THEME_STORAGE_KEY),
      null,
      `?theme=${hostile} must not be stored`,
    );
    store.setItem(THEME_STORAGE_KEY, hostile);
    assert.equal(selectedTheme("", store).id, defaultTheme.id);
  }
});
