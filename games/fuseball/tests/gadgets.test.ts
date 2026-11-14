import test from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_COOL_STEPS,
  FIELD_KICK,
  MAPS,
  MAP_IDS,
  RIGHT,
  botInput,
  decodeWorld,
  encodeWorld,
  freshBarriers,
  paceTick,
  stepWorld,
  toView,
  type MapDef,
  type MapId,
  type Rect,
  type World,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import {
  A,
  B,
  at,
  ballAt,
  held,
  place,
  playing,
  steps,
  until,
} from "./fixtures/world.js";

/**
 * The gadgets: force fields, gates, bumpers and portals. They act on the ball and only the ball; their state, where
 * they have any, is part of the world and its checkpoint.
 */
const W = 640,
  H = 360,
  BALL = 8;
const maps = MAP_IDS.map((id) => MAPS[id]);
/** Where barriers sit in an encoded world: one `[left, timer]` per barrier, the last field. */
const BARRIERS = 15;

/** A world in play with both riders out of it, so only the arena acts on the ball. */
function empty(mapId: MapId): World {
  const world = playing(mapId);
  for (const rider of world.riders) rider.zapped = true;
  return world;
}
const mod = (value: number, size: number) => ((value % size) + size) % size;
/** A rect as the cells it covers, so the two descriptions of one shape across a seam compare equal. */
function cells(map: MapDef, rects: readonly Rect[]): string[] {
  const covered = new Set<string>();
  for (const rect of rects)
    for (let x = rect.x; x < rect.x + rect.w; x += 2)
      for (let y = rect.y; y < rect.y + rect.h; y += 2)
        covered.add(
          `${map.wrapX ? mod(x, W) : x},${map.wrapY ? mod(y, H) : y}`,
        );
  return [...covered].sort();
}
const flip = (rect: Rect): Rect => ({ ...rect, x: W - rect.x - rect.w });
const overlap = (a: Rect, b: Rect, margin = 0): boolean =>
  a.x < b.x + b.w + margin &&
  b.x < a.x + a.w + margin &&
  a.y < b.y + b.h + margin &&
  b.y < a.y + a.h + margin;

for (const map of maps) {
  test(`${map.id}: its gadgets sit on whole, even pixels, clear of the solids, and mirror left to right`, () => {
    for (const barrier of map.barriers) {
      for (const value of [barrier.x, barrier.y, barrier.w, barrier.h])
        assert.ok(Number.isInteger(value) && value % 2 === 0);
      assert.ok(barrier.x >= 0 && barrier.x + barrier.w <= W);
      assert.ok(barrier.y >= 0 && barrier.y + barrier.h <= H);
      if (barrier.kind === "field") assert.ok(barrier.hits >= 2);
    }
    for (const kind of ["field", "gate"] as const) {
      const rects = map.barriers.filter((barrier) => barrier.kind === kind);
      assert.deepEqual(cells(map, rects.map(flip)), cells(map, rects));
    }
    const circles = (list: readonly { x: number; y: number; r: number }[]) =>
      list.map(({ x, y, r }) => `${x},${y},${r}`).sort();
    assert.deepEqual(
      circles(map.bumpers.map((b) => ({ ...b, x: W - b.x }))),
      circles(map.bumpers),
    );
    for (const bumper of map.bumpers) {
      assert.ok(bumper.r >= BALL);
      // Clear of every solid by more than the ball, so the ball is never wedged between the two.
      for (const solid of map.solids)
        assert.ok(
          !overlap(
            {
              x: bumper.x - bumper.r,
              y: bumper.y - bumper.r,
              w: 2 * bumper.r,
              h: 2 * bumper.r,
            },
            solid,
            2 * BALL + 2,
          ),
          `bumper at ${bumper.x},${bumper.y} is too near a solid`,
        );
      // And of each other, so the ball only ever meets one at a time.
      for (const other of map.bumpers)
        if (other !== bumper)
          assert.ok(
            Math.hypot(other.x - bumper.x, other.y - bumper.y) >
              other.r + bumper.r + 2 * BALL,
          );
    }
    // The portals mirror as pairs: each pair's mirror image is another pair (or itself).
    const pairs = (list: MapDef["portals"]) =>
      list
        .map((portal) =>
          [portal.a, portal.b]
            .map((end) => `${end.x},${end.y}`)
            .sort()
            .join(">"),
        )
        .sort();
    assert.deepEqual(
      pairs(
        map.portals.map((portal) => ({
          ...portal,
          a: { x: W - portal.a.x, y: portal.a.y },
          b: { x: W - portal.b.x, y: portal.b.y },
        })),
      ),
      pairs(map.portals),
    );
    const ends = map.portals.flatMap((portal) =>
      [portal.a, portal.b].map((end) => ({ ...end, r: portal.r })),
    );
    for (const end of ends) {
      assert.ok(end.r >= BALL + 4, "a portal is wider than the ball");
      // A ball arriving at an end's centre is not inside a solid, a goal or another portal.
      for (const solid of map.solids)
        assert.ok(
          !overlap(
            { x: end.x - BALL, y: end.y - BALL, w: 2 * BALL, h: 2 * BALL },
            solid,
          ),
          `the portal end at ${end.x},${end.y} is in a solid`,
        );
      for (const other of ends)
        if (other !== end)
          assert.ok(
            Math.hypot(other.x - end.x, other.y - end.y) > other.r + end.r,
          );
    }
    assert.equal(freshBarriers(map).length, map.barriers.length);
  });
}

// ---- force fields ----

/** The field over `team`'s goal on Brute Force, and a point in the open a little way inside it. */
function fieldOf(team: 0 | 1) {
  const map = MAPS.bruteforce,
    index = team === 0 ? 0 : 1,
    field = map.barriers[index]!;
  assert.equal(field.kind, "field");
  const inward = team === 0 ? -1 : 1;
  return {
    index,
    field,
    inward,
    // Level with the middle of the field, sixty pixels into the arena from it.
    x: field.x + field.w / 2 + inward * 60,
    y: field.y + field.h / 2,
  };
}
/** Sends the ball at the field over `team`'s goal and runs until it has been thrown back clear of it. */
function strike(world: World, team: 0 | 1): void {
  const { x, y, inward } = fieldOf(team);
  ballAt(world, x, y, -inward * 3, -0.5);
  const before = world.ball.bounces;
  until(world, () => world.ball.bounces !== before || world.phase !== "play");
  if (world.phase !== "play") return;
  assert.ok(
    world.ball.vx * inward >= FIELD_KICK,
    "thrown back at the field's kick or harder",
  );
  // Clear of it, and long enough for the next strike to count.
  steps(world, FIELD_COOL_STEPS);
}

test("a force field throws the ball back and wears down: the strike that breaks it lets the next ball through", () => {
  for (const team of [0, 1] as const) {
    const world = empty("bruteforce"),
      { index, field } = fieldOf(team);
    assert.equal(field.kind === "field" && field.hits, 3);
    assert.deepEqual(world.barriers[index], { left: 3, timer: 0 });
    for (const left of [2, 1, 0]) {
      strike(world, team);
      assert.equal(world.phase, "play", "no goal while the field is up");
      assert.equal(world.barriers[index]!.left, left);
      assert.deepEqual(world.score, [0, 0]);
      assert.equal(toView(world).barriers[index]!.up, left > 0);
    }
    // Down: the same shot now goes in.
    strike(world, team);
    assert.equal(world.phase, "zap");
    assert.equal(world.lastScorer, team);
    // The other side's field was never touched.
    assert.equal(world.barriers[index === 0 ? 1 : 0]!.left, 3);
  }
});

test("a ball held against a field is one strike, not one a step", () => {
  const world = empty("bruteforce"),
    { index, x, y, inward } = fieldOf(0);
  // Pinned in the field's face for a third of a second: every step it is thrown back and put there again.
  const face = x - inward * (60 - 4 - BALL + 2);
  for (let step = 0; step < 40; step++) {
    ballAt(world, face, y, -inward * 2, 0);
    stepWorld(world, new Map());
  }
  assert.equal(world.barriers[index]!.left, 2);
  assert.ok(world.barriers[index]!.timer > 0);
  // Left alone it cools off, and then a strike counts again.
  ballAt(world, x, y);
  steps(world, FIELD_COOL_STEPS);
  assert.equal(world.barriers[index]!.timer, 0);
  strike(world, 0);
  assert.equal(world.barriers[index]!.left, 1);
});

test("a rider flies straight through a field, whole or broken, as through the goal behind it", () => {
  const world = playing("bruteforce"),
    { field } = fieldOf(0),
    y = field.y + field.h / 2;
  world.riders[1].zapped = true;
  ballAt(world, 320, 100);
  place(world, 0, field.x - 30, y);
  world.riders[0].vx = 3 * SUB;
  let crossed = false;
  for (let step = 0; step < 60 && !crossed; step++) {
    const before = world.riders[0].x;
    // Flapping keeps it level with the gap.
    stepWorld(world, held(step % 12 === 0 ? RIGHT | 16 : RIGHT));
    if (world.riders[0].x < before) crossed = true;
  }
  assert.ok(
    crossed,
    "it went out through the goal and came in on the far side",
  );
  assert.equal(world.barriers[0]!.left, 3, "and the field never felt it");
});

test("every point starts with the fields whole again", () => {
  const world = empty("bruteforce");
  strike(world, 0);
  strike(world, 1);
  assert.deepEqual(
    world.barriers.map((barrier) => barrier.left),
    [2, 2],
  );
  // A point for slot 1, through its own field.
  strike(world, 1);
  strike(world, 1);
  strike(world, 1);
  assert.equal(world.phase, "zap");
  until(world, () => world.phase === "countdown");
  assert.deepEqual(world.barriers, freshBarriers(MAPS.bruteforce));
});

test("barrier state is checkpointed: a worn field decodes to itself and plays on the same, and nonsense is refused", () => {
  const world = playing("bruteforce");
  strike(world, 0);
  ballAt(world, fieldOf(0).x, fieldOf(0).y, 3, -0.5);
  until(world, () => world.barriers[0]!.left === 1);
  assert.ok(world.barriers[0]!.timer > 0, "caught while it is still cooling");
  const fields = encodeWorld(world),
    copy = decodeWorld(JSON.parse(JSON.stringify(fields)));
  assert.ok(copy);
  assert.deepEqual(copy, world);
  assert.notEqual(copy.barriers, world.barriers);
  for (let step = 0; step < 600; step++) {
    stepWorld(world, new Map());
    stepWorld(copy, new Map());
  }
  assert.deepEqual(copy, world);

  const refused = (change: (barriers: unknown[]) => unknown, why: string) => {
    const altered = structuredClone(fields);
    const next = change(altered[BARRIERS] as unknown[]);
    if (next !== undefined) altered[BARRIERS] = next;
    assert.equal(decodeWorld(altered), undefined, why);
  };
  refused((b) => ((b[0] as number[])[0] = 4), "more strikes left than it has");
  refused((b) => ((b[0] as number[])[0] = -1), "fewer than none");
  refused((b) => ((b[0] as number[])[0] = 1.5), "half a strike");
  refused((b) => ((b[0] as number[])[1] = FIELD_COOL_STEPS + 1), "too long");
  refused((b) => ((b[1] as number[])[1] = 5), "cooling, never struck");
  refused((b) => b.slice(0, 1), "a barrier missing");
  refused((b) => [...b, [3, 0]], "a barrier too many");
  refused((b) => (b[0] = [1]), "half a barrier");
  refused(() => null, "no barriers at all");
  // A map without barriers carries none.
  const plain = encodeWorld(playing("gridlock"));
  assert.deepEqual(plain[BARRIERS], []);
  plain[BARRIERS] = [[3, 0]];
  assert.equal(decodeWorld(plain), undefined);
  // And a countdown has them all fresh.
  const waiting = structuredClone(encodeWorld(playing("bruteforce")));
  waiting[3] = 0;
  waiting[4] = 100;
  (waiting[BARRIERS] as number[][])[0]![0] = 2;
  assert.equal(decodeWorld(waiting), undefined, "a worn field in a countdown");
});

test("the bot breaks its field and then scores through it, from either side", () => {
  for (const slot of [0, 1] as const) {
    const world = playing("bruteforce"),
      me = world.riders[slot],
      mine = slot === 0 ? 0 : 1;
    world.riders[slot === 0 ? 1 : 0].zapped = true;
    let broke = -1,
      tick = 0;
    for (; tick < 120 * 20 && world.phase === "play"; tick++) {
      const inputs = new Map([[slot === 0 ? A : B, botInput(world, me)]]);
      for (let left = paceTick(world); left > 0; left--)
        stepWorld(world, inputs);
      if (broke < 0 && world.barriers[mine]!.left === 0) broke = tick / 20;
    }
    assert.ok(broke >= 0, `slot ${slot} broke its field`);
    assert.equal(world.phase, "zap", `slot ${slot} scored inside two minutes`);
    assert.equal(world.lastScorer, slot);
    assert.equal(me.ownGoals, 0);
    assert.ok(at(world.ball.x) >= 0);
  }
});
