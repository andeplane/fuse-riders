import test from "node:test";
import assert from "node:assert/strict";
import {
  EAT_STEPS,
  GATE_STEPS,
  HOLE_HALF,
  MAPS,
  MAP_HEIGHT,
  MAP_IDS,
  MAP_WIDTH,
  RESPAWN_STEPS,
  S,
  WIDTH,
  arenaOf,
  createRound,
  halfOf,
  heightOf,
  isMapId,
  stepRound,
  viewOf,
  wrapDelta,
  wrapX,
  type Point,
  type Rect,
} from "../src/engine/index.js";
import {
  CELL,
  COLS,
  ROWS,
  UNREACHABLE,
  cellCentre,
  cellOf,
  flyNav,
  flyToward,
  platformAt,
  platformBelow,
  workerNav,
} from "../src/engine/nav.js";
import { ALL_HUMANS, bare, stand, unitOf } from "./engine-kit.js";

const mirrorX = (x: number): number => MAP_WIDTH - x;
const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
const mirroredRect = (r: Rect): Rect => ({ ...r, x: MAP_WIDTH - r.x - r.w });
const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

for (const id of MAP_IDS) {
  const map = MAPS[id];
  const arena = arenaOf(id);

  test(`map ${id} (${map.name}) fits the screen and is its own mirror image`, () => {
    assert.equal(map.id, id);
    for (const platform of map.platforms) {
      assert.ok(platform.x >= 0 && platform.x + platform.w <= MAP_WIDTH);
      assert.ok(platform.y > 0 && platform.y + platform.h <= MAP_HEIGHT);
      assert.ok(
        map.platforms.some((other) => sameRect(other, mirroredRect(platform))),
        `platform at ${platform.x}, ${platform.y} has no mirror`,
      );
    }
    for (const gate of map.gates)
      assert.ok(
        map.gates.some(
          (other) =>
            other.kind === gate.kind &&
            samePoint(other, { x: mirrorX(gate.x), y: gate.y }),
        ),
      );
    for (const pile of map.piles)
      assert.ok(
        map.piles.some(
          (other) =>
            other.count === pile.count &&
            samePoint(other, { x: mirrorX(pile.x), y: pile.y }),
        ),
      );
    assert.equal(map.holes[0].length, 12);
    assert.equal(map.holes[1].length, 12);
    map.holes[0].forEach((hole, index) => {
      const other = map.holes[1][index];
      assert.ok(other);
      assert.ok(samePoint(other, { x: mirrorX(hole.x), y: hole.y }));
      assert.ok(hole.x < MAP_WIDTH / 2, "team 0's hive is on the left");
    });
    assert.equal(map.spawns.length, 6);
    for (let slot = 0; slot < 6; slot += 2) {
      const left = map.spawns[slot],
        right = map.spawns[slot + 1];
      assert.ok(left && right);
      assert.ok(samePoint(right, { x: mirrorX(left.x), y: left.y }));
    }
    assert.equal(map.snail.start, MAP_WIDTH / 2);
    assert.equal(map.snail.goals[1], mirrorX(map.snail.goals[0]));
    assert.ok(map.snail.goals[0] < map.snail.start);
    assert.equal(map.snail.y, map.platforms[0]?.y);
  });

  test(`map ${id}: everything stands on a platform and there are berries enough to fill a hive`, () => {
    for (const at of [...arena.gates, ...arena.piles, ...arena.spawns])
      assert.ok(platformAt(arena, at.x, at.y) >= 0, `${at.x / S}, ${at.y / S}`);
    for (const hole of [...arena.holes[0], ...arena.holes[1]]) {
      const below = platformBelow(arena, hole.x, hole.y);
      assert.ok(below >= 0);
      assert.ok((arena.solids[below]?.y ?? 0) - hole.y <= 13 * S);
    }
    const berries = map.piles.reduce((sum, pile) => sum + pile.count, 0);
    assert.ok(berries > map.holes[0].length);
    assert.equal(arena.solids[0]?.y, map.snail.y * S);
    assert.equal(arena.snail.goals[0], map.snail.goals[0] * S);
  });

  test(`map ${id}: a Worker can walk and jump from its spawn to every pile, gate, hive and the snail, and back`, () => {
    for (const speed of [false, true]) {
      const nav = workerNav(id, speed);
      assert.equal(workerNav(id, speed), nav, "derived once");
      const places = [
        ...arena.gates,
        ...arena.piles,
        { x: arena.snail.start, y: arena.snail.y },
      ].map((at) => platformAt(arena, at.x, at.y));
      for (const team of [0, 1] as const) {
        const spawn = arena.spawns[2 + team];
        const hole = arena.holes[team][0];
        assert.ok(spawn && hole);
        const home = platformAt(arena, spawn.x, spawn.y);
        const hive = platformBelow(arena, hole.x, hole.y);
        for (const place of [...places, hive]) {
          assert.ok(
            (nav.dist[home]?.[place] ?? UNREACHABLE) < UNREACHABLE,
            `spawn to platform ${place}, speed ${speed}`,
          );
          assert.ok(
            (nav.dist[place]?.[hive] ?? UNREACHABLE) < UNREACHABLE,
            `platform ${place} to the hive, speed ${speed}`,
          );
        }
      }
      for (const edge of nav.edges) assert.notEqual(edge.from, edge.to);
    }
  });

  test(`map ${id}: nobody spawns in front of a hive hole, and the Queens start far apart and stay there untouched`, () => {
    const state = createRound({ seed: 3, mapId: id, humans: ALL_HUMANS });
    for (const unit of state.units)
      for (const hole of [...arena.holes[0], ...arena.holes[1]]) {
        const beside =
            Math.abs(unit.x - hole.x) >= halfOf(unit.kind) + HOLE_HALF,
          clear =
            unit.y - heightOf(unit.kind) >= hole.y + HOLE_HALF ||
            unit.y <= hole.y - HOLE_HALF;
        assert.ok(beside || clear, `slot ${unit.slot} covers a hole`);
      }
    const [cyan, pink] = state.units;
    assert.ok(cyan && pink);
    assert.ok(Math.abs(wrapDelta(pink.x, cyan.x)) >= 220 * S);
    // Two seconds with nobody touching a stick: no contact of any kind, and everyone still stands on its spawn.
    for (let i = 0; i < 120; i += 1) {
      stepRound(state, []);
      assert.deepEqual(state.events, []);
    }
    state.units.forEach((unit, slot) => {
      assert.equal(unit.x, arena.spawns[slot]?.x);
      assert.equal(unit.y, arena.spawns[slot]?.y);
    });
    // Bots at their most aggressive need deliberate flight to meet: no Queen dies in the first second and a half.
    for (let seed = 1; seed <= 12; seed += 1) {
      const game = createRound({ seed, mapId: id, botLevel: "hard" });
      for (let i = 0; i < 90; i += 1) {
        stepRound(game, []);
        assert.ok(!game.events.some((event) => event.type === "queenKill"));
      }
    }
  });

  test(`map ${id}: a flyer finds a free way from its spawn to every gate`, () => {
    const nav = flyNav(id);
    assert.equal(flyNav(id), nav, "derived once");
    const queen = arena.spawns[0];
    assert.ok(queen);
    for (const gate of arena.gates) {
      let x = queen.x,
        y = queen.y - 7 * S;
      const tx = gate.x,
        ty = gate.y - 8 * S;
      let hops = 0;
      while (hops < 200) {
        const point = flyToward(id, x, y, tx, ty);
        if (point.x === tx && point.y === ty) break;
        assert.equal(nav.free[cellOf(point.x, point.y)], true);
        x = point.x;
        y = point.y;
        hops += 1;
      }
      assert.ok(hops < 200, `gate at ${gate.x / S}, ${gate.y / S}`);
    }
  });
}

test("horizontal wrap arithmetic", () => {
  assert.equal(wrapX(-1, 480), 479);
  assert.equal(wrapX(480, 480), 0);
  assert.equal(wrapX(5, 480), 5);
  assert.equal(wrapX(WIDTH + 3), 3);
  assert.equal(wrapDelta(10, 470, 480), 20);
  assert.equal(wrapDelta(470, 10, 480), -20);
  assert.equal(wrapDelta(100, 90, 480), 10);
  assert.equal(wrapDelta(90, 100, 480), -10);
  assert.equal(wrapDelta(S, WIDTH - S), 2 * S);
  assert.ok(isMapId(1) && isMapId(2) && isMapId(3));
  assert.equal(isMapId(4), false);
  assert.equal(isMapId("1"), false);
  assert.deepEqual(MAP_IDS, [1, 2, 3]);
});

test("the flyers' grid covers the screen, wraps and clamps", () => {
  assert.equal(COLS * CELL, WIDTH);
  assert.ok(ROWS * CELL >= MAP_HEIGHT * S);
  assert.equal(cellOf(0, 0), 0);
  assert.equal(cellOf(-1, 0), COLS - 1);
  assert.equal(cellOf(WIDTH, 0), 0);
  assert.equal(cellOf(0, -5 * S), 0);
  assert.equal(cellOf(0, 9999 * S), (ROWS - 1) * COLS);
  assert.deepEqual(cellCentre(COLS + 1), {
    x: CELL + CELL / 2,
    y: CELL + CELL / 2,
  });
  const arena = arenaOf(1);
  // Inside a platform there is no free cell; the way starts from the nearest free one.
  const floor = arena.solids[0];
  assert.ok(floor);
  const nav = flyNav(1);
  const buried = cellOf(100 * S, floor.y + 4 * S);
  assert.equal(nav.free[buried], false);
  assert.equal(nav.free[nav.nearest[buried] ?? buried], true);
  assert.equal(platformAt(arena, 100 * S, 5 * S), -1);
  assert.equal(platformBelow(arena, 100 * S, floor.y + S), -1);
  assert.equal(platformBelow(arena, 300 * S, 250 * S), 0);
});

test("the view gives the renderer pixels, with the map's fixed pieces joined to their state", () => {
  const state = createRound({ seed: 2, humans: [true] });
  const view = viewOf(state);
  assert.equal(view.map, MAPS[1]);
  assert.equal(view.units.length, 6);
  const spawn = MAPS[1].spawns[0];
  assert.ok(spawn);
  assert.deepEqual(
    { x: view.units[0]?.x, y: view.units[0]?.y, bot: view.units[0]?.bot },
    { x: spawn.x, y: spawn.y, bot: false },
  );
  assert.equal(view.units[1]?.bot, true);
  assert.deepEqual(
    view.piles.map((pile) => pile.count),
    MAPS[1].piles.map((pile) => pile.count),
  );
  assert.deepEqual(view.berries, [0, 0]);
  assert.deepEqual(view.eggs, [3, 3]);
  assert.ok(view.hives.every((hive) => hive.every((hole) => !hole.filled)));
  assert.ok(view.gates.every((gate) => gate.owner === -1 && gate.user === -1));
  assert.equal(view.snail.x, MAPS[1].snail.start);
  assert.equal(view.snail.eating, 0);
  assert.equal(view.winner, null);

  const busy = bare();
  const gate = MAPS[1].gates[0];
  assert.ok(gate);
  stand(busy, 2, gate.x, gate.y, {
    carrying: true,
    gate: 0,
    gateProgress: GATE_STEPS / 2,
    invuln: 5,
  });
  const gateState = busy.gates[0];
  assert.ok(gateState);
  gateState.user = 2;
  gateState.owner = 0;
  const holes = busy.holes[1];
  assert.ok(holes);
  holes[0] = true;
  holes[1] = true;
  busy.loose.push({
    x: 10 * S,
    y: 20 * S,
    vx: 0,
    vy: 0,
    resting: true,
    wait: 0,
    by: 2,
  });
  unitOf(busy, 3).respawn = RESPAWN_STEPS / 2;
  stand(busy, 4, 240, 258, { riding: true, speed: true });
  busy.snail.rider = 4;
  busy.snail.victim = 3;
  busy.snail.eat = 10;
  busy.eggs[0] = 1;
  const seen = viewOf(busy);
  assert.deepEqual(seen.gates[0], {
    x: gate.x,
    y: gate.y,
    kind: gate.kind,
    owner: 0,
    user: 2,
    progress: 0.5,
  });
  assert.equal(seen.units[2]?.invulnerable, true);
  assert.equal(seen.units[2]?.carrying, true);
  assert.equal(seen.units[3]?.dead, true);
  assert.equal(seen.units[3]?.respawn, 0.5);
  assert.equal(seen.units[4]?.riding, true);
  assert.deepEqual(seen.berries, [0, 2]);
  assert.equal(seen.hives[1]?.[1]?.filled, true);
  assert.deepEqual(seen.loose, [{ x: 10, y: 20 }]);
  assert.deepEqual(seen.eggs, [1, 3]);
  assert.ok(seen.snail.eating > 0.9 && seen.snail.eating < 1);
  busy.snail.rider = -1;
  busy.snail.eat = EAT_STEPS / 2;
  assert.ok(Math.abs(viewOf(busy).snail.eating - 0.5) < 0.01);
  stepRound(state, []);
  assert.equal(viewOf(state).step, 1);
});
