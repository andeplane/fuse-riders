import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_IDS,
  S,
  WIDTH,
  arenaOf,
  wrapDelta,
  wrapX,
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
  route,
  walkWay,
  workerNav,
  type Edge,
} from "../src/engine/nav.js";

/** The platform that is the mirror image of `index`. */
function twin(mapId: 1 | 2 | 3, index: number): number {
  const solids = arenaOf(mapId).solids;
  const solid = solids[index];
  assert.ok(solid);
  const other = solids.findIndex(
    (s) =>
      s.y === solid.y &&
      s.w === solid.w &&
      s.h === solid.h &&
      s.x === WIDTH - solid.x - solid.w,
  );
  assert.ok(other >= 0, `platform ${index} has no mirror image`);
  return other;
}

const key = (edge: Edge): string =>
  [
    edge.from,
    edge.to,
    edge.x,
    edge.jump,
    edge.first,
    edge.second,
    edge.cost,
    edge.lx,
  ].join(",");

for (const mapId of MAP_IDS)
  for (const speed of [false, true])
    test(`map ${mapId}${speed ? " at speed" : ""}: the Worker graph is its own mirror image, so neither team has the better routes`, () => {
      const nav = workerNav(mapId, speed);
      assert.ok(nav.edges.length > 20);
      const keys = new Set(nav.edges.map(key));
      assert.equal(keys.size, nav.edges.length, "no move is listed twice");
      for (const edge of nav.edges) {
        const mirror: Edge = {
          ...edge,
          from: twin(mapId, edge.from),
          to: twin(mapId, edge.to),
          x: WIDTH - edge.x,
          lx: WIDTH - edge.lx,
          first: edge.first === 0 ? 0 : edge.first < 0 ? 1 : -1,
          second: edge.second === 0 ? 0 : edge.second < 0 ? 1 : -1,
        };
        assert.ok(keys.has(key(mirror)), `no mirror of move ${key(edge)}`);
      }
      const count = arenaOf(mapId).solids.length;
      for (let from = 0; from < count; from += 1)
        for (let to = 0; to < count; to += 1) {
          const there = nav.dist[from]?.[to];
          assert.equal(
            there,
            nav.dist[twin(mapId, from)]?.[twin(mapId, to)],
            `${from} to ${to}`,
          );
          assert.ok(there !== undefined, `${from} to ${to}`);
        }
      // Walls and blocks with no room to stand on are not part of the graph; everything else leads to the ground
      // and back (the map tests check every pile, gate and hole).
      const linked = nav.dist.filter(
        (row, node) =>
          (row[0] ?? UNREACHABLE) < UNREACHABLE &&
          (nav.dist[0]?.[node] ?? UNREACHABLE) < UNREACHABLE,
      ).length;
      assert.ok(linked >= count - 8, `${linked} of ${count} platforms linked`);
    });

for (const mapId of MAP_IDS)
  test(`map ${mapId}: a flyer's way to a mirrored target is the mirror image of the way`, () => {
    const nav = flyNav(mapId);
    const flipCell = (cell: number): number =>
      cell - (cell % COLS) + (COLS - 1 - (cell % COLS));
    for (let cell = 0; cell < COLS * ROWS; cell += 1) {
      assert.equal(nav.free[cell], nav.free[flipCell(cell)]);
      assert.equal(
        nav.nearest[flipCell(cell)],
        flipCell(nav.nearest[cell] ?? -1),
      );
    }
    let checked = 0;
    // Points a few pixels inside their cells, skipping any on a cell border, where a point and its mirror image fall in cells that are not mirror images.
    for (let x = 5 * S; x < WIDTH; x += 37 * S)
      for (let y = 9 * S; y < 250 * S; y += 31 * S)
        for (let tx = 7 * S; tx < WIDTH; tx += 53 * S)
          for (let ty = 11 * S; ty < 250 * S; ty += 43 * S) {
            if (x % CELL === 0 || tx % CELL === 0) continue;
            checked += 1;
            const way = flyToward(mapId, x, y, tx, ty);
            const mirror = flyToward(mapId, WIDTH - x, y, WIDTH - tx, ty);
            assert.deepEqual(
              mirror,
              { x: WIDTH - way.x, y: way.y },
              `from ${x / S}, ${y / S} to ${tx / S}, ${ty / S}`,
            );
          }
    assert.ok(checked > 3000);
    assert.equal(cellOf(cellCentre(17).x, cellCentre(17).y), 17);
    assert.equal(CELL % S, 0);
  });

for (const mapId of MAP_IDS)
  test(`map ${mapId}: every hop brings a Worker closer, with the walks between landings and launches counted in full`, () => {
    const arena = arenaOf(mapId);
    for (const speed of [false, true]) {
      const nav = workerNav(mapId, speed);
      assert.ok(nav.rest.length > 20 && nav.rest.length <= nav.edges.length);
      nav.rest.forEach((row, index) => {
        const edge = nav.edges[index];
        assert.ok(edge);
        const landing = arena.solids[edge.to];
        assert.ok(landing);
        // A Worker stands with up to half its body over the end of a platform.
        assert.ok(
          Math.abs(wrapDelta(edge.lx, landing.x + (landing.w >> 1))) * 2 <=
            landing.w + 16 * S,
          "a hop lands on its platform",
        );
        assert.equal(row.length, arena.solids.length);
        row.forEach((cost, to) => {
          // What is left after the landing is exactly the best next hop from where it landed: a Worker that follows
          // the table never takes a hop that leaves it further away, so it cannot go back and forth between two.
          const [next, onward] =
            edge.to === to
              ? [-1, 0]
              : route(nav, arena, edge.to, edge.lx, to, speed);
          assert.equal(cost, onward, `after move ${index} to ${to}`);
          if (edge.to !== to && cost < UNREACHABLE) {
            const hop = nav.edges[next];
            assert.ok(hop && hop.from === edge.to);
            assert.ok((nav.rest[next]?.[to] ?? UNREACHABLE) < cost);
          }
        });
      });
      // Standing on the platform already, or with no way there, there is no hop to take.
      assert.equal(route(nav, arena, 0, 0, -1, speed)[0], -1);
    }
  });

test("a Worker walks round a block on its platform: the long way on a floor that spans the screen, not at all across a pillar", () => {
  const dusk = arenaOf(3);
  const floor = dusk.solids.findIndex((solid) => solid.w === WIDTH);
  assert.ok(floor >= 0);
  // Open floor: the short way, across the seam when that is shorter.
  assert.equal(walkWay(dusk, floor, 30 * S, 60 * S), 30 * S);
  assert.equal(walkWay(dusk, floor, 10 * S, 470 * S), -20 * S);
  // A block stands between 22 and 262: round the back of the screen instead.
  assert.equal(walkWay(dusk, floor, 22 * S, 262 * S), -240 * S);
  assert.equal(walkWay(dusk, floor, 262 * S, 22 * S), 240 * S);
  // Between the floor's two blocks there is no way in from outside.
  assert.equal(walkWay(dusk, floor, 6 * S, 222 * S), undefined);

  const night = arenaOf(2);
  const ledge = night.solids.findIndex(
    (solid) => solid.x === 220 * S && solid.y === 145 * S,
  );
  assert.ok(ledge >= 0);
  assert.equal(walkWay(night, ledge, 226 * S, 228 * S), 2 * S);
  assert.equal(walkWay(night, ledge, 226 * S, 254 * S), undefined);
  // The route from one half takes a hop, never a walk into the pillar.
  const nav = workerNav(2, false);
  for (const index of nav.out[ledge] ?? []) {
    const edge = nav.edges[index];
    assert.ok(edge);
    const [hop] = route(nav, night, ledge, 226 * S, edge.to, false);
    const first = nav.edges[hop];
    assert.ok(first);
    assert.notEqual(walkWay(night, ledge, 226 * S, first.x), undefined);
  }
});

for (const mapId of MAP_IDS)
  test(`map ${mapId}: a flyer in a gap is sent to a free cell it can see, not one behind a platform`, () => {
    const arena = arenaOf(mapId);
    const nav = flyNav(mapId);
    const inside = (x: number, y: number): boolean =>
      arena.solids.some(
        (solid) =>
          y > solid.y &&
          y < solid.y + solid.h &&
          Math.abs(wrapDelta(x, solid.x + (solid.w >> 1))) * 2 < solid.w,
      );
    let gaps = 0;
    const hidden: number[] = [];
    for (let cell = 0; cell < COLS * ROWS; cell += 1) {
      const target = nav.nearest[cell];
      assert.ok(target !== undefined && nav.free[target], `cell ${cell}`);
      const from = cellCentre(cell),
        to = cellCentre(target);
      if (nav.free[cell]) {
        assert.equal(target, cell);
        continue;
      }
      if (inside(from.x, from.y)) continue;
      gaps += 1;
      const dx = wrapDelta(to.x, from.x),
        dy = to.y - from.y;
      for (let k = 1; k < 40 && !hidden.includes(cell); k += 1)
        if (
          inside(
            wrapX(from.x + Math.trunc((dx * k) / 40)),
            from.y + Math.trunc((dy * k) / 40),
          )
        )
          hidden.push(cell);
    }
    // A corner pocket or two has no free cell in sight and takes the nearest of all.
    assert.ok(hidden.length <= 2, `cells ${hidden.join(", ")}`);
    assert.ok(gaps > 100);
  });
