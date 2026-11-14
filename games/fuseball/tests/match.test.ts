import test from "node:test";
import assert from "node:assert/strict";
import {
  BTN,
  COUNTDOWN_STEPS,
  LEFT,
  MAPS,
  MAP_IDS,
  RIGHT,
  TARGET,
  GOAL_FREEZE_STEPS,
  GOAL_STEPS,
  ZAP_STEPS,
  isCircle,
  stepWorld,
  toView,
  winnerOf,
  type MapId,
  type Slot,
  type World,
} from "../src/engine/index.js";
import { SUB } from "../src/engine/math.js";
import * as kit from "../src/engine/view-kit.js";
import {
  A,
  B,
  at,
  ballAt,
  fresh,
  held,
  place,
  playing,
  steps,
  until,
} from "./fixtures/world.js";

/** Puts the ball in the middle of `team`'s first goal and steps once: the point is scored. */
function scoreFor(world: World, team: Slot): void {
  const goal = MAPS[world.mapId].goals.find((each) => each.team === team)!;
  if (isCircle(goal)) ballAt(world, goal.x, goal.y);
  else ballAt(world, goal.x + goal.w / 2, goal.y + goal.h / 2);
  stepWorld(world, new Map());
}
/** Plays out a whole point for `team`: the goal, the zap, and the next countdown if the match goes on. */
function point(world: World, team: Slot): void {
  scoreFor(world, team);
  steps(world, GOAL_STEPS);
  if (world.phase === "countdown") steps(world, COUNTDOWN_STEPS);
}

test("a match starts 0–0 in a three second countdown, riders on their marks and the ball on its anchor", () => {
  for (const mapId of MAP_IDS) {
    const world = fresh(mapId),
      map = MAPS[mapId];
    assert.equal(world.phase, "countdown");
    assert.equal(world.phaseSteps, COUNTDOWN_STEPS);
    assert.equal(COUNTDOWN_STEPS, 360);
    assert.deepEqual(world.score, [0, 0]);
    assert.deepEqual(
      world.riders.map((r) => [r.id, r.slot, at(r.x), at(r.y)]),
      [
        [A, 0, map.spawns[0].x, map.spawns[0].y],
        [B, 1, map.spawns[1].x, map.spawns[1].y],
      ],
    );
    assert.deepEqual(
      [at(world.ball.x), at(world.ball.y)],
      [map.ballAnchor.x, map.ballAnchor.y],
    );
    assert.deepEqual([world.riders[0].facing, world.riders[1].facing], [1, -1]);
  }
});

test("the countdown freezes everything, whatever is held, then play starts", () => {
  const world = fresh("halo"),
    before = structuredClone(world);
  const counts: number[] = [];
  for (let i = 0; i < COUNTDOWN_STEPS - 1; i++) {
    stepWorld(world, held(RIGHT | BTN, LEFT | BTN));
    if (i % 120 === 0) counts.push(toView(world).count);
    assert.equal(world.phase, "countdown");
  }
  assert.deepEqual(counts, [3, 2, 1]);
  assert.deepEqual(
    world.riders.map((r) => [r.x, r.y, r.vx, r.vy]),
    before.riders.map((r) => [r.x, r.y, r.vx, r.vy]),
  );
  assert.deepEqual(world.ball, before.ball);
  assert.ok(!world.bubbles[0].active && !world.bubbles[1].active);
  stepWorld(world, held(RIGHT | BTN, LEFT | BTN));
  assert.equal(world.phase, "play");
  assert.equal(toView(world).count, 0);
});

test("a button held through the countdown is not a jump when play starts; pressing then is", () => {
  const world = fresh(),
    rider = world.riders[0];
  steps(world, COUNTDOWN_STEPS, held(BTN));
  steps(world, 30, held(BTN));
  assert.ok(rider.grounded);
  assert.equal(rider.jumps, 0);

  const ready = fresh();
  steps(ready, COUNTDOWN_STEPS);
  stepWorld(ready, held(BTN));
  assert.equal(ready.riders[0].jumps, 1);
  assert.ok(!ready.bubbles[0].active, "a jump off the mark, not an air-jump");
});

test("the ball in a goal scores for that goal's colour and zaps the other rider", () => {
  for (const mapId of MAP_IDS)
    for (const team of [0, 1] as const) {
      const world = playing(mapId),
        other = team === 0 ? 1 : 0;
      world.ball.touch = team;
      scoreFor(world, team);
      assert.equal(world.score[team], 1);
      assert.equal(world.score[other], 0);
      assert.equal(world.lastScorer, team);
      assert.equal(world.phase, "zap");
      assert.equal(world.phaseSteps, ZAP_STEPS);
      assert.ok(world.riders[other].zapped);
      assert.ok(!world.riders[team].zapped);
      assert.ok(!world.ball.live);
      assert.equal(world.riders[team].goals, 1);
      assert.equal(world.riders[other].ownGoals, 0);
    }
});

test("sending the ball into the other colour's goal scores for them: an own goal", () => {
  const world = playing();
  world.ball.touch = 1;
  scoreFor(world, 0);
  assert.deepEqual(world.score, [1, 0]);
  assert.ok(world.riders[1].zapped, "the rider who sent it is the one zapped");
  assert.equal(world.riders[1].ownGoals, 1);
  assert.equal(world.riders[0].goals, 0);

  // Untouched, or touched by both at once, the point is credited to the side it went to.
  const loose = playing();
  scoreFor(loose, 1);
  assert.equal(loose.riders[1].goals, 1);
  assert.equal(loose.riders[0].ownGoals, 0);
});

test("a rider knocks the ball into the goal by playing: kicked through the gap in Gridlock", () => {
  const world = playing(),
    rider = world.riders[0];
  // Slot 0's goal is the gap on the right; the ball waits just in front of it at gap height.
  place(world, 0, 560, 180);
  rider.vx = 3 * SUB;
  ballAt(world, 590, 182);
  const scored = until(world, () => world.phase === "zap", held(RIGHT), 120);
  assert.notEqual(scored, -1);
  assert.deepEqual(world.score, [1, 0]);
  assert.equal(world.riders[0].goals, 1);
  assert.ok(world.riders[1].zapped);
});

test("riders pass through goals without scoring", () => {
  const world = playing("halo"),
    goal = MAPS.halo.goals[0]!;
  place(world, 0, goal.x, goal.y);
  place(world, 1, goal.x + 30, goal.y);
  steps(world, 5);
  assert.deepEqual(world.score, [0, 0]);
  assert.equal(world.phase, "play");
});

test("during the zap the scorer still moves, the zapped rider does not, and nothing more is scored", () => {
  const world = playing(),
    [scorer, zapped] = world.riders;
  place(world, 1, 400, 100);
  zapped.vx = SUB;
  scoreFor(world, 0);
  const where = { x: zapped.x, y: zapped.y },
    ball = { ...world.ball },
    start = scorer.x;
  for (let i = 0; i < GOAL_STEPS - 1; i++) {
    stepWorld(world, held(RIGHT, LEFT | BTN));
    assert.equal(world.phase, "zap");
  }
  assert.ok(at(scorer.x - start) > 100, "the scorer runs about");
  assert.deepEqual(
    { x: zapped.x, y: zapped.y },
    where,
    "the zapped one is gone",
  );
  assert.equal(zapped.jumps, 0);
  assert.ok(!world.bubbles[1].active);
  assert.deepEqual(world.ball, ball, "the ball stays where it went in");
  assert.deepEqual(world.score, [1, 0]);
});

test("a zapped rider is no obstacle and their bubble goes soft", () => {
  const world = playing(),
    [scorer, zapped] = world.riders;
  place(world, 1, 300, 200);
  stepWorld(world, held(0, BTN));
  assert.ok(world.bubbles[1].hard);
  scoreFor(world, 0);
  stepWorld(world, held(0, BTN));
  assert.ok(!world.bubbles[1].hard, "nobody is holding it any more");
  // Nothing moves until the freeze that follows the goal is over.
  steps(world, GOAL_FREEZE_STEPS);
  place(world, 0, at(zapped.x) - 30, at(zapped.y));
  scorer.vx = 3 * SUB;
  steps(world, 30, held(RIGHT));
  assert.ok(scorer.x > zapped.x, "the scorer flies straight through");
});

test("after the zap the point resets: marks, anchor, no bubbles, a new countdown, the score kept", () => {
  const world = playing("downlink"),
    map = MAPS.downlink;
  place(world, 0, 300, 100);
  stepWorld(world, held(BTN));
  assert.ok(world.bubbles[0].active);
  scoreFor(world, 1);
  steps(world, GOAL_STEPS - 1, held(RIGHT | BTN));
  assert.equal(world.phase, "zap");
  stepWorld(world, held(RIGHT | BTN));
  assert.equal(world.phase, "countdown");
  assert.equal(world.phaseSteps, COUNTDOWN_STEPS);
  assert.deepEqual(world.score, [0, 1]);
  assert.equal(world.lastScorer, 1);
  assert.deepEqual(
    world.riders.map((r) => [at(r.x), at(r.y), r.vx, r.vy, r.zapped, r.slide]),
    map.spawns.map((spawn) => [spawn.x, spawn.y, 0, 0, false, 0]),
  );
  assert.ok(world.ball.live);
  assert.deepEqual(
    [at(world.ball.x), at(world.ball.y), world.ball.vx, world.ball.vy],
    [map.ballAnchor.x, map.ballAnchor.y, 0, 0],
  );
  assert.equal(world.ball.touch, -1);
  assert.ok(world.bubbles.every((bubble) => !bubble.active && !bubble.hard));
  // The button held across the reset and the countdown is still not a press.
  steps(world, COUNTDOWN_STEPS + 20, held(BTN));
  assert.equal(world.phase, "play");
  assert.ok(world.riders[0].grounded);
});

test("first to three wins: the match is over after the last zap and nothing moves again", () => {
  const world = playing();
  assert.equal(TARGET, 3);
  point(world, 0);
  point(world, 1);
  point(world, 0);
  assert.equal(winnerOf(world), -1);
  assert.equal(world.phase, "play");
  scoreFor(world, 0);
  assert.deepEqual(world.score, [3, 1]);
  assert.equal(world.phase, "zap", "the last point gets its zap too");
  assert.equal(winnerOf(world), 0);
  steps(world, GOAL_STEPS);
  assert.equal(world.phase, "over");
  assert.equal(world.phaseSteps, 0);
  const view = toView(world);
  assert.equal(view.winner, 0);
  assert.deepEqual(view.score, [3, 1]);
  const done = structuredClone(world);
  steps(world, 500, held(RIGHT | BTN, LEFT | BTN));
  assert.deepEqual(world, done);
});

test("at 2–2 the next point is sudden death, flagged from the goal that made it 2–2", () => {
  const world = playing();
  point(world, 0);
  point(world, 1);
  point(world, 0);
  assert.ok(!world.suddenDeath);
  scoreFor(world, 1);
  assert.deepEqual(world.score, [2, 2]);
  assert.ok(world.suddenDeath);
  assert.ok(toView(world).suddenDeath);
  steps(world, GOAL_STEPS + COUNTDOWN_STEPS);
  assert.equal(world.phase, "play");
  assert.ok(world.suddenDeath);
  point(world, 1);
  assert.equal(world.phase, "over");
  assert.equal(winnerOf(world), 1);
  assert.ok(world.suddenDeath, "the result still says how it was decided");

  const plain = playing();
  point(plain, 0);
  point(plain, 0);
  point(plain, 1);
  point(plain, 0);
  assert.equal(plain.phase, "over");
  assert.ok(!plain.suddenDeath);
});

test("the view is the world in pixels, with what the presentation needs", () => {
  const world = playing();
  place(world, 0, 215, 200);
  stepWorld(world, held(RIGHT | BTN));
  const view = toView(world),
    [a, b] = view.riders;
  assert.equal(view.mapId, "gridlock");
  assert.equal(view.phase, "play");
  assert.equal(view.step, world.step);
  assert.equal(view.target, 3);
  assert.equal(view.winner, -1);
  assert.equal(view.lastScorer, -1);
  assert.ok(!view.slow && !view.suddenDeath);
  assert.deepEqual([a.id, a.slot, b.id, b.slot], [A, 0, B, 1]);
  assert.equal(a.x, world.riders[0].x / SUB);
  assert.ok(a.x > 215 && a.x < 216 && a.y < 200);
  assert.equal(a.vy, world.riders[0].vy / SUB);
  assert.ok(a.holding && !b.holding);
  assert.ok(!a.grounded && !a.sliding && !a.zapped);
  assert.equal(a.jumps, 1);
  assert.deepEqual(view.bubbles[0], {
    slot: 0,
    active: true,
    hard: true,
    x: 215,
    y: 200,
    seq: 1,
  });
  assert.equal(view.bubbles[1].active, false);
  assert.deepEqual(
    [view.ball.x, view.ball.live, view.ball.touch],
    [at(world.ball.x), true, -1],
  );
  // A view shares nothing with the world: changing one leaves the other alone.
  view.score[0] = 2;
  assert.deepEqual(world.score, [0, 0]);
});

test("the renderer's kit carries the arenas and the sizes it draws to", () => {
  assert.equal(kit.VIEW_W, 640);
  assert.equal(kit.VIEW_H, 360);
  assert.deepEqual(
    [kit.RIDER_RADIUS, kit.BALL_RADIUS, kit.BUBBLE_RADIUS],
    [9, 8, 14],
  );
  const ids: readonly MapId[] = kit.MAP_IDS;
  for (const id of ids) assert.equal(kit.mapOf(id), MAPS[id]);
});
