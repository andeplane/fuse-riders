import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer,
  createGame,
  startMatch,
  step,
  COUNTDOWN_TICKS,
  SLOT_COLORS,
  type InputIntent,
} from "../src/shared/game.js";
import { canonicalRoomState } from "../src/shared/apply-tick.js";
import { defaultRoomSettings } from "../src/shared/room-settings.js";
import type { GameState } from "../src/shared/game.js";
import { GUN_TRACER_TICKS } from "../src/shared/gun.js";
import { encodeGameState, decodeGameState } from "../src/online/checkpoint.js";

const canonical = (game: GameState) =>
  canonicalRoomState({
    game,
    settings: defaultRoomSettings(),
    folds: new Map(),
    bots: new Set(),
  });
const neutral: InputIntent = { left: false, right: false, bomb: false };
const press: InputIntent = {
  ...neutral,
  bomb: true,
  bombCommands: [{ action: "press" }],
};
function scene() {
  const game = createGame("gun-regression", 42);
  for (let slot = 0; slot < 4; slot++)
    addPlayer(game, {
      id: `p${slot}`,
      name: `P${slot}`,
      slot,
      color: SLOT_COLORS[slot]!,
    });
  startMatch(game);
  for (let tick = 0; tick < COUNTDOWN_TICKS; tick++) step(game, new Map());
  const [shooter, target, behind, spare] = [...game.players.values()];
  Object.assign(shooter!, {
    x: 200,
    y: 450,
    angle: 0,
    trail: [],
    gunArmed: true,
  });
  Object.assign(target!, { x: 850, y: 700, angle: 0, trail: [] });
  Object.assign(behind!, { x: 1200, y: 450, angle: Math.PI, trail: [] });
  Object.assign(spare!, { x: 1200, y: 150, angle: 0, trail: [] });
  game.nextPickupSpawnTick = game.tick + 1000;
  const fire = (input = press) => step(game, new Map([["p0", input]]));
  const body = (x: number, y1 = 300, y2 = 600) => ({
    x1: x,
    y1,
    x2: x,
    y2,
    createdTick: game.tick,
    expiresAtTick: game.tick + 100,
  });
  return {
    game,
    shooter: shooter!,
    target: target!,
    behind: behind!,
    spare: spare!,
    fire,
    body,
  };
}

test("pickup fires on press across the arena, stops at the first head and credits one instant kill", () => {
  const { game, shooter, target, behind, fire } = scene();
  shooter.gunArmed = false;
  game.pickups = [
    {
      id: 1,
      type: "gun",
      x: shooter.x,
      y: shooter.y,
      expiresAtTick: game.tick + 20,
    },
  ];
  step(game, new Map());
  Object.assign(target, { x: 900, y: 450, angle: Math.PI });
  const result = fire();
  assert.equal(target.alive, false);
  assert.equal(behind.alive, true, "first head blocks the more distant head");
  assert.equal(shooter.gunArmed, false);
  assert.equal(shooter.bombChargeStartedTick, undefined);
  assert.equal(game.blasts.length, 0);
  assert.equal(
    result.events.filter((event) => event.type === "bombPlaced").length,
    1,
  );
  assert.equal(
    result.events.some((event) => event.type === "explosion"),
    false,
  );
  assert.deepEqual(
    game.shots[0]!.kills.map((kill) => kill.victimId),
    ["p1"],
  );
  assert.equal(game.shots[0]!.kills[0]!.elapsed, game.shots[0]!.elapsed);
});

test("small body hole stops the shot before a second body and head without splash", () => {
  const { game, target, behind, fire, body } = scene();
  target.trail = [body(700)];
  behind.trail = [body(1000)];
  fire();
  assert.equal(target.alive, true);
  assert.equal(behind.alive, true);
  const tracer = [...game.bombs.values()][0]!;
  assert.ok(
    Math.abs(tracer.x - 695) < 1e-5,
    "first contact includes 2px bullet and 3px trail radius",
  );
  const pieces = target.trail.filter((segment) => segment.x1 === 700);
  assert.equal(pieces.length, 2);
  const gap = pieces[1]!.y1 - pieces[0]!.y2;
  assert.ok(gap > 24 && gap < 28, "small gap remains wide enough for a rider");
  assert.ok(pieces[0]!.detached);
  assert.equal(pieces[1]!.detached, undefined);
  assert.ok(
    behind.trail.some(
      (segment) =>
        segment.x1 === 1000 && segment.y1 === 300 && segment.y2 === 600,
    ),
  );
  assert.equal(game.blasts.length, 0);
});

test("body hits near its own head kill; more distant hits and unrelated nearby heads do not", () => {
  for (const offset of [8, 24]) {
    const { target, behind, fire, body } = scene();
    Object.assign(target, {
      x: 700,
      y: 450 + offset,
      angle: Math.PI / 2,
      trail: [body(700)],
    });
    fire();
    assert.equal(target.alive, offset === 24);
    assert.equal(behind.alive, true);
  }
  const { target, spare, fire, body } = scene();
  target.trail = [body(700)];
  Object.assign(spare, { x: 690, y: 465, angle: Math.PI });
  fire();
  assert.equal(
    spare.alive,
    true,
    "another rider close to the hole is not splash damage",
  );
});

test("a dead trail blocks the shot, takes a hole and cannot earn another kill", () => {
  const { game, target, behind, fire, body } = scene();
  Object.assign(target, { alive: false, trail: [body(700)] });
  fire();
  assert.equal(behind.alive, true);
  assert.equal(target.trail.length, 2);
  assert.deepEqual(game.shots[0]!.kills, []);
});

test("shots follow this tick’s facing after turning, without homing, and clip to the wall", () => {
  const { game, shooter, target, behind, fire } = scene();
  Object.assign(target, { x: 900, y: 450, angle: 0 });
  fire({ ...press, right: true });
  const tracer = [...game.bombs.values()][0]!;
  assert.equal(target.alive, true);
  assert.equal(behind.alive, true);
  assert.ok(shooter.angle > 0);
  assert.ok(
    Math.abs(
      Math.atan2(tracer.y - tracer.launchY, tracer.x - tracer.launchX) -
        shooter.angle,
    ) < 1e-9,
  );
  assert.ok(tracer.x <= game.width - game.boundaryInset - 2 + 1e-6);
  assert.equal(game.blasts.length, 0);
  const endpoint = { x: tracer.x, y: tracer.y };
  step(game, new Map());
  assert.deepEqual(
    { x: tracer.x, y: tracer.y },
    endpoint,
    "tracer never flies or curves",
  );
});

test("headshots consume shields, respect immunity and still stop before the next rider", () => {
  for (const protection of [
    "shielded",
    "invulnerableUntilTick",
    "shieldGraceUntilTick",
    "portalGraceUntilTick",
  ] as const) {
    const { game, target, behind, fire } = scene();
    Object.assign(target, {
      x: 900,
      y: 450,
      angle: Math.PI,
      [protection]: protection === "shielded" ? true : game.tick + 20,
    });
    fire();
    assert.equal(target.alive, true, protection);
    assert.equal(behind.alive, true);
    assert.equal(target.shielded, false);
    assert.deepEqual(game.shots[0]!.kills, []);
  }
});

test("release, cancel, duplicate press and held input do not repeat the shot or undo it", () => {
  for (const action of ["release", "cancel", "press"] as const) {
    const { game, shooter, fire } = scene();
    fire({ ...press, bombCommands: [{ action: "press" }, { action }] });
    assert.equal(game.shots.length, 1);
    assert.equal(shooter.bombChargeStartedTick, undefined);
    fire({ ...neutral, bomb: true });
    fire({ ...neutral, bombCommands: [{ action }] });
    assert.equal(game.shots.length, 1);
    for (let tick = 0; tick < GUN_TRACER_TICKS; tick++) step(game, new Map());
    assert.equal(game.bombs.size, 0, "tracer expires without exploding");
    assert.equal(game.blasts.length, 0);
  }
});

test("cooldown blocks press without spending Gun, and release alone cannot shoot", () => {
  const { game, shooter, fire } = scene();
  shooter.bombReadyAtTick = game.tick + 10;
  fire();
  assert.equal(shooter.gunArmed, true);
  assert.equal(game.shots.length, 0);
  shooter.bombReadyAtTick = game.tick;
  fire({ ...neutral, bombCommands: [{ action: "release" }] });
  assert.equal(game.shots.length, 0);
  fire();
  assert.equal(game.shots.length, 1);
});

test("simultaneous opponents fire before deaths and checkpoint replay agrees with reversed map order", () => {
  const { game, target, behind } = scene();
  Object.assign(target, { x: 900, y: 450, angle: Math.PI, gunArmed: true });
  Object.assign(behind, { y: 750 });
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  restored.players = new Map([...restored.players].reverse());
  const inputs = new Map([
    ["p0", press],
    ["p1", press],
  ]);
  assert.deepEqual(step(restored, inputs), step(game, inputs));
  assert.equal(game.players.get("p0")!.alive, false);
  assert.equal(target.alive, false);
  assert.equal(canonical(restored), canonical(game));
  const after = decodeGameState(encodeGameState(game));
  assert.ok(after);
  for (let tick = 0; tick < 5; tick++) {
    assert.deepEqual(step(after, new Map()), step(game, new Map()));
    assert.equal(canonical(after), canonical(game));
  }
  assert.equal(
    game.shots.flatMap((shot) => shot.kills).length,
    2,
    "restoring tracers does not repeat damage",
  );
});

test("a volley beside a wall or trail spares the shooter and spends its modifiers once", () => {
  for (const wall of [false, true]) {
    const { game, shooter, target, fire, body } = scene();
    Object.assign(shooter, {
      fiveShotArmed: true,
      extraBombs: 1,
      y: wall ? 34 : 450,
    });
    target.trail = wall ? [] : [body(240)];
    fire();
    assert.equal(game.shots[0]!.bombs, 6);
    assert.equal(game.shots.length, 1);
    assert.equal(game.bombs.size, 6);
    assert.equal(shooter.alive, true);
    assert.equal(shooter.fiveShotArmed, false);
    assert.equal(shooter.extraBombs, 1);
    assert.equal(game.blasts.length, 0);
  }
});

test("one hole cutting multiple owners allocates detached ids in stable slot order", () => {
  const { game, target, behind, body } = scene();
  target.trail = [body(700)];
  behind.trail = [body(705)];
  const restored = decodeGameState(encodeGameState(game));
  assert.ok(restored);
  restored.players = new Map([...restored.players].reverse());
  const inputs = new Map([["p0", press]]);
  assert.deepEqual(step(restored, inputs), step(game, inputs));
  assert.equal(canonical(restored), canonical(game));
  assert.ok(target.trail[0]!.detached);
  assert.ok(behind.trail[0]!.detached);
});

test("equal body contacts retain slot priority for headshot classification", () => {
  const { game, target, behind, fire, body } = scene();
  Object.assign(target, {
    x: 500,
    y: 458,
    angle: Math.PI / 2,
    trail: [body(500, 300, 450)],
  });
  behind.trail = [body(500, 300, 450)];
  fire();
  assert.equal(target.alive, false, "first slot owns the equal impact");
  assert.equal(behind.alive, true);
  assert.deepEqual(
    game.shots[0]!.kills.map((kill) => kill.victimId),
    ["p1"],
  );
});
