import test from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_MAPS,
  ARENA_MAP_RECIPES,
  MAX_OBSTACLES,
  chooseArenaMap,
  ROTATION_MAPS,
  generateObstacles,
  obstacleBlocksPath,
  obstacleBounceNormal,
  obstacleDistanceSquared,
  obstacleEdges,
  obstacleInsideBounds,
  obstacleTouchesCircle,
  segmentObstacleDistanceSquared,
  type ArenaMapId,
  type ClearCapsule,
  type Obstacle,
} from "../src/engine/arena-map.js";
import {
  mapGround,
  paintMapGround,
  obstacleParts,
  OBSTACLE_STYLES,
  ARENA_MAP_LABELS,
} from "../src/client/arena-maps.js";
import { themes } from "../src/client/themes.js";

const BOUNDS = { minX: 46, minY: 46, maxX: 1554, maxY: 854 };
// The maps that put scenery on the board; `wrap` and `cross` change the edges instead and stand on the classic floor.
const OBSTACLE_MAPS = ARENA_MAPS.filter(
  (map) => ARENA_MAP_RECIPES[map].species.length > 0,
);

/** The same counter-based stream the game uses, so a layout here is generated exactly as a round generates one. */
function stream(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
const layout = (
  map: ArenaMapId,
  seed: number,
  keepClear: readonly ClearCapsule[] = [],
): Obstacle[] =>
  generateObstacles({ map, bounds: BOUNDS, random: stream(seed), keepClear });
const rect = (obstacle: Obstacle) => ({
  minX: obstacle.x - obstacle.halfWidth,
  maxX: obstacle.x + obstacle.halfWidth,
  minY: obstacle.y - obstacle.halfHeight,
  maxY: obstacle.y + obstacle.halfHeight,
});

test("the classic map is the arena as it was: no scenery at all", () => {
  for (let seed = 1; seed <= 20; seed++)
    assert.deepEqual(layout("classic", seed), []);
});

test("a layout is a pure function of the stream it is given", () => {
  for (const map of OBSTACLE_MAPS)
    for (const seed of [1, 7, 4242]) {
      assert.deepEqual(
        layout(map, seed),
        layout(map, seed),
        `${map} at seed ${seed}`,
      );
    }
  // Discriminating: different streams do produce different boards, so the equality above is not vacuous.
  assert.notDeepEqual(layout("desert", 1), layout("desert", 2));
});

test("every obstacle stands inside the bounds, is smaller than the arena, and the board is bounded", () => {
  for (const map of OBSTACLE_MAPS)
    for (let seed = 1; seed <= 40; seed++) {
      const obstacles = layout(map, seed);
      assert.ok(obstacles.length > 0, `${map} at seed ${seed} placed nothing`);
      assert.ok(
        obstacles.length <= MAX_OBSTACLES,
        `${map} at seed ${seed} placed ${obstacles.length}`,
      );
      assert.equal(
        new Set(obstacles.map((obstacle) => obstacle.id)).size,
        obstacles.length,
        "ids are unique",
      );
      for (const obstacle of obstacles) {
        assert.ok(
          obstacleInsideBounds(obstacle, BOUNDS),
          `${map} at seed ${seed} left the bounds`,
        );
        assert.ok(obstacle.halfWidth > 0 && obstacle.halfHeight > 0);
        assert.ok(
          OBSTACLE_STYLES[obstacle.kind],
          `${obstacle.kind} has no drawing style`,
        );
      }
    }
});

test("obstacles keep their map's spacing, so no layout seals a rider into a pocket", () => {
  for (const map of OBSTACLE_MAPS)
    for (let seed = 1; seed <= 40; seed++) {
      const obstacles = layout(map, seed);
      for (const [index, a] of obstacles.entries())
        for (const b of obstacles.slice(index + 1)) {
          const gapX = Math.max(
            Math.abs(a.x - b.x) - a.halfWidth - b.halfWidth,
            0,
          );
          const gapY = Math.max(
            Math.abs(a.y - b.y) - a.halfHeight - b.halfHeight,
            0,
          );
          assert.ok(
            Math.hypot(gapX, gapY) >= ARENA_MAP_RECIPES[map].spacing - 1e-9,
            `${map} at seed ${seed} crowded two obstacles`,
          );
        }
    }
});

test("nothing is laid across a road that has to stay clear", () => {
  const keepClear: ClearCapsule[] = [
    { x1: 300, y1: 450, x2: 700, y2: 450, radius: 60 },
    { x1: 1200, y1: 200, x2: 1200, y2: 700, radius: 60 },
  ];
  let touched = 0;
  for (const map of OBSTACLE_MAPS)
    for (let seed = 1; seed <= 40; seed++) {
      for (const obstacle of layout(map, seed, keepClear)) {
        for (const capsule of keepClear) {
          if (
            obstacleBlocksPath(
              obstacle,
              capsule.x1,
              capsule.y1,
              capsule.x2,
              capsule.y2,
              capsule.radius,
            )
          )
            touched++;
        }
      }
    }
  assert.equal(touched, 0);
  // Without the capsules those same streams do put something in the way, so the guard above is doing work.
  const unguarded = OBSTACLE_MAPS.flatMap((map) =>
    Array.from({ length: 40 }, (_, seed) => layout(map, seed + 1)),
  )
    .flat()
    .filter((obstacle) =>
      keepClear.some((capsule) =>
        obstacleBlocksPath(
          obstacle,
          capsule.x1,
          capsule.y1,
          capsule.x2,
          capsule.y2,
          capsule.radius,
        ),
      ),
    );
  assert.ok(
    unguarded.length > 0,
    "the roads are wide enough to be worth protecting",
  );
});

test("a board with no room left simply carries fewer obstacles", () => {
  const cramped = generateObstacles({
    map: "city",
    bounds: { minX: 0, minY: 0, maxX: 24, maxY: 24 },
    random: stream(3),
    keepClear: [],
  });
  assert.deepEqual(cramped, [], "nothing fits, and nothing is forced in");
  const tight = generateObstacles({
    map: "city",
    bounds: { minX: 0, minY: 0, maxX: 260, maxY: 260 },
    random: stream(3),
    keepClear: [],
  });
  assert.ok(
    tight.length > 0 && tight.length < layout("city", 3).length,
    "a small board carries what it can",
  );
  const blocked = layout("forest", 5, [
    { x1: 0, y1: 0, x2: 1600, y2: 900, radius: 900 },
  ]);
  assert.deepEqual(
    blocked,
    [],
    "a road covering the whole field leaves nowhere to stand",
  );
});

test("rotation visits every obstacle map and the obstacle-free classic before repeating one, and a named map is taken as given", () => {
  const rotation = ROTATION_MAPS.length;
  assert.deepEqual(
    [...ROTATION_MAPS].sort(),
    ["classic", ...OBSTACLE_MAPS].sort(),
  );
  for (const seed of [1, 2, 3, 999]) {
    const rounds = Array.from({ length: rotation }, (_, index) =>
      chooseArenaMap("rotate", seed, index + 1),
    );
    assert.equal(
      new Set(rounds).size,
      rotation,
      `seed ${seed} repeated a map within one cycle`,
    );
    assert.ok(
      rounds.includes("classic"),
      "a cycle has a round with nothing standing on the board",
    );
    assert.equal(
      chooseArenaMap("rotate", seed, rotation + 1),
      rounds[0],
      "the cycle repeats after a full pass",
    );
  }
  for (const map of ARENA_MAPS) assert.equal(chooseArenaMap(map, 7, 3), map);
});

test("a swept point meets an obstacle exactly when it comes within its radius", () => {
  const obstacle: Obstacle = {
    id: 1,
    kind: "rock",
    x: 400,
    y: 300,
    halfWidth: 50,
    halfHeight: 30,
  };
  assert.ok(
    obstacleBlocksPath(obstacle, 200, 300, 600, 300, 1),
    "a path straight through it",
  );
  assert.ok(
    obstacleBlocksPath(obstacle, 200, 265, 600, 265, 6),
    "a path grazing the top face within the radius",
  );
  assert.equal(
    obstacleBlocksPath(obstacle, 200, 265, 600, 265, 4),
    false,
    "the same path just outside it",
  );
  assert.equal(
    obstacleBlocksPath(obstacle, 200, 100, 200, 500, 7),
    false,
    "a path that never reaches it",
  );
  // Corners are rounded by the radius rather than squared off: the diagonal approach is the exact distance.
  assert.equal(
    Math.round(
      Math.sqrt(segmentObstacleDistanceSquared(obstacle, 340, 260, 340, 260)) *
        100,
    ) / 100,
    14.14,
    "the corner is rounded, not squared",
  );
  assert.equal(
    segmentObstacleDistanceSquared(obstacle, 350, 290, 351, 291),
    0,
    "a segment inside it",
  );
  assert.equal(obstacleDistanceSquared(obstacle, 400, 300), 0);
  assert.ok(
    obstacleTouchesCircle(obstacle, 400, 345, 16) &&
      !obstacleTouchesCircle(obstacle, 400, 345, 14),
  );
  assert.equal(obstacleEdges(obstacle).length, 4);
  for (const edge of obstacleEdges(obstacle))
    assert.equal(
      segmentObstacleDistanceSquared(
        obstacle,
        edge.x1,
        edge.y1,
        edge.x2,
        edge.y2,
      ),
      0,
    );
});

test("a bounce faces away from the surface actually hit, corners included", () => {
  const obstacle: Obstacle = {
    id: 1,
    kind: "rock",
    x: 400,
    y: 300,
    halfWidth: 50,
    halfHeight: 30,
  };
  assert.deepEqual(
    obstacleBounceNormal(obstacle, 340, 300),
    { nx: -1, ny: 0 },
    "the left face",
  );
  assert.deepEqual(
    obstacleBounceNormal(obstacle, 470, 300),
    { nx: 1, ny: 0 },
    "the right face",
  );
  assert.deepEqual(
    obstacleBounceNormal(obstacle, 400, 260),
    { nx: 0, ny: -1 },
    "the top face",
  );
  assert.deepEqual(
    obstacleBounceNormal(obstacle, 400, 340),
    { nx: 0, ny: 1 },
    "the bottom face",
  );
  // Past the corner the normal is the diagonal, so a rider clipping it is not turned as if it met a flat side.
  const corner = obstacleBounceNormal(obstacle, 460, 340);
  assert.equal(
    Math.round(Math.hypot(corner.nx, corner.ny) * 1e6) / 1e6,
    1,
    "and is a unit vector",
  );
  assert.ok(
    corner.nx > 0 && corner.ny > 0 && Math.abs(corner.nx - corner.ny) < 1e-9,
    "at 45 degrees off a square corner",
  );
  // Dead centre has no nearest face; any fixed outward direction will do, as long as it is one.
  assert.equal(
    Math.hypot(
      obstacleBounceNormal(obstacle, 400, 300).nx,
      obstacleBounceNormal(obstacle, 400, 300).ny,
    ),
    1,
  );
});

test("an obstacle is kept only while the whole rectangle is still in play", () => {
  const obstacle: Obstacle = {
    id: 1,
    kind: "crate",
    x: 100,
    y: 100,
    halfWidth: 40,
    halfHeight: 40,
  };
  assert.ok(
    obstacleInsideBounds(obstacle, {
      minX: 60,
      minY: 60,
      maxX: 140,
      maxY: 140,
    }),
  );
  assert.equal(
    obstacleInsideBounds(obstacle, {
      minX: 61,
      minY: 60,
      maxX: 140,
      maxY: 140,
    }),
    false,
  );
  assert.equal(
    obstacleInsideBounds(obstacle, {
      minX: 60,
      minY: 60,
      maxX: 140,
      maxY: 139,
    }),
    false,
  );
});

test("the map owns the ground, the style still owns the grid spacing", () => {
  for (const theme of Object.values(themes)) {
    const classic = mapGround("classic", theme);
    assert.equal(
      classic.floorCenter,
      theme.palette.floorCenter,
      "classic is the style's own floor, unchanged",
    );
    assert.equal(classic.grid, theme.palette.grid);
    for (const map of OBSTACLE_MAPS) {
      const ground = mapGround(map, theme);
      assert.notEqual(
        ground.floorCenter,
        classic.floorCenter,
        `${map} recolours the ground`,
      );
      assert.equal(
        ground.gridSize,
        theme.rendering.gridSize,
        `${map} keeps ${theme.id}'s grid spacing`,
      );
      assert.match(ground.dust, /^#[0-9a-f]{6}$/);
    }
  }
  for (const map of ARENA_MAPS) assert.ok(ARENA_MAP_LABELS[map].length > 0);
});

test("every obstacle kind draws its whole footprint, and nothing outside it", () => {
  // Both directions matter, and for the same reason: the footprint is exactly what the simulation kills against.
  // Drawing past it promises cover that is not there; leaving part of it bare kills riders that touched nothing.
  for (const map of ARENA_MAPS)
    for (const kind of Object.keys(OBSTACLE_STYLES) as Obstacle["kind"][]) {
      for (const [halfWidth, halfHeight] of [
        [60, 45],
        [29, 20],
        [22, 36],
        [15, 15],
      ] as const) {
        const obstacle: Obstacle = {
          id: 3,
          kind,
          x: 500,
          y: 400,
          halfWidth,
          halfHeight,
        };
        const parts = obstacleParts(obstacle, map);
        const where = `${kind} at ${halfWidth}x${halfHeight}`;
        assert.ok(parts.length > 1, `${where} draws more than a shadow`);
        assert.deepEqual(
          parts,
          obstacleParts(obstacle, map),
          `${where} is stable between frames`,
        );
        const bounds = rect(obstacle);
        // The shadow is deliberately offset onto the ground and is excluded from both checks.
        const drawn = {
          minX: Infinity,
          maxX: -Infinity,
          minY: Infinity,
          maxY: -Infinity,
        };
        for (const part of parts.slice(1)) {
          const [minX, maxX, minY, maxY] =
            part.shape === "ellipse"
              ? [
                  part.x - part.radiusX,
                  part.x + part.radiusX,
                  part.y - part.radiusY,
                  part.y + part.radiusY,
                ]
              : part.shape === "triangle"
                ? [
                    Math.min(part.x1, part.x2, part.x3),
                    Math.max(part.x1, part.x2, part.x3),
                    Math.min(part.y1, part.y2, part.y3),
                    Math.max(part.y1, part.y2, part.y3),
                  ]
                : [part.x, part.x + part.width, part.y, part.y + part.height];
          assert.ok(
            minX >= bounds.minX - 1 && maxX <= bounds.maxX + 1,
            `${where} drew outside its width`,
          );
          assert.ok(
            minY >= bounds.minY - 1 && maxY <= bounds.maxY + 1,
            `${where} drew outside its height`,
          );
          assert.match(part.color, /^#[0-9a-f]{6}$/);
          if (part.shape === "rect")
            assert.ok(
              part.width > 0 && part.height > 0,
              `${where} drew an empty rectangle`,
            );
          else if (part.shape === "ellipse")
            assert.ok(part.radiusX > 0 && part.radiusY > 0);
          else
            assert.ok(
              Math.abs(
                (part.x2 - part.x1) * (part.y3 - part.y1) -
                  (part.x3 - part.x1) * (part.y2 - part.y1),
              ) > 0,
            );
          drawn.minX = Math.min(drawn.minX, minX);
          drawn.maxX = Math.max(drawn.maxX, maxX);
          drawn.minY = Math.min(drawn.minY, minY);
          drawn.maxY = Math.max(drawn.maxY, maxY);
        }
        assert.ok(
          drawn.minX <= bounds.minX + 1 && drawn.maxX >= bounds.maxX - 1,
          `${where} left part of its width undrawn`,
        );
        assert.ok(
          drawn.minY <= bounds.minY + 1 && drawn.maxY >= bounds.maxY - 1,
          `${where} left part of its height undrawn`,
        );
      }
    }
  // Roof materials vary between buildings, so a city block is not a repeated stamp.
  const roofs = (id: number) =>
    obstacleParts(
      {
        id,
        kind: "building",
        x: 500,
        y: 400,
        halfWidth: 90,
        halfHeight: 70,
      },
      "city",
    )
      .map((part) => part.color)
      .join();
  assert.notEqual(roofs(1), roofs(2));
});

test("ground decoration is stable, bounded and absent on classic edge variants", () => {
  for (const map of ARENA_MAPS) {
    const draw = () => {
      const commands: unknown[][] = [];
      const record =
        (name: string) =>
        (...args: unknown[]) => {
          commands.push([name, ...args]);
        };
      const context: Parameters<typeof paintMapGround>[0] = {
        lineWidth: 0,
        strokeStyle: "",
        fillStyle: "",
        save: record("save"),
        restore: record("restore"),
        strokeRect: record("strokeRect"),
        fillRect: record("fillRect"),
        beginPath: record("beginPath"),
        ellipse: record("ellipse"),
        stroke: record("stroke"),
        fill: record("fill"),
        moveTo: record("moveTo"),
        lineTo: record("lineTo"),
      };
      paintMapGround(context, map, 1600, 900);
      return commands;
    };
    const commands = draw();
    assert.deepEqual(
      commands,
      draw(),
      "texture must not shimmer on regeneration",
    );
    if (map === "classic" || map === "wrap" || map === "cross") {
      assert.equal(commands.length, 0);
    } else {
      assert.deepEqual(commands[0], ["save"]);
      assert.deepEqual(commands.at(-1), ["restore"]);
      assert.ok(commands.length > 10 && commands.length < 10000);
      for (const command of commands)
        for (const value of command.slice(1))
          if (typeof value === "number") assert.ok(Number.isFinite(value));
    }
  }
});
