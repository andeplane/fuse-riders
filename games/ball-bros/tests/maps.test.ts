import test from "node:test";
import assert from "node:assert/strict";
import { decodeArena, encodeArena } from "../src/engine/codec.js";
import {
  BALL_SPEED,
  COUNTDOWN,
  FRENZY,
  PICKUP_RADIUS,
  SUBSTEPS,
  control,
  createArena,
  insideArena,
} from "../src/engine/state.js";
import { ARENA_MAPS, MAP_IDS } from "../src/engine/maps.js";
import { step } from "../src/engine/step.js";
import { botControl } from "../src/engine/bots.js";
import { DEFAULT_SETTINGS, parseSettings } from "../src/online/game.js";

const players = [
  { id: "p0", name: "Player 0", slot: 0, bot: false },
  { id: "p1", name: "Player 1", slot: 1, bot: true },
];

test("every arena map reconstructs its own bounded armor from checkpoints", () => {
  const counts = { classic: 48, crossfire: 32, ricochet: 48 };
  for (const mapId of MAP_IDS) {
    const state = createArena(players, mapId);
    assert.equal(state.mapId, mapId);
    assert.ok(
      state.bases.every((base) => base.blocks.length === counts[mapId]),
    );
    state.bases[0]!.blocks[3]!.alive = false;
    assert.deepEqual(decodeArena(encodeArena(state)), state);

    const wrongMap = encodeArena(state);
    wrongMap[7] = "unknown";
    assert.equal(decodeArena(wrongMap), undefined);

    const wrongMask = encodeArena(state);
    (wrongMask[4] as unknown[][])[0]![10] = [];
    assert.equal(decodeArena(wrongMask), undefined);

    if (mapId === "ricochet") {
      const embedded = encodeArena(state);
      const first = ARENA_MAPS.ricochet.bumpers[0]!;
      const ball = (embedded[5] as unknown[][])[0]!;
      ball[1] = first.x;
      ball[2] = first.y;
      ball[6] = null;
      ball[3] = BALL_SPEED;
      ball[4] = 0;
      assert.equal(decodeArena(embedded), undefined);
    }
  }
});

test("Ricochet bumpers sweep balls without stealing powers or ownership", () => {
  const state = createArena(players, "ricochet");
  state.tick = COUNTDOWN;
  state.formationStep = COUNTDOWN * SUBSTEPS;
  state.phase = "playing";
  const ball = state.balls[0]!;
  state.balls = [ball];
  Object.assign(ball, {
    x: 500,
    y: 392,
    vx: 0,
    vy: BALL_SPEED,
    held: null,
    owner: "p0",
    bomb: true,
  });
  const events = step(state);
  assert.ok(events.some((event) => event.kind === "bumper"));
  assert.ok(ball.vy < 0);
  assert.equal(ball.owner, "p0");
  assert.equal(ball.bomb, true);
  assert.ok(Math.abs(Math.hypot(ball.vx, ball.vy) - BALL_SPEED) < 1e-8);
});

test("map fixtures leave the center launch and pickup track clear", () => {
  for (const mapId of MAP_IDS)
    for (const bumper of ARENA_MAPS[mapId].bumpers) {
      assert.ok(Math.hypot(bumper.x - 500, bumper.y - 500) > bumper.radius + 6);
      assert.ok(
        Math.abs(Math.hypot(bumper.x - 500, bumper.y - 500) - 135) >
          bumper.radius + PICKUP_RADIUS + 6,
      );
    }
});

test("room settings accept only complete known map selections", () => {
  assert.deepEqual(DEFAULT_SETTINGS, { display: false, mapId: "classic" });
  assert.deepEqual(parseSettings({ display: true, mapId: "crossfire" }), {
    display: true,
    mapId: "crossfire",
  });
  assert.equal(parseSettings({ display: false, mapId: "void" }), undefined);
  assert.equal(parseSettings({ display: false }), undefined);
  assert.equal(
    parseSettings({ display: false, mapId: "classic", extra: true }),
    undefined,
  );
});

test("bots complete bounded deterministic rounds on both phase 5 variants", () => {
  const bots = Array.from({ length: 5 }, (_, slot) => ({
    id: `bot-${slot}`,
    name: `Bot ${slot}`,
    slot,
    bot: true,
  }));
  for (const mapId of ["crossfire", "ricochet"] as const) {
    const state = createArena(bots, mapId);
    let restored: typeof state | undefined;
    while (state.phase !== "over") {
      for (const world of restored ? [state, restored] : [state]) {
        for (const base of world.bases)
          control(world, base.id, botControl(world, base));
        step(world);
      }
      assert.ok(state.balls.every((ball) => insideArena(ball.x, ball.y)));
      if (state.tick % 200 === 0)
        assert.deepEqual(decodeArena(encodeArena(state)), state);
      if (restored) assert.deepEqual(restored, state);
      if (mapId === "ricochet" && state.tick === FRENZY + 20)
        restored = decodeArena(encodeArena(state))!;
    }
    assert.ok(state.tick <= COUNTDOWN + 2400);
    assert.ok(state.bases.some((base) => !base.alive));
    if (mapId === "ricochet") assert.ok(restored);
  }
});
