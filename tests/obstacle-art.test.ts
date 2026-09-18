import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  OBSTACLE_VARIANTS,
  obstacleVariant,
  generateObstacles,
  validObstacleDimensions,
  type Obstacle,
  type ObstacleKind,
} from "../src/shared/arena-map.js";
import {
  DEFAULT_OBSTACLE_ART,
  obstacleArtwork,
  obstacleArtSources,
  obstacleTextureKey,
} from "../src/client/arena-maps.js";

const kinds = Object.keys(OBSTACLE_VARIANTS) as ObstacleKind[];
test("every native prop maps the source collider to its world size with one uniform scale", () => {
  for (const kind of kinds)
    for (const [index, variant] of OBSTACLE_VARIANTS[kind].entries()) {
      const json = JSON.parse(
        readFileSync(
          new URL(
            `../public/props/desert-industrial-v1/${variant.id}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      const png = readFileSync(
        new URL(
          `../public/props/desert-industrial-v1/${variant.id}.png`,
          import.meta.url,
        ),
      );
      const art = DEFAULT_OBSTACLE_ART[variant.id]!;
      assert.equal(
        createHash("sha256").update(png).digest("hex"),
        json.image.sha256,
      );
      assert.equal(png.readUInt32BE(16), art.pixelWidth);
      assert.equal(png.readUInt32BE(20), art.pixelHeight);
      assert.equal(art.anchorX, json.hitboxPixels.centerX);
      assert.equal(art.anchorY, json.hitboxPixels.centerY);
      const width =
        kind === "rock"
          ? json.hitboxPixels.radius * 2
          : json.hitboxPixels.width;
      const height =
        kind === "rock"
          ? json.hitboxPixels.radius * 2
          : json.hitboxPixels.height;
      assert.equal(width * art.unitsPerPixel, variant.width);
      assert.equal(height * art.unitsPerPixel, variant.height);
      assert.equal(json.category, kind);
      assert.equal(
        json.hitboxPixels.shape,
        kind === "rock" ? "circle" : "rectangle",
      );
      const obstacle: Obstacle = {
        id: index + 1,
        kind,
        x: 450,
        y: 350,
        halfWidth: variant.width / 2,
        halfHeight: variant.height / 2,
      };
      assert.ok(validObstacleDimensions(obstacle));
      for (const map of ["desert", "forest", "city"] as const)
        assert.equal(obstacleArtwork(obstacle, map), art);
      assert.equal(obstacleVariant(obstacle), variant);
      assert.equal(
        obstacleVariant({
          ...obstacle,
          id: obstacle.id + OBSTACLE_VARIANTS[kind].length,
        }),
        variant,
      );
    }
  assert.equal(obstacleArtSources().length, 16);
});

test("a forest skin overrides only its named variant and leaves geometry and other maps alone", () => {
  const variant = OBSTACLE_VARIANTS.building[0]!;
  const obstacle: Obstacle = {
    id: 1,
    kind: "building",
    x: 500,
    y: 400,
    halfWidth: variant.width / 2,
    halfHeight: variant.height / 2,
  };
  const original = structuredClone(obstacle);
  const art = DEFAULT_OBSTACLE_ART[variant.id]!;
  const overgrown = { ...art, file: "/props/forest/overgrown-hut.png" };
  const skins = { forest: { [variant.id]: overgrown } };
  assert.equal(obstacleArtwork(obstacle, "forest", skins), overgrown);
  assert.equal(obstacleArtwork(obstacle, "city", skins), art);
  assert.equal(
    obstacleArtwork({ ...obstacle, id: 2 }, "forest", skins),
    DEFAULT_OBSTACLE_ART["building-small-vent"],
  );
  assert.deepEqual(obstacle, original);
  assert.notEqual(obstacleTextureKey(art), obstacleTextureKey(overgrown));
  assert.equal(obstacleArtSources(skins).length, 17);
  assert.equal(
    obstacleArtSources({ forest: { [variant.id]: art } }).length,
    16,
    "shared files load only once",
  );
});

test("all scenery maps reuse the native catalog and a surviving id keeps its art after removal", () => {
  const seen = new Set<string>();
  for (const map of ["desert", "forest", "city"] as const) {
    let state = 123;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    for (let i = 0; i < 30; i++) {
      const obstacles = generateObstacles({
        map,
        random,
        bounds: { minX: 50, minY: 50, maxX: 1550, maxY: 850 },
        keepClear: [],
      });
      for (const obstacle of obstacles) {
        assert.ok(validObstacleDimensions(obstacle));
        seen.add(obstacleVariant(obstacle).id);
      }
      const remaining = obstacles.slice(1);
      assert.deepEqual(
        remaining.map((o) => obstacleArtwork(o, map)),
        obstacles.map((o) => obstacleArtwork(o, map)).slice(1),
      );
      assert.deepEqual(
        remaining.map((o) => obstacleVariant(o).id),
        structuredClone(remaining).map((o) => obstacleVariant(o).id),
      );
    }
  }
  assert.equal(seen.size, 16);
});
