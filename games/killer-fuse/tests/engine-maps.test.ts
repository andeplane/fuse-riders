import test from "node:test";
import assert from "node:assert/strict";
import {
  EAT_STEPS,
  GATE_STEPS,
  HOLE_HALF,
  PILE_HEIGHT,
  WARRIOR_HALF,
  WARRIOR_HEIGHT,
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
  standable,
  workerNav,
} from "../src/engine/nav.js";
import { ALL_HUMANS, bare, stand, unitOf } from "./engine-kit.js";

const mirrorX = (x: number): number => MAP_WIDTH - x;
const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
const mirroredRect = (r: Rect): Rect => ({ ...r, x: MAP_WIDTH - r.x - r.w });
const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const BERRIES: Readonly<Record<number, number>> = { 1: 66, 2: 66, 3: 54 };

for (const id of MAP_IDS) {
  const map = MAPS[id];
  const arena = arenaOf(id);

  test(`map ${id} (${map.name}) fits the screen and is its own mirror image`, () => {
    assert.equal(map.id, id);
    for (const platform of map.platforms) {
      assert.ok(platform.x >= 0 && platform.x + platform.w <= MAP_WIDTH);
      assert.ok(platform.y >= 0 && platform.y + platform.h <= MAP_HEIGHT);
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
    for (const pile of map.piles) {
      // Every pile holds six berries.
      assert.equal(pile.count, 6);
      assert.ok(
        map.piles.some(
          (other) =>
            other.hanging === pile.hanging &&
            samePoint(other, { x: mirrorX(pile.x), y: pile.y }),
        ),
      );
    }
    assert.equal(
      map.piles.reduce((sum, pile) => sum + pile.count, 0),
      BERRIES[id],
    );
    assert.equal(map.holes[0].length, 12);
    assert.equal(map.holes[1].length, 12);
    map.holes[0].forEach((hole, index) => {
      const other = map.holes[1][index];
      assert.ok(other);
      assert.ok(samePoint(other, { x: mirrorX(hole.x), y: hole.y }));
      assert.ok(hole.x < MAP_WIDTH / 2, "team 0's hive is on the left");
      // Every hole lies inside its hive's wall.
      const wall = map.hiveWalls[0];
      assert.ok(hole.x - 3 >= wall.x && hole.x + 3 <= wall.x + wall.w);
      assert.ok(hole.y - 3 >= wall.y && hole.y + 3 <= wall.y + wall.h);
    });
    assert.ok(sameRect(map.hiveWalls[1], mirroredRect(map.hiveWalls[0])));
    assert.ok(sameRect(map.nets[1], mirroredRect(map.nets[0])));
    assert.equal(map.eggSpots[0].length, 2);
    map.eggSpots[0].forEach((egg, index) => {
      const other = map.eggSpots[1][index];
      assert.ok(other);
      assert.ok(samePoint(other, { x: mirrorX(egg.x), y: egg.y }));
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
    // The net stands on the snail's floor, over the goal.
    const net = map.nets[0];
    assert.equal(net.y + net.h, map.snail.y);
    assert.ok(
      net.x <= map.snail.goals[0] && map.snail.goals[0] <= net.x + net.w,
    );
    assert.deepEqual([net.w, net.h], [29, 19]);
  });

  test(`map ${id}: everything stands on a platform, and a gate has room for the Warrior a Worker grows into`, () => {
    const standing = [
      ...arena.gates,
      ...arena.piles.filter((pile) => !pile.hanging),
      ...arena.spawns,
      ...arena.eggSpots[0],
      ...arena.eggSpots[1],
    ];
    for (const at of standing)
      assert.ok(platformAt(arena, at.x, at.y) >= 0, `${at.x / S}, ${at.y / S}`);
    // A hanging pile grows down from a platform's underside or from the top of the screen.
    for (const pile of arena.piles.filter((each) => each.hanging)) {
      const top = pile.y - PILE_HEIGHT;
      assert.ok(
        top === 0 ||
          arena.solids.some(
            (solid) =>
              solid.y + solid.h === top &&
              pile.x >= solid.x &&
              pile.x <= solid.x + solid.w,
          ),
        `pile at ${pile.x / S}, ${pile.y / S} hangs from nothing`,
      );
    }
    for (const gate of arena.gates)
      for (const solid of arena.solids)
        assert.ok(
          gate.x + WARRIOR_HALF <= solid.x ||
            gate.x - WARRIOR_HALF >= solid.x + solid.w ||
            gate.y <= solid.y ||
            gate.y - WARRIOR_HEIGHT >= solid.y + solid.h,
          `no room in the gate at ${gate.x / S}, ${gate.y / S}`,
        );
    assert.equal(arena.solids[0]?.y, map.snail.y * S);
    assert.equal(arena.snail.goals[0], map.snail.goals[0] * S);
    assert.deepEqual(arena.eggSpots[0][0], {
      x: (map.eggSpots[0][0]?.x ?? 0) * S,
      y: (map.eggSpots[0][0]?.y ?? 0) * S,
    });
  });

  test(`map ${id}: a Worker can get from its spawn to every pile, gate, hive hole and the snail, and back`, () => {
    for (const speed of [false, true]) {
      const nav = workerNav(id, speed);
      assert.equal(workerNav(id, speed), nav, "derived once");
      const places = [
        ...arena.gates,
        { x: arena.snail.start, y: arena.snail.y },
      ].map((at) => platformAt(arena, at.x, at.y));
      for (const team of [0, 1] as const) {
        const spawn = arena.spawns[2 + team];
        assert.ok(spawn);
        const home = platformAt(arena, spawn.x, spawn.y);
        const there = (node: number): boolean =>
          (nav.dist[home]?.[node] ?? UNREACHABLE) < UNREACHABLE;
        const back = (node: number): boolean =>
          (nav.dist[node]?.[home] ?? UNREACHABLE) < UNREACHABLE;
        for (const place of places) {
          assert.ok(there(place), `spawn to platform ${place}, speed ${speed}`);
          assert.ok(back(place), `platform ${place} to spawn, speed ${speed}`);
        }
        // A pile or a hole is reached where it can be touched: standing beside it, or on a hop that brushes it.
        nav.piles.forEach((spots, pile) =>
          assert.ok(
            spots.some((spot) => there(spot.node) && back(spot.node)),
            `team ${team} cannot fetch from pile ${pile}, speed ${speed}`,
          ),
        );
        nav.holes[team].forEach((spots, hole) =>
          assert.ok(
            spots.some((spot) => there(spot.node)),
            `team ${team} cannot fill hole ${hole}, speed ${speed}`,
          ),
        );
      }
      for (const spots of [...nav.holes[0], ...nav.holes[1], ...nav.piles])
        for (const spot of spots) {
          const hop = nav.edges[spot.edge];
          assert.equal(hop === undefined, spot.edge < 0);
          if (hop) assert.deepEqual([hop.from, hop.x], [spot.node, spot.x]);
          assert.ok(standable(arena, spot.x, arena.solids[spot.node]?.y ?? 0));
        }
      // Route moves lead somewhere else; only the hops that touch a hole or pile may land where they started.
      for (const routes of nav.out)
        for (const index of routes)
          assert.notEqual(nav.edges[index]?.from, nav.edges[index]?.to);
    }
  });

  test(`map ${id}: the upper hive holes take a jump, and nobody spawns in front of a hole`, () => {
    const nav = workerNav(id, false);
    const jumps = nav.holes[0].filter((spots) =>
      spots.every((spot) => spot.edge >= 0),
    ).length;
    assert.ok(jumps >= 8, `${jumps} holes need a jump`);
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
    // Two seconds with nobody touching a stick: no contact of any kind, and everyone still stands on its spawn.
    for (let i = 0; i < 120; i += 1) {
      stepRound(state, []);
      assert.deepEqual(state.events, []);
    }
    state.units.forEach((unit, slot) => {
      assert.equal(unit.x, arena.spawns[slot]?.x);
      assert.equal(unit.y, arena.spawns[slot]?.y);
    });
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
  assert.deepEqual(
    view.piles.map((pile) => pile.hanging),
    MAPS[1].piles.map((pile) => pile.hanging),
  );
  assert.deepEqual(
    view.spares[1],
    MAPS[1].eggSpots[1].map((egg) => ({ ...egg, present: true })),
  );
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
  stand(busy, 4, 240, 265, { riding: true, speed: true });
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
  // Two deaths, and the second egg is still there while the dead Queen waits to hatch from it.
  assert.deepEqual(
    seen.spares[0]?.map((egg) => egg.present),
    [false, true],
  );
  unitOf(busy, 0).dead = false;
  assert.deepEqual(
    viewOf(busy).spares[0]?.map((egg) => egg.present),
    [false, false],
  );
  unitOf(busy, 0).dead = true;
  assert.ok(seen.snail.eating > 0.9 && seen.snail.eating < 1);
  busy.snail.rider = -1;
  busy.snail.eat = EAT_STEPS / 2;
  assert.ok(Math.abs(viewOf(busy).snail.eating - 0.5) < 0.01);
  stepRound(state, []);
  assert.equal(viewOf(state).step, 1);
});
